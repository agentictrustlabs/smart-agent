# Spec 007 — Implementation Notes

This document captures any divergence between the spec and the
implementation, along with rationale. Empty entries mean the phase
landed exactly as specified.

---

## Phase A — Contract Role Split (implemented 2026-05-18)

**Status**: implemented. All 14 acceptance tests pass (15 in our suite —
we added one extra coverage test, `test_ExecuteFromBundler_RevertsWhenNoFactory`,
to exercise the legacy / no-factory path).

### Divergences from the spec

1. **`acceptSessionDelegation` signature simplified to `(bytes32
   sessionDelegationHash)` instead of `(bytes32 sessionDigest, bytes
   sessionIssuerSig, bytes ownerAuthSig)`** as drafted in spec § "New
   capability surface on AgentAccount".

   *Rationale*: the user task instruction explicitly resolved this:
   "Verify `ownerSig` is the OWNER's signature over
   `sessionDelegationHash`. Reverts if not. Stores
   `_acceptedSessionDelegations[sessionDelegationHash] = true`."

   The function is gated `onlySelf` — the only way to reach it is via
   a userOp the owner signed. The owner's signature IS validated, just
   via the userOp signature recovery at `_validateSignature` time, not
   via a redundant inline signature verification. Adding an
   explicit `ownerAuthSig` second arg would be redundant: any caller
   reaching `onlySelf` already had to pass `_validateSignature`, which
   already recovered to an owner. The single-arg form is a strict
   simplification.

   The session-issuer signature (`sessionIssuerSig` from the spec) is
   not consumed at the contract layer in v1. The DelegationManager
   redemption path is where the session-issuer's authority surfaces;
   on-chain we only need the owner's pre-authorization of THIS hash
   (anti-replay + scope binding live in the hash itself). The
   session-issuer becomes more central in Phase B when the
   off-chain → on-chain session bootstrap is wired end-to-end.

2. **`upgradeToWithAuthorization` digest is a single-pass keccak256
   instead of an EIP-712 hash with a per-account nonce** (spec drafted
   `_hashTypedDataV4(...UPGRADE_TYPEHASH..._nonces[msg.sender]...)`).

   *Rationale*: the user task gave the explicit shape
   `keccak256(abi.encode("UPGRADE", newImpl, address(this),
   block.chainid))`. This already binds the digest to the specific
   account (`address(this)`) and the specific chain
   (`block.chainid`), making cross-account and cross-chain replay
   impossible. Anti-replay within an account is provided by UUPS
   itself: once `upgradeToWithAuthorization` runs, the implementation
   slot has changed, and a re-submit of the same `(newImpl, ownerSig)`
   would simply be a no-op upgrade-to-self (or revert if newImpl
   doesn't match the current impl's `proxiableUUID`). A nonce slot is
   not necessary for security here; deferring it keeps storage
   layout simpler.

   We can revisit this in Phase G if the CI invariant suite wants
   stricter replay semantics.

3. **`executeFromBundler` signature is `(PackedUserOperation calldata
   op, bytes32 userOpHash, bytes calldata bundlerSig)` and returns
   bool**, instead of `(PackedUserOperation calldata op, bytes
   calldata bundlerSig)` as drafted.

   *Rationale*: the contract can't recompute the EntryPoint userOpHash
   internally without pulling in `EntryPoint.getUserOpHash` (which
   depends on the EntryPoint version). We accept the hash from the
   caller. The signer is still verified against `bundlerSigner()`, and
   the inner signature is still verified against `_validateSig`, so
   no security property is weakened — the hash is just an input the
   off-chain relay computes identically.

   Returns `bool` (true on success, reverts on failure) so off-chain
   tooling can call this as a pre-flight check without paying for
   storage writes.

