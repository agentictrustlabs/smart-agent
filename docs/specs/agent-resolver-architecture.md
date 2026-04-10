# Agent Resolver Layer — Architecture Plan

## Problem Statement

Agent metadata (name, type, description, endpoints, capabilities) currently lives in the web app's SQLite database — not on-chain. This means:
- Agent identity is fragmented: the address is on-chain, but "who is this agent?" requires the app's DB
- No composable way for other contracts or protocols to discover agent properties
- No semantic standard for what properties an agent has
- The DB is the single point of failure for agent discovery

## Design Goals

1. **Move agent metadata on-chain** — name, type, description, endpoints, capabilities stored in a resolver contract
2. **ENS-style separation** — registry (who controls it) vs resolver (what properties does it have)
3. **RDFS-compatible predicates** — property keys are keccak256 of ontology-aligned CURIEs
4. **SHACL validation off-chain** — shapes validate the JSON-LD document, not Solidity directly
5. **JSON-LD on IPFS** — canonical metadata document pinned to IPFS, hash stored on-chain
6. **Governed ontology** — predicate registry controls which terms are valid
7. **Backward compatible** — existing contracts (relationships, reviews, etc.) continue working unchanged

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Client / Web App                                │
│                                                                         │
│  AgentUniversalResolver  ← single read façade for all agent data        │
│    resolveAgent(address) → {                                            │
│      core properties (from AgentAccountResolver)                        │
│      relationships (from AgentRelationship — existing)                  │
│      assertions (from AgentAssertion — existing)                        │
│      reviews (from AgentReviewRecord — existing)                        │
│      validations (from AgentValidationProfile — existing)               │
│      disputes (from AgentDisputeRecord — existing)                      │
│      trust scores (from AgentTrustProfile — existing)                   │
│      governance (from AgentControl — existing)                          │
│      metadataURI → JSON-LD on IPFS                                     │
│    }                                                                    │
└─────────────────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐
│ NEW CONTRACTS    │  │ EXISTING (as-is)│  │ OFF-CHAIN                   │
│                  │  │                 │  │                             │
│ AgentAccount-    │  │ AgentRelation-  │  │ ontology/core.ttl (RDFS)    │
│   Resolver       │  │   ship          │  │ ontology/shapes.ttl (SHACL) │
│                  │  │ AgentAssertion  │  │ ontology/context.jsonld     │
│ OntologyTerm-    │  │ AgentReview-    │  │ per-agent metadata.jsonld   │
│   Registry       │  │   Record        │  │   → pinned to IPFS          │
│                  │  │ AgentValidation │  │                             │
│ AgentPredicates  │  │   Profile       │  │                             │
│   (library)      │  │ AgentDispute-   │  │                             │
│                  │  │   Record        │  │                             │
│                  │  │ AgentTrust-     │  │                             │
│                  │  │   Profile       │  │                             │
│                  │  │ AgentControl    │  │                             │
│                  │  │ DelegationMgr   │  │                             │
└─────────────────┘  └─────────────────┘  └─────────────────────────────┘
```

## Contract Design

### 1. AgentPredicates (Library)

Well-known predicate constants — keccak256 of ontology-aligned CURIEs. These are the "column names" of the agent property store.

```solidity
library AgentPredicates {
    // ─── Core identity ──────────────────────────────────────
    bytes32 constant RDF_TYPE = keccak256("rdf:type");
    bytes32 constant ATL_DISPLAY_NAME = keccak256("atl:displayName");
    bytes32 constant ATL_DESCRIPTION = keccak256("atl:description");
    bytes32 constant ATL_AGENT_CLASS = keccak256("atl:agentClass");
    bytes32 constant ATL_IS_ACTIVE = keccak256("atl:isActive");
    bytes32 constant ATL_VERSION = keccak256("atl:version");

    // ─── Agent classification ───────────────────────────────
    bytes32 constant ATL_AGENT_TYPE = keccak256("atl:agentType");
    //   values: "atl:PersonAgent", "atl:OrganizationAgent", "atl:AIAgent"
    bytes32 constant ATL_AI_AGENT_CLASS = keccak256("atl:aiAgentClass");
    //   values: "atl:DiscoveryAgent", "atl:ValidatorAgent", etc.

    // ─── Service endpoints ──────────────────────────────────
    bytes32 constant ATL_A2A_ENDPOINT = keccak256("atl:hasA2AEndpoint");
    bytes32 constant ATL_MCP_SERVER = keccak256("atl:hasMCPServer");
    bytes32 constant ATL_SERVICE_ENDPOINT = keccak256("atl:hasServiceEndpoint");

    // ─── Trust & capabilities ───────────────────────────────
    bytes32 constant ATL_SUPPORTED_TRUST = keccak256("atl:supportedTrustModel");
    bytes32 constant ATL_CAPABILITY = keccak256("atl:hasCapability");

    // ─── Relationships ──────────────────────────────────────
    bytes32 constant ATL_CONTROLLER = keccak256("atl:hasController");
    bytes32 constant ATL_OPERATED_BY = keccak256("atl:operatedBy");

    // ─── Metadata ───────────────────────────────────────────
    bytes32 constant ATL_METADATA_URI = keccak256("atl:metadataURI");
    bytes32 constant ATL_METADATA_HASH = keccak256("atl:metadataHash");
    bytes32 constant ATL_SCHEMA_URI = keccak256("atl:schemaURI");

    // ─── ERC-4337 technical ─────────────────────────────────
    bytes32 constant ATL_ENTRY_POINT = keccak256("atl:entryPoint");
    bytes32 constant ATL_IMPLEMENTATION = keccak256("atl:implementation");
    bytes32 constant ATL_DELEGATION_MANAGER = keccak256("atl:delegationManager");
}
```

### 2. OntologyTermRegistry

Governance contract that controls which predicates are valid. Only registered terms can be used in the resolver.

```solidity
contract OntologyTermRegistry {
    struct Term {
        bytes32 id;           // keccak256("atl:displayName")
        string curie;         // "atl:displayName"
        string uri;           // "https://agentictrust.io/ontology/core#displayName"
        string label;         // "Display Name"
        string datatype;      // "string", "address", "bool", "uint256", "string[]", "address[]"
        bool active;
    }

    mapping(bytes32 => Term) terms;
    bytes32[] termIds;
    address public governor;   // who can add/modify terms

    function registerTerm(...) external onlyGovernor;
    function deactivateTerm(bytes32 id) external onlyGovernor;
    function getTerm(bytes32 id) external view returns (Term memory);
    function isRegistered(bytes32 id) external view returns (bool);
    function getAllTerms() external view returns (bytes32[] memory);
}
```

### 3. AgentAccountResolver

The core metadata contract. Stores intrinsic, descriptive properties for each agent. Only the agent's owner (checked via AgentRootAccount.isOwner) can set properties.

```solidity
contract AgentAccountResolver {
    OntologyTermRegistry public immutable ONTOLOGY;

    // ─── Core record (gas-optimized for common reads) ───────
    struct CoreRecord {
        string displayName;
        string description;
        bytes32 agentType;      // keccak256("atl:PersonAgent") etc.
        string metadataURI;     // IPFS URI to full JSON-LD
        bytes32 metadataHash;   // keccak256 of the metadata document
        string schemaURI;       // URI to the SHACL shape
        bool active;
        uint256 registeredAt;
        uint256 updatedAt;
    }

    mapping(address => CoreRecord) public core;

    // ─── Generic predicate store ────────────────────────────
    mapping(address => mapping(bytes32 => string)) stringProps;
    mapping(address => mapping(bytes32 => address)) addressProps;
    mapping(address => mapping(bytes32 => bool)) boolProps;
    mapping(address => mapping(bytes32 => uint256)) uintProps;
    mapping(address => mapping(bytes32 => string[])) multiStringProps;
    mapping(address => mapping(bytes32 => address[])) multiAddressProps;

    // ─── Authorization ──────────────────────────────────────
    // Checks AgentRootAccount.isOwner(msg.sender) on the target agent
    modifier onlyAgentOwner(address agent) { ... }

    // ─── Core property setters ──────────────────────────────
    function register(address agent, string name, string description,
                      bytes32 agentType, string metadataURI, bytes32 metadataHash,
                      string schemaURI) external onlyAgentOwner(agent);

    function setActive(address agent, bool active) external onlyAgentOwner(agent);
    function setMetadataURI(address agent, string uri, bytes32 hash) external onlyAgentOwner(agent);

    // ─── Generic property setters (governed predicates) ─────
    function setStringProperty(address agent, bytes32 predicate, string value) external;
    function setAddressProperty(address agent, bytes32 predicate, address value) external;
    function setBoolProperty(address agent, bytes32 predicate, bool value) external;
    function setUintProperty(address agent, bytes32 predicate, uint256 value) external;
    function addMultiStringProperty(address agent, bytes32 predicate, string value) external;
    function removeMultiStringProperty(address agent, bytes32 predicate, uint256 index) external;
    function addMultiAddressProperty(address agent, bytes32 predicate, address value) external;

    // ─── Readers ────────────────────────────────────────────
    function getCore(address agent) external view returns (CoreRecord memory);
    function getStringProperty(address agent, bytes32 predicate) external view returns (string memory);
    function getAddressProperty(address agent, bytes32 predicate) external view returns (address);
    function getBoolProperty(address agent, bytes32 predicate) external view returns (bool);
    function getUintProperty(address agent, bytes32 predicate) external view returns (uint256);
    function getMultiStringProperty(address agent, bytes32 predicate) external view returns (string[] memory);
    function getMultiAddressProperty(address agent, bytes32 predicate) external view returns (address[] memory);
    function propertyExists(address agent, bytes32 predicate) external view returns (bool);

    function isRegistered(address agent) external view returns (bool);

    // ─── Events ─────────────────────────────────────────────
    event AgentRegistered(address indexed agent, string displayName, bytes32 agentType);
    event PropertySet(address indexed agent, bytes32 indexed predicate, string value);
    event MetadataUpdated(address indexed agent, string metadataURI, bytes32 metadataHash);
}
```

### 4. AgentUniversalResolver (Read-Only Façade)

Single entry point for clients. Aggregates data from all contracts into one view. This is what wallets, explorers, and discovery services call.

```solidity
contract AgentUniversalResolver {
    AgentAccountResolver public immutable METADATA;
    AgentRelationship public immutable RELATIONSHIPS;
    AgentReviewRecord public immutable REVIEWS;
    AgentValidationProfile public immutable VALIDATIONS;
    AgentDisputeRecord public immutable DISPUTES;
    AgentTrustProfile public immutable TRUST;
    AgentRootAccount public immutable ACCOUNT_IMPL; // for interface queries

    struct AgentProfile {
        // From AgentAccountResolver
        string displayName;
        string description;
        bytes32 agentType;
        string metadataURI;
        bool active;
        uint256 registeredAt;

        // From AgentRootAccount
        uint256 ownerCount;

        // From AgentTrustProfile
        uint256 discoveryTrustScore;
        uint256 executionTrustScore;
        uint256 runtimeTrustScore;

        // Counts from registries
        uint256 relationshipCount;
        uint256 reviewCount;
        uint256 avgReviewScore;
        uint256 validationCount;
        uint256 openDisputeCount;
    }

    function resolveAgent(address agent) external view returns (AgentProfile memory);
    function resolveAgentProperties(address agent, bytes32[] predicates) external view returns (string[] memory);
}
```

## How Existing Contracts Map to ENS-Style Hierarchy

The user asked about AgentRootRegistry, AgentSubregistry, etc. Here's how our existing contracts already map — and what's new:

| ENS Concept | Our Equivalent | Status |
|-------------|---------------|--------|
| **Registry** (who controls a name) | `AgentRootAccount` — multi-owner smart account is the registry of who controls the agent | **Exists** |
| **Subregistry** (org controls sub-agents) | `AgentRelationship` with `ORGANIZATIONAL_CONTROL` type + `operated-agent` role | **Exists** |
| **Resolver** (properties of a name) | `AgentAccountResolver` — generic predicate store | **NEW** |
| **Universal Resolver** (client façade) | `AgentUniversalResolver` — aggregates all contracts | **NEW** |
| **Relationship Registry** | `AgentRelationship` + `AgentAssertion` | **Exists** |
| **Assertion Registry** | `AgentAssertion` | **Exists** |
| **Ontology Registry** | `OntologyTermRegistry` — governed predicate definitions | **NEW** |

We don't need separate "AgentRootRegistry" and "AgentSubregistry" contracts because:
- **AgentRootAccount IS the registry** — it stores who controls the agent (owners)
- **AgentRelationship IS the subregistry** — `ORGANIZATIONAL_CONTROL` edges define org→sub-agent hierarchies
- The factory handles registration (creating the account = registering the identity)

What we're adding is the **description layer** (resolver) and the **read façade** (universal resolver).

## Off-Chain Semantic Layer

### RDFS Ontology (`ontology/core.ttl`)

Defines classes and properties in RDF Schema:

```turtle
@prefix atl: <https://agentictrust.io/ontology/core#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

