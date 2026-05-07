# Safe Architecture Comparison — Treasury / Multi-Sig Patterns vs. Smart Agent

> Comparative analysis of Safe (Gnosis Safe) treasury / multi-sig architecture against our existing on-chain treasury plan in `output/onchain-treasury-plan.md`. Goal: decide what to adopt, what to deliberately diverge from, and whether to introduce a dedicated "treasury MCP" service.

---

## 1. Baseline summary — our existing architecture

What we already have in `packages/contracts/src/`:

- **`AgentAccount.sol`** (lines 1–60) — ERC-4337 `BaseAccount` + UUPS-upgradeable. Multi-owner via `mapping(address => bool) _owners`. ERC-1271 + ERC-4337 + ERC-7710 (delegated execution via DelegationManager).
- **`AgentAccountFactory.sol`** — deterministic CREATE2 deployment.
- **`DelegationManager.sol`** (lines 1–80) — EIP-712 delegation issuance, redemption, revocation. `ROOT_AUTHORITY` chains. Caveat-stack semantics. The signature recovery path supports ERC-1271 contract signatures (so the steward-set wrapper is trivially representable). Open delegation sentinel `address(0xa11)`.
- Caveat enforcers (in `enforcers/`): `TimestampEnforcer`, `ValueEnforcer`, `AllowedTargetsEnforcer`, `AllowedMethodsEnforcer`. All implement `ICaveatEnforcer.beforeHook(args)` / `afterHook(args)` and revert on failure.
- **`ClassAssertion.sol`** — typed assertion emitter; the public-read source for the GraphDB mirror.

Planned (per `output/onchain-treasury-plan.md` § 3): `PoolMandateEnforcer`, `RoundDecisionWindowEnforcer`, `AllocationLimitEnforcer`, `QuorumEnforcer`, plus `MandateRegistry` and `CommitmentRegistry`. The sketched delegation chain is a three-tier `STEWARDSHIP_DELEGATION → SESSION_DELEGATION → (inline self-redeem)` (plan § 4.1).

---

## 2. Safe core — what it is

Safe (formerly Gnosis Safe) is a singleton + minimal proxy multisig. The core contract is `Safe.sol` which inherits `OwnerManager`, `ModuleManager`, `GuardManager`, `FallbackManager`, etc. Storage holds: an owners linked list, a threshold, a nonce, and an enabled-modules linked list. The single call surface for owner-driven execution is **`execTransaction`** which:

1. EIP-712 hashes the tx struct.
2. Calls `checkSignatures(hash, packedSigs)` — see Q1 below for sig packing details.
3. Invokes the optional Guard's `checkTransaction` pre-hook.
4. Calls the target via `call` or `delegatecall`.
5. Invokes the Guard's `checkAfterExecution` post-hook.
6. Increments nonce.

Modules bypass `execTransaction` entirely via **`execTransactionFromModule`** — once enabled by an N-of-M owner tx, a module can call into the Safe with no further owner sigs.

The 4337 module (Safe7579, Safe `{Core}` 4337 module) is a fallback handler that lets the Safe act as a 4337 smart account: it implements `validateUserOp`, decodes signatures using the same `checkSignatures` packing, and consumes ~4.9k gas on top of the EntryPoint baseline.

---

## 3. Specific questions answered

### Q1 — execTransaction signature packing & mixed-type sig discrimination

Safe packs all owner sigs into a single `bytes` blob, **constant 65 bytes per sig** (`{32-byte r/data}{32-byte s/data}{1-byte v/type}`). Sigs **must be sorted by signer address ascending** (anti-duplicate, deterministic). The 1-byte type byte is overloaded:

| `v` value      | Type                 | r/s meaning                                                    |
|----------------|----------------------|----------------------------------------------------------------|
| 27 / 28        | ECDSA over `txHash`  | Standard secp256k1 r, s                                        |
| > 30           | `eth_sign` ECDSA     | r, s over `keccak256("\x19Ethereum Signed Message:..." \|\| h)`|
| 0              | EIP-1271 contract    | `r` = signer addr (left-padded), `s` = offset to dynamic blob  |
| 1              | Pre-approved hash    | `r` = signer addr; signer previously called `approveHash`      |
| 2              | secp256r1 (RIP-7212) | passkey/P-256                                                  |

For EIP-1271, the `s` field is an offset into the calldata; at that offset the signer's contract sig length and bytes live appended after all the constant-length entries. This is how Safe verifies **mixed-type sigs in one calldata payload** — every sig occupies the same 65-byte slot in the constant region, but EIP-1271 contract sigs spill their dynamic bytes to a tail region pointed to by `s`.

**Adopt verbatim for `QuorumEnforcer`**: sorted-ascending signer ordering (anti-duplicate is free), 65-byte constant slot per sig, `v`-byte discrimination of ECDSA vs ERC-1271 vs pre-approved, and the offset-encoded tail region for ERC-1271 dynamic sigs. This is a battle-tested pattern; reinventing the layout is pure risk for zero gain.

