# Spec 005 — Evidence Storage

> **Owners**: Information Architect + Developer.
> **Bound to**: `plan.md` (Q4 locked), `12-pledge-honor-classification.md` (rows 9, 11).

## The pattern: hash on chain, blob in MCP

```
On chain:                     In org-mcp:                    On disk:
─────────                     ───────────                    ────────
sa:pledgeEvidenceHash         evidence_blobs table          uploaded receipts
0xabc123...   ◀──content──    hash | org_principal |        (PDFs / images /
              addressed       mime_type | body |             bank statements)
                              uploaded_at
```

Chain stores a 32-byte sha256 of the evidence document. The actual document lives in org-mcp's SQLite. Anyone with the document can recompute the hash and verify the on-chain anchor.

## Why sha256, not keccak256

| | sha256 | keccak256 |
|---|---|---|
| EVM cost | precompile (cheap) | builtin (cheaper) |
| Off-chain tooling | every language, every CLI | EVM ecosystem only |
| Verifying without web3 stack | `sha256sum file.pdf` works on every laptop | requires keccak lib |
| Receipt-style auditing | standard | unusual |

Decision: **sha256**. Compliance + audit teams already use sha256 for content integrity. They don't need to install a keccak CLI to verify a receipt matches the on-chain hash.

## v1 surface (no HTTP fetch)

### Mark-paid flow

1. Admin clicks "Mark paid" on a pledge.
2. Admin uploads receipt PDF/image in the form.
3. Web computes `sha256(file)` client-side via `crypto.subtle.digest`.
4. Web POSTs to org-mcp `/evidence/store` (admin-authenticated):
   - Body: `{ hash, mimeType, body (base64) }`.
   - Returns: `{ ok: true, hash }`.
5. Web mints the markPaid sub-delegation pinning `keccak256(markPaidCalldata)` where the calldata includes the sha256 evidence hash as a bytes32 arg.
6. Admin signs with passkey.
7. A2A redeems → `PledgeRegistry.markPaid(...)` fires.

### Reader flow

1. Pool detail page renders pledge settlements.
2. For each pledge with `pledgeEvidenceHash != 0`, render a "View evidence" link.
3. v1: the link opens a local org-mcp HTTP endpoint `GET /evidence/:hash` **only if the viewer is the admin of the org that hosted the upload**. Otherwise the link is dead.

### Failure modes (v1)

| Mode | What happens | Mitigation |
|---|---|---|
| Admin loses receipt PDF | Hash is on chain but no one can produce the document | Admin's responsibility; org-mcp standard backup |
| Admin uploads to wrong org-mcp | Cross-org viewer can't fetch | v1: ask the admin for a copy; v2 adds cross-org resolver |
| Hash collision | Theoretically impossible | sha256 collision resistance — out of scope |
| Evidence is fraudulent / fabricated | Chain records a hash; no one verifies the doc | Reputational — admin's audit history is public on chain |

## v2 surface (deferred — `v2-backlog.md` § V2.5)

`GET /evidence/:hash` on org-mcp:

- Auth: viewer must be a member of the pool/fund whose pledge references this hash (per IA P3).
- Returns: blob bytes + mime type if found locally.
- 404 if not found OR if viewer is unauthorized (don't leak existence).

**Cross-org resolution**: if org A hosts the evidence and org B's user wants to view it, B's org-mcp can proxy-fetch from A's org-mcp via a federation handshake (cross-delegation). Pattern: org-mcps in the same hub trust each other's evidence resolutions; cross-hub requires explicit cross-delegation.

## v2 surface: optional IPFS / Arweave (deferred — § V2.4)

Hash on chain stays the same (sha256 of the blob). An adjacent registry maps hashes to retrieval URIs (`ipfs://Qm...`, `ar://abc...`, `org-mcp://...`). Any party can pin a blob and add a URI; the chain remains the integrity anchor.

## Schema (org-mcp `evidence_blobs`)

```sql
CREATE TABLE IF NOT EXISTS evidence_blobs (
  hash             BLOB PRIMARY KEY,     -- 32 bytes (sha256)
  org_principal    TEXT NOT NULL,        -- uploader's org-mcp principal
  mime_type        TEXT NOT NULL,
  body             BLOB NOT NULL,        -- the document bytes
  uploaded_at      TEXT NOT NULL         -- ISO timestamp
);

CREATE INDEX idx_evidence_org ON evidence_blobs(org_principal);
```

**Size limit**: 5 MB per blob in v1 (typical receipt PDFs are < 1 MB). Larger documents return 413; the admin should host them off-system and just commit the hash.

## Cross-cuts

- **IA P3 compliance**: evidence content lives in org-mcp, never in web SQL, never on GraphDB.
- **IA P4 compliance**: org-mcp does NOT push evidence to GraphDB. Only the on-chain hash mirrors via the existing on-chain → GraphDB sync.
- **Principle P1 (substrate independence)**: no IPFS / Pinata / NFT.storage / Arweave dependency at runtime in v1. Pure org-mcp + chain.

## Reader pattern (for the spec-005 reader extension)

```typescript
// apps/org-mcp/src/lib/pledge-reader.ts (extended)
const SA_PLEDGE_EVIDENCE_HASH = keccak256(toHex('sa:pledgeEvidenceHash'))

async function readEvidence(pledgeSubj: Hex): Promise<{
  hash: Hex | null
  rail: string | null
  markedBy: Address | null
}> {
  // ... readContract calls for the 3 attributes ...
}
```

The reader doesn't fetch the blob — that's the UI's responsibility (via `/evidence/:hash` when shipped, manual share in v1).
