# Smart Agent — Performance & Latency Assessment + Plan

Status: **PROPOSED** (2026-05-17) — user-prioritized BEFORE 1claw + Namera feature work.
Goal: Detailed audit of current perf bottlenecks across the web app feature set, plus a sequenced plan to move from "rebuild-the-mirror after every write" toward event-driven incremental sync, watermarks, multicall reads, batched MCP tools, and async user-visible writes.

This plan reorders the roadmap:
1. Performance & latency (THIS plan)
2. Demo video re-record (after perf wins land)
3. 1claw priority features (`output/1CLAW-INSPIRED-FEATURES-PLAN.md`)
4. Namera wallet execution layer (`output/NAMERA-WALLET-EXECUTION-PLAN.md`)

---

## Demo-recording triage (immediate blockers, fix before plan execution)

The Playwright demo recording (`tests/e2e/grant-flow-full-ui-demo.spec.ts`) failed at chapter 3 (Maria creates a pool). Two root causes surfaced:

### Blocker 1: `node:crypto` leaks into the web client bundle
**Symptom**: `Module build failed: UnhandledSchemeError: Reading from "node:crypto" is not handled by plugins` in `apps/web/.next` build.
**Trace**: `apps/web/src/hooks/use-a2a-session.ts` → `@smart-agent/sdk` → `key-custody/index.ts` → `key-custody/local-hmac.ts` → `node:crypto`.
**Root cause**: `packages/sdk/src/index.ts:165` does `} from './key-custody'` in an `export type {}` block. The block is type-only but webpack still resolves the imported module's full graph (including `local-hmac.ts` which uses `node:crypto`). Memory entry already records this exact regression pattern from K3-ext.
**Fix**: split key-custody types into a `types.ts` (no runtime imports) and only re-export from there. Or, drop the type re-exports from the main barrel and require client callers to import the few types they need directly from the subpath. **Smallest fix**: change `export type { ... } from './key-custody'` → `export type { ... } from './key-custody/types'` (the existing types-only file).

### Blocker 2: Dev-mode rate limit 429s during demo
**Symptom**: a2a-agent log shows 429 on rapid `/session/init` and `/mcp/hub/sync:schedule` calls.
**Root cause**: `apps/a2a-agent/src/middleware/rate-limit.ts` (60/min on general; 10/min on `/session/init`) trips during the Playwright demo's tight Maria→David→Sarah→Maria sign-in loop AND the broad-sync calls that fire after each write.
**Fix**: two paths
1. **Short-term**: env-tunable rate-limit thresholds with dev defaults raised (e.g. `RATE_LIMIT_SESSION_INIT_MAX=60`). Keep prod defaults tight.
2. **Structural**: reduce the call volume that triggers the limit — fix the broad-sync-after-write pattern (the rest of this plan).

These two blockers are quick fixes (~30 min total) and will unblock demo re-recording. The structural perf work below makes the demo materially faster + smoother on its own merits.

---

## Current architecture audit

### Where time goes today

```
Browser (form submit)
  → Next.js server action
    → A2A /session/init or /redeem-*           (network)
      → MCP tool call (person/org/hub/...)     (network)
        → contract write via session signer    (chain settlement)
        ← receipt
        → hub-mcp sync:schedule (broad)        (full chain re-scan)
        → graphdb DELETE + INSERT (many subjects) (graphdb roundtrips)
      ← MCP response
    ← A2A response
  ← server-action response
  → page navigate → reads
    → multiple Next.js server-component fetches → MCP reads → on-chain reads (serial)
```

Empirically from the demo recording, chapter 3 (pool create) exceeded 120s waiting for navigation to the new pool URL. The submit succeeded on-chain but the post-submit sync + render path stalled.

### The five biggest cost centers

1. **Broad GraphDB sync after every write**.
   - `apps/web/src/lib/clients/hub-client.ts:220` — `callHub('sync:schedule', { eager })` triggers `syncOnChainToGraphDB()` which re-emits ALL agents + ALL pools + ALL rounds + ALL commitments.
   - `apps/hub-mcp/src/lib/kb-write-through.ts:65` — write-through calls `mod.syncOnChainToGraphDB()` (broad).
   - `apps/web/src/lib/boot-seed.ts:236` — boot path also calls broad sync (acceptable here).
   - Targeted subject sync helpers EXIST (`syncPoolToGraphDB`, `syncRoundToGraphDB`, `syncSubjectToGraphDB`) but are not consistently used.

2. **Serial on-chain reads on every page render**.
   - No multicall aggregation. Every `readContract` is a separate `eth_call`. Pool detail pages, round detail pages, dashboard tiles each fire 5-20+ serial reads.

