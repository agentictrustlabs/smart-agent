# C2 — Variant A Off-Chain Delegation Replay Analysis

> Audience: external security reviewers. This document focuses on the
> single highest-leverage replay surface introduced by spec 007 Phase B:
> the off-chain caveated delegation that the user signs once at
> session-init and that lives encrypted in person-mcp until redemption.
> The surface is well-bounded by existing caveat enforcers, but there
> are real gaps in the revocation model and in per-window action
> bounds. This document maps them and recommends two new caveat
> enforcers to close them.

---

## 1. Replay surface

### 1.1 What is signed

In Variant A (the default for low/medium-risk session scopes — see spec
007 `phase-A-contract-role-split.md:251-273`), the user signs an
EIP-712 `Delegation` struct at session-init:

```solidity
struct Delegation {
    address delegator;     // user's AgentAccount
    address delegate;      // session-key (fresh secp256k1 EOA per session)
    bytes32 authority;     // ROOT_AUTHORITY for top-level delegations
    Caveat[] caveats;      // typically [Timestamp, AllowedTargets, AllowedMethods, Value]
    uint256 salt;          // per-delegation salt, anti-collision
    bytes signature;       // user's EIP-712 sig over the above
}
```

(Spec: `packages/contracts/src/IDelegationManager.sol`; hash function
at `packages/contracts/src/DelegationManager.sol:109-122`.)

The EIP-712 domain is fixed in `DelegationManager` constructor
(`DelegationManager.sol:60-69`):

```solidity
DOMAIN_SEPARATOR = keccak256(
    abi.encode(
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
        keccak256("AgentDelegationManager"),
        keccak256("1"),
        block.chainid,                  // chainId binding — critical
        address(this)                    // verifyingContract binding — critical
    )
);
```

