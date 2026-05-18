/**
 * Tests for Sprint 5 W3 P1-2 — wire-auth gate on the SSI HTTP surfaces.
 *
 * Covers the five endpoints that used to accept unauthenticated callers
 * despite person-mcp owning PII:
 *
 *   GET  /wallet/:principal
 *   GET  /wallet/:principal/:context
 *   GET  /credentials/:holderWalletId
 *   GET  /audit/:holderWalletId/credentials
 *   POST /credentials/store
 *
 * For each endpoint we assert:
 *   1. unsigned request                              → 401 missing headers
 *   2. signed by an unknown service                  → 401 unexpected service
 *   3. stale timestamp (correct sig)                 → 401 timestamp out of window
 *   4. bad signature                                 → 401 signature mismatch
 *   5. valid envelope                                → routes past wire-auth
 *      (downstream code may still 4xx/5xx — what matters is the failure
 *      mode is no longer "missing service-auth headers" / "signature
 *      mismatch" / "unexpected service" / "timestamp out of window").
 *
 * Run: `node --import tsx --test apps/person-mcp/test/ssi-auth-required.test.ts`
 */

// Pre-import env wiring. ESM hoists `import` statements, so we rely on
// dynamic `await import()` inside `loadDeps()` for the modules whose
// init reads these. Static imports are limited to env-independent
// stdlib + node:test machinery.
process.env.A2A_KMS_BACKEND = process.env.A2A_KMS_BACKEND ?? 'local-aes'
process.env.A2A_INTERSERVICE_HMAC_KEY_PERSON =
  process.env.A2A_INTERSERVICE_HMAC_KEY_PERSON ?? '0x' + 'c'.repeat(64)
process.env.PERSON_MCP_DB_PATH =
  process.env.PERSON_MCP_DB_PATH ?? 'person-mcp.ssi-auth-required.test.db'
process.env.CREDENTIAL_REGISTRY_CONTRACT_ADDRESS =
  process.env.CREDENTIAL_REGISTRY_CONTRACT_ADDRESS ?? '0x' + '1'.repeat(40)
process.env.CHAIN_ID = process.env.CHAIN_ID ?? '31337'
process.env.RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'

interface SignedHeaders {
  'x-sa-service': string
  'x-sa-timestamp': string
  'x-sa-nonce': string
  'x-sa-signature': string
}

// Cached dynamic imports — fetched once per test file run, AFTER the
// top-level env mutations above have executed.
let cachedDeps: {
  buildInboundCanonical: (
    ts: number,
    nonce: string,
    path: string,
    bodyRaw: string,
  ) => string
  app: Hono
  signedHeaders: (
    path: string,
    bodyRaw: string,
    opts?: { overrideTs?: number },
  ) => Promise<SignedHeaders>
} | null = null

async function loadDeps() {
  if (cachedDeps) return cachedDeps
  const reqMod = await import('../src/auth/require-inbound-service-auth')
  reqMod.resetInboundMacProviderForTest()
  const sdk = await import('@smart-agent/sdk')
  const kc = await import('@smart-agent/sdk/key-custody')
  const wallet = await import('../src/ssi/api/wallet')
  const credentials = await import('../src/ssi/api/credentials')
  const audit = await import('../src/ssi/api/audit')

  const app = new Hono()
  app.route('/', wallet.walletRoutes)
  app.route('/', credentials.credentialRoutes)
  app.route('/', audit.auditRoutes)

  const macProvider = kc.buildMcpMacProvider('person', process.env)

  const signedHeaders = async (
    path: string,
    bodyRaw: string,
    opts: { overrideTs?: number } = {},
  ): Promise<SignedHeaders> => {
    const timestamp = opts.overrideTs ?? Math.floor(Date.now() / 1000)
    const nonce = randomUUID()
    const canonical = reqMod.buildInboundCanonical(timestamp, nonce, path, bodyRaw)
    const { mac } = await macProvider.generateMac({
      canonicalMessage: new TextEncoder().encode(canonical),
    })
    return {
      'x-sa-service': 'a2a-agent',
      'x-sa-timestamp': String(timestamp),
      'x-sa-nonce': nonce,
      'x-sa-signature': sdk.toBase64Url(mac),
    }
  }

  cachedDeps = {
    buildInboundCanonical: reqMod.buildInboundCanonical,
    app,
    signedHeaders,
  }
  return cachedDeps
}

interface Endpoint {
  method: 'GET' | 'POST'
  path: string
  body?: string
}

