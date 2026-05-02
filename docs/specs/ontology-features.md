# Ontology Features Backlog

> **Status**: living spec
> **Purpose**: capture ontology feature requests before implementation.
> **Rule**: when the user says "add feature", treat it as "add an
> ontology feature request to this document" unless they explicitly say
> otherwise.

## How To Use This Spec

Each feature should describe the ontology concept, why it is needed, how it
relates to existing Smart Agent concepts, and what artifacts may need to be
created or updated.

Use this template:

```text
## Feature: <name>

### Intent
What user/system capability this ontology feature enables.

### Ontology Scope
Classes, properties, SKOS concepts, SHACL shapes, and graph data involved.

### Alignment
Upper ontology or external vocabulary alignment, such as DUL, PROV-O,
P-Plan, ValueFlows, ODRL, SKOS, GeoSPARQL, or AnonCreds.

### Candidate Terms
Proposed classes/properties/concepts.

### Integration Points
Contracts, GraphDB sync, MCP services, web UI, SDK, and seed data.

### Privacy / Access
What is public, private, committed, or access-controlled.

### Open Questions
Decisions needed before implementation.
```

## Feature: Add Membership

### Intent

Model membership as a first-class ontology capability across people,
organizations, hubs, circles, networks, and groups. Membership should support
both public graph discovery and private/credential-backed membership claims.

This feature should answer:

- Who is a member of what?
- In what role or capacity?
- Who asserted or validated the membership?
- Is the membership public, private, anonymous, pending, active, revoked, or
  expired?
- What access or work modes does membership unlock?

### Ontology Scope

Membership overlaps with existing relationship, role, assertion, validation,
credential, and work-mode concepts.

Existing concepts to reuse:

- `sa:Agent`
- `sa:PersonAgent`
- `sa:OrganizationAgent`
- `sa:HubAgent`
- `sar:OrganizationMembership`
- `sar:HasMember`
- `sar:MembershipRole`
- `sar:Member`
- `sar:Administrator`
- `sar:Role`
- `AgentRelationship`
- `AgentAssertion`
- `AgentValidationProfile`
- `OrgMembershipCredential`

Membership should be represented as a **relationship situation**, not just a
flat field on an agent.

```text
PersonAgent -- OrganizationMembership --> OrganizationAgent
subject plays MembershipRole in membership situation
assertions and validations determine whether it is trusted
```

### Alignment

Recommended upper ontology alignment:

| Smart Agent concept | Alignment |
| --- | --- |
| Membership edge | `dul:Situation` |
| Membership type | `dul:Description` |
| Member role | `dul:Role` |
| Assertion of membership | `prov:Entity`, existing `AgentAssertion` |
| Validation of membership | `prov:Activity` or validation record entity |
| Membership credential | `prov:Entity`, AnonCreds credential |
| Joining/leaving activity | `prov:Activity` |

### Candidate Terms

Prefer extending `relationships.ttl` / `roles.ttl` unless a dedicated
membership module becomes necessary.

Candidate classes:

```ttl
sar:MembershipSituation
    rdfs:subClassOf dul:Situation .

sar:MembershipDescription
    rdfs:subClassOf dul:Description .

sar:MembershipStatus
    rdfs:subClassOf skos:Concept .
```

Candidate SKOS concepts:

```ttl
sar:PendingMembership
sar:ActiveMembership
sar:SuspendedMembership
sar:RevokedMembership
sar:ExpiredMembership
sar:PrivateMembership
sar:AnonymousMembership
```

Candidate properties:

```ttl
sar:memberAgent
sar:memberOf
sar:membershipRole
sar:membershipStatus
sar:membershipAssertedBy
sar:membershipValidatedBy
sar:membershipCredential
sar:membershipVisibility
sar:validFrom
sar:validUntil
```

### Integration Points

Contracts:

- Reuse `AgentRelationship` for public or relationship-backed membership.
- Reuse `AgentAssertion` for who asserted membership.
- Reuse `AgentValidationProfile` for third-party validation.
- Avoid adding a membership-specific contract unless relationship queries or
  revocation semantics become too expensive.

Credentials:

- Use `OrgMembershipCredential` for private or anonymous membership.
- Store credentials in `person-mcp`, not web SQL.
- Publish only public claims, commitments, verifier receipts, or score
  contributions when appropriate.

GraphDB:

- Sync public membership edges and roles into the public graph.
- Keep private/anonymous membership details out of public named graphs.
- Add query helpers for:
  - members of organization;
  - organizations for member;
  - membership by role;
  - membership by status;
  - public membership overlap for discovery.

MCP services:

- `person-mcp` owns private personal membership credentials.
- Future `org-mcp` should own private org rosters, detached members, and
  membership approval workflows.

Web UI:

- Members list should distinguish:
  - public on-chain member;
  - private org roster member;
  - anonymous credential-backed member;
  - pending invite;
  - detached member without account.
- Discovery should be able to use membership as:
  - public relationship signal;
  - private overlap signal;
  - access-control gate;
  - work-mode/default-dashboard input.

### Privacy / Access

Membership needs explicit visibility:

| Visibility | Meaning |
| --- | --- |
| `public` | public relationship edge in GraphDB/on-chain |
| `public-coarse` | org/category visible, role or person detail hidden |
| `private-org` | visible only through org-controlled access |
| `private-person` | visible only through person-controlled access |
| `anonymous-credential` | usable in AnonCreds proofs without public identity |
| `commitment-only` | public commitment/hash, private source |

Sensitive memberships should default to private or anonymous credential-backed
representation.

### Open Questions

1. Should `sar:MembershipSituation` be added as a formal T-Box class, or is
   the existing `AgentRelationship` DnS mapping enough?
2. Should private org rosters move to `org-mcp` before membership UI is
   expanded?
3. Should membership status live on the relationship edge metadata, GraphDB
   only, or a future relationship-status registry?
4. Which membership types should be eligible for anonymous credential
   issuance?
5. Which roles unlock hub work modes such as `GovernMode`, `DiscipleMode`,
   `RouteMode`, and `StewardMode`?
