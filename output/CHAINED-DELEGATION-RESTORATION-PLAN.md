# Chained-delegation restoration plan

## Context

The chained-delegation architecture the user described —
`user → a2a-agent → mcp resource access` — is NOT a new design. It
shipped in Phases 1 and 2 of the **original** delegation refactor (2026-05-10),
documented and verified at:

- `output/delegation-architecture-tradeoffs.md` (designed)
- `output/delegation-implementation-plan.md` (planned)
- `output/phase1-delegation-summary.md` (Phase 1 shipped — 4-package typecheck)
- `output/phase2-delegation-summary.md` (Phase 2 shipped — 297 forge tests)

The architecture as designed and shipped:

```
User                  signs ONE root delegation D_root
                      delegator = user.smartAccount
                      delegate  = sessionKey   (a2a-agent's per-session EOA;
                                                conceptually a2a-agent's local
                                                authority for this user)
                      caveats   = [Timestamp, AllowedTargets, AllowedMethods,
                                   Value, McpToolScope]
  │
  ▼
sessionKey            (held encrypted in a2a-agent)
  │
  │ For each MCP tool call to a HIGH-VALUE tool, sessionKey mints
  │ a per-call D_sub:
  │   delegator = sessionKey
  │   delegate  = perToolFamilyExecutor   (one of 4 family EOAs)
  │   authority = hash(D_root)
  │   caveats   = [Timestamp(60s), AllowedTargets(=1), AllowedMethods(=1),
  │                Value, CallDataHash, TaskBinding]
  │
  ▼
MCP tool executor     redeemDelegation([D_sub, D_root], target, value, data)
                      msg.sender at DM = executor (= leaf.delegate ✓)
                      DM walks the chain leaf→root, validates both signatures,
                      runs caveat enforcers, then calls
                      delegator.execute(target, value, data).
                      Post-submit: revoke(hash(D_sub)) → single-use.

For LOW-VALUE tools, the executor is the sessionKey itself and only D_root
redeems (one-hop chain). Same DM contract path.
```

This is the chained model. There is no "self-delegation" anywhere in it.
The `delegate` of D_root is ALWAYS the session key (= a2a-agent's authority
for this user-session); the `delegate` of D_sub is ALWAYS a tool-family
executor. The user signs once and authorizes a hierarchy.

## What drifted

