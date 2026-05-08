# 14 - Pool Creation and Access Architecture

## Purpose

This document shows the object interactions between the web app, A2A agent,
org-mcp, on-chain `PoolRegistry`, and GraphDB when a pool is created and later
accessed.

The key rule:

```text
Pool body lives on-chain in PoolRegistry.
GraphDB mirrors on-chain public pool facts.
MCPs hold private pledge/access state, not the pool body.
The web app reads public pool data through Discovery/GraphDB.
```

## Component Picture

```mermaid
flowchart LR
    User["User / Steward"]
    Web["Web App<br/>Next.js server actions"]
    A2A["A2A Agent<br/>session + MCP proxy"]
    OrgMcp["org-mcp<br/>org pledges, counters, private grants"]
    PersonMcp["person-mcp<br/>person pledges, private grants"]
    Chain["On-chain"]
    Factory["AgentAccountFactory"]
    PoolAccount["Pool AgentAccount<br/>treasury / identity"]
    PoolRegistry["PoolRegistry<br/>typed pool attributes"]
    Ontology["OntologyTermRegistry"]
    Shapes["ShapeRegistry"]
    GraphSync["GraphDB Sync<br/>on-chain -> RDF"]
    GraphDB["GraphDB<br/>public pool read model"]
    Discovery["Discovery Service<br/>SPARQL + visibility gate"]

    User --> Web
    Web --> A2A
    A2A --> OrgMcp
    A2A --> PersonMcp

    Web --> Factory
    Factory --> PoolAccount
    Web --> PoolRegistry
    PoolRegistry --> Ontology
    PoolRegistry --> Shapes

    PoolRegistry --> GraphSync
    PoolAccount --> GraphSync
    GraphSync --> GraphDB
    Web --> Discovery
    Discovery --> GraphDB
```

## Object Responsibilities

| Object | Responsibility |
| --- | --- |
| Web app | Orchestrates user actions, calls chain, calls A2A/MCP, renders pool pages |
| A2A agent | Converts web session grants into MCP calls and routes to the right MCP |
| org-mcp | Stores org-owned pledge rows, cross-delegation grants, and derived pool counters for org donors |
| person-mcp | Stores person-owned pledge rows, cross-delegation grants, and private donor state |
| `AgentAccountFactory` | Deploys deterministic pool smart accounts |
| Pool `AgentAccount` | Pool treasury/identity account; owner set controls pool authority |
| `PoolRegistry` | On-chain source of truth for pool body attributes |
| `OntologyTermRegistry` | Ensures pool predicates are registered ontology terms |
| `ShapeRegistry` | Enforces required pool fields, datatypes, and enum values |
| GraphDB sync | Reads on-chain pool attributes and emits RDF |
| GraphDB | Public mirror for pool discovery and detail reads |
| Discovery service | Queries GraphDB and applies viewer-side visibility/ranking logic |

## Create Pool Sequence

```mermaid
sequenceDiagram
    actor Steward
    participant Web as Web App
    participant Factory as AgentAccountFactory
    participant PoolAcct as Pool AgentAccount
    participant PoolReg as PoolRegistry
    participant Ont as OntologyTermRegistry
    participant Shapes as ShapeRegistry
    participant Sync as GraphDB Sync
    participant GDB as GraphDB

    Steward->>Web: Submit pool creation form
    Web->>Web: Build canonical mandate JSON
    Web->>Web: mandateHash = keccak256(mandate JSON)
    Web->>Factory: createAccount(owner, salt = keccak256("pool:<slug>"))
    Factory-->>Web: pool treasury / AgentAccount address
    Web->>PoolReg: open(OpenParams)
    PoolReg->>Ont: validate every predicate is active
    PoolReg->>PoolReg: write typed attributes
    PoolReg->>Shapes: validateSubject(sa:Pool, poolSubject, PoolRegistry)
    Shapes-->>PoolReg: valid or revert
    PoolReg-->>Web: PoolOpened event + tx hash
    Web->>Sync: scheduleKbSyncEager()
    Sync->>PoolReg: read allSubjects + pool getters
    Sync->>PoolAcct: read public agent metadata if available
    Sync->>GDB: upsert sa:Pool triples
    Web-->>Steward: Return pool IRI + treasury address
```

