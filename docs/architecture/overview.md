# Smart Agent — Architecture Overview

A comprehensive architecture reference covering technical topology, information
architecture, object interactions between services, and the security model.

This document complements the deeper references in this folder:

- [technical-architecture.md](./technical-architecture.md) — monorepo + contract suite
- [system-architecture.md](./system-architecture.md) — runtime, environment, deploy flows
- [information-architecture.md](./information-architecture.md) — on-chain data model
- [contracts.md](./contracts.md) — per-contract deep dive
- [agent-control.md](./agent-control.md) — multi-sig governance
- [relationship-protocol.md](./relationship-protocol.md) — relationship lifecycle

---

## 1. Executive Summary

Smart Agent is an **Agent Smart Account Kit** built on ERC-4337. Agents (person,
organization, or AI) are first-class principals with their own on-chain smart
accounts. Authority flows through signed, scoped, revocable delegations enforced
by on-chain caveat enforcers and off-chain verifiers. A runtime fabric of three
services — **web**, **a2a-agent**, and **person-mcp** — together with a
**GraphDB** knowledge base and the **contract suite** implement the protocol.

Key properties:

- **Agent identity == smart account address** (`did:ethr:<chainId>:<addr>`)
- **All authority is delegated** — EOAs sign once, session keys act within caveats
- **Delegation is cryptographically and on-chain verifiable** (ERC-1271 + caveat enforcers + on-chain revocation)
- **Relationships are first-class** — trust, naming, and governance are edges in a graph
- **Machine-discoverable** — every agent exposes `/.well-known/agent.json`, an
  on-chain AgentNameRegistry record, and a GraphDB RDF projection

---

## 2. Technical Architecture

### 2.1 Service Topology

```mermaid
graph TB
    subgraph Browser
        User[User + Wallet]
        WebUI[Next.js Web UI<br/>React 19, Privy SDK]
    end

    subgraph "Web App Server (Next.js)"
        WebAPI[API Routes + Server Actions]
        WebDB[(SQLite<br/>users, agents, invites,<br/>messages, relationships)]
        WebPrivy[Privy Server Auth]
    end

    subgraph "A2A Agent (Hono, port 3100)"
        A2ASrv[HTTP Routes<br/>/auth /session /delegation<br/>/profile /a2a]
        A2ADB[(SQLite<br/>challenges, sessions, handles)]
    end

    subgraph "Person MCP (port 3200)"
        MCPStdio[MCP stdio transport]
        MCPHttp[HTTP /tools/:name]
        MCPVerify[Delegation Verifier<br/>9-layer stack]
        MCPDB[(SQLite<br/>profiles, identities,<br/>threads, messages,<br/>token_usage)]
    end

    subgraph "Knowledge Base"
        GDB[GraphDB<br/>SPARQL endpoint]
    end

    subgraph "Blockchain (Anvil / Sepolia)"
        EP[EntryPoint v0.7]
        Accts[AgentAccount instances]
        DM[DelegationManager]
        Names[AgentNameRegistry]
        Rel[AgentRelationship]
        Trust[AgentTrustProfile / Reviews / Disputes]
    end

    User -->|OAuth / EIP-712 sign| WebUI
    WebUI --> WebAPI
    WebAPI --> WebPrivy
    WebAPI --> WebDB
    WebAPI -->|bootstrap session<br/>mint delegation| A2ASrv
    WebAPI -->|SPARQL listAgents<br/>getAgentDetail| GDB
    WebAPI -->|viem reads<br/>deploy/write| Accts
    WebAPI --> Names

    A2ASrv --> A2ADB
    A2ASrv -->|ERC-1271 verify| Accts
    A2ASrv -->|delegation token<br/>in request body| MCPHttp

    MCPHttp --> MCPVerify
    MCPVerify -->|isValidSignature| Accts
    MCPVerify -->|isRevoked| DM
    MCPVerify --> MCPDB
    MCPHttp --> MCPDB

    Accts -. RDF projection .-> GDB
    Rel -. RDF projection .-> GDB
    Names -. RDF projection .-> GDB
```

