# Spec 005 — Threat Model

> **Owner**: Security agent.
> **Bound to**: `plan.md`, `contracts.md`.
> **Principle**: P4 — sensitive ops require exact-call sub-delegation.

## Asset model

| Asset | Value-at-risk | Where it lives |
|---|---|---|
| Personal treasury USDC | Dev: $0 (MockUSDC); Prod: real | AgentAccount balance |
| Pool treasury USDC | Dev: $0; Prod: real | AgentAccount balance |
| Pledge commitment record | reputational | `PledgeRegistry` |
| Settlement aggregates | accounting | `PledgeRegistry` per-token |
| Evidence document | varies (receipts, bank statements) | `org-mcp.evidence_blobs` |
| Identity ↔ treasury link | privacy (linkable by design in v1) | `sa:hasPersonalTreasury` on chain |

## Trust boundaries

```
[ Anvil dev chain ] ←─── trust boundary ───→ [ web (Next.js) ]
        ↑                                            ↓
[ AgentAccount + PledgeRegistry + USDC ]    [ org-mcp / person-mcp ]
        ↑                                            ↑
        └─── trust boundary (delegation chain validates msg.sender) ──┘
```

- Chain is trusted as ground-truth.
- Web is semi-trusted (it can lie about UI state but cannot forge on-chain calls without a valid delegation).
- MCPs are trusted within their tenant (org-mcp trusts the org's principal; person-mcp trusts the person).
- User is trusted only with their own assets (treasury). User cannot forge an admin's mark-paid.

## Threats + mitigations

### T1. Donor forges `recordHonor` without underlying transfer

**Threat**: Donor signs a delegation that calls `PledgeRegistry.recordHonor` directly (skipping `USDC.transfer`), inflating their honored amount without paying.

**Mitigations**:

1. **executeBatch atomic semantics**: the `recordHonor` call lives inside an `executeBatch` whose first call is `USDC.transfer(pool, amount)`. If the transfer reverts (insufficient balance), the whole batch reverts.
2. **CallDataHashEnforcer pinning**: the sub-delegation pins the *exact* `executeBatch` calldata hash. The donor can't substitute different inner calls.
3. **AllowedMethodsEnforcer**: scoped to `executeBatch` selector only — `recordHonor` cannot be called as a standalone delegated tx.
4. **AllowedTargetsEnforcer**: scoped to the donor's own treasury address.

Result: a donor cannot record a phantom honor — the underlying USDC transfer must succeed in the same tx, anchored by the calldata hash.

**Residual risk**: a donor who already controls the pool's `poolAgent` (i.e. is also pool admin) could `markPaid` themselves with a fake evidence hash. That's the admin-attestation rail trust model — reputational, not cryptographic.

---

### T2. Pool admin double-counts

**Threat**: Pool admin calls `markPaid` for a payment that was already recorded via `recordHonor`, double-counting the settled amount.

**Mitigations**:

1. **Separate cumulative counters**: `pledgeHonoredAmount[token]` and `pledgeExternallyPaidAmount[token]` are different storage keys. Each `recordHonor` only increments the "honored" counter; each `markPaid` only increments the "externalPaid" counter.
2. **SHACL bound** (registry-enforced): on every write, `(honored + externalPaid) <= committedAmount`. Past the cap, the call reverts with `PledgeAmountExceedsCommitted`.
3. **Off-chain audit trail**: events are public + indexable. A donor seeing their `recordHonor` and a subsequent `markPaid` for the same period can flag the discrepancy.

**Residual risk**: admin can `markPaid` for unrelated payments and inflate the pool's "settled %". This is reputational exposure for the admin; nothing on chain prevents them from lying about an external payment that didn't happen. Detection: anyone can demand the evidence and verify its hash.

---

### T3. Forged `markPaid` by random caller

**Threat**: A non-admin calls `markPaid` to falsely credit a donor or inflate pool stats.

**Mitigation**: `markPaid` modifier `_isAccountOwner(poolAgent, msg.sender)`. Same modifier as pledge `submit` and registry status writes. Revert with `NotPoolOperator`.

**v2**: cross-delegation will allow a steward (delegate of pool owner) to call `markPaid` — see `v2-backlog.md` § V2.1.

---

### T4. Stolen / replayed session steals donor treasury

**Threat**: An attacker who briefly compromises a session key tries to drain the donor's personal treasury via repeated `pool_pledge:honor` calls.

**Mitigations**:

1. **`pool_pledge:honor` is `sensitive` tier** in `TOOL_POLICIES`: sub-delegated, exact-call, with calldata hash, short timestamp window (≤ 5 min), human confirmation required in UI before signing.
2. **One-shot delegation**: each honor mints a fresh leaf delegation that's bound to *this* pledge + *this* amount + *this* calldata hash. The session key cannot reuse it for a different honor.
3. **Treasury owner = passkey** (passkey users) / **user EOA** (demo) / **session-EOA + passkey co-owner** (SIWE). A session-EOA leak does NOT compromise the treasury — the leaf delegation chain requires deployer-fallback or user-EOA signature, not the session-EOA.
4. **ValueEnforcer = 0**: no ETH leaks; only the explicit token amount transfers.

**Residual risk**: a compromised user passkey (or stolen demo `privateKey`) drains the treasury. Same exposure as any wallet compromise; out of scope for sub-delegation to mitigate.

---

### T5. Re-org replay

**Threat**: A short-fork re-org replays a `recordHonor` after the original was rolled back.

**Mitigations**:

1. Salt + per-pledge `pledgeSubject` make each call deterministic. A re-org would re-run the increment.
2. Cumulative `+=` semantics: each `recordHonor` is idempotent on the same sub-delegation's `salt` if we add a per-call replay guard.

**v2** consideration: add a per-delegation `nonce` field for stronger replay protection on the registry side. Currently delegations use `salt` + caveats; combined timestamp window limits replay to ≤ 5 min anyway.

**Stance**: acceptable on single-finality chains (anvil, Ethereum mainnet post-merge). Document for fork-prone L2 deploys.

---

### T6. Donor anonymity leak (BY DESIGN in v1)

**Threat**: An observer queries `sa:hasPersonalTreasury` for a person agent and learns every pledge that treasury made (via USDC `Transfer` events).

**Mitigation**: NONE in v1. Documented in `comparison.md` § "Linkable donor identity" and in this doc.

**Posture**:
- v1 treasury is linkable BY DESIGN.
- If a donor wants strong anonymity, they don't use the personal treasury rail — they pay externally and the pool admin uses `markPaid` to record it.
- v2 backlog § V2.3 covers shielded settlement (Semaphore / MACI / shielded pool).

**UI implication**: surface a banner on the honor flow: "Honoring via personal treasury reveals your wallet → person agent link on chain. Use external payment + ask the pool admin to mark it paid if you need stronger privacy."

---

### T7. MockUSDC accidentally deployed to public network

**Threat**: A misconfigured deploy script puts `MockUSDC` (with open mint) on a public network.

**Mitigations**:

1. **`scripts/deploy-local.sh`** explicitly checks `CHAIN_ID == 31337` before deploying MockUSDC.
2. **`scripts/fresh-start.sh`** uses the local deploy script only.
3. **Production deploy script** (separate file, not in this spec) does NOT include MockUSDC.
4. Off-chain web helpers (`fund-local-treasury.ts`) check `chainId === 31337` before any `mint` call.

**Residual risk**: someone runs `deploy-local.sh` against a non-anvil RPC by env override. Adding a sanity assertion (`require(block.chainid == 31337, "MockUSDC: dev-only")`) inside the contract's mint function is a v1.1 belt-and-suspenders option; if added, it must be removable for unit tests where chainid varies.

---

### T8. Evidence hash collision

**Threat**: Two different evidence documents produce the same sha256 hash (preimage attack).

**Stance**: sha256 collision resistance is the standard cryptographic guarantee. Not a practical threat. Documented for completeness.

---

### T9. Evidence document loss

**Threat**: Pool admin records `markPaid` with a hash, then loses the original document. Hash on chain is now unverifiable.

**Stance**: documented operational risk. The chain remembers a hash that no one can validate. Audit log integrity is the org admin's responsibility; the chain doesn't enforce blob persistence.

**Mitigation**: `evidence_blobs` table in org-mcp + standard backup procedures. v2 adds optional IPFS/Arweave pinning for stronger guarantees (§ V2.4).

---

## Caveat enforcer composition for `pool_pledge:honor`

The sub-delegation minted at honor time MUST include:

```
caveats: [
  AllowedTargetsEnforcer:   [donor's personal treasury]
  AllowedMethodsEnforcer:   [SPEC005_SELECTORS.executeBatch]
  CallDataHashEnforcer:     [keccak256(executeBatchCalldata)]
  ValueEnforcer:            [0]
  TimestampEnforcer:        [now - 60, now + 5 minutes]
]
delegate: session-EOA
delegator: donor's personal treasury (root) → admin→holder (parent) → leaf (this delegation)
```

The action layer (`apps/web/src/lib/actions/pledgeHonor.action.ts`):
1. Builds the exact `executeBatch` calldata via `buildHonorBatchCalldata(...)`.
2. Hashes it.
3. Mints the leaf delegation with the hash pinned.
4. UI shows the donor: "You're authorizing: transfer $X USDC from your treasury to pool Y. Sign with passkey."
5. Donor signs.
6. Web submits via A2A redeem path.

## Caveat enforcer composition for `pool_pledge:mark_paid`

```
caveats: [
  AllowedTargetsEnforcer:   [PledgeRegistry address]
  AllowedMethodsEnforcer:   [SPEC005_SELECTORS.pledgeMarkPaid]
  CallDataHashEnforcer:     [keccak256(markPaidCalldata)]
  ValueEnforcer:            [0]
  TimestampEnforcer:        [now - 60, now + 5 minutes]
]
delegate: session-EOA
delegator: pool fund agent
```

UI shows: "You're attesting: $X paid externally for pledge Z, evidence hash 0x… Sign with passkey to record on chain."

## Production hardening checklist (post-v1)

- [ ] Audit `AgentAccount.executeBatch` for re-entrancy via post-hooks.
- [ ] Audit `PledgeRegistry.recordHonor` for the same-tx token transfer assumption.
- [ ] Add per-delegation nonce or replay-token if deploying to fork-prone L2.
- [ ] Add `chainid` guard in `MockUSDC.mint` for belt-and-suspenders dev-only enforcement (or remove `MockUSDC` from prod deploy entirely).
- [ ] External audit of the caveat enforcer chain composition for honor + markPaid.
- [ ] Adversarial pen-test of the evidence-hash trust model.
