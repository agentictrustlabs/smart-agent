# A5 — User-Action Provenance Chain

> **Status**: Draft. The correlation-id primitive landed in Hardening
> Phase 1D (`correlation_id` column on `execution_audit`); A5 specifies
> the schema that wraps it into a queryable provenance chain, the
> propagation contract end-to-end, the on-chain binding strategy, and the
> lookup interface the support team / regulator uses.
>
> **Effort**: M (lookup interface + on-chain binding) + S (docs / SOPs).
>
> **Owner**: developer + security.
>
> **Reading time**: ~25 min.

---

## 1. Goal

Given **any** of these inputs, produce the complete provenance chain:

- A UI click recorded in browser RUM
- A web request log line
- An a2a-agent audit row
- A person-mcp / org-mcp audit row
- A bundler-submitted userOpHash
- A confirmed on-chain transaction hash
- A user-supplied "support ticket number"

The provenance chain is the linked record from **the originating UI click
through to the final on-chain settlement**, including every intermediate
authority-bearing decision (delegation mint, session-token issue, MCP
tool authorisation, bundler submission). It is the single artefact we
hand to:

- A customer disputing a transaction.
- A regulator investigating an authority abuse claim.
- An incident commander reconstructing what happened.

## 2. Schema

The provenance chain is a derived view over six log sources, joined by a
single id.

### 2.1 Core join key — `traceId`