# ─── Classes ─────────────────────────────────────────────
atl:AgentAccount a rdfs:Class ;
    rdfs:label "Agent Account" ;
    rdfs:comment "An ERC-4337 smart account that serves as an agent's on-chain identity" .

atl:PersonAgent a rdfs:Class ;
    rdfs:subClassOf atl:AgentAccount ;
    rdfs:label "Person Agent" .

atl:OrganizationAgent a rdfs:Class ;
    rdfs:subClassOf atl:AgentAccount ;
    rdfs:label "Organization Agent" .

atl:AIAgent a rdfs:Class ;
    rdfs:subClassOf atl:AgentAccount ;
    rdfs:label "AI Agent" .

# AI Agent subclasses
atl:DiscoveryAgent a rdfs:Class ; rdfs:subClassOf atl:AIAgent .
atl:ValidatorAgent a rdfs:Class ; rdfs:subClassOf atl:AIAgent .
atl:ExecutorAgent a rdfs:Class ; rdfs:subClassOf atl:AIAgent .
atl:AssistantAgent a rdfs:Class ; rdfs:subClassOf atl:AIAgent .
atl:OracleAgent a rdfs:Class ; rdfs:subClassOf atl:AIAgent .

# ─── Properties ──────────────────────────────────────────
atl:displayName a rdfs:Property ;
    rdfs:domain atl:AgentAccount ;
    rdfs:range xsd:string .

