# Phase 2 — Delegation Refactor Summary

**Status:** complete; verified by 297 forge tests + 4-package typecheck
**Date:** 2026-05-10
**Source plan:** `output/delegation-implementation-plan.md` §4

---

## What Phase 2 does

Adds the **sub-delegated execution path** for sensitive-tier MCP tools. The
seven tools previously rejected by Phase 1's `/session/:id/redeem-tx` with
HTTP 403 (`pool:close`, `round:close`, `round:cancel`, `round:set_awards_root`,
`disbursement:claim`, `grant_proposal:award`, `grant_proposal:revoke_award`)
now route through a new endpoint that:

1. Mints a per-call `D_sub` from the session key (D_root.delegate) to a
   per-tool executor identity, narrowed to one (target, selector, value,
   calldata-hash, taskId) tuple inside a 60-second window.
2. Submits `redeemDelegation([D_sub, D_root], target, value, callData)`
   FROM the executor's key as `msg.sender`.
3. Revokes `hash(D_sub)` after submit so the same authorization can't be
   replayed (single-use semantics).

Per-tool executor identities mean a leaked executor private key can only
sign calls inside ITS family's policy envelope — blast-radius isolation
beyond what shared-key signing would offer.

Of the seven tools above: four (`pool:close`, `round:close`,
`round:cancel`, `round:set_awards_root`) already have on-chain calls and
are fully migrated. Three (`disbursement:claim`, `grant_proposal:award`,
`grant_proposal:revoke_award`) are currently MCP-only operations whose
handlers do no on-chain work; the policy declaration is preserved for
future activation when their on-chain side lands. See "Tools listed but
not migrated" below.

---

## Files created

| Path | Purpose |
|---|---|
| `packages/contracts/src/enforcers/TaskBindingEnforcer.sol` | Caveat enforcer storing `bytes32 taskId` in terms. Informational (records the A2A task this delegation is bound to); cryptographic call-time gating is done by `CallDataHashEnforcer`. Provides `getTaskId(terms)` for audit-time decoding. |
| `packages/contracts/src/enforcers/CallDataHashEnforcer.sol` | Caveat enforcer locking the redeem to one exact `keccak256(callData)`. `beforeHook` reverts with `CallDataMismatch(expected, actual)` if the redeem's calldata doesn't match terms. |
| `packages/contracts/test/TaskBindingEnforcer.t.sol` | 5 unit tests — terms shape, getTaskId round-trip, beforeHook no-op, afterHook no-op. |
| `packages/contracts/test/CallDataHashEnforcer.t.sol` | 5 unit tests — exact match, mismatch, bad terms length, empty calldata edge case, afterHook no-op. |
| `packages/contracts/test/SubDelegationCompromise.t.sol` | 7 integration tests — happy path, leaked-key replay defense, fresh-mint for new calldata, tampered delegate, tampered authority, calldata mismatch revert, expired window revert. |
| `apps/a2a-agent/src/lib/tool-executors.ts` | Per-tool-family executor identities. 4 families: `ROUND_AWARDS`, `DISBURSEMENT`, `POOL_LIFECYCLE`, `GRANT_AWARDS`. Env-overridable (`TOOL_EXECUTOR_<FAMILY>_PRIVATE_KEY`) with deterministic fallback derived from `DEPLOYER_PRIVATE_KEY`. Exports `getExecutorForTool(toolId)` + `TOOL_TO_FAMILY` map. |
| `output/phase2-delegation-summary.md` | This file. |

## Files edited

