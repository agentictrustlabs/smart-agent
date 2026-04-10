# Actors & Use Cases

## Actors

### Primary Actors (Direct Users)

```
    O
   /|\     ORGANIZATION FOUNDER
   / \     
         The business person who creates an organization,
         selects a template (Grant Org, Service Business, etc.),
         configures governance (multi-sig, committee), and
         onboards the initial team. Their goal is to get the
         org operational with the right people, roles, and
         AI agents in place.

         Key activities:
         - Create organization from template
         - Configure governance structure (signers, quorum)
         - Invite founding team members
         - Deploy initial AI agents (treasury, proposals)
         - Set up relationships between agents
         - Monitor organizational health and trust scores
```

```
    O
   /|\     TEAM MEMBER
   / \     
         A person who joins an existing organization. They
         connect their wallet, accept an invitation or request
         membership, select their role(s) from the org template,
         and begin operating within their delegated authority.

         Key activities:
         - Connect wallet and create person agent
         - Join org via invite code or relationship request
         - Select roles from org template (treasurer, operator, etc.)
         - View their delegation authority and caveats
         - Approve/sign multi-sig proposals
         - Interact with org's AI agents
```

```
    O
   /|\     AGENT BUILDER
   / \     
         A technical person who deploys and configures AI
         agents. Sets up A2A endpoints, MCP servers, TEE
         attestation, capabilities, and metadata. May be
         the same person as the founder, or a dedicated
         developer.

         Key activities:
         - Deploy AI agent smart accounts
         - Configure agent metadata (type, capabilities, endpoints)
         - Set up TEE attestation for code integrity
         - Publish agent metadata to resolver
         - Test agent A2A communication
         - Monitor agent health and runtime trust
```

```
    O
   /|\     TREASURER / FINANCIAL OFFICER
   / \     
         Manages the organization's treasury through a
         Treasury AI Agent. Proposes spending, reviews
         autonomous transactions within bounds, and
         approves transfers that exceed delegation limits.

         Key activities:
         - View treasury balance and transaction history
         - Propose spending from treasury
         - Set delegation bounds for autonomous spending
         - Approve/reject treasury proposals (multi-sig)
         - Review treasury agent's autonomous activity
         - Configure spending caveats (limits, targets, schedules)
```

```
    O
   /|\     REVIEWER
   / \     
         Evaluates agents within the trust fabric. Requests
         reviewer relationships, receives delegated review
         authority, and submits structured reviews with
         dimension scores.

         Key activities:
         - Request reviewer relationship with an agent
         - Receive delegation for review submission
         - Submit structured reviews (score, dimensions, recommendation)
         - View review history and agent trust profiles
```

```
    O
   /|\     EXTERNAL PARTNER
   / \     
         Represents another organization or agent that
         interacts with this org through the trust fabric.
         Discovers agents via the resolver, establishes
         relationships, and communicates via A2A.

         Key activities:
         - Discover organization and its agents
         - Request partnership/service relationships
         - Communicate with agents via A2A
         - View mutual trust scores
         - Submit reviews of partner agents
```

### System Actors (Automated)

```
    O
   /|\     TREASURY AI AGENT
   / \     
         An AI agent smart account that manages funds
         autonomously within delegation bounds. Executes
         approved transactions, manages recurring payments,
         and flags anomalies. Controlled by multi-sig
         governance — humans approve what exceeds limits.

         Behaviors:
         - Execute transactions within delegated authority
         - Track spending against budgets
         - Process approved proposals
         - Flag suspicious activity for human review
         - Report financial status to organization members
```

```
    O
   /|\     DISCOVERY AI AGENT
   / \     
         Discovers and evaluates other agents in the
         trust fabric. Runs in a TEE for integrity.
         Submits reviews via delegated execution.

         Behaviors:
         - Scan trust graph for new agents
         - Evaluate trust profiles
         - Submit automated reviews
         - Respond to discovery queries via A2A
```

```
    O
   /|\     VALIDATOR AGENT
   / \     
         Validates agent activities, TEE attestations,
         and compliance. May run as a TEE oracle.

         Behaviors:
         - Verify TEE attestation quotes
         - Validate agent activity logs
         - Record validation evidence on-chain
         - Respond to validation requests
```

## Organization Templates