The user's signature is over `keccak256("\x19\x01" || DOMAIN_SEPARATOR
|| structHash)` (cite `DelegationManager.sol:121`). The domain binding
includes:

- **`chainId`** — prevents cross-chain replay (a sig valid on chain A
  is invalid on chain B because `DOMAIN_SEPARATOR` differs).
- **`verifyingContract`** — prevents one DelegationManager from
  validating a sig intended for another. This matters if a malicious
  fork deploys a copycat DelegationManager; sigs from our chain don't
  apply.

The `structHash` includes:

- `delegator` (user's AgentAccount address) — the sig is bound to a
  specific account.
- `delegate` (session-key address) — the sig is bound to a specific
  session-key. A captured sig cannot be redeemed by a different
  delegate.
- `authority` (`ROOT_AUTHORITY` or parent hash) — for chained
  delegations, the parent hash is bound in.
- `caveatsHash` (`DelegationManager.sol:244-252`) — every caveat
  `(enforcer, terms)` tuple is bound. Modifying any caveat invalidates
  the sig.
- `salt` — per-delegation uniqueness.

### 1.2 Where the signed delegation is stored

Per spec 007 `phase-B-a2a-signer-model.md:74-77`:

> a2a-agent stores the signed delegation encrypted (KMS envelope) in
> person-mcp `session_store` via `personMcp.upsertSession(...)`.

The full storage path:

1. apps/web receives the signed delegation from the user (passkey
   prompt or EOA sig).
2. apps/web posts to a2a-agent `/session/init/finalize` (Phase B).
3. a2a-agent calls `encryptSessionPackage(...)` with the delegation
   serialized inside. Cite:
   `apps/a2a-agent/src/auth/encryption.ts:30-36` for the KMS provider
   instantiation. The envelope is AES-256-GCM under a per-session KMS
   data key.
4. a2a-agent calls person-mcp's `/session-store/upsert` with the
   ciphertext, MAC'd under `web-to-a2a` then re-MAC'd under
   `a2a-to-person` (the standard inbound-MAC path).
5. person-mcp stores the row keyed by `sessionId`.

Post Phase F.2, the table moves from SQLite to Postgres (per spec 007
phase-F-storage-layer.md), but the row shape and the encryption
boundary are unchanged.

### 1.3 Where the delegation is redeemed

Per spec 007 `phase-B-a2a-signer-model.md:94-133`, the redeem path is:

1. apps/web posts an action to a2a-agent `/onchain-redeem`.
2. a2a-agent loads the encrypted session from person-mcp, decrypts.
3. a2a-agent builds a userOp:
   - `sender` = user's AgentAccount address.
   - `callData` = `execute(target=DelegationManager, value=0, data=
     redeemDelegation([delegation], target, value, data))`.
4. a2a-agent signs the userOp inner with the **session-key** (the
   delegate EOA generated at session-init; private key held in the
   encrypted session package).
5. EntryPoint → `AgentAccount.validateUserOp` → `_validateSig` recovers
   the inner sig to the session-key. But the session-key is NOT in
   `_owners` — so validateUserOp by itself returns
   `SIG_VALIDATION_FAILED`. The actual authority gate is downstream:
   `DelegationManager.redeemDelegation` is called, recovers the
   delegation's signature to the user's owner, runs caveat enforcers,
   then calls back into `AgentAccount.execute` from the
   DelegationManager address (which `_requireForExecute` allows —
   `AgentAccount.sol:699-708`).

The signature path that actually validates the user's authority is
`DelegationManager._validateSignature` (`DelegationManager.sol:225-240`):

```solidity
function _validateSignature(
    address signer,
    bytes32 digest,
    bytes calldata signature
) internal view {
    // ERC-1271 for smart accounts
    if (signer.code.length > 0) {
        bytes4 result = IERC1271(signer).isValidSignature(digest, signature);
        if (result != IERC1271.isValidSignature.selector) revert InvalidSignature();
        return;
    }
    // EOA — recover from eth-signed message hash
    bytes32 ethHash = digest.toEthSignedMessageHash();
    address recovered = ethHash.recover(signature);
    if (recovered != signer) revert InvalidSignature();
}
```

For user delegators (which are always smart accounts — `AgentAccount`
proxies), the smart-account branch is taken; `AgentAccount.isValidSignature`
(`AgentAccount.sol:719-732`) recovers via `_validateSig` against
`_owners` (or registered passkeys via the WebAuthn branch). The
ultimate authority check is "did one of this user's owner credentials
sign this delegation digest?"

---

## 2. Current replay mitigations

### 2.1 TimestampEnforcer

`packages/contracts/src/enforcers/TimestampEnforcer.sol`:

```solidity
function beforeHook(
    bytes calldata terms,
    bytes calldata,
    bytes32,
    address,
    address,
    address,
    uint256,
    bytes calldata
) external view override {
    (uint256 validAfter, uint256 validUntil) = abi.decode(terms, (uint256, uint256));
    if (block.timestamp < validAfter) revert TimestampNotYetValid();
    if (block.timestamp > validUntil) revert TimestampExpired();
}
```

(`TimestampEnforcer.sol:16-29`.)

Bounds the redemption window. A delegation with `validUntil = T` cannot
be redeemed after block.timestamp T. This is the primary defence
against "captured delegation replayed forever" — once T passes, the
delegation is dead on-chain.

Phase B's default `validUntil` for Variant A is "≤ 1 hour" (anything
longer is high-risk per the risk-tier registry: spec 007
`phase-A-contract-role-split.md:289-299`, "Long-lived automation
(sessions with validUntil - now > 1h)").

### 2.2 ValueEnforcer

`packages/contracts/src/enforcers/ValueEnforcer.sol:16-26`:

```solidity
function beforeHook(
    bytes calldata terms,
    bytes calldata,
    bytes32,
    address,
    address,
    address,
    uint256 value,
    bytes calldata
) external pure override {
    uint256 maxValue = abi.decode(terms, (uint256));
    if (value > maxValue) revert ValueExceedsLimit();
}
```

Bounds per-call ETH value. For a vote-cast delegation, `maxValue = 0`
— attempting to attach ETH reverts.

**Important note**: this enforces PER-CALL value, NOT cumulative. A
delegation with `maxValue = 1 ETH` and no rate limit can in principle
move 1 ETH per call, many times, within the time window. Per-call is
the correct unit for most caveats (it lets a Smart-Agent-style intent
fan out a session into multiple small transfers), but for treasury
delegations the operator should compose a `ValueEnforcer(maxPerCall) +
RateLimitEnforcer(maxCallsPerHour)` pair.

### 2.3 AllowedTargetsEnforcer

`packages/contracts/src/enforcers/AllowedTargetsEnforcer.sol:14-30`:

```solidity
function beforeHook(...) external pure override {
    address[] memory allowed = abi.decode(terms, (address[]));
    for (uint256 i = 0; i < allowed.length; i++) {
        if (allowed[i] == target) return;
    }
    revert TargetNotAllowed();
}
```

Restricts the `target` of `DelegationManager.redeemDelegation` to a
predefined set. A vote-cast delegation has `allowed = [VoteRegistry]` —
the same session key cannot be used to call `Treasury.withdraw` or
`AgentAccount.upgradeToWithAuthorization`.

### 2.4 AllowedMethodsEnforcer

`packages/contracts/src/enforcers/AllowedMethodsEnforcer.sol:16-33`:

```solidity
function beforeHook(...) external pure override {
    if (callData.length < 4) revert CalldataTooShort();
    bytes4 selector = bytes4(callData[:4]);
    bytes4[] memory allowed = abi.decode(terms, (bytes4[]));
    for (uint256 i = 0; i < allowed.length; i++) {
        if (allowed[i] == selector) return;
    }
    revert MethodNotAllowed();
}
```

Restricts the 4-byte function selector. A treasury-transfer delegation
has `allowed = [0xa9059cbb /* transfer */]` — same target but cannot
call `transferFrom`, `mint`, or `approve`.

### 2.5 DelegationManager nonce tracking

**This is the critical gap.** `DelegationManager` does NOT today have a
per-delegation usage counter or nonce. The hash mapping
`_revoked[bytes32]` (`DelegationManager.sol:50, 98-105`) tracks
revocations but not redemptions. A delegation can be redeemed N times
within its `validUntil` window as long as the caveats permit each
individual call.

This is the model's intentional design: a session-key with a 1-hour
window and 5 `transfer(0.1 ETH)` allowed targets can do many transfers
within the window. Caveats are the bound, not redemption count.

The replay-vulnerability framing: a "delegation replay" inside the
window is **identical to a legitimate use** from the contract's
perspective. The defence against "captured delegation replayed within
window" is the caveat set itself — TimestampEnforcer + ValueEnforcer +
AllowedTargets + AllowedMethods + (recommended addition)
`MaxActionsPerPeriodEnforcer`.

Cite: `DelegationManager._validateDelegation` (`DelegationManager.sol:126-154`)
— note the absence of a usage counter check. The delegation hash is
checked against `_revoked` but not against a "max uses" map.

### 2.6 ERC-712 chainId binding

Already covered in § 1.1 — cross-chain replay is impossible at the
signature-verify level because the domain separator encodes chainId.

### 2.7 Delegate-address binding

The `delegate` field is part of the EIP-712 structHash
(`DelegationManager.sol:114-118`). A signature for `(delegator=Maria,
delegate=sessionKeyA)` cannot be replayed by a different session key
`sessionKeyB` — the recovered signature differs because the structHash
differs.

Additionally, `DelegationManager._validateDelegation` (`:136-142`)
explicitly checks that the delegate matches `msg.sender` (or
`OPEN_DELEGATION`):

```solidity
if (i == 0) {
    if (d.delegate != OPEN_DELEGATION && d.delegate != msg.sender) revert InvalidDelegate();
}
```

So even if an attacker possesses a session-key sig that happens to
recover correctly, the runtime `msg.sender` is checked. Cite line 138.

---

## 3. Replay attack scenarios (with attacker model)

For each scenario the attacker model is "the attacker has obtained the
encrypted session package and the corresponding session-key private
key" — this is the C1 A7 (compromised person-mcp + Decrypt grant)
adversary, OR the C1 A6 (full KMS compromise) adversary. We do NOT
include the case "attacker has user's owner private key" because that's
A4/A5 and bypasses every off-chain defence by definition.

### 3.1 S-1: Captured delegation replayed within TTL window

**Setup**: Maria signed a Variant A delegation `D` with:
- `delegator` = Maria.AgentAccount
- `delegate` = session-key K
- caveats: `[TimestampEnforcer(now, now+3600), AllowedTargetsEnforcer([VoteRegistry]), AllowedMethodsEnforcer([0xCAST_VOTE]), ValueEnforcer(0)]`
- `validUntil` = now + 1 hour
- `salt` = unique

The attacker captures `(D, K_priv)` at time `t = now + 10 minutes` (50
minutes remaining in window).

**Attack**: attacker calls `DelegationManager.redeemDelegation([D],
VoteRegistry, 0, cast(roundId, choice='no'))` with `msg.sender = K`.

**What happens**:

- `_validateDelegation`: signature recovers correctly (it's Maria's
  legitimate sig). Delegate check passes (`msg.sender == K == D.delegate`).
- `_runBeforeHooks`: Timestamp OK (still within window). Target OK
  (VoteRegistry). Method OK (cast selector). Value OK (0).
- Execution: `VoteRegistry.cast(roundId, 'no')` runs.

**Outcome**: the attacker can cast votes as Maria within the window,
on the rounds Maria's session was authorised for. The mitigation
**within the contract layer** is **the off-chain revocation list**
(§ 5) — when person-mcp realises Maria's session was compromised, a2a-
agent SHOULD refuse to submit further redemptions for that sessionId,
even if the on-chain contracts would allow it. But this is off-chain
trust in the validation path.

**Bound**: blast radius is "every action permitted by the caveat set,
within the remaining window". For a vote-cast session this is "every
vote on every round Maria's session was scoped to". Could be many.

**Recommended additional mitigation**: `MaxActionsPerPeriodEnforcer`
(§ 4.2) bounds the per-delegation action count, so even within the
window the attacker can do at most N actions.

### 3.2 S-2: Captured delegation replayed after revoke-but-before-TTL-expires

**Setup**: As S-1. After capture, Maria notices the compromise (via her
own UI, an alert, etc.) and clicks "revoke this session". apps/web
posts to a2a-agent `/session/revoke`. a2a-agent updates person-mcp's
`revocation_epochs` table to increment the epoch for Maria's
sessionId — per spec 007 Phase B `phase-B-a2a-signer-model.md:128-129`
and `:254-258`:

> Variant A: a session's revocation epoch is incremented in person-mcp's
> `revocation_epochs` table. The next `/onchain-redeem` call rejects with
> 401 before any userOp is built.

**Attack**: attacker bypasses a2a-agent and submits the userOp directly
to the EntryPoint themselves. They don't need a2a-agent's relay; the
ERC-4337 flow is permissionless. They construct a userOp signed by the
session-key K, with the redeem-delegation calldata, and submit via any
bundler.

**What happens**:

- EntryPoint → `Maria.AgentAccount.validateUserOp` → `_validateSig`:
  recovers to K. **K is not in `_owners`**. Returns
  `SIG_VALIDATION_FAILED`. The userOp reverts at validation; EntryPoint
  refunds gas to the bundler (minus penalty).

Wait — but the standard path for redeeming a delegation is that the
**inner userOp signature** is the session-key's sig, and the inner
call is `DelegationManager.redeemDelegation`. `_validateSig` recovers
to K and rejects — so how does Variant A redemption work AT ALL today?

This question reveals an architectural subtlety that spec 007 Phase B
does not fully resolve. Let me trace carefully:

Looking at `apps/a2a-agent/src/routes/onchain-redeem.ts:638-651`
(pre-Phase-A, the CURRENT code):

```ts
const masterEoa = await getMasterSigner()
const signature = await masterEoa.signMessage({ message: { raw: userOpHash } })
const signedOp = { ...op, signature }
```

Pre-Phase-A, the inner sig is the MASTER's sig, and master is in
`_owners` (M-1). Post-Phase-A, **this exact code path is broken** —
which is why Phase B explicitly rewrites the route. The rewritten path
(`phase-B-a2a-signer-model.md:114-133`) signs with the session-key:

```ts
userOp.signature = await session.keyCustody.signUserOpHash(userOpHash)
```

But then EntryPoint's `validateUserOp` recovers to the session-key
which is not in `_owners` — so the userOp reverts.

**This is a contradiction in the current Phase B spec text and needs to
be resolved.** The actual workable mechanic is one of:

a. **The session-key IS treated as an authorised signer for the
   redemption-userOp via the DelegationManager indirection**. Concrete
   shape: the userOp's callData calls `DelegationManager.redeemDelegation`,
   and `AgentAccount._validateSig` is extended to accept a signature
   from the delegate IF the userOp calls DelegationManager. This is
   delegation-aware userOp validation and requires a new signature-type
   byte (`0x02`?) for "delegation-redemption-sig".

b. **The userOp is submitted by the session-key as `msg.sender =
   DelegationManager`, NOT via the AgentAccount path**. The
   DelegationManager.redeemDelegation is permissionless externally; the
   session-key signs the on-chain tx envelope directly (EOA signature
   over the transaction), and DelegationManager calls back into
   `AgentAccount.execute` from its own address. `_requireForExecute`
   (`AgentAccount.sol:700-708`) allows execution from the
   DelegationManager. No userOp involved at all — the session-key
   directly issues an Ethereum transaction (or, via the bundler relay,
   an Ethereum transaction whose origin is the bundler EOA and whose
   target is DelegationManager).

c. **The userOp is signed by the user's owner, not the session-key,
   and the inner call is `DelegationManager.redeemDelegation`**. In
   this case the user signs once per redemption, defeating the purpose
   of a session-key.

The spec text on `phase-B-a2a-signer-model.md` is ambiguous about which
of (a), (b), (c) is the actual mechanic. **This is an open question
that the Phase B implementation must resolve and the C2 reviewer should
flag in the audit.** The most architecturally clean answer is (b): the
DelegationManager pattern is designed to be called by the delegate
directly (cite `DelegationManager._validateDelegation` line 138
checking `d.delegate == msg.sender`), not wrapped in a userOp. This
matches ERC-7710 / MetaMask DeleGator reference behaviour.

If (b) is the implemented mechanic, then the session-key signs an
Ethereum transaction (not a userOp), the bundler does NOT relay this
specific call type, and:

**Recasting S-2 under mechanic (b)**:

The attacker has `(D, K_priv)`. They construct a transaction:
`DelegationManager.redeemDelegation([D], VoteRegistry, 0, cast(...))`,
sign with K's EOA, and submit. The transaction's `msg.sender` is K.

`DelegationManager._validateDelegation`:
- Delegate check: `d.delegate == msg.sender` ✓
- Signature check: recovers Maria's owner sig ✓
- Not revoked? **This is checked against `_revoked` mapping (on-chain).**

`_revoked` is updated only by `DelegationManager.revokeDelegation`
(`DelegationManager.sol:98-101`) — an on-chain call. The off-chain
`revocation_epochs` table in person-mcp is INVISIBLE to
DelegationManager. If Maria revoked the session off-chain (a2a-agent
updates `revocation_epochs`), but did NOT call
`DelegationManager.revokeDelegation` on-chain, then `_revoked[hash] ==
false` and the attacker's redemption succeeds despite the off-chain
revoke.

**This is the on-chain revocation gap** — covered in detail in § 5.

**Bound under mechanic (b)**: until the window expires OR an on-chain
revoke tx is mined, the attacker can redeem within caveat bounds. As
S-1, the additional defence is per-delegation action count.

### 3.3 S-3: Captured delegation replayed on a fork

**Setup**: As S-1, with capture at time `t`. A chain reorg or a forked
chain produces a state where the legitimate-redemption tx is no longer
mined, but the delegation signature is still valid (signatures don't
care about reorgs).

**Attack**: attacker re-submits the same redemption on the fork.

**What happens**:

- The `chainId` is the same on the canonical chain and on the fork (a
  reorg doesn't change `chainId`). The signature is valid.
- The `_revoked` mapping may or may not include the delegation hash —
  depends on whether a revoke tx was mined and not orphaned.
- The TimestampEnforcer is still satisfied (block.timestamp on the
  reorg path may be different but within window).

**Outcome**: legitimate-or-attacker redemption on the fork. If the user
had not yet revoked, this is benign (it's just a re-execution of an
action the user already authorised). If the user revoked but the revoke
was orphaned in the reorg, the attacker gets a free post-revoke window.

**Mitigation**: this is inherent to EVM reorgs. The mitigation is
finality assumptions; on chains with low finality (PoW shallow reorgs),
the user should expect a delegation's effects to be replayable for a
few blocks. For high-stakes Variant B actions, the on-chain
acceptSessionDelegation is the persistent witness; for Variant A this
is a known property.

### 3.4 S-4: Captured delegation replayed across pools

Not applicable directly to Variant A delegations (the delegation field
binds delegator + delegate, not pool). However, if a session is scoped
to "vote on round R1 of pool P1" via the data field, and the same
session-key has another delegation scoped to "vote on round R2 of pool
P2", an attacker with one session-key can cross-redeem ONLY if both
delegations are issued to the same delegate.

**Recommendation**: each session-key SHOULD be unique per delegation,
NOT shared across delegations. The current Phase B design generates a
fresh session-key at each `/session/init` (per
`phase-B-a2a-signer-model.md:54-59`). Confirm in the implementation
that there's no path where a long-lived session-key is re-used for
multiple delegations.

### 3.5 S-5: Captured delegation replayed by a SECOND session key

**Setup**: Maria has two concurrent sessions, K1 and K2. Each has its
own delegation D1 (delegate=K1) and D2 (delegate=K2). An attacker
captures D2 only.

**Attack**: attacker tries to redeem D2 using K1's session-key (i.e.,
submitting the redemption tx with `msg.sender = K1`).

**What happens**: `DelegationManager._validateDelegation:138` checks
`d.delegate != msg.sender → revert`. K1 ≠ K2, so the redemption reverts.

**Outcome**: cross-session replay is impossible because of the explicit
delegate ↔ msg.sender binding. K2 must be compromised independently.

**Bound**: per-session compromise is per-session blast radius. ✓

### 3.6 S-6: Quota exhaustion (drain by many small txs)

**Setup**: Maria signs a delegation with `maxValue = 30000 USDC`. No
rate limit caveat is set. (Spec 005 pledge-honor delegations are a
relevant example — see memory `project_spec005_pledge_honor`.)

**Attack**: attacker (after compromising the session-key) submits N
small transfers each below `maxValue`. Total drained: N * (some value).

**What happens**:

- ValueEnforcer is satisfied per-call.
- TimestampEnforcer is satisfied per-call.
- AllowedTargets / AllowedMethods are satisfied per-call.
- Each redemption succeeds.

**Bound**: total drained = `maxValue * (number of calls within window)`.
For a 1-hour window and a target that accepts ~1 tx/block, this is
~1800 calls.

**Mitigation**:

- **Caveat composition discipline**: a delegation with a `maxValue` of
  $30k SHOULD compose `RateLimitEnforcer(maxCallsPerWindow)` or use the
  `AllocationLimitEnforcer` (cumulative cap rather than per-call). See
  `packages/contracts/src/enforcers/AllocationLimitEnforcer.sol` (in
  tree per the directory listing in C1 §; reviewer should audit that
  contract independently).
- **Recommended additional caveat**: `MaxActionsPerPeriodEnforcer`
  (§ 4.2) bounds count regardless of per-call value.

### 3.7 S-7: TOCTOU — signature valid at sign time, conditions changed at redeem time

**Setup**: Maria signs a delegation at time `t0`. The delegation's
caveat set includes `AllowedTargetsEnforcer([TreasuryV1])`. Between
`t0` and the attacker's redemption, the project upgrades the Treasury
contract via a contract migration; the address is reassigned (e.g.,
TreasuryV2 takes the same proxy address) but with new logic.

**Attack**: attacker (with the compromised session-key) redeems against
the new logic.

**What happens**:

- Targets match (the proxy address hasn't changed).
- New logic executes — which may be more permissive than Maria
  expected.

**Bound**: Maria's risk surface expanded without her consent. This is
inherent to upgradeable contracts; the same problem applies to any
contract a delegation points at.

**Mitigation**:

- **AllowedTargets binds the proxy ADDRESS, not the implementation
  hash**. If the user wants implementation-hash binding, a new
  `AllowedTargetWithImplHashEnforcer` could be added (`[OPEN]`,
  recommended only if implementation hash binding is needed for some
  delegation use case).
- **Caveat: `CallDataHashEnforcer`** (in tree per Phase B § discussion;
  cite `packages/contracts/src/enforcers/CallDataHashEnforcer.sol`)
  binds the specific calldata. For one-shot delegations (e.g., "pay
  exactly this $X to exactly this address"), this is the right
  enforcer. For session-scoped delegations (Variant A), it's too
  restrictive.

### 3.8 S-8: Stale delegation across a Phase A contract redeploy

**Setup**: A delegation was issued under the OLD `DelegationManager`
(pre-Phase-A, with the old factory). After Phase A, the new factory +
new AgentAccount implementation are deployed. The DelegationManager
itself may or may not be redeployed (Phase A spec doesn't redeploy it
explicitly, but its `DOMAIN_SEPARATOR` is bound to `address(this)` —
which doesn't change unless redeployed).

If DelegationManager is **NOT redeployed** (continues at the same
address): old delegations remain redeemable on-chain. The risk: if any
old delegation pointed at the old AgentAccount address, the new
AgentAccount at the new counterfactual address (per Phase A's factory
constructor changes — `phase-A-contract-role-split.md:359-371`) is a
**different account** and the old delegation cannot reach it.

If DelegationManager **IS redeployed** with Phase A: the
DOMAIN_SEPARATOR changes (new `address(this)`) → all old signatures
invalidate.

Per spec 007 § Migration + rollout (line 270-280): fresh-start re-seeds.
No prod accounts; no prod delegations.

**Bound**: this is a v1 / migration consideration, not a runtime
replay surface.

### 3.9 S-9: Attacker forces redemption AT validUntil boundary

**Setup**: A delegation with `validUntil = T`. At block `b` whose
`block.timestamp == T`, both attacker and Maria submit redemptions.

**What happens**:

- TimestampEnforcer condition is `block.timestamp > validUntil →
  revert` (cite `TimestampEnforcer.sol:28`). At `==`, **the delegation
  is STILL valid** (`!>`).
- Both transactions are processed. Whichever lands first wins; the
  other (re-)runs caveats and either succeeds or fails depending on
  caveat state.

**Bound**: standard last-block race. Not a security issue per se;
documented for completeness.

### 3.10 S-10: Replay between L1 and L2 of the same chainId family

**Setup**: Smart Agent is deployed on chain X (chainId = 1234). A
hypothetical chain Y has the same chainId (Ethereum mainnet was
chainId=1; ETC was also 1 at one point). The DelegationManager on chain
Y was deployed by a different team but happens to have the same
contract address (collision via CREATE2 with same factory salt).

**Attack**: attacker submits Maria's delegation to chain Y.

**What happens**:

- DOMAIN_SEPARATOR encodes `chainId == 1234` AND `address(this)`. If
  BOTH match across X and Y, the signature is valid on Y.
- This requires a contrived chainId collision AND a contract-address
  collision. Extremely unlikely in practice but theoretically possible.

**Bound**: not a meaningful risk in practice. EIP-155 / EIP-712
designed to handle this; the design intent is to make this combination
impossible without deliberate collision construction.

### 3.11 S-11: Salt collision

**Setup**: The `salt` field in `Delegation` is user-chosen at session-
init. If a2a-agent's session-init does not use a cryptographically
secure salt (e.g., monotonic counter or `Date.now()`), a future
delegation with the same `(delegator, delegate, caveats, salt)`
produces the same hash.

**Attack**: a2a-agent inadvertently issues delegation D2 with same hash
as a previously-revoked D1. `_revoked[hash] == true` from D1's
revocation. Maria's NEW delegation D2 fails to redeem.

**What happens**: D2 reverts with `DelegationRevoked_` on first redeem
attempt.

**Mitigation**: a2a-agent's salt MUST be cryptographically random (32
bytes from CSPRNG). Audit `apps/a2a-agent/src/routes/session-init.ts`
(when it lands per Phase B) to confirm.

**Recommendation**: Phase G CI guard that asserts session-init salts
use `crypto.randomBytes(32)` (or equivalent).

### 3.12 S-12: Session-key signing the wrong digest type

**Setup**: The session-key in Variant A signs userOp hashes (or
transaction envelopes — per § 3.2 mechanic question). What if the
session-key is induced to sign an OTHER digest that, when interpreted
as a userOp hash, looks like a valid userOp?

**Attack**: attacker presents the session-key (compromised) with a
crafted message such that `keccak256(message) == userOpHash` for a
malicious userOp. ECDSA's malleability is well-bounded; a SHA-256 /
keccak-256 second-preimage attack is computationally infeasible at the
current security level. Not a meaningful threat.

---

## 4. Bounded delegation count per user/window — RECOMMENDED ENFORCERS

The above analysis surfaces TWO classes of replay risk that no current
enforcer addresses:

1. **Per-user delegation issuance rate** — if a user's EOA is leaked
   (A4), an attacker can flood the system with new delegations until
   the user notices. Each delegation, while individually bounded, adds
   compounding blast radius.

2. **Per-delegation redemption count** — within a single delegation's
   window, the redemption count is bounded only by the caveat
   composition. A `RateLimitEnforcer` is in tree
   (`packages/contracts/src/enforcers/RateLimitEnforcer.sol`) and
   reviewers should audit its semantics, but a `MaxActionsPerPeriodEnforcer`
   with explicit caveat-bound count is recommended for clarity.

### 4.1 `MaxDelegationsPerPeriodEnforcer` — proposal

**Goal**: cap how many delegations a user's `AgentAccount` can have
ACTIVE within a sliding window. Critical when a user EOA leak is
discovered (cap blast radius before revocation can be deployed
account-wide).

**Shape**:

This caveat is unusual — it's a per-delegator-account budget, not a
per-delegation budget. The mechanic:

- The user's `AgentAccount` (or a side-contract that tracks
  per-account delegation issuance) maintains a counter.
- Each new delegation that the user signs MUST be paired with an
  on-chain pre-registration call: e.g., `MaxDelegationsRegistry.registerIssued(delegationHash)`.
- The `MaxDelegationsPerPeriodEnforcer.beforeHook` reads the registry
  to assert the delegator's issuance rate is below the threshold.

**API sketch**:

```solidity
// packages/contracts/src/enforcers/MaxDelegationsPerPeriodEnforcer.sol
contract MaxDelegationsPerPeriodEnforcer is ICaveatEnforcer {
    /// @dev terms = abi.encode(address registry, uint256 windowSeconds, uint256 maxCount)
    error TooManyDelegationsInWindow();

    function beforeHook(
        bytes calldata terms,
        bytes calldata,
        bytes32,
        address delegator,
        address,
        address,
        uint256,
        bytes calldata
    ) external view override {
        (address registry, uint256 windowSeconds, uint256 maxCount) =
            abi.decode(terms, (address, uint256, uint256));
        uint256 count = IDelegationIssuanceRegistry(registry)
            .countIssuedSince(delegator, block.timestamp - windowSeconds);
        if (count > maxCount) revert TooManyDelegationsInWindow();
    }

    function afterHook(...) external pure override {}
}
```

**Storage**: a new singleton `DelegationIssuanceRegistry` tracks
per-delegator issuance.

**Foundry test plan**:

```solidity
// packages/contracts/test/MaxDelegationsPerPeriodEnforcer.t.sol
function test_AllowsUpToLimit() public {
    // User issues 5 delegations under a maxCount=5 cap. Each enforces OK.
}