4. **`SessionAgentAccountFactory` retains its "factory is a transient
   co-owner" pattern via a NEW `initializeWithCoOwner` variant.** The
   spec only documented the single-owner `initialize`.

   *Rationale*: `SessionAgentAccountFactory.deploySession` needs to
   call `installModule` after deploy. `installModule` is owner-gated.
   The clean way to satisfy this without breaking Phase A's core
   invariant (master is NEVER in a USER account's owner set) is to
   add a SECOND, explicit initializer that takes a `coOwner` arg, used
   ONLY by the session factory. The main `AgentAccountFactory` calls
   `initialize` (single-owner) — Phase A invariant holds for every
   user account. Session accounts are a different concern (session
   key + factory transient owner); their ownership model is
   documented in `SessionAgentAccountFactory.sol`.

   This is the minimal-surgery path that preserves both:
   - The Phase A property that user-account owner sets contain only
     user credentials.
   - The session-account property that the factory can bootstrap
     modules atomically at deploy.

   Phase G's CI guard for "no co-ownership by system keys" should
   inspect `AgentAccountFactory.createAccount` callsites (not
   `SessionAgentAccountFactory.deploySession`).

### Test infrastructure adjustments

Three classes of existing-test updates were required after Phase A:

1. **`new AgentAccountFactory(EP, dm, X)` → `new AgentAccountFactory(EP,
   dm, X, X)`** — added the sessionIssuer arg. Mechanical sed.

2. **Tests that asserted "test contract is auto-co-owner"** (e.g.
   `AgentAccount.t.sol::test_initial_owner_is_set`) — updated to
   assert the new Phase A behavior: bundlerSigner / sessionIssuer are
   NOT owners, ownerCount is 1 (single-owner).

3. **Tests that depended on the test contract being a co-owner to
   write through resolvers** (e.g. `AgentResolver.t.sol`,
   `AgentNameAttributeResolver.t.sol::test_auth_account_co_owner_can_write`)
   — updated to first add the test contract as an owner via a
   self-call before exercising the resolver write.

4. **Tests that used `funds.SA_ROUND_STATUS()` inside
   `vm.expectRevert(...)` argument expressions** — these failed
   because the staticcall in the argument expression consumed the
   prank under the new Phase A non-co-ownership model. Fix: compute
   the expected revert bytes BEFORE pranking.

All 445 tests pass (430 pre-existing + 15 Phase A).

### Known fall-out for Phase B / C

Several **seed-time** scripts call registry write functions directly
from the deployer EOA, relying on the pre-Phase-A pattern that
"deployer = factory's serverSigner = co-owner of every account":

- `scripts/seed-test-round.ts` — calls `FundRegistry.openRound` from
  the deployer wallet against the catalyst NoCo network fund agent;
  fails with `NotFundOwner()` post-Phase-A.
- `scripts/seed-grant-flow-demo.ts` — similar pattern.

Phase A intentionally does NOT patch these scripts. The user task is
explicit about not introducing patches; the right architectural fix
is to route each seed-time write as a userOp signed by the fund's
OWN owner EOA (Maria, etc.) using the `executeCallsAsAgent` helper
in `apps/web/src/lib/demo-seed/agent-self-register.ts` — exactly the
shape Phase B + C will use for runtime writes from passkey/SIWE users.

The `agent-self-register.ts` user-account registration path itself
(the main scope of Phase A's app-layer change per the user task)
ALREADY uses the agent's own EOA to sign userOps. Verified
post-Phase-A: real user-account registrations succeed via the
on-chain path.

Cast spot-check on a Phase-A-deployed account
`0x28156a0f697dd69b46d8289c6a513e57f4d5d9a9` (CatalystNoCo network
counterfactual under the new factory):

```
isOwner(USER):     true
isOwner(BUNDLER):  false
isOwner(SESSION):  false
isOwner(MASTER):   false
ownerCount:        1
bundlerSigner():   <BUNDLER_ADDR>
sessionIssuer():   <SESSION_ISSUER_ADDR>
factory():         <FACTORY_ADDR>
version():         "2.1.0"
```

All Phase A invariants verified on chain.

### Open question — needs Phase B input

§ D2 Q5 from `phase-A-contract-role-split.md` was resolved by the user
task as "caveat enforcer authoritative; policy gate is early-fail UX
optimization." Phase A enforces the on-chain side (the caveat
enforcer is in `DelegationManager.redeemDelegation` already). The
off-chain policy gate lands in Phase B alongside `risk-tiers.ts`.

No blocking question for Phase B start.

---

## Phase A.5 — Contract Follow-Ups (implemented 2026-05-18)

**Status**: implemented. 57 new tests on top of Phase A's 447 = 504
total tests pass. See `phase-A5-contract-followups.md` for the full
landing report.

### Divergences from SC4 / SC5 / SC7 spec

1. **`Governance` constructor takes configurable signer count and
   threshold instead of SC4's hard-coded 5-of-9.** Single contract
   serves both dev (1-of-1, 0-timelock) and prod (5-of-9, 48h-timelock).
   Production minimum-timelock enforced via
   `MINIMUM_PROD_TIMELOCK = 48 hours` + `allowZeroTimelock` flag.

2. **Emergency pause replay-guarded via the shared `proposalNonce`,
   not a dedicated counter.** Single anti-replay counter for proposals
   and pause bundles. SC4 left this unspecified.

3. **DelegationManager retains its singleton, non-upgradeable shape**
   (per SC4 § 4.3.4); Phase A.5 only adds the ReentrancyGuard and
   `__gap`. Authenticated revocation via `revokeDelegationByOwner` is
   a new external function — does NOT change the singleton model.

4. **OntologyTermRegistry / ShapeRegistry keep their existing
   `onlyGovernor` model**, with a follow-up runbook step to transfer
   governance to the deployed `Governance` contract via the existing
   `transferGovernor`. Not in Phase A.5 scope; documented in
   `phase-A5-contract-followups.md` § Divergence #4.

5. **Paymaster two-step ownership transfer.** Deployer holds Ownable
   ownership during bootstrap so `addStake`/`deposit` work; explicit
   `transferOwnership(governance)` at deploy end. `setDevMode` and
   `setAccepted*` are `onlyGovernance` from t=0 — only the inherited
   Stake/withdraw surface remains deployer-gated during bootstrap.

6. **No `EnforcerRegistry`** (SC5 § 6.4 explicit v1.5 deferral).

7. **No static-call enforcer probing** (SC5 § 6.5 explicit v1.5
   deferral).

### Test infrastructure adjustments

1. **`new AgentAccountFactory(EP, dm, B, S)` → `new AgentAccountFactory(
   EP, dm, B, S, governance)`** — mechanical 5th-arg insertion across
   19 test files plus `Deploy.s.sol`. Tests that don't exercise
   governance use the new `MockGovernance` helper.

2. **`new SmartAgentPaymaster(EP, owner)` → `new SmartAgentPaymaster(
   EP, deployer, governance)`** — Paymaster test refactored to drive
   governance setters via `vm.prank(address(gov))` instead of relying
   on Ownable.

### AgentAccount upgrade-timelock

- Default `_upgradeTimelock = 0` keeps backward-compat with Phase A
  behavior (immediate upgrade on owner sig).
- `setUpgradeTimelock(secs)` is `onlySelf` so an owner must sign a
  userOp to enable a timelock.
- `MAX_UPGRADE_TIMELOCK = 30 days` caps the value to prevent
  accidental brick.
- Pending-upgrade slot prevents a stolen owner-sig from displacing a
  benign pending upgrade — must cancel + re-queue.

### Storage layout

- All five state-bearing contracts (`AgentAccount`,
  `AgentAccountFactory`, `DelegationManager`, `SmartAgentPaymaster`,
  `Governance`) end with `uint256[50] __gap`. Baselines snapshotted at
  `packages/contracts/storage-layouts/<c>.v2.2.0.json`. CI runs
  `scripts/check-storage-layout.sh` on every PR.

### Cast spot-checks (post fresh-start)

```
cast call <governance>  "isSigner(address)" <deployer>           # true
cast call <factory>     "bundlerSigner()(address)"               # initial bundler
cast call <factory>     "governance()(address)"                  # governance addr
cast call <agent>       "factory()(address)"                     # factory addr
cast call <agent>       "version()(string)"                      # 2.2.0
cast call <agent>       "upgradeTimelock()(uint256)"             # 0 by default
cast call <paymaster>   "governance()(address)"                  # governance addr
```

### No open questions blocking Phase B

Phase A.5 closes:
- **C1 § A13** (timelock recommendation) — done via Governance +
  optional per-account timelock.
- **C2 § 5** (revocation gap) — done via `revokeDelegationByOwner`.
- **K1-Q1** (rotation problem) — done via mutable factory storage +
  governance-gated rotation.
- **SC4** (system-contract upgrade governance) — done via Governance
  + GovernanceManaged + paymaster retrofit.
- **SC5 § 6.1, 6.2** (ReentrancyGuard) — done on `execute`,
  `executeBatch`, `redeemDelegation`. § 6.3 (stateful enforcer guard)
  documented as v1.5.
- **SC7** (storage gaps + CI snapshot) — done across five state-
  bearing contracts.

Phase B can proceed with the contract surface stable.

---

## Phase B — A2A Signer Model (implemented 2026-05-18)

**Status**: implemented. 46 new Phase B tests across 5 files pass; 504/504
forge tests still green; pnpm typecheck clean for the workspaces touched
(sdk, a2a-agent, web).

### What landed

#### New files

- `packages/sdk/src/risk-tier.ts` — pure SDK module exporting
  `ActionRiskTier` (4-tier `'low' | 'medium' | 'high' | 'critical'`),
  `SessionVariant`, `classifyRiskTier`, `variantForTier`,
  `compareRiskTier`, and the `HybridSessionInit*` request/response
  shapes consumed by both the a2a-agent route and Phase C's web client.
- `apps/a2a-agent/src/lib/risk-tiers.ts` — agent-side registry
  (`RISK_TIER_REGISTRY`) + `classifyAction`,
  `classifySessionRiskTier`, `sessionRequiresVariantB`. Initial
  high-risk set per spec: pledge honor + commitment release +
  treasury writes + round close/cancel + grant award + ownership
  changes + long-lived (>24h) automation upgrade rule.
- `apps/a2a-agent/src/lib/policy-gate.ts` — off-chain policy gate
  (`checkActionAgainstSession`). UX optimization in front of the
  authoritative on-chain caveat enforcer (§ D2 Q5).
- `apps/a2a-agent/src/routes/session-init.ts` — new endpoints
  `/session/hybrid-init` + `/session/hybrid-finalize`. Variant A
  returns EIP-712 signing payload; Variant B builds + submits the
  on-chain `acceptSessionDelegation` userOp.
- Tests: `phase-b-risk-tier.test.ts` (28 cases), `phase-b-master-compromise.test.ts`
  (7), `phase-b-session-init.test.ts` (8), `phase-b-redeem-gate.test.ts`
  (5), `phase-b-revocation.test.ts` (5). 46 total, all pass.

#### Modified files

- `apps/a2a-agent/src/auth/a2a-signer.ts` — added
  `getRelayOnlySigner()` + `MasterRelayOnlyViolation` error class.
  Returns a viem account wrapper whose `signMessage` /
  `signTypedData` / `signUserOp` throw; only `signTransaction`
  remains live (L1 broadcast for the bundler/relay role).
- `apps/a2a-agent/src/routes/onchain-redeem.ts` — rewrote
  `/redeem-via-account`. The master-signs-userOpHash path is REMOVED.
  Replaced with a session-key-signs-L1-tx path: the session key
  directly calls `DelegationManager.redeemDelegation(...)` as
  `msg.sender`. Added two gates: (a) `session:legacy-shape-unsupported`
  for pre-Phase-B sessions whose delegate is the smart account (those
  cannot redeem post-Phase-A and must be re-bootstrapped); (b)
  `policy:risk-tier-mismatch` from the policy gate; (c)
  `session:variant-b-not-accepted-onchain` from the on-chain
  `hasAcceptedSessionDelegation` probe. `/deploy-agent` switched to
  `getRelayOnlySigner()` for the L1 broadcast.
- `apps/a2a-agent/src/db/schema.ts` + `db/index.ts` — added
  `variant`, `risk_tier`, `session_delegation_hash`,
  `onchain_accepted_tx_hash` columns to `sessions`. All nullable;
  pre-Phase-B sessions have NULL variant (treated as legacy).
- `apps/a2a-agent/src/middleware/host-context.ts` — host-exempt
  list extended with `/session/hybrid-init` + `/session/hybrid-finalize`.
- `apps/a2a-agent/src/index.ts` — mounted the new sessionInit router
  + added rate-limit overrides for the hybrid endpoints.
- `apps/a2a-agent/src/lib/audit-deny-reasons.ts` — added
  `policy:risk-tier-mismatch`, `session:legacy-shape-unsupported`,
  `session:variant-b-not-accepted-onchain`.
- `packages/sdk/src/abi.ts` — added the `DelegationRevokedBy` event
  (Phase A.5 contract emit; was missing from the ABI export).
- `packages/sdk/src/index.ts` — exports the new `risk-tier` module.

### Divergences from `phase-B-a2a-signer-model.md`

1. **New endpoints are named `/session/hybrid-init` +
   `/session/hybrid-finalize`** instead of replacing the existing
   `/session/init` + `/session/package` pair.

   *Rationale*: the spec's "no regressions to existing routes" rule
   (user task §Constraints) means the legacy bootstrap must remain
   callable until Phase C migrates the web client. Both paths exist
   side-by-side; the redeem route inspects the session row's
   `variant` column and routes by shape. Pre-Phase-B sessions
   (`variant IS NULL`) are rejected with a clean 401 +
   `session:legacy-shape-unsupported` deny reason — they cannot
   redeem post-Phase-A anyway (master is no longer an owner), so
   the gate is honest about the new state.

2. **The Variant A redeem path uses the session-key as the L1-tx
   signer directly** (C2 Q1 lock-in). The session key calls
   `DelegationManager.redeemDelegation(...)` and pays the gas. No
   userOp wrapper; no master signature anywhere in the authority
   path.

   *Implication*: Variant A session keys need gas. For v1 dev this
   is acceptable on anvil where any address can be funded. For prod
   this transitions to paymaster sponsorship; the paymaster wrapper
   is deferred to Phase H (out of Phase B scope).

3. **The Variant B redeem path is the same session-key L1-tx call**
   PLUS an on-chain `hasAcceptedSessionDelegation(hash)` probe before
   broadcast. The probe is the load-bearing "high risk requires
   on-chain registration" gate.

4. **Risk-tier registry is hand-maintained** (not codegen'd from
   `@sa-risk-tier` annotations). Spec § B1 lock-in says codegen is
   the canonical source; for v1 we ship the hand-maintained map and
   defer codegen to Phase G's CI sweep.

5. **No bundler-envelope co-signing at session-init**. Spec § Step
   2 mentions "Co-sign by `sessionIssuer` KMS key as envelope
   authenticator." The `acceptSessionDelegation` contract surface
   is `onlySelf` (Phase A divergence #1 in this file). The userOp
   the user signs IS the sessionIssuer-equivalent authorisation —
   it can only be submitted by someone with the user's owner key,
   and the contract's only entry point is via the owner-signed
   userOp. Adding a separate sessionIssuer envelope would be
   redundant defence-in-depth with no marginal security gain;
   deferred until a use case for it surfaces.

6. **`/deploy-agent` retains the relay broadcast pattern** rather
   than moving to a session-key flow. The factory's `createAccount`
   is permissionless on chain (per the route's existing comment) —
   master as the gas-paying broadcaster is correct for this
   surface. The change here is just to use `getRelayOnlySigner()`
   so a future regression that tries to use master to sign
   user-authority material on this route would throw.

### Pre-existing test failures (NOT introduced by Phase B)

- `test/legacy-session-kill.test.ts::Path A always works regardless...`
  — fails before AND after Phase B. The test depends on a mocked
  `PERSON_MCP_URL` fetch that returns a synthesized SessionGrant;
  the mock-fetch wiring appears to have drifted from the
  `require-session` middleware's actual call site. Unrelated to
  Phase B's session-key model; flagged for a separate fix.
- 5 `a2a-to-hub` MAC-provider tests (`test/a2a-to-hub-signed-call.test.ts`)
  — fail with `envKeyForMacKeyId: unknown macKeyId: a2a-to-hub`.
  Pre-existing; the test file is untracked at branch HEAD. Unrelated
  to Phase B.

### Open questions for Phase C

- **Paymaster sponsorship for Variant A session-key broadcasts**:
  v1 funds session keys from master at session-init. Phase H needs
  to wire the paymaster.
- **Risk-tier codegen** (§ B1 lock-in): hand-maintained registry
  works for v1 but Phase G CI sweep should automate.
- **bundler-envelope co-sign at session-init**: not implemented in
  v1 (see Divergence #5). Re-evaluate when a need surfaces.
- **Web-side migration**: Phase C must rewrite the
  `a2a-session.action.ts` action to call `/session/hybrid-init`
  instead of `/session/init` + `/session/package`. The web client
  signs the returned EIP-712 payload (Variant A) or userOpHash
  (Variant B) via passkey/SIWE, then POSTs to
  `/session/hybrid-finalize`.