| Path | Change |
|---|---|
| `packages/sdk/src/delegation.ts` | Added `encodeTaskBindingTerms(taskId)`, `encodeCallDataHashTerms(expectedHash)`, plus `decodeTaskBindingTerms` / `decodeCallDataHashTerms`. Both validate the 32-byte hex shape eagerly. |
| `packages/sdk/src/index.ts` | Re-exported the four new encode/decode helpers. |
| `packages/contracts/script/Deploy.s.sol` | Deploys `TaskBindingEnforcer` + `CallDataHashEnforcer`; emits `TASK_BINDING_ENFORCER_ADDRESS` + `CALLDATA_HASH_ENFORCER_ADDRESS` env lines. |
| `scripts/deploy-local.sh` | (1) Extracts + propagates the two new enforcer addresses to `apps/web/.env` and `apps/a2a-agent/.env`. (2) Propagates `ALLOWED_TARGETS_ENFORCER_ADDRESS`, `ALLOWED_METHODS_ENFORCER_ADDRESS`, `VALUE_ENFORCER_ADDRESS` to a2a-agent's env (a2a-agent now needs these to mint D_sub). (3) Writes 4 deterministic dev tool-executor private keys to `apps/a2a-agent/.env`. (4) Calls `anvil_setBalance` to fund each of the 4 executor addresses with 1 ETH so they can pay gas. |
| `apps/a2a-agent/src/config.ts` | Reads the 5 enforcer addresses needed for D_sub minting: `ALLOWED_TARGETS_ENFORCER_ADDRESS`, `ALLOWED_METHODS_ENFORCER_ADDRESS`, `VALUE_ENFORCER_ADDRESS`, `TASK_BINDING_ENFORCER_ADDRESS`, `CALLDATA_HASH_ENFORCER_ADDRESS`. |
| `apps/a2a-agent/src/routes/onchain-redeem.ts` | New `POST /session/:id/redeem-subdelegated` endpoint (~270 lines). Mints + signs D_sub with the session key, submits via executor key, revokes D_sub post-submit. Audit row populated with `executionPath='sub-delegated'`, `toolGrantHash=hash(D_sub)`, `toolExecutor=executor.address`. `writeReceipt` signature extended with optional `toolGrantHash` / `toolExecutor`. |
| `apps/org-mcp/src/tools/pools.ts` | `pool:close` migrated from `callA2aRedeem` to `callA2aRedeemSubDelegated`. Added `a2aTaskId?` to schema; if absent, synthesized as `a2a-task:${mcpCallId}:${Date.now()}`. |
| `apps/org-mcp/src/tools/rounds.ts` | Same migration for `round:close`, `round:cancel`, `round:set_awards_root`. The two routine tools (`round:open`, `round:set_status`) keep using `callA2aRedeem`. |

## Files NOT changed

- `apps/org-mcp/src/lib/a2a-client.ts` — `callA2aRedeemSubDelegated` was
  already declared in Phase 1 (with the wire shape committed). No edit
  needed; the endpoint it talks to is what Phase 2 added.

---

## Sub-delegation envelope (caveats composed on D_sub)

Every `redeem-subdelegated` mint composes six caveats:

| # | Enforcer | Terms |
|---|---|---|
| 1 | `TimestampEnforcer` | `(validAfter=now, validUntil=now+60)` — tight window |
| 2 | `AllowedTargetsEnforcer` | `[body.target]` — single allowed target |
| 3 | `AllowedMethodsEnforcer` | `[selector(body.callData)]` — single selector |
| 4 | `ValueEnforcer` | `BigInt(body.value)` — value cap = call value |
| 5 | `CallDataHashEnforcer` | `keccak256(body.callData)` — locks to one call |
| 6 | `TaskBindingEnforcer` | `keccak256(toBytes(body.a2aTaskId))` — audit tag |

Combined, this gives sub-delegations a single-use, task-bound,
calldata-locked authorization that's good for 60 seconds. The session
key can issue new D_subs for other calls — that's correct authorized
behavior — but the original is dead once submitted (the
post-submit revoke makes that explicit) and can't be reused even by a
leaked session key.

---

## A2a-agent `POST /session/:id/redeem-subdelegated`