Each arrow represents a concrete wire call. Dashed arrows are asynchronous
RDF projection feeds (on-chain events → SPARQL UPDATE).

### 2.2 Monorepo Layout

```
smart-agent/
├── apps/
│   ├── web/                   Next.js 15 (App Router, Privy, Drizzle)
│   ├── a2a-agent/             Hono server — session broker, delegation minter
│   └── person-mcp/            MCP + HTTP — delegation-gated personal data
├── packages/
│   ├── contracts/             Foundry, Solidity ^0.8.28, ~20 contracts
│   ├── sdk/                   @smart-agent/sdk — viem clients + crypto + naming
│   ├── discovery/             @smart-agent/discovery — GraphDB/SPARQL
│   └── types/                 Shared TypeScript types
└── docs/
    ├── agents/                Role-specific agent guides
    ├── architecture/          This document + peers
    ├── ontology/              T-Box / C-Box / A-Box turtle files
    └── specs/                 Architecture specs and roadmap
```

### 2.3 Contract Suite (layered)

```mermaid
graph TB
    subgraph "L1 · Account"
        AA[AgentAccount]
        AAF[AgentAccountFactory]
    end
    subgraph "L2 · Delegation"
        DM[DelegationManager]
        ICE[ICaveatEnforcer]
        TE[TimestampEnforcer]
        VE[ValueEnforcer]
        ATE[AllowedTargetsEnforcer]
        AME[AllowedMethodsEnforcer]
        MSE[McpToolScopeEnforcer]
        DSE[DataScopeEnforcer]
        NSE[NameScopeEnforcer]
    end
    subgraph "L3 · Governance"
        AC[AgentControl]
    end
    subgraph "L4 · Trust Graph"
        AR[AgentRelationship]
        AAS[AgentAssertion]
        ARR[AgentRelationshipResolver]
        ARQ[AgentRelationshipQuery]
        ART[AgentRelationshipTemplate]
    end
    subgraph "L5 · Validation + Issuance"
        AIP[AgentIssuerProfile]
        AVP[AgentValidationProfile]
    end
    subgraph "L6 · Feedback"
        REV[AgentReviewRecord]
        DIS[AgentDisputeRecord]
    end
    subgraph "L7 · Trust Scoring"
        ATP[AgentTrustProfile]
    end
    subgraph "L8 · Naming (.agent)"
        ANR[AgentNameRegistry]
        ANRv[AgentNameResolver]
        ANUR[AgentNameUniversalResolver]
        AAR[AgentAccountResolver]
    end
    subgraph "Registries"
        OTR[OntologyTermRegistry]
        RTR[RelationshipTypeRegistry]
    end

    AAF -->|deploys proxy| AA
    AA -->|validateUserOp via| DM
    DM -->|beforeHook / afterHook| ICE
    TE & VE & ATE & AME & MSE & DSE & NSE -.->|implement| ICE
    AC -->|governs| AA
    AR --> ART
    AAS --> AR
    ARR --> AR & AAS
    ATP --> AR & REV & DIS
    ANR --> AA
    ANRv --> ANR
    AAR --> AA
```

### 2.4 SDK Public Surface (`@smart-agent/sdk`)

| Module | Exports |
|--------|---------|
| Account | `AgentAccountClient` (deploy, isOwner, encodeExecute, encodeExecuteBatch) |
| Delegation | `DelegationClient` (issueDelegation, redeem, revoke, isRevoked) |
| Caveats | `encodeTimestampTerms`, `encodeValueTerms`, `encodeAllowedTargetsTerms`, `encodeAllowedMethodsTerms`, `buildCaveat`, `buildMcpToolScopeCaveat`, `buildDataScopeCaveat` |
| Session | `createAgentSession`, `isSessionValid` |
| Crypto | `encryptPayload`, `decryptPayload`, `randomHex`, `hmacSign`, `hmacVerify` |
| Challenge auth | `createChallenge`, `hashChallenge`, `isChallengeExpired` |
| Delegation tokens | `mintDelegationToken`, `verifyDelegationToken` |
| Naming | `namehash`, `labelhash`, `normalize`, `resolveName`, `reverseResolve`, `listSubnames`, `getNamePath`, `getNameTree` |
| Relationships | `RelationshipProtocolClient`, taxonomy constants, role constants |
| Identity | `toDidEthr` |

