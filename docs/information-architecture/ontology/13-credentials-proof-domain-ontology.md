# 13 - Credentials And Proof Domain Ontology

## Scope

This domain covers AnonCreds schemas, credential definitions, holder wallets,
credential metadata, encrypted payloads, proof requests, proof audits, and
verification receipts.

Primary sources:

- `packages/sdk/src/credential-types.ts`
- `apps/person-mcp/src/ssi/*`
- `apps/verifier-mcp/src/verifiers/specs.ts`
- `apps/family-mcp`, `apps/geo-mcp`, `apps/skill-mcp`
- [08-anoncreds-sql-ontology-mapping.md](08-anoncreds-sql-ontology-mapping.md)

## T-Box Inheritance

```mermaid
flowchart TD
    ProvEntity["prov:Entity"]
    ProvActivity["prov:Activity"]
    PrivateEntity["[MCP] sap:PrivateEntity"]
    PrivateActivity["[MCP] sap:PrivateActivity"]
    Agent["[KB] sa:Agent"]

    Schema["[KB] sac:CredentialSchema"]
    CredDef["[KB] sac:CredentialDefinition"]
    Offer["[MCP/VC] sac:CredentialOffer"]
    IssuerState["[MCP] sac:CredentialIssuerState"]
    Issuance["[MCP] sac:CredentialIssuanceActivity"]

    Wallet["[MCP] sac:HolderWallet"]
    Metadata["[MCP/VC] sac:AnonCredentialMetadata"]
    Payload["[MCP/VC] sac:AnonCredentialPayload"]
    Nonce["[MCP] sac:WalletActionNonce"]
    ProofRequest["[MCP/VC] sac:ProofRequest"]
    ProofAudit["[MCP] sac:PresentationAudit"]
    Verification["[MCP/KB] sac:PresentationVerification"]
    TrustOverlap["[MCP] sac:TrustOverlapAudit"]

    OrgCred["[VC] sac:OrgMembershipCredential"]
    GuardianCred["[VC] sac:GuardianOfMinorCredential"]
    GeoCred["[VC] sac:GeoLocationCredential"]
    SkillCred["[VC] sac:SkillsCredential"]

    Schema --> ProvEntity
    CredDef --> ProvEntity
    Offer --> ProvEntity
    IssuerState --> PrivateEntity
    Issuance --> ProvActivity
    Wallet --> PrivateEntity
    Metadata --> PrivateEntity
    Payload --> PrivateEntity
    Nonce --> PrivateEntity
    ProofRequest --> ProvEntity
    ProofAudit --> PrivateActivity
    Verification --> ProvActivity
    TrustOverlap --> PrivateActivity

    OrgCred --> Metadata
    GuardianCred --> Metadata
    GeoCred --> Metadata
    SkillCred --> Metadata
    IssuerState --> Agent
```

## Credential Relationship Diagram

```mermaid
flowchart LR
    Issuer["[KB/MCP] issuer sa:Agent"]
    Schema["[KB] sac:CredentialSchema"]
    CredDef["[KB] sac:CredentialDefinition"]
    Offer["[VC] sac:CredentialOffer"]
    Wallet["[MCP] sac:HolderWallet"]
    Metadata["[MCP] sac:AnonCredentialMetadata"]
    Payload["[MCP] sac:AnonCredentialPayload"]
    Holder["[KB] sa:PersonAgent"]

    Issuer -->|"publishes"| Schema
    Issuer -->|"publishes"| CredDef
    CredDef -->|"uses"| Schema
    Issuer -->|"issues"| Offer
    Holder -->|"owns"| Wallet
    Offer -->|"accepted into"| Wallet
    Wallet -->|"contains metadata"| Metadata
    Metadata -->|"sac:usesSchema"| Schema
    Metadata -->|"sac:usesCredentialDefinition"| CredDef
    Metadata -->|"sac:hasCredentialPayload"| Payload
```

## Proof Relationship Diagram

```mermaid
flowchart LR
    Verifier["[KB/MCP] verifier sa:Agent"]
    Request["[VC] sac:ProofRequest"]
    Wallet["[MCP] sac:HolderWallet"]
    Credential["[VC] sac:AnonCredentialMetadata"]
    Payload["[MCP] sac:AnonCredentialPayload"]
    Audit["[MCP] sac:PresentationAudit"]
    Verification["[MCP/KB] sac:PresentationVerification"]
    Assertion["[KB] sar:Assertion / AgentValidationProfile"]
    GraphDB["GraphDB"]

    Verifier -->|"creates"| Request
    Request -->|"requires credential type"| Credential
    Wallet -->|"selects"| Credential
    Credential --> Payload
    Payload -->|"proves predicates"| Audit
    Audit -->|"submitted to"| Verifier
    Verifier -->|"produces"| Verification
    Verification -->|"optional public anchor"| Assertion
    Assertion --> GraphDB
```

## Credential Kind Diagram

```mermaid
flowchart TD
    Metadata["sac:AnonCredentialMetadata"]
    Org["sac:OrgMembershipCredential"]
    Guardian["sac:GuardianOfMinorCredential"]
    Geo["sac:GeoLocationCredential"]
    Skill["sac:SkillsCredential"]

    Org -->|"subClassOf"| Metadata
    Guardian -->|"subClassOf"| Metadata
    Geo -->|"subClassOf"| Metadata
    Skill -->|"subClassOf"| Metadata

    Org -->|"public equivalent"| Edge["sar:RelationshipEdge"]
    Geo -->|"public equivalent"| GeoClaim["sageo:GeoClaim"]
    Skill -->|"public equivalent"| SkillClaim["saskill:SkillClaim"]
    Guardian -->|"public equivalent"| Receipt["sac:PresentationVerification only"]
```

## Store Mapping

| Store/source | Class |
| --- | --- |
| `person-mcp.holder_wallets` | `sac:HolderWallet` |
| `person-mcp.credential_metadata` | `sac:AnonCredentialMetadata` |
| `person-mcp` Askar vault | `sac:AnonCredentialPayload` |
| `person-mcp.ssi_proof_audit` | `sac:PresentationAudit` |
| `person-mcp.trust_overlap_audit` | `sac:TrustOverlapAudit` |
| issuer MCP private store | `sac:CredentialIssuerState` |
| `CredentialRegistry.sol` | `sac:CredentialSchema`, `sac:CredentialDefinition` |
| `AgentValidationProfile.sol` | public `sac:PresentationVerification` receipt |

## Description

The credential ontology has three privacy layers:

1. Public issuer metadata: schemas and credential definitions.
2. Private holder data: wallet, metadata, encrypted payload, link secret id.
3. Optional public receipt: verifier assertion that a proof satisfied a policy.

The credential payload itself should never appear in GraphDB.