```ts
// Auth: HMAC(A2A_INTERSERVICE_HMAC_KEY_<mcp>) over body, with sessionId in
// the canonical message (same as Phase 1).
// Body: { mcpTool, mcpCallId, a2aTaskId, target, value: <decimal>, callData }
// Flow:
//   1. Validate TOOL_POLICIES[mcpTool] exists AND executionPath='sub-delegated'.
//   2. Require a2aTaskId (non-empty).
//   3. Look up session (must be active + unexpired).
//   4. Validate target ∈ resolveTargetAddress(policy.allowedTargets, env).
//   5. Validate selector(callData) ∈ policyAllowedSelectors(toolId, policy).
//   6. Resolve executor via getExecutorForTool(mcpTool).
//   7. Mint D_sub:
//        delegator = pkg.sessionKeyAddress    (D_root.delegate)
//        delegate  = executor.address
//        authority = hash(D_root)
//        caveats   = [the 6 above]
//        salt      = random 8 bytes
//      Hash via hashDelegation, sign hash with pkg.sessionPrivateKey
//      (ECDSA — session is an EOA so DelegationManager._validateSignature
//      routes through ecrecover).
//   8. Insert ExecutionReceipt(status='pending', executionPath='sub-delegated',
//      toolGrantHash=hash(D_sub), toolExecutor=executor.address).
//   9. wallet.writeContract({
//        from: executor.address,
//        to: DelegationManager,
//        fn: redeemDelegation([D_sub, D_root], target, value, callData)
//      })
//   10. wait for receipt → status='completed' (or 'reverted').
//   11. If ok: best-effort revoke hash(D_sub) from sessionKey
//       (fire-and-forget; same-block landing is fine, see Gotchas below).
//   12. Return { txHash, executionReceiptId, toolGrantHash, toolExecutor, revokeTxHash }
```

Policy denials, target/selector mismatches, and minting errors all write
`ExecutionReceipt(status='denied')` with `errorReason` before returning a
403. The audit table thus records every attempted promotion, not just
the successful ones.

---

## Forge tests added (17 total)

### `TaskBindingEnforcer.t.sol` (5)
- `test_setsTerms_returnsTaskId`
- `test_revertsOnBadTermsLength`
- `test_beforeHook_isNoop_givenValidTerms`
- `test_beforeHook_revertsOnBadTermsLength`
- `test_afterHook_isNoop`

### `CallDataHashEnforcer.t.sol` (5)
- `test_matchesExactCallData`
- `test_revertsOnMismatchedCallData`
- `test_revertsOnBadTermsLength`
- `test_emptyCallData_isStillBindable`
- `test_afterHook_isNoop`

### `SubDelegationCompromise.t.sol` (7)
- `test_happyPath_executorSubmitsRedeem`
- `test_leakedSessionKey_cannotReplaySubDelegationForSameCalldata` — single-use property
- `test_leakedSessionKey_canMintFreshSubDelegationForDifferentCalldata` — proves the session key isn't dead after one use, but each grant is single-use
- `test_tamperedSubDelegation_delegate_fails` — InvalidDelegate
- `test_tamperedSubDelegation_authority_fails` — InvalidAuthority
- `test_callDataMismatch_fails` — CallDataMismatch with expected/actual
- `test_expiredSubDelegation_fails` — Timestamp window enforcement

Uses `vm.etch` to install a tiny ERC-1271 mock at the user-account
address so `DelegationManager._validateSignature` accepts the root
delegation's signature (testing focuses on chain semantics + the new
enforcers, not on signature validation itself — that's covered by
`AgentAccount.t.sol`).

---

## Per-tool executor identities

| Family | Tools | Dev key source |
|---|---|---|
| `ROUND_AWARDS` | `round:close`, `round:cancel`, `round:set_awards_root` | `TOOL_EXECUTOR_ROUND_AWARDS_PRIVATE_KEY` |
| `DISBURSEMENT` | `disbursement:claim` | `TOOL_EXECUTOR_DISBURSEMENT_PRIVATE_KEY` |
| `POOL_LIFECYCLE` | `pool:close` | `TOOL_EXECUTOR_POOL_LIFECYCLE_PRIVATE_KEY` |
| `GRANT_AWARDS` | `grant_proposal:award`, `grant_proposal:revoke_award` | `TOOL_EXECUTOR_GRANT_AWARDS_PRIVATE_KEY` |

`deploy-local.sh` writes hardcoded dev values to `apps/a2a-agent/.env`
and funds each of the 4 derived addresses with 1 ETH via
`anvil_setBalance`. For non-local environments, set the env vars
explicitly; if missing, the loader derives a deterministic key from
`keccak256("tool-executor:" + family + ":" + DEPLOYER_PRIVATE_KEY)` so
each install gets unique addresses without manual config.

---

## Tools listed but not migrated (handler-side)

Three tools have `TOOL_POLICIES[*].executionPath === 'sub-delegated'`
but their current handlers do no on-chain work:

