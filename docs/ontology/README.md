# Smart Agent Ontology

Source-of-truth Turtle (.ttl) files for the Agentic Trust Ontology — the RDFS/OWL knowledge model that captures every agent, relationship, role, delegation, intent, and trust signal across the Smart Agent system. Maintained by the **Ontologist** agent (see `docs/agents/ontologist.md`).

## Layout

```
docs/ontology/
├── tbox/             T-Box: schema / classes / properties (domain-neutral)
│   └── shacl/        SHACL constraint shapes (cross-cutting validation)
├── cbox/             C-Box: controlled vocabularies (SKOS concept individuals + per-domain SHACL)
├── abox/             A-Box: runtime instance data (templates; live data emitted to GraphDB)
└── context.jsonld    JSON-LD context (predicate aliases for off-graph payloads)
```

## Reading order for new contributors

1. **`docs/agents/ontologist.md`** — the role guide. Defines T-Box / C-Box / A-Box separation and the Domain Separation Principle (no church / ministry / hub-specific terms in T-Box).
2. **`tbox/core.ttl`** — the agent type hierarchy (Agent / PersonAgent / OrganizationAgent / AIAgentAccount / HubAgent).
3. **`tbox/relationships.ttl`** — the directed-edge model (16 relationship types, materialized as concept individuals in `cbox/controlled-vocabularies.ttl`).
4. **`tbox/marketplace-lifecycle.ttl`** — the spine of class names for the marketplace → fulfillment → outcome flow (UFO-C / VF / PROV-O / ODRL anchored).
5. **`tbox/intents.ttl`**, **`tbox/needs.ttl`**, **`tbox/matches.ttl`**, **`tbox/entitlements.ttl`** — intent + need + match + entitlement layers (the BDI surface).

## Per-initiative audit deliverables

Major initiatives drop their decision record next to this README so contributors can find both the IA classification and the Ontologist's resolution in one place.

| Initiative | IA classification | Ontologist audit |
|---|---|---|
| Intent Marketplace (specs 001/002/003 — discovery / pool / proposal lanes) | [docs/information-architecture/10-intent-marketplace-classification.md](../information-architecture/10-intent-marketplace-classification.md) | [INTENT_MARKETPLACE_AUDIT.md](INTENT_MARKETPLACE_AUDIT.md) — codifies `sa:MatchInitiation`, `sa:PoolPledge`, `sa:GrantProposal`, `sa:Round`, plus Pool/Fund extensions. Resolves 10 IA open questions (O1–O10), applies 17 renames, defines 6 SHACL shapes for the visibility cascade. |

## T-Box files at a glance

| File | Scope |
|------|-------|
| `tbox/core.ttl` | Agent types, UAID, deployment provenance |
| `tbox/identity.ttl` | Multi-facet identity (SmartAgentIdentity, ENS, ERC-8004 …) |
| `tbox/relationships.ttl` | 16 relationship types, edge model, assertion model |
| `tbox/roles.ttl` | 50+ role categories; concrete roles in `cbox/controlled-vocabularies.ttl` |
| `tbox/delegation.ttl` | Delegation model, caveat enforcers, policy templates |
| `tbox/governance.ttl` | Multi-sig governance: votes, quorum, `sag:Proposal` |
| `tbox/hub.ttl` | Hub profiles, organization templates |
| `tbox/marketplace-lifecycle.ttl` | UFO-C / VF / PROV-O / ODRL marketplace spine |
| `tbox/intents.ttl` | Intent / Outcome / OrchestrationPlan / IntentMatch / Belief / Desire / Goal |
| `tbox/needs.ttl` | Need / NeedDescription / NeedOccurrence / Requirement |
| `tbox/matches.ttl` | NeedResourceMatch + **`sa:MatchInitiation` (intent-marketplace)** |
| `tbox/entitlements.ttl` | Entitlement workflow (between accepted match and outcome) |
| `tbox/pool-pledge.ttl` | **`sa:Pool` / `sa:Fund` / `sa:PoolPledge` (intent-marketplace pool lane)** |
| `tbox/proposal.ttl` | **`sa:Round` / `sa:GrantProposal` (intent-marketplace proposal lane)** |
| `tbox/skills.ttl` | OASF skill model |
| `tbox/resources.ttl` | Resource / ResourceOffering |
| `tbox/geo.ttl` | Geographic feature, visibility tiers (`sageo:Visibility`) |
| `tbox/namespace.ttl` | Namespace-contains edges, .agent TLD |
| `tbox/people-groups.ttl` / `tbox/pg.ttl` | People-group affinity model |
| `tbox/trust.ttl` | DnS trust primitives |
| `tbox/shacl/visibility.ttl` | **Visibility-cascade SHACL shapes (intent-marketplace)** |

Bold rows are the intent-marketplace additions documented in [INTENT_MARKETPLACE_AUDIT.md](INTENT_MARKETPLACE_AUDIT.md).

## Authoring rules (terse)

- T-Box = **domain-neutral**. No church / hub / CIL terms. See `docs/agents/ontologist.md` § "Domain Separation Principle".
- C-Box = anything with `skos:notation` / `skos:inScheme`. Status enums, role individuals, vocab schemes.
- A-Box = runtime instance data. Templates live here; live data flows to GraphDB via the sync utility.
- Every class and property MUST have `rdfs:label` AND `rdfs:comment`.
- Use existing prefixes (`sa:`, `sai:`, `sar:`, `sad:`, `sag:`, `saneed:`, `saint:`, `samatch:`, `saoffer:`, `saent:`, `sageo:`, `hub:`, `vf:`, `ufo:`, `prov:`, `dul:`, `p-plan:`, `skos:`). Don't introduce new namespaces unless absolutely necessary.

## Sync to GraphDB

T-Box edits are uploaded to the GraphDB `SmartAgents` repository, named graph `https://smartagent.io/graph/ontology`. Live agent + edge data lives in `https://smartagent.io/graph/data/onchain`. Sync entrypoint is `apps/web/src/lib/ontology/sync.ts` (consult before running). After sync, run the SPARQL validation queries documented in `docs/agents/ontologist.md` § "SPARQL Validation Queries" to confirm class / agent / edge counts.