function test_RejectsBeyondLimit() public {
    // User issues 6th delegation; beforeHook reverts.
}

function test_WindowSlides() public {
    // User issues 5 delegations, waits windowSeconds, issues a 6th. OK.
}

function test_PerAccountIsolation() public {
    // Maria and Bob each at their own caps; one's count does not affect the other.
}
```

**Trade-off**: requires an extra on-chain tx per session-init to
register the issuance (gas cost), and a new singleton contract.
Recommended for ENV_PROD deployments where issuance-rate anomaly
detection matters; OPTIONAL for dev / demo.

### 4.2 `MaxActionsPerPeriodEnforcer` — proposal

**Goal**: cap how many redemptions a SINGLE delegation can be redeemed
within a sliding window. Addresses S-1 + S-6 above.

**Shape**:

```solidity
// packages/contracts/src/enforcers/MaxActionsPerPeriodEnforcer.sol
contract MaxActionsPerPeriodEnforcer is ICaveatEnforcer {
    /// @dev terms = abi.encode(uint256 windowSeconds, uint256 maxCount)
    /// @dev args  = bytes32 windowKey (e.g., delegation hash; binds the budget to this delegation)
    error TooManyActionsInWindow();

    mapping(bytes32 => uint256[]) private _actionTimestamps;
    // (windowKey, ordered list of action timestamps within the window)

    function beforeHook(
        bytes calldata terms,
        bytes calldata args,
        bytes32 delegationHash,
        address,
        address,
        address,
        uint256,
        bytes calldata
    ) external override {
        (uint256 windowSeconds, uint256 maxCount) = abi.decode(terms, (uint256, uint256));
        bytes32 windowKey = args.length > 0 ? abi.decode(args, (bytes32)) : delegationHash;

        // Prune timestamps older than (now - windowSeconds).
        uint256[] storage ts = _actionTimestamps[windowKey];
        uint256 cutoff = block.timestamp - windowSeconds;
        uint256 keep = 0;
        for (uint256 i = 0; i < ts.length; i++) {
            if (ts[i] >= cutoff) {
                if (i != keep) ts[keep] = ts[i];
                keep++;
            }
        }
        // Truncate storage (delete tail).
        while (ts.length > keep) ts.pop();

        // Check pre-increment count.
        if (ts.length >= maxCount) revert TooManyActionsInWindow();

        // Record this action.
        ts.push(block.timestamp);
    }

    function afterHook(...) external pure override {}
}
```

**Note**: this is stateful and has a `beforeHook` that mutates storage.
The existing `TimestampEnforcer` / `ValueEnforcer` /
`AllowedTargetsEnforcer` / `AllowedMethodsEnforcer` are all pure /
view-only. Mutating-state enforcers exist in tree
(`RateLimitEnforcer.sol`); review that contract for the canonical
pattern before re-implementing. The recommendation is to USE
RateLimitEnforcer if its semantics match; only add
`MaxActionsPerPeriodEnforcer` if RateLimitEnforcer can't express the
"max N per sliding window" shape.

**Foundry test plan**:

```solidity
// packages/contracts/test/MaxActionsPerPeriodEnforcer.t.sol
function test_AllowsUpToLimit() public {
    // Delegate redeems N times under maxCount = N. All succeed.
}

