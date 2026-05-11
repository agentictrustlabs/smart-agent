/**
 * Spec 004 (b2) — CLI wrapper for `seedSpec004Credential()`. Issues a
 * `ProposalSubmitterCredential` to one demo holder + a `RoundVoterCredential`
 * to another, mints the matching admin→holder on-chain delegations using
 * the admin's stored EOA private key, and persists everything to the
 * holder's person-mcp credential_metadata row.
 *
 * Usage (defaults match the existing demo round/pool seed scripts):
 *
 *   pnpm exec tsx scripts/seed-spec004-creds.ts \
 *     --admin cat-user-001 \
 *     --submitter cat-user-002 \
 *     --voter cat-user-003 \
 *     --pool   <0xPoolTreasuryAddress> \
 *     --round  demo-trauma-care-q2
 *
 * --pool is the treasury (AgentAccount) address that owns the pool; if
 *   omitted, the script reads it from the SQL `pools` mirror table (or
 *   bails with a clear error).
 */

import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')

const envFile = path.join(repoRoot, 'apps/web/.env')
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line)
    if (!m) continue
    let value = m[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!process.env[m[1]]) process.env[m[1]] = value
  }
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1]
  return fallback
}

async function main() {
  const adminUserId = arg('admin', 'cat-user-001')!
  const submitterUserId = arg('submitter', 'cat-user-002')!
  const voterUserId = arg('voter', 'cat-user-003')!
  const poolAgent = arg('pool')
  const roundId = arg('round', 'demo-trauma-care-q2')!
  // Spec 004 v2 — RoundVoterCredential binds the round's on-chain
  // bytes32 subject (not the URN slug). Derive it the same way
  // FundRegistryClient does: keccak256(encodePacked("sa:round:", id)).
  // Computed by spawning `cast` since this script doesn't have viem in
  // its dep tree (the seed helper inside apps/web does).
  const { execSync } = await import('node:child_process')
  const concat = `sa:round:${roundId}`
  const roundSubject = execSync(`cast keccak "${concat}"`).toString().trim() as `0x${string}`

  if (!poolAgent) {
    console.error('seed-spec004-creds: --pool <0xAddress> required (the pool treasury AgentAccount)')
    process.exit(1)
  }

  // Lazy-import so the env file is fully loaded before web modules read it.
  const { seedSpec004Credential } = await import('../apps/web/src/lib/demo-seed/seed-spec004-credentials.js')

  // For the catalyst demo, the pool / fund agents are deployed with the
  // deployer EOA as their AgentAccount owner (see scripts/seed-test-pool.ts).
  // The `admin → holder` delegation:
  //   - is SIGNED with the deployer key (the EOA registered as an owner
  //     of the pool agent's AgentAccount)
  //   - has DELEGATOR = the pool agent's AgentAccount address (smart
  //     contract), so DelegationManager dispatches via
  //     `poolAgent.execute(target, …)` and msg.sender at the registry
  //     equals the pool agent's AgentAccount (which `_isAccountOwner`
  //     checks against itself via self-ownership — passes).
  //   - ERC-1271 validation inside the AgentAccount confirms the
  //     deployer is in its _owners map.
  const adminSigningKey = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}` | undefined

  console.log(`[seed-spec004] issuing ProposalSubmitterCredential admin=${adminUserId} holder=${submitterUserId} pool=${poolAgent}`)
  const r1 = await seedSpec004Credential({
    adminUserId,
    holderUserId: submitterUserId,
    credentialType: 'ProposalSubmitterCredential',
    poolAgentId: poolAgent,
    ...(adminSigningKey ? { adminSigningKey } : {}),
    adminAccountOverride: poolAgent as `0x${string}`,
  })
  if (!r1.ok) {
    console.error('[seed-spec004] submitter cred failed:', r1.error)
    process.exit(1)
  }
  console.log('[seed-spec004] submitter credential:', r1.credentialId)

  // RoundVoter is gated by the round's fund-agent's onlyRoundOperator.
  // Default to the catalyst network address — it's the stewardship agent
  // of every round seeded by `seed-test-round`. Override via --fund-agent
  // if your seed uses a different fund.
  const fundAgent = (arg('fund-agent') ?? '0x0F669E6851A15FD0E5904EB197c369C2ab578D9b') as `0x${string}`
  console.log(`[seed-spec004] issuing RoundVoterCredential admin=${adminUserId} holder=${voterUserId} round=${roundId} roundSubject=${roundSubject} fundAgent=${fundAgent}`)
  const r2 = await seedSpec004Credential({
    adminUserId,
    holderUserId: voterUserId,
    credentialType: 'RoundVoterCredential',
    roundSubject,
    ...(adminSigningKey ? { adminSigningKey } : {}),
    adminAccountOverride: fundAgent,
  })
  if (!r2.ok) {
    console.error('[seed-spec004] voter cred failed:', r2.error)
    process.exit(1)
  }
  console.log('[seed-spec004] voter credential:', r2.credentialId)

  console.log('[seed-spec004] done')
}

main().catch((err) => {
  console.error('[seed-spec004] fatal:', err)
  process.exit(1)
})
