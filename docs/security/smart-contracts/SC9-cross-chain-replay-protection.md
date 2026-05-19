# SC9 — Cross-Chain Replay Protection Audit

> **Status**: Draft, ready to execute. Foundry tests + audit in one
> 1-2 week sprint.
> **Audience**: developer (executor), security lead (signoff).
> **Document type**: Internal audit + implementation spec (Foundry test
> additions).
> **Pairs with**: `docs/security/cryptographic-posture/C2-replay-analysis-variant-a.md`
> (its scope is one specific session-replay surface; this doc audits
> every signed-message path in the system for **cross-chain** replay).
> **Prerequisite**: Phase A landed.

---

## 1. Threat

A signature valid on chain A is replayed on chain B. If both chains
host the same contract addresses (possible via CREATE2 with same
salts + bytecode), an attacker can:

- Drain funds on chain B that the user thought were only authorized
  on chain A.
- Issue a delegation on a test chain (where they own / control all
  state), then replay it to the production chain.
- After a chain fork (e.g. ETH/ETC-style divergence), replay legacy
  signatures on the fork.

The mitigation is well-known: bind every signed message to the
chainId. The audit is: have we done this **everywhere**?

This document enumerates every signed-message path, confirms its
chainId binding, and identifies any gap.

---

## 2. Inventory of signed-message paths

### 2.1 ERC-4337 userOp signature

- **What is signed**: the `userOpHash` computed by the EntryPoint.
- **Where**: `EntryPoint.getUserOpHash` (in
  `lib/account-abstraction/contracts/core/EntryPoint.sol`); the
  EntryPoint includes its OWN address + chainId in the hash.
- **Cite**: EntryPoint v0.7 / v0.8 source (search for
  `block.chainid` in `account-abstraction/EntryPoint.sol`).
- **Binding**: ✅ chainId bound (EntryPoint owns this).
- **Verdict**: SAFE. Cross-chain replay impossible.

### 2.2 Delegation signature (DelegationManager EIP-712)

- **What is signed**: the EIP-712 hash over `Delegation`.
- **Where**: `DelegationManager.sol:60-69` constructs
  `DOMAIN_SEPARATOR`:
  ```solidity
  DOMAIN_SEPARATOR = keccak256(
      abi.encode(
          keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
          keccak256("AgentDelegationManager"),
          keccak256("1"),
          block.chainid,                  // chainId
          address(this)                    // verifyingContract
      )
  );
  ```
- **Binding**: ✅ chainId bound via EIP-712 domain.
- **Verdict**: SAFE.

### 2.3 ERC-1271 signature validation (smart-account)

- **What is signed**: arbitrary `bytes32 hash` — the **caller**
  supplies the hash.
- **Where**: `AgentAccount.isValidSignature` (`AgentAccount.sol:719-732`).
- **Binding**: The hash itself is opaque to AgentAccount. Cross-chain
  replay safety depends entirely on the CALLER having pre-bound
  chainId into the hash.
  - When called via DelegationManager: ✅ DelegationManager binds
    chainId (§2.2).
  - When called via custom flows: ⚠️ depends on caller.
- **Verdict**: SAFE-IF-CALLER-COMPLIES. Audit gap: any direct caller
  of `isValidSignature` MUST bind chainId itself.

### 2.4 UUPS upgrade authorization

- **What is signed**: per Phase A:
  ```solidity
  bytes32 digest = keccak256(
      abi.encode(
          bytes32("UPGRADE"),
          newImpl,
          address(this),
          block.chainid                    // <-- chainId
      )
  );
  ```
- **Cite**: `AgentAccount.sol:216-232`.
- **Binding**: ✅ chainId bound directly in the digest.
- **Verdict**: SAFE.

### 2.5 Bundler envelope signature

- **What is signed**: per Phase A:
  ```solidity
  bytes32 envelopeDigest = keccak256(
      abi.encode(
          bytes32("BUNDLER_ENVELOPE"),
          userOpHash,
          address(this),
          block.chainid                    // <-- chainId
      )
  );
  ```
- **Cite**: `AgentAccount.sol:358-385`.
- **Binding**: ✅ chainId bound.
- **Verdict**: SAFE.

### 2.6 Session authorization (Variant B session delegation hash)

- **What is signed**: the user signs a userOp that calls
  `acceptSessionDelegation(sessionDelegationHash)`. The userOp is
  validated via the standard ERC-4337 path.
- **Cite**: `AgentAccount.sol:311-317`.
- **Binding**:
  - The userOp signature: ✅ chainId-bound via EntryPoint.
  - The `sessionDelegationHash` itself is opaque; its construction
    MUST bind chainId.
  - **Per spec 007 Phase A § Open Questions Q1**: the EIP-712
    domain separator for session-issuer signing is on the
    AgentAccount itself, with `chainId` included. ✅
