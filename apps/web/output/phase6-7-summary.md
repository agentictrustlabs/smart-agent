# Phase 6 & 7 Refactor Summary

## Goal achieved
- `pnpm --filter @smart-agent/org-mcp typecheck` — clean
- `pnpm --filter @smart-agent/web typecheck` — clean
- `pnpm --filter @smart-agent/sdk typecheck` — clean
- `pnpm --filter @smart-agent/person-mcp typecheck` — clean
- `pnpm --filter @smart-agent/discovery typecheck` — clean
- `forge test --match-contract "PoolRegistry|FundRegistry"` — 32 / 32 PASS

Schema (`apps/org-mcp/src/db/schema.ts` + `db/index.ts`) was already slimmed before this session began. This session followed up by purging every reader/writer that referenced the dropped columns / tables, deleting dead MCP tools, and switching readers to FundRegistryClient / PoolRegistryClient / DiscoveryService.

## Files modified

### Deleted
- `/home/barb/smart-agent/apps/org-mcp/src/tools/pools.ts` — entire file removed. All four tools (`pool:init_counters`, `pool:read_counters`, `pool:contribute_to_total`, `pool:update_cache`) were dead after the schema slim. Pool body lives on chain via PoolRegistry; counters derive from `pool_pledges`.

### `/home/barb/smart-agent/apps/org-mcp/src/index.ts`
- Removed `poolsTools` import and `...poolsTools` spread.

### `/home/barb/smart-agent/apps/org-mcp/src/tools/poolPledges.ts`
- Dropped `pools` import.
- Deleted `readLocalPool`, `bumpPoolTotal`. Pool body validation is now an action-layer responsibility (against `DiscoveryService.getPoolDetail`); MCP layer no longer body-validates.
- Submit handler simplified: persists the row + issues the `pool:read_pledge` cross-delegation when non-anonymous.
- Amend handler: removed counter-write side effect.
- Added `pool_pledge:read_pool_counters` tool exposing the derived counters.
- Exported `getPoolCounters(poolAgentId)` helper that SUMs cadence-aware totals from `pool_pledges WHERE status = 'active'` (allocatedTotal hardcoded 0 until allocation tracking ships).

### `/home/barb/smart-agent/apps/org-mcp/src/tools/rounds.ts`
- Rewrote from scratch.
- Kept: `round:update_voting_config` (auto-creates the slim row on first set), `round:increment_proposals_received` (no-op shim — proposalsReceived is derived now), `round:get_voting_config` (new — returns voting config + derived proposalsReceived).
- Dropped: `get_round`, `round:open`, `round:close`, `round:cancel`, `round:update_status`. Action layer now writes directly to FundRegistry; reads come from `DiscoveryService.getRoundDetail`.
- Exported `getProposalsReceived(roundId)` helper that COUNTs from `proposal_submissions`.

### `/home/barb/smart-agent/apps/org-mcp/src/tools/grantProposals.ts`
- Dropped `rounds` import.
- Deleted `readLocalRound` (round body lives on chain).
- Replaced `bumpRoundCounter` with a no-op stub (counter is derived).
- Removed submit-time round body validation block (budget ceiling, required credentials, private-round addressee, open-call eligibility) — action layer pre-validates against `DiscoveryService.getRoundDetail`.
- Added optional `stewardAgentHint` field to `SubmitArgs` so the action layer can pass the round's fundAgent address (for the `proposal:read_for_review` cross-delegation grant).
- Removed pre-deadline check from `edit_pre_deadline` — moved to action layer.

### `/home/barb/smart-agent/apps/web/src/lib/actions/proposalVotes.action.ts`
- `loadRoundConfig`: now reads voting fields from slim `rounds` table AND `fundAgentId` from `DiscoveryService.getRoundDetail`. Auto-defaults voting config when no row yet.

### `/home/barb/smart-agent/apps/web/src/lib/actions/finalizeRound.action.ts`
- `loadRound`: reads `voting_threshold` from slim `rounds` table; resolves `fundAgentId` via `DiscoveryService`. Dropped the unused `status` field from `RoundRow`.

