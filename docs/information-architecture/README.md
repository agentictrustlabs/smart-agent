# Information Architecture — Smart Agent

This folder is the **authoritative map of where data lives** across Smart Agent's four storage layers, and the **plan for getting there from today's web-heavy schema.**

> **Premise (set by the user, 2026-05-02):** Backwards compatibility is *not* a constraint. We re-seed everything via `scripts/fresh-start.sh` after the cut. Build the right target state; do not carry half-migrations forward.

## Reading Order

| # | Doc | What's in it |
|---|---|---|
| 0 | [README.md](README.md) | This file — index + premise |
| 1 | [01-principles.md](01-principles.md) | Owner-Routing, Four Layers, Visibility Tiers, Access Invariants |
| 2 | [02-data-ownership-map.md](02-data-ownership-map.md) | Every domain concept → its owning store + visibility tier |
| 3 | [03-target-architecture.md](03-target-architecture.md) | Per-store target schema (web SQL, person-mcp, org-mcp, GraphDB, on-chain) |
| 4 | [04-current-state.md](04-current-state.md) | Snapshot of what's actually in each store today (what we're tearing down) |
| 5 | [05-feature-data-flow.md](05-feature-data-flow.md) | Each web feature → which stores it reads/writes after the cut |
| 6 | [06-data-ontology.md](06-data-ontology.md) | How concepts map onto the T-Box / C-Box / A-Box ontology, per store |
| 7 | [07-build-plan.md](07-build-plan.md) | Concrete sequence: build target stores, rewrite seeds, rewire web, drop old |
| 8 | [08-team-assignments.md](08-team-assignments.md) | Which agent role does what part |
| 9 | [09-privacy-audit.md](09-privacy-audit.md) | Current-state scan: every place private data sits in a risky store, with severity and fix |

## Companion Docs

- [docs/architecture/information-architecture.md](../architecture/information-architecture.md) — the on-chain ER model (older, narrower scope; this folder supersedes it for cross-layer questions)
- [docs/agents/information-architect.md](../agents/information-architect.md) — the Information Architect role definition
- [docs/ontology/](../ontology/) — T-Box / C-Box / A-Box turtle source of truth (Ontologist owns)
- [scripts/fresh-start.sh](../../scripts/fresh-start.sh) — the canonical reset that re-seeds everything

## The One-Sentence Architecture

**On-chain anchors authority and is the only path for data to enter GraphDB. MCPs own private state and never write to GraphDB. Web SQL only handles auth, recovery, reference catalogs, and on-chain read caches.**

## The No-Duplication Rule

Each row of data lives in **exactly one** place. The only duplication permitted is **GraphDB mirroring on-chain** via the one-way sync at `apps/web/src/lib/ontology/sync.ts`. No MCP writes to GraphDB. No web SQL holds private data. No cross-store dual-write. If a piece of MCP data needs to be discoverable, the MCP signs an **on-chain assertion** with the owner's session signer; the on-chain assertion is what gets indexed by GraphDB.

## Owner-Routing in One Picture

```
                    ┌────────────────────────────┐
                    │   On-chain (anvil/L1)      │
                    │   identity · authority ·   │
                    │   assertions · engagement  │
                    │   state machine            │
                    └─────────────┬──────────────┘
                                  │
        ┌─────────────────────────┼─────────────────────────┐
        ▼                         ▼                         ▼
  ┌──────────────┐         ┌──────────────┐         ┌──────────────┐
  │  person-mcp  │         │   org-mcp    │         │  family-mcp  │
  │  (per-user)  │         │   (per-org)  │         │  geo-mcp     │
  │              │         │              │         │  skill-mcp   │
  │ owner-keyed  │         │ owner-keyed  │         │  verifier-mcp│
  └──────┬───────┘         └──────┬───────┘         └──────┬───────┘
         │                        │                        │
         └────────────┬───────────┴────────────┬───────────┘
                      ▼                        ▼
              ┌───────────────┐        ┌──────────────────┐
              │   GraphDB     │        │   Web SQL        │
              │ public facts  │        │ auth · session · │
              │ + aggregates  │        │ recovery · refs  │
              └───────────────┘        └──────────────────┘
                      ▲
                      │
                  Discover / search reads here only
```

## Status (2026-05-02)

| Area | State |
|---|---|
| Ownership map drafted | ✅ |
| Target schemas drafted | ✅ |
| Build plan drafted | ✅ |
| Team assignments drafted | ✅ |
| **Phase 0** scaffolding | ✅ |
| **Phase 1** person-mcp domain expansion | ✅ |
| **Phase 2** org-mcp foundation | ✅ |
| **Phase 3** org business data (tools landed) | ✅ |
| **Phase 4** owner-routed intents — schema + tools | ✅ |
| Phase 4 — on-chain assertion emit | 🚧 stubbed (Phase 4 follow-up) |
| **Phase 5** engagement decomposition — schema | ✅ |
| Phase 5 — entitlement state-machine implementation | 🚧 stubbed (web actions wrapped in try/catch) |
| **Phase 6** trust deposit cleanup | ✅ tables dropped, GraphDB aggregates pending |
| **Web SQL clean cut** | ✅ — only 5 tables left, none private |

### Web SQL after the cut (final state)

| Table | Rows | Why it's still here |
|---|---|---|
| `users` | 42 | DID → wallet → smart-account auth mapping. No PII. |
| `recovery_delegations` | 0 | Passkey-recovery bootstrap. Auth concern. |
| `recovery_intents` | 0 | Pending recovery proposals. Auth concern. |
| `invites` | 0 | One-shot org-membership invite codes. |
| `training_modules` | 12 | Reference catalog (411 + BDC). Not user-instance. |

**33 tables physically dropped** by `DROPPED_TABLES` in `apps/web/src/db/index.ts`. Schema.ts retains type stubs for them so existing code typechecks; runtime queries against those types throw "no such table" — that's the safety net that prevents private data from landing in web SQL even if a forgotten code path tries.

### What's not user-visible yet (work that follows the privacy cuts)

- On-chain assertion emit for public intents (`emitOnChainAssertion()` returns null in person-mcp + org-mcp `intents.ts`). Until wired, public intents stay in their owner's MCP without a Discover surface.
- Demo seeder for person-mcp / org-mcp domain tables (oikos / prayers / training / preferences / revenue / proposals). Today fresh-start re-seeds activity_logs and messages directly to MCPs; the rest of the domain comes up empty. A delegation-aware seeder is the next-build target.
- Cross-MCP listeners for engagement events (Phase 5 decomposition). Match-accept / capacity-consume / engagement-close need to route into person-mcp `engagement_holder_state` and org-mcp `engagement_provider_state`.
- GraphDB aggregates over trust-deposit on-chain mints (Phase 6 read model).

These are all *implementation* work after the privacy cut. The core property — **no private user/org data is in web SQL** — is achieved.

## Glossary

- **MCP** — Model Context Protocol server. Each agent type that owns private data runs one (`person-mcp`, `org-mcp`, etc.).
- **Owner-Routing** — Principle that every private row lives in the MCP of the agent that owns it. See [01-principles.md](01-principles.md).
- **Visibility tier** — `public | public-coarse | private | off-chain`. Determines whether a row is mirrored to GraphDB.
- **Public projection** — A read-only mirror in GraphDB of an MCP-owned row whose visibility is `public` or `public-coarse`.
- **Cross-principal delegation** — A signed grant letting agent B read a scoped slice of agent A's MCP data. Implemented in `person-mcp` today; will extend to org-mcp.
