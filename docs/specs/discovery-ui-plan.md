# Graph-Aware Discovery UI — Phases 5 & 6

> **Status**: design
> **Scope**: UI surfaces only. Underlying data (relationships, coaching edges, skill claims, geo claims, disputes, validations) already exists or lands in adjacent plans. This plan does **not** add contracts.
> **Companion to**: `agent-skills-plan.md` (skill column), `validation-feedback-plan.md` (trust-explanation object), `demo-work-items.md` (per-silo demo items).

## 1. Goals

The trust search column-stack (org / geo / skill) answers *"who matches"* — a flat ranking. It does not answer the two questions a real user actually asks before reaching out:

| Question | Phase | Surface |
| --- | --- | --- |
| "How am I connected to this person?" | **5a** | Relational-distance card on agent profile |
| "Who is coaching whom inside this network?" | **5b** | Coaching panel on agent profile + hub overview |
| "Show me agents who can write grants and live near Erie, in Spanish, willing to coach" | **6** | LLM intent → structured discovery query |

Phase 5 ships a **graph view of one relationship**; Phase 6 ships a **natural-language entry point to all relationships**. Build 5 first — it grounds 6's output rendering.

---

## 2. Phase 5a — Relational-Distance Card

### Surface

A card on the **agent profile page** (`/agents/[address]`), pinned above the existing relationship list. Shown only when the viewer is signed in and the profile is **not** the viewer's own agent.

```
┌─ Relational distance ───────────────────────────────────┐
│  You are 2 steps away                                  │
│                                                         │
│  You ── coaches → Maria ── coaches → Ana                │
│  via: Catalyst Hub → Wellington Circle                  │
│                                                         │
│  Shared: 3 orgs · 1 hub · grant-writing skill · Erie    │
│                                                         │
│  [ Ask Maria for an intro → ]  [ View shortest path ]   │
└─────────────────────────────────────────────────────────┘
```

### Data source

Walk the trust graph from `viewer.personAgent` to `subject.address` over edges with non-zero trust weight. Re-uses primitives the trust-search action already pulls:

- `getEdgesBySubject(viewer)` — outbound edges
- `getEdgesByObject(viewer)` — inbound edges
- BFS over a configurable depth cap (`MAX_DEPTH = 4`)
- Edge weight: 1 step per edge, but **same-hub** edges count as 0.5 (you and the subject are both members of Catalyst Hub → that's not a real "step away")
- Stop at first path found; do not enumerate all paths

The path-walk runs server-side in a new action `computeRelationalPath(viewer, subject)`. Cached in memory keyed on `(viewer, subject, edgesBlockNumber)` so re-renders during a session don't re-walk.

### Visual structure

```tsx
<RelationalDistanceCard>
  <Header>You are <Distance n={2} /> steps away</Header>
  <PathChain segments={[
    { from: 'you',   relation: 'coaches', to: 'maria.agent' },
    { from: 'maria', relation: 'coaches', to: 'ana.agent' },
  ]} />
  <ContextLine vias={['Catalyst Hub', 'Wellington Circle']} />
  <SharedFacets orgs={3} hubs={1} skills={['grant-writing']} geo={['Erie']} />
  <Actions>
    <IntroButton intermediary={firstHopAgent} />
    <ViewFullPath />
  </Actions>
</RelationalDistanceCard>
```

`PathChain` is a horizontal flex of name pills connected by relation-typed arrows. Pill color comes from the agent-type token (person = slate, org = indigo, AI = teal). Arrow label uses the role from the edge (`coaches`, `member-of`, `governs`, `validates`).

### Edge cases

- **Distance = 0** (viewing self) → don't render the card; hide entirely
- **Distance = 1** (direct edge) → "You are directly connected" — no path chain, just the edge type and a "Strengthen connection" CTA (e.g. confirm a proposed edge, mint a coaching attestation)
- **No path found** within MAX_DEPTH → "No path found within 4 hops — but you share 2 orgs and 1 city tag" — fall back to the SharedFacets line as the only signal
- **Disputed edge in path** → render the disputed segment in red; show a tooltip linking to the dispute record; the path still counts but earns a visual warning
- **Path includes the org you're a member of and the subject is too** → label as "via shared org" not as a real step
- **Sensitive (`OffchainOnly` / `PrivateCommitment`) edges** → never traversed in the public path-walk; if the only path is private, show "Path exists privately — request introduction"

### Performance budget

- BFS bounded at depth 4, branching factor capped at 25 per node (drop nodes with >25 edges from the frontier — those are hubs/networks, not people)
- Target: <300ms on the seed graph (~100 agents, ~250 edges); 95p <800ms
- Falls back to "computing…" skeleton if the action takes >500ms

---

## 3. Phase 5b — Coaching Panel

### Surface

A new panel on the **agent profile**, below the relational-distance card and above the skills panel. Two views, switchable via a tab inside the panel:

| Tab | Content |
| --- | --- |
| **Coaching** (default if subject has any coach/disciple edges) | Tree of who coaches the subject and who the subject coaches |
| **Lineage** | Already-shipped `GroupHierarchy` lineage view, embedded |

```
┌─ Coaching network ──────────────────────────────────────┐
│  [ Coaching ] [ Lineage ]                              │
│                                                         │
│      David Chen                                         │
│        ↓ coaches                                        │
│      Maria Gonzalez (you are viewing)                   │
│        ↓ coaches                                        │
│      Ana Reyes ── coaches → 3 group leaders             │
│                                                         │
│  Coaching capacity: 2 active disciples · 3-month avg    │
│  Last coaching activity: 4 days ago                     │
└─────────────────────────────────────────────────────────┘
```

### Data source

- Edges of type `CoachingMentorshipRelationship` (already in taxonomy, role hashes `CoachRole` / `DiscipleRole`)
- Walk **upward** (who coaches *me*?) up to 2 levels and **downward** (who do *I* coach?) up to 2 levels — capacity past 2 levels gets a "+N more" expander
- Activity recency: most recent assertion on any edge in the visible coaching tree
- Capacity/avg duration: aggregate over `validAfter`/`validUntil` on coaching edges where the subject is the coach

### Visual structure

A compact vertical tree. Each node is a name pill (same token system as the relational-distance card). Edges are labeled with `coaches`. Subject node is highlighted.

Below the tree, a **stats strip** with three cells:
- *Active disciples* — count of subject's downward edges
- *Avg coaching duration* — `(now - earliest validAfter) / count`
- *Last activity* — recency badge (green ≤7d, amber ≤30d, red >30d)

### Interactions

- Click a name → navigate to that agent's profile (recursive entry point — the relational-distance card on the next profile recomputes from the new viewpoint)
- Right-click / long-press a coaching edge → action menu: "Validate this coaching relationship" (opens `AgentValidationProfile` mint flow), "Mint review", "File dispute"
- "Coaching" tab also shows a small **"+ Add coaching relationship"** button, visible only when the subject is the viewer's own agent — opens the same `AddRelationshipPanel` already in the codebase, pre-filled with `CoachingMentorshipRelationship`

### Edge cases

- **No coaching edges** — render an empty state with a single CTA: "Add a coach" (opens the relationship panel pre-filled, scrolls to coach selection)
- **Cyclic coaching** (A coaches B coaches A — discouraged but possible) — render the cycle once, mark the second occurrence with a curved arrow; do not infinite-recurse
- **Stale edges** (`validUntil < now`) — render greyed-out with a "lapsed" pill; do not count them in the active-disciples stat
- **Disputed coaching edge** — render with red dashed arrow; link to dispute record

### Hub-overview variant

The same data renders differently on the **hub home page** (`/h/[hubId]`) as a **coaching graph thumbnail**:
- Force-directed mini-graph of every coaching edge in the hub
- Click → navigate to a full-page `/h/[hubId]/coaching` route showing the coaching subgraph at full size, with filters (active/lapsed, by circle, by skill domain)
- Counter: "*N active coaching pairs · M coaches · K disciples*"

---

## 4. Phase 6 — LLM Intent Parsing

### Surface

A natural-language search box at the top of `/agents` and on every hub home page, replacing or supplementing the existing keyword search.

```
┌─────────────────────────────────────────────────────────┐
│  🔍 Find people who…                                   │
│                                                         │
│  [ "Spanish-speaking grant writers near Loveland   ] →  │
│  [  who can coach a new circle leader"             ]    │
└─────────────────────────────────────────────────────────┘
```

When the user submits, the LLM intent parser returns a **structured discovery query**, which renders as **chips below the box** before running:

```
Parsed your request as:
  [ language=es ]  [ skill=grant-writing ]  [ near=loveland.colorado.us.geo ]
  [ skill=mentor-of-mentors ]  [ orderBy=relationalDistance ]
  [ Edit ↻ ]   [ Search → ]
```

The user sees what the LLM extracted, can edit/remove chips, and only then runs the search. **No hidden interpretation.**

### Data source

Server action `parseSearchIntent(text: string)` calls Claude (Haiku for cost; Sonnet fallback if Haiku confidence <0.6) with a tightly-scoped tool definition:

```ts
const SEARCH_INTENT_SCHEMA = {
  language: 'string|null',          // ISO 639-1
  skills: 'array<{conceptId, weight}>',  // concept-IDs from the published skill taxonomy
  geo: 'array<{featureId, relation, radius?}>',
  orgs: 'array<orgId>',
  capabilities: 'array<capabilityId>',
  excludes: 'array<{type,value}>',  // "not in Berthoud", "not under dispute"
  orderBy: 'enum(score|relationalDistance|recency|capacity)',
  intent: 'enum(find|introduce|recruit|coach|cite)',  // top-level act
}
```

The model is given only:
- The current user's hub context (Catalyst NoCo) — narrows skill/geo vocabulary
- A retrieval-augmented prompt with the **published** skill concept IDs and `.geo` names (no PII, no private claims)
- The schema above

It returns a structured object. The existing trust-search action consumes the structured object, **not the raw text** — the parser is a translator, not the search engine.

### Visual structure

```tsx
<IntentSearchBar>
  <Textarea placeholder="Find people who…" autosize />
  <SubmitButton onClick={parseIntent} />

  {parsedIntent && (
    <IntentChips>
      {parsedIntent.skills.map(s   => <SkillChip   {...s} editable />)}
      {parsedIntent.geo.map(g      => <GeoChip     {...g} editable />)}
      {parsedIntent.language && <LanguageChip ... />}
      {parsedIntent.orderBy   && <OrderByChip  ... />}
      <ResetButton />
      <RunSearchButton onClick={runStructuredSearch} />
    </IntentChips>
  )}

  <Results>
    <AgentTrustSearchResults  // existing component, props extended
      structuredQuery={parsedIntent}
      onResultClick={navToAgentProfile}
    />
  </Results>
</IntentSearchBar>
```

### Result rendering

Existing `AgentTrustSearch` rows get **two** new columns when a structured query is active:

1. **Why this match** — chips showing which parsed-intent facets the row matched. Hover → "matches `skill=grant-writing` (proficiency 7500), `near=loveland` (residentOf), missed `language=es`".
2. **Steps away** — the relational-distance number from Phase 5a (zero RPC cost — it walks the same edge cache).

When `orderBy=relationalDistance`, the row sort is by step-count ascending; ties broken by overlap score.

### LLM safety / cost

- Hard cap: 1 request per user per 5 seconds (debounce)
- 200-token output cap on the parser
- If Haiku returns malformed JSON, retry once with Sonnet and a "STRICT JSON" instruction; otherwise show the raw text as a hint and fall back to keyword search
- The prompt is read-only — the parser cannot trigger side effects, mint claims, or send messages
- The structured-query object is logged (without the user's free text) so we can see which facets are actually used and prune the schema

### Edge cases

- **Empty / nonsense input** → "Please describe who you're looking for" (don't call the LLM)
- **Ambiguous geo** ("near Erie" — Erie CO, Erie PA, or `erie.colorado.geo` the org-named place?) → return both as chips; user picks one
- **Skill not in taxonomy** ("looking for a doula") → render an *unmatched* chip with a "request this skill be added" CTA — never silently drop the term
- **Privacy** → the LLM sees only public taxonomy; if the user types "find people with addiction recovery experience" the parser may return `skill=recovery-program-facilitation` but the result list still respects each candidate's claim visibility

---

## 5. Build Order

| M | Deliverable | Files | Acceptance | Dependencies |
| --- | --- | --- | --- | --- |
| **D1** | `computeRelationalPath` action + BFS | `apps/web/src/lib/actions/relational-distance.action.ts` | Path returned for two seeded agents; cached on second call | existing edge readers |
| **D2** | `RelationalDistanceCard` component | `apps/web/src/components/profile/RelationalDistanceCard.tsx` | Renders on `/agents/[address]`; shows "0/1/2/3 steps", path chain, shared facets | D1 |
| **D3** | `CoachingPanel` component | `apps/web/src/components/profile/CoachingPanel.tsx` | Renders coach + disciple tree from coaching edges; stats strip | existing `coaching-mentorship` taxonomy + seed |
| **D4** | Hub-overview coaching thumbnail + `/h/[hubId]/coaching` route | `apps/web/src/components/hub/CoachingGraphThumb.tsx`, `apps/web/src/app/h/[hubId]/(hub)/coaching/page.tsx` | Force-directed mini-graph clicks through to full view | D3 |
| **D5** | `parseSearchIntent` action + Claude integration | `apps/web/src/lib/actions/parse-search-intent.action.ts` | Free text → structured query; rate-limited; falls back to keyword search on parse failure | retrieval-augmented prompt with current taxonomy |
| **D6** | `IntentSearchBar` + chip editor | `apps/web/src/components/trust/IntentSearchBar.tsx` | Parsed chips render inline, editable; "Run search" feeds existing trust-search action | D5 |
| **D7** | "Why this match" + "Steps away" columns on results | extend `AgentTrustSearch.tsx` | Each result row shows facet chips and step-count when structured query is active | D2, D6 |

Recommended order: **D1 → D2 → D3 → D4 (parallel with D5) → D6 → D7**. D5 (Claude integration) is the highest-risk piece — start prototyping it in parallel with D3/D4 so cost / latency / accuracy reality checks land before D6 commits to the shape.

## 6. Open Questions

1. **Relational-distance weighting** — same-hub-membership at 0.5 cost is an editorial call. Should it be 0 (you and the subject are co-members → not a "step")? 1.0 (every edge is a step)? Calibrate against demo data before D1 ships.
2. **Coaching panel cycle handling** — A coaches B, B coaches A is a real pattern (peer coaching). Render as cycle, or split into two panels?
3. **LLM provider** — Claude Haiku for parser is the default per the user's stack, but local Llama on a small fine-tune may be cheaper at scale. Defer until D5 has a working baseline.
4. **Intent chip persistence** — when the user edits a chip and re-runs, do we keep the original free text or replace it with a chip-driven query string? Lean toward "chip is source of truth after first parse."
5. **Empty state for "no path found"** — fall back to SharedFacets only, or proactively suggest an introduction request to the closest mutual edge? D2 has to pick.

## 7. Out of Scope (defer to later phases)

- Multi-step natural-language conversations ("now narrow to people I haven't talked to in 6 months")
- Voice input
- Ranking diversification (avoid showing 5 coaches all from the same circle)
- Trust-search column reorg (already noted as a v1 follow-up in `agent-skills-plan.md`)
- Cross-hub relational-distance walks (single hub for v0)
- Privacy-preserving path search via ZK (would need its own circuit; tracked in Phase-6-style spec)

---

## 8. UX Notes

- **No animated path-tracing.** The relational-distance card is information-dense — animating arrows from "you" to subject is showy and slow. Static layout, animate only on hover.
- **Don't bury the source of truth.** Every chip in the intent search has a tooltip showing the underlying concept ID / feature ID — power users can verify what the LLM extracted.
- **One canonical pill style across all surfaces.** Name pills in the relational-distance card, coaching panel, and intent chips share the same component (`<AgentPill>`) so a Maria appearing in three contexts looks consistent.
- **Coaching panel feels like the relationship view, not a separate app.** Reuse the network-graph node/edge tokens; this is "your coaching layer of the same graph."
- **Intent search is additive, not replacement.** The keyword search box stays; intent search opens with a "Try natural language" affordance and remembers the user's last preference.

---

This plan and `demo-work-items.md` together close out the demo-loop: the seeded graph (Phase 0–4) feeds the relational-distance card and coaching panel (Phase 5), which feed the intent search (Phase 6), which generates the queries that exercise the seed.