function test_RejectsNplusOne() public {
    // Delegate redeems N+1 times; the (N+1)th reverts with TooManyActionsInWindow.
}

function test_WindowSlides() public {
    // Delegate redeems N times, waits windowSeconds, redeems again. The
    // late call succeeds because earlier timestamps were pruned.
}

function test_RestrictsToDelegationKey() public {
    // Two delegations with same enforcer instance; one's budget does
    // not leak into the other (windowKey differs).
}
```

**Trade-off**: gas cost grows linearly with the number of actions in
the window (due to the pruning loop). For windows with high N, consider
a circular-buffer storage layout.

### 4.3 Caveat composition guidance

Recommended Variant A caveat sets per risk tier:

**Low-risk (vote, comment, view)**:
- TimestampEnforcer(now, now+3600)
- AllowedTargetsEnforcer([VoteRegistry, CommentRegistry])
- AllowedMethodsEnforcer([cast, comment])
- ValueEnforcer(0)
- MaxActionsPerPeriodEnforcer(3600, 50)  // ≤ 50 actions per hour

**Medium-risk (small treasury, pool actions)**:
- TimestampEnforcer(now, now+3600)
- AllowedTargetsEnforcer([Treasury])
- AllowedMethodsEnforcer([transfer])
- ValueEnforcer(perCallMax)
- AllocationLimitEnforcer(cumulativeMax)
- MaxActionsPerPeriodEnforcer(3600, 5)  // ≤ 5 actions per hour

**High-risk (large treasury, ownership changes)**: USE VARIANT B. Per
spec 007 risk-tier registry, high-risk delegations are on-chain
registered, not off-chain. Caveat composition is moot.

---

## 5. On-chain revocation gap analysis

This is the most consequential gap in Variant A and deserves a
dedicated section.

### 5.1 The gap

Per spec 007 `phase-B-a2a-signer-model.md:128-129` and the demo
revocation test at `:254-258`:

> Variant A: a session's revocation epoch is incremented in person-mcp's
> `revocation_epochs` table. The next `/onchain-redeem` call rejects with
> 401 before any userOp is built.

This places revocation OFF-CHAIN — in person-mcp's database, consulted
by a2a-agent before submission.

`DelegationManager` only consults its on-chain `_revoked` mapping
(`DelegationManager.sol:50`, `:134`):

```solidity
function _validateDelegation(
    Delegation[] calldata delegations,
    uint256 i
) internal {
    Delegation calldata d = delegations[i];
    bytes32 dHash = hashDelegation(d);

    // Check not revoked
    if (_revoked[dHash]) revert DelegationRevoked_();
    ...
}
```

`_revoked[dHash]` is set ONLY by `revokeDelegation` (`:98-101`), which
is an explicit on-chain call. The off-chain revocation list in
person-mcp is INVISIBLE to the contract.

**Threat scenario**: an attacker who bypasses a2a-agent (submits the
redemption tx directly via any bundler, or via a direct
`DelegationManager.redeemDelegation` call from the session-key EOA)
also bypasses the off-chain revocation check. The redemption succeeds
on chain.

### 5.2 Why this is a real threat

Consider C1 A6 (full KMS compromise): the attacker has master + bundler
+ session-issuer keys + KMS Decrypt. They can:

1. Read every encrypted session package (KMS Decrypt grant).
2. Extract every session-key (decrypted).
3. Hold them indefinitely while users believe their sessions are
   compromised and have been "revoked" via the app UI.

The off-chain `revocation_epochs` only blocks redemptions THROUGH
a2a-agent. The attacker bypasses a2a-agent. They redeem directly. **The
off-chain revocation provides zero protection against this adversary.**

This is a **load-bearing residual risk** that the spec text downplays.
Reviewer should flag it as a P1 finding.

### 5.3 Options

#### Option A — AgentAccount's `validateUserOp` consults person-mcp before approving

**Mechanic**: AgentAccount's `_validateSig` or a wrapper makes a
cross-domain call to person-mcp to check revocation status.

**Why this is BAD**:

- Introduces off-chain trust IN the validation path. The contract now
  trusts an off-chain HTTP response — that's a P-classified violation
  of the substrate-independence principle and of "no unsigned trust
  boundaries" (Goal #3).
- Latency: every userOp now requires a cross-domain RPC.
- Reentrancy / oracle pattern adds complexity.

**Verdict**: REJECT.

#### Option B — On-chain `_revoked` mapping (the existing one) is the authoritative source; off-chain `revocation_epochs` is REMOVED

**Mechanic**: when the user clicks "revoke session" in the UI, the app
submits a userOp that calls `DelegationManager.revokeDelegation(hash)`.
This is a real on-chain transaction; gas cost is sponsored by the
paymaster.

**Pros**:

- Authoritative. No bypass possible.
- Aligned with the substrate-independence principle.

**Cons**:

- Gas cost per revocation. Sponsored gas is a paymaster surface
  consideration.
- Latency: revocation isn't effective until the tx is mined (~12s on
  mainnet, instant on anvil). For an immediate-revocation UX, this is
  noticeable.

**Verdict**: this is the **architecturally correct answer**.

#### Option C — Hybrid: on-chain revocation registry for Variant A; the on-chain delegation itself can be revoked for Variant B

**Mechanic**: same as Option B, but the revocation tx is bundled with
the session-revoke UX flow. For Variant B, the existing
`DelegationManager.revokeDelegation` covers it; for Variant A, the
same function applies since both variants use DelegationManager.

**Verdict**: this collapses to Option B.

### 5.4 Recommendation

**ADOPT OPTION B**. Remove the `revocation_epochs` table OR repurpose
it as a UX-cache only (with the caveat that the table is NEVER
authoritative — the on-chain `_revoked` mapping is). Update spec 007
Phase B § 4 to reflect that the revoke flow is an on-chain transaction.

Cost analysis:

- One `DelegationManager.revokeDelegation` call: ~50k gas at L1 prices.
  Sponsored by the paymaster.
- For sessions that "naturally" expire (TimestampEnforcer's
  validUntil), no explicit revoke is needed; the on-chain enforcer
  handles it.
- For sessions the user proactively revokes, one tx per revoke. Typical
  user might revoke 0-2 sessions per month → trivial gas budget.

Update to `phase-B-a2a-signer-model.md:128-129` recommended:

> Variant A revocation: an on-chain `DelegationManager.revokeDelegation`
> call. Submitted via a userOp signed by the user's owner. Paymaster
> sponsorship covers the gas. The off-chain `revocation_epochs` table
> (if retained) is a UX cache only — the on-chain mapping is
> authoritative.

### 5.5 Open question: who signs the revoke userOp?

`DelegationManager.revokeDelegation` (`DelegationManager.sol:98-101`)
does NOT today gate on the delegator — anyone can call it for any
hash:

```solidity
function revokeDelegation(bytes32 delegationHash) external {
    _revoked[delegationHash] = true;
    emit DelegationRevoked(delegationHash);
}
```

This is intentional for permissionless revocation in some delegation
patterns, but it means anyone can revoke anyone's delegations as a DoS
vector. If we adopt Option B, we should **gate revocation on
`msg.sender == delegator OR msg.sender == delegate`** (allowing both
the user and the session-key to revoke). The session-key path is useful
for "self-revoke on detected compromise from the session-key side".

Recommendation: add the gate. Foundry test plan:

```solidity
function test_RevokeAllowedByDelegator() public {
    // Maria (via her AgentAccount) revokes her delegation. OK.
}

