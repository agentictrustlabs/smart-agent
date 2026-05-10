# Delegation Architecture — Implementation Plan

**Status:** ratified architecture; ready to execute
**Date:** 2026-05-10
**Source decision:** `output/delegation-architecture-tradeoffs.md` + architectural memo dated 2026-05-10
**Target architecture:** Native, standards-shaped delegation fabric — D (Hybrid) with ERC-7579 as compatibility target

---

## 1. Target architecture (locked)

```
USER.smartAccount
   │
   │  Root grant (ERC-712 typed delegation, signed once per session)
   │  caveats encode SessionPolicy enforced by DelegationManager + first-party modules
   │
   ▼
SESSION PRINCIPAL (one of three forms — risk-tier driven)
   │
   ├─ Stateless: session EOA in a2a-agent (cheap, short-lived)
   │     for low-risk MCP ops + routine on-chain writes (pool create/admin, intent etc.)
   │
   ├─ Per-call sub-delegated: same root + per-call narrowing
   │     for promoted ops: round:set_awards_root, disbursement:claim,
   │     pool:close, future treasury / custody / asset-affecting ops
   │
   └─ ERC-7579 SessionAgentAccount: deployed, modular, stateful
         for long-lived autonomous sessions, persistent spend caps,
         runtime policy changes, multi-validator approval

DelegationManager (existing, ERC-7710-shaped) is the universal authority fabric.
EVERY redeem flows through it — no privileged backend keys; no MCP-as-principal.
```

**The architectural invariants:**

1. **One root authority per session** — `user.smartAccount → sessionPrincipal`. No side-channels (Tier 2 D_onchain is retired).
2. **MCP servers are coordinators, not principals.** They never hold broad user authority. They authenticate via existing `verify-delegation.ts` and route on-chain work through a2a-agent.
3. **Risk tiering is declared in a Tool Policy Registry**, not scattered in conditionals. New MCPs/tools integrate by declaring policy.
4. **Per-call sub-delegation is the upgrade path for high-risk ops** — task-bound, calldata-hash-bound, single-use nonces.
5. **ERC-7579 is a compatibility surface**, not a per-session tax. Stateless sessions stay cheap; modular accounts when policy needs state.
6. **First-party modules only** at v1. Third-party modules require ERC-7484-style attestation and explicit user-visible install — out of scope for v1.

---

## 2. Pre-work (cross-cutting, applies to all phases)

These are shared substrate that Phases 1-4 build on. Do them first, in this order.

### 2.1 ToolPolicyRegistry — first-party TypeScript

**Where:** new file `packages/sdk/src/policy/tool-policies.ts` (TypeScript, versioned in code; on-chain registry is Phase 5+).

**Shape (one entry per MCP tool):**

```typescript
export interface ToolPolicy {
  toolId: string                              // e.g. "pool:create", "round:set_awards_root"
  riskTier: 'routine' | 'sensitive' | 'stateful'
  executionPath: 'mcp-only' | 'stateless-redeem' | 'sub-delegated' | 'session-account'
  allowedTargets: Address[]                   // PoolRegistry, FundRegistry, …
  allowedSelectors: Hex[]                     // 4-byte function selectors
  maxValueWei: bigint                         // 0 for typed-attr writes
  requiresTaskBinding: boolean                // true for sub-delegated path
  requiresCalldataHash: boolean               // true for sub-delegated path
  requiresHumanConfirmation: boolean          // future: Phase 4 wallet UX
  allowedChains: number[]
}

export const TOOL_POLICIES: Record<string, ToolPolicy> = {
  /* … */
}
```

**Routing by risk tier (used by a2a-agent + MCPs):**
- `routine` → stateless-redeem path. Caveat-composition only. Default.
- `sensitive` → sub-delegated path. Per-call D_sub mint.
- `stateful` → session-account path. ERC-7579 SessionAgentAccount.

**Initial classification:**

