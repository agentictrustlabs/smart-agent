/**
 * Tests for Sprint 1 S1.8 — production debug-response cleanup.
 *
 * Locks the policy:
 *   - In production, the HTTP response body contains ONLY `publicMessage`.
 *     The `_debug` key is unconditionally stripped, even if the caller
 *     passes verbose diagnostics in `logFields`.
 *   - In development (or any NODE_ENV !== 'production'), the structured
 *     diagnostic fields ride along under `_debug` so the network tab is
 *     useful for engineers.
 *   - The structured log line is ALWAYS emitted (production and dev),
 *     so operators can investigate from the server side regardless of
 *     what the caller sees.
 *   - Correlation id from `c.var.correlationId` is included in the log
 *     entry and (in dev) in the `_debug` block — joining the HTTP error
 *     back to the audit row.
 *   - Status code passes through unchanged.
 *
 * Run: `node --import tsx --test apps/a2a-agent/test/error-response.test.ts`
 */

process.env.A2A_SESSION_SECRET = '0x' + 'd'.repeat(64)
process.env.A2A_KMS_BACKEND = 'local-aes'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { correlationId, CORRELATION_HEADER } from '../src/middleware/correlation-id'
import { errorResponse } from '../src/lib/error-response'

/**
 * Capture stderr by monkey-patching `console.error`. The helper logs
 * via `console.error`; we collect the [message, fields] tuples and
 * restore afterwards.
 */
function captureLogs(): { restore: () => void; calls: Array<[string, Record<string, unknown>]> } {
  const calls: Array<[string, Record<string, unknown>]> = []
  const original = console.error
  console.error = ((message: unknown, fields?: unknown) => {
    calls.push([String(message), (fields ?? {}) as Record<string, unknown>])
  }) as typeof console.error
  return { restore: () => { console.error = original }, calls }
}

function mountApp(): Hono {
  const app = new Hono()
  app.use('*', correlationId)
  app.get('/boom', (c) => {
    return errorResponse(c, {
      publicMessage: 'Generic error',
      logMessage: '[test] boom',
      logFields: {
        secretHash: '0xabc123',
        upstreamUrl: 'http://internal-host:9001/admin',
        passkeyCount: 3,
      },
      status: 401,
    })
  })
  return app
}

test('errorResponse: in NODE_ENV=production, response body excludes _debug', async () => {
  const original = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  const { restore, calls } = captureLogs()
  try {
    const app = mountApp()
    const res = await app.request('/boom', { method: 'GET' })
    assert.equal(res.status, 401)
    const body = await res.json() as Record<string, unknown>
    assert.equal(body.error, 'Generic error')
    assert.ok(!('_debug' in body), '_debug must NOT appear in prod response')
    // None of the diagnostic fields can leak through any other key either.
    const serialized = JSON.stringify(body)
    assert.ok(!serialized.includes('secretHash'))
    assert.ok(!serialized.includes('upstreamUrl'))
    assert.ok(!serialized.includes('passkeyCount'))
    // Log was still emitted server-side.
    assert.equal(calls.length, 1)
  } finally {
    restore()
    process.env.NODE_ENV = original
  }
})

test('errorResponse: in NODE_ENV=development, response body INCLUDES _debug', async () => {
  const original = process.env.NODE_ENV
  process.env.NODE_ENV = 'development'
  const { restore } = captureLogs()
  try {
    const app = mountApp()
    const res = await app.request('/boom', { method: 'GET' })
    assert.equal(res.status, 401)
    const body = await res.json() as { error: string; _debug?: Record<string, unknown> }
    assert.equal(body.error, 'Generic error')
    assert.ok(body._debug, '_debug must be present in dev response')
    assert.equal(body._debug?.secretHash, '0xabc123')
    assert.equal(body._debug?.upstreamUrl, 'http://internal-host:9001/admin')
    assert.equal(body._debug?.passkeyCount, 3)
  } finally {
    restore()
    process.env.NODE_ENV = original
  }
})

test('errorResponse: log message is always emitted (prod path)', async () => {
  const original = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  const { restore, calls } = captureLogs()
  try {
    const app = mountApp()
    await app.request('/boom', { method: 'GET' })
    assert.equal(calls.length, 1)
    const [msg, fields] = calls[0]
    assert.equal(msg, '[test] boom')
    assert.equal(fields.secretHash, '0xabc123')
    assert.equal(fields.upstreamUrl, 'http://internal-host:9001/admin')
    assert.equal(fields.errorPublicMessage, 'Generic error')
    assert.equal(fields.status, 401)
  } finally {
    restore()
    process.env.NODE_ENV = original
  }
})

test('errorResponse: log message is always emitted (dev path too)', async () => {
  const original = process.env.NODE_ENV
  process.env.NODE_ENV = 'development'
  const { restore, calls } = captureLogs()
  try {
    const app = mountApp()
    await app.request('/boom', { method: 'GET' })
    assert.equal(calls.length, 1)
    const [msg] = calls[0]
    assert.equal(msg, '[test] boom')
  } finally {
    restore()
    process.env.NODE_ENV = original
  }
})