- **Verdict**: SAFE-IF-HASH-CONSTRUCTOR-COMPLIES. [OWE-REVIEWER]
  Audit the off-chain hash constructor in
  `apps/a2a-agent/src/routes/session-init.ts` or wherever the
  session delegation hash is built. Verify chainId presence.

### 2.7 Approved-hash registration (`ApprovedHashRegistry`)

- **What is signed**: an account pre-approves a hash by calling
  `approveHash(bytes32)`. No signature; it's a tx.
- **Verdict**: N/A. Not a signature path; chainId binding via the
  tx's natural chain-binding.

### 2.8 Class-assertion observer signatures (off-chain)

- **What is signed**: class-assertion observers (e.g.
  `AgentAssertion`, `ClassAssertion`) typically have an off-chain
  attestor that signs claim payloads. Pre-Phase-C this is the
  Deployer EOA.
- **Where**: `apps/web/src/lib/onchain/*Assertion.ts` (web-side).
- **Binding**: ⚠️ depends on the assertion's content payload
  including chainId.
- [OWE-REVIEWER] **Audit gap**: enumerate every class-assertion
  payload schema and verify chainId presence. Plan: this is part
  of SC9 audit work below.

### 2.9 KMS audit-log signatures

- **What is signed**: KMS service signatures over audit log
  entries (per `output/KMS-IMPLEMENTATION-PLAN.md` Phase K7).
- **Binding**: ✅ Per the KMS plan, audit log entries include
  request context (account, tx hash, chainId).
- **Verdict**: SAFE. Out of contract-audit scope; covered by KMS
  plan.

### 2.10 AnonCreds presentations

- **What is signed**: AnonCreds Camenisch-Lysyanskaya signatures
  over credential attribute commitments.
- **Binding**: AnonCreds proofs don't natively bind chainId.
  Replay protection is via nullifier (each proof generates a
  unique nullifier per request).
- **Verdict**: SAFE BY DIFFERENT MECHANISM. Cross-chain replay of an
  AnonCreds proof is bounded by the nullifier set being per-issuer,
  per-credential, per-attribute. The nullifier is registered on
  chain in `CredentialRegistry`.
- [OWE-REVIEWER] Verify `CredentialRegistry` nullifier set is
  per-chain (i.e., nullifiers from chain A are NOT recognized on
  chain B). Plan: each chain's CredentialRegistry instance has its
  own state — natural binding.

### 2.11 ERC-6492 envelope (counterfactual signature)

- **What is signed**: a signature over a hash by a contract that
  may not yet be deployed. The envelope includes deploy-data; if
  the account isn't deployed, the validator deploys it and then
  validates.
- **Where**: `AgentAccount.isValidSignature` strips the envelope
  (`AgentAccount.sol:719-732`).
- **Binding**: the inner signature is whatever the user signed —
  inherits the inner sig's chainId binding. The envelope itself
  doesn't add a chainId binding.
- **Verdict**: SAFE-IF-INNER-COMPLIES (same as §2.3).

### 2.12 Passkey assertion (WebAuthn P-256)

- **What is signed**: a WebAuthn assertion. The `clientDataJSON`
  includes `origin` (RP ID, e.g. `https://app.smart-agent.example`).
  ChainId is NOT in the standard WebAuthn assertion.
- **Where**: `AgentAccount._verifyWebAuthn`
  (`AgentAccount.sol:791-797`).
- **Binding**: ⚠️ WebAuthn assertions bind the RP origin but NOT
  chainId.
- **Replay scenario**:
  - The user signs a userOp via WebAuthn on chain A.
  - Attacker captures the WebAuthn assertion.
  - On chain B (different chainId), attacker replays the
    assertion against a different `userOpHash`.
  - For this to succeed: the userOpHash on B must equal the
    userOpHash on A. EntryPoint binds chainId into userOpHash, so
    the hashes differ; the WebAuthn signature does not validate.
- **Verdict**: SAFE BY INDIRECTION. The WebAuthn signature is over
  the userOpHash (which binds chainId via EntryPoint). Cross-chain
  replay requires hash collision — not feasible.
- [OWE-REVIEWER] Confirm: WebAuthn signs over `userOpHash`
  (which IS chainId-bound) and NOT over an attacker-controlled
  payload. Verify in `WebAuthnLib.verify` (`packages/contracts/src/libraries/WebAuthnLib.sol`).

### 2.13 Deployer EOA signatures (legacy)

- **What is signed**: pre-Phase-C, the deployer EOA signs:
  - Class-assertion attestations.
  - Boot-seed observer payloads.
  - Stateless passkey-SIWE auth fallback (`apps/web/src/lib/ssi/signer.ts:48-50`).
