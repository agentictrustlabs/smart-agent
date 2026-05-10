# 15 - Delegation Design Architecture

## Purpose

This document defines the forward architecture for Smart Agent delegation.

The architecture is:

```text
one user-rooted delegation fabric
one policy registry for all MCP tools
stateless session delegation for routine work
per-call sub-delegation for sensitive work
ERC-7579-compatible Session AgentAccounts for stateful work
ERC-7715-shaped permission UX for user consent
```

The goal is not to deploy a modular smart account for every session. The goal
is to make every action traceable from user approval to session/task to MCP tool
to on-chain transaction.

## Core Decision

Smart Agent adopts a native, standards-shaped hybrid delegation model.

| Layer | Role |
| --- | --- |
| User `AgentAccount` | Root authority and ERC-1271 signer |
| A2A session principal | Short-lived session authority approved by the user |
| `DelegationManager` | Universal authority validator and redemption path |
| Policy registry | Maps each MCP tool to its allowed execution path |
| MCP tools | Coordinators and data owners, not broad authority holders |
| Tool executors | Leaf authority for sensitive task-bound actions |
| Session AgentAccounts | Stateful long-lived agents when budgets/policy state are required |

The delegation fabric aligns to:

```text
ERC-7710-style delegation chains
ERC-7579-style modular account boundaries
ERC-7715-style permission requests
ERC-4337-compatible smart-account execution
```

Draft ERCs are compatibility targets. Smart Agent keeps its typed-data schemas,
policy engine, caveats, modules, and MCP execution model first-party.

## System Architecture

```mermaid
flowchart TD
    User["User"]
    Consent["Permission Request<br/>ERC-7715-shaped consent"]
    UserAccount["User AgentAccount<br/>ERC-1271 root authority"]
    RootGrant["Root Delegation<br/>D_root"]
    Policy["Tool Policy Registry"]

    A2A["A2A Agent"]
    SessionEOA["Session EOA<br/>stateless default"]
    SessionAA["Session AgentAccount<br/>ERC-7579-compatible"]
    ToolExecutor["Tool Executor<br/>leaf delegate"]

    MCP["MCP Tool"]
    DM["DelegationManager"]
    ChainTarget["On-chain Target<br/>registries, resolvers, treasury"]
    MCPStore["MCP Private Store"]
    GraphDB["GraphDB<br/>public mirror"]

    User --> Consent
    Consent --> UserAccount
    UserAccount --> RootGrant
    RootGrant --> Policy

    Policy --> SessionEOA
    Policy --> SessionAA
    Policy --> ToolExecutor

    SessionEOA --> A2A
    SessionAA --> A2A
    A2A --> MCP
    MCP --> MCPStore
    MCP --> A2A
    A2A --> DM
    ToolExecutor --> DM
    SessionAA --> DM
    DM --> ChainTarget
    ChainTarget --> GraphDB
```

## User Consent and Session Grant

A user signs one session grant for a bounded set of capabilities. The consent
screen should be shaped like ERC-7715 even if the implementation uses Smart
Agent's native delegation schema.

```mermaid
sequenceDiagram
    actor User
    participant Web as Web App
    participant Passkey as Passkey / Wallet
    participant Account as User AgentAccount
    participant A2A as A2A Agent
    participant Policy as Policy Registry

    User->>Web: Start session
    Web->>Policy: Build requested tool policy set
    Web->>User: Show permission request
    User->>Passkey: Approve with passkey or wallet signature
    Passkey-->>Web: Signature over delegation hash
    Web->>A2A: Package signed root delegation
    A2A->>Account: Verify via ERC-1271
    Account-->>A2A: valid signature
    A2A-->>Web: Session ready
```

Session grants can include:

```text
validAfter / validUntil
allowed MCP tools
allowed targets
allowed function selectors
value caps
rate limits
data scopes
required confirmation flags
```

## Multi-MCP Session Lifecycle

