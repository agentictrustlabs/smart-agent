# 05 - GraphDB Public Projection

## Purpose

This document explains what GraphDB contains, how data gets there, and how to
write example A-Box data for public discovery use cases.

## Rule

GraphDB is a public knowledge base. It mirrors on-chain facts and uploaded
ontology files. MCPs do not write to GraphDB.

```mermaid
flowchart LR
    PersonMcp["person-mcp"]
    OrgMcp["org-mcp"]
    Chain["On-chain registries/assertions"]
    Sync["apps/web ontology sync"]
    GraphDB["GraphDB"]
    UI["Discovery UI / SPARQL"]

    PersonMcp -->|"publish assertion/commitment"| Chain
    OrgMcp -->|"publish assertion/commitment"| Chain
    Chain --> Sync
    Sync --> GraphDB
    GraphDB --> UI
```

## What Belongs In GraphDB

| Data | Include? | Reason |
| --- | --- | --- |
| Public agent records | Yes | Discovery needs identity graph |
| Public relationship edges | Yes | Trust and path queries |
| Public skill, geo, validation, review assertions | Yes | Discovery/scoring inputs |
| Static ontology schema and vocabularies | Yes | Reasoning and labels |
| Private profile details | No | Owner-routed MCP data |
| Raw AnonCreds wallet contents | No | Holder privacy |
| Private intents, prayers, notes, oikos contacts | No | Person private data |
| Private org revenue and drafts | No | Org private data |

## Sync Path

```mermaid
sequenceDiagram
    participant Contract as On-chain Contract
    participant Sync as Ontology Sync
    participant Turtle as Turtle Emitter
    participant GraphDB

    Sync->>Contract: read public agents, edges, claims
    Sync->>Turtle: emit RDF/Turtle
    Turtle->>GraphDB: replace named graph
    GraphDB-->>Sync: upload result
```

The sync code lives in `apps/web/src/lib/ontology/graphdb-sync.ts`.

## Public Discovery Use Case

Question:

```text
Maria needs a multiplier coach near Loveland who is relationally close to Catalyst.
```

GraphDB can answer this from public facts:

```mermaid
flowchart TD
    Maria["Maria"]
    Catalyst["Catalyst NoCo"]
    Kenji["Kenji"]
    Rachel["Rachel"]
    Loveland["Loveland geo claim"]
    Skill["Multiplier coaching skill"]

    Maria -->|"governs"| Catalyst
    Catalyst -->|"alliance"| Kenji
    Kenji -->|"coaches"| Rachel
    Rachel -->|"has public geo claim"| Loveland
    Rachel -->|"has skill claim"| Skill
```

## Example A-Box: Public Candidate Record

```ttl
:rachel
    a sa:PersonAgent ;
    sa:displayName "Rachel Park" ;
    sa:onChainAddress "0x2222222222222222222222222222222222222222" ;
    sa:isActive true .

:edgeKenjiRachel
    a sar:RelationshipEdge ;
    sar:subject :kenji ;
    sar:object :rachel ;
    sar:relationshipType sar:CoachingMentorship ;
    sar:hasRole sar:Coach ;
    sar:edgeStatus sar:StatusActive .

:skillClaimRachel1
    a sas:SkillClaim ;
    sas:subjectAgent :rachel ;
    sas:skill :multiplierCoaching ;
    sas:relation sas:PracticesSkill ;
    sas:proficiencyScore 5800 ;
    prov:wasAssociatedWith :rachel .

:geoClaimRachel1
    a sag:GeoClaim ;
    sag:subjectAgent :rachel ;
    sag:geoFeature :loveland ;
    sag:claimPrecision sag:MetroLevel ;
    prov:wasAssociatedWith :rachel .
```

## Example Query Shape

```sparql
SELECT ?candidate ?candidateName ?skillScore WHERE {
  ?candidate a sa:PersonAgent ;
      sa:displayName ?candidateName .

  ?skillClaim sas:subjectAgent ?candidate ;
      sas:skill :multiplierCoaching ;
      sas:proficiencyScore ?skillScore .

  ?geoClaim sag:subjectAgent ?candidate ;
      sag:geoFeature :loveland .

  ?edge sar:object ?candidate ;
      sar:relationshipType sar:CoachingMentorship .
}
ORDER BY DESC(?skillScore)
```

## Privacy Pattern

If a private fact must help discovery, publish a bounded public artifact:

| Private fact | Public artifact |
| --- | --- |
| Full location | City/metro-level geo claim or ZK proof receipt |
| Full credential | Schema/claim commitment or verified presentation receipt |
| Full intent text | Sanitized public summary |
| Private membership | Verifier-issued validation assertion |

The public graph should carry enough signal for discovery and trust without
becoming the private data store.
