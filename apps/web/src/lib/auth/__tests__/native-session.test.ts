/**
 * Tests for the Sprint 2 S2.4 JWT key-id + rotation surface.
 *
 * Covers:
 *  - mint embeds the active kid in the header
 *  - verify with matching kid succeeds
 *  - verify with rotated-out (still-listed) kid succeeds
 *  - verify with an unknown kid (rotated out of the list) returns null
 *  - production guards (no keys; dev-fallback as active key)
 *  - backward compat: header-less token verifies under singular
 *    SESSION_JWT_SECRET, but signing under that mode is refused
 *  - default TTL is 24 hours, not the legacy 30 days
 *
 * NODE_ENV is mutated through a Record cast because Next.js types it
 * readonly. Same trick the env-guard test uses.
 */
import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { mintSession, verifySession, SESSION_TTL_SECONDS } from '../native-session'
import { signJwt, verifyJwt, loadJwtKeys } from '../jwt'

const env = process.env as Record<string, string | undefined>

const HEX_A = '11'.repeat(32) // 64-char hex → 32 bytes
const HEX_B = '22'.repeat(32)
const HEX_C = '33'.repeat(32)

function decodeHeader(token: string): { alg?: string; typ?: string; kid?: string } {
  const [headerB64] = token.split('.')
  const padded =
    headerB64.replace(/-/g, '+').replace(/_/g, '/') +
    '=='.slice((2 - (headerB64.length & 3)) & 3)
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
}