One user-approved session can support many MCP tools across many MCP servers.
The session grant is not a bearer token. It is a signed delegation from the
user's `AgentAccount` to a session principal, with caveats that limit which
tools, targets, selectors, chains, values, and time windows are allowed.

```mermaid
sequenceDiagram
    actor User
    participant Web as Web App
    participant A2A as A2A Agent
    participant Account as User AgentAccount
    participant Person as person-mcp
    participant Org as org-mcp
    participant Group as people-group-mcp

    User->>Web: Start agent session
    Web->>A2A: POST /session/init(accountAddress)
    A2A->>A2A: Generate session EOA
    A2A-->>Web: sessionId + sessionKeyAddress
    Web->>User: Permission request for tool bundle
    User->>Web: Sign D_root to sessionKeyAddress
    Web->>A2A: POST /session/package(sessionId, D_root)
    A2A->>Account: isValidSignature(hash(D_root), signature)
    Account-->>A2A: ERC-1271 valid
    A2A->>A2A: Store encrypted session package

    Web->>A2A: /mcp/person/intent:create
    A2A->>Person: MCP token signed by session EOA
    Web->>A2A: /mcp/org/pool:create
    A2A->>Org: MCP token signed by session EOA
    Web->>A2A: /mcp/people-group/list_groups
    A2A->>Group: MCP token signed by session EOA
```

The A2A session package stores:

```text
sessionPrivateKey
sessionKeyAddress
D_root delegation
user AgentAccount address
expiresAt
optional Session AgentAccount address
optional installed module/policy summary
```

The same `D_root` supports multiple MCP tools because the user's signature
covers a policy bundle, not a single HTTP request. A2A mints a fresh MCP token
for each tool call. Each token has its own audience, `jti`, expiry, usage
limit, and tool request context, but it points back to the same root delegation.

## A2A Call Routing

A2A is the policy-aware router for all MCP calls. Web actions call A2A, not MCP
servers directly. A2A loads the active session package, looks up the tool
policy, and routes the call.

```mermaid
flowchart TD
    Web["Web Action"]
    A2A["A2A Agent"]
    Policy["ToolPolicy Registry"]
    Package["Encrypted Session Package"]
    McpOnly["mcp-only<br/>mint MCP token"]
    Redeem["stateless-redeem<br/>MCP calls A2A redeem-tx"]
    Sub["sub-delegated<br/>mint D_sub"]
    SessionAA["session-account<br/>route via Session AgentAccount"]
    MCP["MCP Server"]
    DM["DelegationManager"]
    Target["On-chain Target"]

    Web --> A2A
    A2A --> Package
    A2A --> Policy
    Policy --> McpOnly
    Policy --> Redeem
    Policy --> Sub
    Policy --> SessionAA

    McpOnly --> MCP
    Redeem --> MCP
    MCP -->|"redeem-tx with mcpTool + callData"| A2A
    A2A --> DM
    Sub --> DM
    SessionAA --> DM
    DM --> Target
```

Routing behavior:

| Execution path | A2A behavior | MCP behavior |
| --- | --- | --- |
| `mcp-only` | Mints an MCP token signed by the session EOA | Verifies token and reads/writes private MCP data |
| `stateless-redeem` | Mints MCP token and exposes `redeem-tx` for the session | Builds call data and asks A2A to redeem `D_root` |
| `sub-delegated` | Creates a per-call `D_sub` bound to task, tool, target, selector, calldata hash, nonce, and expiry | Tool executor redeems `[D_sub, D_root]` |
| `session-account` | Creates or loads a Session AgentAccount and routes execution through installed modules | Coordinates tool context and records results |

MCP servers verify:

```text
token audience
session EOA signature
D_root delegator and delegate
ERC-1271 root signature
expiration
tool scope
revocation status
data scope
```

## Session EOA vs Session AgentAccount

Every session starts with a session EOA because it is cheap, fast, and enough
for most MCP work. A Session AgentAccount is created only when the requested
policy bundle needs persistent state.

