/**
 * Tests for `apps/a2a-agent/src/middleware/host-context.ts` exempt list
 * (P0-2). The reviewer flagged that `/session-store/*` and
 * `/wallet-action/*` were documented as exempt but the code never
 * implemented those exemptions — every call from the web app on the
 * bare A2A host (no agent slug) was returning `400 agent host required`.
 *
 * Run: `node --import tsx --test apps/a2a-agent/test/host-context-exempt.test.ts`
 */

// Configure env BEFORE importing host-context — the module's transitive
// `config` import validates A2A_SESSION_SECRET at module load time. tsx
// transpiles to CJS, so the env assignments below DO run before the
// `require()` calls produced from `import`. We still go through a
// `require('../src/middleware/host-context')` cast for clarity that
// the import is lazy w.r.t. these env assignments.
process.env.A2A_KMS_BACKEND = 'local-aes'
process.env.A2A_SESSION_SECRET = process.env.A2A_SESSION_SECRET ?? '0x' + 'd'.repeat(64)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { isHostExempt } = require('../src/middleware/host-context') as {
  isHostExempt: (path: string) => boolean
}

test('P0-2 /session-store/* is host-exempt (system table, no agent binding)', () => {
  assert.equal(isHostExempt('/session-store/insert'), true)
  assert.equal(isHostExempt('/session-store/revoke'), true)
  assert.equal(isHostExempt('/session-store/bump-epoch'), true)
  assert.equal(isHostExempt('/session-store/by-cookie/abc'), true)
  assert.equal(isHostExempt('/session-store/epoch/0xabc'), true)
  assert.equal(isHostExempt('/session-store/active/0xabc'), true)
})

test('P0-2 /wallet-action/* is host-exempt (per-session, not per-agent)', () => {
  assert.equal(isHostExempt('/wallet-action/dispatch'), true)
})

test('P0-2 /session/package is host-exempt (WebAuthn assertion bootstrap)', () => {
  assert.equal(isHostExempt('/session/package'), true)
})

test('existing exempts still hold (regression)', () => {
  assert.equal(isHostExempt('/health'), true)
  assert.equal(isHostExempt('/.well-known/agent.json'), true)
  assert.equal(isHostExempt('/auth/challenge'), true)
  assert.equal(isHostExempt('/auth/verify'), true)
  assert.equal(isHostExempt('/session/init'), true)
})

test('inter-service /session/:id/<verb> suffixes are exempt', () => {
  // Option A: only redeem-via-account + deploy-agent survive.
  assert.equal(isHostExempt('/session/sess-1/deploy-agent'), true)
  assert.equal(isHostExempt('/session/sess-1/redeem-via-account'), true)
  // Deleted variants no longer exist — must NOT be exempt (will 404).
  assert.equal(isHostExempt('/session/sess-1/redeem-tx'), false)
  assert.equal(isHostExempt('/session/sess-1/redeem-with-chain'), false)
  assert.equal(isHostExempt('/session/sess-1/redeem-subdelegated'), false)
})

test('non-exempt routes are NOT exempt (sanity check — the middleware must still gate user routes)', () => {
  assert.equal(isHostExempt('/profile'), false)
  assert.equal(isHostExempt('/mcp/person/tool'), false)
  assert.equal(isHostExempt('/delegation/issue'), false)
  // Sub-paths of /auth/ other than the strict-prefix-matched ones.
  assert.equal(isHostExempt('/auth/challenge/foo'), false)
  // Bare /session/:id without an inter-service suffix is NOT exempt.
  assert.equal(isHostExempt('/session/sess-1'), false)
  assert.equal(isHostExempt('/session/sess-1/status'), false)
})