### Create-Time Data

| Field | Source | Stored in |
| --- | --- | --- |
| Pool slug | web form | `PoolRegistry` as `sa:poolSlug` |
| Pool agent address | `AgentAccountFactory` | chain |
| Domain | web form | `PoolRegistry` |
| Governance model | web form, normalized by SDK | `PoolRegistry` |
| Mandate hash | web action | `PoolRegistry` |
| Accepted units/kinds | web form | `PoolRegistry` |
| Ceiling policy/capacity | web form | `PoolRegistry` |
| Stewards | web form | `PoolRegistry` |
| Visibility | web form | `PoolRegistry` |
| Addressed members for private pools | private/access layer | MCP-side access data, not public GraphDB |

## On-Chain Pool Object

```mermaid
classDiagram
    class PoolAgentAccount {
      address poolAgent
      owner set
      delegationManager
      treasury identity
    }

    class PoolRegistry {
      open(OpenParams)
      close(poolAgent)
      updateMandate(poolAgent, hash, uri)
      rotateStewards(poolAgent, stewards)
      setAcceptedRestrictions(poolAgent, json)
    }

    class AttributeStorage {
      subject = bytes32(poolAgent)
      typed attributes
      predicatesOf(subject)
      subjectVersion(subject)
    }

    class OntologyTermRegistry {
      active predicate ids
      datatype metadata
    }

    class ShapeRegistry {
      sa:Pool shape
      required fields
      enum sets
      datatype checks
    }

    PoolAgentAccount "1" --> "1" PoolRegistry : pool subject
    PoolRegistry --|> AttributeStorage
    AttributeStorage --> OntologyTermRegistry : predicate validation
    PoolRegistry --> ShapeRegistry : class validation
```

## Public Pool Access Sequence

```mermaid
sequenceDiagram
    actor Viewer
    participant Web as Web App
    participant Discovery as Discovery Service
    participant GDB as GraphDB
    participant PoolReg as PoolRegistry
    participant Sync as GraphDB Sync

    Note over PoolReg,Sync: After creation/update, sync mirrors PoolRegistry into GraphDB
    Sync->>PoolReg: read pool attributes
    Sync->>GDB: write sa:Pool RDF triples

    Viewer->>Web: Open pools index or detail page
    Web->>Discovery: listPools() or getPoolDetail()
    Discovery->>GDB: SPARQL query for sa:Pool
    GDB-->>Discovery: pool rows
    Discovery->>Discovery: collapse multi-valued fields
    Discovery->>Discovery: apply visibility gate
    Discovery-->>Web: pool DTO
    Web-->>Viewer: Render pool cards/detail
```

## Private Pool / Addressed Access Sequence

Private pool access needs public coarse data plus a private authorization check.
GraphDB must not expose the full addressed-member list as a public fact.

```mermaid
sequenceDiagram
    actor Viewer
    participant Web as Web App
    participant Discovery as Discovery Service
    participant GDB as GraphDB
    participant A2A as A2A Agent
    participant OrgMcp as org-mcp

    Viewer->>Web: Request private pool detail
    Web->>Discovery: getPoolDetail(poolId, viewerAgentId)
    Discovery->>GDB: Query public/coarse pool mirror
    GDB-->>Discovery: private pool coarse anchor
    Discovery-->>Web: pool is private / needs addressed check
    Web->>A2A: mcp/org private access check
    A2A->>OrgMcp: verify viewer is addressed or delegated
    OrgMcp-->>A2A: allowed or denied
    A2A-->>Web: access decision
    alt allowed
        Web-->>Viewer: Render private pool detail
    else denied
        Web-->>Viewer: Hide pool / return not found
    end
```

## Pledge / Counter Access

Pool body data is on-chain. Pledge data is donor-owned MCP data.