| Tool | Tier |
|---|---|
| `intent:*`, `pledge:*`, `proposal:*`, `notification:*`, `belief:*`, `member:*`, `org_profile:*` | routine (MCP-only — no on-chain) |
| `pool:create`, `pool:update_mandate`, `pool:rotate_stewards`, `pool:set_accepted_restrictions`, `round:open`, `round:set_status`, `round:cancel`, `round:set_voting_config` | routine (stateless-redeem) |
| `round:set_awards_root`, `round:close`, `pool:close`, `disbursement:claim`, `outcome:attest` | sensitive (sub-delegated) |
| (future) treasury custody, multi-call spend, autonomous-agent ops | stateful (session-account) |

**Verification:** unit test that every MCP tool registered in `apps/*/src/tools/` has a corresponding policy entry. CI check.

### 2.2 Audit record shape

Standard schema in `packages/sdk/src/audit/types.ts`:

```typescript
export interface ExecutionReceipt {
  // identity
  rootGrantHash: Hex                // hash of the user's signed root delegation
  sessionId: string                 // a2a-agent's session id
  sessionPrincipal: Address         // session EOA OR SessionAgentAccount
  // task
  a2aTaskId: string                 // A2A task that initiated the chain
  // tool
  mcpServer: string                 // 'org-mcp', 'person-mcp', …
  mcpTool: string                   // 'pool:create', 'round:set_awards_root'
  mcpCallId: string                 // unique per MCP request
  // execution
  executionPath: ToolPolicy['executionPath']
  toolGrantHash: Hex | null         // hash of D_sub if sub-delegated; else null
  toolExecutor: Address | null      // leaf delegate EOA on sub-delegated path
  target: Address
  selector: Hex
  callDataHash: Hex
  valueWei: string
  // outcome
  txHash: Hex | null                // on-chain redeem txn (null for MCP-only)
  userOpHash: Hex | null            // if routed through EntryPoint (Phase 3)
  status: 'completed' | 'reverted' | 'denied'
  errorReason: string | null
  // time
  receivedAt: string                // ISO
  finalizedAt: string | null
}
```

**Storage:** new SQLite table `execution_audit` in a2a-agent (a2a is the natural choke point; every tx flows through it).

**Retention:** indefinite for v1; archival policy a future concern.

### 2.3 Inter-service auth (MCPs ↔ a2a-agent)

A2a-agent's new endpoints (`/session/{id}/redeem-tx`, `/session/{id}/sign-subdelegation`, etc.) must authenticate the calling MCP. **Don't reuse the user's session bearer for this** — that conflates user identity with service identity.

**Pattern:** shared HMAC secret per MCP, rotated at deploy. Each MCP signs its request body with its secret; a2a-agent verifies. Add to env:
- `A2A_INTERSERVICE_HMAC_KEY_<MCP_NAME>` (one per MCP server)
- All MCPs and a2a-agent get these via `deploy-local.sh`.

---

## 3. Phase 1 — Native delegation fabric

**Goal:** retire Tier 2 D_onchain. One root delegation per session. a2a-agent owns the on-chain redeem path. Org-mcp loses its wallet.

**Effort:** ~1 week. **Risk:** medium (touches auth + on-chain redemption).

### 3.1 Sign richer caveats on the user→sessionKey delegation

**File:** `apps/web/src/lib/actions/a2a-session.action.ts` `bootstrapA2ASessionForUser()`.

Currently mints `[TimestampEnforcer]` only. Extend to compose enforcers driven by `TOOL_POLICIES`:

```typescript
const allowedTargets = uniq(Object.values(TOOL_POLICIES).flatMap(p => p.allowedTargets))
const allowedSelectors = uniq(Object.values(TOOL_POLICIES).flatMap(p => p.allowedSelectors))
const allowedToolNames = Object.keys(TOOL_POLICIES)

const caveats = [
  buildCaveat(timestampEnforcer, encodeTimestampTerms(now, expiresAt)),
  buildCaveat(allowedTargetsEnforcer, encodeAllowedTargetsTerms(allowedTargets)),
  buildCaveat(allowedMethodsEnforcer, encodeAllowedMethodsTerms(allowedSelectors)),
  buildCaveat(valueEnforcer, encodeValueTerms(0n)),       // no ETH transfer
  buildCaveat(mcpToolScopeEnforcer, encodeMcpToolScopeTerms(allowedToolNames)),
  buildCaveat(rateLimitEnforcer, encodeRateLimitTerms({ window: 3600, max: 100 })),
]
```

