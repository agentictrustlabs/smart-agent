# Phase A — Contract Role Split (Foundation)

> **Status**: ✅ Implemented (2026-05-18). See
> `IMPLEMENTATION_NOTES.md` for the four documented divergences.
> 445/445 forge tests pass (430 existing + 15 Phase A). pnpm
> typecheck clean across 17 workspaces.
> **Follow-ups landed**: Phase A.5 (2026-05-18) closes C1 § A13,
> C2 § 5 (revocation gap), K1-Q1 (rotation), SC4 (system-contract
> governance), SC5 § 6.1-6.2 (ReentrancyGuard), and SC7 (storage gaps
> + CI). See `phase-A5-contract-followups.md`. Post Phase A.5 totals:
> 504 tests passing (447 baseline + 57 new).
> **Depends on**: nothing. This is the foundation phase.
> **Unblocks**: B, C (and indirectly D/E/F/G/H, which all assume the new
> capability model exists on chain).
> **Contract redeploy required.** No backwards-compat. Fresh-start re-seeds.

## Goal

Re-architect `AgentAccountFactory` + `AgentAccount` so that **system
keys hold capability-specific roles, not owner-set membership**. After
this phase:

- Master / bundler / session-issuer are NOT in `_owners`.
- ERC-1271 owner checks pass ONLY for user credentials (passkey, EOA).
- `_authorizeUpgrade` requires an OWNER's signature, not just
  `_owners[msg.sender]`.
- Bundler can submit userOps but cannot author them (inner signature
  must recover to an owner).
- Session-issuer can mint session delegations but is not an owner.

This eliminates the M-1 finding from the master-key + deployer-drift
audit (master compromise = takeover of every agent), and converts master
signer into a relay-only role consistent with Goal #1 of the master
plan.

---

## Current state (problem)

### Factory

`packages/contracts/src/AgentAccountFactory.sol`:

```solidity
constructor(IEntryPoint entryPoint_, address delegationManager_, address serverSigner_) {
    accountImplementation = new AgentAccount(entryPoint_);
    delegationManager = delegationManager_;
    serverSigner = serverSigner_;          // <-- stored immutable on factory
}

function createAccount(address owner, uint256 salt) external returns (AgentAccount account) {
    ...
    bytes memory initData = abi.encodeCall(
        AgentAccount.initialize,
        (owner, serverSigner, delegationManager)   // <-- serverSigner passed to every account
    );
    ...
}
```

### AgentAccount.initialize (lines 83–97)

```solidity
function initialize(address initialOwner, address serverSigner, address dm) external initializer {
    if (initialOwner == address(0)) revert ZeroAddress();
    _owners[initialOwner] = true;
    _ownerCount = 1;
    emit OwnerAdded(initialOwner);

    // Add server signer as co-owner (for delegation signing in server-relay mode)
    if (serverSigner != address(0) && serverSigner != initialOwner) {
        _owners[serverSigner] = true;            // <-- master becomes co-owner of every account
        _ownerCount = 2;
        emit OwnerAdded(serverSigner);
    }

    _delegationManager = dm;
}
```

### `_validateSig` (line 512) and `_authorizeUpgrade` (line 105)

```solidity
function _verifyEcdsa(bytes32 hash, bytes memory sig) internal view returns (bool) {
    (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(hash, sig);
    if (err == ECDSA.RecoverError.NoError && _owners[recovered]) return true;
    ...
}

function _authorizeUpgrade(address) internal view override onlySelf {}
```

`onlySelf` resolves to "`msg.sender == address(this)` OR
`_owners[msg.sender]`" via the modifier chain — master, being a
co-owner, can self-call `upgradeTo(maliciousImpl)`.

### Net effect

- Master signer (`A2A_MASTER_PRIVATE_KEY` in dev / `AWS_KMS_SIGNER_KEY_ID`
  in prod) is a co-owner of every `AgentAccount` ever deployed by the
  factory.
- Master can sign any userOp for any user (ERC-1271 owner check passes).
- Master can upgrade any account to a malicious implementation.
- Master compromise = full takeover of every agent.

This is acknowledged in the route comment at
`apps/a2a-agent/src/routes/onchain-redeem.ts:640-649` and used by
design — but it violates Goal #1 and #2 of the master plan.

---

## Target state

### Factory — new constructor signature