function test_RevokeAllowedByDelegate() public {
    // Session-key K revokes its own delegation. OK.
}

function test_RevokeRejectedByThirdParty() public {
    // Bob tries to revoke Maria's delegation. Reverts.
}
```

This is a **CHANGE to existing contract behaviour** and should be
called out as a backwards-incompatible change in the spec amendment.

---

## 6. Test plan

The following Foundry + integration tests cover the replay scenarios
above. Tests are listed by file; reviewers should map each to a
specific scenario number from § 3.

### 6.1 Foundry tests — `packages/contracts/test/VariantAReplay.t.sol`

```solidity
// S-1: replay within window with no rate limit — succeeds (current
// behaviour; documents the lack of bound).
function test_S1_ReplayWithinWindow_Succeeds() public { ... }

// S-1 with MaxActionsPerPeriodEnforcer attached — bounded.
function test_S1_ReplayWithinWindow_BoundedByMaxActions() public { ... }

// S-2: after off-chain revoke (simulated by NOT calling on-chain
// revoke), replay succeeds — DOCUMENTS the gap.
function test_S2_OffChainRevokeDoesNotBlockOnChainReplay() public { ... }

// S-2 with on-chain revoke (Option B) — replay reverts.
function test_S2_OnChainRevokeBlocksReplay() public { ... }