### `/home/barb/smart-agent/apps/web/src/app/h/[hubId]/(hub)/rounds/[roundId]/admin/page.tsx`
- `loadRound`: reads body (deadline, decisionDate, fundAgentId) from `DiscoveryService.getRoundDetail`, voting fields from slim `rounds` table. `status` defaults to `'open'` (Round type doesn't surface status; UI can read via FundRegistry getter when needed).

### `/home/barb/smart-agent/apps/web/src/lib/actions/roundAdmin.action.ts`
- Removed `STATUS_TO_CACHE` constant + the `round:update_status` MCP call. Status is on chain via `FundRegistry.setRoundStatus`; the on-chain → GraphDB sync surfaces it.

### `/home/barb/smart-agent/apps/web/src/lib/actions/poolAdmin.action.ts`
- Removed `callMcp` import + both `pool:update_cache` calls (in `updatePoolMandate` and `rotatePoolStewards`). Body lives on chain.

### `/home/barb/smart-agent/apps/web/src/lib/actions/poolCreate.action.ts`
- Removed `callMcp` import + the `pool:init_counters` call. No SQL cache to seed.

### `/home/barb/smart-agent/apps/web/src/lib/actions/roundOpen.action.ts`
- Replaced `round:open` MCP call with `round:update_voting_config` (auto-creates the slim voting row).

### `/home/barb/smart-agent/apps/web/src/lib/actions/roundClose.action.ts`
- Removed the `round:close` MCP call. Closure (awardsRoot + status + dispute window) lives on chain via `FundRegistry.setRoundAwardsRoot` + `FundRegistry.setRoundStatus('decided')`.

### `/home/barb/smart-agent/apps/web/src/lib/actions/roundCancel.action.ts`
- Removed the `round:cancel` MCP call + `callMcp` import. Cancellation lives on chain.

### `/home/barb/smart-agent/apps/person-mcp/src/tools/poolPledges.ts`
- Dropped `Database`, `path`, `fs` imports.
- Deleted `getOrgMcpDb`, `readPool`, `bumpPoolTotal`, `restrictionsAccepted`, `cadenceAwareTotal` (all dead now).
- Stripped `PoolBody` interface and the body-error variants from `SubmitErrorKind` (only `validation` remains).
- Submit handler simplified the same way as org-mcp's twin: persist the row + cross-delegation grant; pool visibility comes from action-layer arg `poolVisibility` (defaults to public).
- Amend handler no longer fires counter writes.

### `/home/barb/smart-agent/scripts/seed-test-round.ts`
- `seedSqlCache` now seeds only voting config rows (default steward-quorum, threshold=2, 7-day voting window) for each demo round. Round body is seeded on chain by the `FundRegistry.openRound` calls already in `main()`.

### `/home/barb/smart-agent/scripts/seed-test-pool.ts`
- Deleted `seedSqlCounters` function and the `openSqlite` helper (both dead — pools table dropped). `main()` no longer calls it.

### `/home/barb/smart-agent/scripts/seed-test-pledge.ts`
- Removed the `UPDATE pools SET pledged_total/...` block. Counters are derived.

### `/home/barb/smart-agent/packages/sdk/src/marketplace-scopes.ts`
- Deleted the `pool_contribute_to_total` scope descriptor (system delegation no longer needed). Replaced with a comment noting the drop.
- `round_increment_proposals_received` kept (the org-mcp tool is a no-op shim that still resolves the scope, preserving any in-flight delegation tokens).

### `/home/barb/smart-agent/packages/sdk/src/poolPledges/client.ts`
- Updated docstring on `amend` to reflect that no `pool:contribute_to_total` is fired anymore.

## Remaining gotchas / follow-ups

1. **`addressedApplicants` for private rounds is now nowhere.** `roundOpen.action.ts` accepts the field as input but does not write it (FundRegistry doesn't store it; the slim rounds table doesn't have it either). For a private round with an addressed-applicants list, you'll need to either reintroduce a slim `round_addressed_applicants(round_id, applicant_address)` MCP table or store the list in the round mandate JSON on chain. Per the user's instructions this stays MCP-side as a visibility filter, but currently no reader of this column existed — so the field is dead until product surfaces a need.

2. **`roundCancel.action.ts` `reasonURI` and `revokedSessionHash` are no longer persisted off-chain.** They were only carried in `addressedApplicants` (the temp-carrier hack the old `round:cancel` tool used). They survive only via `sa:RoundCanceledAssertion` in the assertion emit pipeline (when the action layer emits it). If product wants the reason text accessible from the MCP, it needs a real schema column.

3. **`grantProposals.ts award/revoke_award/rescind` tools** still co-opt the `fundMandateId` column to carry award metadata (status payload JSON). That's a Phase-2.5 hack from before — left untouched, it'll keep working post-Phase-7 because the column is still there. Worth tidying when promoting to first-class `awarded_at` / `award_amount` / `award_unit` columns.

4. **The org-mcp `rounds` table auto-creation** in `round:update_voting_config` will create voting config rows even before the on-chain round exists. That's fine for fresh-start (action layer always opens the round on chain first). But a stray call with a bogus `roundId` will silently materialize a row. Not blocking; flagged for awareness.

5. **`seed-test-pool.ts`'s on-chain PoolRegistry.open call** uses the existing `governanceModel: pool.governanceModel` value. Verify `normalizeGovernance` still handles all current seed values correctly (it should — it collapses non-fund kinds to `open-call`).

6. **No fresh-start.sh run requested per user instructions.** That's the next step after this report.

## Test summary
- Forge tests: `forge test --root /home/barb/smart-agent/packages/contracts --match-contract "PoolRegistry|FundRegistry"` — 32 passed, 0 failed
- TypeScript: org-mcp, web, sdk, person-mcp, discovery all typecheck clean