---

## 3. Information Architecture

### 3.1 Three Parallel Data Planes

Smart Agent keeps three coherent, mutually-consistent views of the same data:

```mermaid
flowchart LR
    subgraph OnChain [On-Chain · Source of Truth]
        A1[AgentAccount]
        A2[AgentRelationship edges]
        A3[AgentAssertion claims]
        A4[AgentNameRegistry records]
        A5[DelegationManager revocations]
    end
    subgraph OffChain [Off-Chain · Operational State]
        B1[Web SQLite<br/>users, invites, messages]
        B2[A2A SQLite<br/>sessions, challenges, handles]
        B3[MCP SQLite<br/>profiles, threads, identities,<br/>token_usage]
    end
    subgraph KB [Knowledge Base · Queryable Projection]
        C1[GraphDB / SPARQL<br/>RDF projection of on-chain state]
    end

    OnChain -->|events| KB
    OnChain -->|viem reads| OffChain
    OffChain -. operational cache .-> KB
```

- **On-chain** — the *authoritative* trust graph (edges, assertions, delegations, names, governance).
- **Off-chain SQLite (per service)** — operational state each service owns: sessions, profiles, notifications, invites, token-usage counters.
- **GraphDB** — an ontology-aligned RDF projection used by the web app for rich discovery (`DiscoveryService.listAgents`, `.getAgentDetail`, `.getOutgoingEdges`).

### 3.2 On-Chain Entity–Relationship Model

```mermaid
erDiagram
    AGENT_ACCOUNT ||--o{ RELATIONSHIP_EDGE : "subject of"
    AGENT_ACCOUNT ||--o{ RELATIONSHIP_EDGE : "object of"
    AGENT_ACCOUNT ||--|| AGENT_CONTROL : "governed by"
    AGENT_ACCOUNT ||--o{ DELEGATION : "issues"
    AGENT_ACCOUNT ||--o{ NAME_RECORD : "addressed by"

    RELATIONSHIP_EDGE ||--o{ ASSERTION : "backed by"
    RELATIONSHIP_EDGE }o--|| RELATIONSHIP_TEMPLATE : "typed by"
    RELATIONSHIP_EDGE ||--o{ ROLE : "roles"

    ASSERTION }o--|| ISSUER_PROFILE : "issued by"
    ASSERTION }o--o| VALIDATION_PROFILE : "validated by"

    DELEGATION ||--o{ CAVEAT : "scoped by"
    CAVEAT }o--|| CAVEAT_ENFORCER : "enforced by"

    AGENT_CONTROL ||--o{ OWNER : "tracks"
    AGENT_CONTROL ||--o{ PROPOSAL : "manages"

    AGENT_ACCOUNT ||--o{ REVIEW : "subject of"
    AGENT_ACCOUNT ||--o{ DISPUTE : "subject of"
    AGENT_ACCOUNT ||--|| TRUST_PROFILE : "scored by"

    NAME_RECORD }o--o| NAME_RECORD : "parent namespace"
```

### 3.3 Off-Chain Schemas (highlights)

**apps/web (SQLite)** — user-facing state.

| Table | Key fields |
|-------|-----------|
| `users` | id, privyUserId, email, name, walletAddress, smartAccountAddress |
| `person_agents` | userId, smartAccountAddress, chainId, salt, status |
| `org_agents` | createdBy, smartAccountAddress, status |
| `invites` | code, agentAddress, role, expiresAt, acceptedBy, status |
| `messages` | userId, type, title, body, link, read |

**apps/a2a-agent (SQLite)** — session broker state.

| Table | Key fields |
|-------|-----------|
| `challenges` | id, accountAddress, nonce, typedDataJson, status, expiresAt |
| `sessions` | id, accountAddress, sessionKeyAddress, encryptedPackage, iv, status, expiresAt |
| `handles` | handle, accountAddress, agentType, endpointUrl |

