# 01 — Principles

These are the load-bearing invariants. Every later doc in this folder applies them.

## P1. Owner-Routing

**Every row of private data has exactly one owning agent. The row lives in that agent's MCP.**

- The owning agent is the agent whose private boundary the data falls inside.
- A "person agent" owns its profile, prefs, oikos, prayers, training progress, personal intents/needs/offerings, personal activity logs, personal work items, personal messages.
- An "org agent" owns its revenue reports, proposals, org activity logs, org intents/needs/offerings, org outcomes, org work items, org engagement sessions/tranches/policies, detached members, org messages.
- A "family agent", "skill agent", etc. owns the data for its specialized domain.

Consequence: no table contains rows owned by different agents. The current web `intents` table — which holds both person- and org-expressed rows in one table — is the canonical violation we are removing.

## P2. Multi-Party Decomposition

When a concept involves multiple agents (e.g. an engagement between a holder and a provider), it is split into:

1. **On-chain backbone** — the public, ordered truth: matchId, entitlementId, status transitions, signatures, mints. Anyone can read.
2. **Per-party private side-state** — each party's private metadata about the engagement, in *their* MCP, indexed by the on-chain id. The provider's MCP holds work-item assignments, session schedules, tranche disbursement notes; the holder's MCP holds outcome tracking, capacity-consumed counters.
3. **Public projection** — a GraphDB record summarizing the engagement for discovery/reputation queries.

No store holds "the entitlement row" in full. The on-chain id is the join key.

## P3. The Four Layers


| Layer                                                          | Owns                                                                                                                        | Readers                     |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| **On-chain**                                                   | Identity, authority, commitments, assertions, the engagement state machine                                                  | Anyone                      |
| **Per-agent MCPs** (person, org, family, skill, verifier, geo) | Private state of exactly one agent                                                                                          | Owner + delegation grantees |
| **GraphDB**                                                    | Public projections, materialized aggregates, discovery indices                                                              | Anyone (read-only)          |
| **Web SQL**                                                    | Auth/session, recovery bootstrap, reference catalogs, on-chain caches, the public-projection mirror that powers Discover UI | Web app only                |


Web SQL is **not** authoritative for any private user/org data after the cut.

## P4. No Duplication. The Public/Private Split is Physical.

**Each row of data lives in exactly one place.** The only duplication permitted is **GraphDB mirroring on-chain public data** — and even that is one-way and read-only.

No "public projection" of MCP rows to GraphDB. No web SQL caching of private data. No dual-write between stores.

| If data is…                                                                                  | It lives in…                | Discoverable in GraphDB?     |
| -------------------------------------------------------------------------------------------- | --------------------------- | ---------------------------- |
| Public (identity, edges, assertions, governance, public intents/offerings, engagements)      | **on-chain**                | yes (one-way sync from chain) |
| Private (PII, preferences, prayers, oikos, financials, internal notes, private intents)      | **the owning agent's MCP**  | **no**                       |

If a piece of MCP data needs to be discoverable, it is **anchored on-chain via an assertion** (e.g., `makeAssertion` mints a public claim). The MCP retains private detail; the on-chain assertion is what gets indexed by GraphDB. The MCP itself never writes to GraphDB.

### Visibility tiers (per row in an MCP)

A row's `visibility` tells the MCP whether to *also* emit a public on-chain assertion when the row is created/updated:

| Tier            | Row in MCP | On-chain assertion emitted                                  | GraphDB sees                            | Use                                          |
| --------------- | ---------- | ----------------------------------------------------------- | --------------------------------------- | -------------------------------------------- |
| `public`        | Full row   | Yes — full public fields                                    | The on-chain assertion (not the MCP row)| Marketplace-discoverable intent / offering   |
| `public-coarse` | Full row   | Yes — coarse fields only (kind, region, capacity bucket)    | The coarse on-chain assertion           | "N open intents in region X" stats           |
| `private`       | Full row   | No                                                          | (nothing)                               | PII, prayers, financial detail, coaching     |
| `off-chain`     | Full row   | No                                                          | (nothing)                               | Drafts, working state, never published       |

**Critical:** GraphDB is fed *only* by the on-chain → GraphDB sync (`apps/web/src/lib/ontology/sync.ts`). The MCP does not call GraphDB. If the on-chain assertion does not exist, the data does not appear in GraphDB. Period.

### Consequence: Discover only sees on-chain data

Discover, search, and reputation queries read GraphDB. GraphDB only mirrors on-chain. Therefore Discover only sees what an agent has *explicitly* anchored on-chain. Private data is invisible to Discover by construction — not because of a forgotten filter, but because the data was never published.

## P5. Access Invariants (read & write)

- **Reads** of a non-public row require a delegation token from the owner. The MCP verifies on every call. (`person-mcp` already does this; `org-mcp` will adopt the same pattern.)
- **Writes** to an owner's MCP require either the owner's session OR a write-scoped delegation.
- **Cross-agent reads** (coach reads disciple's training, hub admin reads member's oikos summary) use scoped cross-principal delegations. The pattern in `person-mcp`'s `get_delegated_profile` extends to other resources.
- **Web app holds no private session keys.** All reads/writes against MCP private data go through the agent's session signer (passkey-rooted) or a delegation token issued by the owner.

## P6. No Backwards Compatibility

The user's directive (2026-05-02): we don't carry old shapes forward. Concretely:

- No adapter that writes to both old and new schema during a transition.
- No "compatibility read model" that joins web SQL with MCP data.
- No deprecated tables left "for now".
- After the cut, `scripts/fresh-start.sh` re-seeds the entire stack into the new shape. Demo state is re-derivable from on-chain + seed scripts.

The build sequence in `07-build-plan.md` follows this: build the new stores, rewrite the seeds, rewire the web actions, drop the old tables — then run fresh-start.

## P7. The Web App is a Renderer

After the cut, web app responsibilities collapse to:

- Auth (Privy) and session management (cookies)
- Recovery bootstrap (passkey enrollment, guardian delegations)
- Reference catalog reads (training modules, hub vocabulary, on-chain caches)
- Calling the right MCP for owner-private state, with the user's delegation
- Reading GraphDB for discovery/search/reputation
- Reading on-chain for identity/authority/assertions
- Rendering React

Server actions become thin client adapters. They do not query private data from local SQLite anymore.

## P8. The Ontology is the Type System

T-Box classes (`sa:PersonAgent`, `sa:Intent`, `sa:Engagement`, etc.) are the type system that bridges the four layers. A concept's home in a physical store is a *deployment* of an ontology class:

- `sa:PersonProfile` → person-mcp `profiles` table → optional public projection in GraphDB
- `sa:OrgRevenueReport` → org-mcp `revenue_reports` table → no projection (always private)
- `sa:Intent` (visibility=public) → owner's MCP `intents` table + GraphDB mirror

Every table in this folder's schema docs names its T-Box class. Adding a table without an ontology term is rejected by the IA review.

## P9. Failure Modes We Reject

- **Cross-owner tables.** A single table whose rows belong to different agents.
- **Shadow ownership.** Two stores both claim authority for the same concept.
- **Public-by-default.** A row defaulting to `public` because the developer didn't set `visibility`.
- **Web-side JOINs across boundaries.** A web SQL query that joins person-private to org-private to "make a dashboard work" — the dashboard hydrates from each MCP separately and merges in the API route.
- **Hidden delegation scopes.** A new MCP tool merged without an explicit Security-approved delegation gate.

