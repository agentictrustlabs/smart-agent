# 12 - Private MCP Data Domain Ontology

## Scope

This domain covers owner-routed private records stored in `person-mcp`,
`org-mcp`, and future MCPs. These classes are shared T-Box concepts, but their
A-Box rows stay private unless projected through an on-chain assertion.

Primary sources:

- `apps/person-mcp/src/db/schema.ts`
- `apps/org-mcp/src/db/schema.ts`
- `docs/information-architecture/06-data-ontology.md`
- [06-common-private-mcp-ontology.md](06-common-private-mcp-ontology.md)

## T-Box Inheritance

```mermaid
flowchart TD
    ProvEntity["prov:Entity"]
    ProvActivity["prov:Activity"]
    ProvPlan["prov:Plan"]
    PPlan["p-plan:Plan"]
    Agent["[KB] sa:Agent"]

    LocalRecord["[MCP] sap:LocalRecord"]
    OwnerRouted["[MCP] sap:OwnerRoutedRecord"]
    PrivateEntity["[MCP] sap:PrivateEntity"]
    PrivateActivity["[MCP] sap:PrivateActivity"]
    PublicProjection["[KB] sap:PublicProjection"]
    Visibility["[MCP] sap:VisibilityTier"]

    PersonProfile["[MCP] sa:PersonProfile"]
    OrgProfile["[MCP] sa:OrgProfile"]
    Preferences["[MCP] sa:UserPreferences"]
    Oikos["[MCP] sa:OikosContact"]
    Prayer["[MCP] sa:Prayer"]
    Training["[MCP] sa:TrainingProgress"]
    Notification["[MCP] sa:Notification"]
    Belief["[MCP] saint:Belief / atl:Belief"]
    CoachingNote["[MCP] sa:CoachingNote"]
    Revenue["[MCP] sa:RevenueReport"]
    Proposal["[MCP/KB] sa:Proposal"]
    ActivityLog["[MCP] sa:ActivityLogEntry"]
    Orchestration["[MCP] saint:OrchestrationPlan"]

    LocalRecord --> ProvEntity
    OwnerRouted --> LocalRecord
    PrivateEntity --> LocalRecord
    PrivateActivity --> ProvActivity
    PublicProjection --> ProvEntity
    Visibility --> ProvEntity

    PersonProfile --> PrivateEntity
    OrgProfile --> PrivateEntity
    Preferences --> PrivateEntity
    Oikos --> PrivateEntity
    Prayer --> PrivateEntity
    Training --> PrivateEntity
    Notification --> PrivateEntity
    Belief --> PrivateEntity
    CoachingNote --> PrivateEntity
    Revenue --> PrivateEntity
    Proposal --> ProvPlan
    ActivityLog --> PrivateActivity
    Orchestration --> PPlan
    PrivateEntity --> Agent
```

## Relationship Diagram

```mermaid
flowchart LR
    Owner["[KB] sa:Agent owner"]
    Record["[MCP] sap:OwnerRoutedRecord"]
    Store["[MCP] sap:Store"]
    Visibility["[MCP] sap:VisibilityTier"]
    Projection["[KB] sap:PublicProjection"]
    Assertion["[KB] sar:Assertion / on-chain assertion"]
    GraphDB["GraphDB"]
    Delegation["[MCP] sad:CrossDelegation"]
    Grantee["[KB] sa:Agent grantee"]

    Owner -->|"sap:ownedByAgent"| Record
    Record -->|"sap:storedIn"| Store
    Record -->|"sap:visibilityTier"| Visibility
    Record -->|"sap:mayPublishAs"| Projection
    Projection -->|"materialized as"| Assertion
    Assertion --> GraphDB
    Owner -->|"sad:grantsAccess"| Delegation
    Delegation -->|"sad:delegate"| Grantee
    Delegation -->|"scoped read of"| Record
```

## Person MCP Domain Diagram

```mermaid
flowchart TD
    Person["[KB] sa:PersonAgent"]
    Profile["[MCP] sa:PersonProfile"]
    Preferences["[MCP] sa:UserPreferences"]
    Oikos["[MCP] sa:OikosContact"]
    Prayer["[MCP] sa:Prayer"]
    Training["[MCP] sa:TrainingProgress"]
    Intent["[MCP/KB] saint:Intent"]
    Need["[MCP/KB] saint:RecipientIntent / saneed:NeedOccurrence"]
    Offering["[MCP/KB] saint:ProviderIntent / saoffer:ResourceOffering"]
    Activity["[MCP] sa:ActivityLogEntry"]
    WorkItem["[MCP] sah:WorkItem"]
    HolderState["[MCP] sa:EngagementHolderState"]

    Person --> Profile
    Person --> Preferences
    Person --> Oikos
    Oikos --> Prayer
    Person --> Training
    Person --> Intent
    Intent --> Need
    Intent --> Offering
    Activity -->|"fulfills"| Intent
    Activity -->|"resolves"| WorkItem
    HolderState -->|"lastActivity"| Activity
```

## Org MCP Domain Diagram

```mermaid
flowchart TD
    Org["[KB] sa:OrganizationAgent"]
    Profile["[MCP] sa:OrgProfile"]
    Member["[MCP] sa:OrgMember"]
    Detached["[MCP] sa:DetachedMember"]
    Revenue["[MCP] sa:RevenueReport"]
    Proposal["[MCP/KB] sa:Proposal"]
    Intent["[MCP/KB] saint:Intent"]
    Plan["[MCP] saint:OrchestrationPlan"]
    WorkItem["[MCP] sah:WorkItem"]
    ProviderState["[MCP] sa:EngagementProviderState"]
    Session["[MCP] sa:EngagementSession"]
    Tranche["[MCP] sa:EngagementTranche"]
    Policy["[MCP] sa:EngagementPolicy"]
    Signer["[MCP] sa:PolicySigner"]

    Org --> Profile
    Org --> Member
    Org --> Detached
    Org --> Revenue
    Org --> Proposal
    Org --> Intent
    Intent --> Plan
    Org --> WorkItem
    ProviderState --> Session
    ProviderState --> Tranche
    ProviderState --> Policy
    Policy --> Signer
```

## Description

The private MCP ontology is intentionally generic. "Prayer", "oikos", or
"revenue report" can remain private domain data while still mapping to common
upper ontology classes:

- durable private objects are `sap:PrivateEntity`.
- private actions are `sap:PrivateActivity`.
- scoped access is `sad:CrossDelegation`.
- public discovery happens through `sap:PublicProjection` and on-chain
  assertion, not direct GraphDB writes.