User signs once. Same delegation now carries both MCP scope (for `verify-delegation.ts`) and on-chain authority (for `redeemDelegation`).

### 3.2 New a2a-agent endpoint — `POST /session/:id/redeem-tx`

**File:** new `apps/a2a-agent/src/routes/onchain-redeem.ts`.

```typescript
// Auth: HMAC(A2A_INTERSERVICE_HMAC_KEY_<mcp>) over body
// Body: { mcpServer, mcpTool, a2aTaskId?, target, value, callData, mcpCallId }
// 1. Verify HMAC
// 2. Verify session is alive
// 3. Validate ToolPolicy[mcpTool] exists, riskTier=routine, executionPath=stateless-redeem
// 4. Validate target ∈ policy.allowedTargets, selector ∈ policy.allowedSelectors
// 5. Decrypt sessionPrivateKey
// 6. Submit DelegationManager.redeemDelegation([userDelegation], target, value, callData)
//    with sessionKey as msg.sender
// 7. Wait for receipt
// 8. Write ExecutionReceipt to execution_audit
// 9. Return { txHash, executionReceiptId }
```

This endpoint is the choke point. **Every routine on-chain write goes through it.**

### 3.3 Org-mcp pool/round tools route on-chain via a2a-agent

**Files:** `apps/org-mcp/src/tools/pools.ts`, `rounds.ts`.

Replace `redeemThroughDelegation` (Tier 2 — signs locally with ORG_MCP_EOA) with:

```typescript
// inside a tool's handler:
const callData = encodeFunctionData({ abi: poolRegistryAbi, functionName: 'open', args: [...] })
const result = await callA2aRedeem({
  mcpServer: 'org-mcp', mcpTool: 'pool:create',
  a2aTaskId: args.a2aTaskId, mcpCallId: randomUUID(),
  target: poolRegistryAddress, value: 0n, callData,
})
// result.txHash, result.executionReceiptId
```

`callA2aRedeem` is a new helper in `apps/org-mcp/src/lib/a2a-client.ts` that does the HMAC + POST + retry.

### 3.4 Drop the entire D_onchain side-channel

Files to delete or gut:
- `apps/web/src/lib/auth/onchain-delegation-constants.ts` — DELETE
- `apps/web/src/lib/auth/get-onchain-delegation.ts` — DELETE
- `apps/org-mcp/src/lib/redeem.ts` (the local-redeem helper) — DELETE
- `apps/org-mcp/src/lib/contracts.ts` — gut to read-only (drop `getWalletClient`, drop `deploySmartAccount` — that moves to a2a-agent on-chain redeem)
- `apps/org-mcp/src/config.ts` — drop `signerPrivateKey`, `agentFactoryAddress`
- 6 web actions: drop `await getOnchainDelegation()` calls + `onchainDelegation` arg in MCP calls
- All pool/round MCP tools: drop `onchainDelegation` from their args schema

Cookie cleanup: `clearA2ASession` no longer clears a non-existent cookie.

### 3.5 Pool agent deployment moves to a2a-agent

`pool:create` needs to deploy a pool agent before calling PoolRegistry.open. The deploy currently happens in org-mcp via its (now-deleted) wallet. Moves to a2a-agent's redeem path:

- Add a separate endpoint `POST /session/:id/deploy-agent` to a2a-agent that wraps `AgentAccountFactory.createAccount(owner, salt)`. Owner = user's smartAccount (per Tier 2 T2.3 decision — user owns pool agent).
- Org-mcp `pool:create` calls this first, then proceeds with the redeem-tx for `PoolRegistry.open`.

### 3.6 Verification

