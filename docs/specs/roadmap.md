# Agent Smart Account Kit — Roadmap

## Sprint 1: Foundation (current)

### Issue #1: Project scaffolding — packages and contracts
**Labels:** `chore`, `p1`

**Summary:** Set up the monorepo packages needed for the Agent Smart Account Kit.

**Acceptance Criteria:**
- [ ] `packages/types/` — shared TypeScript types for all agent/account/delegation domain objects
- [ ] `packages/contracts/` — Foundry project with `foundry.toml`, OpenZeppelin deps, forge test passing
- [ ] `packages/sdk/` — TypeScript SDK package with viem dependency
- [ ] Root `pnpm typecheck` passes
- [ ] `forge build` compiles with zero errors

---

### Issue #2: AgentAccount contract — ERC-4337 smart account
**Labels:** `feat`, `p1`

**Summary:** Implement the core ERC-4337 smart account that serves as agent identity anchor.

**Acceptance Criteria:**
- [ ] `AgentAccount.sol` implements `IAccount.validateUserOp`
- [ ] Supports `ERC-1271` (`isValidSignature`)
- [ ] Owner management (add/remove owners)
- [ ] Execution functions (`execute`, `executeBatch`)
- [ ] Receives ETH (`receive()`)
- [ ] Comprehensive forge tests in `AgentAccount.t.sol`
- [ ] Follows ERC-4337 EntryPoint v0.7 interface

**Technical Notes:**
- Use OpenZeppelin's `Initializable` for proxy-friendly deployment
- Owner storage: simple `mapping(address => bool)` for v1
- EntryPoint address: configurable via constructor/initializer

---

### Issue #3: AgentAccountFactory — deterministic deployment
**Labels:** `feat`, `p1`

**Summary:** Factory contract for deploying AgentAccount instances with `CREATE2`.

**Acceptance Criteria:**
- [ ] `AgentAccountFactory.sol` deploys `AgentAccount` proxies
- [ ] Deterministic addresses via `CREATE2` + salt
- [ ] `getAddress(owner, salt)` returns counterfactual address
- [ ] `createAccount(owner, salt)` deploys if not exists, returns address
- [ ] Forge tests covering deployment, counterfactual address, and re-deployment no-op

---

## Sprint 2: Delegation

### Issue #4: AgentDelegationManager — caveat-based delegation
**Labels:** `feat`, `p1`

**Summary:** Implement the delegation system with typed caveats.

**Acceptance Criteria:**
- [ ] `AgentDelegationManager.sol` — delegation issuance, validation, revocation
- [ ] Caveat types: time, spending limit, method selector, target contract
- [ ] EIP-712 typed delegation signatures
- [ ] On-chain delegation storage with revocation
- [ ] Integration with `AgentAccount` (delegated execution)
- [ ] Forge tests for each caveat type

---

### Issue #5: AgentSessionManager — session account lifecycle
**Labels:** `feat`, `p1`

**Summary:** Session keypair management and delegation bundling.

**Acceptance Criteria:**
- [ ] Session key registration on `AgentAccount`
- [ ] Time-bounded session validity
- [ ] Delegation bundle attached to session
- [ ] Session revocation (individual and bulk)
- [ ] Forge tests for session lifecycle

---

## Sprint 3: SDK + Runtime

### Issue #6: TypeScript SDK — account deployment and UserOp building
**Labels:** `feat`, `p2`

**Summary:** SDK wrappers for deploying accounts, building UserOperations, and submitting to bundlers.

**Acceptance Criteria:**
- [ ] `createAgentAccount(owner, salt)` — deploy via factory
- [ ] `buildUserOp(account, calldata)` — construct UserOperation
- [ ] `signUserOp(signer, userOp)` — sign with owner or session key
- [ ] `submitUserOp(bundlerUrl, userOp)` — submit to bundler
- [ ] viem-based client wrappers
- [ ] Unit tests with mocked chain

---

### Issue #7: Delegation SDK — issue and use delegations
**Labels:** `feat`, `p2`

**Summary:** TypeScript wrappers for the delegation system.

**Acceptance Criteria:**
- [ ] `issueDelegation(from, to, caveats)` — create delegation
- [ ] `revokeDelegation(delegationId)` — revoke
- [ ] `createSessionPackage(rootAccount, caveats, duration)` — session lifecycle
- [ ] `executeWithDelegation(session, calldata)` — delegated execution
- [ ] Unit tests

---

## Sprint 4: Trust + Discovery

### Issue #8: AgentRelationshipRegistry — trust graph
**Labels:** `feat`, `p2`

**Summary:** On-chain registry of typed agent-to-agent relationships.

**Acceptance Criteria:**
- [ ] Typed edges (e.g., `validates`, `delegates_to`, `member_of`)
- [ ] Bidirectional relationship queries
- [ ] Trust-score-based caveats can reference this registry
- [ ] Forge tests

---

### Issue #9: Agent metadata and discovery
**Labels:** `feat`, `p3`

**Summary:** On-chain metadata URI + capability discovery for agent accounts.

**Acceptance Criteria:**
- [ ] `agentURI()` returns metadata endpoint
- [ ] Metadata schema: supported tools, interfaces, trust mechanisms
- [ ] SDK helpers to read/write metadata

---

## Sprint 5: Web App Integration

### Issue #10: Web app — connect to agent accounts
**Labels:** `feat`, `p3`

**Summary:** Integrate the SDK into the Next.js web app for managing agent accounts.

**Acceptance Criteria:**
- [ ] Dashboard showing deployed agent accounts
- [ ] Create new agent account flow
- [ ] View delegations and sessions
- [ ] Issue new delegation with caveat builder UI