- **Binding**: ⚠️ depends on payload schema.
- [OWE-REVIEWER] **Same audit gap as §2.8**. Enumerate every
  deployer-EOA signing payload schema and verify chainId presence.

### 2.14 Service-to-service MAC

- **What is signed**: master signer MACs inter-service messages.
- **Binding**: per the cryptographic-posture C1, MAC payloads
  include service identifier + audience + nonce + request body.
- **Cross-chain risk**: not applicable; MACs are off-chain
  service auth. ChainId not relevant.

### 2.15 Recovery messages

- **What is signed**: `RecoveryEnforcer` requires a recovery
  attestation. Reviewing the enforcer's terms format:
- **Where**: `packages/contracts/src/enforcers/RecoveryEnforcer.sol`.
- [OWE-REVIEWER] Audit recovery payload schema for chainId.

---

## 3. Summary table

| # | Path | ChainId binding | Verdict |
|---|---|---|---|
| 2.1 | ERC-4337 userOp | EntryPoint domain | SAFE |
| 2.2 | Delegation (EIP-712) | DOMAIN_SEPARATOR | SAFE |
| 2.3 | ERC-1271 | Inherited from caller | SAFE-IF-CALLER-COMPLIES |
| 2.4 | UUPS upgrade auth | Explicit in digest | SAFE |
| 2.5 | Bundler envelope | Explicit in digest | SAFE |
| 2.6 | Variant B session | Off-chain hash (verify) | SAFE-IF-HASH-COMPLIES |
| 2.7 | Approved-hash | N/A (tx) | N/A |
| 2.8 | Class-assertion (legacy) | Depends on payload | UNVERIFIED |
| 2.9 | KMS audit log | Per KMS plan | SAFE |
| 2.10 | AnonCreds presentation | Per-chain nullifier set | SAFE |
| 2.11 | ERC-6492 envelope | Inherited from inner sig | SAFE-IF-INNER-COMPLIES |
| 2.12 | WebAuthn passkey | Via userOpHash | SAFE |
| 2.13 | Deployer EOA (legacy) | Depends on payload | UNVERIFIED |
| 2.14 | Service MAC | N/A (off-chain) | N/A |
| 2.15 | Recovery attestation | Verify enforcer | UNVERIFIED |

**Three UNVERIFIED entries** to close in this audit:

- 2.8 / 2.13: class-assertion + deployer-EOA legacy paths.
- 2.6: Variant B session delegation hash.
- 2.15: recovery attestation.

---

## 4. Foundry test plan

Place under `packages/contracts/test/CrossChainReplay.t.sol`.

### 4.1 Test fixture: chain switch

```solidity
contract CrossChainReplayTest is Test {
    AgentAccount account;
    DelegationManager dm;
    uint256 constant CHAIN_A = 1;        // mainnet
    uint256 constant CHAIN_B = 137;      // polygon
    uint256 currentChain;

    function setUp() external {
        vm.chainId(CHAIN_A);
        // Deploy contracts ...
        // Sign a delegation as "chain A"
        currentChain = CHAIN_A;
    }
}
```

### 4.2 Test cases

1. **`test_DelegationSignedOnChainA_FailsOnChainB`** — sign a
   delegation with `vm.chainId(CHAIN_A)`; warp to
   `vm.chainId(CHAIN_B)`; deploy a fresh DelegationManager on
   "chain B" at the same address (CREATE2); attempt to redeem.
   Expected: `InvalidSignature`.

2. **`test_UpgradeAuthOnChainA_FailsOnChainB`** — sign an upgrade
   authorization on chain A; switch chains; attempt to use the
   same sig on a fresh AgentAccount at the same address on chain
   B. Expected: `NotOwnerSig`.

3. **`test_BundlerEnvelopeOnChainA_FailsOnChainB`** — sign a
   bundler envelope on chain A; switch; attempt to verify on a
   chain-B AgentAccount instance. Expected: `NotBundler`.

4. **`test_VariantB_SessionDelegationHash_ChainSpecific`** —
   verify the off-chain hash constructor includes chainId; same
   hash on chain B differs from chain A.

5. **`test_UserOp_ChainSpecific`** — sign a userOp on chain A;
   submit to chain B's EntryPoint at the same address. Expected:
   EntryPoint rejects (signature mismatch).

6. **`test_PasskeyAssertion_TiedToChainViaUserOpHash`** — sign a
   WebAuthn assertion over a chain-A userOpHash; attempt to use
   it for a chain-B userOp. Expected: rejection due to userOpHash
   difference.

### 4.3 Property tests

7. **`property_NoSignatureValidatesOnAnyOtherChain`** —
   parametric: for any sig generated on chainId X, validation on
   any chainId Y ≠ X reverts.