| Tool | Today | Treatment |
|---|---|---|
| `disbursement:claim` | SQL state flip (pending → claimed) | Policy retained; if/when a real USDC transfer lands, the handler will call `callA2aRedeemSubDelegated` and the policy already authorizes the right target/selector envelope. |
| `grant_proposal:award` | SQL state flip (submitted → awarded), pairs with a web-action sa:GrantAwardedAssertion emit | Same — policy retained for future on-chain promotion. |
| `grant_proposal:revoke_award` | SQL state flip (awarded → revoked) | Same. |

Listing them in `TOOL_TO_FAMILY` (`DISBURSEMENT` and `GRANT_AWARDS`)
means a future migration is a one-line handler change; no auth wiring
work needed.

If a handler that doesn't make an on-chain call attempts to call
`/session/:id/redeem-subdelegated` today, it would fail at the
`policyAllowedSelectors` check (the empty selector list resolves to
empty, and a non-empty call's selector won't match anything) —
behaviorally a safe "denied" rather than a silent pass-through.

---

## Migration checklist for fresh-start

`scripts/fresh-start.sh` triggers `deploy-local.sh`, which:

1. Deploys `TaskBindingEnforcer` + `CallDataHashEnforcer` (in addition
   to the existing enforcers).
2. Writes the 5 enforcer addresses (`TIMESTAMP`, `ALLOWED_TARGETS`,
   `ALLOWED_METHODS`, `VALUE`, `TASK_BINDING`, `CALLDATA_HASH`) to
   `apps/a2a-agent/.env`.
3. Writes the 4 tool-executor private keys to `apps/a2a-agent/.env`.
4. Funds the 4 executor addresses with 1 ETH each.

No SQL migration. No client-side migration. The `_a2aSessionId`
injection from Phase 1 still works unchanged.

---

## Security caveats

### Revocation timing (the key remaining replay window)

a2a-agent does `revokeDelegation(hash(D_sub))` AFTER the redeem tx is
mined, in a separate tx. If those two transactions land in different
blocks, there's a window where someone with the session key could
re-submit the same D_sub to repeat the call.

**Why this is acceptable for v1:**
- `CallDataHashEnforcer` makes the redeem deterministic — the second
  call would do the exact same thing as the first. For setRoundStatus,
  setRoundAwardsRoot, close, etc. the on-chain side is idempotent
  (status transitions are guarded by the registry contract; awards
  roots are set-once or overwritten by the same value).
- `TimestampEnforcer` caps the window at 60 seconds total.
- The audit table has the (target, selector, callDataHash) tuple, so
  an unexpected repeat is observable post-hoc.

**If we needed tighter atomicity later:** wrap submit + revoke into a
multi-call via MultiSendCallOnly (already deployed), submitted from the
executor. The revoke landing in the same tx as the submit closes the
window. Deferred to a future hardening pass.

### Executor key funding

Each of the 4 executors needs ETH for gas. The dev funding is 1 ETH
via `anvil_setBalance`. On testnets / mainnet:
- Each executor needs ≥ enough ETH to pay for the redeem tx + the
  revoke tx (~150k gas each on the redeem path observed in tests).
- Treat the executor wallets as hot wallets — top them up; alert on
  low balance; rotate periodically.
- The deterministic fallback (`keccak256("tool-executor:" + family +
  ":" + DEPLOYER_PRIVATE_KEY)`) is fine for dev but should be replaced
  by explicit env-stored or HSM-stored keys for any non-dev env.

### Signature path on D_sub

D_sub is signed by the session key (an EOA). `DelegationManager._validateSignature`
sees `delegator.code.length == 0` and recovers via ECDSA. This is
correct, but means: if the session key signing key is ever leaked, the
attacker can issue arbitrary D_subs WITHIN the policy envelope of
D_root. D_root's envelope (24h window + allowedTargets + allowedSelectors
+ value=0) caps the blast radius, and Phase 2's per-call enforcers + tight
60s window + single-use revocation cap it further per call. But the
session key remains the single point of failure for "no further
sub-delegations should be issued from this session." The user revoking
D_root via `DelegationManager.revokeDelegation(rootHash)` is the kill
switch — this still works.

### Policy escalation by malicious MCP