- All packages typecheck.
- Forge tests pass.
- E2E suite (`tests/e2e/intent-marketplace.spec.ts`) passes — 27/27 like before.
- Manual test: pool create + admin from UI works through new path.
- Negative test: revoke session → next pool admin call fails cleanly with "session expired".

---

## 4. Phase 2 — Per-call sub-delegations for promoted ops

**Goal:** Sensitive operations get per-call narrower D_sub with single-use nonces. Replay defense is cryptographic, not just rate-limited. Per-tool executor identities give per-tool blast-radius isolation and per-call audit hashes.

**Effort:** ~2-3 weeks. **Risk:** high (auth-critical; sub-delegation chain bugs are subtle).

### 4.1 New caveat enforcer: `TaskBindingEnforcer`

**File:** `packages/contracts/src/enforcers/TaskBindingEnforcer.sol`.

Encodes a `taskId` (bytes32 hash of A2A task identifier). Reverts if redeem doesn't carry matching task identifier in `data`. Used to bind a D_sub to a specific A2A task lifecycle.

### 4.2 New caveat enforcer: `CallDataHashEnforcer`

**File:** `packages/contracts/src/enforcers/CallDataHashEnforcer.sol`.

Encodes `keccak256(callData)`. At redeem time, asserts the actual `data` arg hashes to the stored value. Locks the sub-delegation to one exact call.

### 4.3 Single-use nonce semantics

The existing DelegationManager already has `_revoked[hash]` check. Sub-delegations can be one-shot by:
- Using a fresh `salt` per sub-delegation (so each has a unique hash).
- Caller (a2a-agent) immediately revokes the sub-delegation hash after submission via `DelegationManager.revokeDelegation` to prevent replay.

OR add a dedicated `NonceEnforcer` that decrements an external counter. Choose based on gas: revocation-after-use is one extra tx per call; nonce enforcer is one extra storage slot per redeem. Recommend revocation-after-use for v1 (simpler, atomic with the redeem in same tx if we batch).

### 4.4 Per-tool executor identities

For every MCP tool family in `riskTier='sensitive'`, allocate a dedicated EOA in a2a-agent:
- `TOOL_EXECUTOR_ROUND_AWARDS_KEY` (signs `round:set_awards_root` redeems)
- `TOOL_EXECUTOR_DISBURSEMENT_KEY` (signs `disbursement:*`)
- `TOOL_EXECUTOR_POOL_LIFECYCLE_KEY` (signs `pool:close`)
- `TOOL_EXECUTOR_TREASURY_KEY` (future)

A2a-agent generates these keys on first boot, persists encrypted in the same store as session keys. Each one's address is what's set as `delegate` on D_sub.

### 4.5 New a2a-agent endpoint — `POST /session/:id/sign-subdelegation`

```typescript
// Auth: HMAC(A2A_INTERSERVICE_HMAC_KEY_<mcp>)
// Body: { mcpServer, mcpTool, a2aTaskId, target, value, callData }
// 1. Lookup ToolPolicy[mcpTool] — must be riskTier=sensitive
// 2. Validate target/selector/value against policy
// 3. Mint D_sub:
//    delegator = sessionPrincipal (session EOA OR SessionAgentAccount)
//    delegate  = TOOL_EXECUTOR_<family>_ADDRESS
//    authority = hash(D_root)
//    caveats   = [
//      Timestamp(now, now + 60s),                  // tight window
//      AllowedTargets([target]),
//      AllowedMethods([selector]),
//      ValueEnforcer(value),
//      CallDataHashEnforcer(keccak256(callData)),
//      TaskBindingEnforcer(a2aTaskId),
//    ]
// 4. Sign D_sub with sessionPrincipal:
//    - if EOA session: ECDSA from sessionPrivateKey
//    - if SessionAgentAccount: ERC-1271 (account checks; here a2a-agent's owner key signs)
// 5. Return signed D_sub (envelope only — does NOT submit)
```

### 4.6 Promoted-ops execution flow

