# DR3 — GraphDB SLA

> **Status**: DRAFT. **GraphDB is an external dependency** at
> `graphdb.agentkg.io`. The user has explicitly directed: **no local
> fallback** — Smart Agent does not run its own GraphDB. The GraphDB
> mirror is the public read surface of the trust ontology + on-chain
> assertions; if it's down, discovery is degraded but on-chain reads
> (Spec-004 R8 readers) still serve the critical paths.
>
> This document specifies the GraphDB SLA, the monitoring posture, the
> degraded-mode behavior, and the contingency for an extended outage.
>
> **Effort**: M (1 week monitoring + status page + manual switchover
> tooling).
> **Owner**: Backend lead + Director of Engineering.
> **Depends on**: O2 (probe is non-blocking — readiness doesn't include
> GraphDB by default), O7 (runbook).
> **Unblocks**: customer trust that a GraphDB outage doesn't take down
> the service.

---

## 1. Today's state (honest)

| Aspect | Today |
|---|---|
| GraphDB hosting | External; `graphdb.agentkg.io` (a hosted Ontotext GraphDB SmartAgents repository). |
| Local fallback | None. User directive: do not host our own GraphDB. |
| Monitoring | None. Outages discovered when a user reports a broken page. |
| Status page | None. |
| Switchover procedure | None — there's nowhere to switch over to. |
| Degraded-mode behavior | None — failures cascade into 500 errors. |
| Customer SLA | None declared. |

Spec-004 R8 introduced on-chain readers so the critical read paths
(marketplace discovery, pool listings, proposal listings) walk the
on-chain registries directly. That mitigation lets the service stay
useful when GraphDB is down — BUT only if the application code knows
to switch.

Today the application does NOT know — it assumes GraphDB is up. If
GraphDB returns 503, the catch block (if any) usually doesn't handle
it cleanly.

This is the gap DR3 closes.

---

## 2. Goals

1. **GraphDB outage does NOT take Tier 1 service down.** O2 makes
   the GraphDB probe non-required for `/ready`. DR3 makes the
   application code agree.
2. **Outage is detected within 2 minutes.** Uptime probe + Datadog
   monitor.
3. **Customer-facing status page** reports GraphDB-dependent
   functionality as "degraded" within 5 min of detection.
4. **Manual switchover procedure** documented, even if to a future
   not-yet-provisioned alternate GraphDB instance.
5. **Contingency for extended outage** (>4 hours): degraded read-
   only mode that serves cached or on-chain data only.

---

## 3. SLA framework

### 3.1 What's Tier-classified

| Function | Path | Tier (per O5) | GraphDB dependence |
|---|---|---|---|
| Auth + sign-in | `apps/web` → SIWE + passkey | 1 | **None.** |
| userOp execution | `apps/a2a-agent` → EntryPoint | 1 | **None.** |
| Money movement | Spec 005 Rails | 1 | **None.** |
| Public marketplace browse | `apps/web` → discovery routes | 2 | **Partial** — primary read from on-chain (Spec 004 R8); GraphDB enriches with attribution metadata. |
| Person profile listings | `apps/web/oikos` → person-mcp | 2 | **None** (person-mcp is the source). |
| Agent registry browser | `apps/web/discovery` | 2 | **Yes** — GraphDB is the indexed view. |
| Skill / credential listings | various | 2 | **Yes** — GraphDB indexes assertions. |
| Ontology terms (T-Box reads) | apps/web | 3 | **Yes**. |

Tier 1 has zero GraphDB dependence. Tier 2 has partial dependence.
Tier 3 is entirely GraphDB-backed.

### 3.2 Stated SLA per tier (per O5)

| Tier | Availability | RTO | RPO |
|---|---|---|---|
| Tier 1 (no GraphDB) | 99.9% | 15 min | 1 min |
| Tier 2 (partial GraphDB) | 99.5% | 1 hour | 15 min |
| Tier 3 (full GraphDB) | 99% | 24 hours | 1 hour |

A GraphDB outage:
- Cannot cause a Tier-1 SLA breach.
- Can cause a Tier-2 SLA breach if degraded-mode behavior isn't
  in place.
- Can cause a Tier-3 SLA breach — that's expected; Tier 3 explicitly
  acknowledges the dependency.

---

## 4. Monitoring

### 4.1 Uptime probe

External uptime check (Better Uptime; OQ-O5-3) hits a designated
GraphDB SPARQL endpoint every 60 s:

```
GET https://graphdb.agentkg.io/repositories/SmartAgents/size
→ 200 OK + body "12345"
```

Failure threshold: 2 consecutive failures → marked DOWN. Datadog
monitor wired:

| Alert | Threshold | Severity | Routing |
|---|---|---|---|
| GraphDB uptime check fails 2× | 2 min | Sev-3 by default (Tier-3 dependency) | Slack |
| GraphDB uptime check fails 10× (10 min) | promote | Sev-2 | Slack + on-call ack required |
| GraphDB uptime check fails 30× (30 min) | promote | Sev-2 | (manual judgement; may escalate if Tier-2 SLA at risk) |
| GraphDB uptime check fails 240× (4 hours) | promote | Sev-1 | PagerDuty (engages extended-outage procedure) |