atl:description a rdfs:Property ;
    rdfs:domain atl:AgentAccount ;
    rdfs:range xsd:string .

atl:agentType a rdfs:Property ;
    rdfs:domain atl:AgentAccount ;
    rdfs:range rdfs:Class .

atl:isActive a rdfs:Property ;
    rdfs:domain atl:AgentAccount ;
    rdfs:range xsd:boolean .

atl:hasA2AEndpoint a rdfs:Property ;
    rdfs:domain atl:AgentAccount ;
    rdfs:range xsd:anyURI .

atl:hasMCPServer a rdfs:Property ;
    rdfs:domain atl:AgentAccount ;
    rdfs:range xsd:anyURI .

atl:supportedTrustModel a rdfs:Property ;
    rdfs:domain atl:AgentAccount ;
    rdfs:range xsd:string .

atl:hasCapability a rdfs:Property ;
    rdfs:domain atl:AgentAccount ;
    rdfs:range xsd:string .

atl:hasController a rdfs:Property ;
    rdfs:domain atl:AgentAccount ;
    rdfs:range atl:AgentAccount .

atl:operatedBy a rdfs:Property ;
    rdfs:domain atl:AIAgent ;
    rdfs:range atl:OrganizationAgent .

atl:metadataURI a rdfs:Property ;
    rdfs:domain atl:AgentAccount ;
    rdfs:range xsd:anyURI .