// S-3: chainId binding — sig from chain A invalid on chain B.
function test_S3_ChainIdBinding() public { ... }

// S-5: cross-session replay impossible (delegate mismatch).
function test_S5_CrossSessionReplayRejected() public { ... }

// S-9: validUntil boundary inclusive.
function test_S9_ValidUntilBoundaryInclusive() public { ... }

// S-11: salt collision detection.
function test_S11_DistinctSaltsProduceDistinctHashes() public { ... }
```

### 6.2 Integration tests — `apps/a2a-agent/__tests__/phase-b-variant-a-replay.integration.test.ts`

```ts
// End-to-end Variant A: sign delegation → store in person-mcp →
// redeem at a2a-agent → on-chain execution.
test('S-1 e2e: redemption within window succeeds')

// Off-chain revoke followed by attacker-direct redemption.
test('S-2 e2e: off-chain revoke does not block direct chain submission')

// User compromise detection: after off-chain revoke, on-chain revoke
// must also be submitted to fully close.
test('Option B: on-chain revoke closes both gaps')
```

### 6.3 Property tests — `packages/contracts/test/VariantAReplay.property.t.sol`

```solidity
// For any (delegator, delegate, caveats, salt), no permutation of
// session-key + msg.sender that doesn't match delegate ever validates.
function property_DelegateBoundToMsgSender(...) public { ... }