```
MCP tool (sensitive tier)
  │ 1. Builds callData
  │ 2. POST a2a /session/:id/sign-subdelegation → { D_sub }
  │ 3. POST a2a /session/:id/submit-subdelegation { D_sub, target, callData }
  ▼
A2a-agent submit endpoint:
  - validates D_sub matches the request again
  - signs redeemDelegation([D_sub, D_root], target, value, callData)
    with TOOL_EXECUTOR_<family>_KEY (= D_sub.delegate)
  - submits, gets receipt
  - revokes hash(D_sub) via DelegationManager.revokeDelegation
  - writes ExecutionReceipt with both rootGrantHash and toolGrantHash
  - returns { txHash, receiptId }
```

Could collapse 2+3 into a single `/session/:id/redeem-subdelegated` for fewer hops.

### 4.7 Org-mcp tool changes

`round:set_awards_root`, `pool:close`, `disbursement:claim`, `outcome:attest`:
- Instead of calling `/session/:id/redeem-tx` (Phase 1 routine path), call `/session/:id/redeem-subdelegated` (Phase 2 sensitive path).
- The decision is automatic from `TOOL_POLICIES[toolName].executionPath`.

### 4.8 Verification

- Forge tests for `TaskBindingEnforcer`, `CallDataHashEnforcer`.
- Forge test for full sub-delegation chain redeem (`[D_sub, D_root]`) — both happy path and tampered sub-delegation.
- **Compromise simulation test:** a2a-agent's session EOA leaked → attacker can issue at most 1 sub-delegation and the in-flight one is single-use. After session revoke, all pending sub-delegations fail. Verify with explicit forge test.
- **Replay defense test:** capture a redeem tx; replay → fails (revocation registry).
- E2E: end-to-end "set awards root" flow from steward UI.

---

## 5. Phase 3 — ERC-7579-compatible SessionAgentAccount

**Goal:** Stateful policy. Long-lived autonomous sessions. Persistent spend caps. Runtime policy install/uninstall. Module-based composition.

**Effort:** ~4-6 weeks. **Risk:** very high (account ABI changes, module storage migration, validator security).

### 5.1 Extend AgentAccount with ERC-7579 install/uninstall

**File:** `packages/contracts/src/AgentAccount.sol`.

Today the account has ERC-7579 introspection only (`accountId() -> "smart-agent.agent-account.1"`). Extend:

```solidity
// New functions (per ERC-7579):
function installModule(uint256 moduleTypeId, address module, bytes calldata initData) external
function uninstallModule(uint256 moduleTypeId, address module, bytes calldata deInitData) external
function isModuleInstalled(uint256 moduleTypeId, address module, bytes calldata additionalContext)
  external view returns (bool)

// Module type IDs (per ERC-7579):
// 1 = validator   (governs userOp validity)
// 2 = executor    (executes account actions)
// 3 = fallback    (handles unsupported selectors)
// 4 = hook        (pre/post execute checks)
```

**Auth on install/uninstall:** only the owner OR an installed validator with admin scope. NOT the DelegationManager (modules change attack surface; require explicit owner).

**Storage:** ERC-7201 namespaced storage (`keccak256("smart-agent.account.modules.v1")` slot) to avoid collisions with existing account storage.

### 5.2 First-party modules

Implement the 5 minimum-viable modules for v1 stateful policy:

#### `ECDSASessionValidator` (validator, type 1)
- Validates userOps signed by a session-bound key.
- Stores `(sessionId → expectedSignerAddress, expiresAt)` in module storage.
- On uninstall: clears entries.

#### `SpendCapHookModule` (hook, type 4)
- Stores `(asset → maxBudget, spent)` per session.
- `preExecute` reads target/value/data; if it's an ERC-20 transfer or ETH value, asserts `spent + amount <= maxBudget`.
- `postExecute` increments `spent`.
- On uninstall: clears.

#### `RateLimitHookModule` (hook, type 4)
- Stores `(window, max, callsInWindow, windowStart)` per session.
- `preExecute` enforces. Resets on window roll.