```solidity
constructor(
    IEntryPoint entryPoint_,
    address delegationManager_,
    address bundlerSigner_,      // <-- new, NON-owner, immutable
    address sessionIssuer_       // <-- new, NON-owner, immutable
) {
    accountImplementation = new AgentAccount(entryPoint_);
    delegationManager = delegationManager_;
    bundlerSigner = bundlerSigner_;
    sessionIssuer = sessionIssuer_;
}
```

Both stored immutable on the factory and passed to every new account
via `initialize`. Neither becomes an `_owners` entry.

### AgentAccount — new initialize signature

```solidity
function initialize(
    address initialOwner,
    address dm,
    address bundlerSigner_,
    address sessionIssuer_
) external initializer {
    if (initialOwner == address(0)) revert ZeroAddress();

    _owners[initialOwner] = true;
    _ownerCount = 1;
    emit OwnerAdded(initialOwner);

    _delegationManager = dm;
    _bundlerSigner = bundlerSigner_;          // <-- separate capability slot
    _sessionIssuer = sessionIssuer_;          // <-- separate capability slot

    emit BundlerSignerSet(bundlerSigner_);
    emit SessionIssuerSet(sessionIssuer_);
}
```

`serverSigner` is removed. `bundlerSigner` and `sessionIssuer` are
recorded but NEVER added to `_owners`.

### New capability surface on AgentAccount

#### `executeFromBundler(UserOperation calldata op, bytes calldata bundlerSig)`

```
Authorization gates:
- msg.sender == EntryPoint                  (so this can only be called inside ERC-4337 path)
- bundlerSig recovers to _bundlerSigner     (the EntryPoint envelope is authorized by the bundler)
- op.signature recovers to an _owners entry (the inner action is authorized by a user)
```

`executeFromBundler` is the ONLY entry point for ERC-4337 user
operations. Bundler envelope + user inner signature = both required.
Master can submit but cannot author.

The standard `validateUserOp(op, hash, missingFunds)` is overridden to
delegate validation here: it recovers `op.signature` to `_owners` AND
checks that `msg.sender == EntryPoint`, leaving the bundler-envelope
check to a separate pre-EntryPoint relay path documented in
`phase-B-a2a-signer-model.md`.

#### `acceptSessionDelegation(bytes32 sessionDigest, bytes sessionIssuerSig, bytes ownerAuthSig)`

```
Authorization gates:
- sessionIssuerSig recovers to _sessionIssuer
- ownerAuthSig is an EIP-712 SessionAuthorization signed by an _owners entry
  authorizing _sessionIssuer to mint this specific sessionDigest
  with a (validUntil, scope) bound
```

The session-issuer cannot unilaterally mint a session-delegation against
an account — the user must have pre-authorized the specific session via
an EIP-712 `SessionAuthorization` message. This is the v1 default
(option (ii) in the Open Questions resolution below).

#### `upgradeToWithAuthorization(address newImpl, bytes ownerSig)`

```solidity
function upgradeToWithAuthorization(address newImpl, bytes calldata ownerSig) external {
    bytes32 digest = _hashTypedDataV4(
        keccak256(abi.encode(UPGRADE_TYPEHASH, newImpl, _nonces[msg.sender]++))
    );
    (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, ownerSig);
    if (err != ECDSA.RecoverError.NoError || !_owners[recovered]) revert NotAuthorized();
    _upgradeToAndCallUUPS(newImpl, "", false);
}
```

Master / bundler / session-issuer can SUBMIT this transaction (pay gas)
but cannot AUTHORIZE the upgrade — the `ownerSig` must come from an
actual owner. `_authorizeUpgrade` is unreachable from any non-self path
via the legacy `upgradeTo` direct call; legacy `upgradeTo` is removed
or guarded by `onlySelf` AND a re-check that the call originates from a
verified self-call (i.e. an `executeFromBundler` that re-entered into
this function with an owner-signed inner op).

---

## Design decisions

### D1 — bundlerSigner vs sessionIssuer: same EOA or different?

**DECISION: DIFFERENT. Each gets its own KMS key.**

Rationale:
- Different blast radius. Bundler compromise = attacker can mempool-stuff
  but not mint sessions (no authority to short-circuit user
  authorization). Session-issuer compromise = attacker can attempt to
  mint sessions but ONLY against accounts where they ALSO hold an owner
  signature for the `SessionAuthorization`.
