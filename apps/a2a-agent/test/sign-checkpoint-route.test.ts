/**
 * Sprint 4 A.3 — tests for `POST /auth/sign-checkpoint`.
 *
 * The endpoint is the central piece of the person-mcp checkpoint export:
 * person-mcp builds the digest, POSTs it here over the inter-service
 * HMAC envelope, and gets back `{ signature, signerAddress }` produced
 * by a2a-agent's master signer. The endpoint MUST:
 *
 *   1. reject calls lacking the inter-service envelope (missing headers
 *      → 401),
 *   2. reject calls signed by an enrolled service OTHER than person-mcp
 *      (e.g. org-mcp) — the allow-list is explicit at the handler,
 *   3. reject calls with a malformed `digest` (not hex, wrong length),
 *   4. accept a valid person-mcp envelope + 32-byte hex digest, return
 *      a real signature, and the recovered signer must match the
 *      configured master.
 *
 * Run: `node --import tsx --test apps/a2a-agent/test/sign-checkpoint-route.test.ts`
 */

// Configure env BEFORE importing the route + middleware so module init
// reads the keys. We isolate from the rest of the suite by using a
// dedicated session-secret + master-private-key pair.
process.env.A2A_KMS_BACKEND = 'local-aes'
process.env.A2A_SESSION_SECRET = '0x' + 'd'.repeat(64)
process.env.A2A_MASTER_PRIVATE_KEY = '0x' + 'ce'.repeat(32)
process.env.A2A_INTERSERVICE_HMAC_KEY_PERSON = '0x' + 'a'.repeat(64)
process.env.A2A_INTERSERVICE_HMAC_KEY_ORG = '0x' + 'b'.repeat(64)
process.env.CHAIN_ID = process.env.CHAIN_ID ?? '31337'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { auth } from '../src/routes/auth'
import { toBase64Url } from '@smart-agent/sdk'
import { buildMcpMacProvider } from '@smart-agent/sdk/key-custody'
import { hashMessage, toBytes, recoverMessageAddress } from 'viem'
import { __resetMasterSignerForTests, getMasterSigner } from '../src/auth/a2a-signer'

function mountApp() {
  const app = new Hono()
  app.route('/auth', auth)
  return app
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex')
}

/**
 * Build the inter-service envelope using canonical-v2:
 *   `${ts}|${nonce}|${path}|${sha256(body)}`
 * Same shape every other inter-service hop in the codebase uses.
 * Mirrors what person-mcp's `lib/audit-checkpoint.ts` does on the
 * production wire.
 */
async function signAs(
  mcpName: 'person' | 'org',
  bodyJson: string,
  overrideTs?: number,
): Promise<{ timestamp: number; nonce: string; signature: string }> {
  const provider = buildMcpMacProvider(mcpName, process.env)
  const timestamp = overrideTs ?? Math.floor(Date.now() / 1000)
  const nonce = randomUUID()
  const path = '/auth/sign-checkpoint'
  const canonical = `${timestamp}|${nonce}|${path}|${sha256Hex(bodyJson)}`
  const { mac } = await provider.generateMac({
    canonicalMessage: new TextEncoder().encode(canonical),
  })
  return { timestamp, nonce, signature: toBase64Url(mac) }
}

test('missing inter-service headers → 401', async () => {
  const app = mountApp()
  const res = await app.request('/auth/sign-checkpoint', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ digest: '0x' + 'aa'.repeat(32) }),
  })
  assert.equal(res.status, 401)
})

test('enrolled service OTHER than person-mcp → 403 (explicit allow-list)', async () => {
  const app = mountApp()
  const digest = ('0x' + 'aa'.repeat(32)) as `0x${string}`
  const bodyJson = JSON.stringify({ digest })
  const { timestamp, nonce, signature } = await signAs('org', bodyJson)
  const res = await app.request('/auth/sign-checkpoint', {
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
  assert.equal(res.status, 403)
  const body = await res.json() as { error?: string }
  assert.match(body.error ?? '', /org-mcp not allowed/)
})

test('person-mcp envelope but malformed digest → 400', async () => {
  const app = mountApp()
  const bodyJson = JSON.stringify({ digest: '0xshort' })
  const { timestamp, nonce, signature } = await signAs('person', bodyJson)
  const res = await app.request('/auth/sign-checkpoint', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-a2a-service': 'person-mcp',
      'x-a2a-timestamp': String(timestamp),
      'x-a2a-signature': signature,
      'x-a2a-nonce': nonce,
    },
    body: bodyJson,
  })
  assert.equal(res.status, 400)
  const body = await res.json() as { error?: string }
  assert.match(body.error ?? '', /invalid digest/)
})

test('valid person-mcp envelope + digest → signature recovers to master', async () => {
  __resetMasterSignerForTests()
  const signer = await getMasterSigner()

  const app = mountApp()
  const digest = ('0x' + 'ab'.repeat(32)) as `0x${string}`
  const bodyJson = JSON.stringify({ digest })
  const { timestamp, nonce, signature } = await signAs('person', bodyJson)
  const res = await app.request('/auth/sign-checkpoint', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-a2a-service': 'person-mcp',
      'x-a2a-timestamp': String(timestamp),
      'x-a2a-signature': signature,
      'x-a2a-nonce': nonce,
    },
    body: bodyJson,
  })
  assert.equal(res.status, 200)
  const body = (await res.json()) as {
    signature: `0x${string}`
    signerAddress: `0x${string}`
  }
  assert.match(body.signature, /^0x[0-9a-fA-F]+$/)
  assert.equal(body.signerAddress.toLowerCase(), signer.address.toLowerCase())
  // The signature must recover to the same master signer when the
  // verifier passes the raw checkpoint digest through viem's
  // `recoverMessageAddress`. viem internally applies the EIP-191
  // hashMessage wrap before recovery, matching what the production
  // endpoint signed.
  const recovered = await recoverMessageAddress({
    message: { raw: digest },
    signature: body.signature,
  })
  assert.equal(recovered.toLowerCase(), signer.address.toLowerCase())
  // Suppress unused-import warnings (kept for readers who want to see
  // the EIP-191 wrap structure inline).
  void hashMessage
  void toBytes
})
