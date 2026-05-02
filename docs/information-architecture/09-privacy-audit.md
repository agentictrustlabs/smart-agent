# 09 — Privacy Audit (Current State)

> **Audit date: 2026-05-02.** Findings from a top-to-bottom scan of `apps/web/src/db/schema.ts`, `apps/web/src/lib/ontology/`, server actions, demo seeds, and live logs against the no-duplication invariants in [01-principles.md](01-principles.md).
>
> **The architecture has two clean parts and one dirty part.**
> - GraphDB sync ✅ — only reads on-chain. No private leaks.
> - person-mcp / org-mcp ✅ — isolated, no cross-store writes.
> - **Web SQL ⚠️ — a junk drawer holding both safe on-chain caches and unsafe private user/org data.** All findings below cluster here.

## Severity definitions

| Severity | Meaning |
|---|---|
| **CRITICAL** | Private data is reachable today via web SQL with no auth gate, OR a public API returns private fields, OR private data leaks into discoverable surfaces |
| **HIGH** | Private data sits in web SQL (PII, financials, intimate relationship/spiritual data) — would leak under any DB compromise or accidental query |
| **MED** | Private metadata in web SQL (relationship-revealing, behavior patterns, internal scheduling) — limited blast radius but still violates owner-routing |
| **LOW** | Mildly sensitive (logs, seed PII, message bodies) — fixable cleanup; not a structural break |

## Section A — Web SQL: private data sitting in the wrong store

These tables in `apps/web/src/db/schema.ts` violate the owner-routing principle. Each will be removed from web SQL during the build phases in [07-build-plan.md](07-build-plan.md).

### A1. PII / personal-spiritual data (CRITICAL → HIGH)

| Table | Sensitive columns | Severity | What's exposed | Target |
|---|---|---|---|---|
| `circles` (oikos) | `personName`, `proximity`, `response`, `plannedConversation`, `notes`, `tags` | **HIGH** | Personal relationship network with names and spiritual response state | → `person-mcp.oikos_contacts` |
| `prayers` | `title`, `notes`, `schedule`, `lastPrayed`, `answered`, `linkedOikosId` | **HIGH** | Personal prayer requests; intimate spiritual content | → `person-mcp.prayers` |
| `trainingProgress` | `moduleKey`, `program`, `track`, `completed`, `completedAt` | **HIGH** | Personal discipleship progression — spiritual growth data | → `person-mcp.training_progress` |
| `userPreferences` | `language`, `homeChurch`, `location` | **HIGH** | Spiritual affiliation + geographic location (movement-pattern inference risk) | → `person-mcp.user_preferences` |
| `coachRelationships` | `discipleId`, `coachId`, `sharePermissions` | **HIGH** | Coaching pair structure + which categories are shared | → on-chain `COACHING_MENTORSHIP` edge + `person-mcp.cross_delegation_grants` |
| `messages` | `title`, `body`, `link` | **MED-HIGH** | Notification payloads may echo personal names / details if poorly templated | → `person-mcp.notifications` (or `org-mcp.notifications` for org-recipient) |
| `activityLogs` | `location`, `lat`, `lng`, `notes`, `relatedEntity` | **MED** | Movement patterns, association meeting places, personal observations | → owner-routed: `person-mcp.activity_log_entries` (personal) or `org-mcp.activity_log_entries` (org) |
| `detachedMembers` | `name`, `notes`, `role` | **MED** | People-tracked metadata (names of the not-yet-onchain) | → `org-mcp.detached_members` |

### A2. Org financial / governance data (HIGH → MED)

| Table | Sensitive columns | Severity | What's exposed | Target |
|---|---|---|---|---|
| `revenueReports` | `grossRevenue`, `expenses`, `netRevenue`, `sharePayment`, `notes` | **HIGH** | Org financial health, sharing terms, margins | → `org-mcp.revenue_reports` |
| `proposals` | `title`, `description`, `targetAddress` | **MED** | Internal disputes, capital allocation, strategic decisions | → `org-mcp.proposals` (private detail); on-chain governance is the public side |

### A3. Engagement metadata (MED → LOW)

| Table | Sensitive columns | Severity | What's exposed | Target |
|---|---|---|---|---|
| `entitlements` | `terms` (JSON: scheduling, scope), confirmation timestamps, `evidenceBundleHash` | **MED** | Engagement terms detail; party-only timestamps | On-chain backbone (public) + per-side private state in each MCP |
| `engagementSessions` | `scheduledFor`, `occurredAt`, `notes` | **MED** | Exact session timing + private notes | → `org-mcp.engagement_sessions` (provider-private) |
| `engagementTranches` | `amountCents`, `scheduledFor`, `releasedAt` | **MED** | Funding amounts and payment cadence | → `org-mcp.engagement_tranches` (provider-private) |
| `commitmentThreadEntries` | `body` (free-form messages between parties) | **MED** | Provider notes, negotiation history | On-chain canonical for the audit thread; private detail in each side's MCP |

