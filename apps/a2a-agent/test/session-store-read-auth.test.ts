/**
 * Sprint 5 Wave 2 P1-1 — session-store READ routes must enforce
 * `requireServiceAuth('web')`.
 *
 * Before P1-1, only the three POST writes (/insert, /revoke,
 * /bump-epoch) sat behind service-auth. The three reads
 * (/epoch/:account, /by-cookie/:cookieValue, /active/:account) were
 * unauthenticated at the a2a edge — anyone on the network could list
 * session metadata (which cookie maps to which smart account, the
 * active-session set for any account, the revocation epoch).
 *
 * This file mounts the session-store route module against a fresh Hono
 * app and asserts each read route enforces the same envelope as the
 * writes:
 *
 *   - unsigned        → 401 "missing service-auth headers"
 *   - bad signature   → 401 "signature mismatch"
 *   - stale timestamp → 401 "timestamp out of window"
 *   - replayed nonce  → second request 401 "replay detected"
 *   - signed ok       → escapes the service-auth deny branch
 *
 * Body hash for GETs is sha256("") — the canonical-v2 spec from Sprint 5
 * P0-3 (`${ts}|${nonce}|${path}|${sha256(body)}`).
 *
 * Run: `node --import tsx --test apps/a2a-agent/test/session-store-read-auth.test.ts`
 */

// Configure env BEFORE importing the route module so the middleware's
// MAC-provider cache resolves the secret correctly on first .get().
const TEST_SECRET = '0xb7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7b7'
process.env.WEB_TO_A2A_HMAC_KEY = TEST_SECRET
// The downstream forward to person-mcp re-signs with the
// `a2a-to-person` key. We DON'T set it here on purpose: the upstream
// re-sign step throws when the key is missing, which gives us a clean
// signal that the inbound `requireServiceAuth('web')` accepted (the
// throw happens inside the route handler, after the middleware
// returned next()). With the key set, the route would attempt a
// real fetch to PERSON_MCP_URL which is undefined / unreachable in
// this test environment and would produce a more brittle error path.
process.env.A2A_KMS_BACKEND = 'local-aes'
process.env.PERSON_MCP_URL = 'http://127.0.0.1:1'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { createHash, randomUUID } from 'node:crypto'
import { toBase64Url } from '@smart-agent/sdk'
import { buildWebMacProvider } from '@smart-agent/sdk/key-custody'
import { sessionStore } from '../src/routes/session-store'
import { buildWebCanonical } from '../src/auth/service-auth-web'

const webMacProvider = buildWebMacProvider(process.env)

function mountApp() {
  const app = new Hono()
  app.route('/session-store', sessionStore)
  return app
}

type Headers = Record<string, string>

async function signGet(path: string, opts?: { ts?: number; nonce?: string }): Promise<Headers> {
  const timestamp = opts?.ts ?? Math.floor(Date.now() / 1000)
  const nonce = opts?.nonce ?? randomUUID()
  // GET → empty body; canonical uses sha256("") per Sprint 5 P0-3.
  const canonical = buildWebCanonical(timestamp, nonce, path, '')
  const { mac } = await webMacProvider.generateMac({
    canonicalMessage: new TextEncoder().encode(canonical),
  })
  return {
    'content-type': 'application/json',
    'x-sa-service': 'web',
    'x-sa-timestamp': String(timestamp),
    'x-sa-nonce': nonce,
    'x-sa-signature': toBase64Url(mac),
  }
}

const READ_ROUTES: Array<{ name: string; path: string }> = [
  { name: 'epoch', path: '/session-store/epoch/0x1234567890abcdef1234567890abcdef12345678' },
  { name: 'by-cookie', path: '/session-store/by-cookie/cookie-abc123' },
  { name: 'active', path: '/session-store/active/0x1234567890abcdef1234567890abcdef12345678' },
]

const SERVICE_AUTH_DENY_REASONS = [
  /missing service-auth headers/,
  /unexpected service/,
  /invalid timestamp/,
  /timestamp out of window/,
  /signature mismatch/,
  /replay detected/,
]

// ─── Unsigned reads must 401 ─────────────────────────────────────────

for (const { name, path } of READ_ROUTES) {
  test(`GET ${name} unsigned → 401 (service-auth required)`, async () => {
    const app = mountApp()
    const res = await app.request(path, { method: 'GET' })
    assert.equal(res.status, 401, `expected 401 for unsigned ${path}, got ${res.status}`)
    const body = await res.json() as { error: string }
    assert.match(
      body.error,
      /missing service-auth headers/,
      `expected service-auth deny on ${path}, got "${body.error}"`,
    )
  })
}

// ─── Bad signature on each read → 401 ────────────────────────────────

