# Smart Agent — Architecture Documentation

## Overview

Smart Agent is an **Agent Smart Account Kit** — an ERC-4337 smart account framework where agents are first-class principals operating under programmable delegation, multi-sig governance, and trust-graph-aware policy.

## Documentation Index

| Document | Description |
|----------|-------------|
| [Architecture Index For Agents](./INDEX.md) | **Start here for agents** — routes work by concern, role, and architecture boundary |
| [System Map](./00-system-map.md) | Current service topology and index for the diagram set |
| [Web, A2A, and MCP Flows](./01-web-a2a-mcp-flows.md) | Web server actions, A2A host routing, MCP proxy, direct-bypass notes |
| [Auth, Sessions, and Delegation](./02-auth-session-delegation.md) | Login, A2A sessions, delegation packages, MCP authorization |
| [On-Chain and Anvil Architecture](./03-onchain-anvil-contracts.md) | Local chain, contract families, SDK and viem interaction paths |
| [GraphDB and Knowledge Sync](./04-graphdb-knowledge-sync.md) | Discovery reads, RDF projection, hub-mcp sync, GraphDB source-of-truth rules |
| [Persistence and Data Stores](./05-persistence-data-stores.md) | Web DB, A2A DB, MCP DBs, Askar, chain state, GraphDB ownership |
| [Marketplace and Funding Architecture](./06-marketplace-funding-flow.md) | Intents, pools, rounds, proposals, votes, commitments, pledges, transfers |
| [Local Development Orchestration](./07-local-dev-orchestration.md) | Fresh start, deploy, seed, readiness, process topology |
| [Agent Handoff Guide](./08-agent-handoff-guide.md) | Which architecture doc agents should read for common implementation tasks |
| [User Experience Architecture](./09-user-experience-architecture.md) | UX mental models, navigation, action center, funding UX, confirmation patterns |
| [Operational Architecture](./10-operational-architecture.md) | Environments, readiness, logs, reset, recovery, operational boundaries |
| [Overview](./overview.md) | **Start here** — service topology, interaction diagrams, security model |
| [Technical Architecture](./technical-architecture.md) | Contract suite, SDK, monorepo structure |
| [System Architecture](./system-architecture.md) | Runtime, deployment, data flow |
| [Information Architecture](./information-architecture.md) | Data models, ontology, trust graph |
| [Contracts](./contracts.md) | Per-contract deep dive |
| [Agent Control](./agent-control.md) | EOA → Agent governance, multi-sig, permissions |
| [Relationship Protocol](./relationship-protocol.md) | Agent-to-agent relationships, roles, delegation |
| [Authentication & Onboarding](./auth-and-onboarding.md) | Google / Passkey / MetaMask login, smart-account deployment, name registration, onboarding wizard |
| [AnonCreds, ssi-wallet-mcp & person-mcp](./anoncreds-ssi-flow.md) | Three-process SSI architecture, WalletAction envelope, issuance / presentation / rotation sequence diagrams |
