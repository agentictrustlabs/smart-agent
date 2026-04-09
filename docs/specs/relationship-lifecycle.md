# Relationship Lifecycle & Permission Model — PM Spec

## State Machine

```
PROPOSED → CONFIRMED → ACTIVE → REVOKED
    │          │                    ↑
    │          └── REJECTED         │
    └── EXPIRED                SUSPENDED
```

### States
| State | Meaning | Delegations |
|-------|---------|-------------|
| PROPOSED | One side created the relationship | None active |
| CONFIRMED | Counterparty acknowledged | None active (awaiting qualification) |
| ACTIVE | Resolver confirmed, delegations eligible | Templates instantiated, caveats enforced |
| SUSPENDED | Temporarily paused | Delegations frozen |
| REVOKED | Permanently ended | Delegations revoked |
| REJECTED | Counterparty declined | None |

### Transitions
| From | To | Who can do it |
|------|----|---------------|
| PROPOSED | CONFIRMED | Object agent (or its owner/admin) |
| PROPOSED | REJECTED | Object agent (or its owner/admin) |
| CONFIRMED | ACTIVE | Automatic when resolver profile passes |
| ACTIVE | SUSPENDED | Either party, or admin of either |
| ACTIVE | REVOKED | Either party, or admin of either |
| SUSPENDED | ACTIVE | Party that suspended, or admin |

## Permission Model

### Role Hierarchy
```
owner
  └── can assign: owner, admin, all other roles
  └── can approve: all relationships
  └── can grant: all delegations

admin
  └── can assign: member, operator, auditor, vendor, reviewer
  └── can approve: non-owner relationships
  └── cannot assign: owner, admin

member / operator / auditor / vendor / reviewer
  └── can propose: relationships for themselves
  └── cannot approve: relationships for others
  └── cannot assign: roles to others
```

### Who Can Approve Relationships

The **object side** (authority) must confirm. Specifically:

1. The object agent account itself (via UserOp)
2. An **owner** of the object agent (can approve anything)
3. An **admin** of the object agent (can approve non-owner/non-admin roles)

### Delegation Activation Rule

> Role-derived delegations are NOT eligible for activation until the counterparty confirms the relationship AND the edge reaches ACTIVE status.

Steps:
1. Subject proposes relationship with role(s)
2. Object confirms → edge becomes CONFIRMED
3. Resolver checks: edge confirmed + template exists + any required assertions present
4. If resolver passes → edge becomes ACTIVE
5. Delegation templates for the role(s) become instantiatable
6. Actual delegation (caveat-bound) is created for the subject

### Example: CEO Relationship

```
1. Alice proposes: Alice --[ceo]--> ATL (OrganizationGovernance)
   Edge status: PROPOSED
   Delegations: NONE

2. ATL owner confirms the relationship
   Edge status: CONFIRMED  
   Delegations: NONE (not yet qualified)

3. Resolver checks: edge confirmed + CEO Treasury Authority template exists
   Edge status: ACTIVE
   Delegations: CEO Treasury Authority template instantiated
   → Alice gets: spend up to X, time-bounded, target-restricted delegation
```

## Implementation Plan

### Sprint 1: Confirmation Flow
- [ ] Update `AgentRelationship.sol`: add `confirmEdge(edgeId)` and `rejectEdge(edgeId)`
- [ ] Confirmation requires caller to be object agent or owner of object agent
- [ ] Update web app: show pending relationships, confirm/reject buttons
- [ ] Dashboard shows PROPOSED vs CONFIRMED vs ACTIVE status

### Sprint 2: Permission Enforcement
- [ ] Track who has owner/admin rights per agent (use existing relationship edges)
- [ ] `confirmEdge` checks: caller is object, or caller has owner/admin relationship to object
- [ ] Admin can approve non-owner roles only
- [ ] Owner can approve all roles

### Sprint 3: Delegation Activation
- [ ] Resolver checks: edge ACTIVE + template exists → delegation eligible
- [ ] Auto-instantiate delegation when edge becomes ACTIVE (or manual trigger)
- [ ] Delegation revoked when edge is revoked/suspended
- [ ] Web app shows delegation status per relationship

### Sprint 4: Notification & Workflow
- [ ] Pending relationship notifications for object-side admins/owners
- [ ] Approval queue page
- [ ] Email/webhook notifications