Templates define the governance structure, roles, AI agents, and delegation patterns for an organization. When a founder selects a template, the system auto-creates the multi-sig, role slots, AI agents, and relationship types.

### Template: Grant Organization

```
Purpose: Manages grant funds, evaluates proposals, distributes awards

Governance: Committee (3-of-5 multi-sig)

Roles:
  - Director (1)        → full authority, can add/remove members
  - Grant Officer (2-3) → reviews proposals, recommends awards
  - Treasurer (1)       → manages treasury, approves disbursements
  - Auditor (1)         → reviews financials, submits compliance reports
  - Reviewer (n)        → evaluates grant applications

AI Agents:
  - Treasury Agent (executor)
      → manages grant fund, processes approved disbursements
      → caveats: value limit per tx, allowed targets (grantees), time-bounded
  - Proposal Agent (assistant)
      → collects grant applications, scores them, recommends to officers
      → caveats: read-only to treasury, can create proposals
  - Compliance Agent (validator)
      → monitors disbursements against grant terms
      → caveats: read-only, can flag violations

Delegation Patterns:
  Director → full authority over all agents
  Grant Officer → can approve proposals up to $X
  Treasurer → can execute disbursements, value-capped
  Auditor → read-only access to all financial data
  Reviewer → can submit evaluations via delegated review
```

### Template: Service Business

```
Purpose: Delivers services to clients, manages team and billing

Governance: Owner + Operators (2-of-3 multi-sig)

Roles:
  - Owner (1)           → full authority
  - Operations Manager (1-2) → manages service delivery
  - Service Provider (n) → delivers services to clients
  - Billing Admin (1)    → manages invoicing and payments
  - Client Liaison (n)   → manages client relationships

AI Agents:
  - Treasury Agent (executor)
      → processes payments, manages receivables
      → caveats: value limit, allowed methods (transfer only)
  - Scheduling Agent (assistant)
      → manages service schedules, assigns providers
      → A2A endpoint for client booking
  - Client Portal Agent (assistant)
      → handles client inquiries via A2A/MCP
      → caveats: no financial authority

Delegation Patterns:
  Owner → full authority
  Operations Manager → can manage schedules, assign providers
  Service Provider → can update service status
  Billing Admin → can invoice, limited treasury access
  Client Liaison → can communicate with clients, no financial
```

### Template: Product Collective

```
Purpose: Builds and sells products, manages inventory and revenue

Governance: Board (3-of-5 multi-sig)

Roles:
  - Board Member (3-5)   → governance decisions
  - Product Lead (1-2)   → manages product development
  - Operations (1-2)     → manages supply chain and fulfillment
  - Finance (1)          → manages revenue and expenses
  - Community Manager (n) → manages customer relationships

AI Agents:
  - Treasury Agent (executor)
      → manages revenue, processes supplier payments
      → caveats: daily spending limit, approved vendor list
  - Inventory Agent (oracle)
      → tracks stock levels, triggers reorders
      → A2A endpoint for supply chain partners
  - Analytics Agent (discovery)
      → analyzes sales data, generates reports
      → read-only, no transaction authority
  - Customer Agent (assistant)
      → handles customer inquiries, processes returns
      → MCP server for support tools
      → limited refund authority (value-capped)

Delegation Patterns:
  Board → governance proposals, multi-sig
  Product Lead → product decisions, limited spending
  Operations → supplier payments within budget
  Finance → full treasury visibility, approval authority
  Community → customer interaction, limited refund authority
```

### Template: Investment Club

```
Purpose: Pools capital, evaluates opportunities, makes investments

Governance: Equal partners (n-of-m multi-sig, majority)

Roles:
  - Managing Partner (1-2)   → manages operations
  - Partner (n)              → equal voting weight
  - Analyst (n)              → researches opportunities
  - Compliance Officer (1)   → regulatory oversight

AI Agents:
  - Treasury Agent (executor)
      → holds pooled capital, executes approved investments
      → caveats: requires quorum approval above threshold
  - Research Agent (discovery)
      → evaluates investment opportunities
      → TEE-attested for data confidentiality
  - Portfolio Agent (oracle)
      → tracks portfolio performance, provides reports
      → read-only to treasury

Delegation Patterns:
  Managing Partner → operational decisions, limited single-signer authority
  Partner → equal vote on investment decisions
  Analyst → can propose investments, no execution authority
  Compliance Officer → audit access, can flag/freeze
```

