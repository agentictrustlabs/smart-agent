/**
 * Tests for `apps/web/src/lib/auth/oauth-salt.ts` — Sprint S2.6 migration
 * of the google-oauth deterministic salt from `SERVER_PEPPER` + sha256 to
 * the K3-ext `oauth-salt` MAC key (KMS-HMAC).
 *
 * Covers:
 *   - Deterministic: same (email, rotation) → same 32-byte salt across
 *     calls.
 *   - Different rotation → different salt (the "Start fresh" escape
 *     hatch depends on this).
 *   - Different email → different salt.
 *   - Provider cached on first call (subsequent calls reuse the same
 *     `KmsMacProvider` instance).
 *   - Works under `A2A_KMS_BACKEND=local-aes` (the default dev path).
 *
 * Tests run in `apps/web/`'s `node --import tsx --test` runner; we mutate
 * `process.env` via an index-signature cast (NODE_ENV is readonly in
 * Next.js's tsconfig — same trick as `env-guard.test.ts`).
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  deriveOauthSalt,
  deriveOauthSaltBigInt,
  canonicalOauthSaltMessage,
  _resetOauthSaltProviderForTests,
} from '../oauth-salt'

const env = process.env as Record<string, string | undefined>

const SAVED_KEYS = [
  'NODE_ENV',
  'A2A_KMS_BACKEND',
  'OAUTH_SALT_HMAC_KEY',
] as const

// 32-byte hex key (64 hex chars after `0x`).
const DEV_HEX = '0x' + 'c8'.repeat(32)
const ALT_HEX = '0x' + 'ab'.repeat(32)

describe('oauth-salt — deriveOauthSalt', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const k of SAVED_KEYS) {
      saved[k] = env[k]
      delete env[k]
    }
    // Dev path — local-hmac provider, hex secret in OAUTH_SALT_HMAC_KEY.
    env.NODE_ENV = 'development'
    env.A2A_KMS_BACKEND = 'local-aes'
    env.OAUTH_SALT_HMAC_KEY = DEV_HEX
    _resetOauthSaltProviderForTests()
  })

  afterEach(() => {
    for (const k of SAVED_KEYS) {
      if (saved[k] === undefined) delete env[k]
      else env[k] = saved[k]
    }
    _resetOauthSaltProviderForTests()
  })

  it('returns 32 raw bytes from HMAC-SHA-256', async () => {
    const out = await deriveOauthSalt('alice@example.com', 0)
    assert.ok(out instanceof Uint8Array)
    assert.equal(out.length, 32)
  })

  it('is deterministic: same email + rotation → same salt', async () => {
    const a = await deriveOauthSalt('alice@example.com', 0)
    const b = await deriveOauthSalt('alice@example.com', 0)
    assert.deepEqual(Array.from(a), Array.from(b))
  })

  it('lowercases + trims the email so case + whitespace do not split addresses', async () => {
    const a = await deriveOauthSalt('Alice@Example.com', 0)
    const b = await deriveOauthSalt('  alice@example.com  ', 0)
    assert.deepEqual(Array.from(a), Array.from(b))
  })

  it('different rotation → different salt (Start-fresh contract)', async () => {
    const r0 = await deriveOauthSalt('alice@example.com', 0)
    const r1 = await deriveOauthSalt('alice@example.com', 1)
    assert.notDeepEqual(Array.from(r0), Array.from(r1))
  })

  it('different email → different salt', async () => {
    const a = await deriveOauthSalt('alice@example.com', 0)
    const b = await deriveOauthSalt('bob@example.com', 0)
    assert.notDeepEqual(Array.from(a), Array.from(b))
  })

  it('different MAC key → different salt (a fresh KMS key rotates every address)', async () => {
    const a = await deriveOauthSalt('alice@example.com', 0)
    // Swap the local-hmac secret and rebuild the provider — same canonical
    // message, different key bytes, therefore different MAC.
    env.OAUTH_SALT_HMAC_KEY = ALT_HEX
    _resetOauthSaltProviderForTests()
    const b = await deriveOauthSalt('alice@example.com', 0)
    assert.notDeepEqual(Array.from(a), Array.from(b))
  })

  it('canonicalOauthSaltMessage is stable and version-pinned', () => {
    assert.equal(
      canonicalOauthSaltMessage('Alice@Example.com', 0),
      'oauth-salt:v1:alice@example.com:0',
    )
    assert.equal(
      canonicalOauthSaltMessage('alice@example.com', '5'),
      'oauth-salt:v1:alice@example.com:5',
    )
  })

  it('provider is cached on first call', async () => {
    // Drive a derive once to construct the provider, then strip the env
    // var. If the cache works, a second derive uses the cached provider
    // and still produces the same salt; if the cache leaks, the second
    // call would rebuild without the env var and throw.
    const a = await deriveOauthSalt('alice@example.com', 0)
    delete env.OAUTH_SALT_HMAC_KEY
    const b = await deriveOauthSalt('alice@example.com', 0)
    assert.deepEqual(Array.from(a), Array.from(b))
  })

  it('works under A2A_KMS_BACKEND=local-aes (the dev default)', async () => {
    // local-aes is already set in beforeEach. Re-derive to assert the path
    // resolves end-to-end without throwing — no extra env wiring needed.
    const out = await deriveOauthSalt('alice@example.com', 0)
    assert.equal(out.length, 32)
  })

  it('deriveOauthSaltBigInt is the big-endian uint256 of the MAC bytes', async () => {
    const bytes = await deriveOauthSalt('alice@example.com', 0)
    const bi = await deriveOauthSaltBigInt('alice@example.com', 0)
    // Reconstruct manually and compare.
    let expected = 0n
    for (const b of bytes) expected = (expected << 8n) | BigInt(b)
    assert.equal(bi, expected)
  })

  it('fails fast when OAUTH_SALT_HMAC_KEY is missing on first construction', async () => {
    delete env.OAUTH_SALT_HMAC_KEY
    _resetOauthSaltProviderForTests()
    await assert.rejects(
      () => deriveOauthSalt('alice@example.com', 0),
      /OAUTH_SALT_HMAC_KEY is missing/,
    )
  })

  it('refuses local-aes when NODE_ENV=production (factory-level S2.6 guard)', async () => {
    // The MAC provider factory short-circuits BEFORE the local-hmac
    // provider gets a chance to construct, so the production guard
    // surfaces with the factory's message (not the local-hmac one). This
    // is the same guard that protects every K3-ext MAC key.
    env.NODE_ENV = 'production'
    _resetOauthSaltProviderForTests()
    await assert.rejects(
      () => deriveOauthSalt('alice@example.com', 0),
      /buildMacProvider\(oauth-salt\): refusing to instantiate 'local-aes' in production/,
    )
  })
})