## Section B — API visibility leaks (CRITICAL)

These are not architectural problems — they are *current-code* gaps where a private row becomes reachable via a public-facing endpoint. Fixing the code path before the migration is fine, but the migration *removes the table* anyway.

### B1. `intents.action.ts` — `listIntents` and `getHubIntentSummary` do not filter by visibility

**Location:** `apps/web/src/lib/actions/intents.action.ts`

- `listIntents(opts)` (~line 295) returns all intents without checking the `visibility` column. Calling code that expects a public list can receive private intents.
- `getHubIntentSummary(hubId)` (~line 506) feeds the public hub home page from the `intents` table without a visibility filter. **Private intents can surface on a public landing page.**
- `expressIntent(input)` accepts user-supplied `visibility` and stores it without validation.

**Severity: CRITICAL.** Could currently expose private personal intents on `/h/{hub}/home`.

**Mitigation now:** add `eq(schema.intents.visibility, 'public')` to both list calls and to the hub summary.

**Mitigation in the migration:** the table moves to MCPs. Discover only sees on-chain assertions. The class of bug becomes structurally impossible — you can't accidentally show a private row on Discover, because Discover doesn't read the row's source store at all.

### B2. `apps/web/src/app/api/org-context/route.ts` — capability inference leaks existence

**Location:** `apps/web/src/app/api/org-context/route.ts:63-65`

```ts
if (db.select().from(schema.revenueReports).limit(1).all().length > 0) caps.push('portfolio', 'revenue')
if (db.select().from(schema.trainingModules).limit(1).all().length > 0) caps.push('training')
if (db.select().from(schema.proposals).limit(1).all().length > 0) caps.push('governance')
```

The endpoint returns `capabilities` per org based on whether *any* row exists. Even an unauthenticated caller can infer that an org has revenue tracking, governance proposals, etc.

**Severity: MED-HIGH** (information disclosure).

**Mitigation:** gate by caller's role; or move capability detection into org-mcp (which already gates by delegation).

### B3. `apps/web/src/app/api/messages/route.ts` — raw row return

Returns full `messages` rows (title + body) to the requesting user. Safe **only if** the writer pipeline never embeds another user's PII in a message body. That assumption is not verified.

**Severity: LOW-MED.** Mitigation: define a `MessageDTO` and strip third-party identifiers; or, after the migration, the row lives in person-mcp and is delegation-gated by default.

## Section C — Demo seeds writing PII into web SQL (MED)

**Location:** `apps/web/src/lib/demo-seed/seed-multiply-data.ts`

Hard-coded names, prayer text, and notes are inserted directly into web SQL: "Maria Chen", "Pastor James", "Ahmed's salvation", "Hispanic families facing housing insecurity", "Children of detained parents", "Coaching cadence", etc.

This is fine for demo (`did:demo:*`) accounts. It becomes a **production privacy risk** if the same seed path runs against any non-demo database.