## Use Case Diagrams

### UC1: Organization Setup

```
                    ┌─────────────────────────────────────────┐
                    │         Organization Setup               │
                    │                                          │
    O               │                                          │
   /|\  ────────────┼──► ( Browse Organization Templates )     │
   / \              │              │                           │
 Org Founder        │              │ «include»                 │
                    │              ▼                           │
                    │    ( Select Template )                    │
                    │              │                           │
                    │              │ «include»                 │
                    │              ▼                           │
                    │    ( Configure Governance )               │
                    │      │                                   │
                    │      ├──► ( Set Multi-Sig Quorum )       │
                    │      │                                   │
                    │      ├──► ( Define Role Slots )          │
                    │      │                                   │
                    │      └──► ( Set Spending Limits )        │
                    │              │                           │
                    │              │ «include»                 │
                    │              ▼                           │
                    │    ( Deploy Org Smart Account )           │
                    │              │                           │
                    │              │ «include»                 │
                    │              ▼                           │
                    │    ( Auto-Deploy AI Agents )              │
                    │      │                                   │
                    │      ├──► ( Deploy Treasury Agent )      │
                    │      │                                   │
                    │      ├──► ( Deploy Template Agents )     │
                    │      │                                   │
                    │      └──► ( Create Agent Relationships ) │
                    │              │                           │
                    │              │ «include»                 │
                    │              ▼                           │
                    │    ( Publish Org Metadata )               │
                    │              │                           │
                    │              │ «include»                 │
                    │              ▼                           │
                    │    ( Generate Invite Links )              │
                    │                                          │
                    └─────────────────────────────────────────┘
```

### UC2: Team Member Onboarding

```
                    ┌────────────────────────────────────────────┐
                    │        Team Member Onboarding               │
                    │                                             │
    O               │                                             │
   /|\  ────────────┼──► ( Connect Wallet )                       │
   / \              │           │                                 │
 Team Member        │           │ «include»                       │
                    │           ▼                                 │
                    │    ( Create Person Agent )                   │
                    │           │                                 │
                    │           ├──► ( Accept Invite Code )       │
                    │           │         │                       │
                    │           │         │ «include»             │
                    │           │         ▼                       │
                    │           │  ( Auto-Join Organization )     │
                    │           │                                 │
                    │           └──► ( Request Membership )       │
                    │                     │                       │
                    │                     │ «include»             │
                    │                     ▼                       │
    O               │    ( Select Available Roles )               │
   /|\  ◄───────────┼──        │                                 │
   / \              │          │  Org Founder reviews             │
 Org Founder        │          ▼  and approves                    │
                    │    ( Approve Membership + Roles )            │
                    │           │                                 │
                    │           │ «include»                       │
                    │           ▼                                 │
                    │    ( Auto-Issue Role Delegations )           │
                    │      │                                      │
                    │      ├──► ( Create Relationship Edge )      │
                    │      │                                      │
                    │      ├──► ( Apply Template Caveats )        │
                    │      │                                      │
                    │      └──► ( Sign Delegation )               │
                    │           │                                 │
                    │           │ «include»                       │
                    │           ▼                                 │
                    │    ( Publish Member Metadata )               │
                    │                                             │
                    └────────────────────────────────────────────┘
```

### UC3: AI Agent Lifecycle

