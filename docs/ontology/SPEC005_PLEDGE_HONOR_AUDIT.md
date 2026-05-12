# Spec 005 — Pledge Honor & Treasury — Ontology Audit

> **Audience**: Ontologist + Developer.
> **Status**: design lock pending sign-off. Bound to `specs/005-pledge-honor/plan.md`.
> **Principle**: substrate independence (`docs/architecture/principles.md` § P1).

This document codifies the T-Box additions, concept hashes, events, and
SHACL shapes that Spec 005 introduces. The seed script
`scripts/seed-spec004-ontology.ts` will be extended to register these
on a fresh-start (per `docs/ontology/INTENT_MARKETPLACE_AUDIT.md`
pattern).

---

## 1. New predicates (AttributeStorage subjects)

### 1.1 On `AgentAccountResolver` (person agent's subject)

| Predicate (curie) | bytes32 (keccak256 of curie) | Datatype | Description |
|---|---|---|---|
| `sa:hasPersonalTreasury` | `keccak256("sa:hasPersonalTreasury")` | address | Links a person agent's subject to the AgentAccount that holds their personal treasury (USDC + future tokens). One per person. |

### 1.2 On `PledgeRegistry` (per-pledge subject)

These extend the existing pledge attribute set. Per-token storage uses
a **composite-subject pattern** to fit AttributeStorage's flat KV.

| Predicate | bytes32 | Datatype | Subject | Description |
|---|---|---|---|---|
| `sa:pledgeHonoredAmount` | `keccak256("sa:pledgeHonoredAmount")` | uint256 | composite: `keccak256(abi.encode(pledgeSubj, "honored", token))` | Cumulative donor-treasury settlement for `(pledge, token)` |
| `sa:pledgeExternallyPaidAmount` | `keccak256("sa:pledgeExternallyPaidAmount")` | uint256 | composite: `keccak256(abi.encode(pledgeSubj, "externalPaid", token))` | Cumulative admin-attested external settlement for `(pledge, token)` |
| `sa:pledgeHonorTokenList` | `keccak256("sa:pledgeHonorTokenList")` | bytes32[] | `pledgeSubj` | List of tokens with any non-zero settlement for this pledge — readers iterate to compute totals |
| `sa:pledgeLastHonoredAt` | `keccak256("sa:pledgeLastHonoredAt")` | uint256 | `pledgeSubj` | Unix timestamp of last `recordHonor` (any token) |
| `sa:pledgeLastMarkedAt` | `keccak256("sa:pledgeLastMarkedAt")` | uint256 | `pledgeSubj` | Unix timestamp of last `markPaid` (any token) |
| `sa:pledgePaymentRail` | `keccak256("sa:pledgePaymentRail")` | bytes32 | `pledgeSubj` | Concept hash of the most-recent `markPaid` rail |
| `sa:pledgeEvidenceHash` | `keccak256("sa:pledgeEvidenceHash")` | bytes32 | `pledgeSubj` | sha256 content hash of the most-recent evidence document |
| `sa:pledgeMarkedByAgent` | `keccak256("sa:pledgeMarkedByAgent")` | address | `pledgeSubj` | Address of the most-recent admin who called `markPaid` |

**Composite-subject rationale**: `AttributeStorage` is flat KV. Nested
mappings aren't directly representable. The composite subject pattern
keeps per-token amounts queryable while preserving the
`predicatesOf(subject)` invariant.

**Reader pattern**:
```
for token in getBytes32Arr(pledgeSubj, SA_PLEDGE_HONOR_TOKEN_LIST):
    honored[token] = getUint(
        keccak256(abi.encode(pledgeSubj, "honored", token)),
        SA_PLEDGE_HONORED_AMOUNT
    )
```

---

## 2. New concept hashes (status + payment rail enums)

### 2.1 Payment rails (values stored at `sa:pledgePaymentRail`)

| Concept curie | bytes32 | Meaning |
|---|---|---|
| `sa:PaymentRailCrypto` | `keccak256("sa:PaymentRailCrypto")` | On-chain ERC-20 / native transfer |
| `sa:PaymentRailBank` | `keccak256("sa:PaymentRailBank")` | ACH / wire / SEPA |
| `sa:PaymentRailCheck` | `keccak256("sa:PaymentRailCheck")` | Paper or electronic check |
| `sa:PaymentRailCash` | `keccak256("sa:PaymentRailCash")` | Physical cash receipt |
| `sa:PaymentRailInKind` | `keccak256("sa:PaymentRailInKind")` | Non-monetary contribution (hours, goods, prayer-minutes …) |
| `sa:PaymentRailOther` | `keccak256("sa:PaymentRailOther")` | Catch-all |

### 2.2 Pledge status (extends existing pledge status hashes)

| Concept | bytes32 | When set |
|---|---|---|
| `sa:PledgeFullyHonored` | `keccak256("sa:PledgeFullyHonored")` | Set by `recordHonor` or `markPaid` when `(honored[token] + externallyPaid[token]) >= committedTotal` AND token is the pledge's settlement token |

