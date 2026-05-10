# Phase 3 — ERC-7579 SessionAgentAccount Summary

**Status:** complete; verified by 360 forge tests + 4-package typecheck
**Date:** 2026-05-10
**Source plan:** `output/delegation-implementation-plan.md` §5

---

## What Phase 3 ships

Adds the **stateful session-account execution path**: a deployed ERC-7579-
shaped `SessionAgentAccount` whose installed first-party modules enforce
persistent spend caps, rate limits, and target/selector allowlists at every
call. This is the third tier in the delegation refactor's risk-tiered
execution model:

```
routine  → stateless-redeem path  (Phase 1)
sensitive → sub-delegated path     (Phase 2)
stateful → session-account path    (Phase 3 — THIS)
```

The infrastructure is wired end-to-end: contracts + factory + a2a-agent
session bootstrap + a2a-agent self-bundler redeem endpoint + deploy script
propagation. No tools are currently classified `stateful` in
`TOOL_POLICIES` — that's intentional. Phase 3 ships the rails; specific
tools migrate to the new path as their owners declare it.

---

## Files added

| Path | Purpose |
|---|---|
| `packages/contracts/src/modules/ECDSASessionValidator.sol` | Type-1 validator. `(account → sessionId → {expectedSigner, expiresAt})` map. `validateUserOp` accepts raw-hash or eth-signed-message ECDSA from the pinned signer; returns `1` (never reverts) on failure for bundler-friendly validation. |
| `packages/contracts/src/modules/SpendCapHookModule.sol` | Type-4 hook. Per-(account, asset) budget. preCheck rejects pre-call when `spent + amount > max`; postCheck commits the charge. Self-calls skipped, ERC-20 `transfer(address,uint256)` detected via selector `0xa9059cbb`, native ETH keyed at `address(0)`. |
| `packages/contracts/src/modules/RateLimitHookModule.sol` | Type-4 hook. Rolling-window call cap (`windowSeconds`, `maxCalls`). Resets on window roll. |
| `packages/contracts/src/modules/TargetSelectorAllowlistHookModule.sol` | Type-4 hook. Per-account `(target, selector)` allowlist; runtime-mutable via `addAllowed` / `removeAllowed`. Self-calls + calls back to the module itself auto-allowed. |
| `packages/contracts/src/modules/RevocationModule.sol` | Type-2 executor. Single action: `revoke(bytes32 hash)` calls `DelegationManager.revokeDelegation` from the calling account. Stores DM address at install. |
| `packages/contracts/src/SessionAgentAccountFactory.sol` | Wraps `AgentAccountFactory` to deploy a proxy with two co-owners (`owner` user-supplied + the factory itself) and atomically install all configured validators + hooks. Factory remains a co-owner post-deploy as a documented liability — no callbacks, removable by user. |
| `packages/contracts/test/AgentAccountModules.t.sol` | 21 tests covering install/uninstall/hooks/namespaced storage. |
| `packages/contracts/test/SpendCapModule.t.sol` | 7 tests. |
| `packages/contracts/test/RateLimitModule.t.sol` | 5 tests. |
| `packages/contracts/test/TargetSelectorAllowlist.t.sol` | 6 tests. |
| `packages/contracts/test/ECDSASessionValidator.t.sol` | 9 tests. |
| `packages/contracts/test/RevocationModule.t.sol` | 6 tests. |
| `packages/contracts/test/SessionAgentAccountFactory.t.sol` | 5 tests. |
| `packages/contracts/test/Phase3Integration.t.sol` | 4 tests — end-to-end spend-cap exhaustion (10 succeed, 11th reverts) + uninstall + rate-limit + accountId bump. |
| `output/phase3-erc7579-summary.md` | This file. |

## Files edited