```mermaid
flowchart TD
    Start["Session Request"]
    Policy["Requested Tool Policies"]
    EOA["Create Session EOA"]
    NeedState{"Needs persistent policy state?"}
    StoreEOA["Store encrypted EOA session package"]
    DeployAA["Deploy Session AgentAccount<br/>CREATE2"]
    Install["Install first-party modules"]
    StoreAA["Store account address + module policy"]
    Ready["Session Ready"]

    Start --> Policy
    Policy --> EOA
    EOA --> NeedState
    NeedState -->|"no"| StoreEOA
    NeedState -->|"yes"| DeployAA
    DeployAA --> Install
    Install --> StoreAA
    StoreEOA --> Ready
    StoreAA --> Ready
```

Create a Session AgentAccount when the session includes:

```text
durable spend caps
multi-call budgets
treasury movement
long-lived autonomy
runtime policy changes
multi-validator approval
persistent rate limits
stateful revocation hooks
```

Session AgentAccount creation flow:

```mermaid
sequenceDiagram
    actor User
    participant Web as Web App
    participant A2A as A2A Agent
    participant Factory as AgentAccountFactory
    participant SessionAA as Session AgentAccount
    participant Account as User AgentAccount
    participant DM as DelegationManager

    User->>Web: Approve stateful session
    Web->>A2A: session package with stateful policies
    A2A->>Factory: createAccount(owner = user AgentAccount, salt)
    Factory-->>A2A: Session AgentAccount address
    A2A->>SessionAA: install first-party modules
    A2A->>A2A: Store Session AgentAccount in session package
    User->>Web: Sign D_root to Session AgentAccount or session EOA
    Web->>A2A: package signed delegation
    A2A->>Account: ERC-1271 verify D_root
    Account-->>A2A: valid
    A2A->>DM: Future executions use D_root + account modules
```

The Session AgentAccount is the active execution principal for stateful paths.
The session EOA still exists as an operational signer for A2A token minting and
module-authorized requests, but the stateful hooks on the Session AgentAccount
enforce budget, rate, recipient, target, and revocation policy.

## Execution Path Selection

Every tool is classified by policy before it runs.

```mermaid
flowchart TD
    Tool["MCP Tool Request"]
    Policy["Tool Policy Registry"]
    Low["Stateless Session EOA"]
    High["Per-call Sub-Delegation"]
    Stateful["Session AgentAccount"]
    Private["MCP Private Store"]
    Chain["DelegationManager -> Chain"]

    Tool --> Policy
    Policy -->|"low risk"| Low
    Policy -->|"high risk"| High
    Policy -->|"stateful / long-lived"| Stateful

    Low --> Private
    Low --> Chain
    High --> Chain
    Stateful --> Chain
```

| Risk tier | Default path | Examples |
| --- | --- | --- |
| Low | Stateless session EOA | list intents, express private intent, read profile, draft proposal |
| Medium | Stateless redeem with caveats | create pool, open round, rotate stewards, publish public intent |
| High | Per-call sub-delegation | set awards root, close pool, cancel round, mark paid |
| Critical | Session AgentAccount or per-call sub-delegation plus confirmation | treasury transfer, custody change, large disbursement |

## Tool Policy Shape

Every MCP tool should have a policy record.

```text
ToolPolicy {
  toolId
  riskTier
  executionPath
  allowedTargets
  allowedSelectors
  maxValue
  requiresTaskBinding
  requiresCalldataHash
  requiresHumanConfirmation
  allowedChains
}
```

This registry is the guardrail that prevents each MCP from inventing a
different authority path.

## Scenario 1 - Private MCP Data

Use for private profile, detached members, revenue reports, notes, messages,
beliefs, activities, and other private data.