atl:accountAddress a rdfs:Property ;
    rdfs:domain atl:AgentAccount ;
    rdfs:range xsd:string .

atl:entryPoint a rdfs:Property ;
    rdfs:domain atl:AgentAccount ;
    rdfs:range xsd:string .
```

### SHACL Shapes (`ontology/shapes.ttl`)

Validation rules per agent class:

```turtle
@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix atl: <https://agentictrust.io/ontology/core#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

# ─── Base Agent Shape (all agents must conform) ─────────
atl:AgentAccountShape a sh:NodeShape ;
    sh:targetClass atl:AgentAccount ;
    sh:property [
        sh:path atl:accountAddress ;
        sh:minCount 1 ; sh:maxCount 1 ;
        sh:datatype xsd:string ;
    ] ;
    sh:property [
        sh:path atl:displayName ;
        sh:minCount 1 ; sh:maxCount 1 ;
        sh:datatype xsd:string ;
    ] ;
    sh:property [
        sh:path atl:isActive ;
        sh:minCount 1 ; sh:maxCount 1 ;
        sh:datatype xsd:boolean ;
    ] ;
    sh:property [
        sh:path atl:agentType ;
        sh:minCount 1 ; sh:maxCount 1 ;
    ] ;
    sh:property [
        sh:path atl:metadataURI ;
        sh:maxCount 1 ;
        sh:datatype xsd:anyURI ;
    ] .

