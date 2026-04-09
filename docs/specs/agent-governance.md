# Agent Governance & Permission Model — PM Spec

## Three Authority Domains

```
┌─────────────────────────────────────────────────────────────────┐
│  1. AGENT GOVERNANCE (AgentControl)                             │
│     EOA/multisig owners → agent smart account                   │
│     Who controls this agent? What quorum is needed?             │
├─────────────────────────────────────────────────────────────────┤
│  2. RELATIONSHIP AUTHORITY (AgentRelationship + Templates)      │
│     Agent ↔ Agent trust graph edges                             │
│     What roles exist? What delegations are allowed per role?    │
├─────────────────────────────────────────────────────────────────┤
│  3. EXECUTION AUTHORITY (Delegations + Caveats)                 │
│     Concrete executable grants                                   │
│     What can be done? With what limits?                          │
└─────────────────────────────────────────────────────────────────┘
```

## Layer 1: Agent Governance (AgentControl.sol)

### Purpose
Manages the owner set, quorum rules, and approval policies for an agent smart account. This is the control plane — it decides WHO can authorize actions on the agent.

### Data Model
```
AgentControlConfig {
  agent: address              // the 4337 smart account
  owners: address[]           // principal EOAs
  minOwners: uint256          // minimum owners before agent is active (e.g., 3)
  quorum: uint256             // votes needed to approve (e.g., 2-of-3)
  isBootstrap: bool           // true until minOwners met
}
```

### Governance Actions (require quorum)
- Add/remove owner
- Change quorum threshold
- Approve relationship confirmation
- Activate relationship templates
- Issue/revoke direct delegations
- Emergency pause agent
- Update agent metadata

### Action Classes
Each action has an approval policy:

| Action Class | Default Policy |
|---|---|
| `OWNER_CHANGE` | Requires quorum |
| `RELATIONSHIP_APPROVE` | Configurable per relationship type |
| `TEMPLATE_ACTIVATE` | Requires quorum |
| `DELEGATION_GRANT` | Requires quorum for high-value, single-owner for low-value |
| `EMERGENCY_PAUSE` | Any single owner |
| `METADATA_UPDATE` | Any single owner |

### Bootstrap Flow
1. Creator deploys agent → becomes first owner
2. Agent is in `bootstrap` mode — only owner management allowed
3. Creator adds additional owners until `minOwners` threshold met
4. Agent becomes `governance-ready` — all actions available
5. Quorum enforced from this point forward

### Relationship Approval Policy (per relationship type)

| Relationship Type | Approval Required |
|---|---|
| OrganizationGovernance (CEO, board) | Quorum required |
| OrganizationMembership (member) | Single owner |
| Alliance | Quorum required |
| InsuranceCoverage | Quorum required |
| ServiceAgreement | Single owner |
| DelegationAuthority | Quorum required |
| ReviewRelationship | No approval (informational) |
| ActivityValidation | No approval (informational) |

## Layer 2: Relationship Authority

### Permission Rules for Relationship Management

**Who can PROPOSE a relationship:**
- Any EOA can propose on behalf of an agent they own
- The agent account itself (via UserOp)

**Who can CONFIRM/REJECT (object side):**
- Owner of the object agent → always
- Admin (has admin role via confirmed governance relationship) → non-owner roles only
- Agent account itself → always

**Who can ACTIVATE (after confirmation):**
- Automatic if governance policy doesn't require quorum
- Requires quorum vote if governance policy requires it

### Role Permission Matrix

| Role | Can propose | Can confirm | Can assign roles | Can grant delegations |
|---|---|---|---|---|
| owner | yes | all | all | all |
| admin | yes | non-owner/admin | member, operator, viewer | limited |
| member | self only | no | no | no |
| operator | self only | no | no | no |
| viewer | no | no | no | no |

## Layer 3: Execution Authority

### Direct Delegations
- Issued by agent governance (owner/quorum)
- Not tied to any relationship
- Concrete caveat-bound grants

### Relationship-Derived Delegations
- Defined by templates (role + relationship type → allowed caveats)
- Only instantiated when:
  1. Relationship is ACTIVE
  2. Template exists for the role
  3. Governance policy is satisfied
- Automatically revoked when relationship is revoked/suspended

### Delegation Lifecycle
```
Template defines pattern → Relationship ACTIVE → Governance approves → Delegation instantiated
                                                                           ↓
                                                          Relationship revoked → Delegation revoked
```

## Implementation Plan

### Sprint 1: AgentControl Contract
- [ ] `AgentControl.sol` — owner set, quorum, bootstrap, proposal/approval
- [ ] Proposal struct: proposer, action type, target, data, approvals[], executed
- [ ] `proposeAction()`, `approveAction()`, `executeAction()`
- [ ] Bootstrap mode: only owner management until minOwners met
- [ ] Forge tests

### Sprint 2: Integrate with Relationships
- [ ] `confirmEdge` checks AgentControl for approval policy
- [ ] High-impact relationship types require quorum
- [ ] Low-impact types allow single-owner confirmation
- [ ] Web app: show pending approvals, vote buttons

### Sprint 3: Delegation Activation
- [ ] Template instantiation gated by governance policy
- [ ] Delegation auto-revoke on relationship revocation
- [ ] Web app: delegation status per relationship

### Sprint 4: Web App — Governance UI
- [ ] Agent settings page: manage owners, quorum, policies
- [ ] Pending proposals queue
- [ ] Vote/approve interface
- [ ] Governance history/audit log