```
                    ┌────────────────────────────────────────────┐
                    │          AI Agent Lifecycle                  │
                    │                                             │
    O               │                                             │
   /|\  ────────────┼──► ( Deploy AI Agent Account )              │
   / \              │           │                                 │
 Agent Builder      │           │ «include»                       │
                    │           ▼                                 │
                    │    ( Configure Agent Metadata )              │
                    │      │                                      │
                    │      ├──► ( Set Agent Type + Class )        │
                    │      │                                      │
                    │      ├──► ( Set Capabilities )              │
                    │      │                                      │
                    │      ├──► ( Set A2A Endpoint )              │
                    │      │                                      │
                    │      ├──► ( Set MCP Server )                │
                    │      │                                      │
                    │      └──► ( Declare Trust Models )          │
                    │           │                                 │
                    │           │ «include»                       │
                    │           ▼                                 │
                    │    ( Assign to Organization )                │
                    │      │                                      │
                    │      ├──► ( Create Org Control Edge )       │
                    │      │                                      │
                    │      └──► ( Set Operated-By )               │
                    │           │                                 │
                    │           │ «extend»                        │
                    │           ▼                                 │
                    │    ( Attest TEE Runtime )                    │
                    │      │                                      │
                    │      ├──► ( Run TEE Simulator )             │
                    │      │                                      │
                    │      └──► ( Record Validation )             │
                    │           │                                 │
                    │           │ «include»                       │
                    │           ▼                                 │
                    │    ( Publish Agent Metadata )                │
                    │           │                                 │
                    │           │ «extend»                        │
                    │           ▼                                 │
                    │    ( Test Agent Communication )              │
                    │      │                                      │
                    │      ├──► ( Call A2A Health Check )         │
                    │      │                                      │
                    │      ├──► ( Send Test Task )                │
                    │      │                                      │
                    │      └──► ( View Agent Card )               │
                    │                                             │
                    └────────────────────────────────────────────┘
```

### UC4: Treasury Management

```
                    ┌────────────────────────────────────────────┐
                    │         Treasury Management                 │
                    │                                             │
    O               │                                             │
   /|\  ────────────┼──► ( View Treasury Dashboard )              │
   / \              │           │                                 │
 Treasurer          │           ├──► ( View Balance )             │
                    │           │                                 │
                    │           ├──► ( View Transaction History ) │
                    │           │                                 │
                    │           └──► ( View Active Delegations )  │
                    │                                             │
                    │                                             │
   /|\  ────────────┼──► ( Propose Spending )                     │
   / \              │           │                                 │
 Treasurer          │           │ «include»                       │
                    │           ▼                                 │
                    │    ( Create Proposal )                       │
                    │      │                                      │
                    │      ├──► ( Set Amount + Target )           │
                    │      │                                      │
                    │      └──► ( Attach Evidence/Reason )        │
                    │           │                                 │
    O               │           │                                 │
   /|\  ────────────┼──► ( Approve Proposal )  ◄─── multi-sig    │
   / \              │           │                                 │
 Board Member       │           │ quorum reached                  │
                    │           ▼                                 │
                    │    ( Execute via Treasury Agent )            │
                    │                                             │
                    │                                             │
    O               │                                             │
   /|\  ────────────┼──► ( Configure Autonomous Bounds )          │
   / \              │      │                                      │
 Org Founder        │      ├──► ( Set Daily Spend Limit )        │
                    │      │                                      │
                    │      ├──► ( Set Approved Targets )          │
                    │      │                                      │
                    │      ├──► ( Set Time Windows )              │
                    │      │                                      │
                    │      └──► ( Set Method Restrictions )       │
                    │                                             │
                    │                                             │
    O               │                                             │
   /|\  ────────────┼──► ( Review Autonomous Activity )           │
   / \              │      │                                      │
 Treasurer          │      ├──► ( View Auto-Executed Txs )       │
                    │      │                                      │
                    │      ├──► ( Flag Suspicious Activity )      │
                    │      │                                      │
                    │      └──► ( Pause Treasury Agent )          │
                    │                                             │
                    └────────────────────────────────────────────┘
```

### UC5: Trust & Review Management

```
                    ┌────────────────────────────────────────────┐
                    │       Trust & Review Management              │
                    │                                             │
    O               │                                             │
   /|\  ────────────┼──► ( View Agent Trust Profile )             │
   / \              │      │                                      │
 Any User           │      ├──► ( View Trust Scores )            │
                    │      │      (Discovery / Execution / Runtime)│
                    │      │                                      │
                    │      ├──► ( View Relationships )            │
                    │      │                                      │
                    │      ├──► ( View Reviews )                  │
                    │      │                                      │
                    │      ├──► ( View TEE Validations )          │
                    │      │                                      │
                    │      ├──► ( View Delegations )              │
                    │      │                                      │
                    │      └──► ( View Disputes )                 │
                    │                                             │
                    │                                             │
    O               │                                             │
   /|\  ────────────┼──► ( Request Reviewer Role )                │
   / \              │           │                                 │
 Reviewer           │           │ «include»                       │
                    │           ▼                                 │
    O               │    ( Approve Reviewer Relationship )        │
   /|\  ◄───────────┼──        │                                 │
   / \              │          │ «include»                        │
 Agent Owner        │          ▼                                  │
                    │    ( Auto-Issue Review Delegation )          │
                    │           │                                 │
    O               │           │                                 │
   /|\  ────────────┼──► ( Submit Review )                        │
   / \              │      │                                      │
 Reviewer           │      ├──► ( Score Dimensions )             │
                    │      │                                      │
                    │      ├──► ( Set Recommendation )            │
                    │      │                                      │
                    │      └──► ( Redeem Delegation )             │
                    │                ──► DelegationManager        │
                    │                ──► Agent Account             │
                    │                ──► ReviewRecord              │
                    │                                             │
                    │                                             │
    O               │                                             │
   /|\  ────────────┼──► ( File Dispute )                         │
   / \              │                                             │
 Any User           │                                             │
                    │                                             │
    O               │                                             │
   /|\  ────────────┼──► ( Respond to Review )                    │
   / \              │                                             │
 Agent Owner        │                                             │
                    └────────────────────────────────────────────┘
```

