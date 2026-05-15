# Architecture Index For Agents

This is the routing index for all architecture work. Every agent should start here when a task has architecture, data-flow, security, service-boundary, UX, or operational implications.

## How To Use This Index

1. Identify the concern area.
2. Open the primary architecture file.
3. Follow the related files before proposing or implementing changes.
4. If the task crosses boundaries, read each relevant area before deciding.

## Concern Routing

| Concern | Primary file | Related files |
| --- | --- | --- |
| Whole-system orientation | [System Map](./00-system-map.md) | [Agent Handoff Guide](./08-agent-handoff-guide.md), [Overview](./overview.md) |
| Web to backend service calls | [Web, A2A, and MCP Flows](./01-web-a2a-mcp-flows.md) | [Auth, Sessions, and Delegation](./02-auth-session-delegation.md), [Persistence and Data Stores](./05-persistence-data-stores.md) |
| Authentication, sessions, delegation | [Auth, Sessions, and Delegation](./02-auth-session-delegation.md) | [Agent Control](./agent-control.md), [Passkey Session Signing](./passkey-session-signing.md), [AnonCreds SSI Flow](./anoncreds-ssi-flow.md) |
| On-chain contracts and local Anvil | [On-Chain and Anvil Architecture](./03-onchain-anvil-contracts.md) | [Contracts](./contracts.md), [Technical Architecture](./technical-architecture.md) |
| GraphDB, RDF, discovery, public projection | [GraphDB and Knowledge Sync](./04-graphdb-knowledge-sync.md) | [Information Architecture](./information-architecture.md), [System Map](./00-system-map.md) |
| Data ownership and persistence | [Persistence and Data Stores](./05-persistence-data-stores.md) | [Information Architecture](./information-architecture.md), `docs/information-architecture/README.md` |
| Marketplace, grants, pools, rounds, proposals, votes, commitments | [Marketplace and Funding Architecture](./06-marketplace-funding-flow.md) | [Web, A2A, and MCP Flows](./01-web-a2a-mcp-flows.md), [Persistence and Data Stores](./05-persistence-data-stores.md) |
| Local development, deploy, seed, readiness | [Local Development Orchestration](./07-local-dev-orchestration.md) | [Operational Architecture](./10-operational-architecture.md), [System Map](./00-system-map.md) |
| UX, UI, navigation, action center, user flows | [User Experience Architecture](./09-user-experience-architecture.md) | `docs/specs/ux-component-specs.md`, `docs/product/hub-site-redesign.md` |
| Operations, observability, environments, recovery | [Operational Architecture](./10-operational-architecture.md) | [Local Development Orchestration](./07-local-dev-orchestration.md), [System Architecture](./system-architecture.md) |
| Agent-to-agent relationships and roles | [Relationship Protocol](./relationship-protocol.md) | [Information Architecture](./information-architecture.md), [GraphDB and Knowledge Sync](./04-graphdb-knowledge-sync.md) |
| Ontology, T-Box, C-Box, A-Box | `docs/ontology/README.md` | `docs/information-architecture/ontology/README.md`, [GraphDB and Knowledge Sync](./04-graphdb-knowledge-sync.md) |
| Security, threat modeling, permission scope | [Auth, Sessions, and Delegation](./02-auth-session-delegation.md) | [Agent Control](./agent-control.md), [Operational Architecture](./10-operational-architecture.md) |

## Architecture File Set

### Current Runtime Diagrams

