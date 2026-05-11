/**
 * Spec 004 v2 — `pool_pledges` SQL table dropped. Pledges are
 * authoritative on chain in PledgeRegistry. This seed script used to
 * INSERT canonical demo pledges into person-mcp's `pool_pledges`; with
 * the table gone it has no SQL surface to write to.
 *
 * Real demo pledges should now flow through the gateway redeem path:
 *   1. Issue a ProposalSubmitterCredential (or PledgerCredential when
 *      that ships) to each demo donor via seed-spec004-creds.ts.
 *   2. Web demo flow: donor signs a pool_pledge:submit via the
 *      `apps/web/src/lib/actions/poolPledges.action.ts` action, which
 *      mints the chain redeem.
 *
 * Until that pipeline lands, this script is a no-op.
 */

console.log('[seed-test-pledge] no-op (spec 004 v2 — pool_pledges dropped; chain-side seeding TODO)')
process.exit(0)