**apps/person-mcp (SQLite)** — personal data vault.

| Table | Key fields |
|-------|-----------|
| `profiles` | principal (unique), displayName, email, phone, dateOfBirth, address fields |
| `externalIdentities` | principal, provider, identifier, verified |
| `chatThreads`, `chatMessages` | principal, threadId, role, content |
| `tokenUsage` | jti (unique), principal, usageCount, usageLimit |

### 3.4 Naming (.agent TLD)

Names are stored as `NAMESPACE_CONTAINS` relationship edges — they are not a
special-case subsystem; they are just another relationship role in the trust
graph.

```mermaid
graph TD
    root[.agent root] -->|NAMESPACE_CONTAINS| tld_catalyst[catalyst.agent]
    tld_catalyst -->|NAMESPACE_CONTAINS| w[wellington.catalyst.agent]
    tld_catalyst -->|NAMESPACE_CONTAINS| h[hamilton.catalyst.agent]
    w -. AgentNameRegistry record .-> accountW[AgentAccount 0xWELL…]
    h -. AgentNameRegistry record .-> accountH[AgentAccount 0xHAM…]
    classDef name fill:#eef,stroke:#557;
    class root,tld_catalyst,w,h name;
```

- Name resolution: `namehash(label)` → `AgentNameRegistry.recordExists()` / resolver lookup.
- Delegatable subtrees are scoped by `NameScopeEnforcer`: an org can delegate
  `*.catalyst.agent` to a sub-agent while retaining root ownership.
- Reverse resolution (`address → primaryName`) via `AgentAccountResolver`.

### 3.5 DOLCE+DnS Mapping

| DOLCE concept | Smart Agent realization |
|---|---|
| Agent | AgentAccount |
| Social Agent | person or org AgentAccount (with `did:ethr`) |
| Description | `relationshipType` (normative type IRI) |
| Situation | `RELATIONSHIP_EDGE` (concrete state realizing a description) |
| Role | `bytes32 role` on an edge |
| Speech Act | `AgentAssertion` |
| Qualification | resolver resolution mode |

---

## 4. Object Interaction Diagrams

The following sequences are the *canonical* service-to-service flows. Each
step is implemented in code and can be traced from the service reports
above.

### 4.1 Deploy a Person Agent (Web → Contracts)

```mermaid
sequenceDiagram
    participant U as User Browser
    participant W as Web Server
    participant P as Privy
    participant F as AgentAccountFactory
    participant A as AgentAccount (deployed)
    participant C as AgentControl
    participant G as GraphDB

    U->>P: OAuth / wallet connect
    P-->>W: session(userId, walletAddress)
    U->>W: POST /deploy/person
    W->>F: createAccount(ownerEOA, salt)
    F->>A: CREATE2 deploy proxy
    F-->>W: smartAccountAddress
    W->>C: initializeAgent(A, minOwners=1, quorum=1)
    W->>W: store person_agents row
    Note over A,G: on-chain event → indexer<br/>UPSERT RDF in GraphDB
    W-->>U: { address, did:ethr }
```

### 4.2 A2A Session Bootstrap (Web → A2A-Agent)

```mermaid
sequenceDiagram
    participant W as Web Server
    participant A as A2A Agent
    participant DB as A2A SQLite
    participant Acc as AgentAccount (on-chain)

    W->>A: POST /session/init
    A->>A: generate sessionKey (priv, pub)
    A->>DB: INSERT sessions (pending, encryptedPackage)
    A-->>W: { sessionId, sessionKeyAddress }

    W->>W: build delegation off-chain<br/>delegator = smartAccount<br/>delegate = sessionKeyAddress<br/>caveat = TimestampEnforcer
    W->>W: sign(delegation) with user's smart-account key
    W->>A: POST /session/package { signedDelegation }
    A->>Acc: isValidSignature(delegationHash, sig)
    Acc-->>A: ERC-1271 magic value
    A->>DB: UPDATE sessions SET status=active,<br/>encryptedPackage=enc(delegation+sessionKey)
    A-->>W: { sessionId (bearer) }
    W-->>W: Set-Cookie a2a-session (httpOnly)
```

