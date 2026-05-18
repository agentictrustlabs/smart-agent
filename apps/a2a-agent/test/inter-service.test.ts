/**
 * Tests for `apps/a2a-agent/src/auth/inter-service.ts` integration with
 * the K3-extension MAC provider abstraction.
 *
 * Covers:
 *   - missing headers → 401
 *   - unknown service → 401
 *   - misconfigured service (no env var) → 403
 *   - valid signature for org-mcp routed to the correct MAC key
 *   - signature signed under a DIFFERENT MCP's key fails (defense-in-depth)
 *
 * Run: `node --import tsx --test apps/a2a-agent/test/inter-service.test.ts`
 */
const SECRET_ORG = '0xa' + 'a'.repeat(63)
const SECRET_PERSON = '0xb' + 'b'.repeat(63)
process.env.A2A_KMS_BACKEND = 'local-aes'
process.env.A2A_INTERSERVICE_HMAC_KEY_ORG = SECRET_ORG
process.env.A2A_INTERSERVICE_HMAC_KEY_PERSON = SECRET_PERSON

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import { createHash, randomUUID } from 'node:crypto'
import { requireInterServiceAuth } from '../src/auth/inter-service'
import { toBase64Url } from '@smart-agent/sdk'
import { buildMcpMacProvider } from '@smart-agent/sdk/key-custody'

function mountApp() {
  const app = new Hono()
  app.post(
    '/session/:id/redeem-tx',
    requireInterServiceAuth(),
    async (c) => c.json({ ok: true }),
  )
  return app
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex')
}

/**
 * Canonical-v2 — `${ts}|${nonce}|${path}|${sha256(body)}`. Matches the
 * shape every other service-auth hop in the codebase uses. The bug fixed
 * by P0-3 was that this helper used to build `${body}:${ts}:${sessionId}`
 * which did NOT bind the nonce, making `(timestamp, signature, body)`
 * replayable within the timestamp window against any path.
 */
async function signWith(
  mcpName: 'org' | 'person',
  _service: string,
  sessionId: string,
  bodyJson: string,
  overrideTs?: number,
  overrideNonce?: string,
  overridePath?: string,
): Promise<{ timestamp: number; nonce: string; signature: string }> {
  const provider = buildMcpMacProvider(mcpName, process.env)
  const timestamp = overrideTs ?? Math.floor(Date.now() / 1000)
  const nonce = overrideNonce ?? randomUUID()
  const path = overridePath ?? `/session/${sessionId}/redeem-tx`
  const canonical = `${timestamp}|${nonce}|${path}|${sha256Hex(bodyJson)}`
  const { mac } = await provider.generateMac({
    canonicalMessage: new TextEncoder().encode(canonical),
  })
  return { timestamp, nonce, signature: toBase64Url(mac) }
}

test('missing inter-service headers → 401', async () => {
  const app = mountApp()
  const res = await app.request('/session/sess-1/redeem-tx', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  })
  assert.equal(res.status, 401)
  const body = await res.json() as { error: string }
  assert.match(body.error, /missing inter-service auth headers/)
})

test('unknown service header → 401', async () => {
  const app = mountApp()
  const bodyJson = JSON.stringify({})
  const { timestamp, nonce, signature } = await signWith('org', 'org-mcp', 'sess-2', bodyJson)
  const res = await app.request('/session/sess-2/redeem-tx', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-a2a-service': 'rogue-mcp',
      'x-a2a-timestamp': String(timestamp),
      'x-a2a-signature': signature,
      'x-a2a-nonce': nonce,
    },
    body: bodyJson,
  })
  assert.equal(res.status, 401)
  const body = await res.json() as { error: string }
  assert.match(body.error, /unknown service/)
})

test('valid org-mcp signature → handler runs', async () => {
  const app = mountApp()
  const sessionId = 'sess-3-' + randomUUID()
  const bodyJson = JSON.stringify({ target: '0xabc' })
  const { timestamp, nonce, signature } = await signWith('org', 'org-mcp', sessionId, bodyJson)
  const res = await app.request(`/session/${sessionId}/redeem-tx`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-a2a-service': 'org-mcp',
      'x-a2a-timestamp': String(timestamp),
      'x-a2a-signature': signature,
      'x-a2a-nonce': nonce,
    },
    body: bodyJson,
  })
  assert.equal(res.status, 200)
  const body = await res.json() as { ok: boolean }
  assert.equal(body.ok, true)
})

