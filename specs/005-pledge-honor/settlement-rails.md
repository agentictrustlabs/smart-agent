# Spec 005 — Settlement Rails

> **Owners**: Information Architect + Developer.
> **Bound to**: `plan.md`, `contracts.md`, `evidence-storage.md`.

## Two rails, one ledger

A pledge can be settled by **either or both** of two rails. The `PledgeRegistry` keeps separate cumulative counters per rail; the aggregate "settled total" is the sum.

```
pledge.committedAmount = X

   Rail A: donor treasury ──── honoredAmount[token] ──┐
                                                       ├── settledTotal[token]
   Rail B: admin mark-paid ── externallyPaidAmount[token] ──┘

   isFullyHonored: settledTotal[settlementToken] >= committedAmount
```

## Rail A — Cryptographic (donor treasury)

### When it fires

- Donor decides to pay a pledge they made.
- They have a personal treasury AgentAccount (provisioned at signup / login).
- That treasury holds enough USDC (v1: only USDC supported on this rail).

### Sequence

```
1. Donor opens pledge detail page → "Honor pledge" button.
2. UI computes:
   - poolAgent (from pledge's sa:pledgePool)
   - exact executeBatch calldata: [USDC.transfer(pool, amount), PledgeRegistry.recordHonor(pledgeSubj, treasury, USDC, amount)]
   - calldataHash = keccak256(calldata)
3. UI mints a sub-delegation:
     delegator: donor's treasury (root via admin→holder chain)
     delegate:  session-EOA
     caveats:   [AllowedTargets=treasury, AllowedMethods=executeBatch,
                 CallDataHash=calldataHash, Value=0, Timestamp=(now-60, now+5min)]
4. UI prompts donor to sign with passkey.
5. Web submits to A2A redeem-with-chain.
6. On chain:
     DelegationManager.redeemDelegation(chain, treasury, 0, executeBatchCalldata)
       → treasury.execute(treasury, 0, executeBatchCalldata)
         → treasury.executeBatch([USDC.transfer(pool, amount), recordHonor(...)])
           ├── USDC.transfer(pool, amount)           [Transfer event emitted]
           └── PledgeRegistry.recordHonor(...)       [PledgeHonored event emitted]
7. Web refreshes; pledge detail shows new honored amount.
```

### Properties

- **Cryptographic guarantee**: USDC actually moved on chain. Anyone can verify by reading the `Transfer` event.
- **Atomic**: the `executeBatch` reverts entirely if `USDC.transfer` fails (insufficient balance). The `recordHonor` won't fire without the transfer.
- **Donor identity**: linkable on chain via `sa:hasPersonalTreasury(person) → treasury`.
- **Asset**: USDC only in v1. Multi-token storage pattern is ready; multi-token settlement is v2 work.

### What it doesn't do

- Doesn't anonymize the donor (use external + mark-paid for that).
- Doesn't support non-monetary settlement (use mark-paid for prayer-minutes etc.).

## Rail B — Attested (admin mark-paid)

### When it fires

- Donor paid the pool/fund **outside** the on-chain system (bank transfer, check, cash, Stripe, prayer-minutes logged, hours worked, etc.).
- Pool admin verifies the payment in their books.
- Admin uploads evidence (receipt, bank statement) and records on chain.

### Sequence

```
1. Admin opens pool/round steward view → pledge list → "Mark paid".
2. Admin fills form:
   - amount
   - token / unit (USDC for crypto payments; pledge's unit for non-USDC pledges)
   - rail: bank | check | cash | inKind | other
   - evidence file upload (any document)
3. Web computes sha256(file) client-side.
4. Web POSTs to org-mcp /evidence/store (auth: admin's session).
5. UI mints a sub-delegation:
     delegator: round's fund agent
     delegate:  session-EOA
     caveats:   [AllowedTargets=PledgeRegistry, AllowedMethods=markPaid,
                 CallDataHash=keccak256(markPaidCalldata), Value=0, Timestamp]
6. Admin signs with passkey.
7. A2A redeems → PledgeRegistry.markPaid(pledgeSubj, token, amount, rail, evidenceHash)
                  [PledgePaymentMarked event emitted]
8. Pool detail refreshes; pledge shows externally paid amount + rail + evidence link.
```

### Properties

- **Attested guarantee**: admin claims payment happened. Anyone with the document + the hash can verify the document matches.
- **No cryptographic proof of underlying payment** — the admin could fabricate. Reputational.
- **Supports any token + any unit**: USDC, prayer-minutes, hours, in-kind.
- **Pool admin identity is on chain**: every mark-paid records `pledgeMarkedByAgent`.

### What it doesn't do

- Doesn't move on-chain funds. Pool treasury balance doesn't change.
- Doesn't anonymize the admin (audit trail per admin is public).

## Aggregate view

The UI renders settlement per pledge as:

```
$10,000 committed
├── $4,000 honored via treasury (Rail A, USDC)
├── $3,000 marked paid externally (Rail B, bank transfer, evidence: 0xab…)
└── $3,000 remaining
```

Computed from chain by the spec-005 reader (`apps/org-mcp/src/lib/pledge-reader.ts` extended):

```typescript
const honored = settlement(pledgeSubj, USDC).honored
const external = settlement(pledgeSubj, USDC).externallyPaid
const settled = honored + external
const remaining = max(0, committed - settled)
const isFullyHonored = settled >= committed
```

For multi-token pledges (v2), the aggregate is per-token.

## v1 invariant: pledge currency = settlement currency

The pledge commits to `(amount, unit)`. The settlement token must match the pledge's unit IF the unit is a recognised on-chain token (USDC for v1). If the unit is non-monetary (prayer-minutes, hours), Rail A is unavailable and the pledge can only be settled via Rail B.

```
pledge.unit = "USD"                  → Rail A (USDC) OR Rail B (any rail + receipt)
pledge.unit = "prayer-minutes"       → Rail B only (rail: inKind + log)
pledge.unit = "coaching-hours"       → Rail B only (rail: inKind + log)
```

This v1 simplification keeps the SHACL bound check sane:
- Rail A always settles in the pledge's unit (USDC if USDC-denominated, else N/A).
- Rail B's amount is recorded in `amount` field; the unit is implied by `pledgeUnit`.

v2 (`v2-backlog.md` § V2.2) generalizes: any token settles any pledge, with an FX policy or per-token committed allocation.

## Event index for downstream consumers

Both rails emit events queryable from any indexer (per P1, we run our own indexer / readers, no Subgraph SaaS):

```solidity
event PledgeHonored(
    bytes32 indexed pledgeSubject,
    address indexed treasury,
    address indexed token,
    uint256 amount,
    uint256 totalHonored
);

event PledgePaymentMarked(
    bytes32 indexed pledgeSubject,
    address indexed markedBy,
    address indexed token,
    uint256 amount,
    bytes32 rail,
    bytes32 evidenceHash,
    uint256 totalExternallyPaid
);

event PledgeFullyHonored(
    bytes32 indexed pledgeSubject,
    address indexed token,
    uint256 totalSettled
);
```

GraphDB sync mirrors these into `sa:Pledge` triples (per `INTENT_MARKETPLACE_AUDIT.md` pattern). UI surfaces consume from the spec-005 reader, which reads chain state directly.

## Cross-cuts

- **P1 (substrate independence)**: both rails are first-party. No Safe / Privy / Sablier dependency.
- **P4 (sensitive ops sub-delegated)**: both rails use exact-call sub-delegation per `threat-model.md`.
- **IA P3**: evidence blob in org-mcp, hash on chain.
- **IA P4**: events flow on-chain → GraphDB; no MCP → GraphDB direct.
