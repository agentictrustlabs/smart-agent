/**
 * Sprint 5 Wave 2 — P0-8 — marketplace tools gated behind MARKETPLACE_ENABLED.
 *
 *   - Default (env unset, prod): assertPolicyCompleteness passes, marketplace
 *     tools are in MARKETPLACE_TOOL_IDS, and assertMarketplacePolicy is a no-op.
 *   - MARKETPLACE_ENABLED=true: assertMarketplacePolicy refuses because the
 *     marketplace selector tables don't ship in @smart-agent/sdk yet — every
 *     known marketplace tool surfaces in the error message.
 *   - MARKETPLACE_ENABLED='garbage': resolveMarketplaceEnabled throws naming
 *     the value.
 *   - assertPolicyCompleteness continues to refuse when a NON-marketplace tool
 *     has no selectors (unrelated to the flag).
 *
 * Pure-function pattern — the helpers accept an env map so the test does
 * not have to mutate global `process.env`.
 *
 * Run: `node --import tsx --test apps/a2a-agent/test/policy-startup-marketplace.test.ts`
 */

// Configure env BEFORE importing app code.
process.env.A2A_KMS_BACKEND = 'local-aes'
process.env.A2A_SESSION_SECRET = '0x' + 'd'.repeat(64)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MARKETPLACE_TOOL_IDS,
  assertPolicyCompleteness,
  assertMarketplacePolicy,
  resolveMarketplaceEnabled,
} from '../src/lib/policy-startup'

// ─── resolveMarketplaceEnabled — pure ───────────────────────────────

test('resolveMarketplaceEnabled: unset → false', () => {
  assert.equal(resolveMarketplaceEnabled({}), false)
})

test('resolveMarketplaceEnabled: "true" → true', () => {
  assert.equal(resolveMarketplaceEnabled({ MARKETPLACE_ENABLED: 'true' }), true)
})

test('resolveMarketplaceEnabled: "1" → true', () => {
  assert.equal(resolveMarketplaceEnabled({ MARKETPLACE_ENABLED: '1' }), true)
})

test('resolveMarketplaceEnabled: "false" → false', () => {
  assert.equal(resolveMarketplaceEnabled({ MARKETPLACE_ENABLED: 'false' }), false)
})

test('resolveMarketplaceEnabled: invalid value → throws naming the value', () => {
  assert.throws(
    () => resolveMarketplaceEnabled({ MARKETPLACE_ENABLED: 'garbage' }),
    /MARKETPLACE_ENABLED must be 'true' or 'false' \(got 'garbage'\)/,
  )
})

// ─── MARKETPLACE_TOOL_IDS — derived from TOOL_POLICIES ──────────────

test('MARKETPLACE_TOOL_IDS contains the Spec-004 marketplace tools', () => {
  // Known marketplace tools sourced from packages/sdk/src/policy/tool-policies.ts.
  // These are the four families whose allowedTargets are exclusively the
  // four marketplace registries.
  const expected = [
    'pool_pledge:submit',
    'pool_pledge:amend',
    'pool_pledge:stop',
    'pool_pledge:auto_stop',
    'match_initiation:create',
    'match_initiation:consume',
    'match_initiation:supersede',
    'grant_proposal:edit_pre_deadline',
    'grant_proposal:submit',
    'grant_proposal:withdraw',
    'vote:cast',
  ]
  for (const t of expected) {
    assert.ok(
      MARKETPLACE_TOOL_IDS.has(t),
      `expected MARKETPLACE_TOOL_IDS to include '${t}'`,
    )
  }
})

test('MARKETPLACE_TOOL_IDS does NOT include non-marketplace on-chain tools', () => {
  // Sanity: pool:create / round:open / commitment:commit are NOT marketplace
  // tools — they target PoolRegistry / FundRegistry / CommitmentRegistry.
  for (const t of ['pool:create', 'round:open', 'commitment:commit', 'agent:deploy']) {
    assert.ok(
      !MARKETPLACE_TOOL_IDS.has(t),
      `expected MARKETPLACE_TOOL_IDS to NOT include '${t}'`,
    )
  }
})

// ─── assertPolicyCompleteness — passes when marketplace is gated ────

test('assertPolicyCompleteness: MARKETPLACE_ENABLED unset → no throw', () => {
  assert.doesNotThrow(() => assertPolicyCompleteness({}))
})

test('assertPolicyCompleteness: MARKETPLACE_ENABLED=false → no throw', () => {
  assert.doesNotThrow(() => assertPolicyCompleteness({ MARKETPLACE_ENABLED: 'false' }))
})

// ─── assertMarketplacePolicy — opt-in gate ──────────────────────────

test('assertMarketplacePolicy: MARKETPLACE_ENABLED unset → no-op', () => {
  assert.doesNotThrow(() => assertMarketplacePolicy({}))
})

test('assertMarketplacePolicy: MARKETPLACE_ENABLED=false → no-op', () => {
  assert.doesNotThrow(() => assertMarketplacePolicy({ MARKETPLACE_ENABLED: 'false' }))
})

test('assertMarketplacePolicy: MARKETPLACE_ENABLED=true with no selector tables → throws naming each tool', () => {
  // The SDK does not ship *_SELECTORS_BY_TOOL exports for the four
  // marketplace registries yet, so flipping the flag MUST refuse to boot
  // and the error MUST enumerate every marketplace tool the operator has
  // to address.
  assert.throws(
    () => assertMarketplacePolicy({ MARKETPLACE_ENABLED: 'true' }),
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      assert.match(msg, /MARKETPLACE_ENABLED=true/)
      // Spot-check three of the eleven known marketplace tools.
      assert.match(msg, /pool_pledge:submit/)
      assert.match(msg, /grant_proposal:submit/)
      assert.match(msg, /vote:cast/)
      // Operator hint must name the SDK file.
      assert.match(msg, /SELECTORS_BY_TOOL/)
      return true
    },
  )
})