3. **MCP-to-MCP chains during page load**.
   - Page render → web server-component → MCP A → MCP B → MCP A. Multiple network hops in serial during the user's perceived navigation.

4. **No subject-level cache invalidation**.
   - Discovery cache in `apps/hub-mcp/src/tools/discovery.ts` exists but invalidates broadly. A new vote on round X invalidates ALL round caches, not just round X.

5. **Synchronous user-visible writes wait for full sync**.
   - The submit waits for chain confirmation + GraphDB sync before the redirect. The user sees a stalled spinner instead of an immediate "submitted, syncing in background" state.

### What's already good (don't redo)

- Contracts emit comprehensive events (`PoolOpened`, `RoundOpened`, `VoteCast`, `PledgeSubmitted`, `Committed`, `Released`, `ProposalSubmitted`, etc.). This is the data substrate for event-driven sync.
- Targeted subject-level sync helpers exist: `syncSubjectToGraphDB`, `syncPoolToGraphDB`, `syncRoundToGraphDB`. Just not used from write paths.
- Discovery cache exists in hub-mcp (`apps/hub-mcp/src/tools/discovery.ts`).
- Write-through pattern is already isolated in `apps/hub-mcp/src/lib/kb-write-through.ts` (one place to change).
- hub-mcp is the consolidation point for GraphDB writes (P5 of the A2A-first routing consolidation).

---

## The plan

Six tracks, sequenced so the largest wins land first.

### Track 1 — Event-driven incremental sync (the headline change)

**Today**: write → broad chain-rescan → broad GraphDB rebuild.

**Target**:
```
1. MCP submits tx (via A2A session signer).
2. Receipt arrives.
3. MCP decodes emitted logs (we already have ABIs).
4. MCP maps logs → affected subjects via an `event_to_subject` table.
5. MCP enqueues sync jobs in `sync_jobs` (per affected subject).
6. hub-mcp's sync worker pulls jobs, updates only those subjects in GraphDB.
7. Cache invalidates only affected subject keys.
8. User-visible write response returns BEFORE sync completes; UI shows "syncing..." pill until subject is observed in next read.
```

