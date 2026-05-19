# Delegation implementation audit

Verifies the current codebase against `docs/architecture/delegation-flow.md`.

Result summary:

- **✅ 8 of 10 invariants in place.**
- **❌ 1 gap: Phase 2 `/redeem-subdelegated` endpoint is missing on the server side.**
  Clients still call it, so every high-value tool (`pool:close`, `round:close`,
  `round:cancel`, `round:set_awards_root`) returns 404. Reinstating the
  endpoint is the next implementation step.
- **⚠ 1 sequencing footgun: docstring at `onchain-redeem.ts:343` still
  describes an aspirational userOp-via-EntryPoint pipeline.** The body
  does Phase 1 wire correctly. Either the docstring needs rewriting
  (done in this audit) or the future state needs its own endpoint.

Two ancillary findings of note:
- The session-key gas funding I added at `hybrid-init` is the **gasless-via-a2a-agent**
  realization — it satisfies the doc's invariant #3.
- people-group-mcp's `verify-delegation.ts:47` had the CORRECT check all along
  (`delegate == sessionKeyAddress`); org-mcp + person-mcp + SDK had been
  drifted to `delegate == claims.sub`. The unwind in this session removed
  the drift from those three.

---

## Per-invariant audit

### ✅ Invariant 1 — `delegate` shape

> "The valid chain shapes are `D_root.delegate = sessionKey` (Phase 1)
> and `D_sub.delegate = executor` (Phase 2). `delegate == claims.sub`
> is NOT an invariant."

**Status:** clean across all 4 sites that used to check this. Sweep result:

```bash
$ grep -rn "delegation.delegate.*!==.*claims.sub" apps packages
(no hits)
```

people-group-mcp at `verify-delegation.ts:47` checks
`delegate == sessionKeyAddress` — that's the correct Phase 1 invariant.
org-mcp / person-mcp / SDK no longer perform any equality check on
`delegate` (the chain is validated by ERC-1271 + on-chain DM).

### ✅ Invariant 2 — MCPs hold no signing keys

**Status:** clean. Org-mcp's wallet was retired in Phase 1
(`apps/org-mcp/src/lib/contracts.ts` is read-only;
`getWalletClient`/`deploySmartAccount` removed). The
`A2A_INTERSERVICE_HMAC_KEY_<mcp>` HMAC envelopes are the only auth
material MCPs hold. Verified by sweep: no `privateKeyToAccount` /
`createWalletClient` callsites in any `apps/*-mcp/src/**` outside of
test fixtures.

### ✅ Invariant 3 — The session key is a2a-agent's per-user authority; no global master

**Status:** clean. `apps/a2a-agent/src/auth/a2a-signer.ts:242-275`
implements `getRelayOnlySigner()` whose `signMessage`,
`signTypedData`, and `signTransaction` throw a `MasterRelayOnlyViolation`
error — caller intentionally goes through the master only to pay gas
(`sendTransaction` on a tx the master itself authored, which has nothing
to do with user authority). Per-session keys are generated fresh at
`/session/hybrid-init`, encrypted at rest, and never written to logs.

### ✅ Invariant 4 — Gasless from the user

> "The user pays no gas. The a2a-agent's relay-only signer covers the
> gas; it NEVER signs user-authority bytes."

**Status:** in place after this session's edit.
`apps/a2a-agent/src/routes/session-init.ts:362-389` (post-edit) — at
hybrid-init time, the relay-only signer transfers 0.1 ETH to the freshly
generated session key. The relay is the gas payer; the session key signs
the redemption. No master signature appears anywhere in the user-authority
chain.

Verified by reading the session key's balance after init:
```
$ cast balance 0xd034d45e0fd2b85f5bc4a45fcc3a7437af37cb37
100000000000000000   # 0.1 ETH
```

### ✅ Invariant 5 — One user signature, fan-out of caveat-checked calls

**Status:** clean. Web action at
`apps/web/src/lib/actions/a2a-session.action.ts` mints exactly one
D_root per session covering the user-approved scope. Caveat composition
at session-init pulls from `TOOL_POLICIES`'s union (Timestamp +
AllowedTargets + AllowedMethods + Value + McpToolScope). Per-call D_sub
in Phase 2 narrows further inside the user-approved envelope.

### ✅ Invariant 6 — Off-chain caveat evaluator + on-chain enforcers run the same checks

**Status:** clean. The off-chain evaluator
(`packages/sdk/src/policy/caveat-evaluator.ts`) is a fail-closed
dispatcher that mirrors the on-chain enforcer contracts in
`packages/contracts/src/enforcers/`. New enforcer ids must be added to
both — covered by `scripts/check-no-bypass.sh` + the Phase A.5 CI guard.

### ✅ Invariant 7 — TOOL_POLICIES with executionPath

**Status:** clean. `packages/sdk/src/policy/tool-policies.ts` exports
`TOOL_POLICIES: Record<string, ToolPolicy>` with three valid
`executionPath` values: `mcp-only`, `stateless-redeem`, `sub-delegated`.
Sweep:

```
$ grep -nE "executionPath: ('stateless-redeem'|'sub-delegated'|'mcp-only')" \
        packages/sdk/src/policy/tool-policies.ts
151: 'mcp-only'
172: 'stateless-redeem'
193: 'sub-delegated'
```