```mermaid
sequenceDiagram
    actor User
    participant Web as Web App
    participant A2A as A2A Agent
    participant MCP as person-mcp / org-mcp
    participant Store as MCP Private Store

    User->>Web: Submit private-data action
    Web->>A2A: MCP request with session cookie
    A2A->>A2A: Mint MCP token signed by session EOA
    A2A->>MCP: Forward tool args + MCP token
    MCP->>MCP: Verify session signature, ERC-1271 root, time, tool scope
    MCP->>Store: Read/write private row
    Store-->>MCP: Result
    MCP-->>A2A: Tool result
    A2A-->>Web: Result
```

Examples:

```text
list_detached_members
add_detached_member
submit_revenue_report
list_revenue_reports
list_beliefs
log_activity
```

No on-chain transaction is needed unless the tool intentionally publishes a
public assertion.

## Scenario 2 - Express Intent

Private and public intents share the same session grant. Visibility determines
whether an on-chain public assertion is emitted.

```mermaid
sequenceDiagram
    actor User
    participant Web as Web App
    participant A2A as A2A Agent
    participant MCP as person-mcp / org-mcp
    participant Store as MCP Intent Tables
    participant DM as DelegationManager
    participant Assertion as ClassAssertion / Public Assertion Contract
    participant GraphDB as GraphDB

    User->>Web: Express intent
    Web->>A2A: express_intent
    A2A->>MCP: Tool call with scoped MCP token
    MCP->>MCP: Verify session and tool scope
    MCP->>Store: Store intent body
    alt private or off-chain
        MCP-->>A2A: Return private intent
    else public or public-coarse
        MCP->>A2A: Request on-chain public assertion
        A2A->>DM: redeem D_root for assertion call
        DM->>Assertion: publish public/coarse assertion
        Assertion-->>GraphDB: Mirrored by sync
        MCP-->>A2A: Return intent + assertion id
    end
    A2A-->>Web: Render result
```

Policy:

| Tool | Risk | Path |
| --- | --- | --- |
| `express_intent` private | Low | MCP token only |
| `express_intent` public | Medium | MCP token + stateless on-chain redeem |
| `withdraw_intent` with public assertion | Medium | stateless on-chain revoke/update |
| `intent:bump_ack_count` | Low/medium | MCP token with system scope |

## Scenario 3 - Pool Pledge

Pool pledges are donor-owned private rows. Public signaling depends on
`storyPermissions`.

```mermaid
sequenceDiagram
    actor Donor
    participant Web as Web App
    participant Discovery as Discovery / GraphDB
    participant A2A as A2A Agent
    participant DonorMCP as person-mcp or org-mcp
    participant Store as pool_pledges
    participant DM as DelegationManager
    participant Assertion as Public Pledge Assertion

    Donor->>Web: Submit pledge
    Web->>Discovery: Read pool body and validate restrictions
    Discovery-->>Web: Pool detail
    Web->>A2A: pool_pledge:submit
    A2A->>DonorMCP: Tool call with scoped MCP token
    DonorMCP->>DonorMCP: Verify session and tool scope
    DonorMCP->>Store: Store pledge row
    alt non-anonymous
        DonorMCP->>Store: Record pool:read_pledge grant
    end
    alt public or public-coarse
        DonorMCP->>A2A: Request public/coarse pledge assertion
        A2A->>DM: redeem D_root for assertion call
        DM->>Assertion: Publish bounded public signal
    end
    DonorMCP-->>A2A: Pledge result
    A2A-->>Web: Render pledge
```

Policy:

| Tool | Risk | Path |
| --- | --- | --- |
| `pool_pledge:submit` anonymous/private | Low | MCP token only |
| `pool_pledge:submit` public/coarse | Medium | MCP token + stateless on-chain assertion |
| `pool_pledge:amend` | Low/medium | MCP token, assertion update if public |
| `pool_pledge:stop` | Low/medium | MCP token, assertion update if public |

Anonymous pledge identity must never be published on-chain or into GraphDB.

## Scenario 4 - Grant Proposal Submission

Grant proposals are private at submission time. Stewards read them through
cross-delegation, not GraphDB.