**Schema** (in hub-mcp's SQLite):
```sql
CREATE TABLE sync_jobs (
  id INTEGER PRIMARY KEY,
  subject_iri TEXT NOT NULL,
  subject_kind TEXT NOT NULL,             -- 'pool' | 'round' | 'proposal' | 'pledge' | 'commitment' | 'agent' | ...
  trigger_kind TEXT NOT NULL,             -- 'log' | 'manual' | 'reconcile'
  log_block_number INTEGER,               -- for ordering + dedup
  log_tx_hash TEXT,
  log_index INTEGER,
  enqueued_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'in_flight' | 'done' | 'failed'
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  completed_at INTEGER
);
CREATE INDEX idx_sync_jobs_status ON sync_jobs(status, enqueued_at);
CREATE UNIQUE INDEX uniq_sync_jobs_log ON sync_jobs(log_tx_hash, log_index) WHERE log_tx_hash IS NOT NULL;

CREATE TABLE sync_watermarks (
  contract_address TEXT NOT NULL,
  last_block_synced INTEGER NOT NULL,
  last_block_hash TEXT NOT NULL,          -- for reorg detection
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (contract_address)
);
```

**Event-to-subject mapping** (TypeScript, deterministic):
```ts
// apps/hub-mcp/src/lib/event-to-subject.ts
export function mapLogToSubjects(log: Log): SyncSubjectRef[] {
  switch (`${log.address.toLowerCase()}::${log.topics[0]}`) {
    case `${POOL_REGISTRY}::${POOL_OPENED_TOPIC}`:
      return [{ kind: 'pool', iri: poolIri(log.args.poolAddress) }]
    case `${ROUND_REGISTRY}::${ROUND_OPENED_TOPIC}`:
      return [{ kind: 'round', iri: roundIri(log.args.roundAddress) },
              { kind: 'pool', iri: poolIri(log.args.poolAddress) }]  // pool aggregate touched
    case `${VOTE_REGISTRY}::${VOTE_CAST_TOPIC}`:
      return [{ kind: 'proposal', iri: proposalIri(log.args.proposalId) },
              { kind: 'round', iri: roundIri(log.args.roundAddress) }]
    case `${PLEDGE_REGISTRY}::${PLEDGE_SUBMITTED_TOPIC}`:
      return [{ kind: 'pledge', iri: pledgeIri(log.args.pledgeId) },
              { kind: 'pool', iri: poolIri(log.args.poolAddress) }]
    // ... full coverage of contract events
  }
}
```

**Sync worker** (runs in hub-mcp, polls `sync_jobs`):
- Pulls oldest `pending` job per subject (dedup so 5 votes on the same proposal in 60s coalesce to one re-emit).
- For each affected subject, calls the existing targeted helper (`syncSubjectToGraphDB(subjectIri)`).
- Marks job `done`. On failure, retry with exponential backoff up to 5 attempts; then mark `failed` and audit.
- Surfaces queue depth + per-subject staleness via a debug endpoint hub-mcp owns.

**Subject delta** (per subject):
- Fetch the canonical state of that one subject (one or two `readContract` calls, ideally via multicall).
- Emit turtle for just that subject's predicates.
- GraphDB DELETE+INSERT scoped to that subject IRI.

**PR-Perf-T1-A**: schema + `event_to_subject` mapping + sync worker scaffold.
**PR-Perf-T1-B**: write paths swap from `sync:schedule` → enqueue-and-return.
**PR-Perf-T1-C**: deprecate broad `syncOnChainToGraphDB` from request paths (boot-seed keeps it; user-facing flows do not).

---

### Track 2 — Per-contract watermarks + log-only sync

**Today**: hub-mcp's `syncOnChainToGraphDB` rescans every contract from genesis on every sync trigger.

**Target**: hub-mcp tracks per-contract `last_block_synced` + `last_block_hash`. The sync worker reads `getLogs(fromBlock = watermark+1, toBlock = latest)` once per contract per tick.

**Algorithm**:
```ts
async function tickWatermarks() {
  for (const contract of watchedContracts) {
    const wm = await getWatermark(contract.address)
    const latest = await publicClient.getBlockNumber()
    if (latest === wm.lastBlockSynced) continue
    const logs = await publicClient.getLogs({
      address: contract.address,
      fromBlock: wm.lastBlockSynced + 1n,
      toBlock: latest,
    })
    // Reorg detection — see Track 3.
    for (const log of logs) {
      const subjects = mapLogToSubjects(log)
      for (const subject of subjects) await enqueueSyncJob(subject, log)
    }
    await setWatermark(contract.address, latest, await getBlockHash(latest))
  }
}
```

Sync ticks run on a short interval (1-2 sec on dev anvil, 5-10 sec on prod chains). The watermark prevents re-reading the entire chain history.

**PR-Perf-T2-A**: watermarks table + worker loop.
**PR-Perf-T2-B**: incremental log-only read replaces broad rescan.

---

### Track 3 — Reorg handling

**Today**: none. Anvil dev never reorgs; prod would silently corrupt.

**Target**:
- Each watermark row stores `last_block_hash`.
- Before applying a new log batch, check that the block at `last_block_synced` still has the stored hash.
- If mismatched: rewind to the most recent ancestor where hashes still match (binary search over the last N blocks), invalidate sync jobs since that point, re-derive subjects from the new log path.
- Use a confirmation depth per chain: dev anvil = 0 (instant); mainnet = 12; L2s = 3-6 depending on chain.

**PR-Perf-T3**: reorg-safe sync worker with confirmation depth.

---

### Track 4 — Multicall for serial on-chain reads

**Today**: a pool detail page fires 10-20 sequential `readContract` calls (each ~50-200ms over HTTPS).

**Target**: every read site uses `multicall3` (deployed at the canonical address on every EVM chain) or viem's `multicall` action to batch into one `eth_call`.

**Targets**:
- Dashboard bundle (`apps/web/src/app/...dashboard.../page.tsx`).
- Pool detail.
- Round detail (especially proposal list + per-proposal status + vote tally).
- Hub home (top-N intents, pools, rounds, proposals).
- Marketplace lane reads (intent matching ranking signals).

**PR-Perf-T4-A**: SDK helper `multicallReadBundle(client, calls[])` with caching at the call level (key = `${address}:${functionName}:${argsHash}`, TTL configurable).
**PR-Perf-T4-B**: hot read paths migrated to multicall.

---

### Track 5 — Batch MCP tools (one tool call per screen)

**Today**: server-component renders fan out to multiple MCP calls (e.g., "get profile" + "get pool list" + "get round list" + "get cross-delegations").

**Target**: per-screen aggregator tools that return the entire screen's bundle:
- `discovery:get_dashboard_bundle({ principal })` — profile + counts + recent activity + pinned items
- `discovery:get_pool_detail_bundle({ poolId })` — pool + rounds + proposals + pledges + commitments
- `discovery:get_round_detail_bundle({ roundId })` — round + proposals + votes + pledges
- `discovery:get_hub_home_bundle({ hubId })` — top intents/pools/rounds/proposals
- `discovery:get_marketplace_lane_bundle({ lane, filter })` — ranking signals for the relevant lane

Each bundle tool internally uses multicall (Track 4) + the discovery cache (Track 6) to assemble the response in one round-trip.

**PR-Perf-T5**: 5 aggregator MCP tools + web migration to use them.

---

### Track 6 — Subject-aware cache invalidation

**Today**: hub-mcp discovery cache invalidates by family (e.g., "all rounds").

**Target**: cache keyed by canonical subject IRI. Sync job completion invalidates ONLY the affected subject's cache entry.

```ts
// apps/hub-mcp/src/lib/discovery-cache.ts
type CacheKey = `${SubjectKind}:${SubjectIri}` | `family:${SubjectKind}`
const subjectCache = new LRU<CacheKey, unknown>({ max: 10_000 })

export function invalidateSubject(kind: SubjectKind, iri: SubjectIri) {
  subjectCache.delete(`${kind}:${iri}`)
  // Family caches (top-N, list pages) get a softer invalidation — mark stale
  // with a "regenerate at next read" flag rather than full delete.
  markFamilyStale(kind)
}
```

Sync worker calls `invalidateSubject(kind, iri)` after each completed subject sync.

**PR-Perf-T6**: subject-aware cache + family-stale flag + cache-stale telemetry.

---

### Track 7 — Async user-visible writes

**Today**: form submit waits for tx confirmation + broad sync + redirect → ~5-30s perceived latency.

**Target**:
- Submit returns immediately on `userOpHash` (don't wait for receipt or sync).
- Web stores `pending_actions` keyed by user with `userOpHash` + expected subjects.
- UI redirects to the destination page in "syncing" mode.
- Page hooks a subscription to the sync-job status for those subjects.
- When the subject sync completes (typically <2s after receipt), UI swaps "syncing" → "live".

This is the perceived-latency win. Users see the redirect in <500ms instead of >5s.

**PR-Perf-T7-A**: web `pending_actions` table + subscription channel (Server-Sent Events or polling).
**PR-Perf-T7-B**: forms wired to async-submit pattern.
**PR-Perf-T7-C**: UI "syncing" pill component.

---

### Track 8 — Job-queue backpressure + small relational read model

**Today**: sync runs inline during request handlers. Under load, request handlers stall waiting on each other's sync work.

**Target**:
- Sync worker is a separate loop with a bounded in-flight count. Request handlers ONLY enqueue; they never await sync.
- A small relational SQLite read model in hub-mcp for the hottest operational views (pool aggregates, round aggregates) — denormalized from GraphDB so dashboard renders don't hit SPARQL.
- GraphDB stays authoritative; the SQLite view is updated from the same sync worker that updates GraphDB.

**PR-Perf-T8**: sync worker with bounded concurrency + read-model SQLite table.

---

## Performance budget targets

| User action | Today (observed) | Target |
|---|---|---|
| Sign-in (passkey) | ~5s | <2s |
| Pool create form submit → redirect to new pool | >120s (timeout) | <1s perceived, <5s sync complete |
| Pledge express → ack | ~3-5s | <1s |
| Pledge honor → confirmation | ~10s | <3s perceived, full settlement <10s |
| Hub home render | ~3-5s | <800ms |
| Pool detail render | ~3s | <600ms |
| Round detail render | ~4s | <800ms |
| Dashboard render | ~3-5s | <1s |

These are perceived-latency targets (time-to-interactive on next paint), not full settlement.

---

## Sequencing

| PR | Track | Depends on | Size |
|---|---|---|---|
| **PR-Perf-Demo-1** | Fix node:crypto regression | None | XS |
| **PR-Perf-Demo-2** | Env-tunable rate limits for dev | None | XS |
| **PR-Perf-T1-A** | `sync_jobs` schema + worker scaffold + `event_to_subject` mapper | None | M |
| **PR-Perf-T2-A** | `sync_watermarks` schema + per-contract log-only sync | PR-Perf-T1-A | M |
| **PR-Perf-T1-B** | Write paths enqueue (not sync) | PR-Perf-T1-A, PR-Perf-T2-A | M |
| **PR-Perf-T3** | Reorg-safe sync worker + confirmation depth | PR-Perf-T2-A | M |
| **PR-Perf-T4-A** | SDK `multicallReadBundle` helper | None | S |
| **PR-Perf-T4-B** | Hot read paths migrate to multicall | PR-Perf-T4-A | M |
| **PR-Perf-T5** | 5 aggregator MCP tools + web migration | PR-Perf-T4-A | L |
| **PR-Perf-T6** | Subject-aware cache + family-stale flag | PR-Perf-T1-B | M |
| **PR-Perf-T7-A/B/C** | Async write pattern (pending_actions + UI pill) | PR-Perf-T1-B, PR-Perf-T6 | L |
| **PR-Perf-T8** | Bounded sync worker + SQLite read model | PR-Perf-T1-A | M |
| **PR-Perf-T1-C** | Deprecate broad sync from request paths | All other tracks | XS |

**Recommended dispatch order**:
1. **Wave 1 (XS, blockers)**: PR-Perf-Demo-1 + PR-Perf-Demo-2 — unblock demo recording.
2. **Wave 2 (foundations, parallel)**: PR-Perf-T1-A + PR-Perf-T4-A — sync-jobs scaffold + multicall helper. Independent.
3. **Wave 3 (parallel)**: PR-Perf-T2-A + PR-Perf-T4-B — watermark sync + multicall in hot read paths.
4. **Wave 4 (parallel)**: PR-Perf-T1-B + PR-Perf-T5 — write paths enqueue + aggregator tools.
5. **Wave 5 (parallel)**: PR-Perf-T6 + PR-Perf-T8 — subject cache + bounded worker.
6. **Wave 6**: PR-Perf-T7-A/B/C — async UX pattern.
7. **Wave 7**: PR-Perf-T3 + PR-Perf-T1-C — reorg handling + broad-sync deprecation.
8. **Then**: re-record demo. Then 1claw. Then Namera.

Each wave can be 2-3 parallel sub-agents. Estimated total ~2-3 weeks of focused work.

---

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Reorg corrupts GraphDB before reorg handling lands | Run Track 3 BEFORE production deploy. Dev anvil never reorgs so dev is unaffected. |
| Async writes confuse users ("did it work?") | UI pill must be unambiguous — explicit "Submitted, syncing X" with a spinner; failure visible as "Failed, retry" with a clear action. |
| sync_jobs queue grows unbounded under chain spam | Bounded retention: prune `done` rows older than 7 days. Dedup at insert via the UNIQUE index on (tx_hash, log_index). |
| Subject-aware cache stale under high write rate | Family-stale flag + a max-staleness budget (e.g., serve a family list <30s old; older invalidates fully). |
| New aggregator MCP tools become a security regression | Each new aggregator tool requires `requireInboundServiceAuth` + classification per Sprint 5 W3 P1-2 inventory standard. |

---

## What this plan is NOT

- NOT a re-architecture. Owner-routed private data + public on-chain → GraphDB mirror + MCPs as sovereign boundaries all stay.
- NOT a security regression. Every existing bypass invariant (7 invariants in `scripts/check-no-bypass.sh`) holds. New aggregator tools follow the same classification + auth bar.
- NOT abandoning GraphDB. GraphDB stays authoritative for the public-mirror read model. The SQLite read-model addition (T8) is for HOT OPERATIONAL VIEWS only (pool aggregates, round aggregates) — not a replacement for the trust graph.
- NOT a deferral of 1claw or Namera. They land AFTER perf because the ActionIntent envelope (1claw PR-A1) is the natural place to hang the async-write pending_actions state — building it on top of an event-driven sync layer is much cleaner than retrofitting.

---

## Open decisions for the orchestrator

1. **Demo-recording rate limit**: should `RATE_LIMIT_SESSION_INIT_MAX` env var default to a high number in `NODE_ENV=development`, or should the Playwright test annotate sessions to bypass the limit (e.g., `X-Playwright-Test: 1` header that the middleware honors only when `NODE_ENV !== 'production'`)? Recommend env default — simpler, no test-side flag.

2. **Subject IRI vocabulary**: the ontology already defines pool/round/proposal/pledge IRIs. Confirm `event_to_subject` mapping reuses those canonical IRIs (no new vocab).

3. **SQLite read-model in hub-mcp vs elsewhere**: hub-mcp is the right home (already owns sync). Confirm.

4. **Async write UX**: Server-Sent Events vs polling for pending-action status? Recommend SSE for hot screens (dashboard, pool detail); polling fallback elsewhere.

5. **Multicall dependency**: viem already has it; no new dep. The multicall3 contract is at the canonical `0xcA11bde05977b3631167028862bE2a173976CA11` on every EVM chain we care about.

6. **Per-screen aggregator tools** (Track 5): does each tool live in hub-mcp, or do per-domain MCPs (org-mcp, person-mcp) expose their own aggregator tools? Recommend per-domain owners — hub-mcp is for public/discovery; private bundles stay with the owning MCP.