> Sources: [Safe contracts signatures docs](https://docs.gnosis.io/safe/docs/contracts_signatures/), [Safe docs — smart-account-signatures](https://docs.safe.global/advanced/smart-account-signatures), [Safe.sol checkSignatures](https://github.com/safe-global/safe-smart-account/blob/main/contracts/Safe.sol).

### Q2 — Module vs Guard for our `RoundDecisionWindowEnforcer`?

Neither cleanly. Safe's two extension points are coarser than our caveats:

- A **Module** is a permissioned bypass — once enabled it can call `execTransactionFromModule` with no owner sigs. It's a *capability* you grant a contract, not a per-call rule. The closest Safe analog to our `RoundDecisionWindowEnforcer + AllocationLimitEnforcer + QuorumEnforcer` stack would be a custom Module that internally reproduces those three checks before invoking `execTransactionFromModule`. That's exactly what the **`AllowanceModule`** does for spending-limit semantics: it's a Module, the delegate signs an EIP-712 transfer authorization, the module verifies the sig + decrements the allowance + calls back into the Safe to do the actual transfer. No quorum needed for in-cap spend — once the Safe owners enabled the module and called `setAllowance`, the delegate can spend up to the cap freely.
- A **Guard** runs `checkTransaction` / `checkAfterExecution` on every `execTransaction` (and a separate `ModuleGuard` on every `execTransactionFromModule`). It's a *global pre/post hook*, not per-policy.

In Safe-land, our tranche disbursement would look like: owners enable an `AllocationModule` (analog of `AllowanceModule`) whose state holds `(roundId, awardsRoot, decisionDate, perTrancheCap[])`; the delegate (lead steward) signs an EIP-712 disbursement msg; module verifies sig + checks awards Merkle proof + decrements tranche counter + calls `execTransactionFromModule(token, transfer)`. **Critically: the quorum check happens at *Module enablement time*** (one owner tx with N-of-M sigs to set the policy) and **not on each disbursement**. This is the inverse of our plan, where `QuorumEnforcer` runs on every redeem.

**Trade-off**: Safe's module model is cheaper per-disbursement (no per-call N-of-M sig recovery) but coarser — to revoke a tranche cap mid-round you have to either disable the module or roll a new one. Our caveat-stack approach embeds the policy in each delegation, so a fresh SESSION_DELEGATION re-encodes the entire policy.

> Sources: [Safe Modules docs](https://docs.safe.global/advanced/smart-account-modules), [Safe Guards](https://docs.safe.global/advanced/smart-account-guards), [AllowanceModule.sol](https://github.com/safe-fndn/safe-modules/blob/main/modules/allowances/contracts/AllowanceModule.sol).

### Q3 — Does Safe have an analog of `redeemDelegation`?

**No, not natively.** Safe has two paradigms:

1. **Owner-signed `execTransaction`** — owners themselves must sign every tx (or pre-approve via `approveHash`).
2. **Module bypass `execTransactionFromModule`** — a pre-enabled module is the principal, with no per-call owner involvement.

There is no native Safe primitive equivalent to "third-party submits a tx that proves authority via a chain of pre-signed permissions" the way `DelegationManager.redeemDelegation` does. The closest you get is:

- The **AllowanceModule pattern** — delegate pre-signs an EIP-712 *single-shot* transfer auth, anyone (including the recipient) can submit it on chain. But there's no chain of nested authorities — it's a flat 1-tier auth from the Safe to the delegate.
- **Roles Modifier (Zodiac)** — assigns scoped permissions to addresses; those addresses can then call `execTransactionWithRole` and the Modifier checks the call against the role's conditions tree before forwarding to the Safe via `execTransactionFromModule`. Closer to our model — see Q5.

The operational difference for a steward set wanting to delegate signing to a treasurer: in Safe you **enable an AllowanceModule** with the treasurer as a delegate (the steward set must do this with one N-of-M tx). In our model we **issue a SESSION_DELEGATION** signed by the steward-set proxy with caveats. The Safe pattern is one-shot config; ours is one-shot delegation with revocation. Functionally similar; ours composes better because revocation is per-delegation and authority chains are explicit.

> Sources: [AllowanceModule README](https://github.com/safe-fndn/safe-modules/blob/main/modules/allowances/README.md), [Zodiac Roles Modifier](https://docs.roles.gnosisguild.org/).

### Q4 — Safe Transaction Service: primary or convenience?

**Convenience.** The Safe Transaction Service is a self-hostable Django/Celery/PostgreSQL service that:

- Indexes Safe events from chain (the canonical state still lives on chain).
- Hosts a stateful proposal pool: `POST /v1/safes/{address}/multisig-transactions/` creates a tx with at least one sig; `POST /v1/multisig-transactions/{safe_tx_hash}/confirmations/` adds further confirmations.
- Computes the EIP-712 `safeTxHash` *but does not own the domain* — the domain separator is the Safe's own address; the service is just doing the same hash the contract would.

It is **not** the primary signing source — owners can sign and submit `execTransaction` directly without it. It exists because:

1. Owners aren't online at the same time, so a shared store for "in-flight proposals" is convenient.
2. UI needs a fast indexer to render Safe history without RPC eth_getLogs round-trips.
3. Webhooks (`safe-events-service`) push state changes to integrations.

**Smallest viable data model** (if we mimicked it): proposal table `(safeAddr, safeTxHash, to, value, data, operation, nonce, createdAt, status)` + confirmations table `(safeTxHash, signer, signature, submittedAt)`. Plus a chain indexer to flip status to `executed`. That's it. Stateful but extremely thin — most logic is on chain.

> Sources: [Safe Tx Service architecture docs](https://docs.safe.global/advanced/api-service-architecture/safe-transaction-service), [Safe Tx Service GitHub](https://github.com/safe-global/safe-transaction-service).

### Q5 — Composable-policy primitive comparison

Our caveat stack is a **list of independent enforcer contracts**, each with its own state, each running `beforeHook` then `afterHook` in sequence. Adding a new policy = ship a new contract implementing `ICaveatEnforcer`.

Zodiac Roles Modifier V2 takes the opposite design: **one contract, one config tree per role**. The `Condition` struct is recursive:

```solidity
struct Condition {
  AbiType paramType;     // Static, Dynamic, Tuple, Array, Calldata, AbiEncoded
  Operator operator;     // see below
  bytes32 compValue;     // immediate operand
  Condition[] children;  // for And / Or / Matches / Array*
}
```

Operators include `And`, `Or`, `Nor`, `Matches`, `ArraySome`, `ArrayEvery`, `ArraySubset`, `EqualTo`, `GreaterThan`, `LessThan`, `SignedIntGreaterThan`, `SignedIntLessThan`, `Bitmask`, `Custom`, `WithinAllowance`, `EtherWithinAllowance`, `CallWithinAllowance`, `EqualToAvatar`, `Pass`. Adding a new policy = re-config an existing role tree (data-only) or, for a rare new operator, ship a `Custom` adapter contract.

| Dimension                          | Our caveats                                                       | Zodiac Roles V2                                                     |
|------------------------------------|-------------------------------------------------------------------|---------------------------------------------------------------------|
| Composition unit                   | Contract instance per enforcer                                    | Tree node within one config blob                                    |
| Composition operators              | Implicit conjunction (all must pass)                              | Explicit `And`, `Or`, `Nor`                                         |
| State                              | Each enforcer can hold its own (e.g., `AllocationLimitEnforcer`)  | Centralized in Roles contract; allowance-style operators get state  |
| Adding a new policy                | New Solidity contract                                             | New config (no contract); new operator only if nothing fits         |
| Auditability                       | Per-enforcer test surface; small contracts                        | One large contract with a complex condition evaluator               |
| Gas                                | One CALL per enforcer (~2k baseline + logic)                      | One DELEGATECALL into Roles + tree walk                             |
| Revocation                         | Per-delegation revoke; granular                                   | Per-role permission update; coarser                                 |

**Verdict**: our model is more flexible (any Solidity logic can be an enforcer; we have full state isolation per concern) at the cost of more deployment surface. Roles V2 is more deploy-once / config-many at the cost of operator richness. **For our v1 we should stay with caveat enforcers** — non-monetary commitments, mandate Merkle proofs, and steward quorum each want their own state and aren't expressible as pure parameter-comparison conditions. **But we should adopt Roles V2's `EtherWithinAllowance` / `CallWithinAllowance` *naming convention*** — calling our concept "Allocation Limit" is fine but having a primitive called `WithinAllowance` makes the read-side query story (e.g. "show me all delegations with a spend cap") much easier.

> Source: [zodiac-modifier-roles Types.sol](https://github.com/gnosisguild/zodiac-modifier-roles/blob/main/packages/evm/contracts/Types.sol).

### Q6 — Steward-set rotation while a tranche is mid-disbursement

**Safe's behavior**: `addOwnerWithThreshold` / `removeOwner` / `swapOwner` / `changeThreshold` are owner-only self-calls (the Safe must call itself with N-of-M sigs). Owner-set changes:

1. **Do NOT disable enabled modules.** Modules persist across owner rotations. This is a footgun: if a malicious previous owner enabled a module, removing them does not de-authorize that module. The Safe community treats "audit modules on every owner rotation" as a security checklist item.
2. **Do invalidate any in-flight off-chain `execTransaction` sigs that haven't met threshold yet** — because `checkSignatures` walks the *current* owner list, and a removed owner's sig will no longer be recognized.
3. **Do not invalidate `approveHash` pre-approvals** by removed owners, but those are re-checked against the current owner list at exec time, so a removed owner's pre-approval becomes a no-op.

**Our plan's behavior** (per `output/onchain-treasury-plan.md` § 4.3): pool root key signs new STEWARDSHIP_DELEGATION; revokes prior; emits `sa:StewardSetUpdatedAssertion`. Any in-flight SESSION_DELEGATION whose authority chain goes back to the now-revoked STEWARDSHIP fails on `redeem` because the chain validation step reverts.

Our behavior is **stronger** than Safe's: revocation cleanly invalidates the entire downstream chain in a single call, whereas Safe leaves modules dangling. **Adopt** our pattern verbatim, but **borrow Safe's audit checklist mentality** — every steward rotation should also enumerate in-flight session delegations and explicitly revoke any that should not survive the rotation (rather than relying on caveat-implicit invalidation).

> Sources: [addOwnerWithThreshold ref](https://docs.safe.global/reference-smart-account/owners/addOwnerWithThreshold), [Safe.sol](https://github.com/safe-global/safe-smart-account/blob/main/contracts/Safe.sol).

### Q7 — What Safe has that we currently lack

Five concrete patterns:

1. **A Guard interface at the AgentAccount level** for global pre/post-execution hooks — independent of the delegation/caveat path. Useful for tenant-level rules ("no calls to a known-bad address list") that aren't about a specific delegation. We have nothing equivalent. `AgentAccount.execute` is a single method with no hook surface.
2. **A FallbackHandler** (Safe's `CompatibilityFallbackHandler` at `0xf48f2b...`) — lets the account respond to unknown selectors, including ERC-1271 `isValidSignature` for off-chain sig verification. We do have ERC-1271 inline in `AgentAccount`, but a swappable fallback handler would let us add new signature schemes (e.g., aggregated BLS, threshold P-256) without re-deploying `AgentAccount`.
3. **A Module concept** — a long-lived authorized contract that bypasses the per-call delegation check. Some use cases (e.g. an oracle-driven recurring payment) are clumsy as a delegation chain but natural as a module. We currently force everything through DelegationManager.
4. **`approveHash` (on-chain pre-approval)** — an alternative to off-chain ECDSA where an owner pre-approves a hash on chain. For passkey/P-256 owners who can't easily sign EIP-712 off-chain, this is a useful escape hatch. Our `QuorumEnforcer` should accept pre-approved hashes alongside ECDSA + ERC-1271 sigs (matching Safe's `v=1` type).
5. **A `MultiSend` library** — the canonical pattern for "do N actions atomically inside one execTransaction". Our plan punts on multi-call inside one userOp (Q11 in the treasury plan) — a `MultiSend.sol` library matching Safe's would close that gap and let us emit `sa:DisbursementAssertion` + `USDC.transfer` in one tx without ABI changes to `AgentAccount.execute`.

> Sources: [Safe FallbackHandler 1.3.0](https://etherscan.io/address/0xf48f2b2d2a534e402487b3ee7c18c33aec0fe5e4), [Safe Modules](https://docs.safe.global/advanced/smart-account-modules), [Safe Guards](https://docs.safe.global/advanced/smart-account-guards).

---

## 4. Patterns to adopt

1. **Sorted-ascending signer ordering + 65-byte-constant sig packing in `QuorumEnforcer`** — battle-tested anti-duplicate scheme that eliminates an entire class of bugs (Q1).
2. **Mixed-type sig discrimination via `v` byte** (ECDSA / `eth_sign` / EIP-1271 / `approveHash` / RIP-7212) — we already have most of this in `AgentAccount` for owner sigs; mirror it in `QuorumEnforcer` so steward signatures from `AgentAccount`-backed stewards (passkey / contract-sig) work the same as EOA stewards (Q1, Q7).
3. **Self-hostable, stateful proposal-pool service mirroring Safe Tx Service's data model** — a thin DB of `(safeTxHash, to, value, data, operation, nonce)` + `(safeTxHash, signer, signature)` is enough; we don't need a heavyweight indexer for v1 (Q4). See § 6 below for our recommendation on whether this is a separate MCP.
4. **Guard hook surface on `AgentAccount`** — add `IGuard.checkBefore(target, value, data)` / `checkAfter(target, value, data, success)` slots, callable both pre/post `execute`. Defense-in-depth that lets us layer org-wide rules (e.g. "no transfers > X without a delay") without polluting individual delegations (Q7).
5. **`MultiSend.sol` library** — single library contract with `multiSend(bytes transactions)` that delegatecalls a packed list of (op, to, value, data) tuples. Resolves Q11 in the treasury plan (atomic disbursement + assertion in one userOp) without changing `AgentAccount.execute` (Q7).

## 5. Patterns to deliberately diverge from

1. **Diverge from "modules bypass per-call auth".** Safe modules trade auditability for convenience — a malicious module is a Safe takeover. Our caveat-stack model puts the policy *in the delegation*, not in a long-lived authorized contract. Keep this — it makes revocation crisp and turns a treasury compromise from "owner takeover" into "single delegation revoked" (Q2).
2. **Diverge from "owner rotation does not disable modules".** Our plan's STEWARDSHIP revocation cleanly invalidates the downstream chain — keep it, and explicitly *audit and revoke* in-flight session delegations as part of the rotation runbook (Q6).
3. **Diverge from "Roles Modifier single-config tree".** Our caveat-enforcer-per-concern model has more deployment overhead but vastly better state isolation (mandate Merkle root, tranche counter, signer set are each in their own contract with their own audit surface). Worth the extra deploy cost (Q5).
4. **Diverge from "Safe Transaction Service as a heavyweight indexer".** We already have an on-chain → GraphDB sync (`apps/web/src/lib/ontology/graphdb-sync.ts`) doing the indexing for read. We do *not* need Celery/RabbitMQ/Redis. Whatever proposal pool we add should be ~150 LOC of TypeScript, not a separate Django service (Q4).
5. **Diverge from "delegate is a recipient-restricted spending limit".** Safe's `AllowanceModule` lets *any* `to` receive tokens once the delegate authorizes it. Our `RoundDecisionWindowEnforcer` proves recipient-membership via a Merkle proof against `awardsRoot` — strictly tighter, and the right call given grants are recipient-specific by design (Q2).

## 6. Treasury MCP recommendation — **No, fold into `org-mcp`** with one exception

The user's question:
> "I'm not sure if we want a treasury mcp backend where manage access to for delegations."

**Recommendation: do not introduce `treasury-mcp` as a separate service in v1.** Fold all treasury tools into the existing `apps/org-mcp/` (because the pool's owner is an organization), and persist the proposal pool in `org-mcp.db` under a small new schema. Reasons grounded in Safe research:

1. **Safe Tx Service is a convenience indexer, not the primary signing source** (Q4). Owners can self-sign and submit directly. Our analog is: stewards can collect sigs anywhere (CLI, UI, Slack thread, signal) and submit a single `redeemDelegation`. A standalone service is not architecturally required.
2. **The persistence is thin.** Two tables (proposals + signatures) is ~150 LOC. Spinning up a new Hono server, new auth scope, new container, new readiness probe in `fresh-start.sh`, new `WIPE_PATHS` entry — all for two tables — is over-engineering. `org-mcp` already has the right delegation-token auth boundary (the pool's stewards have steward delegations on the org-mcp's tools).
3. **The on-chain chain is the source of truth.** Safe's design lesson: the chain is canonical, the service is convenience. Our `DelegationManager` already records delegation hashes and revocations on chain. The proposal pool is *only* about coordinating "who has signed what so far" — a coordination cache, not a system of record.
4. **Authorization scope already fits org-mcp.** The pool's stewards are bound by a STEWARDSHIP_DELEGATION whose delegate is `STEWARD_SET_PROXY` — that proxy lives logically inside the org. A proposal pool is steward-scoped read/write — exactly the `org-mcp` authorization pattern (a tool callable by holders of a delegation issued by the pool's `AgentAccount`).

**Tools to add to `org-mcp` (not a new service):**

- `treasury_proposal:create(roundId, awardsRoot, decisionDate, expiresAt)` — stores the EIP-712 message hash + payload; returns `proposalId`.
- `treasury_proposal:sign(proposalId, signature)` — appends a steward sig (validated against the current STEWARDSHIP signer set hash).
- `treasury_proposal:list_pending(poolAgentId)` — list proposals awaiting more sigs.
- `treasury_proposal:assemble(proposalId)` — packs the sig list (sorted-ascending, 65-byte constant slot, EIP-1271 tail) into the `args` for `QuorumEnforcer`; returns the calldata blob ready for `redeemDelegation`.
- `treasury_proposal:mark_executed(proposalId, txHash)` — flips status when the on-chain → GraphDB sync sees the `sa:DisbursementAssertion`.

**One exception — `treasury-mcp` makes sense IF**: we end up needing a *cross-org* proposal pool (e.g. a Pool whose stewards span multiple organizations and none of them is the natural owner of the proposal pool). At that point `treasury-mcp` becomes a neutral coordination service. **Defer that decision to v2** when we actually have a multi-org pool in production. For v1, single-org pools are the only flavor described in the treasury plan, so org-mcp is the right home.

## 7. Concrete design changes to `output/onchain-treasury-plan.md`

Specific edits to make based on Safe research (do not write the edits in this report — these are the issue list):

- **§ 1.1 architecture diagram**: add a `MultiSend` library box between `pool.AgentAccount.execute(...)` and the parallel `USDC.transfer + ClassAssertion.emit` calls; the diagram currently leaves "two ops in same userOp" unspecified, which Q11 also flags.
- **§ 3.1 `QuorumEnforcer.sol` interface**: change the `args` encoding to mirror Safe's exactly — sorted-ascending signers, constant 65-byte sig slot, `v`-byte type discrimination (ECDSA / `eth_sign` / EIP-1271 / `approveHash` / RIP-7212 P-256), with EIP-1271 dynamic data appended to a tail region pointed to by the `s` field. Adopt Safe's `checkSignatures` algorithm verbatim. Replace the current `bytes[] signatures, address[] orderedSigners` with a single packed `bytes signatures` blob.
- **§ 3.1 `QuorumEnforcer.sol` errors**: add `ApprovedHashRequired` and `ContractSigInvalid` error variants to match the type discrimination.
- **§ 3 — new §3.4 "Account-level Guards"**: introduce an optional `IAccountGuard` hook on `AgentAccount` (`checkBefore` / `checkAfter`) so org-wide policies (deny-list, kill-switch) can layer over the per-delegation caveats. Note this is additive to caveats, not a replacement.
- **§ 3 — new §3.5 "MultiSend library"**: add a tiny `MultiSend.sol` (delegatecall-only, packed `(op, to, value, dataLen, data)` tuples) to enable atomic `transfer + emitAssertion` in one userOp. This resolves Q11 in § 8.
- **§ 4.1 Tier-0 caveats**: add `ApprovedHashEnforcer` so a steward who is themselves an `AgentAccount` (passkey, no off-chain ECDSA) can pre-approve the AllocationDecided hash on chain and have `QuorumEnforcer` count it. Mirrors Safe `v=1`.
- **§ 4.3 Steward-set rotation**: add an explicit step "enumerate and selectively revoke in-flight SESSION_DELEGATIONs that should not survive the rotation". Implicit invalidation via authority-chain walk works, but Safe's lesson on dangling modules says explicit > implicit for security-relevant state.
- **§ 5 — new MCP tools section "Treasury proposal pool tools in org-mcp"**: add `treasury_proposal:create / sign / list_pending / assemble / mark_executed` per § 6 above. Place them in `apps/org-mcp/src/tools/treasuryProposals.ts` (new file).
- **§ 5.6 `treasuryDisburse.action.ts`**: change "gathers steward sigs (passes through to off-chain N-of-M coordinator UI)" to "calls `treasury_proposal:assemble` on org-mcp to fetch the packed sig blob"; the action layer no longer owns sig coordination state.
- **§ 6 GraphDB sync**: no changes needed — confirms § 6 is correct as-is (the chain remains source of truth and the proposal-pool data does not flow to GraphDB; IA P4 is preserved because the coordination cache is owner-private MCP data, not a public-class assertion).
- **§ 7 Phase 1**: add `treasury_proposal:create / sign / assemble` as Phase-1 tools (they're MCP-only; no on-chain change). Stewards can rehearse the sig-collection flow before any caveat enforcers are deployed.
- **§ 8 Q11**: resolve as "use new `MultiSend.sol` library" and remove the Q11 row from open questions.
- **§ 8 — new Q13**: "Should pre-approved hashes (`approveHash`) be supported by `QuorumEnforcer`?" Recommendation: yes, for symmetry with Safe and to support passkey-only stewards.
- **§ 11 critical files**: add `apps/org-mcp/src/tools/treasuryProposals.ts` (new), `packages/contracts/src/MultiSend.sol` (new), `packages/contracts/src/IAccountGuard.sol` (new).

---

## 8. Sources

- Safe core architecture: [contracts_details](https://safe-docs.dev.gnosisdev.com/safe/docs/contracts_details/), [Safe.sol](https://github.com/safe-global/safe-smart-account/blob/main/contracts/Safe.sol), [Transaction execution](https://safe-docs.dev.gnosisdev.com/safe/docs/contracts_tx_execution/), [Gnosis Safe Walkthrough](https://pkqs90.github.io/posts/gnosis-safe-walkthrough/)
- Signatures: [Safe Signatures docs](https://docs.gnosis.io/safe/docs/contracts_signatures/), [Safe smart-account-signatures](https://docs.safe.global/advanced/smart-account-signatures), [Gnosis Safe Internals — Part 3](https://medium.com/@cizeon/gnosis-safe-internals-part-3-signing-transactions-93fcced50a29)
- Modules / Guards: [Safe Modules](https://docs.safe.global/advanced/smart-account-modules), [Safe Guards](https://docs.safe.global/advanced/smart-account-guards), [execTransactionFromModule](https://docs.safe.global/reference-smart-account/modules/execTransactionFromModule), [Staying safe with Safe (Ackee)](https://ackee.xyz/blog/staying-safe-with-safe/)
- AllowanceModule: [AllowanceModule.sol](https://github.com/safe-fndn/safe-modules/blob/main/modules/allowances/contracts/AllowanceModule.sol), [README](https://github.com/safe-fndn/safe-modules/blob/47e2b486b0b31d97bab7648a3f76de9038c6e67b/allowances/README.md), [Spending Limits help](https://help.safe.global/en/articles/40842-set-up-and-use-spending-limits)
- Zodiac Roles Modifier: [Roles docs](https://docs.roles.gnosisguild.org/), [zodiac-modifier-roles](https://github.com/gnosisguild/zodiac-modifier-roles), [Zodiac main](https://github.com/gnosisguild/zodiac), [Wiki](https://www.zodiac.wiki/documentation/roles-modifier)
- 4337 / Safe7579: [Safe4337Module.sol](https://github.com/safe-fndn/safe-modules/blob/main/modules/4337/contracts/Safe4337Module.sol), [Safe modules 4337 dir](https://github.com/safe-global/safe-modules/tree/main/modules/4337)
- Safe Transaction Service: [api-service-architecture](https://docs.safe.global/advanced/api-service-architecture/safe-transaction-service), [api-safe-transaction-service](https://docs.safe.global/advanced/api-safe-transaction-service), [GitHub](https://github.com/safe-global/safe-transaction-service), [api-overview](https://docs.safe.global/advanced/api-overview)
- Owner management: [addOwnerWithThreshold](https://docs.safe.global/reference-smart-account/owners/addOwnerWithThreshold), [setup](https://docs.safe.global/reference-smart-account/setup/setup)
- Fallback handler: [CompatibilityFallbackHandler 1.3.0](https://etherscan.io/address/0xf48f2b2d2a534e402487b3ee7c18c33aec0fe5e4)
- Roles V2 condition tree: [Types.sol](https://github.com/gnosisguild/zodiac-modifier-roles/blob/main/packages/evm/contracts/Types.sol)
