/**
 * Spec 007 Phase B — risk-tier classifier + policy-gate unit tests.
 *
 * Covers:
 *   1. `classifyRiskTier` (SDK pure function) — empty scope, single
 *      action, max-tier across mixed-tier scopes.
 *   2. `classifyAction` (a2a-agent registry lookup) — registered route,
 *      unregistered route default, long-lived-automation rule.
 *   3. `classifySessionRiskTier` (a2a-agent) — variant selection from
 *      a real scope.
 *   4. `sessionRequiresVariantB` — boolean view used by the route.
 *   5. `checkActionAgainstSession` (policy gate) — Variant A + low/medium
 *      OK, Variant A + high REJECT, Variant B + anything OK.
 *
 * Run:
 *   node --import tsx --test apps/a2a-agent/test/phase-b-risk-tier.test.ts
 */
process.env.A2A_SESSION_SECRET = '0x' + 'b'.repeat(64)
process.env.A2A_KMS_BACKEND = 'local-aes'
process.env.A2A_MASTER_PRIVATE_KEY = '0x' + 'ce'.repeat(32)
process.env.WEB_TO_A2A_HMAC_KEY = '0x' + '7'.repeat(64)
process.env.A2A_INTERSERVICE_HMAC_KEY_ORG = '0x' + 'a'.repeat(64)
process.env.A2A_INTERSERVICE_HMAC_KEY_PERSON = '0x' + 'a'.repeat(64)
process.env.A2A_INTERSERVICE_HMAC_KEY_HUB = '0x' + 'a'.repeat(64)
process.env.A2A_INTERSERVICE_HMAC_KEY_FAMILY = '0x' + 'a'.repeat(64)
process.env.A2A_INTERSERVICE_HMAC_KEY_PEOPLE_GROUP = '0x' + 'a'.repeat(64)
process.env.A2A_INTERSERVICE_HMAC_KEY_VERIFIER = '0x' + 'a'.repeat(64)
process.env.A2A_INTERSERVICE_HMAC_KEY_SKILL = '0x' + 'a'.repeat(64)
process.env.A2A_INTERSERVICE_HMAC_KEY_GEO = '0x' + 'a'.repeat(64)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyRiskTier,
  variantForTier,
  compareRiskTier,
  type ActionDescriptor,
} from '@smart-agent/sdk'
import {
  classifyAction,
  classifySessionRiskTier,
  sessionRequiresVariantB,
  RISK_TIER_REGISTRY,
  DEFAULT_RISK_TIER,
} from '../src/lib/risk-tiers'
import { checkActionAgainstSession } from '../src/lib/policy-gate'

// ─── SDK pure classifier ────────────────────────────────────────────

test('classifyRiskTier — empty scope returns low', () => {
  const tier = classifyRiskTier([], () => 'medium')
  assert.equal(tier, 'low')
})

test('classifyRiskTier — single low action returns low', () => {
  const tier = classifyRiskTier(
    [{ route: 'read:profile' }],
    () => 'low',
  )
  assert.equal(tier, 'low')
})

test('classifyRiskTier — max across mixed tiers', () => {
  const lookup = (a: ActionDescriptor) =>
    a.route === 'high-one'
      ? 'high'
      : a.route === 'medium-one'
        ? 'medium'
        : 'low'
  const tier = classifyRiskTier(
    [{ route: 'low-one' }, { route: 'medium-one' }, { route: 'high-one' }],
    lookup,
  )
  assert.equal(tier, 'high')
})

test('classifyRiskTier — critical wins over high', () => {
  const lookup = (a: ActionDescriptor) =>
    a.route === 'critical' ? 'critical' : 'high'
  const tier = classifyRiskTier(
    [{ route: 'high' }, { route: 'critical' }],
    lookup,
  )
  assert.equal(tier, 'critical')
})

test('compareRiskTier — total order', () => {
  assert.ok(compareRiskTier('low', 'medium') < 0)
  assert.ok(compareRiskTier('medium', 'high') < 0)
  assert.ok(compareRiskTier('high', 'critical') < 0)
  assert.equal(compareRiskTier('high', 'high'), 0)
  assert.ok(compareRiskTier('critical', 'low') > 0)
})

test('variantForTier — low/medium → A; high/critical → B', () => {
  assert.equal(variantForTier('low'), 'A')
  assert.equal(variantForTier('medium'), 'A')
  assert.equal(variantForTier('high'), 'B')
  assert.equal(variantForTier('critical'), 'B')
})