#### `TargetSelectorAllowlistHookModule` (hook, type 4)
- Stateful (can be updated runtime) version of `AllowedTargetsEnforcer + AllowedMethodsEnforcer`.
- Owner can call `addAllowed(target, selector)` post-install.

#### `RevocationModule` (executor, type 2)
- Single-action executor: revokes a delegation hash via DelegationManager.
- Used for emergency revoke from inside the account (e.g., a hook detects anomaly and self-revokes).

### 5.3 SessionAgentAccountFactory

**File:** new `packages/contracts/src/SessionAgentAccountFactory.sol`.

Deploys a session AgentAccount (extends AgentAccount) and atomically installs configured modules in one transaction. Used by a2a-agent's `/session/init` when policy says `executionPath=session-account`.

```solidity
function deploySession(
  address owner,
  bytes32 salt,
  address[] calldata validators,
  bytes[] calldata validatorInits,
  address[] calldata hooks,
  bytes[] calldata hookInits
) external returns (address account)
```

Owner = a2a-agent's master EOA (so it can sign for the session). Modules pre-configured with the session's policy at deploy time.

### 5.4 a2a-agent session promotion

When `/session/init` receives a request whose ToolPolicy says `stateful`, route to:
- Deploy a SessionAgentAccount via the factory with appropriate modules.
- Owner = a2a-agent's master EOA (one wallet per a2a-agent instance, deployed once).
- Return the account address as `sessionPrincipal`.
- The user's root delegation is `user.smartAccount → sessionAgentAccount` (the deployed account, not an EOA).

For routine and sensitive sessions, keep using EOA session principals — no per-session deploy cost.

### 5.5 Stateful redeem path

a2a-agent's `/session/:id/redeem-tx` gains a new branch: if `sessionPrincipal` is a SessionAgentAccount:
- Build a 4337 UserOperation with the desired call.
- a2a-agent signs the userOp with the master EOA (the validator on the SessionAgentAccount accepts it).
- Submit to EntryPoint via bundler (or a "self-bundler" for local dev).
- Hooks installed on the account run pre/post (spend cap, rate limit, etc.).
- Receipt contains `userOpHash` for cross-correlation in the audit log.

### 5.6 Verification

- Forge tests for each module — install, uninstall, runtime mutation, exhaustion of caps.
- ERC-7579 conformance tests (install/uninstall, isModuleInstalled).
- Integration test: spawn SessionAgentAccount, install SpendCap with budget=10, attempt 11 unit transfers, last reverts.
- Migration test: upgrade an existing session from EOA to SessionAgentAccount mid-flight (not in v1 — verify it reverts cleanly).

---

## 6. Phase 4 — Wallet permission interop (ERC-7715-shaped)

**Goal:** Permission request UX shaped by ERC-7715, internal schema versioned and native. Future external-wallet compatibility without blocking on ERC finalization.

**Effort:** ~1 week. **Risk:** low (UX change; no security boundary changes).

### 6.1 Permission-request schema

**File:** new `packages/sdk/src/permissions/types.ts`.

Internal schema modeled after ERC-7715's `PermissionRequest` with versioning:

```typescript
export interface SessionPermissionRequest {
  schemaVersion: '1.0.0'           // pinned; bump when caveat shape changes
  sessionIntent: string            // human-readable summary
  taskGroupId: string              // groups related tasks
  expiresAt: string                // ISO
  scope: {
    mcpTools: string[]             // names from ToolPolicyRegistry
    targets: Address[]
    selectors: Hex[]
    maxValueWei: string
  }
  rules: {
    rateLimit?: { window: number; max: number }
    spendCap?: { asset: string; max: string }   // requires Phase 3
  }
  revocable: true
  chainId: number
}
```

### 6.2 Permission UI

**File:** new `apps/web/src/app/(authenticated)/sessions/permissions/page.tsx`.

