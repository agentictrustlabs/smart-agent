/**
 * Tests for env-guard.ts (HARDENING-PLAN §1.4 / C1; K6 deployer-key
 * runtime warning).
 *
 * NODE_ENV is typed readonly in Next.js's tsconfig, so we mutate via
 * a cast to a plain index-signature object.
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { isDevEnvironment, requireDev, warnIfDeployerKeyResident } from '../env-guard'

const env = process.env as Record<string, string | undefined>

describe('env-guard', () => {
  const ORIG_NODE_ENV = env.NODE_ENV
  const ORIG_SA_ENV = env.SMART_AGENT_ENV
  const ORIG_DEPLOYER_KEY = env.DEPLOYER_PRIVATE_KEY

  beforeEach(() => {
    delete env.NODE_ENV
    delete env.SMART_AGENT_ENV
    delete env.DEPLOYER_PRIVATE_KEY
  })

  afterEach(() => {
    if (ORIG_NODE_ENV === undefined) delete env.NODE_ENV
    else env.NODE_ENV = ORIG_NODE_ENV
    if (ORIG_SA_ENV === undefined) delete env.SMART_AGENT_ENV
    else env.SMART_AGENT_ENV = ORIG_SA_ENV
    if (ORIG_DEPLOYER_KEY === undefined) delete env.DEPLOYER_PRIVATE_KEY
    else env.DEPLOYER_PRIVATE_KEY = ORIG_DEPLOYER_KEY
  })

  describe('isDevEnvironment', () => {
    it('returns true when NODE_ENV is undefined', () => {
      assert.equal(isDevEnvironment(), true)
    })

    it('returns true when NODE_ENV=development', () => {
      env.NODE_ENV = 'development'
      assert.equal(isDevEnvironment(), true)
    })

    it('returns true when NODE_ENV=test', () => {
      env.NODE_ENV = 'test'
      assert.equal(isDevEnvironment(), true)
    })

    it('returns false when NODE_ENV=production', () => {
      env.NODE_ENV = 'production'
      assert.equal(isDevEnvironment(), false)
    })

    it('returns true when NODE_ENV=production AND SMART_AGENT_ENV=dev (override)', () => {
      env.NODE_ENV = 'production'
      env.SMART_AGENT_ENV = 'dev'
      assert.equal(isDevEnvironment(), true)
    })
  })

  describe('requireDev', () => {
    it('returns null in dev (NODE_ENV != production)', () => {
      env.NODE_ENV = 'development'
      assert.equal(requireDev(), null)
    })

    it('returns a 404 NextResponse in production', () => {
      env.NODE_ENV = 'production'
      const denied = requireDev()
      assert.notEqual(denied, null)
      assert.equal(denied?.status, 404)
    })

    it('returns null when production is overridden with SMART_AGENT_ENV=dev', () => {
      env.NODE_ENV = 'production'
      env.SMART_AGENT_ENV = 'dev'
      assert.equal(requireDev(), null)
    })
  })

  describe('warnIfDeployerKeyResident (K6)', () => {
    // The function uses a module-level "warned-once" flag to keep boot logs
    // quiet on hot-reload. Tests share the flag; we sequence them so that
    // the silence-case checks run BEFORE the warning case (which sets the
    // flag), and the idempotency case immediately follows.

    it('does NOT warn in dev when DEPLOYER_PRIVATE_KEY is set', () => {
      env.NODE_ENV = 'development'
      env.DEPLOYER_PRIVATE_KEY = '0x' + '0'.repeat(64)
      const messages: string[] = []
      warnIfDeployerKeyResident({ warn: (m) => messages.push(m) })
      assert.equal(messages.length, 0)
    })

    it('does NOT warn in production when DEPLOYER_PRIVATE_KEY is unset', () => {
      env.NODE_ENV = 'production'
      const messages: string[] = []
      warnIfDeployerKeyResident({ warn: (m) => messages.push(m) })
      assert.equal(messages.length, 0)
    })

    it('WARNS in production when DEPLOYER_PRIVATE_KEY is set, then is idempotent', () => {
      env.NODE_ENV = 'production'
      env.DEPLOYER_PRIVATE_KEY = '0x' + '0'.repeat(64)
      const messages: string[] = []
      // First call should warn.
      warnIfDeployerKeyResident({ warn: (m) => messages.push(m) })
      assert.equal(messages.length, 1)
      assert.match(messages[0], /K6 WARNING/)
      assert.match(messages[0], /DEPLOYER_PRIVATE_KEY/)
      // Subsequent calls (same process) should NOT re-warn.
      warnIfDeployerKeyResident({ warn: (m) => messages.push(m) })
      warnIfDeployerKeyResident({ warn: (m) => messages.push(m) })
      assert.equal(messages.length, 1)
    })
  })
})
