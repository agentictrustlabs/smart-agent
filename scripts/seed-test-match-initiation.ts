/**
 * Spec 004 v2 — `match_initiations` SQL table dropped. MatchInitiation
 * bodies are authoritative on chain in MatchInitiationRegistry. This
 * seed used to populate person-mcp + org-mcp mirror tables; with both
 * gone it has no SQL surface to write to.
 *
 * Real demo MatchInitiations now flow through
 * `apps/web/src/lib/actions/matchInitiations.action.ts` → org-mcp
 * `match_initiation:create` → MatchInitiationRegistry on chain.
 *
 * Until that pipeline is wired into a seed script, this is a no-op.
 */

console.log('[seed-test-match-initiation] no-op (spec 004 v2 — match_initiations dropped; chain-side seeding TODO)')
process.exit(0)
