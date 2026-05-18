/**
 * Tests for the cross-delegation dual-address binding proof
 * (Sprint 2 S2.3).
 *
 * The cross-delegation verifier in
 * `apps/person-mcp/src/auth/verify-delegation.ts::verifyCrossDelegation`
 * previously had a binding gap: it did NOT assert that the caller's
 * session smart-account matched the cross-delegation's `delegate`, on
 * the grounds that sessions used the smart-account address while
 * cross-delegations might use the person-agent address. That gap
 * meant a bug in the A2A pairing path was a cross-principal data
 * access vulnerability.
 *
 * S2.3 closes the gap via Option C — an in-caveat dual binding:
 *
 *   - The data owner signs a `DelegateBinding` caveat committing to
 *     BOTH `delegateSmartAccount` and `delegatePersonAgent`.
 *   - The verifier decodes the caveat and asserts both addresses
 *     match the session subject (Option C, authoritative) and the
 *     on-chain resolved person-agent (Option A, defense in depth).
 *
 * What this file covers (six cases):
 *
 *   1. Happy path — caller smart-account + person-agent match the
 *      binding → no binding-error returned.
 *   2. Smart-account mismatch — binding rejects with a clear error.
 *   3. Legacy delegation (no binding caveat) — rejected by default
 *      (production-like), accepted in dev when the compat env flag
 *      is set AND the caller matches the legacy `delegate` field.
 *   4. Issuance encodes both addresses into a caveat that survives
 *      the EIP-712 hash (caveatsHash changes when either address
 *      changes).
 *   5. Every reject path writes an audit-deny row.
 *   6. The smart-account → person-agent resolver helper caches
 *      results (cache hit avoids chain reads).
 *
 * These tests bail before any chain read for the binding-only paths:
 * we deliberately leave the AgentAccountResolver unconfigured so the
 * helper returns null and the verifier falls back to the in-caveat
 * binding alone.
 *
 * Run:
 *   node --import tsx --test apps/person-mcp/test/cross-delegation-binding.test.ts
 */

// Configure env BEFORE importing modules that read it at import time.
process.env.DELEGATION_MANAGER_ADDRESS = process.env.DELEGATION_MANAGER_ADDRESS ?? ('0x' + '1'.repeat(40))
process.env.PERSON_MCP_DB_PATH = process.env.PERSON_MCP_DB_PATH ?? 'person-mcp.test.db'
// Intentionally pin AGENT_ACCOUNT_RESOLVER_ADDRESS to the zero address
// so the resolver helper returns null without doing any chain reads.
// (Just `delete process.env.X` is insufficient — config.ts loads the
// person-mcp `.env` file and would re-populate the var. Setting it to
// zero short-circuits the helper's resolver-availability branch.)
process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS = '0x0000000000000000000000000000000000000000'
process.env.RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:1' // unreachable, so any chain read fails fast

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDelegateBindingCaveat,
  encodeDelegateBindingTerms,
  decodeDelegateBindingTerms,
  buildDataScopeCaveat,
  buildCaveat,
  encodeTimestampTerms,
  hashDelegation,
  hashCaveats,
  DELEGATE_BINDING_ENFORCER,
  ROOT_AUTHORITY,
} from '@smart-agent/sdk'
import { verifyCrossDelegation } from '../src/auth/verify-delegation'
import {
  resolvePersonAgentForSmartAccount,
  resetResolvePersonAgentCacheForTest,
  resetResolvePersonAgentStatsForTest,
  getResolvePersonAgentStats,
} from '../src/auth/resolve-person-agent'
import { sqlite } from '../src/db/index'

// ─── Fixtures ────────────────────────────────────────────────────────

// Memorable addresses: 0x...a (Ana, data owner), 0x...b (Bob, recipient)
const ANA_SA       = '0x000000000000000000000000000000000000aaaa' as const
const BOB_SA       = '0x000000000000000000000000000000000000bbbb' as const
const BOB_PA       = '0x000000000000000000000000000000000000bbcc' as const // dual-account: PA differs from SA
const EVE_SA       = '0x000000000000000000000000000000000000eeee' as const // attacker
const TIMESTAMP_E  = '0x0000000000000000000000000000000000007a51' as const
const ZERO_AUTH    = ROOT_AUTHORITY

const PERSON_AUDIENCE = 'urn:mcp:server:person'
const PROFILE_GRANTS = [{
  server: PERSON_AUDIENCE,
  resources: ['profile'],
  fields: ['email', 'displayName'],
}]

/** Build a cross-delegation struct that exercises the verifier. The
 * signature is a placeholder — these tests bail at the BINDING step,
 * which runs before the ERC-1271 check. */
