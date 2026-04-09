# Relationship Protocol — Agent Trust Graph

## Overview

The relationship protocol models trust between agents using four composable contracts. It follows DOLCE+DnS ontology: relationships are Situations, relationship types are Descriptions, roles are the parts agents play.

## Protocol Suite

```mermaid
graph TB
    subgraph "Edge Layer"
        AR[AgentRelationship<br/>Canonical edges<br/>Multi-role sets]
    end
    subgraph "Provenance Layer"
        AA[AgentAssertion<br/>Who claims this?<br/>Validity, revocation]
    end
    subgraph "Description Layer"
        ART[AgentRelationshipTemplate<br/>Role → delegation mapping<br/>Required caveats]
    end
    subgraph "Policy Layer"
        ARR[AgentRelationshipResolver<br/>When does it count?<br/>Resolution modes]
    end

    AR --> AA
    AR --> ART
    AR --> ARR
    AA --> ARR
```

## Relationship Edge

One edge per (subject, object, relationshipType) triple. Multiple roles on each edge.

```mermaid
classDiagram
    class Edge {
        bytes32 edgeId
        address subject
        address object_
        bytes32 relationshipType
        EdgeStatus status
        address createdBy
        uint256 createdAt
        string metadataURI
    }

    class EdgeStatus {
        NONE
        PROPOSED
        CONFIRMED
        ACTIVE
        SUSPENDED
        REVOKED
        REJECTED
    }

    Edge --> EdgeStatus
```

### Edge Lifecycle

```mermaid
stateDiagram-v2
    [*] --> PROPOSED : createEdge()
    PROPOSED --> CONFIRMED : counterparty confirms
    PROPOSED --> REJECTED : counterparty rejects
    CONFIRMED --> ACTIVE : resolver qualifies
    ACTIVE --> SUSPENDED : either party
    ACTIVE --> REVOKED : either party
    SUSPENDED --> ACTIVE : unsuspend
```

### Auto-Confirm Rule

When the same user owns both the subject and object agents, relationships are **auto-confirmed** on creation — no counterparty step needed.

## Relationship Types (12)

```mermaid
mindmap
  root((Relationship Types))
    Governance
      OrganizationGovernance
      OrganizationalControl
    Institutional
      OrganizationMembership
      Alliance
    Assurance
      ValidationTrust
      InsuranceCoverage
      Compliance
    Economic
      EconomicSecurity
    Service
      ServiceAgreement
      DelegationAuthority
    Runtime
      RuntimeAttestation
      BuildProvenance
    Feedback
      ActivityValidation
      ReviewRelationship
```

## Roles (47+)

| Category | Roles |
|----------|-------|
| **Governance** | owner, board-member, ceo, executive, treasurer, authorized-signer, officer, chair, advisor |
| **Control** | operated-agent, managed-agent, administers |
| **Membership** | admin, member, operator, employee, contractor |
| **Assurance** | auditor, validator, insurer, insured-party, underwriter, certified-by, licensed-by |
| **Economic** | staker, guarantor, backer, collateral-provider |
| **Alliance** | strategic-partner, affiliate, endorsed-by, subsidiary, parent-org |
| **Service** | vendor, service-provider, delegated-operator |
| **TEE/Runtime** | runs-in-tee, attested-by, verified-by, bound-to-kms, controls-runtime, built-from, deployed-from |
| **Validation** | activity-validator, validated-performer |
| **Review** | reviewer, reviewed-agent |

## Delegation Templates

Templates bridge roles to executable delegation patterns.

```mermaid
graph LR
    RT[Relationship Type<br/>+ Role] --> T[Template]
    T --> C1[Required Caveats]
    T --> C2[Optional Caveats]
    T --> S[Schema URI]

    C1 --> TE[TimestampEnforcer]
    C1 --> VE[ValueEnforcer]
    C2 --> ATE[AllowedTargetsEnforcer]
```

### Example: CEO Treasury Authority

```
Relationship Type: OrganizationGovernance
Role:              ceo
Template:          CEO Treasury Authority

Required Caveats:
  - TimestampEnforcer (time-bounded)
  - ValueEnforcer (spend cap)

Optional Caveats:
  - AllowedTargetsEnforcer (target contracts)

Activation:
  1. Relationship edge is ACTIVE
  2. Template exists for this role
  3. Governance policy satisfied
  → Delegation instantiated with caveats
```