(those lines are the helper builders; actual per-tool assignments are at
lines 215-340.)

### ✅ Invariant 8 — Per-tool-family executors

**Status:** clean. `apps/a2a-agent/src/lib/tool-executors.ts` defines
four families:

| Family | Tools (Phase 2 set) |
|---|---|
| ROUND_AWARDS | `round:close`, `round:cancel`, `round:set_awards_root` |
| DISBURSEMENT | `disbursement:claim` (mcp-only today; reserved) |
| POOL_LIFECYCLE | `pool:close` |
| GRANT_AWARDS | `grant_proposal:award`, `grant_proposal:revoke_award` (mcp-only; reserved) |

Each has its own EOA, env-overridable + deterministically derived. Funded
1 ETH each by `scripts/deploy-local.sh`.

### ❌ Invariant 9 — Phase 2 `/redeem-subdelegated` endpoint exists

> "/session/:id/redeem-subdelegated" is the single Phase 2 entrypoint.
> MCPs call `callA2aRedeemSubDelegated` against it; a2a-agent mints +
> redeems + revokes D_sub on their behalf.

**Status:** **MISSING**.

```bash
$ grep -nE "^onchainRedeem\.post" apps/a2a-agent/src/routes/onchain-redeem.ts
369: onchainRedeem.post('/:id/redeem-via-account', ...)
809: onchainRedeem.post('/:id/deploy-agent', ...)
# no entry for /:id/redeem-subdelegated
```

But the client side is still wired:

```bash
$ grep -n "callA2aRedeemSubDelegated" apps/org-mcp/src/lib/a2a-client.ts
234: export async function callA2aRedeemSubDelegated(...)
```

And four tools reference it:

```bash
$ grep -rn "callA2aRedeemSubDelegated" apps/org-mcp/src/tools/
apps/org-mcp/src/tools/pools.ts:41   pool:close
apps/org-mcp/src/tools/rounds.ts:24  round:close, round:cancel, round:set_awards_root
```

**Effect:** every call to those four high-value tools fails with 404
from a2a-agent. The off-chain handlers run fine (caveat verify + JWT
verify), but the on-chain hop never lands.

**Fix:** restore the endpoint per `phase2-delegation-summary.md`
§ "A2a-agent `POST /session/:id/redeem-subdelegated`". The wire shape
+ mint logic is fully specified there. Estimated effort: 1-2 hours
(builder reuses existing imports + helpers).

For the current proposal-funding demo, none of the four high-value tools
fire — the demo uses `commitment:record_outcome` (Phase 1
stateless-redeem) and `releaseTranche` (donor-signed Rail-A, separate
path). So this gap is NOT what's blocking chapter 11. It IS a real
gap that needs fixing for the full system to work end-to-end.

### ⚠ Invariant 10 — Endpoint docstrings match implementation

**Status:** drifted at `onchain-redeem.ts:343-356` until this session.
The block described a userOp-via-EntryPoint pipeline ("sender = user's
AgentAccount, signature = master signer") while the implementation at
line ~720 did the actual Phase 1 wire (session key directly calls
`DM.redeemDelegation`). Rewritten in `acd53b0`-follow-up to match
Phase 1 wire and reference `phase1-delegation-summary.md`.

The "aspirational future-state" comments are a known drift mechanism —
they survive code refactors and mislead future readers into reverting
the implementation toward the comment. Going forward, comments should
describe what the code DOES, not what someone wished it would do.

---

## Where the recording is currently blocked (separate from this audit)

The demo recording reaches chapter 11 (Maria's release inbox) but no
release tasks appear. The path traversed:

- Sarah's session is bootstrapped ✅ (gasless funding works, balance 0.1 ETH)
- Sarah clicks "Confirm milestone" ✅ (UI button works)
- Server action `recordOutcome` calls `commitment:record_outcome` via MCP ✅
- MCP forwards to `/redeem-via-account` ✅
- a2a-agent submits `DM.redeemDelegation([D_root], CommitmentRegistry, 0, recordOutcomeCalldata)`
- **on-chain outcome is `(0x0, 0, 0x0)` — the redeem reverts silently**

The audit row for the redeem says:
```
status        reverted
errorReason   Execution reverted with reason: Out of gas: gas required
              exceeds allowance: 0
from          0xEF30D2782dB97a7ABbA7D4707571d7fB100BE445 (stale session)
```

The `from` address is a STALE session key from an earlier run — meaning
the runtime is reusing a session row whose key is not funded, not the
freshly-funded one. The web's `bootstrapA2ASessionForUser` is hitting an
existing session that pre-dates the gas-funding edit.

This is a session-reuse bug independent of the audit's invariants. Likely
fix: invalidate sessions on a2a-agent restart, or fund any session whose
key has zero balance on redeem. Out of scope for this audit; tracked
separately.

---

## Recommended next steps

1. **Restore `/session/:id/redeem-subdelegated`** (Phase 2 endpoint) —
   so high-value tools work again. Spec in `phase2-delegation-summary.md`.
2. **Fix session reuse** so freshly-funded session keys aren't shadowed
   by stale rows. Either expire on restart or top-up on first use.
3. **Add a CI guard** that fails the build if `delegate == claims.sub`
   appears in any MCP verify file — drift detection.
4. **Promote the architecture rules to `CLAUDE.md`** so future sessions
   see them on context-load (the file the user always sees).