function buildCrossDelegation(opts: {
  delegator?: `0x${string}`
  delegate?: `0x${string}`
  includeBinding?: boolean
  bindingSmartAccount?: `0x${string}`
  bindingPersonAgent?: `0x${string}`
  includeDataScope?: boolean
  includeTimestamp?: boolean
}) {
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + 60 * 60 // 1 hour
  const caveats: Array<{ enforcer: `0x${string}`; terms: `0x${string}`; args?: `0x${string}` }> = []
  if (opts.includeTimestamp !== false) {
    caveats.push(buildCaveat(TIMESTAMP_E, encodeTimestampTerms(now, expiresAt)))
  }
  if (opts.includeDataScope !== false) {
    caveats.push(buildDataScopeCaveat(PROFILE_GRANTS))
  }
  if (opts.includeBinding !== false) {
    caveats.push(buildDelegateBindingCaveat(
      opts.bindingSmartAccount ?? BOB_SA,
      opts.bindingPersonAgent ?? BOB_PA,
    ))
  }
  return {
    delegator: opts.delegator ?? ANA_SA,
    delegate: opts.delegate ?? BOB_PA, // legacy "person-agent address" flavor
    authority: ZERO_AUTH as `0x${string}`,
    caveats: caveats.map(c => ({ enforcer: c.enforcer, terms: c.terms })),
    salt: '1',
    signature: ('0x' + '0'.repeat(130)) as `0x${string}`,
  }
}

/** Find the most-recent audit-deny row that matches a substring of `reason`. */
function latestDenyMatching(reasonPattern: RegExp): { reason: string | null; action_type: string } | null {
  const rows = sqlite
    .prepare(
      `SELECT decision, reason, action_id, action_type FROM audit_log
         WHERE decision = 'denied'
         ORDER BY seq DESC LIMIT 50`,
    )
    .all() as Array<{ decision: string; reason: string | null; action_id: string; action_type: string }>
  for (const r of rows) {
    if (reasonPattern.test(r.reason ?? '') && r.action_type === 'cross-delegation:verify') {
      return r
    }
  }
  return null
}

// ─── Cases ───────────────────────────────────────────────────────────

test('happy path: caller SA + PA match binding → binding check passes (no binding-level error)', async () => {
  const xdel = buildCrossDelegation({
    bindingSmartAccount: BOB_SA,
    bindingPersonAgent: BOB_PA,
  })
  const result = await verifyCrossDelegation(xdel, BOB_SA, PERSON_AUDIENCE)
  // We'll fail at the on-chain revocation/ERC-1271 step (no chain
  // running in tests). The contract is: any binding-level error MUST
  // not appear. So if we see one of the chain-step errors, the
  // binding check passed.
  if ('error' in result) {
    assert.doesNotMatch(
      result.error,
      /binding mismatch|missing DelegateBinding|caller does not match legacy delegate|no person-agent registered for caller|smart-account is not the bound delegate/i,
      `binding step rejected a happy-path call: ${result.error}`,
    )
    // Acceptable terminal errors at this point are chain-related.
    assert.match(
      result.error,
      /revocation check failed|ERC-1271|signature invalid|cross-delegation has no grants/i,
      `unexpected terminal error: ${result.error}`,
    )
  }
})

test('reject path: caller SA matches but binding.delegatePersonAgent disagrees with the binding → ERC mismatch is fine; what we test is BINDING mismatch', async () => {
  // Caller smart-account does NOT match the binding's delegateSmartAccount.
  const xdel = buildCrossDelegation({
    bindingSmartAccount: EVE_SA, // bound to attacker
    bindingPersonAgent: BOB_PA,
  })
  const result = await verifyCrossDelegation(xdel, BOB_SA, PERSON_AUDIENCE)
  assert.ok('error' in result, 'expected an error result')
  assert.match(
    result.error,
    /caller smart-account is not the bound delegate/i,
    'expected binding-mismatch error',
  )
  // Audit-deny row written.
  const row = latestDenyMatching(/binding\.delegateSmartAccount/i)
  assert.ok(row, 'expected audit-deny row for binding-mismatch')
})

test('reject path: legacy cross-delegation (no DelegateBinding caveat) → rejected unless dev compat flag is set', async () => {
  const xdel = buildCrossDelegation({ includeBinding: false })

  // No flag → reject.
  delete process.env.ACCEPT_LEGACY_CROSS_DELEGATIONS
  const r1 = await verifyCrossDelegation(xdel, BOB_SA, PERSON_AUDIENCE)
  assert.ok('error' in r1)
  assert.match(r1.error, /missing DelegateBinding caveat/i)

  // Flag = true → accept only when callerPrincipal matches the legacy
  // `delegate` field (or its resolved person-agent — but resolver is
  // unset in this test so we exercise the strict path).
  process.env.ACCEPT_LEGACY_CROSS_DELEGATIONS = 'true'
  try {
    // strict match: callerPrincipal === delegate. Mark delegate = BOB_SA.
    const xdelStrict = buildCrossDelegation({ includeBinding: false, delegate: BOB_SA })
    const r2 = await verifyCrossDelegation(xdelStrict, BOB_SA, PERSON_AUDIENCE)
    if ('error' in r2) {
      assert.doesNotMatch(r2.error, /missing DelegateBinding|caller does not match legacy delegate/i,
        `unexpected binding-level rejection on compat path: ${r2.error}`)
    }
  } finally {
    delete process.env.ACCEPT_LEGACY_CROSS_DELEGATIONS
  }
})

