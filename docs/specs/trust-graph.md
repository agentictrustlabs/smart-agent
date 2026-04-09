# Agent Trust Graph — Ontology & Design

## DOLCE+DnS Mapping

In DOLCE+DnS (Descriptions and Situations):

- **Agent** — a social agent (person or organization) identified by its 4337 smart account (did:ethr)
- **Description** — a normative pattern defining roles an agent can play (e.g., "Organization Membership" describes roles: owner, admin, member)
- **Situation** — a concrete state of affairs that satisfies a description (e.g., "Alice is a member of Org X")
- **Assertion** — a speech act by an agent claiming a situation holds (e.g., "Org X asserts that Alice is a member")
- **Claim** — the propositional content of an assertion (the relationship + role + evidence)

## Identity: did:ethr

Each agent's identity is its smart account address, expressed as:
```
did:ethr:<chainId>:<smartAccountAddress>
```

The smart account IS the agent. No separate identity registry needed.
The DID resolves to the account's on-chain state (owners, nonce, code).

## Data Model

### Assertion (on-chain)

An assertion is a claim made by one agent about a relationship with another:

```
Assertion {
  id: uint256                  // auto-increment
  subject: address             // the agent the assertion is about
  object: address              // the related agent (e.g., the org)
  role: bytes32                // the role played (keccak256 of role name)
  description: bytes32         // the description type (keccak256 of description name)
  asserter: address            // who made this assertion (must be the object or a delegate)
  validFrom: uint256           // timestamp when assertion becomes valid
  validUntil: uint256          // timestamp when assertion expires (0 = indefinite)
  revoked: bool                // whether the assertion has been revoked
  metadata: string             // IPFS/URI pointer to off-chain claim details
}
```

### Descriptions (well-known constants)

```
ORGANIZATION_MEMBERSHIP = keccak256("OrganizationMembership")
DELEGATION_AUTHORITY    = keccak256("DelegationAuthority")
VALIDATION_TRUST        = keccak256("ValidationTrust")
SERVICE_AGREEMENT       = keccak256("ServiceAgreement")
```

### Roles (well-known constants)

```
OWNER    = keccak256("owner")
ADMIN    = keccak256("admin")
MEMBER   = keccak256("member")
OPERATOR = keccak256("operator")
AUDITOR  = keccak256("auditor")
VENDOR   = keccak256("vendor")
```

## Query Patterns

The trust graph enables policy-aware delegation:

1. **"Is Alice a member of Org X?"**
   → query assertions where subject=Alice, object=OrgX, description=ORGANIZATION_MEMBERSHIP

2. **"Only transact with agents validated by X"**
   → delegation caveat checks for assertion where object=target, asserter=X, description=VALIDATION_TRUST

3. **"Only allow payments to org-linked service agents"**
   → delegation caveat checks for assertion where subject=target, description=SERVICE_AGREEMENT

## Trust Semantics

- An assertion is only valid if made by the `object` agent (or its delegate)
- The `object` is the authoritative party (the org asserts membership, the validator asserts trust)
- Assertions can be time-bounded and revocable
- Multiple assertions can exist for the same subject-object pair (different roles, different times)
- The graph is directed: assertions flow from object (authority) toward subject (participant)