```mermaid
sequenceDiagram
    actor Proposer
    participant Web as Web App
    participant A2A as A2A Agent
    participant MCP as person-mcp / org-mcp
    participant Store as proposal_submissions
    participant Grant as Cross-Delegation Grants
    participant Steward as Steward MCP Session

    Proposer->>Web: Submit grant proposal
    Web->>A2A: grant_proposal:submit
    A2A->>MCP: Tool call with scoped MCP token
    MCP->>MCP: Verify session and tool scope
    MCP->>Store: Store private proposal body
    MCP->>Grant: Record proposal:read_for_review grant
    MCP-->>A2A: Proposal submitted
    A2A-->>Web: Render submitted state

    Steward->>MCP: Read proposal with cross-delegation
    MCP->>Grant: Verify review grant
    MCP->>Store: Return proposal body
```

Policy:

| Tool | Risk | Path |
| --- | --- | --- |
| `grant_proposal:draft` | Low | MCP token only |
| `grant_proposal:submit` | Low/medium | MCP token + cross-delegation grant |
| `grant_proposal:withdraw` | Low/medium | MCP token |
| `grant_proposal:award` | High | per-call sub-delegation when paired with award root or public facet |

The proposal body stays private. Public award outcomes use a separate public
facet or assertion.

## Scenario 5 - Create Pool

Pool creation is a medium-risk on-chain action. The pool body is public,
on-chain, and mirrored to GraphDB.

```mermaid
sequenceDiagram
    actor Steward
    participant Web as Web App
    participant A2A as A2A Agent
    participant OrgMCP as org-mcp
    participant Factory as AgentAccountFactory
    participant DM as DelegationManager
    participant PoolReg as PoolRegistry
    participant GraphDB as GraphDB

    Steward->>Web: Submit create-pool form
    Web->>A2A: pool:create
    A2A->>OrgMCP: Tool call with scoped MCP token
    OrgMCP->>OrgMCP: Build pool OpenParams and mandate hash
    OrgMCP->>A2A: deploy-agent request
    A2A->>Factory: createAccount(owner = user AgentAccount, salt)
    Factory-->>A2A: pool AgentAccount
    OrgMCP->>A2A: redeem-tx request for PoolRegistry.open
    A2A->>DM: redeem D_root
    DM->>PoolReg: open(OpenParams)
    PoolReg-->>GraphDB: Mirrored by sync
    OrgMCP-->>A2A: poolAgentId + txHash
    A2A-->>Web: Render pool
```

Policy:

| Tool | Risk | Path |
| --- | --- | --- |
| `pool:create` | Medium | stateless redeem with target/method caveats |
| `pool:update_mandate` | Medium | stateless redeem |
| `pool:rotate_stewards` | Medium/high | stateless or sub-delegated based on value/risk |
| `pool:close` | High | per-call sub-delegation |

## Scenario 6 - Open Round and Decide Awards

Opening a round is routine fund administration. Setting awards is high-risk
because it determines recipients and downstream disbursement authority.

```mermaid
sequenceDiagram
    actor Steward
    participant Web as Web App
    participant A2A as A2A Agent
    participant OrgMCP as org-mcp
    participant DM as DelegationManager
    participant FundReg as FundRegistry
    participant Executor as Award Tool Executor

    Steward->>Web: Open round
    Web->>A2A: round:open
    A2A->>OrgMCP: Scoped MCP token
    OrgMCP->>A2A: redeem-tx FundRegistry.openRound
    A2A->>DM: redeem D_root
    DM->>FundReg: openRound

    Steward->>Web: Decide awards
    Web->>A2A: round:set_awards_root
    A2A->>A2A: Create D_sub bound to awardsRoot + calldataHash
    A2A->>Executor: Send D_sub + D_root
    Executor->>DM: redeem [D_sub, D_root]
    DM->>FundReg: setRoundAwardsRoot
```

Policy:

| Tool | Risk | Path |
| --- | --- | --- |
| `round:open` | Medium | stateless redeem |
| `round:set_status` | Medium/high | stateless or sub-delegated by status |
| `round:cancel` | High | per-call sub-delegation |
| `round:set_awards_root` | High | per-call sub-delegation |
| `round:update_voting_config` | Low | MCP token only |

## Scenario 7 - Disbursement and Treasury Movement

Disbursement records can start as private/off-chain coordination. Real asset
movement is critical and requires stronger authority.

```mermaid
sequenceDiagram
    actor Steward
    participant Web as Web App
    participant A2A as A2A Agent
    participant OrgMCP as org-mcp
    participant Store as disbursements
    participant SessionAA as Session AgentAccount
    participant Hook as SpendCap / RateLimit Hook
    participant Treasury as Treasury / Token Contract

    Steward->>Web: Record disbursement tranche
    Web->>A2A: disbursement:record
    A2A->>OrgMCP: Scoped MCP token
    OrgMCP->>Store: Store pending tranche

    Steward->>Web: Execute payment
    Web->>A2A: disbursement:execute
    A2A->>SessionAA: UserOp / delegated execution
    SessionAA->>Hook: Check spend cap, recipient, tranche, nonce
    Hook-->>SessionAA: approved
    SessionAA->>Treasury: transfer / disburse
    Treasury-->>Store: txHash recorded by MCP callback
```

Policy:

| Tool | Risk | Path |
| --- | --- | --- |
| `disbursement:record` | Medium | MCP token only |
| `disbursement:claim` | High | per-call sub-delegation |
| `disbursement:mark_paid` | High | per-call sub-delegation |
| real token transfer | Critical | Session AgentAccount with stateful hooks |
| `attestation:cast` | Medium | MCP token + public assertion if needed |

## Scenario 8 - Organization Membership and Detached Members

On-chain memberships are public trust relationships. Detached members are
private org records.

```mermaid
flowchart TD
    Web["Web App"]
    A2A["A2A Agent"]
    OrgMCP["org-mcp"]
    PrivateStore["detached_members"]
    Relationship["AgentRelationship"]
    GraphDB["GraphDB"]

    Web --> A2A
    A2A --> OrgMCP
    OrgMCP -->|"detached member"| PrivateStore
    A2A -->|"public membership edge"| Relationship
    Relationship --> GraphDB
```

Policy:

| Tool/action | Risk | Path |
| --- | --- | --- |
| `list_detached_members` | Low | MCP token only |
| `add_detached_member` | Low/medium | MCP token only |
| public org membership edge | Medium | stateless redeem |
| governance-role membership | High | per-call sub-delegation |

## Scenario 9 - Public Graph Projection

GraphDB is a read model. It mirrors public on-chain facts; it does not receive
private MCP rows directly.

```mermaid
flowchart LR
    MCP["MCP private row"]
    A2A["A2A redeem"]
    Chain["On-chain assertion / registry"]
    Sync["GraphDB sync"]
    GraphDB["GraphDB public graph"]

    MCP -->|"public/coarse only"| A2A
    A2A --> Chain
    Chain --> Sync
    Sync --> GraphDB
```

Rules:

```text
private rows stay in MCP
public/coarse signals anchor on-chain first
GraphDB mirrors chain only
anonymous identities never anchor
```

## ERC-7579 Session AgentAccounts

Use ERC-7579-compatible Session AgentAccounts for sessions that need state.

```mermaid
classDiagram
    class SessionAgentAccount {
      installModule()
      uninstallModule()
      execute()
      accountId()
    }

    class ValidatorModule {
      validate signature
      validate signer policy
    }

    class ExecutorModule {
      route tool execution
      enforce target family
    }

    class HookModule {
      preCheck()
      postCheck()
      persistent state
    }

    SessionAgentAccount --> ValidatorModule
    SessionAgentAccount --> ExecutorModule
    SessionAgentAccount --> HookModule
```

First-party modules:

```text
ECDSASessionValidator
ToolExecutorModule
SpendCapHook
RateLimitHook
TargetSelectorAllowlistHook
TaskBindingHook
SessionExpiryModule
RevocationModule
```

Third-party modules require registry/attestation approval before installation.

## Design Invariants

- User `AgentAccount` is the root of authority.
- One permission grant can authorize multiple scoped MCP tool calls.
- MCP tools coordinate execution but do not hold broad authority.
- Routine flows use stateless session EOA delegation.
- Sensitive flows use per-call task-bound sub-delegations.
- Stateful flows use ERC-7579-compatible Session AgentAccounts.
- Public graph writes anchor on-chain before GraphDB.
- Private MCP rows never write directly to GraphDB.
- Anonymous donor identity never anchors on-chain.
- Every on-chain action has a trace from user grant to task/tool to transaction.

## Implementation Phases

### Phase 1 - Unified Session Delegation

Use the session EOA as the default authority for MCP tools and routine on-chain
redeems.

Deliverables:

```text
policy registry for all MCP tools
A2A redeem endpoint for stateless on-chain calls
MCP tools request redeems from A2A rather than holding broad authority
execution audit rows for each redeem
```

### Phase 2 - Per-Call Sub-Delegations

Promote sensitive tools to task-bound leaf delegations.

Deliverables:

```text
TaskBindingEnforcer
single-use nonce tracking
calldata hash binding
tool executor identities
[D_sub, D_root] redemption path
```

### Phase 3 - Session AgentAccounts

Add ERC-7579-compatible Session AgentAccounts for long-lived, budgeted, or
treasury-capable sessions.

Deliverables:

```text
module lifecycle
first-party validators, executors, hooks
stateful spend and rate policy
runtime policy updates
```

### Phase 4 - Wallet Permission Interop

Shape consent around ERC-7715-style permission requests.

Deliverables:

```text
permission request schema
wallet/passkey adapter
human-readable consent screens
attenuation controls
```

## Implementation Anchors

| Area | File |
| --- | --- |
| A2A session bootstrap | `apps/a2a-agent/src/routes/session.ts` |
| A2A MCP proxy | `apps/a2a-agent/src/routes/mcp-proxy.ts` |
| A2A on-chain redeem path | `apps/a2a-agent/src/routes/onchain-redeem.ts` |
| MCP token minting | `packages/sdk/src/delegation-token.ts` |
| Tool policy registry | `packages/sdk/src/policy/tool-policies.ts` |
| person-mcp auth verification | `apps/person-mcp/src/auth/verify-delegation.ts` |
| org-mcp auth verification | `apps/org-mcp/src/auth/verify-delegation.ts` |
| Intent tools | `apps/person-mcp/src/tools/intents.ts`, `apps/org-mcp/src/tools/intents.ts` |
| Pledge tools | `apps/person-mcp/src/tools/poolPledges.ts`, `apps/org-mcp/src/tools/poolPledges.ts` |
| Grant proposal tools | `apps/person-mcp/src/tools/grantProposals.ts`, `apps/org-mcp/src/tools/grantProposals.ts` |
| Pool tools | `apps/org-mcp/src/tools/pools.ts` |
| Round tools | `apps/org-mcp/src/tools/rounds.ts` |
| Disbursement tools | `apps/org-mcp/src/tools/disbursements.ts` |
| Delegation manager contract | `packages/contracts/src/DelegationManager.sol` |
| Agent account contract | `packages/contracts/src/AgentAccount.sol` |
| Caveat enforcers | `packages/contracts/src/enforcers/` |

## Decision

Smart Agent will use one native delegation architecture:

```text
session EOA + caveats for default work
per-call sub-delegations for sensitive work
ERC-7579-compatible Session AgentAccounts for stateful work
ERC-7715-shaped permission UX for consent
```

This gives:

```text
one user-rooted authority model
one policy vocabulary across MCPs
least privilege by default
strong promotion path for high-risk actions
future modular-account compatibility
clear audit from user approval to transaction
```