// ─── a2a-agent registry classifier ──────────────────────────────────

test('classifyAction — registered high-risk routes return high', () => {
  assert.equal(classifyAction({ route: 'pledge:honor' }), 'high')
  assert.equal(classifyAction({ route: 'treasury:transfer' }), 'high')
  assert.equal(classifyAction({ route: 'round:close' }), 'high')
  assert.equal(classifyAction({ route: 'grant_proposal:award' }), 'high')
  assert.equal(classifyAction({ route: 'agentAccount:addOwner' }), 'high')
})

test('classifyAction — registered low routes return low', () => {
  assert.equal(classifyAction({ route: 'fund_registry:get_round_status' }), 'low')
  assert.equal(classifyAction({ route: 'agent_resolver:read' }), 'low')
})

test('classifyAction — unregistered route defaults to medium (fail safer)', () => {
  assert.equal(classifyAction({ route: 'never:heard:of' }), DEFAULT_RISK_TIER)
  assert.equal(DEFAULT_RISK_TIER, 'medium')
})

test('classifyAction — long-lived automation (>24h) is upgraded to high', () => {
  // A normally-medium action with a >24h validUntil becomes high.
  const action: ActionDescriptor = {
    route: 'never:heard:of', // would be medium by default
    args: { validUntilSecondsFromNow: 25 * 60 * 60 },
  }
  assert.equal(classifyAction(action), 'high')
})

test('classifyAction — short-lived (<24h) keeps its registry tier', () => {
  const action: ActionDescriptor = {
    route: 'never:heard:of',
    args: { validUntilSecondsFromNow: 23 * 60 * 60 },
  }
  assert.equal(classifyAction(action), 'medium')
})

test('classifySessionRiskTier — mixed-scope picks the max', () => {
  const tier = classifySessionRiskTier([
    { route: 'agent_resolver:read' },            // low
    { route: 'never:heard:of' },                  // medium (default)
    { route: 'pledge:honor' },                    // high
  ])
  assert.equal(tier, 'high')
})

test('sessionRequiresVariantB — high tier requires B', () => {
  assert.equal(
    sessionRequiresVariantB([{ route: 'pledge:honor' }]),
    true,
  )
})

test('sessionRequiresVariantB — medium-only scope stays A', () => {
  assert.equal(
    sessionRequiresVariantB([{ route: 'never:heard:of' }]),
    false,
  )
})

test('sessionRequiresVariantB — empty scope is A (no actions = no risk)', () => {
  assert.equal(sessionRequiresVariantB([]), false)
})

test('RISK_TIER_REGISTRY is frozen + immutable', () => {
  assert.ok(Object.isFrozen(RISK_TIER_REGISTRY))
})

// ─── policy gate ────────────────────────────────────────────────────

test('checkActionAgainstSession — Variant A + low → ok', () => {
  const d = checkActionAgainstSession(
    { route: 'agent_resolver:read' },
    'A',
  )
  assert.equal(d.ok, true)
  if (d.ok) {
    assert.equal(d.actionTier, 'low')
    assert.equal(d.sessionVariant, 'A')
  }
})

test('checkActionAgainstSession — Variant A + medium → ok', () => {
  const d = checkActionAgainstSession(
    { route: 'never:heard:of' },
    'A',
  )
  assert.equal(d.ok, true)
})

test('checkActionAgainstSession — Variant A + high → REJECT', () => {
  const d = checkActionAgainstSession(
    { route: 'pledge:honor' },
    'A',
  )
  assert.equal(d.ok, false)
  if (!d.ok) {
    assert.equal(d.reason, 'risk-tier-mismatch')
    assert.equal(d.actionTier, 'high')
    assert.equal(d.sessionVariant, 'A')
    assert.ok(d.message.includes('Variant'))
  }
})

test('checkActionAgainstSession — Variant B + high → ok', () => {
  const d = checkActionAgainstSession(
    { route: 'pledge:honor' },
    'B',
  )
  assert.equal(d.ok, true)
  if (d.ok) {
    assert.equal(d.actionTier, 'high')
    assert.equal(d.sessionVariant, 'B')
  }
})

test('checkActionAgainstSession — Variant B + low → ok (variant B covers all)', () => {
  const d = checkActionAgainstSession(
    { route: 'agent_resolver:read' },
    'B',
  )
  assert.equal(d.ok, true)
})