| Path | Change |
|---|---|
| `packages/contracts/src/AgentAccount.sol` | Added the full ERC-7579 install/uninstall surface (`installModule`, `uninstallModule`, `isModuleInstalled`, `supportsModule`, `supportsExecutionMode`, `getInstalledModules`). Added ERC-7201 namespaced storage at slot `0x1f14a6accceab237b8ab0463623403008b2dec742c79d1d0e63a7729f8c11c00`. Overrode `execute` to run installed hooks' pre/postCheck around the call. Added `MAX_HOOKS=8` cap. Bumped `accountId()` to `"smart-agent.agent-account.2"`. Added the `IERC7579ModuleLike` + `IERC7579HookLike` inline interfaces at file bottom for the calls into modules. |
| `packages/contracts/src/modules/IERC7579Module.sol` | Added `IERC7579ModuleLifecycle` extension interface (adds `onInstall`/`onUninstall` to the base introspection interface). Base unchanged so the existing enforcer/validator implementations remain valid. |
| `packages/contracts/script/Deploy.s.sol` | Deploys the 5 first-party modules + `SessionAgentAccountFactory`. Emits 6 new env lines. |
| `packages/sdk/src/abi.ts` | Added `sessionAgentAccountFactoryAbi`. |
| `packages/sdk/src/index.ts` | Re-exports `sessionAgentAccountFactoryAbi`. |
| `apps/a2a-agent/src/config.ts` | Added 7 new config fields: `ENTRYPOINT_ADDRESS`, `SESSION_AGENT_ACCOUNT_FACTORY_ADDRESS`, `ECDSA_SESSION_VALIDATOR_ADDRESS`, `SPEND_CAP_HOOK_ADDRESS`, `RATE_LIMIT_HOOK_ADDRESS`, `TARGET_SELECTOR_ALLOWLIST_HOOK_ADDRESS`, `REVOCATION_MODULE_ADDRESS`, `A2A_MASTER_EOA_PRIVATE_KEY`. |
| `apps/a2a-agent/src/db/index.ts` | Added `session_agent_account TEXT` column to `sessions`. Added a `PRAGMA table_info` migration guard so existing DBs add the column on next boot. |
| `apps/a2a-agent/src/db/schema.ts` | Mirror — added `sessionAgentAccount: text('session_agent_account')`. |
| `apps/a2a-agent/src/routes/session.ts` | Extended `POST /session/init` to accept `stateful: boolean` + `policy: { spendCap?, rateLimit?, allowedCalls? }`. When `stateful=true`, deploys a `SessionAgentAccount` via the factory (signed by the master EOA), installs the configured modules, and stores the deployed address on the session row. Returns `sessionAgentAccount` in the response. |
| `apps/a2a-agent/src/routes/onchain-redeem.ts` | Added `POST /session/:id/redeem-via-account`. Builds a 4337 UserOperation, signs with the session EOA, submits to EntryPoint.handleOps as the self-bundler (master EOA pays gas). Records `executionPath='session-account'` + `userOpHash` in the audit row. |
| `scripts/deploy-local.sh` | Extracts + propagates the 6 new addresses from the deploy output. Writes them to `apps/web/.env` and `apps/a2a-agent/.env`. Adds `A2A_MASTER_EOA_PRIVATE_KEY` (anvil account #1) + `ENTRYPOINT_ADDRESS` to a2a-agent's env. Funds the master EOA with 10 ETH via `anvil_setBalance`. |

---

## ERC-7201 storage slot

```
slot = keccak256(abi.encode(uint256(keccak256("smart-agent.account.modules.v1")) - 1)) & ~bytes32(uint256(0xff))
     = 0x1f14a6accceab237b8ab0463623403008b2dec742c79d1d0e63a7729f8c11c00
```

Computed via chisel:
```solidity
keccak256(abi.encode(uint256(keccak256("smart-agent.account.modules.v1")) - 1)) & ~bytes32(uint256(0xff))
```

Verified non-collision in `test_namespaced_storage_does_not_collide` — install a hook,
then perform `setDelegationManager` + `addOwner` on the account, and assert the
hook flag + enumerable list remain intact.

---

## Auth model

| Operation | Caller | Notes |
|---|---|---|
| `installModule` | Owner OR self (via UserOp) | Reuses existing `_owners` mapping + adds the `onlyOwnerOrSelf` modifier. NOT the DelegationManager — module changes are too sensitive to delegate. |
| `uninstallModule` | Owner OR self | Loud failure — if `onUninstall` reverts, the uninstall reverts. (`installModule` rolls back its storage write on `onInstall` failure.) |
| `addAllowed` (on TargetSelectorAllowlistHook) | Anyone (per-account scoped) | The module is keyed by `msg.sender = account address`, so external EOAs only mutate their own (empty) entry. Real use: account self-executes a call to `module.addAllowed(...)`. |
| `revoke` (on RevocationModule) | Anyone (per-account scoped) | Reverts unless the calling account previously installed the module. Real use: account self-execute. |
| Hook pre/postCheck | Account (during `execute`) | Hooks loop in install order. preCheck reverts ⇒ execute reverts before the call. postCheck reverts ⇒ execute reverts after the call (state rolls back). Capped at 8 hooks per account. |

---

## A2a-agent stateful session flow

### `POST /session/init` (extended)

```ts
// New optional body fields:
//   stateful?: boolean
//   policy?: {
//     spendCap?: { asset: Address; max: bigintString }[]
//     rateLimit?: { windowSeconds: number; maxCalls: number }
//     allowedCalls?: { target: Address; selector: Hex }[]
//   }
//
// When stateful=true:
//   1. Generate ephemeral session keypair (unchanged).
//   2. Call SessionAgentAccountFactory.deploySession(
//        owner=sessionKeyEoa,         // primary owner (signs UserOps)
//        salt=keccak256(user, sessionId),
//        validators=[ECDSASessionValidator(sessionKey, expiresAt)],
//        hooks=[
//          spendCap ? SpendCapHook(assets,budgets) : -,
//          rateLimit ? RateLimitHook(window,max)   : -,
//          allowedCalls ? AllowlistHook(targets,sels) : -,
//        ],
//      ) signed by config.A2A_MASTER_EOA_PRIVATE_KEY.
//   3. Store the deployed address as sessions.session_agent_account.
//   4. Return { sessionId, sessionKeyAddress, sessionAgentAccount, durationSeconds, expiresAt }.
```

### `POST /session/:id/redeem-via-account`

```ts
// Auth: HMAC inter-service.
// Body: { mcpTool, mcpCallId, a2aTaskId?, target, value, callData }
// Required: TOOL_POLICIES[mcpTool].executionPath === 'session-account'.
// Required: session.session_agent_account is set.
//
// Flow:
//   1. Validate policy + target + selector.
//   2. Build a 4337 UserOperation:
//        sender   = sessionAgentAccount
//        callData = AgentAccount.execute(target, value, data)
//        nonce    = EntryPoint.getNonce(sender, 0)
//        gas      = (verification=500k, call=1.5M, preVerify=100k, fee=1 gwei)
//        signature = ECDSA(userOpHash) signed by sessionKey EOA
//   3. EntryPoint.handleOps([op], beneficiary=masterEoa)
//      — self-bundler. Master EOA pays gas.
//   4. Installed hooks fire pre/post the inner execute call.
//   5. Audit row: executionPath='session-account', userOpHash filled.
```

---

## Policy → module mapping

When web or a2a-agent decides a tool should use the stateful path, the
ToolPolicy entry declares `executionPath: 'session-account'`. The session
init request then includes a `policy` object whose fields select which
hooks to install:

| Policy field | Module installed | Init payload |
|---|---|---|
| `spendCap: [{ asset, max }]` | `SpendCapHookModule` | `abi.encode(address[], uint256[])` |
| `rateLimit: { windowSeconds, maxCalls }` | `RateLimitHookModule` | `abi.encode(uint256, uint256)` |
| `allowedCalls: [{ target, selector }]` | `TargetSelectorAllowlistHookModule` | `abi.encode(address[], bytes4[])` |
| (always installed) | `ECDSASessionValidator` | `abi.encode(bytes32 sessionId, address signer, uint256 expiresAt)` |

The ECDSASessionValidator is installed unconditionally because the
session-key EOA needs an explicit, time-bounded authorization record on
the account. (The session-key is ALSO the primary owner from
`initialize`, so the standard ECDSA path in `_validateSignature` also
admits its signatures — the validator is the canonical record for
future expiry checks + per-session revocation.)

---

## Known gotchas

### Factory remains a co-owner post-deploy

`SessionAgentAccountFactory.deploySession` passes `(owner, address(this), dm)`
to `initialize`. Two owners get set: the supplied owner (session-key EOA)
AND the factory. This is because `installModule` is owner-gated and the
factory needs to install modules atomically with deploy.

The factory has no callback functions that touch the account after this,
so it's effectively inert. **The user can `account.removeOwner(factory)`
from any UserOp at any time to clean up the ownership set.**

A more clinical fix would be a one-shot owner-add init helper on AgentAccount;
deferred as it'd touch the existing initialize signature and risk regressions.
Documented here so future maintenance is aware.

### Session-key EOA is the SessionAgentAccount's owner, not the user

Per the architecture invariants, "user is the principal" — but the user
controls the SessionAgentAccount via the *delegation chain*
(`user.smartAccount → sessionAgentAccount`), NOT via direct ownership.
This keeps the per-session blast radius bounded: a compromise of the
session-key EOA can only do what the user's root delegation allows AND
what the installed hooks permit.

If a future use case needs the user to directly own the SessionAgentAccount
(e.g., emergency withdrawal), the user can `addOwner(self)` via a
delegation-redeemed `execute(account, addOwner(user))` call — at the
cost of broadening attack surface.

### `_validateSignature` doesn't dispatch to validator modules

For v1, the SessionAgentAccount accepts UserOp signatures via the existing
ECDSA path on AgentAccount — the session-key EOA is an `_owners` entry
from `initialize`, so its sig validates naturally. The
`ECDSASessionValidator` module is installed as a record of authorization
+ for future use (e.g., a Phase 4 path where the session-key isn't a
direct owner but only validates via the module). Today the validator is
an introspection + audit anchor more than a runtime gate.

A future Phase 3.1 could extend `_validateSignature` to dispatch through
installed validator modules — useful for multi-validator setups (e.g.,
"either an owner sig OR a session-validator sig"). Not in v1; the simple
shared model keeps the auth path easy to reason about.

### Hook execution mode

Hooks run during AgentAccount.execute, NOT during validateUserOp. This
means:
- Pre/postCheck reverts unwind the call inside `handleOps` ⇒ EntryPoint
  emits `UserOperationRevertReason`. The userOp is still consumed (nonce
  advances). Acceptable.
- Hooks can read `msg.sender` (the entrypoint), `value`, and the
  abi-encoded `(target, value, data)` via the `msgData` arg. They cannot
  inspect the userOp directly.

If a Phase 3.1 wants validation-phase hooks (e.g., gas-cap enforcement),
that'd land as a separate type in the ERC-7579 spec; v1 implements only
`MODULE_TYPE_HOOK = 4` which runs around execute.

### Self-bundler is dev-only

`POST /session/:id/redeem-via-account` calls `EntryPoint.handleOps` from
the master EOA directly — no external bundler. This is correct for local
anvil but skips the bundler's simulation, gas-pricing, and
priority-fee bidding logic. For non-local environments, swap in a real
bundler (alto, stackup, etc.) and pass the userOp to its RPC.

### Hook count cap

`MAX_HOOKS = 8` per account. With 5 first-party modules, this leaves
headroom for one or two custom hooks; if a use case wants more, lift the
cap (gas implications: each hook is a CALL + abi-decode per execute).

### ENTRYPOINT_ADDRESS may be zero address on first boot

If `deploy-local.sh` hasn't been run against an anvil that's already had
the canonical EntryPoint deployed at `0x0000000071727De22E5E9d8BAf0edAc6f37da032`,
the `ENTRYPOINT_ADDRESS` env var is the locally-deployed one. The redeem
endpoint reads it from `config.ENTRYPOINT_ADDRESS` so both paths work.
Make sure `fresh-start.sh` is run before exercising the stateful path.

---

## Verification

| Surface | Result |
|---|---|
| `forge build` | clean (3.s warnings only — pre-existing lint notes on unrelated files) |
| `forge test --match-contract "AgentAccountModulesTest"` | 21 / 21 |
| `forge test --match-contract "SpendCapModuleTest"` | 7 / 7 |
| `forge test --match-contract "RateLimitModuleTest"` | 5 / 5 |
| `forge test --match-contract "TargetSelectorAllowlistTest"` | 6 / 6 |
| `forge test --match-contract "ECDSASessionValidatorTest"` | 9 / 9 |
| `forge test --match-contract "RevocationModuleTest"` | 6 / 6 |
| `forge test --match-contract "SessionAgentAccountFactoryTest"` | 5 / 5 |
| `forge test --match-contract "Phase3IntegrationTest"` | 4 / 4 |
| `forge test --match-contract "AgentAccountTest"` (regression) | 32 / 32 |
| `forge test` (full suite) | **360 / 360** (was 297 at Phase 2 end → +63 new tests) |
| `pnpm --filter @smart-agent/sdk typecheck` | clean |
| `pnpm --filter @smart-agent/a2a-agent typecheck` | clean |
| `pnpm --filter @smart-agent/org-mcp typecheck` | clean |
| `pnpm --filter @smart-agent/web typecheck` | clean |

E2E with the new env layout is left for the user — `scripts/fresh-start.sh`
will pick up the new env vars + funded master EOA. The stateful path has
no TOOL_POLICY entries yet, so no UI flow exercises it; verification is
via the contract tests + the integration test that proves spend-cap
exhaustion.

---

## Follow-ups (Phase 3.1+ candidates)

1. **Promote a real tool to the stateful path.** Pick a candidate (the plan
   suggests "autonomous-agent ops" or "multi-call spend") and set
   `TOOL_POLICIES[tool].executionPath = 'session-account'`. Wire its
   handler to call `/session/:id/redeem-via-account`.

2. **Validator dispatch in `_validateSignature`.** Today the session EOA
   is an owner; tomorrow a Phase 3.1 could route via the validator module
   for cleaner separation between owners + session signers.

3. **Atomic ownership cleanup.** The factory remains a co-owner — a
   one-shot init helper on AgentAccount would let the factory cleanly
   self-evict without leaving the residue.

4. **External bundler integration.** Today the self-bundler in
   `redeem-via-account` works for anvil; for testnets we want a real
   bundler RPC. Adapter pattern: swap the `EntryPoint.handleOps` call
   for a bundler `eth_sendUserOperation` JSON-RPC.

5. **Module versioning + upgrade.** Currently a module install carries the
   module's address. If we ship `SpendCapHookModule.2`, accounts on `.1`
   must explicitly uninstall + reinstall. A Phase 3.2 could add a hot
   migration path via the `RevocationModule` pattern.

6. **GraphDB mirror for execution_audit rows tagged session-account.**
   Phase 1 deferred this; the `userOpHash` column is now populated for
   the new path, ready for SPARQL once the mirror exists.
