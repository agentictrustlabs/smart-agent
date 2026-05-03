# 14 - Relationships And Trust Domain Ontology

## Scope

This domain covers relationship edges, roles, assertions, DnS trust situations,
validation profiles, reviews, disputes, and trust summaries.

Primary sources:

- `docs/ontology/tbox/relationships.ttl`
- `docs/ontology/tbox/roles.ttl`
- `docs/ontology/tbox/trust.ttl`
- `packages/contracts/src/AgentAssertion.sol`
- `packages/contracts/src/AgentValidationProfile.sol`
- `packages/contracts/src/AgentReviewRecord.sol`
- `packages/contracts/src/AgentDisputeRecord.sol`

## T-Box Inheritance

```mermaid
flowchart TD
    ProvEntity["prov:Entity"]
    ProvActivity["prov:Activity"]
    ProvPlan["prov:Plan"]
    PPlan["p-plan:Plan"]
    DulRole["dul:Role"]
    SkosConcept["skos:Concept"]

    Edge["[KB] sar:RelationshipEdge"]
    RelType["[KB] sar:RelationshipType"]
    Institutional["[KB] sar:InstitutionalRelationship"]
    Network["[KB] sar:NetworkRelationship"]
    Assurance["[KB] sar:AssuranceRelationship"]
    Capital["[KB] sar:CapitalRelationship"]
    Execution["[KB] sar:ExecutionRelationship"]
    Infrastructure["[KB] sar:InfrastructureRelationship"]
    Role["[KB] sar:Role"]
    EdgeStatus["[KB] sar:EdgeStatus"]
    SarAssertion["[KB] sar:Assertion"]

    Situation["[KB] sat:Situation"]
    SituationDesc["[KB] sat:SituationDescription"]
    SatAssertion["[KB] sat:Assertion"]
    Attested["[KB] sat:AttestedAssertion"]
    AssertionAct["[KB] sat:AssertionAct"]
    Attestation["[KB] sat:Attestation"]
    TrustSituation["[KB] sat:TrustSituation"]
    TrustAssertion["[KB] sat:TrustAssertion"]
    TrustAct["[KB] sat:TrustAssertionAct"]
    Summary["[KB] sat:AssertionSummary"]

    Validation["[KB] sa:ValidationRecord"]
    Review["[KB] sa:ReviewRecord"]
    Dispute["[KB] sa:DisputeRecord"]
    PrivateEvidence["[MCP] sap:PrivateEvidence"]

    Edge --> ProvEntity
    RelType --> DulRole
    Institutional --> RelType
    Network --> RelType
    Assurance --> RelType
    Capital --> RelType
    Execution --> RelType
    Infrastructure --> RelType
    Role --> DulRole
    EdgeStatus --> SkosConcept
    SarAssertion --> ProvActivity

    Situation --> ProvEntity
    SituationDesc --> ProvPlan
    SituationDesc --> PPlan
    SatAssertion --> ProvEntity
    Attested --> ProvEntity
    AssertionAct --> ProvActivity
    Attestation --> AssertionAct
    TrustSituation --> Situation
    TrustAssertion --> Attested
    TrustAct --> Attestation
    Summary --> ProvEntity

    Validation --> ProvEntity
    Review --> ProvEntity
    Dispute --> ProvEntity
    PrivateEvidence --> ProvEntity
```

## Relationship Edge Diagram

```mermaid
flowchart LR
    Subject["[KB] sa:Agent subject"]
    Edge["[KB] sar:RelationshipEdge"]
    Object["[KB] sa:Agent object"]
    RelType["[KB] sar:RelationshipType"]
    Role["[KB] sar:Role"]
    Status["[KB] sar:EdgeStatus"]
    Assertion["[KB] sar:Assertion / AgentAssertion"]

    Subject -->|"sar:subject"| Edge
    Edge -->|"sar:object"| Object
    Edge -->|"sar:relationshipType"| RelType
    Edge -->|"sar:hasRole"| Role
    Edge -->|"sar:edgeStatus"| Status
    Assertion -->|"sar:assertsEdge"| Edge
```

## DnS Trust Diagram

```mermaid
flowchart TD
    Situation["[KB] sat:Situation"]
    Description["[KB] sat:SituationDescription"]
    Role["[KB] sat:Role"]
    Participation["[KB] sat:SituationParticipation"]
    Assertion["[KB] sat:Assertion"]
    Act["[KB] sat:AssertionAct"]
    Attested["[KB] sat:AttestedAssertion"]
    Agent["[KB] sa:Agent"]

    Situation -->|"sat:hasSituationDescription"| Description
    Situation -->|"sat:hasRole"| Role
    Participation -->|"participates in"| Situation
    Participation -->|"qualified by"| Role
    Role -->|"sat:rolePlayer"| Agent
    Act -->|"sat:assertsSituation"| Situation
    Act -->|"prov:used"| Assertion
    Act -->|"sat:generatedAssertionRecord"| Attested
    Act -->|"sat:assertedBy"| Agent
```

## Validation And Feedback Diagram

```mermaid
flowchart LR
    Artifact["[KB] Edge / SkillClaim / GeoClaim / CredentialReceipt"]
    Assertion["[KB] AgentAssertion"]
    Validation["[KB] AgentValidationProfile record"]
    Review["[KB] AgentReviewRecord"]
    Dispute["[KB] AgentDisputeRecord"]
    Evidence["[MCP] private evidence bundle"]
    Commit["[KB] evidenceCommit"]
    TrustIndex["[KB] sa:AgentTrustIndex / sat:AssertionSummary"]

    Assertion -->|"asserts artifact"| Artifact
    Validation -->|"validates"| Assertion
    Review -->|"reviews subject/artifact"| Artifact
    Dispute -->|"disputes"| Artifact
    Evidence -->|"hashes to"| Commit
    Validation --> Commit
    Review --> TrustIndex
    Validation --> TrustIndex
    Dispute --> TrustIndex
```

## Public And Private Mapping

| Artifact | Public class | Private/MCP companion |
| --- | --- | --- |
| Relationship membership | `sar:RelationshipEdge` | `org_members`, private org notes |
| Coaching relationship | `sar:RelationshipEdge` | `coaching_notes`, cross-delegation grants |
| Validation | `AgentValidationProfile`, `sat:VerificationTrustAssertion` | private evidence bundle |
| Review | `AgentReviewRecord`, `sat:ReputationTrustAssertion` | encrypted/private comments if needed |
| Dispute | `AgentDisputeRecord` | confidential investigation notes |
| Trust summary | `sat:AssertionSummary`, `sa:AgentTrustIndex` | none; computed from public facts |

## Description

Use relationship edges for directed public graph facts. Use DnS trust classes
when the system needs explicit context, provenance, and trust interpretation.
Private evidence and notes stay in MCPs; public records carry commitments,
scores, status, and provenance links.
