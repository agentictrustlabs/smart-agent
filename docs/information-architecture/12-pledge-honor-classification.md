# IA Classification — Spec 005 (Pledge Honor & Treasury)

> **Bound to**: `specs/005-pledge-honor/plan.md`.
> **Principles applied**: P2 (chain is source of truth for public state), P3 (private body in MCP), P4 (no MCP→GraphDB direct pipe).

## 1. Per-artifact store + tier

| # | Artifact | Store | Tier | Why this store / tier |
|---|---|---|---|---|
| 1 | `MockUSDC` balance | chain (ERC-20 state) | Public | Standard ERC-20. Dev-only. |
| 2 | Personal treasury AgentAccount existence + owners | chain (AgentAccount state) | Public-coarse | Same tier as any AgentAccount; owners are queryable on chain. |
| 3 | `sa:hasPersonalTreasury` link (person → treasury) | chain (AgentAccountResolver) | Public-coarse | The link is the privacy boundary — once published, treasury → person → all pledges they made is queryable. Documented in `threat-model.md`. |
| 4 | `users.personalTreasuryAddress` (web SQL cache) | web SQLite | Cache only | Source of truth is chain. Cache is for fast UI reads. NOT for passkey/SIWE users (they have no `users` row). |
| 5 | `pledgeHonoredAmount[token]` | chain (PledgeRegistry, composite subject) | Public | Public per the existing pledge tier. Aggregate visibility. |
| 6 | `pledgeExternallyPaidAmount[token]` | chain (PledgeRegistry, composite subject) | Public-coarse | Public *that* an external payment happened + amount; the evidence content is gated. |
| 7 | `pledgeHonorTokenList` | chain (PledgeRegistry) | Public | Index of tokens with non-zero settlement; readers walk this. |
| 8 | `pledgePaymentRail` | chain (PledgeRegistry) | Public-coarse | Method label (bank, check, cash, etc.); does not leak amount-by-amount detail. |
| 9 | `pledgeEvidenceHash` | chain (PledgeRegistry) | Public | The hash itself is opaque (just a digest); doesn't reveal the document. |
| 10 | `pledgeMarkedByAgent` | chain (PledgeRegistry) | Public-coarse | Pool admin identity is already public for the round; identifying them here is consistent. |
| 11 | Evidence blob content (PDF / receipt image / etc.) | org-mcp (`evidence_blobs` table) | Private | Uploaded by org admin. Contains receipt details, bank statements — sensitive PII. |
| 12 | Honor history (events) | chain (event log) | Public | Standard event stream. Indexable, queryable from any RPC. |
| 13 | Treasury USDC transfers | chain (ERC-20 Transfer events) | Public | Standard. Donor `treasury → pool` is identifiable on chain. |

## 2. Aggregate view per pledge (UI surface)

The pool pledge detail page renders a derived "settled total" computed at read time from the chain:

```
settledTotal[token] = honored[token] + externallyPaid[token]
remainingPledged[token] = max(0, committedAmount - settledTotal[token])
isFullyHonored = (settledTotal[settlementToken] >= committedAmount)
```

For `committedAmount`, see existing `sa:pledgeAmount` (already public).

For non-USDC pledges in v1, `honored[USDC]` is irrelevant; only `externallyPaid[<unit>]` accumulates via `markPaid`. UI surfaces this as "Attested settlements only" (see `settlement-rails.md`).

## 3. Compliance with IA invariants

### 3.1 P2 — Chain is source of truth for public state

All settlement state is on chain. The web `users.personalTreasuryAddress` is a *cache* of the on-chain `sa:hasPersonalTreasury` link, not the source. Recovery: fresh-start re-derives from chain on each boot.

### 3.2 P3 — Private body in MCP

Evidence blobs live in `org-mcp.evidence_blobs`. The on-chain `pledgeEvidenceHash` is a content anchor, not a pointer to private data.

### 3.3 P4 — No MCP → GraphDB direct pipe

The honor + mark-paid events flow into GraphDB via the existing on-chain → GraphDB sync (extended in `apps/web/src/lib/ontology/graphdb-sync.ts`). The evidence blob never touches GraphDB; only its hash does.

### 3.4 P5 — Stateless auth coherence

`personalTreasuryAddress` cache is only populated for users with a `users` row (demo + google). Passkey/SIWE users resolve their treasury via the on-chain `sa:hasPersonalTreasury` link each time.

## 4. Cross-org evidence (v2 consideration)

In v1, an evidence blob lives in the org-mcp that the pool's admin uploaded it from. If a pool is operated by Org A but the donor's home-mcp is Org B, the evidence is hosted by A, not B. That's fine since the *hash* on chain is universal and any party can recompute it if they have the blob.

For v2, an HTTP `/evidence/:hash` endpoint on org-mcp with viewer-membership gating allows cross-org resolution. Documented in `v2-backlog.md` § V2.5.

## 5. Privacy posture (informational)

- **Donor → pool transfers are linkable** by anyone watching chain events. Donor's personal treasury maps via `sa:hasPersonalTreasury` to the person agent. v1 accepts this.
- **External payments are attested, not proven**. Anyone can mark-paid with a fabricated evidence hash — the pool admin's reputation is the only check. Mitigations: `pledgeMarkedByAgent` is on chain, audit history per admin is public.
- **Evidence content is private**, but anyone who has it can verify it matches the chain hash. Useful for honest audits, ineffective against malicious "lost the doc" scenarios.

See `threat-model.md` for the full security analysis.