**Severity: MED** (today: low, since it's gated by demo flag; but the *path* exists).

**Mitigation in the migration:** seeds rewrite to call MCP tools, not web SQL `db.insert()`. Demo state lives in each MCP's SQLite, isolated by principal, and `fresh-start.sh` wipes them between runs. The web SQL → "junk drawer" disappears.

## Section D — Logs containing PII (LOW)

**Location:** `tmp/logs/web.log`

Demo onboarding logs include patterns like:
```
[demo-seed] Provisioned Pastor James: EOA=0x6BB9a..., PersonAgent=0xAB603f8d...
```

Personal name + wallet address pairs are correlated in plaintext logs. Demo today; if production logging follows the same pattern, real names would be correlated to wallet addresses (a deanonymization vector).

**Severity: LOW** (demo-only today; HIGH if a similar pattern shipped to production).

**Mitigation:** in production, log either a hash of the `did` or the agent address — never the human name alongside the address. Add a lint rule against `console.log(profile.name, profile.address)` patterns.

## Section E — GraphDB sync (CLEAN ✅)

**Location:** `apps/web/src/lib/ontology/`

`emitAgentsTurtle()` reads exclusively via `client.readContract()`. The fields emitted to GraphDB:
- Agent core metadata (display name, description, agent type, active flag) — **all on-chain**
- Naming (`ATL_PRIMARY_NAME`, `ATL_NAME_LABEL`) — **all on-chain**
- Geospatial (`ATL_LATITUDE`, `ATL_LONGITUDE`) — **on-chain agent metadata** (geo-mcp's *private* claims do not flow here)
- Controllers (wallet addresses) — **on-chain**
- Capabilities, trust models, endpoints — **on-chain**
- Edges and assertions — **on-chain**

**No reads of `users`, `userPreferences`, `circles`, `prayers`, `trainingProgress`, `messages`, `profiles`, `activityLogs`, `revenueReports`, `proposals`, or any web SQL private table were found in the sync emitter.**

This is the architectural property we want: GraphDB is structurally a one-way mirror of on-chain. Every other doc in this folder must preserve that property.

**Action: none required.** Continue to defend this in code review — reject any PR that adds a web SQL or MCP read to the sync emitter.

## Section F — MCP cross-talk (CLEAN ✅)

**person-mcp** writes only to its own SQLite (`apps/person-mcp/person-mcp.db`) and the Askar vault. No paths to web SQL or GraphDB found.

**org-mcp** today writes only to its own SQLite (`apps/org-mcp/oid4vci.db`, `apps/org-mcp/org-private.db`). No paths to web SQL or GraphDB found.

**Action: none required.** When org-mcp's domain expansion lands ([07-build-plan.md](07-build-plan.md) Phase 2), this property must be preserved. Reviewer rule: any new MCP code that imports a GraphDB or web-SQL client is rejected.

## Section G — Environment variables (CLEAN ✅)

`apps/web/.env`: `NEXT_PUBLIC_PRIVY_APP_ID`, `NEXT_PUBLIC_CHAIN_ID` only. Both are public-by-design. No private keys or PII in `NEXT_PUBLIC_*`.

**Action: none required.**

## Risk summary

| Category | Severity ceiling | Items |
|---|---|---|
| Web SQL: PII / personal-spiritual | **HIGH** | 5 tables |
| Web SQL: Org financial / governance | **HIGH** | 2 tables |
| Web SQL: Engagement metadata | **MED** | 4 tables |
| API visibility leaks | **CRITICAL** | 3 endpoints |
| Demo seeds writing PII | **MED** | 1 seed |
| Logs with PII | **LOW** | 1 log pattern |
| GraphDB sync | ✅ clean | 0 |
| MCP cross-talk | ✅ clean | 0 |
| Env vars | ✅ clean | 0 |

## Prioritized fix order

The critical ones to fix *now* (before the larger migration ships, because they leak in current production-shaped code):

1. **B1 — visibility filter on intents.** One-line patch in `listIntents` and `getHubIntentSummary`. Severity: CRITICAL.
2. **B2 — gate org-context capabilities by role.** Either patch the route or move detection to org-mcp. Severity: MED-HIGH.
3. **B3 — sanitize message DTO.** Define `messageToDTO()` and strip third-party identifiers. Severity: LOW-MED.

The structural ones come naturally from the migration in [07-build-plan.md](07-build-plan.md):

4. **A1 — move person-private tables to person-mcp** (Phase 1).
5. **A2 — move org-private tables to org-mcp** (Phase 3).
6. **A3 — decompose engagement metadata** (Phase 5).
7. **C — rewrite demo seeds against MCP tools** (parallel through Phases 1–5).
8. **D — redact production logs** (Phase 0 quick win; CI lint rule).

Once Phases 1–6 land, the no-duplication invariant is enforced by the schema itself: there is *no* table in web SQL that holds private user/org rows, so it becomes structurally impossible for a future endpoint to leak them by accident.

## Verification after the cut

After each phase, the IA + Reviewer must confirm:

- [ ] No new table in `apps/web/src/db/schema.ts` for the moved domain
- [ ] No new code path in `apps/web/src/lib/ontology/` reading from MCPs or web SQL private rows
- [ ] No `publishProjection`/`mirrorToGraphDb`/etc. helpers introduced anywhere
- [ ] `fresh-start.sh` re-seed produces a stack with the moved tables empty in web SQL and populated in the target MCP
- [ ] A SPARQL query for the moved class against GraphDB returns *only* on-chain-anchored instances (e.g., for intents: only intents whose `onChainAssertionId` is set)

## Appendix — what "no duplication" means in practice

| Scenario | Allowed? | Why |
|---|---|---|
| GraphDB has a copy of an on-chain assertion | ✅ | One-way sync from on-chain — explicitly permitted as the read-only mirror |
| Web SQL caches an agent's display name from on-chain | ✅ | Read-through cache of public on-chain data — explicitly permitted (and clearly marked as `*_cache`) |
| Web SQL stores a user's prayer | ❌ | Private; belongs in person-mcp |
| person-mcp writes to GraphDB | ❌ | MCP→GraphDB pipe forbidden by P4 |
| org-mcp duplicates on-chain edges into a local table | ❌ | Read on-chain on demand or via the web SQL cache; do not duplicate |
| A web action JOINs a person-mcp row to an org-mcp row | ❌ | Cross-MCP JOIN. Merge in the API route from two queries instead |
| A row's `visibility` is `public` and the MCP emits an on-chain assertion | ✅ | This is the path; the on-chain assertion is then mirrored to GraphDB by the existing sync |