/**
 * The five SSI endpoints under test. `path` is the concrete URL the
 * request lands on (with sample path params); `body` is the raw bytes
 * to send for POST. Each endpoint MUST reject unsigned / bad-signed
 * requests with 401 regardless of whether the path params resolve to
 * a real row in the dev DB.
 */
const ENDPOINTS: Endpoint[] = [
  { method: 'GET', path: '/wallet/0xprincipal' },
  { method: 'GET', path: '/wallet/0xprincipal/default' },
  { method: 'GET', path: '/credentials/hw_test' },
  { method: 'GET', path: '/audit/hw_test/credentials' },
  {
    method: 'POST',
    path: '/credentials/store',
    body: JSON.stringify({
      holderWalletId: 'hw_test',
      requestId: 'req_test',
      credentialJson: '{}',
      credentialType: 'TestCredential',
      issuerId: 'issuer:test',
      schemaId: 'schema:test',
    }),
  },
]

for (const ep of ENDPOINTS) {
  const label = `${ep.method} ${ep.path}`

  test(`${label} — unsigned → 401 missing service-auth headers`, async () => {
    const { app } = await loadDeps()
    const res = await app.request(ep.path, {
      method: ep.method,
      headers: { 'content-type': 'application/json' },
      body: ep.body,
    })
    assert.equal(res.status, 401, `${label} unsigned should be 401`)
    const j = (await res.json().catch(() => ({}))) as { error?: string }
    assert.match(j.error ?? '', /missing service-auth headers/)
  })

  test(`${label} — bad signature → 401`, async () => {
    const { app, signedHeaders } = await loadDeps()
    const bodyRaw = ep.body ?? ''
    // Sign over the WRONG path so the canonical string does not match.
    const headers = await signedHeaders('/wrong/path', bodyRaw)
    const res = await app.request(ep.path, {
      method: ep.method,
      headers: { 'content-type': 'application/json', ...headers },
      body: ep.body,
    })
    assert.equal(res.status, 401, `${label} bad signature should be 401`)
    const j = (await res.json().catch(() => ({}))) as { error?: string }
    assert.match(j.error ?? '', /signature mismatch/)
  })

  test(`${label} — stale timestamp → 401`, async () => {
    const { app, signedHeaders } = await loadDeps()
    const bodyRaw = ep.body ?? ''
    const headers = await signedHeaders(ep.path, bodyRaw, {
      overrideTs: Math.floor(Date.now() / 1000) - 9999,
    })
    const res = await app.request(ep.path, {
      method: ep.method,
      headers: { 'content-type': 'application/json', ...headers },
      body: ep.body,
    })
    assert.equal(res.status, 401, `${label} stale ts should be 401`)
    const j = (await res.json().catch(() => ({}))) as { error?: string }
    assert.match(j.error ?? '', /timestamp out of window/)
  })

  test(`${label} — unknown service header → 401`, async () => {
    const { app, signedHeaders } = await loadDeps()
    const bodyRaw = ep.body ?? ''
    const headers = await signedHeaders(ep.path, bodyRaw)
    headers['x-sa-service'] = 'rogue-mcp'
    const res = await app.request(ep.path, {
      method: ep.method,
      headers: { 'content-type': 'application/json', ...headers },
      body: ep.body,
    })
    assert.equal(res.status, 401, `${label} unknown service should be 401`)
    const j = (await res.json().catch(() => ({}))) as { error?: string }
    assert.match(j.error ?? '', /unexpected service/)
  })

  test(`${label} — valid envelope → past wire-auth`, async () => {
    const { app, signedHeaders } = await loadDeps()
    const bodyRaw = ep.body ?? ''
    const headers = await signedHeaders(ep.path, bodyRaw)
    const res = await app.request(ep.path, {
      method: ep.method,
      headers: { 'content-type': 'application/json', ...headers },
      body: ep.body,
    })
    // Wire-auth must let the request through. The downstream handler is
    // free to 404 / 400 / 200 depending on whether the path-params
    // resolve to real rows in the test DB; what's important is that the
    // failure mode is NOT one of the wire-auth deny reasons.
    const text = await res.text()
    let body: { error?: string } = {}
    try { body = JSON.parse(text) as { error?: string } } catch { /* ignore */ }
    const err = body.error ?? ''
    assert.doesNotMatch(err, /missing service-auth headers/, `${label}: wire-auth header check fired`)
    assert.doesNotMatch(err, /signature mismatch/, `${label}: wire-auth signature check fired`)
    assert.doesNotMatch(err, /timestamp out of window/, `${label}: wire-auth timestamp check fired`)
    assert.doesNotMatch(err, /unexpected service/, `${label}: wire-auth service check fired`)
  })
}
