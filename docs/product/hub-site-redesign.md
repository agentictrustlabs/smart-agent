# Hub Site Redesign — Product Specification

## Status: Active Development
## Owner: Product / Engineering

---

## Problem Statement

The current app is org-centric: the user picks an org, and all views scope to that org. This creates three UX problems:

1. **The org dominates the UI** — "Mekong Catalyst Network / owner / Network View" fills the header with provenance info instead of letting the user focus on their work context
2. **No multi-context support** — a user who works with multiple cohorts, networks, or agent sets can't switch between them without changing orgs
3. **Navigation is flat** — one nav bar tries to serve all hub types (church, investment, CPM, catalyst) with capability flags hiding/showing items

## Solution: Hub → Context → Views

Replace the org-centric model with a 3-level context:

```
Hub (portal mode) → Active Context (agent set) → Views (pages)
```

- **Hub** sets the mode: which views exist, what terminology is used, what relationship types matter
- **Active Context** is a scoped agent set that drives all views — can be a Collection, Cohort, Network, or Lineage
- **Views** are the pages: Overview, Agents, Network Graph, Lineage, Activities, etc.
- **Anchor Org** stays for access/provenance but moves out of the primary navigation

---

## Design Specs

### Header Layout (3 zones)

```
┌─────────────────────────────────────────────────────────────────────┐
│ [Logo] Smart Agent │ [Hub: Catalyst] │ [Context: Da Nang Hub ▼]  │ [User ▼] │
│                    │                 │  Network · 9 agents        │          │
├─────────────────────────────────────────────────────────────────────┤
│ Overview │ Agents │ Network │ Lineage │ Activities │ Members       │
└─────────────────────────────────────────────────────────────────────┘
```

**Zone 1: Identity** — Logo + "Smart Agent" (links to hub home)
**Zone 2: Hub badge** — Current hub name, small pill. Click opens hub switcher.
**Zone 3: Context selector** — Active context name + summary. Dropdown lists available contexts (collections, cohorts, networks, lineage). Switching context re-scopes all views.
**Zone 4: User** — Name, disconnect, wallet/agent info
**Nav bar** — Hub-driven views. No capability flags — hub profile defines which views appear.

### Context Selector Dropdown

```
┌──────────────────────────────────┐
│ ACTIVE CONTEXT                   │
│ ● Da Nang Hub Network           │
│   9 agents · 22 relationships    │
│                                  │
│ ─────────────────────────────    │
│ AVAILABLE CONTEXTS               │
│                                  │
│ ○ Mekong Catalyst Network        │
│   Portal · 17 agents             │
│                                  │
│ ○ Da Nang Hub Lineage            │
│   7 groups · G3 depth            │
│                                  │
│ ○ Son Tra Group Cohort           │
│   3 agents · 2 members           │
│                                  │
│ ─────────────────────────────    │
│ Anchor Org: Mekong Catalyst Net  │
│ Role: owner                      │
└──────────────────────────────────┘
```

### Hub-Driven Navigation

Each hub defines its nav items via `HubProfile`:

| Hub | Nav Items |
|-----|-----------|
| **Catalyst** | Overview · Agents · Partner Network · Lineage · Activities · Members |
| **CPM** | Movement View · Field Agents · Movement Network · Lineage · Field Activity · Members |
| **Global Church** | Council View · Participants · Church Network · Treasury · Reviews |
| **ILAD** | Operating View · Operators · Delivery Network · Portfolio · Training · Governance |
| **Generic** | Overview · Agents · Network · Treasury · Reviews · Admin |

### Context Re-centering

When the user switches active context:
- Overview page re-scopes to the new context's agent set
- Agents page shows agents in the new context
- Network graph highlights the context's subgraph
- Lineage shows the context's descendant tree
- Activities filter to the context's org address
- All URL params update: `?org=...&context=...&hub=...`

---

## Data Model

### Existing (no changes needed)
- `AgentAccountResolver` — agent identity (on-chain)
- `AgentRelationship` — edges with types and roles (on-chain)
- `ATL_CONTROLLER` — wallet → agent mapping (on-chain)
- `users` table — Privy auth mapping (DB)

### New: Hub Profiles (TypeScript config, already created)
- `src/lib/hub-profiles.ts` — `HubProfile` definitions, `AgentContextView`, builder functions

### New: Context Resolution
- `buildDefaultAgentContexts()` — creates portal, default, network, lineage, collection contexts
- `getHubIdForTemplate()` — maps org templateId → hubId
- Context is computed at request time from anchor org + on-chain edges, not stored

---

## Implementation Phases

### Phase 1: Header + Nav Redesign (Current Sprint)
- [ ] New header layout: logo | hub badge | context selector | user menu
- [ ] Context selector dropdown component
- [ ] Hub-driven nav bar (replaces `GlobalNav.tsx` capability flags)
- [ ] Remove "Mekong Catalyst Network / owner / Network View" pattern from header
- [ ] Anchor org moves to context dropdown footer, not header prominence

### Phase 2: Route Restructuring
- [ ] Route shape: `/hub/[hubSlug]/[view]`
- [ ] Hub slug from login selection or URL
- [ ] Context persisted in URL params: `?context=...`
- [ ] Existing pages become views within hub layout

### Phase 3: Context-Driven Views
- [ ] Overview page scoped to active context
- [ ] Agents page filtered by context agent set
- [ ] Network graph highlights context subgraph
- [ ] Lineage view shows context descendants
- [ ] Activities filtered by context org

### Phase 4: Multi-Context UX
- [ ] Context creation (create new collection/cohort)
- [ ] Context sharing (invite to context)
- [ ] Context pinning (favorites)
- [ ] Cross-context comparison views

---

## Design Principles

1. **Context drives everything** — the user picks a context, and all views follow
2. **Hub sets the vocabulary** — "Lineage" in CPM, "Growth Tree" in ILAD, "Network" in Catalyst
3. **Org is provenance, not navigation** — anchor org explains WHY you're here, not WHAT you see
4. **Graph is the source of truth** — contexts are computed from on-chain edges, not manually curated
5. **Full-width by default** — graph and lineage views fill the viewport, detail views center-constrain

---

## Files to Modify

| File | Change |
|------|--------|
| `src/app/(authenticated)/layout.tsx` | New header with hub badge + context selector + hub nav |
| `src/components/nav/GlobalNav.tsx` | Replace with `HubNav.tsx` — reads nav items from hub profile |
| `src/components/org/OrgSelector.tsx` | Replace with `ContextSelector.tsx` |
| `src/components/org/OrgContext.tsx` | Replace with `HubContext.tsx` — provides hub + context + anchor org |
| `src/app/api/org-context/route.ts` | Return hub profile + available contexts + current context |
| `src/lib/hub-profiles.ts` | Already created — extend with nav items per hub |

---

## Open Questions for Team

1. Should hub selection happen at login (community picker maps to hub) or be switchable in-app?
2. Should contexts be persisted per-user (DB) or computed fresh from graph each time?
3. How does the context selector interact with the graph visualization? (clicking a node → re-center?)
4. Should lineage depth be configurable per context or always full recursion?
5. What's the mobile layout for the 3-zone header?