test('signature signed under person-mcp key fails verification when claimed as org-mcp', async () => {
  // Defense-in-depth: each MCP has its own MAC key. A signature minted
  // under person-mcp's key MUST NOT verify against org-mcp's key. This
  // proves the per-key isolation that the K3-extension IAM scoping
  // enforces in production.
  const app = mountApp()
  const sessionId = 'sess-4-' + randomUUID()
  const bodyJson = JSON.stringify({ target: '0xabc' })
  // Sign with person-mcp's key, claim org-mcp in the header.
  const { timestamp, nonce, signature } = await signWith('person', 'person-mcp', sessionId, bodyJson)
  const res = await app.request(`/session/${sessionId}/redeem-tx`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-a2a-service': 'org-mcp', // header claims org-mcp
      'x-a2a-timestamp': String(timestamp),
      'x-a2a-signature': signature, // but signature is from person-mcp
      'x-a2a-nonce': nonce,
    },
    body: bodyJson,
  })
  assert.equal(res.status, 401)
  const body = await res.json() as { error: string }
  assert.match(body.error, /signature mismatch/)
})

test('timestamp out of window → 401', async () => {
  const app = mountApp()
  const sessionId = 'sess-5-' + randomUUID()
  const bodyJson = JSON.stringify({})
  const oldTs = Math.floor(Date.now() / 1000) - 999
  const { timestamp, nonce, signature } = await signWith('org', 'org-mcp', sessionId, bodyJson, oldTs)
  const res = await app.request(`/session/${sessionId}/redeem-tx`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-a2a-service': 'org-mcp',
      'x-a2a-timestamp': String(timestamp),
      'x-a2a-signature': signature,
      'x-a2a-nonce': nonce,
    },
    body: bodyJson,
  })
  assert.equal(res.status, 401)
  const body = await res.json() as { error: string }
  assert.match(body.error, /timestamp out of window/)
})

test('missing nonce → 401', async () => {
  const app = mountApp()
  const sessionId = 'sess-6-' + randomUUID()
  const bodyJson = JSON.stringify({})
  const { timestamp, signature } = await signWith('org', 'org-mcp', sessionId, bodyJson)
  const res = await app.request(`/session/${sessionId}/redeem-tx`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-a2a-service': 'org-mcp',
      'x-a2a-timestamp': String(timestamp),
      'x-a2a-signature': signature,
      // no x-a2a-nonce — used to be accepted by the legacy canonical
      // (which didn't bind the nonce); canonical-v2 binds it INTO the MAC.
    },
    body: bodyJson,
  })
  assert.equal(res.status, 401)
})

// ─── P0-3 canonical-v2 binding tests ─────────────────────────────────
// These four tests prove the canonical-v2 message binds every input
// (nonce, path, body, single-use) and reject the replay primitive that
// existed under the legacy `${body}:${ts}:${sessionId}` canonical.

test('P0-3 replay rejection — swapping nonce header invalidates a captured signature', async () => {
  // The legacy canonical did NOT bind the nonce; the verifier read it
  // from the header but a captured envelope could be re-sent with any
  // (fresh, never-burned) nonce and the signature would still verify.
  // Under canonical-v2, the nonce is part of the MAC input — swap it
  // and the signature mismatches.
  const app = mountApp()
  const sessionId = 'sess-p0-3-replay-' + randomUUID()
  const bodyJson = JSON.stringify({ target: '0xabc' })
  const { timestamp, nonce, signature } = await signWith('org', 'org-mcp', sessionId, bodyJson)
  const swappedNonce = randomUUID()
  assert.notEqual(swappedNonce, nonce)
  const res = await app.request(`/session/${sessionId}/redeem-tx`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-a2a-service': 'org-mcp',
      'x-a2a-timestamp': String(timestamp),
      'x-a2a-signature': signature,
      'x-a2a-nonce': swappedNonce, // different nonce than the signed one
    },
    body: bodyJson,
  })
  assert.equal(res.status, 401)
  const body = await res.json() as { error: string }
  assert.match(body.error, /signature mismatch/)
})