test('issuance: DelegateBinding caveat encoding/decoding round-trips and is part of caveatsHash', async () => {
  const terms = encodeDelegateBindingTerms(BOB_SA, BOB_PA)
  const decoded = decodeDelegateBindingTerms(terms)
  assert.equal(decoded.delegateSmartAccount.toLowerCase(), BOB_SA)
  assert.equal(decoded.delegatePersonAgent.toLowerCase(), BOB_PA)

  // The binding caveat MUST contribute to caveatsHash — i.e. flipping
  // either bound address changes the hash. This is what gives Option C
  // its "the data owner's signature commits to both addresses" guarantee.
  const baseCaveats = [
    buildCaveat(TIMESTAMP_E, encodeTimestampTerms(1, 2)),
    buildDataScopeCaveat(PROFILE_GRANTS),
    buildDelegateBindingCaveat(BOB_SA, BOB_PA),
  ]
  const altCaveats = [
    buildCaveat(TIMESTAMP_E, encodeTimestampTerms(1, 2)),
    buildDataScopeCaveat(PROFILE_GRANTS),
    buildDelegateBindingCaveat(EVE_SA, BOB_PA), // smart-account changed
  ]
  const baseHash = hashCaveats(baseCaveats.map(c => ({ enforcer: c.enforcer, terms: c.terms })))
  const altHash = hashCaveats(altCaveats.map(c => ({ enforcer: c.enforcer, terms: c.terms })))
  assert.notEqual(baseHash, altHash, 'binding address change must alter caveatsHash')

  // And the full EIP-712 delegation hash changes accordingly.
  const baseDel = {
    delegator: ANA_SA, delegate: BOB_PA, authority: ZERO_AUTH, salt: 1n,
    caveats: baseCaveats.map(c => ({ enforcer: c.enforcer, terms: c.terms })),
  }
  const altDel = {
    delegator: ANA_SA, delegate: BOB_PA, authority: ZERO_AUTH, salt: 1n,
    caveats: altCaveats.map(c => ({ enforcer: c.enforcer, terms: c.terms })),
  }
  const dh1 = hashDelegation(baseDel, 31337, process.env.DELEGATION_MANAGER_ADDRESS as `0x${string}`)
  const dh2 = hashDelegation(altDel, 31337, process.env.DELEGATION_MANAGER_ADDRESS as `0x${string}`)
  assert.notEqual(dh1, dh2, 'binding address change must alter delegationHash')

  // Enforcer sentinel address is deterministic.
  assert.match(DELEGATE_BINDING_ENFORCER, /^0x[0-9a-f]{40}$/)
})

test('audit: every reject path writes a cross-delegation:verify deny row', async () => {
  // 1) binding mismatch (covered above) — just re-verify a row exists.
  const before = sqlite.prepare(`SELECT count(*) as n FROM audit_log WHERE decision = 'denied' AND action_type = 'cross-delegation:verify'`).get() as { n: number }

  // Mismatch case.
  await verifyCrossDelegation(
    buildCrossDelegation({ bindingSmartAccount: EVE_SA, bindingPersonAgent: BOB_PA }),
    BOB_SA,
    PERSON_AUDIENCE,
  )

  // Legacy-missing-binding case (no compat flag).
  delete process.env.ACCEPT_LEGACY_CROSS_DELEGATIONS
  await verifyCrossDelegation(
    buildCrossDelegation({ includeBinding: false }),
    BOB_SA,
    PERSON_AUDIENCE,
  )

  const after = sqlite.prepare(`SELECT count(*) as n FROM audit_log WHERE decision = 'denied' AND action_type = 'cross-delegation:verify'`).get() as { n: number }
  assert.ok(after.n >= before.n + 2, `expected at least 2 new cross-delegation:verify deny rows (before=${before.n}, after=${after.n})`)
})

test('resolver helper: returns null when AGENT_ACCOUNT_RESOLVER_ADDRESS is unset, caches the null result', async () => {
  resetResolvePersonAgentCacheForTest()
  resetResolvePersonAgentStatsForTest()

  // First call — cache miss → null (no resolver configured, no chain reads).
  const r1 = await resolvePersonAgentForSmartAccount(BOB_SA)
  assert.equal(r1, null)
  const stats1 = getResolvePersonAgentStats()
  assert.equal(stats1.misses, 1)
  assert.equal(stats1.chainReads, 0)

  // Second call — cache hit → still null, no extra reads.
  const r2 = await resolvePersonAgentForSmartAccount(BOB_SA)
  assert.equal(r2, null)
  const stats2 = getResolvePersonAgentStats()
  assert.equal(stats2.hits, 1)
  assert.equal(stats2.misses, 1, 'second call must be a cache hit')
  assert.equal(stats2.chainReads, 0)
})