for (const { name, path } of READ_ROUTES) {
  test(`GET ${name} with bad signature → 401`, async () => {
    const app = mountApp()
    const timestamp = Math.floor(Date.now() / 1000)
    const nonce = randomUUID()
    // Sign over a DIFFERENT path so the signature won't match this one.
    const wrongCanonical = buildWebCanonical(timestamp, nonce, '/session-store/different', '')
    const { mac } = await webMacProvider.generateMac({
      canonicalMessage: new TextEncoder().encode(wrongCanonical),
    })
    const res = await app.request(path, {
      method: 'GET',
      headers: {
        'content-type': 'application/json',
        'x-sa-service': 'web',
        'x-sa-timestamp': String(timestamp),
        'x-sa-nonce': nonce,
        'x-sa-signature': toBase64Url(mac),
      },
    })
    assert.equal(res.status, 401)
    const body = await res.json() as { error: string }
    assert.match(body.error, /signature mismatch/)
  })
}

// ─── Stale timestamp on each read → 401 ──────────────────────────────

for (const { name, path } of READ_ROUTES) {
  test(`GET ${name} with stale timestamp → 401`, async () => {
    const app = mountApp()
    // 999 seconds outside the ±60s window.
    const staleTs = Math.floor(Date.now() / 1000) - 999
    const headers = await signGet(path, { ts: staleTs })
    const res = await app.request(path, { method: 'GET', headers })
    assert.equal(res.status, 401)
    const body = await res.json() as { error: string }
    assert.match(body.error, /timestamp out of window/)
  })
}

// ─── Signed-correctly reads must NOT return a service-auth deny ──────
//
// When the request is well-formed the middleware must call next().
// The downstream forward to person-mcp then throws (no
// A2A_INTERSERVICE_HMAC_KEY_PERSON configured in this test) which
// surfaces as a 500. The important assertion is that the response is
// NOT one of the documented service-auth deny messages — those are the
// pre-P1-1 attack surface we're closing.

for (const { name, path } of READ_ROUTES) {
  test(`GET ${name} signed correctly → escapes service-auth deny branch`, async () => {
    const app = mountApp()
    const headers = await signGet(path)
    const res = await app.request(path, { method: 'GET', headers })
    // A well-signed request must not yield any of the service-auth
    // deny error strings. The downstream handler may still 500 because
    // the test env doesn't configure A2A_INTERSERVICE_HMAC_KEY_PERSON;
    // that's fine — 500 means we left the middleware.
    if (res.status === 401) {
      const body = await res.json() as { error?: string }
      const errorText = body.error ?? ''
      for (const denyRe of SERVICE_AUTH_DENY_REASONS) {
        assert.doesNotMatch(
          errorText,
          denyRe,
          `well-signed GET ${path} should not return service-auth deny "${denyRe}", got "${errorText}"`,
        )
      }
    }
  })
}

// ─── Replay defense on each read ─────────────────────────────────────
//
// Two requests with the same nonce: the first either passes the
// middleware (handler then 500s downstream) or — if the underlying
// nonce table is in a particular state — returns the well-signed-then-
// 500 path. The SECOND request reuses the burned nonce and MUST be
// rejected with 401 "replay detected".

for (const { name, path } of READ_ROUTES) {
  test(`GET ${name} replayed nonce → second request 401 replay detected`, async () => {
    const app = mountApp()
    const nonce = 'replay-' + randomUUID()
    const headers = await signGet(path, { nonce })
    // First request: drive the middleware so the nonce is burned. We
    // don't care what status comes back here — the middleware MUST
    // have called recordNonce(nonce) for the replay-defense test to
    // make sense. (If the middleware rejected with 401 / signature-
    // mismatch the nonce was NOT recorded; that's a regression and
    // the other tests will surface it.)
    await app.request(path, { method: 'GET', headers })
    // Second request: same nonce → 401 replay detected.
    const second = await app.request(path, { method: 'GET', headers })
    assert.equal(second.status, 401, `expected 401 on replay, got ${second.status}`)
    const body = await second.json() as { error: string }
    assert.match(body.error, /replay detected/, `expected replay-detected error, got "${body.error}"`)
  })
}

// ─── Canonical-v2 body-hash for GETs is sha256("") ───────────────────

test('canonical-v2: GET body hash equals sha256 of empty string', () => {
  // Lock in the Sprint 5 P0-3 canonical-v2 spec for GET requests so a
  // future refactor can't drift to "omit the body-hash for GETs" or
  // similar.
  const emptyHash = createHash('sha256').update('', 'utf8').digest('hex')
  const ts = 1746902400
  const nonce = 'fixed-nonce'
  const path = '/session-store/epoch/0xdeadbeef'
  const canonical = buildWebCanonical(ts, nonce, path, '')
  assert.equal(canonical, `${ts}|${nonce}|${path}|${emptyHash}`)
})