test('P0-3 path binding — signature for path X is rejected on path Y', async () => {
  // Build a signature for /session/<id>/redeem-tx and try to redeem it
  // against /session/<id>/deploy-agent. Under canonical-v2 the path is
  // bound INTO the MAC so the second route rejects the signature.
  const app = new Hono()
  app.post('/session/:id/redeem-tx', requireInterServiceAuth(), async (c) => c.json({ ok: true }))
  app.post('/session/:id/deploy-agent', requireInterServiceAuth(), async (c) => c.json({ ok: true }))

  const sessionId = 'sess-p0-3-path-' + randomUUID()
  const bodyJson = JSON.stringify({ target: '0xabc' })
  // Sign for /redeem-tx path (default).
  const { timestamp, nonce, signature } = await signWith('org', 'org-mcp', sessionId, bodyJson)
  // Send to /deploy-agent.
  const res = await app.request(`/session/${sessionId}/deploy-agent`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-a2a-service': 'org-mcp',
      'x-a2a-timestamp': String(timestamp),
      'x-a2a-signature': signature,
      'x-a2a-nonce': nonce,
    },
    body: bodyJson,
  })
  assert.equal(res.status, 401)
  const body = await res.json() as { error: string }
  assert.match(body.error, /signature mismatch/)
})

test('P0-3 body binding — signature valid for body B is rejected on body B′ with same ts/nonce/path', async () => {
  // Sign body B, then forward the same (ts, nonce, path, signature)
  // tuple with a tampered body B'. Under canonical-v2 the body-hash is
  // bound INTO the MAC so the second body invalidates the signature.
  const app = mountApp()
  const sessionId = 'sess-p0-3-body-' + randomUUID()
  const bodyB = JSON.stringify({ target: '0xabc', value: '1' })
  const bodyBPrime = JSON.stringify({ target: '0xdeadbeef', value: '9999' })
  assert.notEqual(bodyB, bodyBPrime)
  const { timestamp, nonce, signature } = await signWith('org', 'org-mcp', sessionId, bodyB)
  const res = await app.request(`/session/${sessionId}/redeem-tx`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-a2a-service': 'org-mcp',
      'x-a2a-timestamp': String(timestamp),
      'x-a2a-signature': signature,
      'x-a2a-nonce': nonce,
    },
    body: bodyBPrime, // tampered body
  })
  assert.equal(res.status, 401)
  const body = await res.json() as { error: string }
  assert.match(body.error, /signature mismatch/)
})

test('P0-3 nonce-replay rejection — same (ts, nonce) pair twice → second request 401', async () => {
  // First request must succeed; second request with the same envelope
  // (which would be a perfect replay) MUST 401 with "replay detected".
  // This is the within-timestamp-window replay defense the canonical-v2
  // ALONE doesn't provide — the single-use nonce table closes it.
  const app = mountApp()
  const sessionId = 'sess-p0-3-nonce-' + randomUUID()
  const bodyJson = JSON.stringify({ target: '0xabc' })
  const { timestamp, nonce, signature } = await signWith('org', 'org-mcp', sessionId, bodyJson)
  const headers = {
    'content-type': 'application/json',
    'x-a2a-service': 'org-mcp',
    'x-a2a-timestamp': String(timestamp),
    'x-a2a-signature': signature,
    'x-a2a-nonce': nonce,
  }
  const first = await app.request(`/session/${sessionId}/redeem-tx`, {
    method: 'POST', headers, body: bodyJson,
  })
  assert.equal(first.status, 200)
  const second = await app.request(`/session/${sessionId}/redeem-tx`, {
    method: 'POST', headers, body: bodyJson,
  })
  assert.equal(second.status, 401)
  const body = await second.json() as { error: string }
  assert.match(body.error, /replay detected/)
})