### UC6: Agent Discovery & Communication

```
                    ┌────────────────────────────────────────────┐
                    │     Agent Discovery & Communication          │
                    │                                             │
    O               │                                             │
   /|\  ────────────┼──► ( Browse Trust Graph )                   │
   / \              │      │                                      │
 Any User           │      ├──► ( Filter by Agent Type )         │
                    │      │                                      │
                    │      ├──► ( Filter by Capability )          │
                    │      │                                      │
                    │      ├──► ( Filter by Trust Score )         │
                    │      │                                      │
                    │      └──► ( View Agent Detail )             │
                    │                                             │
                    │                                             │
    O               │                                             │
   /|\  ────────────┼──► ( Resolve Agent Identity )               │
   / \              │      │                                      │
 External Partner   │      ├──► ( Query Universal Resolver )     │
                    │      │                                      │
                    │      ├──► ( Fetch JSON-LD Metadata )        │
                    │      │                                      │
                    │      └──► ( Validate SHACL Shape )          │
                    │                                             │
                    │                                             │
    O               │                                             │
   /|\  ────────────┼──► ( Communicate with Agent )               │
   / \              │      │                                      │
 Any User /         │      ├──► ( Call A2A Endpoint )             │
 External Agent     │      │      │                               │
                    │      │      ├──► ( Health Check )           │
                    │      │      │                               │
                    │      │      ├──► ( View Agent Card )        │
                    │      │      │                               │
                    │      │      └──► ( Send Task )              │
                    │      │                                      │
                    │      └──► ( Connect via MCP )               │
                    │             │                               │
                    │             ├──► ( List Tools )             │
                    │             │                               │
                    │             └──► ( Call Tool )              │
                    │                                             │
                    │                                             │
    O               │                                             │
   /|\  ────────────┼──► ( Request Relationship )                 │
   / \              │      │                                      │
 External Partner   │      ├──► ( Select Relationship Type )     │
                    │      │                                      │
                    │      ├──► ( Select Roles )                  │
                    │      │                                      │
                    │      └──► ( Await Confirmation )            │
                    │                                             │
                    └────────────────────────────────────────────┘
```

### UC7: TEE & Runtime Validation

```
                    ┌────────────────────────────────────────────┐
                    │       TEE & Runtime Validation               │
                    │                                             │
    O               │                                             │
   /|\  ────────────┼──► ( Attest Agent Runtime )                 │
   / \              │      │                                      │
 Agent Builder      │      ├──► ( Select TEE Architecture )      │
                    │      │      (Nitro / TDX / SGX / SEV)       │
                    │      │                                      │
                    │      ├──► ( Provide Code Artifacts )        │
                    │      │      (Dockerfile, config, kernel)     │
                    │      │                                      │
                    │      ├──► ( Run TEE Simulator )             │
                    │      │      │                               │
                    │      │      ├──► ( Compute PCR Values )    │
                    │      │      │                               │
                    │      │      ├──► ( Call MockVerifier )      │
                    │      │      │                               │
                    │      │      └──► ( Generate Evidence )      │
                    │      │                                      │
                    │      └──► ( Record Validation On-Chain )    │
                    │                                             │
                    │                                             │
    O               │                                             │
   /|\  ────────────┼──► ( Verify Agent TEE Status )              │
   / \              │      │                                      │
 Any User           │      ├──► ( View Code Measurement )        │
                    │      │                                      │
                    │      ├──► ( View Verifier Contract )        │
                    │      │                                      │
                    │      ├──► ( Check Runtime Trust Score )     │
                    │      │                                      │
                    │      └──► ( Inspect Evidence Bundle )       │
                    │                                             │
                    └────────────────────────────────────────────┘
```