- Different rotation cadence. Bundler key rotates with infra
  refresh (~quarterly). Session-issuer key rotates with security policy
  (~annually or on incident).
- Different audit retention. Bundler signs millions of envelopes;
  session-issuer signs sessions only. Audit-log volume differs by 3+
  orders of magnitude.

**Implementation:**
- LocalStack: `BUNDLER_KMS_KEY_ID` + `SESSION_ISSUER_KMS_KEY_ID`.
- AWS: separate KMS keys with separate IAM roles.
- GCP: separate keys with separate service accounts.

### D2 — Session authorization model (HYBRID, risk-tier routed)

**DECISION: Hybrid model — Variant A (off-chain caveated delegation,
redeemed at action time) for low/medium risk; Variant B (on-chain
delegation registration at session-init) for high/critical risk.**

The defensible architectural position (user-locked at design-lock time):

> We use on-chain delegation for authority execution, but not necessarily
> for every session bootstrap. For low-risk short sessions, the user
> signs a caveated delegation off-chain and it is redeemed on-chain only
> when needed. For high-risk or long-lived sessions, we register the
> delegation/session account on-chain immediately. KMS protects
> operational keys; paymaster hides gas from the user; caveats enforce
> limits on-chain.

#### Variant A — low/medium risk (default)

- User signs an EIP-712 caveated delegation off-chain at
  `POST /session/init`:
  - `delegator` = user's AgentAccount
  - `delegate` = session key (fresh EOA generated by a2a-agent)
  - caveats = time window (`TimestampEnforcer`), target allowlist
    (`AllowedTargetsEnforcer`), selector allowlist
    (`AllowedMethodsEnforcer`), max value (`ValueEnforcer`), scope tag
- Delegation is NOT written on-chain at session-init.
- Stored signed (encrypted via KMS envelope) in person-mcp's session_store.
- When the session takes an action, a2a-agent submits
  `DelegationManager.redeemDelegation(delegation, signature, mode, executions)`.
- On-chain enforcement happens at redeem time via the caveat enforcers
  registered with `DelegationManager`.
- Revocation: short TTL OR off-chain revocation list maintained in
  person-mcp's `revocation_epochs` table (consulted by a2a-agent before
  redeem submission).
- Trade-offs: no gas at session start; on-chain enforcement at execution;
  good UX; short sessions work. Session existence is not visible on-chain
  until used; revocation needs short TTL or explicit on-chain revoke.

#### Variant B — high/critical risk

- Triggered when the session's intended action set includes any action
  tagged `@sa-risk-tier high` or `@sa-risk-tier critical`.
- At session creation, a2a-agent submits a userOp that registers the
  delegation on-chain via `DelegationManager` AND/OR deploys a dedicated
  SessionAgentAccount whose state itself lives on-chain.
- The on-chain registration is the authoritative existence of the session.
- Revocation is explicit on-chain (`DelegationManager.revoke(delegationHash)`).
- Trade-offs: strongest on-chain audit; revocation and state are
  explicit; defensible for high-stakes actions. Login/session creation
  requires tx latency; gas at session start (sponsored by paymaster).

#### Risk-tier routing

Routing uses the existing `@sa-route` / `@sa-risk-tier` annotations
already in the codebase:

- `low` / `medium` → Variant A
- `high` / `critical` → Variant B

Initial high-risk actions (locked):
- Money movement (treasury withdrawals, pledge honoring, grant payouts)
- Treasury admin (treasury config changes, signer-set edits)
- Grant award finalization (proposal-lane award commit)
- Org ownership changes (steward edits, founder swap)
- Long-lived automation (sessions with `validUntil - now > 1h`)

The session-init endpoint accepts a `scope` declaration; if ANY action
in scope is high-risk, the entire session is provisioned via Variant B.
Mixed-scope sessions are not split — Variant B is the strictly-stronger
mode and covers all lower tiers within the same session.

#### Demo seed at fresh-start time

Each demo user gets ONE Variant A session pre-minted (for normal flow).
No Variant B sessions are pre-minted, to avoid stale on-chain state
across fresh-starts; high-risk demo flows trigger Variant B on demand
via the normal session-init path.

#### AgentAccount support for both paths

AgentAccount must support BOTH delegation paths cleanly:

- **Variant A**: delegation is verified externally by `DelegationManager`;
  redemption is submitted as a userOp whose inner signature is the
  session-key's signature. `AgentAccount._validateSig` recognizes the
  session-key via the redemption path delegated through
  `DelegationManager.redeemDelegation(...)`. The session-key is NOT
  added to `_owners`.
- **Variant B**: on-chain delegation is registered via a userOp signed
  by an actual owner (passkey/EOA). Subsequent session userOps reference
  the registered delegation; `_validateSig` accepts the session-key by
  consulting `DelegationManager` for an active on-chain delegation whose
  delegate matches the recovered signer.

Both paths converge on `DelegationManager` as the on-chain enforcement
surface. The session-key is never an owner; authority always traces back
to a delegation a user signed.

### D3 — ERC-4337 entry-point integration (defense-in-depth wrapper)

**DECISION: `executeFromBundler` is an ADDITIONAL layer alongside
ERC-4337's `validateUserOp`, not a replacement. Keeps EntryPoint
compatibility intact.**

- `validateUserOp(op, userOpHash, missingFunds)` is the standard
  ERC-4337 entry hook and recovers `op.signature` against `_owners` (or
  against an active session delegation via `DelegationManager`). This is
  the EntryPoint-required path.
- `executeFromBundler(op, bundlerSig)` is the wrapper used by the
  bundler relay in `apps/a2a-agent/src/routes/onchain-redeem.ts` to
  construct the EntryPoint call AND re-verify the bundler-envelope
  guarantee at the contract layer. It does not replace `validateUserOp`;
  it re-checks the bundler envelope a second time, inside the contract.
- The bundler-envelope check therefore happens at BOTH the
  pre-EntryPoint relay tx (off-chain, in a2a-agent) AND inside the
  contract (`executeFromBundler`). Two layers; both must pass.
- Inner `op.signature` is verified by the standard `validateUserOp`
  against `_owners` (or via the delegation-manager redemption path for
  session-keys). Authority always traces to a user credential.
- Keeps EntryPoint v0.8 compatibility: nothing in the standard
  `validateUserOp` shape changes; the bundler-envelope re-check is
  additive.

This is documented as such in `phase-B-a2a-signer-model.md`; both layers
must pass for a userOp to land.

### D4 — Counterfactual address change

The factory constructor signature changes from
`(IEntryPoint, address dm, address serverSigner)` to
`(IEntryPoint, address dm, address bundlerSigner, address sessionIssuer)`.
This changes the factory's deployed bytecode hash AND the init data
passed to each proxy — counterfactual addresses change.

**No migration.** `fresh-start.sh` re-deploys + re-seeds; demo accounts
get new addresses. There are no prod accounts in play.

---

## Foundry test plan

The following tests are MANDATORY for Phase A acceptance. Place under
`packages/contracts/test/AgentAccountRoleSplit.t.sol` (new file).

### Positive paths

1. `test_OwnerCanSignUserOps()` — user EOA signs a userOp; validate
   accepts via `_validateSig`.
2. `test_PasskeyCanSignUserOps()` — WebAuthn assertion verifies via
   `_verifyWebAuthn`; validate accepts.
3. `test_BundlerCanSubmitButCannotAuthor()` — bundler signs the relay
   envelope, INNER signature is the user's; validate accepts.
4. `test_VariantA_OffChainDelegation_RedeemAtAction()` — user signs an
   EIP-712 caveated delegation off-chain (delegator = user account,
   delegate = session-key). Session-key signs a userOp. The userOp's
   inner signature drives `DelegationManager.redeemDelegation(delegation,
   userSig, mode, executions)`. `_validateSig` accepts via the
   delegation-manager redemption path; caveat enforcers (Timestamp,
   AllowedTargets, AllowedMethods, Value) all pass.
5. `test_VariantB_OnChainDelegation_RegisteredAtSessionInit()` — user
   signs a userOp that calls `DelegationManager.registerDelegation(...)`,
   establishing an on-chain record. A subsequent userOp signed by the
   session-key is validated by `_validateSig` consulting the on-chain
   registration; redemption proceeds without an additional user sig.
6. `test_OwnerCanUpgradeViaSignature()` — owner signs upgrade authorization;
   `upgradeToWithAuthorization` succeeds.

### Negative paths (THE LOAD-BEARING TESTS)

7. **`test_MasterCannotSignUserOps()`** — master signs a userOp directly
   (no user inner signature); validate rejects.
