# Agent Control — EOA to Agent Governance

## Overview

Agent Control manages the relationship between **principal EOAs** (human wallets) and **agent smart accounts** (4337 accounts). This is the governance/control plane — separate from the trust graph.

## Architecture

```mermaid
graph TB
    subgraph "Principal EOAs"
        EOA1[Alice EOA<br/>0x7c64...]
        EOA2[Bob EOA<br/>0x7099...]
        EOA3[Carol EOA<br/>0x3C44...]
    end

    subgraph "AgentControl Contract"
        GC[Governance Config<br/>minOwners: 3<br/>quorum: 2]
        OL[Owner List<br/>Alice, Bob, Carol]
        PQ[Proposal Queue]
    end

    subgraph "Agent Smart Accounts"
        PA[Person Agent<br/>Alice's 4337]
        OA[Org Agent<br/>ATL 4337]
    end

    EOA1 -->|owner| OL
    EOA2 -->|owner| OL
    EOA3 -->|owner| OL
    OL -->|governs| PA
    OL -->|governs| OA
    GC -->|policy| PQ
```

## Three Authority Domains

```mermaid
graph TB
    subgraph "1. AGENT GOVERNANCE"
        direction LR
        EOA[Principal EOA] -->|owns| Agent[4337 Smart Account]
        AC[AgentControl] -->|manages| Agent
        AC -->|tracks| Owners[Owner Set + Quorum]
    end

    subgraph "2. RELATIONSHIP AUTHORITY"
        direction LR
        A1[Agent A] -->|plays role in| A2[Agent B]
        Edge[AgentRelationship] -->|stores| Role[Roles + Status]
        Tmpl[Template] -->|defines| Caveats[Allowed Delegations]
    end

    subgraph "3. EXECUTION AUTHORITY"
        direction LR
        Del[Delegation] -->|grants| Exec[Execute with Caveats]
        Exec -->|constrained by| Enf[Enforcers]
    end
```

## AgentControl Contract

### State Machine

```mermaid
stateDiagram-v2
    [*] --> Uninitialized
    Uninitialized --> Bootstrap : initializeAgent(minOwners, quorum)
    Bootstrap --> Bootstrap : addOwner() [count < minOwners]
    Bootstrap --> GovernanceReady : addOwner() [count >= minOwners]
    GovernanceReady --> GovernanceReady : createProposal / approveProposal
```

### Functions

| Function | Who can call | What it does |
|----------|-------------|--------------|
| `initializeAgent(agent, minOwners, quorum)` | Anyone (once) | Set up governance, caller = first owner |
| `addOwner(agent, newOwner)` | Any owner | Add co-owner. Completes bootstrap when threshold met |
| `removeOwner(agent, owner)` | Any owner | Remove owner. Auto-adjusts quorum if needed |
| `setQuorum(agent, newQuorum)` | Any owner | Change approval threshold |
| `createProposal(agent, class, data)` | Any owner (post-bootstrap) | Create proposal, auto-approve by proposer |
| `approveProposal(agent, id)` | Any owner | Vote yes. Executes when quorum met |
| `canAct(agent, caller)` | View | Check if caller can act for agent |
| `isGovernanceReady(agent)` | View | True when bootstrap complete |

### Proposal Flow

```mermaid
sequenceDiagram
    participant Owner1 as Owner 1
    participant Owner2 as Owner 2
    participant AC as AgentControl
    
    Owner1->>AC: createProposal(agent, RELATIONSHIP_APPROVE, data)
    Note over AC: Auto-approve by proposer (1/2)
    AC-->>Owner1: Proposal #0 created (PENDING)
    
    Owner2->>AC: approveProposal(agent, 0)
    Note over AC: Quorum met (2/2)
    AC-->>Owner2: Proposal #0 EXECUTED
```

### Action Classes

| Class | Enum | Typical Policy |
|-------|------|---------------|
| `OWNER_CHANGE` | 0 | Requires quorum |
| `RELATIONSHIP_APPROVE` | 1 | Configurable per type |
| `TEMPLATE_ACTIVATE` | 2 | Requires quorum |
| `DELEGATION_GRANT` | 3 | Quorum for high-value |
| `EMERGENCY_PAUSE` | 4 | Any single owner |
| `METADATA_UPDATE` | 5 | Any single owner |

## Bootstrap Flow

```mermaid
graph LR
    A[Deploy Agent] --> B[initializeAgent<br/>minOwners=3, quorum=2]
    B --> C[Bootstrap Mode<br/>Only addOwner allowed]
    C --> D[Add Owner #2]
    D --> E[Add Owner #3<br/>Threshold met]
    E --> F[Governance Ready<br/>Proposals enabled]
```

## Invite Flow for Co-Owners

```mermaid
graph TB
    A[Owner clicks<br/>Invite Co-Owner] --> B{Method}
    B -->|Select Person| C[Pick existing user<br/>from dropdown]
    B -->|By Address| D[Enter raw EOA]
    B -->|Invite Link| E[Generate shareable URL]
    
    C --> F[Create invite record]
    D --> F
    E --> F
    
    F --> G[Send notification<br/>to invitee]
    G --> H[Invitee opens<br/>/invite/code]
    H --> I{Accept or Decline?}
    I -->|Accept| J[addOwner on AgentControl]
    J --> K[Create ownership<br/>relationship edge]
    K --> L[Org appears in<br/>invitee dashboard]
    I -->|Decline| M[Navigate to home]
```

## Permission Model

```
owner (EOA)
  └── Can: manage owners, approve all, grant delegations, pause
  └── Via: AgentControl.addOwner / createProposal / approveProposal

admin (relationship role)
  └── Can: approve non-owner relationships, manage members
  └── Via: Relationship edge with admin role + confirmed status

member (relationship role)
  └── Can: propose relationships for themselves
  └── Cannot: approve for others, grant delegations
```