### 4.3 Minting a Delegation Token (A2A → caller)

```mermaid
sequenceDiagram
    participant Caller as Web / API Route
    participant A as A2A Agent
    participant DB as A2A SQLite

    Caller->>A: POST /delegation/mint<br/>Authorization: Bearer <sessionId><br/>{ allowedTools, ttl }
    A->>DB: SELECT session WHERE id=? AND status=active
    A->>A: decrypt(encryptedPackage) → { delegation, sessionKey }
    A->>A: sign(tokenEnvelope) with sessionKey
    A-->>Caller: delegationToken (base64url envelope)
```

The minted token is the **only** credential person-mcp accepts. It binds:
nonce (`jti`), subject (`delegator`), session key (`delegate`), caveat set
(timestamp, tool scope, data scope, name scope), and a sessionKey signature.

### 4.4 MCP Tool Call — 9-Layer Delegation Verification

```mermaid
sequenceDiagram
    participant U as User
    participant W as Web
    participant A as A2A Agent
    participant M as Person-MCP
    participant Acc as AgentAccount (on-chain)
    participant DM as DelegationManager
    participant DB as MCP SQLite

    U->>W: GET /api/a2a/profile
    W->>A: GET /profile (Bearer sessionId)
    A->>A: mint delegationToken (tool scope = get_profile)
    A->>M: POST /tools/get_profile { token }

    Note over M: 9-Layer Verify
    M->>M: 1. HMAC integrity
    M->>M: 2. recover sessionKey from sig
    M->>M: 3. delegate == sessionKey
    M->>M: 4. EIP-712 delegation hash
    M->>DM: 5. isRevoked(hash)?
    DM-->>M: false
    M->>Acc: 6. isValidSignature(hash, delegatorSig)
    Acc-->>M: ERC-1271 magic value
    M->>M: 7. caveats pass<br/>(Timestamp, McpToolScope, DataScope)
    M->>DB: 8. INSERT token_usage (jti)<br/>ON CONFLICT check limit
    M->>M: 9. principal = delegation.delegator

    M->>DB: SELECT profile WHERE principal=?
    M-->>A: { profile }
    A-->>W: { profile }
    W-->>U: render
```

Any layer failing returns an opaque `401/403` — no information leak about
which check failed.

### 4.5 Cross-Principal Data Delegation (Owner grants Grantee)

```mermaid
sequenceDiagram
    participant O as Owner (Web)
    participant W as Web Server
    participant Rel as AgentRelationship
    participant M as Person-MCP
    participant G as Grantee (Web)

    O->>W: grant email + phone to Grantee (ttl=30d)
    W->>W: build cross-delegation<br/>delegator = Owner account<br/>delegate = Grantee person-agent<br/>caveats = [Timestamp, DataScope(fields, server)]
    W->>W: sign with Owner smart-account key
    W->>Rel: createEdge(Owner, Grantee, DATA_ACCESS,<br/>metadataURI = delegation envelope)
    Rel-->>W: edgeId

    Note over O,G: Later…
    G->>W: GET /api/a2a/delegated-profile?target=Owner&grantee=Grantee
    W->>A2A Agent: GET /profile/delegated?target&grantee
    A2A Agent->>Rel: read edge(Owner, Grantee, DATA_ACCESS)
    A2A Agent->>A2A Agent: extract signed delegation from metadataURI
    A2A Agent->>M: POST /tools/get_delegated_profile { crossDelegation, grantee session token }
    M->>M: verifyCrossDelegation:<br/>delegate==caller, ERC-1271 on Owner,<br/>DataScope restricts to fields
    M-->>A2A Agent: { email, phone } only (filtered)
    A2A Agent-->>W: filtered profile
    W-->>G: render
```

### 4.6 Agent Discovery via .agent Name

