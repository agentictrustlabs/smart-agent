// Demo data seeding has been hollowed out as part of the data-store
// consolidation initiative. The hard-coded oikos contacts, prayers, training
// progress, coaching relationships, preferences, revenue reports, and
// proposals that this file used to insert directly into web SQL no longer
// have target tables — those tables moved to person-mcp / org-mcp.
//
// The on-chain seed scripts (seed-catalyst-onchain.ts, seed-cil-onchain.ts,
// seed-needs-resources.ts, etc.) still mint agents, edges, assertions, and
// the public marketplace projection. That gives a working demo skeleton.
//
// Re-seeding the moved domain (oikos, prayers, training, etc.) via MCP tool
// calls under each demo user's session is a follow-up; until that ships the
// new MCP tables come up empty after fresh-start.

export function seedMultiplyData(): void {
  // intentionally empty
}