### 4.2 Internal probe

A2A agent's deep readiness includes a non-required GraphDB probe (O2
§4.2.1). The probe's output goes to Datadog regardless of the
overall `/ready` 200 — useful for distinguishing "GraphDB unreachable
from our VPC" vs "GraphDB unreachable from the internet."

### 4.3 SLI metric

`graphdb_query_success_rate` = (successful queries / total queries)
over rolling 5-min windows. Emitted by every service calling GraphDB.
SLO: ≥99% in steady state; alert at <95%.

---

## 5. Application-side degraded mode

The application code MUST behave well when GraphDB is unreachable.
This means:

### 5.1 No silent fallbacks

Per Spec 007 north-star goal #4, `try { graphdbQuery() } catch { ...
} ` patterns are forbidden if they silently substitute incorrect
data. The acceptable patterns:

```typescript
// GOOD: explicit fallback to on-chain when GraphDB is unreachable.
import { DiscoveryService } from '@smart-agent/discovery'
import { listPoolsFromOnchain } from '@smart-agent/sdk/onchain-readers'

export async function listPools() {
  try {
    return await discovery.listPools()
  } catch (err) {
    if (isGraphDBUnreachable(err)) {
      // Surface the degraded mode to the caller. The UI shows a banner.
      const onchainResult = await listPoolsFromOnchain()
      return { ...onchainResult, _source: 'onchain-degraded' }
    }
    throw err
  }
}
```

### 5.2 Caching for Tier 2 reads

Reads of Tier-2 paths cache GraphDB responses for 10 min. During an
outage, cached values continue to serve until expiry (the cache
becomes the degraded-mode source for short outages).

`@smart-agent/discovery` adds a thin cache layer:

```typescript
// packages/discovery/src/cache.ts
const cache = new LRUCache<string, KBAgent[]>({ max: 1000, ttl: 600_000 })

export async function cachedListAgents(opts: AgentQueryOptions) {
  const key = stringify(opts)
  if (cache.has(key)) return cache.get(key)
  const res = await discovery.listAgents(opts)
  cache.set(key, res)
  return res
}
```

### 5.3 UI banner

When the application surfaces GraphDB-derived data and the response
is from a degraded source (`_source: 'onchain-degraded'` or stale
cache >5 min), the UI shows:

```
ⓘ Some discovery data is currently unavailable. We're showing what
  we have. [Learn more]