```mermaid
flowchart TD
    Donor["Donor"]
    Web["Web App"]
    Discovery["Discovery Service"]
    GraphDB["GraphDB public pool body"]
    A2A["A2A Agent"]
    DonorMcp["person-mcp or org-mcp<br/>pool_pledges"]
    Steward["Pool Steward"]
    StewardMcp["org-mcp<br/>steward access"]

    Donor --> Web
    Web --> Discovery
    Discovery --> GraphDB
    Web -->|"pre-validate pool body"| Discovery
    Web -->|"submit pledge"| A2A
    A2A --> DonorMcp
    DonorMcp -->|"store pledge row"| DonorMcp
    DonorMcp -->|"non-anonymous: create read grant"| DonorMcp

    Steward --> Web
    Web --> A2A
    A2A --> StewardMcp
    StewardMcp -->|"read granted pledge views"| DonorMcp
```

Counter rule:

```text
pledgedTotal, allocatedTotal, availableTotal are derived from pool_pledges.
They are not the pool body source of truth.
Public aggregate assertions may be published later as coarse on-chain facts.
```

## Read Model Shape in GraphDB

GraphDB should contain only public mirror triples derived from on-chain data:

```text
<urn:smart-agent:pool:demo-trauma-care-pool> a sa:Pool ;
  sa:displayName "Trauma Care Pool" ;
  sa:treasuryAgent <https://agentictrust.io/ontology/sa#agent/0x...> ;
  sa:domain "faith-network" ;
  sa:governanceModel "giving-circle" ;
  sa:acceptedKind "trauma-care" ;
  sa:acceptsUnit "USD" ;
  sa:capacityCeiling 50000 ;
  sa:ceilingPolicy "block" ;
  sa:visibility "public" ;
  sa:steward <https://agentictrust.io/ontology/sa#agent/0x...> .
```

GraphDB should not contain:

```text
private addressed-member lists
private donor identity for anonymous pledges
private pledge body
private steward notes
internal allocation notes
org financial contacts
```

## Access Paths

| User action | Primary path | Source of truth |
| --- | --- | --- |
| Create pool | Web app -> `AgentAccountFactory` -> `PoolRegistry` | chain |
| Browse public pools | Web app -> Discovery -> GraphDB | GraphDB mirror of chain |
| View public pool detail | Web app -> Discovery -> GraphDB | GraphDB mirror of chain |
| View private pool | Web app -> Discovery + A2A -> org-mcp access check | chain for body, MCP for access |
| Submit pledge | Web app -> A2A -> donor MCP | donor MCP |
| Read my pledges | Web app -> A2A -> donor MCP | donor MCP |
| Steward reads pledge | Web app -> A2A -> MCP with cross-delegation | donor MCP |
| Sync pool to graph | GraphDB sync -> `PoolRegistry` -> GraphDB | chain |

## Implementation Anchors

| Area | File |
| --- | --- |
| Pool creation action | `apps/web/src/lib/actions/poolCreate.action.ts` |
| Pool page reads | `apps/web/src/lib/actions/pools.action.ts` |
| GraphDB pool emission | `apps/web/src/lib/ontology/graphdb-sync.ts` |
| Pool SPARQL builders | `packages/discovery/src/queries/pools.ts` |
| Pool discovery service | `packages/discovery/src/discovery-service.ts` |
| Pool registry contract | `packages/contracts/src/PoolRegistry.sol` |
| Typed attribute storage | `packages/contracts/src/AttributeStorage.sol` |
| Shape validation | `packages/contracts/src/ShapeRegistry.sol` |
| Person pledge storage | `apps/person-mcp/src/tools/poolPledges.ts` |
| Org pledge storage | `apps/org-mcp/src/tools/poolPledges.ts` |
| A2A MCP proxy | `apps/a2a-agent/src/routes/mcp-proxy.ts` |

## Design Invariants

- `PoolRegistry` is the canonical pool body store.
- `org-mcp` and `person-mcp` store pledge rows and private access state, not canonical pool body.
- GraphDB is a read model, never a write authority.
- A2A is the session/delegation bridge from web to MCPs.
- Private pool access requires an MCP-side access check.
- Anonymous pledge identity must not be published on-chain or into GraphDB.
- Pool creation should be delegated through scoped authority when performed by an operator or service agent.
