# Tier 1 — Pool/Round CRUD Relocated to org-mcp

Status: T1.2 / T1.3 / T1.4 / T1.5 complete. All three typechecks pass clean
(`@smart-agent/sdk`, `@smart-agent/org-mcp`, `@smart-agent/web`).

## Files created

- `apps/org-mcp/src/tools/pools.ts` — re-introduced after Phase 6 deletion.
  Exports `poolsTools` with `pool:create`, `pool:update_mandate`,
  `pool:rotate_stewards`, `pool:close`, `pool:set_accepted_restrictions`.

## Files edited

- `apps/org-mcp/src/index.ts` — registers `poolsTools` alongside the
  existing tool modules.
- `apps/org-mcp/src/tools/rounds.ts` — extended (preserving the existing
  `round:get_voting_config` / `round:update_voting_config` /
  `round:increment_proposals_received` no-op shim) with on-chain admin
  tools `round:open`, `round:set_status`, `round:close`, `round:cancel`,
  `round:set_awards_root`. File header updated to reflect the expanded
  surface.
- `packages/sdk/src/marketplace-scopes.ts` — added scope descriptors for
  every new tool name (5 pool admin scopes under SPEC_002, 5 round admin
  scopes under SPEC_003). All `kind: 'user'`.
- `apps/web/src/lib/actions/poolCreate.action.ts` — rewritten as a thin
  proxy. Drops `PoolRegistryClient` / `deploySmartAccount` / direct wallet
  usage. Calls `pool:create`.
- `apps/web/src/lib/actions/poolAdmin.action.ts` — rewritten. Drops
  `canManageAgent` pre-check + direct `wallet.writeContract`. Calls
  `pool:update_mandate` / `pool:rotate_stewards`. The mandate-hash
  computation stays web-side (the MCP only receives the hex digest, not the
  raw body).
- `apps/web/src/lib/actions/roundOpen.action.ts` — rewritten. Drops
  `FundRegistryClient` / direct wallet usage. Calls `round:open` then
  `round:update_voting_config`. Body fields (mandate / milestoneTemplate /
  validatorRequirements) are JSON-stringified web-side and persisted on
  chain by the MCP via the existing typed-attribute store.
- `apps/web/src/lib/actions/roundClose.action.ts` — partially proxied. The
  FundRegistry transitions (`setRoundAwardsRoot`, `setRoundStatus('decided')`)
  now go through `round:set_awards_root` and `round:set_status` MCP tools.
  The awards-Merkle computation stays web-side; the per-proposal
  `ProposalRegistry.announceAward` calls also stay web-side because the
  ProposalRegistry tool surface hasn't been built yet (Tier-1.x follow-up).
- `apps/web/src/lib/actions/roundCancel.action.ts` — rewritten as a thin
  proxy. Calls `round:cancel`.
- `apps/web/src/lib/actions/roundAdmin.action.ts` — `advanceRoundLifecycle`
  now calls `round:set_status`. `updateRoundVotingConfig` is unchanged
  (still goes through `round:update_voting_config` as before, which was
  already MCP-routed). The `canManageAgent` / `DiscoveryService` pre-flight
  is gone — the MCP enforces the gate post-delegation-verify.

## Tools added (10)

Pool admin (org-mcp):
1. `pool:create`
2. `pool:update_mandate`
3. `pool:rotate_stewards`
4. `pool:close`
5. `pool:set_accepted_restrictions`

Round admin (org-mcp):
6. `round:open`
7. `round:set_status`
8. `round:close` (Tier 1 stub — wraps `setRoundStatus('closed')`)
9. `round:cancel` (wraps `setRoundStatus('canceled')`)
10. `round:set_awards_root`

## Auth-gate caveats

- **Pool tools** assert `orgPrincipal.toLowerCase() === firstSteward.toLowerCase()`,
  reading `getStewards(poolAgent)[0]` from the chain. This is intentionally
  simpler than the web's old `canManageAgent(viewer, poolAgent)` (which
  walks ATL_CONTROLLER + relationship edges). Tier 2 will either re-introduce
  a richer canManageAgent here or rely on chained DelegationManager
  redemption to enforce ownership transitively.
- **Round tools** assert `orgPrincipal.toLowerCase() === fundAgent.toLowerCase()`.
  For `round:open`, `fundAgent` comes from the input. For
  `round:set_status` / `round:close` / `round:cancel` / `round:set_awards_root`,
  it's read on chain via `FundRegistry.getRoundFundAgent(roundSubject)`
  (rejects unknown rounds). Same Tier-2 follow-up applies.
- **`pool:create`** still uses the deployer EOA as the pool's
  AgentAccount **owner** (i.e. `factory.createAccount(deployerEOA, salt)`).
  Tier 2 will switch this to the user's AgentAccount per memory note
  `project_pool_management_in_org_mcp.md` so PoolRegistry's `onlyPoolOwner`
  passes via redeemDelegation flow.

## Behavior differences from the previous web implementation

- The old `canManageAgent` pre-flight on the web side is GONE for pool/round
  admin actions. The MCP-side first-steward / first-fundAgent check
  replaces it. For Tier 1 these are STRICTER than canManageAgent — they
  don't honor secondary ATL controllers. If a non-first-steward steward
  was previously allowed to update mandates / rotate stewards via
  canManageAgent, they no longer are. This is acceptable per the user's
  "wipe and seed fresh" stance and was explicitly flagged in T1.2's
  instructions ("Tier 2 will re-introduce a richer canManageAgent").
- `closeRound` no longer does FundRegistry calls directly — it
  goes through MCP. But it STILL does ProposalRegistry.announceAward
  per winning proposal directly via the deployer wallet, because
  ProposalRegistry tools haven't been added to org-mcp yet. This is
  documented inline in `roundClose.action.ts` and is the natural next
  Tier-1.x increment.
- `poolCreate` web action no longer accepts `name` on the wire payload —
  the MCP tool doesn't need it (name is a GraphDB-only concern populated
  by the on-chain → KB sync). The action's input type still accepts `name`
  for compatibility with calling forms; it's silently dropped.
- `cancelRound` no longer requires the caller to also be a fund owner via
  `canManageAgent` — the MCP gate (`orgPrincipal == fundAgent`) is the
  single source of truth. Reason metadata (`reasonURI`) is still inert at
  this layer pending Phase-3 SESSION_DELEGATION revocation.
- The web action signatures (input types, return shapes, function names) are
  preserved across the refactor — calling pages don't need to change.

## Verification gate

```bash
pnpm --filter @smart-agent/sdk typecheck     # PASS
pnpm --filter @smart-agent/org-mcp typecheck # PASS
pnpm --filter @smart-agent/web typecheck     # PASS
```

Per instructions, did not run `fresh-start.sh` (T1.6 is the dedicated
end-to-end verify task).