```

The "Learn more" link goes to the status page.

---

## 6. Status page

A public status page at `status.smart-agent.io` (Better Uptime — same
provider as O5 OQ-3) shows:

- Overall service status (auth, signing, marketplace).
- Component statuses: web, a2a-agent, MCPs, Postgres, GraphDB, KMS.
- Active incidents.
- Last 30 days uptime per component.

GraphDB outage → component flips to "Partial outage" or "Major
outage" depending on duration. Tier 2 features show "Degraded" status.

Status updates posted manually by on-call during incidents (template
in `docs/runbooks/status-page-update.md`).

---

## 7. Switchover procedure (future-state)

We don't host our own GraphDB. The user's directive: "no local
fallback." We DO leave a hook for switching to an alternate GraphDB
instance if a vendor swap becomes necessary in the future.

### 7.1 What we ship today (DR3 v1)

- `GRAPHDB_URL` env var per service.
- `GRAPHDB_FALLBACK_URL` env var per service (initially unset).
- `@smart-agent/discovery` reads the primary; on extended outage
  (>5 min), retries against the fallback if set.
- A switchover doesn't require a redeploy — it's an env-var flip via
  Secrets Manager + service restart.

### 7.2 What we'd do under extended outage (today, no fallback set)

`docs/runbooks/graphdb-extended-outage.md`:

1. On-call confirms GraphDB is the cause (not our network, not our
   credentials).
2. On-call posts an incident to the status page declaring
   "Discovery features are unavailable. Auth and money movement are
   unaffected."
3. On-call engages vendor support (Ontotext) per the support contract
   (see `docs/security/external-dependencies/` for vendor contacts).
4. If the outage persists >4 hours and is vendor-side:
   - Convene CAB (O11) for an emergency decision: provision an
     alternate GraphDB instance OR wait.
   - If provisioning: spin up Ontotext GraphDB on an AWS EC2 instance
     in our VPC (this contradicts the "no local fallback" directive,
     but as a last-resort emergency action, it's defensible).
   - If waiting: extend the status-page incident with an ETA.

### 7.3 Once an alternate is provisioned

- `GRAPHDB_FALLBACK_URL` env var populated.
- Periodic sync from primary → fallback ensures parity. Initial
  approach: replay the on-chain → GraphDB sync against the fallback
  (the same sync mechanism that populates the primary).
- Service restart picks up the fallback.

### 7.4 Substrate independence note

The user's "no local fallback" directive is consistent with P1 when
read carefully: we don't make GraphDB a hard runtime dependency for
Tier 1 paths. We accept it as a Tier 3 dependency. If the vendor
fails permanently, P1 says we can replace it — that's what §7.3 ensures.

---

## 8. Files to create/change

### New

- `packages/discovery/src/cache.ts` — LRU cache wrapper.
- `packages/discovery/src/degraded-mode.ts` — wrap calls; classify
  errors; emit `_source` metadata.
- `packages/sdk/src/onchain-readers/*` — already exist (R8); DR3
  wires them into the degraded-mode path.
- `apps/web/src/components/DegradedDataBanner.tsx` — UI banner.
- `docs/runbooks/graphdb-outage.md` — short outage runbook.
- `docs/runbooks/graphdb-extended-outage.md` — extended outage
  contingency.
- `docs/runbooks/status-page-update.md` — status-page narrative
  templates.

### Changed

- Every server-action / API route that reads GraphDB — wraps with
  degraded-mode handler.
- `apps/web/src/app/layout.tsx` — conditionally render the banner
  based on a `degraded-data` cookie / flag.
- `docs/security/operations/O2-deep-health-checks.md` — confirm
  GraphDB probe is non-required (already specified there).

### CI guards

- `no-silent-graphdb-catch.test.ts` — AST lint refuses
  `try { graphdbQuery() } catch { return [] }` patterns. Acceptable
  patterns are the explicit `degraded-mode` wrappers.

---

## 9. Cost

| Item | Cost |
|---|---|
| Better Uptime (status page + uptime probe) | $30/mo (covers O5 OQ-3 + this) |
| Datadog monitors (5 monitors) | included |
| LRU cache memory (in-process) | $0 |
| Future alternate GraphDB instance (if needed) | ~$200/mo for an EC2-hosted GraphDB |

Total marginal recurring: ~$30/mo.

---

## 10. Acceptance criteria

- [ ] GraphDB outage simulation (block egress to graphdb.agentkg.io
      for 10 min) does NOT cause `/ready` of any Tier 1 service to
      return 503.
- [ ] During simulated outage, marketplace listing pages return
      on-chain-degraded results within 5 s of GraphDB timeout.
- [ ] During simulated outage, UI shows the degraded-data banner.
- [ ] Uptime probe + Datadog monitor + status page are live.
- [ ] Runbook exists at `docs/runbooks/graphdb-outage.md`.
- [ ] CI guard `no-silent-graphdb-catch.test.ts` passes.
- [ ] `GRAPHDB_FALLBACK_URL` plumbing exists (env var read at boot;
      retry logic ready) even though no fallback URL is configured.

---

## 11. Test plan

### 11.1 Outage simulation

- Add an iptables rule on a staging instance blocking egress to
  `graphdb.agentkg.io`. Run for 10 min. Confirm:
  - Tier 1 paths unaffected.
  - Tier 2 paths serve degraded data.
  - UI banner shows.
  - Datadog monitors fired (Sev-3 → Sev-2 → not yet Sev-1).
  - Status page reflects degraded state.

### 11.2 Recovery

- Remove the iptables rule. Confirm:
  - Cached degraded data clears within 10 min (cache TTL).
  - UI banner disappears.
  - Monitors return to green.

### 11.3 Quarterly drill

- Real outage exercise: coordinate with the team. On-call walks
  through the runbook end-to-end. Time to post status update;
  time to first user-facing communication; time to resolution.
  Filed in `output/dr3-drill-YYYY-QN.md`.

---

## 12. Rollback

Degraded-mode + caching are additive. Disabling means reverting to
the "crashes on GraphDB outage" state. Not advisable.

The fallback-URL plumbing is a no-op when no URL is configured;
nothing to roll back.

---

## 13. Open questions

- **OQ-DR3-1**: Should we negotiate an SLA with Ontotext?
  Proposed: yes — once we have customers depending on Tier 2
  discovery. For v1 / pre-customer, the public-cloud GraphDB's
  default uptime is good enough.
- **OQ-DR3-2**: Is there an open-source alternative to Ontotext
  GraphDB we'd prefer to self-host long-term (e.g. Apache Jena
  Fuseki, Blazegraph)? Proposed: deferred. The user's directive is
  no-local-fallback today; that decision is revisitable when we
  better understand the operational cost.
- **OQ-DR3-3**: Cache size: 1000 entries per service is a guess.
  Proposed: instrument cache hit rate; tune in monthly capacity
  review (O8).
- **OQ-DR3-4**: How does the cache invalidate when a new on-chain
  assertion lands? Proposed: TTL-only for v1 (10-min staleness is
  acceptable for Tier 2 listings). Explicit invalidation by tool-side
  emitters is a future optimisation.
- **OQ-DR3-5**: What information surfaces on the status page during
  an outage? Proposed: a curated narrative — "Marketplace browsing is
  showing reduced data right now. We're working with our discovery
  provider. Auth and money movement are unaffected." Avoids "GraphDB"
  jargon for end users.