(Existing statuses: `sa:PledgeActive`, `sa:PledgeStopped`,
`sa:PledgeAutoStopped`, `sa:PledgeFulfilled`, `sa:PledgeWaitlisted`.)

---

## 3. Events

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

GraphDB sync (per `INTENT_MARKETPLACE_AUDIT.md` pattern) emits:

- `<pledge> sa:pledgeHonoredAmount [...]` (per-token reified as JSON literal, or split per token via separate triples)
- `<pledge> sa:pledgeExternallyPaidAmount [...]`
- `<pledge> sa:pledgePaymentRail <PaymentRailCrypto>`
- `<pledge> sa:pledgeEvidenceHash "0x…"^^xsd:hexBinary`
- `<pledge> sa:pledgeMarkedBy <agent>`

---

## 4. SHACL shapes (`docs/ontology/tbox/shacl/spec005.ttl`)

### 4.1 `sa:PledgeHonorShape`

Bound on each pledge:

```turtle
sa:PledgeHonorShape a sh:NodeShape ;
    sh:targetClass sa:Pledge ;

    # Token list is required iff there's any settlement.
    sh:property [
        sh:path sa:pledgeHonorTokenList ;
        sh:datatype xsd:string ;  # bytes32-array, represented as turtle list
    ] ;

    # Total settled per pledge token must not exceed committed total.
    # Enforced off-chain by GraphDB / SHACL validator; the contract
    # additionally enforces the bound at write time when
    # token == pledge's settlement token.
    sh:sparql [
        sh:select """
            SELECT $this WHERE {
                $this sa:pledgeAmount ?committed .
                $this sa:pledgeHonoredAmount ?honored .
                $this sa:pledgeExternallyPaidAmount ?external .
                FILTER ( (?honored + ?external) > ?committed )
            }
        """ ;
    ] .
```

### 4.2 `sa:ExternalPaymentEvidenceShape`

Bound: when `externallyPaidAmount > 0`, evidence hash MUST be set AND
markedBy MUST be set.

```turtle
sa:ExternalPaymentEvidenceShape a sh:NodeShape ;
    sh:targetClass sa:Pledge ;

    sh:sparql [
        sh:select """
            SELECT $this WHERE {
                $this sa:pledgeExternallyPaidAmount ?amt .
                FILTER ( ?amt > 0 )
                FILTER NOT EXISTS { $this sa:pledgeEvidenceHash ?h }
                UNION
                FILTER NOT EXISTS { $this sa:pledgeMarkedByAgent ?m }
            }
        """ ;
    ] .
```

### 4.3 `sa:PersonalTreasuryShape`

Bound on AgentAccountResolver subjects of type `sa:PersonAgent`:

```turtle
sa:PersonalTreasuryShape a sh:NodeShape ;
    sh:targetClass sa:PersonAgent ;

    sh:property [
        sh:path sa:hasPersonalTreasury ;
        sh:datatype xsd:anyURI ;       # address as IRI
        sh:maxCount 1 ;                # one treasury per person
    ] .
```

---

## 5. Migration to ontology seed

`scripts/seed-spec004-ontology.ts` adds the predicate registrations
(via `OntologyTermRegistry.registerTermBatch`). New rows in the
existing `predicates` array:

```typescript
// AgentAccountResolver predicate
{ curie: 'sa:hasPersonalTreasury',         datatype: 'address' },

// PledgeRegistry new predicates
{ curie: 'sa:pledgeHonoredAmount',         datatype: 'uint256' },
{ curie: 'sa:pledgeExternallyPaidAmount',  datatype: 'uint256' },
{ curie: 'sa:pledgeHonorTokenList',        datatype: 'bytes32-array' },
{ curie: 'sa:pledgeLastHonoredAt',         datatype: 'uint256' },
{ curie: 'sa:pledgeLastMarkedAt',          datatype: 'uint256' },
{ curie: 'sa:pledgePaymentRail',           datatype: 'bytes32' },
{ curie: 'sa:pledgeEvidenceHash',          datatype: 'bytes32' },
{ curie: 'sa:pledgeMarkedByAgent',         datatype: 'address' },
```

No new SHACL class registrations required (we extend `sa:Pledge`'s
shape, which is already defined in spec-004's `defineSpec004Shapes`).
Extend the existing shape via `ShapeRegistry.addProperty`.

---

## 6. Cross-references

- T-Box turtle: `docs/ontology/tbox/spec005-pledge-honor.ttl` (to author).
- Contract predicate constants: `packages/contracts/src/PledgeRegistry.sol` (extend).
- Reader concept-hash reverse maps: `apps/org-mcp/src/lib/pledge-reader.ts` (extend).
- IA classification: `docs/information-architecture/12-pledge-honor-classification.md`.
- Settlement rail semantics: `specs/005-pledge-honor/settlement-rails.md`.