test('errorResponse: correlation id from c.var.correlationId is in the log', async () => {
  const original = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  const { restore, calls } = captureLogs()
  try {
    const app = mountApp()
    const incoming = 'sa-cor-' + 'e'.repeat(32)
    const res = await app.request('/boom', {
      method: 'GET',
      headers: { [CORRELATION_HEADER]: incoming },
    })
    assert.equal(res.headers.get(CORRELATION_HEADER), incoming)
    assert.equal(calls.length, 1)
    const [, fields] = calls[0]
    assert.equal(fields.correlationId, incoming)
  } finally {
    restore()
    process.env.NODE_ENV = original
  }
})

test('errorResponse: correlation id is also in _debug in dev mode', async () => {
  const original = process.env.NODE_ENV
  process.env.NODE_ENV = 'development'
  const { restore } = captureLogs()
  try {
    const app = mountApp()
    const incoming = 'sa-cor-' + 'f'.repeat(32)
    const res = await app.request('/boom', {
      method: 'GET',
      headers: { [CORRELATION_HEADER]: incoming },
    })
    const body = await res.json() as { _debug?: Record<string, unknown> }
    assert.equal(body._debug?.correlationId, incoming)
  } finally {
    restore()
    process.env.NODE_ENV = original
  }
})

test('errorResponse: status code passes through unchanged', async () => {
  const original = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  const { restore } = captureLogs()
  try {
    const app = new Hono()
    app.use('*', correlationId)
    app.get('/teapot', (c) =>
      errorResponse(c, {
        publicMessage: 'short and stout',
        logMessage: '[test] teapot',
        logFields: { kettle: true },
        status: 418,
      }),
    )
    app.get('/server-err', (c) =>
      errorResponse(c, {
        publicMessage: 'server-side hiccup',
        logMessage: '[test] hiccup',
        logFields: {},
        status: 500,
      }),
    )

    const r1 = await app.request('/teapot')
    assert.equal(r1.status, 418)
    const r2 = await app.request('/server-err')
    assert.equal(r2.status, 500)
  } finally {
    restore()
    process.env.NODE_ENV = original
  }
})

test('errorResponse: simulated /session/package ERC-1271 rejection — prod body has no crypto state', async () => {
  // Mirrors the leak the senior security review flagged: the
  // pre-S1.8 handler returned `clientDataJSON`, `credentialDigest`,
  // `delegationHash`, `passkeyPath`, and `passkeyCount` in the
  // response body. After S1.8, the public response must only carry
  // 'Delegation signature invalid'.
  const original = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  const { restore, calls } = captureLogs()
  try {
    const app = new Hono()
    app.use('*', correlationId)
    app.post('/session/package', (c) => {
      // Simulate the exact diagnostic shape /session/package builds.
      return errorResponse(c, {
        publicMessage: 'Delegation signature invalid',
        logMessage: '[session/package] ERC-1271 rejected',
        logFields: {
          sessionId: 'sa_testsessionabc',
          accountAddressHash: '0xdeadbeef',
          errorCode: 'erc1271-rejected',
          delegationHash: '0xfacefeed',
          passkeyPath: 'webauthn',
          passkeyCount: '2',
          credentialDigest: '0xcafebabe',
          clientDataJSONHash: '0xbadcafe',
        },
        status: 401,
      })
    })

    const res = await app.request('/session/package', { method: 'POST' })
    assert.equal(res.status, 401)
    const body = await res.json() as Record<string, unknown>
    assert.equal(body.error, 'Delegation signature invalid')

    // The body MUST NOT include any of the diagnostic field names or
    // their values.
    const serialized = JSON.stringify(body)
    assert.ok(!serialized.includes('clientDataJSON'), 'clientDataJSON leaked')
    assert.ok(!serialized.includes('credentialDigest'), 'credentialDigest leaked')
    assert.ok(!serialized.includes('delegationHash'), 'delegationHash leaked')
    assert.ok(!serialized.includes('passkeyPath'), 'passkeyPath leaked')
    assert.ok(!serialized.includes('passkeyCount'), 'passkeyCount leaked')
    assert.ok(!serialized.includes('0xfacefeed'), 'delegationHash value leaked')
    assert.ok(!serialized.includes('0xcafebabe'), 'credentialDigest value leaked')

    // Server log preserved the full diagnostic structure.
    assert.equal(calls.length, 1)
    const [msg, fields] = calls[0]
    assert.equal(msg, '[session/package] ERC-1271 rejected')
    assert.equal(fields.credentialDigest, '0xcafebabe')
    assert.equal(fields.delegationHash, '0xfacefeed')
  } finally {
    restore()
    process.env.NODE_ENV = original
  }
})