// For any caveat set, the redemption is rejected if any single caveat
// reverts in beforeHook.
function property_AnyCaveatFailureReverts(...) public { ... }
```

---

## 7. Open questions surfaced

| # | Question | Recommendation |
|---|---|---|
| C2-Q1 | What is the actual mechanic by which a session-key redeems a Variant A delegation? Is the inner userOp signed by the session-key (against the AgentAccount, which doesn't have the key in `_owners`)? Or is the redemption a direct Ethereum tx with the session-key as `msg.sender` against DelegationManager? Spec 007 Phase B is ambiguous. | Lock the mechanic in Phase B implementation. Recommend mechanic (b) — direct ECDSA-signed transaction with `msg.sender = session-key`, calling `DelegationManager.redeemDelegation`. This is the ERC-7710 / DeleGator canonical pattern. The bundler-relay flow becomes "session-key signs the tx; bundler is the gas-paying account that wraps it (e.g., via a meta-tx relayer or direct call from a bundler EOA — but the delegate check still fires against the recovered tx signer)". This needs careful design. |
| C2-Q2 | On-chain vs off-chain revocation (§ 5). | ADOPT OPTION B. Update spec 007 Phase B § 4. |
| C2-Q3 | `DelegationManager.revokeDelegation` is currently permissionless. | Gate on `msg.sender == delegator OR msg.sender == delegate`. Backwards-incompatible change; flag in amendment. |
| C2-Q4 | Add `MaxActionsPerPeriodEnforcer` to the standard caveat set for medium-risk delegations. | Add to spec 007 Phase B caveat composition guidance. |
| C2-Q5 | Add `MaxDelegationsPerPeriodEnforcer` for per-user issuance rate limiting. | Optional v1; consider for prod deployment. |
| C2-Q6 | Salt generation in `session-init.ts` must use CSPRNG. | Phase G CI guard. |
| C2-Q7 | TOCTOU on upgradeable target contracts (S-7). | Document the limitation. For high-stakes delegations, prefer `CallDataHashEnforcer` over `AllowedTargets`. |

---

*End of C2.*