## Trust Resolution

```mermaid
graph TB
    Q[holdsRole query] --> R[Resolver]
    R --> E{Edge exists?}
    E -->|No| F[false]
    E -->|Yes| S{Status ACTIVE?}
    S -->|No| F
    S -->|Yes| M{Resolution Mode}
    M -->|EDGE_ACTIVE_ONLY| T[true]
    M -->|REQUIRE_ASSERTION| A{Valid assertion?}
    A -->|Yes| T
    A -->|No| F
    M -->|REQUIRE_OBJECT| O{Object asserted?}
    O -->|Yes| T
    O -->|No| F
    M -->|REQUIRE_MUTUAL| B{Both asserted?}
    B -->|Yes| T
    B -->|No| F
```

## Example Trust Graph

```mermaid
graph TB
    Alice((Alice<br/>Person)) -->|ceo, owner| ATL[ATL<br/>Organization]
    Bob((Bob<br/>Person)) -->|board-member| ATL
    Bob -->|admin, member| ATL
    Carol((Carol<br/>Person)) -->|auditor, validator| ATL
    
    Alice -->|member, operator| DeFi[DeFi DAO<br/>Organization]
    ATL -->|strategic-partner| DeFi
    
    InsureCo[InsureCo] -->|insurer| ATL
    StakePool[StakePool] -->|guarantor| DeFi
    
    TrustVal[TrustValidator] -->|validator| Alice
    TrustVal -->|validator| ATL
    
    Discovery[Discovery<br/>AI Agent] -->|operated-agent| ATL
    ATL -->|administers| Discovery
    Discovery -->|runs-in-tee| DTEE[Discovery TEE]
    DTEE -->|attested-by| TrustVal
    
    ValA[Validator α] -->|activity-validator| Discovery
    ValB[Validator β] -->|activity-validator| Discovery
    
    Dave((Dave)) -->|reviewer| Discovery
    Eve((Eve)) -->|reviewer| Discovery
    Frank((Frank)) -->|reviewer| Discovery

    style Alice fill:#6366f1,color:#fff
    style Bob fill:#6366f1,color:#fff
    style Carol fill:#6366f1,color:#fff
    style Dave fill:#6366f1,color:#fff
    style Eve fill:#6366f1,color:#fff
    style Frank fill:#6366f1,color:#fff
    style ATL fill:#22c55e,color:#fff
    style DeFi fill:#22c55e,color:#fff
    style InsureCo fill:#8b5cf6,color:#fff
    style StakePool fill:#14b8a6,color:#fff
    style TrustVal fill:#06b6d4,color:#fff
    style Discovery fill:#f59e0b,color:#fff
    style DTEE fill:#22d3ee,color:#000
    style ValA fill:#06b6d4,color:#fff
    style ValB fill:#06b6d4,color:#fff
```

## Claim Issuers

```mermaid
graph LR
    subgraph "Issuer Types"
        V[Validator]
        I[Insurer]
        A[Auditor]
        TV[TEE Verifier]
        SP[Staking Pool]
        G[Governance]
        O[Oracle]
    end

    subgraph "Validation Methods"
        VA[validator-verified]
        II[insurer-issued]
        TO[tee-onchain-verified]
        TA[tee-offchain-aggregated]
        ZK[zk-verified]
        RB[reproducible-build]
        GA[governance-approved]
    end

    V --> VA & TO
    I --> II
    TV --> TO & TA
    SP --> VA
    G --> GA
```

## Reviews & Disputes

### Review Dimensions

| Dimension | What it measures |
|-----------|-----------------|
| accuracy | Correctness of outputs |
| reliability | Consistency over time |
| responsiveness | Speed of response |
| compliance | Adherence to policies |
| safety | Harm avoidance |
| transparency | Explainability |
| helpfulness | Usefulness of outputs |

### Dispute Types

| Type | Severity |
|------|----------|
| FLAG | Soft warning |
| DISPUTE | Formal dispute |
| SANCTION | Regulatory action |
| SUSPENSION | Temporary removal |
| REVOCATION | Permanent removal |
| BLACKLIST | Banned |

### Trust Profile

```
Trust Score = f(
  active relationship edges,
  average review score,
  open dispute count
)

Discovery Trust: edges(30) + reviews≥2(20) + avg≥60(30) + no disputes(20)
Execution Trust: edges≥2(30) + avg≥70(30) + no disputes(40)
```