```mermaid
sequenceDiagram
    participant U as User
    participant W as Web
    participant ANR as AgentNameRegistry
    participant Res as AgentNameResolver
    participant GDB as GraphDB

    U->>W: GET /agents/wellington.catalyst.agent
    W->>W: node = namehash("wellington.catalyst.agent")
    W->>ANR: recordExists(node)?
    ANR-->>W: true
    W->>Res: resolve(node) → AgentAccount address
    W->>GDB: SPARQL getAgentDetail(address)
    GDB-->>W: { displayName, agentType, endpoints, trustProfile, edges }
    W-->>U: render agent page
```

### 4.7 Relationship Creation with Multi-Sig Governance

```mermaid
sequenceDiagram
    participant U as User (owner 1 of org)
    participant W as Web
    participant AC as AgentControl
    participant Rel as AgentRelationship
    participant U2 as Co-owner 2

    U->>W: propose edge org → partner (role = PARTNER)
    alt quorum = 1 (or single-owner)
        W->>Rel: createEdge(...) PROPOSED
        W->>Rel: setEdgeStatus(CONFIRMED)
        W-->>U: confirmed
    else quorum > 1
        W->>AC: propose(action=createEdge, data)
        AC-->>W: proposalId
        W->>U2: notify: approval needed
        U2->>W: approve(proposalId)
        W->>AC: approve(proposalId)
        AC->>AC: approvals >= quorum?
        AC->>Rel: executeProposal → createEdge
        AC-->>W: executed
        W-->>U: confirmed
    end
```

### 4.8 Trust Resolution

```mermaid
flowchart TD
    Q[Trust Query:<br/>does A trust B for context X?] --> E1
    E1[AgentRelationship<br/>edges between A and B] --> A1
    A1[AgentAssertion<br/>backing claims] --> V1
    V1[AgentValidationProfile<br/>TEE / ZK evidence] --> R1
    R1[AgentReviewRecord] --> D1
    D1[AgentDisputeRecord] --> S
    S[AgentTrustProfile.score] --> T{score &gt;= threshold?}
    T -->|yes| OK[Trusted ✓]
    T -->|no| NO[Not trusted ✗]
```

### 4.9 AnonCreds for a Person ↔ Org Relationship

This is a **conceptual extension** showing how an anoncreds credential could be
issued from an existing person-to-organization relationship edge, then later
proven without revealing the full relationship record.

```mermaid
sequenceDiagram
    participant P as Person
    participant H as Holder Wallet / Agent
    participant O as Org Agent
    participant Rel as AgentRelationship
    participant I as Org Issuer Service
    participant Reg as AnonCreds Schema + Cred Def + Revocation Registry
    participant V as Verifier / Relying Org

    P->>O: Request credential for org relationship
    O->>Rel: readEdge(person, org, relationshipType, role)
    Rel-->>O: confirmed relationship + metadata

    O->>I: authorize issuance from relationship edge
    I->>Reg: create / load schema, cred def, revocation state
    I-->>H: credential offer
    H-->>I: blinded credential request

    I->>I: bind claims to relationship context<br/>personAgent, orgAgent, role, status, validUntil
    I-->>H: anoncreds credential
    H->>H: store credential + revocation witness

    Note over P,V: Later, the person proves org affiliation

    V-->>H: proof request<br/>needs org affiliation / role / freshness
    H->>Reg: fetch latest revocation data
    H-->>V: zero-knowledge presentation

    V->>Reg: verify cred def + revocation state
    V->>O: optional policy check<br/>issuer trusted? role acceptable?
    O-->>V: yes / no
    V-->>P: access granted / denied
```

Typical claim set in the credential:

- `subjectAgent` — the person agent DID / account
- `orgAgent` — the organization agent DID / account
- `relationshipType` — e.g. membership, employment, governance
- `role` — e.g. member, employee, admin, officer
- `status` — active, suspended, pending
- `validUntil` or epoch-bound freshness marker
- optional `edgeId` or relationship reference as a non-disclosed linkage field

The important separation is:

- `AgentRelationship` remains the authoritative relationship graph
- anoncreds package a privacy-preserving proof of that relationship
- verifiers check the proof without needing the full edge record disclosed

---