8. **`test_MasterCannotUpgrade()`** — master tries
   `upgradeToWithAuthorization(impl, masterSig)`; reverts with
   `NotAuthorized`.
9. **`test_BundlerCannotSignAsOwner()`** — bundler signs a userOp's
   inner signature; validate rejects (`bundlerSigner` is not in `_owners`).
10. **`test_SessionIssuerCannotMintWithoutOwnerAuth()`** — session-issuer
    alone signs a session-delegation; redeem rejects.
11. **`test_SessionIssuerCannotUpgrade()`** — session-issuer tries
    `upgradeToWithAuthorization`; reverts.
12. **`test_BundlerCannotInstallModule()`** — bundler tries to install
    a module (which is `onlySelf` gated); reverts.
13. **`test_HighRiskActionRequiresVariantB()`** — set up a Variant A
    session whose off-chain delegation carries low/medium-tier caveats
    only. The session-key attempts to redeem a userOp whose target +
    selector are classified high-risk. `DelegationManager.redeemDelegation`
    fails because the caveat enforcers reject the high-risk selector
    against a low-tier-only delegation (the caveat tier marker / selector
    allowlist does not permit the call). Asserts that the misclassified
    Variant A session CANNOT execute a high-risk action even if the
    classifier was bypassed at session-init.

### Property tests (adversarial)

14. **`property_OwnerSetExcludesSystemKeys()`** — for every account
    deployed via `createAccount`, `isOwner(bundlerSigner) == false`
    AND `isOwner(sessionIssuer) == false`.
15. **`property_NoSystemKeyCanForgeUserOp()`** — for any address NOT in
    `_owners`, no userOp signed by that address validates.
16. **`property_SessionKeyIsNeverInOwnerSet()`** — for every Variant A
    redemption AND every Variant B registration, the delegate session-key
    is NOT added to `_owners` post-execution.

### Adversarial — permutations of the old design

17. `test_LegacyServerSignerInitDataReverts()` — calling the new
    `initialize` with the old 3-arg signature fails to compile (linter
    catches) AND if abi-encoded manually fails at runtime (extra arg
    not consumed).

---

## Off-chain integration plan

### `packages/contracts/script/Deploy.s.sol`

- Read `BUNDLER_SIGNER_ADDRESS` and `SESSION_ISSUER_ADDRESS` from env.
- Pass both to `new AgentAccountFactory(entryPoint, dm, bundlerSigner,
  sessionIssuer)`.
- Emit log lines for both addresses for downstream env propagation.

### `scripts/deploy-local.sh`

- Derive both addresses from KMS keys via `master-signer-address.ts`
  (parameterized by key ID).
- Propagate `BUNDLER_SIGNER_ADDRESS` + `SESSION_ISSUER_ADDRESS` to all
  `apps/*/.env` files.

### `scripts/provision-localstack-kms.sh`

- Create `BUNDLER_KMS_KEY_ID` and `SESSION_ISSUER_KMS_KEY_ID` alongside
  the existing master KMS key.
- Output all three IDs into the runtime env stanza.

### AWS / GCP KMS runbooks

- `docs/runbooks/aws-kms-setup.md` — add the two new key provisioning
  blocks + IAM policy stanza.
- `docs/runbooks/gcp-kms-setup.md` — same for GCP.

### `apps/web/src/lib/demo-seed/agent-self-register.ts`

- Update `AgentAccountFactory.createAccount(owner, salt)` call shape
  (no change to the call itself — factory signature is the new
  constructor) and the **read** of factory state for `bundlerSigner` /
  `sessionIssuer` to plumb the addresses into the seed delegation builder.
- No change to bundler-relayer role at seed time; deployer still pays
  gas for `handleOps` calls during seed.

---

## Acceptance criteria

Phase A is complete when ALL of the following are observable:

- [ ] `grep -rn 'serverSigner' packages/contracts/src/` returns zero hits.
- [ ] `grep -rn 'serverSigner' packages/sdk/src/` returns zero hits (SDK
      type names + ABI imports updated).
- [ ] All Foundry tests in
      `packages/contracts/test/AgentAccountRoleSplit.t.sol` pass.
- [ ] `forge build` clean on `packages/contracts`.
- [ ] `agent-self-register.ts` updated to new factory shape; tests pass
      under `apps/web`.
- [ ] `scripts/fresh-start.sh` completes successfully end-to-end on a
      clean machine (anvil + LocalStack + Postgres-or-SQLite).
