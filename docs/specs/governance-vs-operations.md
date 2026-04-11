# Governance vs Operations: Control Plane and Data Plane

## The Core Distinction

Every agent smart account has two separate layers of authority:

```
┌─────────────────────────────────────────────────────────────────┐
│                     GOVERNANCE (Control Plane)                   │
│                                                                  │
│  WHO can change the agent itself?                                │
│                                                                  │
│  Multi-sig owners (AgentControl):                                │
│    - Add/remove signers                                          │
│    - Change quorum threshold                                     │
│    - Upgrade implementation (UUPS)                               │
│    - Set DelegationManager                                       │
│    - Emergency pause                                             │
│                                                                  │
│  Analogy: Who has the keys to the building?                      │
│  Contract: AgentControl + AgentRootAccount                       │
│  UI: Admin → Governance tab                                      │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                    OPERATIONS (Data Plane)                        │
│                                                                  │
│  WHAT can people do within the organization?                     │
│                                                                  │
│  Relationships define roles:                                     │
│    - Pastor James → Grace Church (owner, treasurer)              │
│    - Dan Busby → Grace Church (reviewer)                         │
│                                                                  │
│  Delegations define authority:                                   │
│    - Treasurer can call transfer(), max 5 ETH, 30-day window     │
│    - Reviewer can call createReview(), ReviewRecord only          │
│                                                                  │
│  Caveats enforce boundaries:                                     │
│    - TimestampEnforcer: time-limited authority                   │
│    - AllowedMethodsEnforcer: specific functions only             │
│    - AllowedTargetsEnforcer: specific contracts only             │
│    - ValueEnforcer: spending cap per transaction                 │
│                                                                  │
│  Analogy: What can you do once you're inside?                    │
│  Contracts: AgentRelationship + DelegationManager + Enforcers    │
│  UI: Organization page → Members/Roles section                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Why They're Separate

A person can have governance authority without operational roles, and vice versa:

| Person | Governance (Signer?) | Operational Role | Delegation Authority |
|--------|---------------------|-----------------|---------------------|
| Pastor James | Yes (owner) | Treasurer | Can spend up to 5 ETH, approved targets |
| Board Elder | Yes (signer) | Board Member | Can approve proposals |
| Church Admin | No | Administrator | Can manage schedules, no financial access |
| ECFA Auditor | No | Reviewer | Can submit accreditation reviews |
| External Partner | No | None | No delegation |

**Key insight:** Being a multi-sig signer (governance) doesn't automatically give you operational authority. And having an operational role doesn't make you a signer. These are independent dimensions.

## How It Works On-Chain

### Governance Flow (Control Plane)

```
Alice (EOA wallet)
    │
    │ is an owner in AgentRootAccount._owners
    │ is a signer in AgentControl._isOwner
    │
    ├── Can approve proposals (AgentControl.approveProposal)
    ├── Can add/remove owners (requires quorum)
    ├── Can change quorum (requires quorum)
    └── Can sign UserOps for the agent account (ERC-4337)
    
    This is about WHO CONTROLS the agent's smart account.
    It's like being on the board of directors — you can change
    the org's structure, but your day-to-day authority comes
    from your operational role.
```

### Operations Flow (Data Plane)

```
Alice (Person Agent)
    │
    │ has relationship edge to Org Agent
    │   type: ORGANIZATION_GOVERNANCE
    │   role: ROLE_TREASURER
    │   status: ACTIVE
    │
    │ has delegation from Org Agent
    │   delegator: Org Agent smart account
    │   delegate: deployer (server relay)
    │   caveats:
    │     - TimestampEnforcer: valid 30 days
    │     - AllowedMethodsEnforcer: [transfer]
    │     - ValueEnforcer: max 5 ETH
    │     - AllowedTargetsEnforcer: [approved vendors]
    │
    └── Can execute treasury operations within bounds
        via DelegationManager.redeemDelegation()
    
    This is about WHAT YOU CAN DO within the organization.
    The relationship defines your role. The delegation defines
    your authority. The caveats define the boundaries.
```

## How It Shows in the UI

### Admin → Governance (Control Plane)
Shows:
- Approval threshold: "2-of-3 signers required"
- Current signers: wallet addresses that can sign proposals
- Governance status: Active / Bootstrap
- Actions: Add signer, change quorum

This is purely about the multi-sig configuration of the smart account.

### Organization Page (Data Plane)
Shows:
- **Members**: People with their roles (from relationship edges)
  - Each member shows their delegated authority
  - Delegation caveats are displayed: time window, spending limit, allowed methods
- **Related Organizations**: Org-to-org relationships (endorsements, memberships)
- **AI Agents**: Agents operated by this org with their capabilities

## The Flow: From Role to Action

```
1. RELATIONSHIP created
   Pastor James → Grace Church
   Role: ROLE_TREASURER
   Type: ORGANIZATION_GOVERNANCE
   Status: PROPOSED → CONFIRMED → ACTIVE

2. DELEGATION issued (auto or manual)
   Delegator: Grace Church smart account
   Delegate: server relay (or James directly via 4337)
   Caveats: [time, methods, targets, value]

3. ACTION executed
   James wants to pay a vendor
   → DelegationManager.redeemDelegation()
   → Validates delegation signature (Grace Church signed via ERC-1271)
   → Runs beforeHook on each caveat:
     - TimestampEnforcer: within 30-day window? ✓
     - AllowedMethodsEnforcer: transfer()? ✓
     - ValueEnforcer: amount ≤ 5 ETH? ✓
     - AllowedTargetsEnforcer: approved vendor? ✓
   → Executes through Grace Church's smart account
   → Vendor receives payment
```

## Template-Driven Setup

When an org is created from a template, the template defines:
- **Roles**: What operational positions exist (treasurer, reviewer, admin)
- **Governance defaults**: How many signers, what quorum
- **AI Agents**: Which autonomous agents to deploy
- **Delegation patterns**: What caveats to apply per role

Example: The "Church" template creates:
- Governance: 2-of-2 multi-sig
- Roles: Senior Pastor (owner), Elder/Board (board-member), Treasurer, Admin, Staff
- AI Agents: Treasury Agent
- Delegation for Treasurer: TimestampEnforcer (30 days) + ValueEnforcer (configurable) + AllowedMethods

When someone is invited as "Treasurer":
1. Relationship edge created with ROLE_TREASURER
2. Delegation auto-issued with template caveats
3. Person can immediately operate within bounds
4. No governance change needed — they're not added as a multi-sig signer unless the role specifies `isOwner: true`

## Summary

| Aspect | Governance | Operations |
|--------|-----------|------------|
| **Question** | Who controls the agent? | What can people do? |
| **Contract** | AgentControl, AgentRootAccount | AgentRelationship, DelegationManager |
| **Data** | Owner set, quorum, proposals | Edges, roles, delegations, caveats |
| **Changes** | Requires multi-sig approval | Relationship confirmation only |
| **UI Location** | Admin → Governance | Organization page |
| **Analogy** | Keys to the building | Job description + access badge |
| **Who decides** | Existing signers (quorum) | Org owner or auto from template |