8. **`property_DOMAIN_SEPARATOR_IsChainSpecific`** — fresh
   DelegationManager at chain Y has a different DOMAIN_SEPARATOR
   than at chain X.

---

## 5. Class-assertion + deployer-EOA legacy audit

For each class-assertion observer:

1. Read the source: `apps/web/src/lib/onchain/<X>Assertion.ts`.
2. Identify the payload schema being signed.
3. Verify chainId presence.
4. If absent: file as P0 finding; add chainId; redeploy with new
   schema version.

Targets:

- `AgentAssertion.ts`
- `ClassAssertion.ts`
- Any other `*Assertion.ts` under `apps/web/src/lib/onchain/`.

For the deployer-EOA signatures in `apps/web/src/lib/ssi/signer.ts`:

1. Verify the signed payload schema.
2. Confirm chainId binding.

---

## 6. Recovery attestation audit

For `RecoveryEnforcer`:

1. Read the source.
2. Identify what's signed (terms format).
3. Verify chainId binding.
4. If absent: extend the schema; coordinate with any in-flight
   recovery configurations (likely none in v1).

---

## 7. Variant B session delegation hash audit

Find the off-chain code that constructs `sessionDelegationHash`:

```
$ grep -rn 'sessionDelegationHash\|acceptSessionDelegation' apps/ packages/
```

Verify:

1. The hash includes `block.chainid` (or the equivalent at
   construction time).
2. The user signs over the hash, not over a chainId-naked payload.
3. EIP-712 domain (if used) includes chainId.

---

## 8. Documentation gap closure

If any P0 finding from §5-7:

- Document the finding in this file.
- Patch the contract / TS code.
- Add a Foundry test (§4) that proves the patch.
- Re-run the full SC9 test suite.

If no findings: this section remains empty AND that's the
verdict; we have replay protection across every signed path.

---

## 9. Mitigation if a gap is found

Standard pattern: extend the signed payload to include chainId.

For class-assertion observers:

- Old schema: `keccak256(abi.encode(subject, claim, timestamp))`.
- New schema: `keccak256(abi.encode(subject, claim, timestamp,
  block.chainid))`.

For recovery enforcer:

- Old schema: `keccak256(abi.encode(account, newOwner, validAt))`.
- New schema: `keccak256(abi.encode(account, newOwner, validAt,
  block.chainid))`.

The new schema breaks compatibility with old signatures. For each
finding:

1. Coordinate with users with active sessions to re-issue.
2. Bump schema version.
3. Document the version transition.

---

## 10. Risks

| # | Risk | Mitigation |
|---|---|---|
| C1 | A path we did NOT enumerate is unbound. | Auditor (SC1) is asked to enumerate every signed path independently and cross-check. |
| C2 | We add a new signed path in the future and forget the binding. | Coding convention: every signing utility lives in a `crypto/` directory with a `chainId` parameter required. Lint rule: any `keccak256(abi.encode(...))` that returns to a sig path must include `block.chainid` or `chainId`. |
| C3 | A test chain (fork) has the SAME chainId as a prod chain. | Defensive: chainId is a 32-byte parameter; collision is not accidental. We do not fork to a same-chainId test environment. |
| C4 | EIP-1559 / EIP-7702 changes alter chainId semantics. | Monitor EIP standards; re-audit if any change. |
| C5 | Cross-chain bridge introduces a state-replay surface independent of signature. | Out of scope for this audit; SC1 considers bridges if applicable. We do not have any bridge integration in v1. |

---

## 11. Acceptance criteria

SC9 is complete when ALL of:

- [ ] Inventory §2 is complete; every signed path enumerated.
- [ ] All UNVERIFIED entries in §3 are RESOLVED with a verdict.
- [ ] Foundry test suite in §4 passes.
- [ ] Any P0 finding from §5-7 patched and tested.
- [ ] Lint rule for §10 C2 added to CI.
- [ ] SC1 auditor has reviewed the inventory.

---

## 12. Open questions

1. [OWE-REVIEWER] Variant B sessionDelegationHash — find the
   constructor and audit.
2. [OWE-REVIEWER] Class-assertion + deployer-EOA payload schemas —
   audit each.
3. [OWE-REVIEWER] Recovery attestation schema — audit.
4. Will we deploy on multiple chains in v1? Plan: no (one chain at
   v1; the cross-chain audit is forward-looking). Replay surface
   becomes real only when we deploy on chain N+1.
5. EIP-7702 implications (delegate auth from EOA): if/when EIP-7702
   lands and we adopt, re-audit.

---

## 13. Next actions

1. Developer: implement §4 Foundry test suite. Estimated 2-3 days.
2. Developer: §5-7 source audits. Estimated 2 days.
3. Security lead: review and sign off.
4. After SC1 audit completes: cross-check inventory.
