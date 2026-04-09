# System Architecture

## Runtime Architecture

```mermaid
graph LR
    subgraph "Browser"
        UI[Next.js Web App]
        Privy[Privy SDK]
        MM[MetaMask]
    end

    subgraph "Server (Next.js)"
        API[API Routes]
        SA[Server Actions]
        DB[(SQLite / Drizzle)]
        PS[Privy Server Auth]
    end

    subgraph "Blockchain (Anvil / Sepolia)"
        EP[EntryPoint v0.7]
        Factory[AgentAccountFactory]
        Accounts[Agent Smart Accounts]
        Rel[AgentRelationship]
        Assert[AgentAssertion]
        Control[AgentControl]
        Templates[AgentRelationshipTemplate]
        Issuers[AgentIssuerProfile]
        Reviews[AgentReviewRecord]
        Disputes[AgentDisputeRecord]
        Trust[AgentTrustProfile]
    end

    UI --> Privy --> MM
    UI --> API
    UI --> SA
    API --> DB
    API --> PS
    SA --> DB
    SA --> Factory
    SA --> Rel
    SA --> Assert
    SA --> Control
    API --> Rel
    API --> Reviews
    API --> Issuers
    Factory --> Accounts
    Accounts --> EP
```

## Data Flow: Deploy Agent

```mermaid
sequenceDiagram
    participant User as User (Browser)
    participant Privy as Privy Auth
    participant Server as Next.js Server
    participant Factory as AgentAccountFactory
    participant Control as AgentControl
    participant DB as SQLite

    User->>Privy: Connect wallet
    Privy->>User: Authenticated (EOA address)
    User->>Server: Deploy org agent (name, minOwners, quorum)
    Server->>Factory: createAccount(ownerEOA, salt)
    Factory-->>Server: Smart account address
    Server->>Control: initializeAgent(agent, minOwners, quorum)
    Control-->>Server: Governance initialized
    Server->>DB: Store org agent record
    Server-->>User: Success + address
```

## Data Flow: Invite Co-Owner

```mermaid
sequenceDiagram
    participant A as Person A (Owner)
    participant Server as Next.js Server
    participant DB as SQLite
    participant B as Person B (Invitee)
    participant Control as AgentControl
    participant Rel as AgentRelationship

    A->>Server: Invite person B to org
    Server->>DB: Create invite record (code, pending)
    Server->>DB: Create notification for B
    Server-->>A: Invite link

    B->>Server: Open /invite/[code]
    Server->>DB: Validate invite
    Server-->>B: Show accept/decline

    B->>Server: Accept invite
    Server->>Control: addOwner(orgAgent, B.walletAddress)
    Server->>Rel: createEdge(B.agent → org, owner)
    Server->>Rel: confirmRelationship(edgeId)
    Server->>DB: Mark invite accepted
    Server->>DB: Notify A (accepted) + Notify B (welcome)
    Server-->>B: Redirect to dashboard
```

## Data Flow: Create Relationship

```mermaid
sequenceDiagram
    participant User as User
    participant Server as Server
    participant Rel as AgentRelationship
    participant Assert as AgentAssertion
    participant DB as SQLite

    User->>Server: Create relationship (from, to, role)
    Server->>Server: Check if user owns both agents

    alt User owns both agents
        Server->>Rel: createEdge(subject, object, role) → PROPOSED
        Server->>Assert: makeAssertion(edgeId, SELF_ASSERTED)
        Server->>Rel: setEdgeStatus(CONFIRMED)
        Server->>Rel: setEdgeStatus(ACTIVE)
        Server->>Assert: makeAssertion(edgeId, OBJECT_ASSERTED)
        Server-->>User: Auto-confirmed ✓
    else Different owners
        Server->>Rel: createEdge(subject, object, role) → PROPOSED
        Server->>Assert: makeAssertion(edgeId, SELF_ASSERTED)
        Server->>DB: Notify object agent owner
        Server-->>User: Awaiting confirmation
    end
```

## Deployment

### Local Development

```bash
# Terminal 1: Local blockchain
anvil

# Terminal 2: Deploy contracts + seed data
./scripts/deploy-local.sh    # 15 contracts
./scripts/seed-graph.sh      # 16 agents, 28 edges, 6 issuers, 3 reviews

# Terminal 3: Web app
pnpm dev                     # http://localhost:3000
```

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_PRIVY_APP_ID` | Privy authentication |
| `PRIVY_APP_SECRET` | Privy server auth |
| `NEXT_PUBLIC_SKIP_AUTH` | Mock auth for testing |
| `NEXT_PUBLIC_CHAIN_ID` | Target chain |
| `RPC_URL` | Chain RPC endpoint |
| `DEPLOYER_PRIVATE_KEY` | Server-side deployer key |
| `AGENT_FACTORY_ADDRESS` | Factory contract |
| `AGENT_RELATIONSHIP_ADDRESS` | Relationship edges |
| `AGENT_ASSERTION_ADDRESS` | Provenance claims |
| `AGENT_RESOLVER_ADDRESS` | Trust resolution |
| `AGENT_TEMPLATE_ADDRESS` | Delegation templates |
| `AGENT_ISSUER_ADDRESS` | Claim issuers |
| `AGENT_VALIDATION_ADDRESS` | TEE validation |
| `AGENT_REVIEW_ADDRESS` | Structured reviews |
| `AGENT_DISPUTE_ADDRESS` | Disputes |
| `AGENT_TRUST_PROFILE_ADDRESS` | Trust scoring |
| `AGENT_CONTROL_ADDRESS` | Multi-sig governance |