describe('jwt — key-id + rotation (Sprint 2 S2.4)', () => {
  const ORIG_NODE_ENV = env.NODE_ENV
  const ORIG_SECRETS = env.SESSION_JWT_SECRETS
  const ORIG_SECRET = env.SESSION_JWT_SECRET
  const ORIG_COOKIE_SECRET = env.COOKIE_SIGNING_SECRET

  beforeEach(() => {
    delete env.NODE_ENV
    delete env.SESSION_JWT_SECRETS
    delete env.SESSION_JWT_SECRET
    delete env.COOKIE_SIGNING_SECRET
  })

  afterEach(() => {
    if (ORIG_NODE_ENV === undefined) delete env.NODE_ENV
    else env.NODE_ENV = ORIG_NODE_ENV
    if (ORIG_SECRETS === undefined) delete env.SESSION_JWT_SECRETS
    else env.SESSION_JWT_SECRETS = ORIG_SECRETS
    if (ORIG_SECRET === undefined) delete env.SESSION_JWT_SECRET
    else env.SESSION_JWT_SECRET = ORIG_SECRET
    if (ORIG_COOKIE_SECRET === undefined) delete env.COOKIE_SIGNING_SECRET
    else env.COOKIE_SIGNING_SECRET = ORIG_COOKIE_SECRET
  })

  it('mintSession embeds the active kid in the JWT header', () => {
    env.SESSION_JWT_SECRETS = `2026-05-v2:${HEX_A},2026-05-v1:${HEX_B}`

    const token = mintSession({ sub: 'did:test:1', kind: 'session' })
    const header = decodeHeader(token)
    assert.equal(header.alg, 'HS256')
    assert.equal(header.kid, '2026-05-v2')
  })

  it('verifies a token signed with the matching (active) kid', () => {
    env.SESSION_JWT_SECRETS = `2026-05-v2:${HEX_A},2026-05-v1:${HEX_B}`

    const token = mintSession({ sub: 'did:test:1', kind: 'session' })
    const claims = verifySession(token)
    assert.notEqual(claims, null)
    assert.equal(claims?.sub, 'did:test:1')
  })

  it('verifies a token signed with a rotated-out (still-listed) kid', () => {
    // Step 1: sign while v1 is the active key.
    env.SESSION_JWT_SECRETS = `2026-05-v1:${HEX_B}`
    const token = mintSession({ sub: 'did:test:1', kind: 'session' })
    assert.equal(decodeHeader(token).kid, '2026-05-v1')

    // Step 2: rotate — v2 becomes active, v1 remains valid for verify.
    env.SESSION_JWT_SECRETS = `2026-05-v2:${HEX_A},2026-05-v1:${HEX_B}`
    const claims = verifySession(token)
    assert.notEqual(claims, null)
    assert.equal(claims?.sub, 'did:test:1')
  })

  it('returns null for a token whose kid has been rotated OUT of the list', () => {
    // Sign with v1.
    env.SESSION_JWT_SECRETS = `2026-05-v1:${HEX_B}`
    const token = mintSession({ sub: 'did:test:1', kind: 'session' })

    // Drop v1 entirely; only v2 is configured now.
    env.SESSION_JWT_SECRETS = `2026-05-v2:${HEX_A}`
    const claims = verifySession(token)
    assert.equal(claims, null)
  })

  it('production guard: no keys configured → loadJwtKeys throws', () => {
    env.NODE_ENV = 'production'
    assert.throws(() => loadJwtKeys(), /SESSION_JWT_SECRETS/)
  })

  it('production guard: active kid "dev-fallback" → loadJwtKeys throws', () => {
    env.NODE_ENV = 'production'
    env.SESSION_JWT_SECRETS = `dev-fallback:${HEX_A},2026-05-v1:${HEX_B}`
    assert.throws(() => loadJwtKeys(), /dev-fallback/)
  })

  it('backward compat: header-less token verifies under SESSION_JWT_SECRET fallback', () => {
    // Forge a header-less token the way the pre-S2.4 code did.
    env.SESSION_JWT_SECRET = HEX_A

    // Sanity check: signJwt under verify-only mode must refuse to sign.
    assert.throws(
      () => signJwt({ sub: 'did:test:1', kind: 'session' }),
      /no active signing key/,
    )

    // Hand-build a no-kid HS256 token signed with the same secret.
    const headerB64 = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    const now = Math.floor(Date.now() / 1000)
    const payloadB64 = Buffer.from(
      JSON.stringify({ sub: 'did:test:1', kind: 'session', iat: now, exp: now + 60 }),
      'utf8',
    )
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    const data = `${headerB64}.${payloadB64}`
    // SESSION_JWT_SECRET was historically used as a utf8 string (not hex).
    const sig = createHmac('sha256', Buffer.from(HEX_A, 'utf8')).update(data).digest()
    const sigB64 = sig
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    const token = `${data}.${sigB64}`

    const claims = verifyJwt(token)
    assert.notEqual(claims, null)
    assert.equal(claims?.sub, 'did:test:1')
  })

  it('default session TTL is 24 hours (not the legacy 30 days)', () => {
    env.SESSION_JWT_SECRETS = `2026-05-v1:${HEX_A}`

    const before = Math.floor(Date.now() / 1000)
    const token = mintSession({ sub: 'did:test:1', kind: 'session' })
    const after = Math.floor(Date.now() / 1000)

    const claims = verifySession(token)
    assert.notEqual(claims, null)
    const ttl = (claims!.exp as number) - (claims!.iat as number)

    // Tolerate ±1s clock skew between Date.now reads.
    assert.equal(ttl, SESSION_TTL_SECONDS)
    assert.equal(SESSION_TTL_SECONDS, 60 * 60 * 24)

    // Sanity: exp lands roughly 24h from now.
    const expectedExp = before + 60 * 60 * 24
    assert.ok((claims!.exp as number) >= expectedExp)
    assert.ok((claims!.exp as number) <= after + 60 * 60 * 24)
  })

  it('SESSION_JWT_SECRETS: malformed entry → loadJwtKeys throws', () => {
    env.SESSION_JWT_SECRETS = 'no-colon-here'
    assert.throws(() => loadJwtKeys(), /SESSION_JWT_SECRETS/)
  })

  it('SESSION_JWT_SECRETS: duplicate kid → loadJwtKeys throws', () => {
    env.SESSION_JWT_SECRETS = `2026-05-v1:${HEX_A},2026-05-v1:${HEX_C}`
    assert.throws(() => loadJwtKeys(), /duplicate kid/)
  })

  it('verifyJwt returns null for a token whose signature was tampered', () => {
    env.SESSION_JWT_SECRETS = `2026-05-v1:${HEX_A}`
    const token = mintSession({ sub: 'did:test:1', kind: 'session' })

    const parts = token.split('.')
    // Flip a bit in the signature.
    const bad = parts[2].slice(0, -2) + (parts[2].endsWith('aa') ? 'bb' : 'aa')
    const tampered = `${parts[0]}.${parts[1]}.${bad}`
    assert.equal(verifyJwt(tampered), null)
  })
})
