# Agent Smart Account Kit — Architecture Spec

## Vision

An ERC-4337 smart-account framework where the primary user is not a human wallet-holder, but an autonomous or semi-autonomous agent operating under programmable delegation, session-scoped authority, and trust-graph-aware policy.

## Design Principles

1. **Agent-first** — agents are first-class principals, not just wallet extensions
2. **Delegation is the execution substrate** — all agent actions flow through scoped delegations
3. **Session accounts are the runtime model** — isolated, revocable, time-bounded
4. **Trust graph context is part of authorization** — policy depends on relationships
5. **Agent discovery/metadata is part of account identity** — accounts are machine-discoverable

## 6-Layer Architecture

### Layer 1: Agent Root Account

The canonical ERC-4337 smart account for agent identity.

- Implements `validateUserOp` (ERC-4337)
- Supports `isValidSignature` (ERC-1271)
- Modular owner sets (person, org multisig, another agent, policy module)
- Anchors trust and relationship registries
- Holds canonical metadata pointers

**Contract:** `AgentAccount.sol`
**Interface:** `IAgentAccount.sol`

### Layer 2: Delegation / Capability Layer

The heart of the system — agent-native caveat enforcement.

Caveat types:
- **Tool caveats** — can call only these MCP tools
- **Spending caveats** — up to X USDC per day
- **Session caveats** — only for this customer/session/thread
- **Method caveats** — only invoke these contract methods
- **Time caveats** — expires at this time
- **Trust caveats** — requires trust score above threshold
- **Relationship caveats** — requires counterparty relationship type

**Contract:** `AgentDelegationManager.sol`
**Interface:** `IDelegation.sol`

### Layer 3: Session Agent Accounts

Runtime-scoped delegate accounts spawned from the root.

- Session keypair generation
- Delegated capability bundle (from Layer 2)
- Expiry and audience/tool scope
- Independent revocation
- Encrypted storage for session keys

**Contract:** `AgentSessionManager.sol`
**Interface:** `ISessionAccount.sol`

### Layer 4: Agent Runtime / Execution Gateway

Offchain service that converts intents into UserOperations.

- Receives intents/tasks
- Selects the right session package
- Simulates the action
- Builds the UserOperation
- Submits via bundler
- Optionally uses paymaster
- Logs provenance and execution receipts

**Package:** `packages/sdk/src/runtime/`

### Layer 5: Trust / Relationship Graph Layer

Agent accounts connected into a trust context.

- Relationship registry (agent-to-agent edges)
- App/runtime registry
- Reputation / validation attestations
- Trust assertions (ontology-aligned)

Policy can depend on graph context:
- "only transact with agents validated by X"
- "only allow autonomous payments to org-linked service agents"
- "only permit tool use if session is tied to approved principal-agent relationship"

**Contract:** `AgentRelationshipRegistry.sol`
**Contract:** `AgentAppRegistry.sol`

### Layer 6: Discovery + Metadata Layer

Makes agent accounts discoverable as machine actors.

An agent account exposes:
- Canonical metadata URI
- Supported interfaces
- Supported tools
- Trust mechanisms
- App/runtime endpoints
- Payment support
- Relationship references

**Standard:** ERC-1820 / custom registry

## Authority Separation

| Authority          | Scope                                |
|--------------------|--------------------------------------|
| Identity authority | Who is this agent?                   |
| Runtime authority  | What can this session do right now?  |
| Tool authority     | Which tools can be invoked?          |
| Spending authority | How much can be spent?               |
| Trust authority    | Who can assert trust?                |

## Autonomy Modes

| Mode                | Description                           |
|---------------------|---------------------------------------|
| Human-confirmed     | Every action requires human approval  |
| Policy-confirmed    | Actions auto-approved if within policy|
| Fully autonomous    | Actions execute within caveats        |
| Emergency lockdown  | All actions blocked                   |

## Tech Stack

| Component      | Technology                              |
|----------------|-----------------------------------------|
| Smart contracts| Solidity ^0.8.24, Foundry, OpenZeppelin |
| Account model  | ERC-4337 (EntryPoint v0.7)              |
| Signatures     | ERC-1271, EIP-712 typed data            |
| Delegation     | ERC-7710 / custom caveat system         |
| Chain          | Sepolia (testnet), Base Sepolia         |
| SDK            | TypeScript, viem                        |
| Web app        | Next.js 15, App Router                  |
| Testing        | Forge (contracts), Vitest (SDK/app)     |
