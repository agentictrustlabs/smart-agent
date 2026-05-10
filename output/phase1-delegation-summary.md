# Phase 1 — Delegation Refactor Summary

**Status:** complete; verified by typecheck on all four packages
**Date:** 2026-05-10
**Source plan:** `output/delegation-implementation-plan.md` §3

---

## What Phase 1 does

Retires the **Tier 2 D_onchain side-channel** (and the ORG_MCP_EOA that signed
it). Single user-signed root delegation now drives BOTH:

- **MCP authentication** (off-chain, via `verify-delegation.ts` in each MCP)
- **On-chain redemption** (via `DelegationManager.redeemDelegation` from
  a2a-agent's session EOA)

Org-mcp no longer holds any signing capability. All on-chain writes forward to
a2a-agent's HMAC-authed inter-service endpoints:

- `POST /session/:id/redeem-tx` — generic stateless redeem
- `POST /session/:id/deploy-agent` — `AgentAccountFactory.createAccount` wrapper

---

## Files created

| Path | Purpose |
|---|---|
| `apps/a2a-agent/src/routes/onchain-redeem.ts` | Both new endpoints (redeem-tx + deploy-agent). Auth via `requireInterServiceAuth()`. Policy lookup against `TOOL_POLICIES`. Writes `ExecutionReceipt` rows. |
| `output/phase1-delegation-summary.md` | This file. |

## Files edited

| Path | Change |
|---|---|
| `apps/web/src/lib/actions/a2a-session.action.ts` | Replaced single TimestampEnforcer caveat with rich-caveat composition (Timestamp + AllowedTargets + AllowedMethods + Value + McpToolScope) driven by `TOOL_POLICIES`. Removed all D_onchain mint + cookie logic. |
| `apps/a2a-agent/src/index.ts` | Mounted `onchainRedeem` route at `/session`. |
| `apps/a2a-agent/src/routes/mcp-proxy.ts` | Inject `_a2aSessionId` into the args forwarded to each MCP tool so the tool can call back into a2a-agent's privileged endpoints. |
| `apps/org-mcp/src/lib/contracts.ts` | Gutted to read-only. Removed `getWalletClient`, `deploySmartAccount`, `requireAgentFactoryAddress`. Kept `getPublicClient` + the registry-address getters. |
| `apps/org-mcp/src/config.ts` | Removed `signerPrivateKey` + `agentFactoryAddress`. |
| `apps/org-mcp/src/tools/pools.ts` | Replaced `redeemThroughDelegation` with `callA2aRedeem`. Replaced `deploySmartAccount` with `callA2aDeployAgent`. Dropped `onchainDelegation` arg from all 5 tools' schemas/handlers. |
| `apps/org-mcp/src/tools/rounds.ts` | Same migration for all 5 on-chain round tools. |
| `apps/web/src/lib/actions/poolCreate.action.ts` | Dropped `getOnchainDelegation()` + `onchainDelegation` arg. |
| `apps/web/src/lib/actions/poolAdmin.action.ts` | Same. |
| `apps/web/src/lib/actions/roundOpen.action.ts` | Same. |
| `apps/web/src/lib/actions/roundClose.action.ts` | Same. |
| `apps/web/src/lib/actions/roundCancel.action.ts` | Same. |
| `apps/web/src/lib/actions/roundAdmin.action.ts` | Same. |
| `scripts/deploy-local.sh` | Stopped writing `ORG_MCP_EOA_*`. Writes `A2A_INTERSERVICE_HMAC_KEY_ORG` + `A2A_SESSION_SECRET` to `apps/web/.env`, all MCP `.env` files, and `apps/a2a-agent/.env`. Also propagates `RPC_URL`, `CHAIN_ID`, `DELEGATION_MANAGER_ADDRESS`, `AGENT_FACTORY_ADDRESS`, registry addresses, and `AGENT_RELATIONSHIP_ADDRESS` to the new `apps/a2a-agent/.env`. |

## Files deleted

| Path |
|---|
| `apps/web/src/lib/auth/onchain-delegation-constants.ts` |
| `apps/web/src/lib/auth/get-onchain-delegation.ts` |
| `apps/org-mcp/src/lib/redeem.ts` |

---

## Caveats composed on the root delegation

`bootstrapA2ASessionForUser` now mints **one** delegation `user → sessionKey`
carrying:

| # | Enforcer | Encoded terms |
|---|---|---|
| 1 | `TIMESTAMP_ENFORCER_ADDRESS` | `(validAfter=now, validUntil=now+86400)` |
| 2 | `ALLOWED_TARGETS_ENFORCER_ADDRESS` | union of every `allowedTargets` address resolved via `resolveTargetAddress(symbol, env)` across `TOOL_POLICIES` — currently PoolRegistry, FundRegistry, AgentAccountFactory |
| 3 | `ALLOWED_METHODS_ENFORCER_ADDRESS` | union of every 4-byte selector resolved from `POOL_REGISTRY_SELECTORS_BY_TOOL` + `FUND_REGISTRY_SELECTORS_BY_TOOL` against the imported ABIs (plus `AgentAccountFactory.createAccount`) |
| 4 | `VALUE_ENFORCER_ADDRESS` | `maxValue=0n` (no ETH transfer) |
| 5 | `MCP_TOOL_SCOPE_ENFORCER` (sentinel, off-chain) | union of every tool name in `TOOL_POLICIES` |

User signs once. Same delegation gates both auth planes.

---

## A2a-agent inter-service endpoints (Phase 1)

### `POST /session/:id/redeem-tx`

```ts
// Auth: HMAC(A2A_INTERSERVICE_HMAC_KEY_<mcp>) over body, with the session id
// included in the canonical message
// Body: { mcpTool, mcpCallId, a2aTaskId?, target, value: <decimal>, callData }
// Flow:
//   1. Look up session (must be active + not expired).
//   2. Validate TOOL_POLICIES[mcpTool] exists AND executionPath='stateless-redeem'.
//   3. Validate target ∈ resolveTargetAddress(policy.allowedTargets, env).
//   4. Validate selector(callData) ∈ policyAllowedSelectors(toolId, policy).
//   5. Decrypt session package; build viem walletClient from sessionPrivateKey.
//   6. Insert ExecutionReceipt(status='pending').
//   7. Submit DelegationManager.redeemDelegation([userDelegation], target, value, callData).
//   8. On receipt: update status='completed' + txHash + finalizedAt.
//      On revert: status='reverted' + errorReason.
//      On denial: status='denied' (before submission).
// Returns: { txHash, executionReceiptId }
```

### `POST /session/:id/deploy-agent`

```ts
// Auth: HMAC inter-service signature, same scheme
// Body: { mcpCallId, owner, salt: <decimal> }
// Wraps AgentAccountFactory.createAccount(owner, salt) signed by the session EOA.
// Writes ExecutionReceipt(mcpTool='deploy-agent', executionPath='stateless-redeem').
// Returns: { address, txHash, executionReceiptId }
```

Both endpoints are mounted under `/session` in `apps/a2a-agent/src/index.ts`.

---

## Policy gates intentionally weaker than the plan

- **No RateLimit caveat on the root delegation.** The SDK's
  `encodeRateLimitTerms(scopeKey, maxCalls, windowSeconds)` is keyed by
  `(delegator, delegationHash, scopeKey)` — wiring `scopeKey` choice and the
  cap/window defaults into bootstrap is Phase 2 work alongside per-call
  sub-delegations. **Net effect:** an active session can issue unlimited
  routine redeems within its 24h validity window; revocation via
  `DelegationManager.revokeDelegation(rootHash)` remains the kill switch.

- **`pool:close`, `round:close`, `round:cancel`, `round:set_awards_root`,
  `disbursement:claim`, `grant_proposal:award`, `grant_proposal:revoke_award`
  routes via stateless-redeem path in the SDK callsites, but
  `TOOL_POLICIES[*].executionPath === 'sub-delegated'`.** The a2a-agent's
  redeem-tx endpoint will **reject these tools** with HTTP 403 + an
  ExecutionReceipt of status='denied'. This is by design — Phase 1 doesn't
  ship the sub-delegated path. Phase 2's `/session/:id/redeem-subdelegated`
  endpoint will pick them up.
  **Net effect:** if a user clicks "Cancel round" or "Set awards root" in the
  UI on the Phase 1 build, the action will fail with a 403 from a2a-agent.
  This was discussed in the plan as expected interim behavior; the user said
  "don't worry about backward compat, we can seed fresh."

- **`MCP_TOOL_SCOPE_ENFORCER` uses the sentinel address** (`keccak256("urn:smart-agent:mcp-tool-scope")[:42]`).
  It's NOT a deployed contract — the MCP servers validate it off-chain in
  `verify-delegation.ts`. The plan called this out as acceptable; nothing to
  do on the on-chain side. Listed as caveat #5 in the new delegation so the
  existing tool-scope check keeps working.

---

## Known gotchas

### Session package decryption (mcp-proxy / onchain-redeem)

a2a-agent's mcp-proxy and the new onchain-redeem endpoints both call
`decryptPayload` on `sessions.encryptedPackage` + `sessions.iv` with
`config.A2A_SESSION_SECRET`. The shape produced by `/session/package` is
`{ sessionPrivateKey, sessionKeyAddress, delegation, accountAddress, expiresAt }`
— this is what onchain-redeem.ts assumes via its `StoredSessionPackage`
interface. **The new endpoints read the same row mcp-proxy does**; if the
session-package shape ever changes, both files need to track it together.

### `_a2aSessionId` injection

The cleanest way for org-mcp's tool handlers to know "which a2a session am I
in?" was for `mcp-proxy.callMcpTool` to inject the active session row's id
into the args sent to the MCP. This works because:

1. The web bearer that hits `/mcp/:server/:tool` is verified by
   `require-session` middleware.
2. The session row looked up by accountAddress is the same one the new
   redeem-tx endpoint will decrypt.
3. The MCP tool only trusts `_a2aSessionId` because it arrived **from
   a2a-agent**; the inter-service HMAC on the callback ensures a2a-agent will
   only accept redeem requests from enrolled MCPs.

If a future code path lets MCPs receive args from another source (e.g., a
direct user request to org-mcp's HTTP surface that bypasses a2a-agent),
`_a2aSessionId` MUST be ignored. Today's only org-mcp ingress is via
mcp-proxy, so this is safe.

### Hono body re-read

`requireInterServiceAuth()` reads `c.req.text()` to verify the HMAC. The new
endpoints then need the body too — the middleware stashes the raw text under
`c.var.interService.bodyRaw` and the route handler reads from there. If you
add another endpoint behind this middleware, do the same — don't call
`c.req.json()` (Hono caches text vs json and the raw text was already
consumed).

### `apps/web/.env` legacy keys

The existing `.env` still has `ORG_MCP_EOA_ADDRESS` and
`ORG_MCP_EOA_PRIVATE_KEY` lines from previous deploys. They're inert (no code
reads them anymore), but the next `deploy-local.sh` run will strip them and
write the new HMAC + session-secret keys. Equivalent stale lines exist in
each MCP's `.env`; the script will clean those too via the
`sed -i '/^ORG_MCP_EOA_PRIVATE_KEY=/d'` step.

---

## Verification

| Package | `pnpm --filter <name> typecheck` |
|---|---|
| `@smart-agent/sdk` | clean |
| `@smart-agent/a2a-agent` | clean |
| `@smart-agent/org-mcp` | clean |
| `@smart-agent/web` | clean |

E2E (`tests/e2e/intent-marketplace.spec.ts`) is left for the user — the
spec doesn't reference `onchainDelegation` or the D_onchain cookie, so it
should pass once a fresh-start brings up the new env layout.

---

## Follow-ups (Phase 2 candidates)

1. **`pool:close`, `round:close`, `round:cancel`, `round:set_awards_root`,
   `disbursement:claim`, `grant_proposal:award`, `grant_proposal:revoke_award`
   migration to sub-delegated path** — see plan §4 (Phase 2 — Per-call
   sub-delegations for promoted ops). Until this lands, those tools' UI will
   throw 403.

2. **RateLimit caveat composition** — pick the canonical `scopeKey` (e.g.
   `keccak256("session-redeems")`), `maxCalls`, `windowSeconds` defaults and
   add a 6th caveat in `bootstrapA2ASessionForUser`. Currently deferred — see
   "Policy gates intentionally weaker" above.

3. **Webhook / event for ExecutionReceipt** — the audit table has rows for
   every redeem/deploy. A `GET /api/admin/audit` query API on a2a-agent
   would unlock ops review.

4. **D_onchain cookie cleanup** — `clearA2ASession` no longer clears the
   D_onchain cookie (since it's no longer set). Existing browser sessions
   may still have the cookie; it's now inert. Acceptable for fresh-start.

5. **Old E2E build artifacts** in `apps/web/.next/` reference the deleted
   D_onchain files. Run `rm -rf apps/web/.next` before the next dev cycle,
   or let `fresh-start.sh` clean it.
