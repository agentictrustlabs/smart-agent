# GraphDB and Knowledge Sync

This document describes the public knowledge layer: GraphDB, discovery reads, RDF projection, and hub-mcp sync.

## Knowledge Layer Position

GraphDB is the public query/index layer. It should mirror public facts from chain and selected public projections, not replace the chain as source of truth.

```mermaid
flowchart TB
  chain["On-chain public facts"]
  hub["hub-mcp"]
  discovery["packages/discovery"]
  graphdb["GraphDB repository"]
  web["apps/web"]
  a2a["a2a-agent"]

  chain --> hub
  hub --> graphdb
  hub --> discovery
  discovery --> graphdb
  web --> a2a
  a2a --> hub
  hub --> web
```

## Preferred Discovery Read Path

```mermaid
sequenceDiagram
  participant Page as Web page or action
  participant HubClient as hub-client
  participant A2A as a2a-agent
  participant Hub as hub-mcp
  participant Discovery as DiscoveryService
  participant GraphDB as GraphDB

  Page->>HubClient: callHub('discovery:*')
  HubClient->>A2A: system host /mcp/hub/:tool
  A2A->>Hub: Proxy hub tool
  Hub->>Discovery: Query helper
  Discovery->>GraphDB: SPARQL query
  GraphDB-->>Discovery: Result bindings
  Discovery-->>Hub: Domain result
  Hub-->>A2A: Tool result
  A2A-->>HubClient: JSON
  HubClient-->>Page: Typed result
```

Key files:

- `apps/web/src/lib/clients/hub-client.ts`
- `apps/a2a-agent/src/routes/mcp-proxy.ts`
- `apps/hub-mcp/src/tools/discovery.ts`
- `packages/discovery/src/index.ts`
- `packages/discovery/src/discovery-service.ts`

## Sync Path

GraphDB sync can be triggered by web routes or domain actions after chain writes.

```mermaid
sequenceDiagram
  participant Action as Web action or API route
  participant Shim as graphdb-sync shim
  participant A2A as a2a-agent
  participant Hub as hub-mcp
  participant Chain as Contracts
  participant GraphDB as GraphDB

  Action->>Chain: Write public fact
  Chain-->>Action: tx receipt
  Action->>Shim: hubScheduleKbSync or hubSync*
  Shim->>A2A: /mcp/hub/sync:*
  A2A->>Hub: Proxy sync tool
  Hub->>Chain: Read canonical state
  Hub->>GraphDB: SPARQL update
  GraphDB-->>Hub: Update accepted
  Hub-->>Action: Sync result
```

Key files:

- `apps/web/src/lib/ontology/graphdb-sync.ts`
- `apps/web/src/lib/ontology/kb-write-through.ts`
- `apps/web/src/app/api/ontology-sync/route.ts`
- `apps/web/src/app/api/ontology-sync/turtle/route.ts`
- `apps/hub-mcp/src/tools/sync.ts`
- `apps/hub-mcp/src/lib/graphdb-sync.ts`
- `apps/hub-mcp/src/lib/kb-write-through.ts`

## Direct GraphDB Paths

Older or transitional web code may still import `@smart-agent/discovery` or call GraphDB-facing helpers directly. These paths should be documented as migration candidates when they are user-facing request paths.

```mermaid
flowchart LR
  web["apps/web legacy direct read"]
  discovery["packages/discovery"]
  graphdb["GraphDB"]
  target["Preferred target: hub-mcp discovery tool"]

  web --> discovery --> graphdb
  web -. migrate .-> target
```

## Source Of Truth Rules

| Fact type | Source of truth | GraphDB role |
| --- | --- | --- |
| Agent addresses and ownership | Chain | Query projection |
| Names and public metadata | Chain registries | Query projection |
| Relationships and public roles | Chain | Query projection |
| Pools, rounds, proposals | Chain registries | Query projection |
| Votes and pledge public records | Chain registries | Query projection |
| Private person/org details | MCP private DBs | Do not mirror unless explicitly public |
| Derived rankings and search | Discovery service | Query/index support |

## Environment

The discovery package reads GraphDB configuration from environment:

- `GRAPHDB_BASE_URL`
- `GRAPHDB_REPOSITORY`
- `GRAPHDB_USERNAME`
- `GRAPHDB_PASSWORD`

The hub-mcp should become the main holder of GraphDB access for runtime web flows.

## Development Guidance

- Do not add new web request paths that require GraphDB credentials in the web app.
- Put public discovery reads behind hub-mcp tools.
- Schedule sync after successful chain writes.
- Do not mirror private MCP data into GraphDB unless there is an explicit public assertion model.
- When in doubt, store a bounded public claim on-chain and mirror that claim, not the private evidence behind it.