- [00-system-map.md](./00-system-map.md) - service topology, ports, runtime responsibilities.
- [01-web-a2a-mcp-flows.md](./01-web-a2a-mcp-flows.md) - web server actions, A2A routing, MCP proxy, direct-bypass notes.
- [02-auth-session-delegation.md](./02-auth-session-delegation.md) - auth, A2A session packages, delegation and MCP authorization.
- [03-onchain-anvil-contracts.md](./03-onchain-anvil-contracts.md) - local chain, contract families, SDK, viem paths.
- [04-graphdb-knowledge-sync.md](./04-graphdb-knowledge-sync.md) - GraphDB, discovery, RDF sync, source-of-truth rules.
- [05-persistence-data-stores.md](./05-persistence-data-stores.md) - web DB, MCP DBs, Askar, A2A DB, chain, GraphDB.
- [06-marketplace-funding-flow.md](./06-marketplace-funding-flow.md) - funding lifecycle and domain flows.
- [07-local-dev-orchestration.md](./07-local-dev-orchestration.md) - fresh-start, deploy, seed, readiness.
- [08-agent-handoff-guide.md](./08-agent-handoff-guide.md) - common task routing and anti-patterns.
- [09-user-experience-architecture.md](./09-user-experience-architecture.md) - product IA, UI patterns, action center, funding UX.
- [10-operational-architecture.md](./10-operational-architecture.md) - operations, environments, readiness, logs, recovery.

### Existing Deep References

- [overview.md](./overview.md) - historical broad overview.
- [technical-architecture.md](./technical-architecture.md) - monorepo and contract technical reference.
- [system-architecture.md](./system-architecture.md) - runtime and deployment flows.
- [information-architecture.md](./information-architecture.md) - on-chain data and ontology-oriented architecture.
- [contracts.md](./contracts.md) - contract-level deep dive.
- [agent-control.md](./agent-control.md) - account governance and control.
- [relationship-protocol.md](./relationship-protocol.md) - relationship edge lifecycle and roles.
- [auth-and-onboarding.md](./auth-and-onboarding.md) - authentication and onboarding.
- [anoncreds-ssi-flow.md](./anoncreds-ssi-flow.md) - SSI and credential flow.

## Role Routing

| Agent role | Must read first | Also read when relevant |
| --- | --- | --- |
| Orchestrator | [Agent Handoff Guide](./08-agent-handoff-guide.md) | This index and any affected concern area |
| PM | [User Experience Architecture](./09-user-experience-architecture.md) | Marketplace, persistence, operations |
| Developer | [System Map](./00-system-map.md) | Web/A2A/MCP, persistence, on-chain, funding |
| Tester | [Local Development Orchestration](./07-local-dev-orchestration.md) | Operational architecture and affected domain files |
| Reviewer | [Agent Handoff Guide](./08-agent-handoff-guide.md) | All architecture files touched by the PR |
| QA | [User Experience Architecture](./09-user-experience-architecture.md) | Local dev orchestration and marketplace flow |
| Infra | [Operational Architecture](./10-operational-architecture.md) | Local development orchestration and system map |
| Test User | [User Experience Architecture](./09-user-experience-architecture.md) | Marketplace flow and action center sections |
| Documentarian | This index | All changed architecture files |
| Information Architect | [Persistence and Data Stores](./05-persistence-data-stores.md) | GraphDB sync, ontology docs |
| Ontologist | [GraphDB and Knowledge Sync](./04-graphdb-knowledge-sync.md) | Ontology docs and information architecture |
| Security | [Auth, Sessions, and Delegation](./02-auth-session-delegation.md) | Agent control, operations, A2A/MCP flows |
| UI Designer | [User Experience Architecture](./09-user-experience-architecture.md) | Marketplace and operational architecture |

## Boundary Rules

- User-initiated person/org actions should go through web -> A2A -> MCP.
- Public canonical facts should live on-chain and mirror to GraphDB.
- Private person/org data should live in the owning MCP.
- Web SQL should not become a shadow domain database.
- GraphDB is a public query projection, not the source of truth.
- A2A owns session packages and MCP proxy behavior, not domain content.
- Money-moving actions need explicit review, confirmation, and auditability.
- UI should not expose raw addresses, hashes, URNs, credential IDs, or ontology CURIEs as primary labels.

## When To Update This Index

Update this file whenever:

- a new service or MCP is added,
- a new data store is introduced,
- a new architecture area gets a document,
- source-of-truth rules change,
- a major user flow changes service boundaries,
- agent guide routing changes.