### UC8: Organization Status & Monitoring

```
                    ┌────────────────────────────────────────────┐
                    │     Organization Status & Monitoring         │
                    │                                             │
    O               │                                             │
   /|\  ────────────┼──► ( View Organization Dashboard )          │
   / \              │      │                                      │
 Org Founder /      │      ├──► ( Member Overview )              │
 Team Member        │      │      (who, roles, status)            │
                    │      │                                      │
                    │      ├──► ( Agent Fleet Status )            │
                    │      │      (health, trust scores, activity) │
                    │      │                                      │
                    │      ├──► ( Treasury Summary )              │
                    │      │      (balance, pending proposals)     │
                    │      │                                      │
                    │      ├──► ( Pending Actions )               │
                    │      │      (proposals to approve,           │
                    │      │       relationships to confirm,       │
                    │      │       reviews to respond to)          │
                    │      │                                      │
                    │      ├──► ( Governance Status )             │
                    │      │      (quorum met?, bootstrap mode?)   │
                    │      │                                      │
                    │      └──► ( External Relationships )        │
                    │             (partners, vendors, validators)  │
                    │                                             │
                    │                                             │
    O               │                                             │
   /|\  ────────────┼──► ( View Notifications )                   │
   / \              │      │                                      │
 Any Member         │      ├──► ( Relationship Requests )        │
                    │      │                                      │
                    │      ├──► ( Review Received )               │
                    │      │                                      │
                    │      ├──► ( Proposal Created )              │
                    │      │                                      │
                    │      ├──► ( TEE Validation Recorded )       │
                    │      │                                      │
                    │      └──► ( Dispute Filed )                 │
                    │                                             │
                    └────────────────────────────────────────────┘
```

## Use Case Cross-Reference Matrix

| Use Case | Org Founder | Team Member | Agent Builder | Treasurer | Reviewer | External Partner |
|----------|:-----------:|:-----------:|:------------:|:---------:|:--------:|:----------------:|
| Browse Org Templates | X | | | | | |
| Create Organization | X | | | | | |
| Configure Governance | X | | | | | |
| Invite Team Members | X | | | | | |
| Connect Wallet | X | X | X | X | X | X |
| Create Person Agent | X | X | X | X | X | |
| Join Organization | | X | X | X | X | |
| Select Roles | | X | X | X | X | |
| Deploy AI Agent | X | | X | | | |
| Configure Agent Metadata | X | | X | | | |
| Publish Agent Metadata | X | | X | | | |
| Attest TEE Runtime | | | X | | | |
| View Trust Profile | X | X | X | X | X | X |
| View Trust Graph | X | X | X | X | X | X |
| Propose Spending | X | | | X | | |
| Approve Proposal | X | X | | X | | |
| Configure Spending Bounds | X | | | | | |
| View Treasury Dashboard | X | X | | X | | |
| Request Reviewer Role | | | | | X | X |
| Submit Review | | | | | X | |
| File Dispute | X | X | | | X | X |
| Respond to Review | X | | X | | | |
| Call Agent A2A | X | X | X | | | X |
| Connect via MCP | X | X | X | | | X |
| Request Relationship | X | X | | | | X |
| Confirm Relationship | X | | | | | |
| View Notifications | X | X | X | X | X | |
| View Org Dashboard | X | X | | X | | |
| Resolve Agent Identity | | | | | | X |
| Discover Agents | X | X | X | | X | X |

## Key Workflows (End-to-End)

### Workflow 1: New Organization → First Agent → First Team Member