A malicious org-mcp could attempt to claim a different `mcpTool` than
what the user is actually invoking, hoping to route through a less
restrictive policy. Defense:
- The inter-service HMAC binds (body, timestamp, sessionId) — the MCP
  can lie about `mcpTool` field but the HMAC proves the MCP server's
  identity.
- The TOOL_POLICY for any sensitive tool restricts target + selector,
  so even a lying MCP can't escape its policy envelope.
- The audit log records (mcpTool, target, selector, callDataHash) for
  every redeem so policy mismatches are observable.

A future hardening would be to bind the MCP server's expected
allowed-toolset directly into the inter-service HMAC key derivation
so even spoofing an `mcpTool` name fails earlier.

---

## Known gotchas

### `disbursement:claim` policy validates but doesn't execute

Because `disbursement:claim` is policy-declared `sub-delegated` but the
current handler does no on-chain work, a3a-agent would never see a
redeem-subdelegated request for it today. The handler-side migration
is one line when the on-chain disbursement contract lands.

### Hono body re-read pattern (carried from Phase 1)

`requireInterServiceAuth()` reads `c.req.text()` and stashes it under
`c.var.interService.bodyRaw`. The new endpoint reads from there;
calling `c.req.json()` directly after the middleware would return
undefined because Hono caches the text/json choice. Pattern matches
Phase 1's redeem-tx + deploy-agent endpoints.

### `a2aTaskId` synthesis fallback

The current org-mcp handlers synthesize an `a2aTaskId` if the caller
didn't pass one (`a2a-task:${mcpCallId}:${Date.now()}`). The web
action layer doesn't yet pass an A2A task identifier; when it does,
the synthesis fallback should become inert. Until then, the synthesized
value still gives each call a unique audit hash — but DOESN'T tie
multiple sub-delegations to a single A2A task lifecycle, which would
be the real value of taskBinding once cross-task correlation matters.

### Forge `vm.etch` for ERC-1271 mock

`SubDelegationCompromiseTest` uses `vm.etch` to install a tiny ERC-1271
mock at the user-account address. This is necessary because
`DelegationManager._validateSignature` requires ERC-1271 for the root
delegator (which IS a smart account in production). The mock accepts
any signature; signature validation is exercised elsewhere
(`AgentAccount.t.sol`). If we wanted true end-to-end coverage, the
test would deploy a real AgentAccount and sign with its owner key —
deferred as it'd quadruple the test surface for marginal coverage
beyond what AgentAccount.t.sol already gives.

---

## Verification

| Surface | Result |
|---|---|
| `forge build` | clean (no errors) |
| `forge test --match-contract "TaskBinding\|CallDataHash\|SubDelegationCompromise"` | 17 / 17 pass |
| `forge test --match-contract "PoolRegistry\|FundRegistry"` | 32 / 32 pass (no regression) |
| `forge test` (full suite) | 297 / 297 pass |
| `pnpm --filter @smart-agent/sdk typecheck` | clean |
| `pnpm --filter @smart-agent/a2a-agent typecheck` | clean |
| `pnpm --filter @smart-agent/org-mcp typecheck` | clean |
| `pnpm --filter @smart-agent/web typecheck` | clean |

E2E (`tests/e2e/intent-marketplace.spec.ts`) is unverified in this
phase — the existing spec exercises pool/round flows that mostly use
the stateless-redeem path (`pool:create`, `pool:update_mandate`,
`round:open`, etc.) and Phase 2 leaves those untouched. The four
migrated tools (`pool:close`, `round:close`, `round:cancel`,
`round:set_awards_root`) need a fresh-start + manual UI exercise to
confirm. Recommend running `./scripts/fresh-start.sh` followed by a UI
walkthrough of "close pool" and "close round" before merging.

---

## Follow-ups (Phase 3+ candidates)

1. **Atomic submit + revoke** — wrap the two txs in a single multicall
   to close the inter-block replay window.
2. **Real A2A taskId plumbing** — replace the synthesis fallback with
   a proper task identifier propagated from the web action layer.
3. **Migrate `disbursement:claim` / `grant_proposal:award*`** when
   their on-chain side lands.
4. **Audit query API** — `GET /api/admin/audit?path=sub-delegated&from=…`
   surfacing the new toolGrantHash + toolExecutor columns.
5. **ERC-7484 attestation for third-party enforcers** — not Phase 2;
   first-party only at v1.