# ─── Person Agent Shape ─────────────────────────────────
atl:PersonAgentShape a sh:NodeShape ;
    sh:targetClass atl:PersonAgent ;
    sh:node atl:AgentAccountShape ;
    sh:property [
        sh:path atl:hasController ;
        sh:minCount 1 ;
        sh:description "Person agents must have at least one controller (EOA wallet)" ;
    ] .

# ─── Organization Agent Shape ───────────────────────────
atl:OrganizationAgentShape a sh:NodeShape ;
    sh:targetClass atl:OrganizationAgent ;
    sh:node atl:AgentAccountShape ;
    sh:property [
        sh:path atl:description ;
        sh:minCount 1 ;
        sh:datatype xsd:string ;
        sh:description "Organizations must have a description" ;
    ] .

# ─── AI Agent Shape ─────────────────────────────────────
atl:AIAgentShape a sh:NodeShape ;
    sh:targetClass atl:AIAgent ;
    sh:node atl:AgentAccountShape ;
    sh:property [
        sh:path atl:aiAgentClass ;
        sh:minCount 1 ; sh:maxCount 1 ;
        sh:in ( atl:DiscoveryAgent atl:ValidatorAgent atl:ExecutorAgent
                atl:AssistantAgent atl:OracleAgent ) ;
        sh:description "AI agents must declare their class" ;
    ] ;
    sh:property [
        sh:path atl:supportedTrustModel ;
        sh:minCount 1 ;
        sh:description "AI agents must declare supported trust models" ;
    ] ;
    sh:property [
        sh:path atl:hasCapability ;
        sh:minCount 1 ;
        sh:description "AI agents must declare at least one capability" ;
    ] .