```
Org Founder connects wallet
  → Creates person agent
  → Browses organization templates
  → Selects "Service Business" template
  → Configures: 2-of-3 multi-sig, sets org name/description
  → System auto-deploys:
      - Org smart account (multi-sig)
      - Treasury AI Agent (with delegation caveats)
      - Scheduling AI Agent (with A2A endpoint)
  → System auto-creates:
      - Org Control relationships (org → agents)
      - Role templates with delegation patterns
      - Governance config (AgentControl)
  → Founder publishes org metadata to resolver
  → Founder generates invite link for "Operations Manager" role
  → Sends invite to team member
  
Team Member receives invite
  → Connects wallet, creates person agent
  → Accepts invite code
  → System auto-creates:
      - Membership relationship (person → org)
      - Operations Manager role on the edge
      - Delegation from org to person (method + target + time caveats)
  → Team member can now operate within delegated bounds
```

### Workflow 2: Treasury Proposal → Multi-Sig Approval → Execution

```
Treasurer views treasury dashboard
  → Sees balance, pending proposals, recent activity
  → Creates proposal: "Pay vendor $500 for services"
  → Attaches invoice evidence URI
  → Proposal created on-chain (AgentControl)
  
Board Member 1 receives notification
  → Reviews proposal details and evidence
  → Approves proposal (1 of 2 needed)
  
Board Member 2 receives notification
  → Approves proposal (2 of 2 — quorum reached)
  → System auto-executes:
      - Treasury Agent redeems delegation
      - DelegationManager validates caveats
      - Transfer executes through treasury smart account
  → All members see executed proposal in dashboard
```

### Workflow 3: External Agent Discovery → Relationship → Review

```
External Partner discovers org via trust graph
  → Queries Universal Resolver for org profile
  → Fetches JSON-LD metadata from IPFS
  → Validates against SHACL shapes
  → Views trust scores (discovery: 80, execution: 75)
  → Requests "strategic-partner" relationship
  
Org Founder receives notification
  → Reviews partner's trust profile
  → Confirms relationship
  → System creates alliance edge with roles
  
Partner requests reviewer role for org's AI agent
  → Org Founder confirms reviewer relationship
  → System auto-issues review delegation
  → Partner submits structured review via delegation
  → Review recorded on-chain, trust scores updated
```

## Navigation Structure (Proposed)

Based on the use cases, the app navigation should be organized around the primary workflows:

```
┌─────────────────────────────────────────┐
│  Smart Agent                            │
│                                         │
│  [Dashboard]  Organization home          │
│    ├── Member overview                   │
│    ├── Agent fleet status                │
│    ├── Treasury summary                  │
│    └── Pending actions                   │
│                                         │
│  [Agents]  AI Agent management           │
│    ├── Agent list (with metadata)        │
│    ├── Deploy new agent                  │
│    ├── Agent detail + trust profile      │
│    ├── Edit metadata                     │
│    └── A2A / MCP interaction             │
│                                         │
│  [Treasury]  Financial management        │
│    ├── Balance + history                 │
│    ├── Proposals                         │
│    ├── Autonomous activity log           │
│    └── Delegation bounds config          │
│                                         │
│  [Team]  People + roles                  │
│    ├── Member list with roles            │
│    ├── Invite new members                │
│    ├── Role assignments                  │
│    └── Governance settings               │
│                                         │
│  [Trust]  Trust fabric                   │
│    ├── Trust graph visualization         │
│    ├── Reviews                           │
│    ├── TEE validations                   │
│    ├── Disputes                          │
│    └── External relationships            │
│                                         │
│  [Settings]  Organization config         │
│    ├── Organization templates            │
│    ├── Governance config                 │
│    ├── Delegation templates              │
│    └── Ontology / metadata               │
│                                         │
│  [🔔]  Notifications                    │
│  [👤]  Profile / disconnect             │
└─────────────────────────────────────────┘
```

## Questions for Alignment

1. **Treasury funding** — How does the treasury get funded initially? ETH transfer to the smart account? Paymaster deposit? Or is this out of scope for v1?

2. **Organization templates** — Should these be on-chain (stored in a contract) or app-level configuration? On-chain means they're composable but gas-heavy; app-level means faster iteration.

3. **Agent communication in the UI** — For the A2A/MCP interaction, should the web app act as a proxy (server-side calls to agent endpoints), or should it provide a direct client-side chat/task interface?

4. **Role-based access in the UI** — Should the web app enforce role-based views (e.g., a reviewer only sees review-related pages), or show everything with action buttons disabled for unauthorized users?

5. **Multi-org support** — You mentioned single org focus. Should the navigation assume one org per deployment, or should there be an org switcher for users who manage multiple orgs?
