# On-Chain and Anvil Architecture

This document maps local Anvil, deployed contracts, SDK usage, and web/backend on-chain interaction paths.

## Local Chain Topology

```mermaid
flowchart TB
  anvil["Anvil RPC :8545, chainId 31337"]
  deploy["scripts/deploy-local.sh"]
  env["apps/web/.env contract addresses"]
  contracts["packages/contracts"]
  sdk["packages/sdk"]
  web["apps/web"]
  org["apps/org-mcp"]
  hub["apps/hub-mcp"]

  deploy --> anvil
  deploy --> contracts
  deploy --> env
  env --> web
  env --> org
  env --> hub
  web --> sdk --> anvil
  org --> sdk --> anvil
  hub --> sdk --> anvil
```

## Contract Families

```mermaid
flowchart TD
  accounts["Agent Accounts"]
  delegation["Delegation"]
  identity["Identity and Names"]
  relationships["Relationships and Trust"]
  ontology["Ontology and Attributes"]
  funding["Funding Registries"]
  commitments["Commitments, Votes, Pledges"]

  accounts --> accountContracts["AgentAccount, AgentAccountFactory, EntryPoint"]
  delegation --> delegationContracts["DelegationManager, caveat enforcers"]
  identity --> identityContracts["AgentNameRegistry, AgentAccountResolver"]
  relationships --> relationshipContracts["Relationship registries, trust and assertions"]
  ontology --> ontologyContracts["OntologyTermRegistry, AttributeStorage, ShapeRegistry"]
  funding --> fundingContracts["PoolRegistry, FundRegistry, ProposalRegistry"]
  commitments --> commitmentContracts["VoteRegistry, PledgeRegistry, CommitmentRegistry, MatchInitiationRegistry"]
```

The exact deployed set is controlled by the Foundry deploy scripts and local env output.

Key paths:

- `packages/contracts`
- `packages/contracts/script/Deploy.s.sol`
- `scripts/deploy-local.sh`
- `apps/web/.env`
- `apps/web/src/lib/contracts.ts`
- `packages/sdk/src`

## Web On-Chain Access

The web app uses `viem` and SDK ABIs for direct reads/writes where functionality has not yet moved behind MCP tools.

```mermaid
flowchart LR
  page["Page or server action"]
  contractsTs["apps/web/src/lib/contracts.ts"]
  sdk["packages/sdk"]
  rpc["RPC_URL"]
  anvil["Anvil or network"]
  registry["Contract registry"]

  page --> contractsTs --> sdk --> rpc --> anvil --> registry
```

Representative web paths:

- `apps/web/src/lib/contracts.ts`
- `apps/web/src/lib/clients/a2a-url-resolver.ts`
- `apps/web/src/app/api/graph/route.ts`
- `apps/web/src/app/api/system-readiness/route.ts`
- `apps/web/src/lib/actions/passkey/register.action.ts`
- `apps/web/src/lib/actions/commitments.action.ts`
- `apps/web/src/lib/actions/proposalVotes.action.ts`

## MCP On-Chain Access

Some domain tools execute chain reads/writes from MCP services, especially org and hub tools.

```mermaid
sequenceDiagram
  participant Web as apps/web
  participant A2A as a2a-agent
  participant Org as org-mcp
  participant Chain as Anvil contracts

  Web->>A2A: callMcp('org', tool)
  A2A->>Org: Authorized MCP tool call
  Org->>Chain: viem read/write contract
  Chain-->>Org: tx hash or read result
  Org-->>A2A: Tool result
  A2A-->>Web: JSON
```

Key paths:

- `apps/org-mcp/src/tools`
- `apps/org-mcp/src/config.ts`
- `apps/hub-mcp/src/tools`
- `apps/hub-mcp/src/config.ts`

## Deployment And Address Propagation

```mermaid
sequenceDiagram
  participant Dev as Developer
  participant Anvil as Anvil
  participant Forge as forge script
  participant Env as apps/web/.env
  participant Services as Web and MCPs

  Dev->>Anvil: Start local RPC
  Dev->>Forge: Run deploy-local.sh
  Forge->>Anvil: Broadcast deployments
  Anvil-->>Forge: Contract addresses
  Forge->>Env: Write *_ADDRESS variables
  Services->>Env: Read address config
  Services->>Anvil: Use deployed contracts
```

## Source Of Truth Rule

On-chain state is the source of truth for:

- agent accounts and ownership
- delegation revocation and caveat enforcement
- registries for names, relationships, ontology terms, pools, rounds, proposals, votes, pledges, and commitments
- public attributes intended for GraphDB mirroring

Off-chain services may cache, index, or store private data, but should not become the source of truth for public on-chain facts.

## Current Migration Direction

New user-initiated person/org chain writes should increasingly flow through:

```mermaid
flowchart LR
  web["Web action"]
  a2a["A2A"]
  mcp["Person or org MCP"]
  chain["On-chain registry"]
  graph["Hub-MCP GraphDB sync"]

  web --> a2a --> mcp --> chain --> graph
```

Direct web-to-chain operations can remain for read-only, bootstrap, demo, health, or explicitly accepted exceptions.