```

### JSON-LD Context (`ontology/context.jsonld`)

Maps CURIEs to full URIs for JSON-LD expansion:

```json
{
  "@context": {
    "atl": "https://agentictrust.io/ontology/core#",
    "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    "rdfs": "http://www.w3.org/2000/01/rdf-schema#",
    "xsd": "http://www.w3.org/2001/XMLSchema#",
    "dcterms": "http://purl.org/dc/terms/",
    "prov": "http://www.w3.org/ns/prov#",

    "displayName": "atl:displayName",
    "description": "atl:description",
    "agentType": { "@id": "atl:agentType", "@type": "@id" },
    "aiAgentClass": { "@id": "atl:aiAgentClass", "@type": "@id" },
    "isActive": { "@id": "atl:isActive", "@type": "xsd:boolean" },
    "accountAddress": "atl:accountAddress",
    "hasController": { "@id": "atl:hasController", "@type": "@id" },
    "operatedBy": { "@id": "atl:operatedBy", "@type": "@id" },
    "hasA2AEndpoint": { "@id": "atl:hasA2AEndpoint", "@type": "@id" },
    "hasMCPServer": { "@id": "atl:hasMCPServer", "@type": "@id" },
    "supportedTrustModel": "atl:supportedTrustModel",
    "hasCapability": "atl:hasCapability",
    "metadataURI": { "@id": "atl:metadataURI", "@type": "@id" },
    "entryPoint": "atl:entryPoint",
    "delegationManager": "atl:delegationManager"
  }
}
```

### Example Agent JSON-LD (pinned to IPFS)

```json
{
  "@context": "https://agentictrust.io/ontology/context.jsonld",
  "@id": "did:ethr:31337:0xF508...3E9",
  "@type": "atl:AIAgent",
  "displayName": "Discovery Agent",
  "description": "Autonomous trust discovery and evaluation agent",
  "agentType": "atl:AIAgent",
  "aiAgentClass": "atl:DiscoveryAgent",
  "accountAddress": "0xF508...3E9",
  "isActive": true,
  "operatedBy": "did:ethr:31337:0x9cbC...C8c6",
  "hasController": ["did:ethr:31337:0xf39F...2266"],
  "hasA2AEndpoint": "https://discovery.agentictrust.io/a2a",
  "supportedTrustModel": ["reputation", "tee-attestation"],
  "hasCapability": ["evaluate-trust", "submit-review", "discover-agents"],
  "entryPoint": "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
  "delegationManager": "0x44c4...9d64",
  "metadataURI": "ipfs://Qm..."
}
```

## Web App: Metadata Editor

### Page: `/agents/[address]/metadata`

A form where agent owners can:

1. **Set core properties** — name, description, type (auto-populated from on-chain if registered)
2. **Add service endpoints** — A2A endpoint, MCP server, custom endpoints
3. **Declare capabilities** — list of capability strings
4. **Set trust models** — which trust models this agent supports
5. **Preview JSON-LD** — live preview of the generated JSON-LD document
6. **Validate against SHACL** — check if the document conforms to the agent type's shape
7. **Publish** — pin JSON-LD to IPFS, store the CID + hash on-chain via `setMetadataURI()`

### Flow

```
User edits metadata in form
    │
    ├─ 1. On submit: call AgentAccountResolver.register() or .setStringProperty() etc.
    │      (writes core properties on-chain)
    │
    ├─ 2. Generate JSON-LD from on-chain properties + form extras
    │
    ├─ 3. Validate JSON-LD against SHACL shapes (off-chain, in browser or server)
    │
    ├─ 4. Pin JSON-LD to IPFS → get CID
    │
    └─ 5. Call AgentAccountResolver.setMetadataURI(agent, ipfs://CID, keccak256(doc))
```

## Implementation Plan — Detailed Tasks

### Phase 1: Contracts (Sprint A)

| # | Task | Description | Estimate |
|---|------|-------------|----------|
| 1 | `AgentPredicates.sol` | Library with well-known predicate constants | Small |
| 2 | `OntologyTermRegistry.sol` | Governed term registry with register/deactivate/query | Medium |
| 3 | `AgentAccountResolver.sol` | Core record + generic predicate store + authorization | Large |
| 4 | `AgentUniversalResolver.sol` | Read-only façade aggregating all contracts | Medium |
| 5 | Deploy script updates | Add new contracts to Deploy.s.sol | Small |
| 6 | Seed script updates | Register default ontology terms, register seeded agents in resolver | Medium |
| 7 | Forge tests | Test resolver CRUD, authorization, ontology governance | Medium |

### Phase 2: SDK + Ontology Files (Sprint B)

| # | Task | Description | Estimate |
|---|------|-------------|----------|
| 8 | SDK ABIs | Add AgentAccountResolver, OntologyTermRegistry, AgentUniversalResolver ABIs | Small |
| 9 | SDK predicate constants | Export predicate bytes32 values from TypeScript | Small |
| 10 | `ontology/core.ttl` | RDFS ontology file with classes + properties | Medium |
| 11 | `ontology/shapes.ttl` | SHACL shapes for Person, Org, AI agent classes | Medium |
| 12 | `ontology/context.jsonld` | JSON-LD context for CURIE expansion | Small |

### Phase 3: Web App (Sprint C)

| # | Task | Description | Estimate |
|---|------|-------------|----------|
| 13 | Server action: `register-agent-metadata.action.ts` | Call resolver.register() + set properties on-chain | Medium |
| 14 | Server action: `generate-metadata-jsonld.action.ts` | Build JSON-LD from on-chain + form data, pin to IPFS | Medium |
| 15 | Metadata editor page `/agents/[address]/metadata` | Form: name, desc, type, endpoints, capabilities, trust models | Large |
| 16 | JSON-LD preview component | Live preview of the generated document | Small |
| 17 | SHACL validation component | Validate JSON-LD against shapes (using rdf-validate-shacl or similar) | Medium |
| 18 | Update agent trust profile page | Show on-chain metadata from resolver instead of DB | Medium |
| 19 | Update dashboard | Query resolver for agent names instead of DB | Medium |
| 20 | Remove DB dependency for agent metadata | Migrate reads from DB to on-chain resolver | Large |

### Phase 4: Documentation (Sprint D)

| # | Task | Description | Estimate |
|---|------|-------------|----------|
| 21 | Resolver architecture doc | This document, expanded with final implementation details | Medium |
| 22 | DID resolution doc | How did:ethr resolves through the universal resolver | Small |
| 23 | Ontology reference | Document all classes, properties, shapes | Medium |
| 24 | Migration guide | How to move from DB-based to resolver-based agent metadata | Small |

## Migration Strategy

The migration from DB to on-chain is incremental:

1. **Phase 1**: Deploy resolver, keep DB as primary
2. **Phase 2**: When an agent owner sets metadata via the new editor, write to BOTH DB and resolver
3. **Phase 3**: Read from resolver first, fall back to DB
4. **Phase 4**: Remove DB reads, DB becomes optional cache

This means no big-bang migration — the system works during transition.

## DID Resolution

The `did:ethr:<chainId>:<address>` resolves through the universal resolver:

```
did:ethr:31337:0x9242Fef0...
    │
    ▼
AgentUniversalResolver.resolveAgent(0x9242Fef0...)
    │
    ├─ AgentAccountResolver.getCore(agent)
    │    → displayName, description, agentType, metadataURI, active
    │
    ├─ AgentRootAccount(agent).ownerCount()
    │    → number of controllers
    │
    ├─ AgentTrustProfile.checkDiscoveryTrust(agent)
    │    → trust score
    │
    └─ metadataURI → fetch JSON-LD from IPFS
         → full semantic profile
         → SHACL-validatable
```

The JSON-LD document at the metadataURI is the **DID Document equivalent** — it contains the agent's properties, endpoints, capabilities, and trust model declarations in a semantically rich, machine-readable format.