- [ ] `cast call <deployed-account> "isOwner(address)" <BUNDLER_SIGNER_ADDRESS>`
      returns `false` on every demo account.
- [ ] `cast call <deployed-account> "isOwner(address)" <SESSION_ISSUER_ADDRESS>`
      returns `false` on every demo account.
- [ ] `cast call <deployed-account> "isOwner(address)" <demoUser EOA>`
      returns `true` on the user's account.
- [ ] Maria can register herself, vote on a round, propose, pledge, and
      honor — every userOp signature recovers to **her** EOA / passkey,
      not the master key. (Integration test in `apps/web/__tests__/`.)
- [ ] No external review action item from M-1 ("master is co-owner") is
      open after this phase.

---

## Open questions resolved here (locked at design-lock time)

- **Q1**: Where does the EIP-712 domain separator live for
  session-issuer signing? **A**: On the AgentAccount itself
  (`_hashTypedDataV4`), domain = `("AgentAccount", "2.0.0", chainId, address(this))`.
  The session-issuer signs against the account's domain, not a global
  one, so a session minted against account A cannot be replayed against
  account B.

- **Q2**: Does session-issuer ALSO sign inter-service MACs? **A**: NO.
  Inter-service MAC stays on the master signer (it is a service-identity
  signature, not an authority-bearing one). Session-issuer signs ONLY
  session delegations. Bundler signs ONLY EntryPoint relay envelopes.
  Master signs ONLY service MACs + (legacy) anchor txs that don't
  carry user authority.

- **Q3**: What happens to in-flight delegations from before redeploy?
  **A**: They become unredeemable — they were issued against the old
  `AgentAccount` implementation whose `_owners` set included `serverSigner`,
  which doesn't exist post-redeploy. Fresh-start re-seeds. There are no
  prod delegations.

- **Q4**: Backward-compat for test fixtures referencing old
  `serverSigner` field. **A**: Find/replace across:
  - `packages/contracts/test/**/*.t.sol`
  - `packages/sdk/src/account-client.ts` (factory constructor type)
  - `packages/sdk/src/__tests__/**`
  - `apps/web/src/lib/demo-seed/agent-self-register.ts`
  - `apps/a2a-agent/src/routes/onchain-redeem.ts` (resolver of
    bundlerSigner address — Phase B work)
  - `apps/web/src/lib/contracts.ts` (factory ABI import)
  No fixture predates this spec that we must keep alive.

- **Q5 (OPEN)**: If a Variant A session attempts a high-risk action,
  WHERE does the failure occur — at the caveat-enforcer level (on-chain,
  inside `DelegationManager.redeemDelegation`) or at a higher policy
  gate (off-chain, in a2a-agent before the redeem userOp is even
  submitted)? Both layers SHOULD reject (defense in depth), but the
  spec must commit to which is authoritative. Proposed default: caveat
  enforcer is authoritative (on-chain, can't be bypassed), policy gate
  is an early-fail UX optimization. Lock the gate location in Phase B
  alongside `risk-tiers.ts`.

---

## Risks (Phase A specific)

| # | Risk | Mitigation |
|---|---|---|
| A1 | New `validateUserOp` path breaks ERC-4337 bundler compatibility (e.g. EntryPoint v0.8 expects a specific signature shape). | Foundry tests `test_OwnerCanSignUserOps` + `test_PasskeyCanSignUserOps` run against EntryPoint v0.8 fixture; integration smoke on anvil exercises `handleOps` end-to-end before any web phase starts. |
| A2 | `executeFromBundler` becomes a re-entrancy surface. | Defense: only callable from EntryPoint (`msg.sender == _entryPoint`); EntryPoint's own re-entrancy guard covers it. Test: `test_NonEntryPointCannotCallExecuteFromBundler`. |
| A3 | Session-issuer key gets compromised + user signs a `SessionAuthorization` with too-broad scope. | Mitigation: `SessionAuthorization` MUST include explicit `scope` (allowed selectors + targets) and `validUntil`; the EIP-712 type enforces these fields. Phase G adds a CI guard for "no `scope: []` SessionAuthorization issued anywhere in source." |
| A4 | Counterfactual address change breaks demo UX (people bookmarked addresses). | No-op: there is no public demo with stable addresses; fresh-start always re-seeds. Documented in master plan migration section. |