Renders the request in human-readable terms (the user's memo: "the web app should never ask the user to approve an opaque grant"):

```
Agent: Catalyst Network Steward Agent
Session: 24 hours
Allowed actions:
  • Open and configure rounds (8 actions on FundRegistry)
  • Manage pool mandates (5 actions on PoolRegistry)
Limits:
  • No ETH transfer
  • Max 100 ops per hour
  • Auto-expire 2026-05-11 22:00 UTC
Revocable: yes [Revoke now]
```

User signs the underlying delegation (EIP-712); the UI is purely presentational.

### 6.3 Compatibility shim for external wallets

When ERC-7715 stabilizes (or for early experimental support), expose `wallet_grantPermissions` JSON-RPC over our delegation flow. Out of scope for v1; just ensure the internal schema can be mapped to ERC-7715's.

---

## 7. Cross-cutting concerns

### 7.1 Revocation surfaces

| Surface | Phase | What it does |
|---|---|---|
| Per-session revoke (UI) | Phase 1 | `DelegationManager.revokeDelegation(rootHash)` — kills all activity from that session immediately |
| Per-call revoke (auto) | Phase 2 | Sub-delegations revoked after submit (single-use) |
| Per-module disable (UI) | Phase 3 | Owner uninstalls a module on a SessionAgentAccount |
| Emergency self-revoke | Phase 3 | Hook detects anomaly → calls RevocationModule |

### 7.2 Observability

- a2a-agent emits structured logs per redeem (sessionId, mcpServer, mcpTool, target, selector, value, txHash, status, durationMs).
- Audit table query API: `GET /api/admin/audit?sessionId=X&from=Y` for ops review.
- (Future) GraphDB mirror of `execution_audit` for SPARQL queries — out of scope for v1.

### 7.3 Testing strategy

| Layer | Tooling | Phase |
|---|---|---|
| Caveat enforcer unit tests | Forge | 1, 2 |
| Module unit tests | Forge | 3 |
| Sub-delegation chain validation | Forge | 2 |
| Compromise simulation (key leak) | Forge + scenario test | 2 |
| MCP-to-a2a-agent inter-service auth | TS unit (HMAC verify) | 1 |
| End-to-end user flow | Playwright (`tests/e2e/`) | 1, 2, 3 |
| Permission UI | Playwright | 4 |
| Performance (deploy cost, redeem gas) | forge gas snapshot | 3 |

### 7.4 Migration / rollout

Per CLAUDE.md: "no backwards-compat — fresh-start.sh re-seeds." Each phase ships behind a fresh-start. No data migration required.

For deploy ordering:
1. Deploy new contracts (enforcers, factory, modified AgentAccount).
2. Update `Deploy.s.sol` to register new contracts + propagate addresses to env.
3. Update `deploy-local.sh` for any new env vars.
4. Run `fresh-start.sh` → e2e + manual verification.

---

## 8. Phased deliverables and verification gates

| Phase | Deliverables | Gate to next phase |
|---|---|---|
| Pre-work | ToolPolicyRegistry; audit schema; HMAC keys | All MCPs enumerated; CI check passes |
| Phase 1 | Single-delegation flow; a2a-agent redeem endpoint; D_onchain retired | E2E suite green; forge tests pass; manual pool/round flows from UI work |
| Phase 2 | TaskBindingEnforcer; CallDataHashEnforcer; sub-delegation flow; per-tool executors; promoted ops migrated | Forge sub-delegation chain tests pass; compromise simulation passes; promoted-ops e2e tests added and pass |
| Phase 3 | ERC-7579 install/uninstall on AgentAccount; 5 first-party modules; SessionAgentAccountFactory; stateful session-account branch in a2a-agent redeem | Module unit tests pass; SpendCap exhaustion test passes; one promoted op runs through SessionAgentAccount path end-to-end |
| Phase 4 | Permission UI; SessionPermissionRequest schema; revocation UX | UX review approval; permission UI renders all current ToolPolicies correctly |

---

## 9. Risks and mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Sub-delegation chain validation has a subtle bug (Phase 2) | High | Multiple independent forge tests; reuse DelegationManager's existing chain validation; require code review on every Phase 2 commit |
| ERC-7579 install/uninstall storage layout collides with existing AgentAccount storage (Phase 3) | High | ERC-7201 namespaced storage slots; storage layout test in forge |
| Session key compromise during the 60s sub-delegation window before next call | Medium | Single-use nonces (revocation-after-use); short Timestamp caveat on D_sub (60s); rate-limit on sub-delegation issuance |
| MCP server compromise → can request unauthorized redeems | Medium | HMAC inter-service auth; ToolPolicy validates target/selector at a2a-agent boundary; per-tool executor identities limit blast radius |
| First-party module bug leaks budget/auth | High | Forge tests for each module; require external review before mainnet-equivalent deployment |
| ERC-7579 / ERC-7710 / ERC-7715 evolve in incompatible ways | Low-Medium | First-party schemas with `schemaVersion` field; adapter layer between internal types and external ERC-7715 wallet RPC; monitor EIP status |
| Phase 2 single-use revocation costs an extra tx per call | Low (gas) | Acceptable for sensitive ops; revisit if usage patterns demand batching |
| User confusion about per-session permission scope (Phase 4) | Medium | UI must render in human-readable terms; copy review with UX designer; dry-run with one demo user before broad rollout |

---

## 10. What's deferred / explicitly out of scope

- **Third-party modules** (ERC-7484 attestation registry adapter). v1 is first-party only.
- **On-chain ToolPolicyRegistry contract.** v1 uses TypeScript first-party policy. On-chain registry is a future hardening.
- **Cross-chain delegations.** All delegations bind `chainId`; cross-chain replay defended by signature, but cross-chain orchestration is out of scope.
- **Public reputation / module marketplace.** Far future.
- **Permanent long-lived session accounts** (i.e., > 30 days). Phase 3 supports stateful sessions but recommended max is 7 days; longer requires explicit re-grant.
- **Mobile wallet integration** with ERC-7715. Out of v1 scope; designed for future addition.
- **GraphDB audit mirror.** ExecutionReceipts stay in a2a-agent SQLite for v1; SPARQL access is a follow-up.

---

## 11. Suggested execution order (week-by-week)

| Week | Work |
|---|---|
| **W1** | Pre-work: ToolPolicyRegistry + audit schema + HMAC infrastructure. Phase 1.1-1.2 (richer caveats + a2a redeem endpoint). |
| **W2** | Phase 1.3-1.6 (org-mcp routes through a2a; drop D_onchain; pool agent deploy moves). Verify with full E2E. |
| **W3** | Phase 2.1-2.3 (new enforcers + revocation flow). Forge tests. |
| **W4** | Phase 2.4-2.7 (per-tool executors + sub-delegation flow + promoted ops migration). Compromise simulation tests. |
| **W5-W6** | Phase 3.1-3.3 (ERC-7579 install/uninstall on AgentAccount + 5 modules). |
| **W7** | Phase 3.4-3.6 (factory + a2a session promotion + stateful redeem path). |
| **W8** | Phase 4 (permission UI + schema). Final integration test. |

Each week ends with `fresh-start.sh` + e2e verification. Any failure blocks the next phase.

---

## 12. Decision-record summary

**Decision:** Adopt the hybrid native delegation architecture with ERC-7579 as the modular-account compatibility surface. Implement in 4 phases, each strictly additive.

**Architectural invariants enforced by every phase:**
1. One root authority per session (no side-channels).
2. MCP servers are coordinators, not principals.
3. Risk tier governs execution path (declared in ToolPolicyRegistry).
4. First-party modules only; no third-party install at v1.
5. ERC-7579 is the compatibility target, not a per-session tax.
6. Every action traceable: user grant → session/task → MCP call → on-chain tx.

**Differentiator stated:**
> User-approved, cryptographically attenuated authority for autonomous agents, where every action is traceable from user grant → session/task → MCP tool → on-chain transaction, and enforcement happens at the account/delegation boundary rather than inside an app-server ACL.

**Cross-references:**
- Trade-offs analysis: `output/delegation-architecture-tradeoffs.md`
- Architectural decision memo: 2026-05-10
- Memory: `project_pool_management_in_org_mcp.md`, `project_mcp_onchain_auth.md`