- **Format**: W3C [traceparent](https://www.w3.org/TR/trace-context/)
  `trace-id` field — 16-byte hex string, e.g. `4bf92f3577b34da6a3ce929d0e0e4736`.
- **Source of truth**: assigned at the browser edge by RUM or, if RUM
  is not active for a session, by the web edge middleware at the first
  request that authenticates a session.
- **Propagation**:
  - Inside the browser, the trace id is stored in `sessionStorage` and
    embedded in every subsequent outbound fetch via the
    `traceparent: 00-<trace-id>-<span-id>-01` header.
  - Server-side, every Smart Agent service preserves and forwards the
    `traceparent` header on every outbound call.
  - A complementary `X-SA-Correlation-Id` header carries the same trace
    id for legacy / non-W3C consumers (the existing `correlation_id`
    column in `execution_audit` already uses this form).
- **Storage**:
  - `execution_audit.correlation_id` (already exists, Phase 1D)
  - `audit_log.correlation_id` (person-mcp; add via migration)
  - `audit_log.correlation_id` (org-mcp; add via migration)
  - Vercel log lines via the existing Pino correlation-id middleware
  - Datadog log facet `@correlation_id`
  - On-chain events — see §5.

### 2.2 Provenance record shape

The provenance chain produced by the lookup interface (§4) has this
shape:

```typescript
// apps/web/src/lib/provenance/types.ts (NEW)
export interface ProvenanceChain {
  traceId: string

  // The originating click — present if RUM was active for the session.
  originatingClick?: {
    timestamp: string
    userIdHashed: string
    sessionId: string
    page: string            // e.g. /h/catalyst/pool/abc/contribute
    actionLabel: string     // semantic action name set by the React component
    actionType: 'mint_delegation' | 'submit_user_op' | 'contribute' | 'pledge' | ...
    browserMetadata: {      // sparse — only what RUM captured
      userAgent?: string
      city?: string         // coarse geo, no IP
    }
  }

  // Every web-edge request bound to this trace id, in order.
  webRequests: Array<{
    timestamp: string
    method: string
    path: string
    statusCode: number
    userIdHashed: string | null
    sessionId: string | null
    durationMs: number
  }>

  // Every a2a-agent / person-mcp / org-mcp authority-bearing decision
  // bound to this trace id, in order.
  authorityDecisions: Array<{
    service: 'a2a-agent' | 'person-mcp' | 'org-mcp'
    timestamp: string
    eventType: string
    eventKind: 'request_received' | 'request_finalized' | 'request_denied'
    sessionId: string
    sessionPrincipal: string
    delegationId?: string
    target?: string         // contract address if relevant
    selector?: string       // function selector if relevant
    auditRowId: number      // PK in the originating service's audit table
    auditEntryHash: string  // chain-row hash for cryptographic anchoring
    status: 'completed' | 'reverted' | 'denied' | 'pending'
    errorReason?: string
  }>

  // Bundler / userOp activity.
  userOps: Array<{
    timestamp: string
    userOpHash: string
    sender: string
    bundlerTxHash?: string
    onChainBlock?: number
    onChainStatus?: 'success' | 'reverted'
  }>

  // On-chain settlement(s).
  transactions: Array<{
    chainId: number
    txHash: string
    blockNumber: number
    blockTimestamp: string
    from: string
    to: string
    valueWei: string
    eventsEmitted: Array<{ topic: string; data: string }>
  }>

  // Cryptographic verification — fields the verifier needs to cross-check
  // the chain against the L4 anchor.
  verification: {
    auditAnchorCheckpoint: {
      checkpointTimestamp: string
      latestEntryHash: string
      s3Url: string
      ethereumTxHash?: string
    } | null
  }
}
```

### 2.3 Why this shape

- **Ordered, not graph**: the chain is sequenced by timestamp; downstream
  consumers don't have to traverse a DAG.
- **Service-attributed**: every row says which service produced it; cross-
  service joins are explicit.
- **Audit-row-linked**: every authority decision carries the originating
  audit row's PK + hash, so a reviewer can re-verify against the chain.
- **No raw PII**: `userIdHashed` is hashed; raw user id never leaves the
  source service. Mapping back to a raw id requires the source service's
  separate, audit-logged unhashing operation (governed by P3 when written).

## 3. Propagation contract

```
Browser (RUM-assigned traceparent)
   │
   │  HTTP fetch with `traceparent: 00-<traceId>-<spanId>-01`
   ▼
Vercel edge — middleware sets `X-SA-Correlation-Id` from `traceparent`
   │
   │  internal call (Next.js server actions / API routes)
   ▼
apps/web — passes through to outbound a2aFetch
   │
   │  inter-service MAC envelope carries traceId in the canonical message
   │  (already part of canonical-v2 — see project_kms_initiative)
   ▼
apps/a2a-agent — every audit row carries correlation_id
   │
   │  → MCP outbound: a2a-client.ts forwards `X-SA-Correlation-Id`
   │  → bundler: userOp metadata includes traceId
   ▼
person-mcp / org-mcp — audit_log.correlation_id (after A5 migration)
   │
   ▼
bundler service — submits userOp; traceId in tx callData OR off-chain
   index (see §5)
   │
   ▼
On-chain — AgentAccount emits event indexed by traceId (see §5)
```

Each hop has a CI guard that asserts the header is preserved:

- `scripts/check-correlation-id-propagation.ts` (NEW) walks the codebase
  for every `fetch(`, `client.send(`, `userOp` construction, and asserts
  the traceId is either propagated or explicitly excluded with a
  documented reason.
- The check is added to `pnpm check:all` (existing aggregate).

## 4. Lookup interface

### 4.1 Programmatic API

```typescript
// apps/web/src/lib/provenance/lookup.ts (NEW)

/** Given any of the supported lookup keys, return the full chain. */
export async function lookupProvenance(
  input:
    | { traceId: string }
    | { userOpHash: string }
    | { txHash: string; chainId: number }
    | { auditRowId: number; service: 'a2a-agent' | 'person-mcp' | 'org-mcp' }
    | { supportTicketId: string },
  options?: { includeRaw?: boolean },
): Promise<ProvenanceChain>
```

Implementation:

1. Resolve the input to a `traceId`:
   - `traceId` — pass through.
   - `userOpHash` — query `apps/a2a-agent`'s `executionAudit` for the
     matching row's `correlation_id`.
   - `txHash` — fetch on-chain receipt + decode the event topic per §5
     to extract traceId. If §5 binding isn't possible (legacy tx), fall
     back to the `userOpHash → traceId` path via the bundler's off-chain
     index.
   - `auditRowId` — direct lookup.
   - `supportTicketId` — query the support-ticket table; the support team
     records traceId on ticket creation (`apps/web/src/lib/support/`).
2. Fan out queries to:
   - Datadog Logs (for L5/L6/L7 web/MCP stdout)
   - `execution_audit` (L1)
   - person-mcp `audit_log` (L2)
   - org-mcp `audit_log` (L3)
   - Bundler service's `userop_index` table
   - On-chain RPC for receipts of the matching tx hashes
3. Stitch results into the `ProvenanceChain` shape.
4. If `includeRaw=true` AND caller is authorised (operator with the
   `provenance:raw` scope), include the unhashed user id and raw IP. Default
   is hashed-only.

### 4.2 CLI

```
$ pnpm tsx scripts/provenance-lookup.ts --tx 0xabc... --chain 11155111

[provenance] traceId resolved: 4bf92f3577b34da6a3ce929d0e0e4736
[provenance] originatingClick: 2026-05-18T14:23:01Z user=2ef3a... action=submit_user_op
[provenance] 4 web requests (2 auth, 2 mutation)
[provenance] 7 authority decisions (a2a-agent: 5, person-mcp: 2)
[provenance] 1 userOp (0xdef...)
[provenance] 1 on-chain tx (block 5,123,876)
[provenance] verification: chain head matches L4 anchor at 2026-05-18T14:30:01Z
[provenance] OK
```

### 4.3 UI

Operator UI at `/admin/provenance/<traceId>` rendering the chain as a
timeline + a JSON-export button. Requires the `provenance:read` admin
scope.

`[OWE-REVIEWER]` — operator UI must NOT allow editing of any audit row;
it is strictly read-only. Verified by a property test.

## 5. On-chain ↔ off-chain binding

**The hard problem**: a Solidity event topic is `bytes32` and is
public; a traceId is 16 bytes and we'd prefer it not be globally
public. Three options:

### 5.1 Option A — Index the traceId hash on-chain

- Emit an event `event UserOpExecuted(bytes32 indexed traceIdHash, ...)`
  where `traceIdHash = keccak256(secretSalt || traceId)`.
- The salt is per-deployment-environment and stored in a2a-agent's
  config; an attacker watching the chain sees the hash but cannot reverse
  it to the trace id without the salt.
- Lookup: given a traceId, we compute the hash and grep events.
- Pros: Strong link, on-chain immutable, gas-cheap (~32 gas for the
  indexed topic).
- Cons: Salt rotation invalidates the index for old txs; loss of salt
  = loss of binding for new txs only (old binding hashes stay valid
  forever).

### 5.2 Option B — Off-chain index table

- The bundler service maintains a `userop_index` table mapping
  `(userOpHash, txHash, traceId)`.
- Lookup: given a txHash, fetch the userOp by tx hash, then lookup
  traceId in the index.
- Pros: No on-chain cost or surface. Salt-rotation-free.
- Cons: The index is a single trust point — if the bundler service is
  compromised, the binding is forgeable. Mitigated by mirroring the index
  into the audit chain (L1) so every bundler-submitted userOp lands in
  L1 with its traceId; the on-chain tx then carries the userOpHash in
  its event data per ERC-4337, and we trust the audit chain (which has
  L4 anchoring) to bind userOpHash → traceId.

### 5.3 Option C — calldata blob (rejected)

- Append the traceId to the userOp `callData` so it's recoverable from
  the on-chain tx.
- Cons: Wastes gas; widens the userOp validation surface; some bundlers
  strip non-standard calldata trailers. **Rejected.**

### 5.4 Decision

`[DECISION]` — **Option B (off-chain index, anchored via L1 audit
chain)** for v1. Justification:
- L1 + L4 already give us cryptographic tamper-evidence; piggyback on
  that rather than introducing an on-chain side channel.
- Salt management adds operational complexity (rotation, escrow, K1
  cadence).
- Option A remains an opt-in upgrade path: customers wanting on-chain-
  verifiable provenance can request it as a paid feature.

Implementation note: every userOp submission in the bundler service
appends a row to `execution_audit` with `event_type:user_op_submitted`,
`user_op_hash`, `tx_hash` (populated post-inclusion), and `correlation_id`.
This is *already* the existing audit shape — A5 just makes the
correlation id NOT-NULL on that row class going forward.

## 6. Use cases

### 6.1 Customer dispute

> "Why was 50 USDC sent from my account at 14:23 yesterday?"

1. Customer support obtains the customer-supplied tx hash.
2. Support runs `lookupProvenance({ txHash, chainId })`.
3. Returns the chain — originating click + page + delegation chain + the
   exact authority that authorised the spend.
4. Support shares a sanitised view (no raw IP, no internal service URLs)
   with the customer.

### 6.2 Regulatory investigation

> "Provide the complete authorisation chain for this transaction."

1. Regulator provides tx hash.
2. Operator runs the same lookup with `includeRaw=true`.
3. Output is signed (operator's identity + timestamp) and provided as a
   PDF.
4. The regulator can independently verify each authority decision against
   our published audit-chain methodology (A1's verification procedure).

### 6.3 Security incident

> "We saw an anomalous delegation mint at 13:50. What followed?"

1. Incident commander has the audit row id.
2. Looks up the chain forward: every authority decision and on-chain
   action descended from that delegation mint.
3. Drives the containment + eradication steps in A6.

### 6.4 Internal feature debugging

> "Why did this pool contribution fail mid-flow?"

1. Engineer obtains traceId from browser console (RUM exposes it).
2. Runs CLI; sees the cascade — likely a denial row from person-mcp's
   PII access decision.
3. Roots out the cause in minutes, not hours.

## 7. Privacy considerations

- TraceIds are NOT customer identifiers — they reset per browser session,
  and we explicitly do not link traceIds across sessions for the same
  user.
- Operator override `includeRaw=true` is itself logged in L1 with the
  operator's signed-in identity; abuse of the unhashing path is
  auditable.
- Customer-facing provenance views (6.1) **do not** include raw IP, raw
  user agent, raw email, or raw internal service hostnames.
- Cross-references P3 (when written) for the canonical PII policy.

## 8. Cost

- Off-chain `userop_index` table is < 1 GB at 100× scale; included in
  bundler service cost.
- Datadog query overhead per lookup is negligible (< $0.001/query at
  current pricing).
- Operator UI is part of `apps/web`; no incremental hosting cost.
- On-chain Option A (if a customer requests it as a paid feature):
  adds ~5k gas per userOp emit (≈ $0.50 at current gas prices) =
  pass-through cost in pricing.

## 9. Implementation tasks

| # | Task | Owner | Effort |
|---|---|---|---|
| A5-T1 | Add `correlation_id` column to person-mcp `audit_log` + org-mcp `audit_log` | developer | S |
| A5-T2 | `apps/web/src/middleware.ts` — assert `traceparent` set or assign one | developer | S |
| A5-T3 | RUM integration in browser; trace id stored in sessionStorage | developer | M |
| A5-T4 | `scripts/check-correlation-id-propagation.ts` CI guard | developer | M |
| A5-T5 | `apps/web/src/lib/provenance/lookup.ts` impl + tests | developer | M |
| A5-T6 | `scripts/provenance-lookup.ts` CLI | developer | S |
| A5-T7 | Operator UI `/admin/provenance/<traceId>` | developer + UI designer | M |
| A5-T8 | `apps/web/src/lib/support/` — bind traceId to support tickets at creation | developer | S |
| A5-T9 | Bundler service `userop_index` (already exists in part — confirm and document) | developer | S |
| A5-T10 | Customer-facing provenance export PDF template + sanitisation rules | legal + product | M |

## 10. Acceptance criteria

- [ ] Trace id present on 100% of audit rows in L1/L2/L3 after migration
- [ ] CI guard rejects any new outbound call without traceId propagation
- [ ] CLI `provenance-lookup.ts` returns a complete chain for the
      end-to-end happy path (UI click → on-chain tx)
- [ ] Operator UI shipped + behind `provenance:read` scope
- [ ] Customer-facing PDF export reviewed by legal
- [ ] Sample chain attached to the standard customer security
      questionnaire response

## 11. Open questions

- `[OPEN] A5-1`: Should we accept a customer-provided trace id (allow the
  customer to embed their own correlation id in our chain)? Adds an
  integration surface; defer until first request.
- `[OPEN] A5-2`: Cross-chain provenance — if a multi-chain action splits
  into a tx on chain A and a tx on chain B, the chain shows both? Yes;
  the schema's `transactions[]` is already an array. Document explicitly
  once a multi-chain feature ships.
- `[OPEN] A5-3`: Retention of off-chain `userop_index` rows — they're
  L1-adjacent; assume 7-year retention per A2.

## 12. Cross-references

- A1 — anchor verification appears in the chain's `verification` field
- A2 — every chain source's retention is documented in A2 §3
- A3 — chain queries flow through Datadog's index
- A4 — anomaly events carry traceId for the chain-forward forensics in 6.3
- A6 — incident runbooks reference §6.3 + §6.4 use cases
- ED5 — sub-processor data flows are part of the privacy story; verify
  no sub-processor sees raw user id

## 13. Glossary

- **traceId** — 16-byte W3C trace-context identifier; the chain's join
  key.
- **correlationId** — synonym used in legacy headers / column names;
  identical value, different header name (`X-SA-Correlation-Id`).
- **provenance chain** — the linked record from UI click to on-chain
  settlement; this doc's central artefact.
- **hashed user id** — `sha256(userId)`; the form used outside the
  source service.
- **off-chain index** — the bundler service's `userop_index` table
  binding userOpHash to traceId; anchored via the L1 audit chain.

---

*Last updated: 2026-05-18. Owner: Security agent + Developer agent.*