## 5. Security Overview

### 5.1 Trust Boundaries

```mermaid
graph TB
    subgraph "Zone A · User Browser (untrusted)"
        Br[UI + Privy SDK]
        Wal[User's Wallet]
    end
    subgraph "Zone B · App Server (semi-trusted)"
        WS[Next.js Server]
    end
    subgraph "Zone C · Protocol Services (least-privileged)"
        A2A[A2A Agent]
        MCP[Person MCP]
    end
    subgraph "Zone D · Public Ledger (trustless + verifiable)"
        Chain[Ethereum / Anvil / Sepolia]
    end
    subgraph "Zone E · Knowledge Base (read-mostly)"
        G[GraphDB]
    end

    Br -- HTTPS + EIP-712 sigs --> WS
    WS -- signed delegation --> A2A
    A2A -- delegation token --> MCP
    WS -- viem reads/writes --> Chain
    A2A -- ERC-1271 reads --> Chain
    MCP -- ERC-1271 + isRevoked --> Chain
    Chain -- event projection --> G
    WS -- SPARQL read --> G
```

Every zone-crossing request must carry a credential verifiable without
trusting the preceding zone.

### 5.2 Authentication Stack

| Boundary | Mechanism | What it proves |
|---|---|---|
| User → Web | Privy OAuth / email | controller of an EOA + app identity |
| Wallet → AgentAccount | EIP-712 signature verified via ERC-1271 | controller of the smart account |
| Web → A2A (bootstrap) | Signed delegation packaged via `/session/package` | delegator authorized the session key |
| Caller → A2A (ongoing) | Bearer sessionId cookie/header | holder of the server-issued session handle |
| A2A → Person-MCP | Delegation token (9-layer verify) | minted by the *actual* session key, for *this* tool, *now*, subject not revoked |
| Grantee → Person-MCP (cross-principal) | Cross-delegation from data owner + grantee's own session token | owner authorized grantee for *these fields* |

### 5.3 Authorization Stack (Caveat Enforcement)

Authorization is *composable*. Each delegation carries an ordered caveat set,
and each caveat has an on-chain enforcer. The same enforcer can be invoked
by on-chain `redeemDelegation` or off-chain in the MCP 9-layer verifier.

| Enforcer | Guards |
|---|---|
| TimestampEnforcer | `validAfter` / `validUntil` — session lifetime |
| ValueEnforcer | Max ETH value per call |
| AllowedTargetsEnforcer | Whitelist of contract addresses callable |
| AllowedMethodsEnforcer | Whitelist of function selectors callable |
| McpToolScopeEnforcer | Which MCP tools the delegation may invoke |
| DataScopeEnforcer | Which fields/resources of which server are readable (cross-principal) |
| NameScopeEnforcer | Which subtree of the `.agent` namespace may be administered |

### 5.4 Delegation Lifecycle & Revocation

```mermaid
stateDiagram-v2
    [*] --> Issued: signed by delegator
    Issued --> Active: passes all caveats
    Active --> Expired: Timestamp.validUntil reached
    Active --> Revoked: DelegationManager.revoke()
    Active --> UsedUp: token_usage.jti hit limit
    Revoked --> [*]
    Expired --> [*]
    UsedUp --> [*]
```

Three independent kill-switches:

1. **On-chain revocation** — `DelegationManager.revoke(hash)` is consulted
   at every MCP call. A single tx revokes a token across every verifier.
2. **Session revocation** — `DELETE /session/:id` on a2a-agent invalidates
   the session key; no more tokens can be minted.
3. **Owner-level emergency** — `AgentControl` emergency actions pause the
   agent account; downstream ERC-1271 verifications fail.

### 5.5 Key Management