Spec 007 Phase B (commit `4aedd9a` — "update with all the re-arch stuff,
most is working again I think") introduced a parallel architectural layer
that broke the working Phase 1 + 2 delegation. Specifically:

1. **`apps/org-mcp/src/auth/verify-delegation.ts:111`** added a STRICT
   check requiring `claims.delegation.delegate === claims.sub` (where
   `claims.sub` is the user's smart account). This rejects every Phase 1
   delegation, which has `delegate === sessionKey ≠ smart account`.
   Comment block on the check calls this "Option A: leaf delegate is the
   user's smart account, not the session signer EOA" — a DIFFERENT
   "Option A" from the architecture-tradeoffs doc's Option A.

2. **`packages/sdk/src/delegation-token.ts:226`** has the SAME strict
   check, with the same misleading "Option A" comment. Same effect at the
   SDK boundary.

3. **`apps/a2a-agent/src/routes/session-init.ts:374-380`** (hybrid-init)
   produces a delegation matching the original Phase 1 shape
   (`delegate = sessionKey`). The bootstrap and the verify therefore
   disagree on every JWT.

4. **`apps/a2a-agent/src/routes/onchain-redeem.ts:343-356`** (the redeem
   endpoint, renamed from Phase 1's `/redeem-tx` to `/redeem-via-account`)
   has a comment-block docstring describing a userOp-via-EntryPoint
   pipeline, but the implementation at line ~720-733 still does Phase 1's
   direct `DM.redeemDelegation` call from the session key. The
   implementation is correct for Phase 1; the docstring is aspirational
   re-arch noise.

5. **Some action handlers** (e.g. `apps/web/src/lib/actions/commitments.action.ts`
   in HEAD) route `recordOutcome` / `cancelCommitment` through
   `commitment.donor` as the A2A endpoint host. Donor=pool has no primary
   name, so resolution fails before the delegation layer is even
   exercised. Already fixed in commit `acd53b0`.

The cumulative effect: every MCP write that goes through the verify gate
returns 500 ("Delegation delegate does not match smart account
(claims.sub)"), so the demo recording's chapters 9-13 record no on-chain
side-effect.

## The fix

Restore Phase 1 + Phase 2 alignment. **Do not invent a new architectural
layer.** Remove the drift; trust the shipped design.

### Step 1 — Remove the strict `delegate == claims.sub` check from both verifier copies

**`apps/org-mcp/src/auth/verify-delegation.ts`** L108-113 — delete the
`if (delegate !== sub)` rejection. The legitimate delegate shapes in this
architecture are:

- `delegate == sessionKeyAddress` (D_root, one-hop redemption — low-value
  Phase 1 tools).
- `delegate == perToolFamilyExecutor` (D_sub, two-hop redemption — Phase 2
  sub-delegated tools).

Neither of those equals `claims.sub`. The valid invariant is "the
delegation chain inside `claims.delegation` is a valid ERC-7710 chain
that bottoms at a session this MCP recognizes." That's already enforced
by the ERC-1271 + caveat-enforcement code below the deleted check.

**`packages/sdk/src/delegation-token.ts`** L220-228 — same change.

### Step 2 — Strip the misleading "Option A" comments

The comment block at `verify-delegation.ts:108` and
`delegation-token.ts:220` describes a "leaf delegate must equal smart
account" invariant that doesn't match the deployed architecture. Delete
the comments along with the check.

### Step 3 — Verify hybrid-init produces the Phase 1 shape

**`apps/a2a-agent/src/routes/session-init.ts:374-380`** — assert
`delegate = sessionAccount.address` (current HEAD has it as
`body.accountAddress` after `acd53b0` — that's the drift, revert).
The 2026-05-10 `delegation-implementation-plan.md` is authoritative;
session-init must match.

Re-check `phase-b-session-init.test.ts` accordingly.

### Step 4 — Confirm `/redeem-via-account` still implements Phase 1's `/redeem-tx`

Read `apps/a2a-agent/src/routes/onchain-redeem.ts` and confirm the body
of the handler matches the wire described in
`phase1-delegation-summary.md` §"`POST /session/:id/redeem-tx`":

- Auth via `requireInterServiceAuth`
- Look up session, decrypt package
- Validate target + selector against `TOOL_POLICIES[mcpTool]`
- Build viem wallet from `sessionPrivateKey`
- Insert audit receipt
- Submit `DelegationManager.redeemDelegation([userDelegation], target, value, callData)`
- Track receipt + finalize

Any aspirational docstring about userOp-via-EntryPoint is either
deferred future work or noise; strip it.

### Step 5 — Confirm `/redeem-subdelegated` still implements Phase 2

Read the same file for the second endpoint (Phase 2's `redeem-subdelegated`).
Confirm shape matches `phase2-delegation-summary.md`:

- Mint per-call D_sub from session key to per-tool-family executor
- 6-caveat envelope (Timestamp+AllowedTargets+AllowedMethods+Value+CallDataHash+TaskBinding)
- Submit `redeemDelegation([D_sub, D_root], …)` from executor key
- Revoke `hash(D_sub)` post-submit

### Step 6 — Regression test

After Steps 1-5, run the playwright demo recording. Acceptance: chapters
1-15 record, Sarah's `getOutcome` reflects two attestations, Maria's
release-tranches actually transfer USDC, Fort Collins Treasury grows by
$30k.

## Rules to prevent further drift

These belong in `CLAUDE.md` and the next session's auto-memory:

1. **The delegation architecture is `output/phase1-delegation-summary.md`
   + `phase2-delegation-summary.md`. Both are authoritative.** Do not
   introduce a third layer.

2. **`delegate == claims.sub` is NOT an invariant.** Any check requiring
   it is a regression. The valid invariants are (a) the chain validates
   under ERC-7710 (DM.redeemDelegation will accept it) and (b) the
   session this MCP recognizes is at the chain's root.

3. **"Option A" in `delegation-architecture-tradeoffs.md` means
   caveat-enforcer composition** (Phase 1). It does NOT mean
   "self-delegation where delegate equals smart account." If you see code
   commented "Option A: delegate == smart account," that's drift —
   delete it.

4. **No master signer at runtime.** A2A-agent's session keys ARE the
   a2a-agent's per-user authority. There is no global master.
   `getRelayOnlySigner()` exists only to pay gas for `handleOps` in
   Variant B session-acceptance; it MUST NOT sign user-authority bytes.

5. **Hybrid Variant B (Spec 007 Phase B) is an additive feature, not a
   replacement.** Variant A keeps the Phase 1 shape (one-hop low-value
   redemption). Variant B adds the on-chain `acceptSessionDelegation`
   step for high-risk scopes; the underlying D_root + D_sub delegation
   shapes are unchanged.

## What I am NOT proposing

- Inventing new delegate-shape semantics.
- Loosening verify with an OR-clause.
- Building a userOp-via-EntryPoint pipeline for redemption.
- Adding a2a-agent as a separate AgentAccount on chain.

All four would be drift. The shipped architecture works; the recent
re-arch broke it; the fix is to undo the re-arch's incorrect tightening.

## Effort

Steps 1-3: ~30 minutes (delete two if-blocks, revert one line + test).
Steps 4-5: ~30 minutes of reading + minor cleanup.
Step 6: full fresh-start + playwright record (~10 minutes).

Total: well under 2 hours. If implementation takes longer, something
about the codebase is fighting Phase 1 + 2 — investigate that fight
before patching around it.