| Key | Location | Rotation | Blast radius if leaked |
|---|---|---|---|
| User EOA | user's wallet (Privy custodial or self-custody) | user-driven | full account control (unless multi-sig org) |
| Smart-account "raw" private key (bootstrap) | Web server DB, encrypted column | rotate via AgentControl `addOwner`/`removeOwner` | same as above — considered a sensitive secret |
| Session key | A2A Agent DB, encrypted with `A2A_SESSION_SECRET` | TTL-capped (e.g. 24h), one-tap revoke | bounded by caveats; cannot exceed delegator authority |
| Delegation token `jti` | client-held, short-lived | single use or usage-limited | bounded by caveats + jti counter |
| Privy `PRIVY_APP_SECRET` | Web server env | vendor-managed | impersonation of web server to Privy |
| Deployer key | Web server env (`DEPLOYER_PRIVATE_KEY`) | manual | contract writes only; not authority over agents |
| `A2A_SESSION_SECRET` | A2A env only | manual; invalidates existing sessions | decrypt stored session packages |

Session packages in the A2A DB are **encrypted at rest** with
`A2A_SESSION_SECRET`; the session private key never leaves the A2A
process in cleartext and is never exposed to the Web server.

### 5.6 Anti-Replay & Usage Metering

- **Challenge nonces** (A2A `/auth/challenge`): per-account, one-use, TTL-bound.
- **JTI tracking** in person-mcp (`token_usage` table, atomic
  `INSERT … ON CONFLICT UPDATE`) — the same delegation token cannot be
  replayed past its declared usage limit, even under concurrent callers.
- **HMAC envelope integrity** prevents token tampering before the ECDSA
  signature is recovered (fast-fail).
- **EIP-712 domain separation** (`DelegationManager` domain) prevents a
  signature valid for one chain/contract from being replayed on another.

### 5.7 Data Protection

- **Personal data** (profiles, identities, chat threads) lives only in
  `person-mcp`. The web server never stores it. Even a full compromise of
  the web DB exposes no PII.
- **Cross-principal reads** return *field-filtered* responses — the MCP
  server applies `DataScopeEnforcer` grants as a hard projection, not a
  client-side filter.
- **No private keys in `NEXT_PUBLIC_*`** — enforced by convention and
  review; only PUBLIC configuration (chain id, factory address) is client-
  visible.
- **HttpOnly session cookie** (`a2a-session`) for the Web↔A2A bridge —
  not readable by page JS, reducing XSS blast radius.

### 5.8 Threat Model Summary

| Threat | Mitigation |
|---|---|
| Stolen session cookie | ERC-1271-checked delegation still needed; caveats limit scope; revoke via `/session/:id` |
| Stolen delegation token | `jti` usage cap + on-chain `isRevoked` + TTL; scoped by tool/data/name enforcer |
| Compromised Web server | Cannot mint new delegations without user re-signing (key never leaves A2A); PII untouched |
| Compromised A2A server | Cannot forge user signatures; all tokens are bounded by already-signed delegations; rotate `A2A_SESSION_SECRET` and revoke on-chain to cut over |
| Compromised Person-MCP | Reveals PII for that principal *only* — no authority over agents or funds |
| Replay across chains | EIP-712 domain separator includes `chainId`; wrong chain → signature invalid |
| Malicious agent impersonation | Names resolve via on-chain `AgentNameRegistry`; owner gated by `AgentAccount.isOwner` |
| Relationship forgery | Edges signed by creator; counter-party confirmation required before ACTIVE; multi-sig via `AgentControl` for org agents |

### 5.9 Observability & Audit

- **On-chain events** — every edge, assertion, delegation, revocation, and
  governance action emits an event. The GraphDB projection doubles as an
  audit log queryable by SPARQL.
- **Structured SQLite rows** — `challenges`, `sessions`, `token_usage`
  give per-principal forensic trails.
- **Trust profile** — `AgentTrustProfile` aggregates reviews and disputes;
  repeated violations depress an agent's score and flow into policy
  decisions.

---

## 6. Where to Read Next

- Concrete contract API: [contracts.md](./contracts.md)
- Deployment & environment: [system-architecture.md](./system-architecture.md)
- Governance proposal flow: [agent-control.md](./agent-control.md)
- Relationship lifecycle (propose → confirm → active → revoke): [relationship-protocol.md](./relationship-protocol.md)
- Roadmap: [../specs/roadmap.md](../specs/roadmap.md)
