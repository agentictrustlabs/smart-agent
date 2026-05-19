/**
 * Spec 007 Phase G.3 — canonical inter-service MAC payload tests.
 *
 * The load-bearing assertion: every sender and every verifier must
 * produce byte-identical canonical messages for the same inputs.
 * If this test passes, the 8 previously-duplicated implementations
 * (a2a-agent's inter-service, org-mcp's a2a-client, plus 7 MCP
 * require-inbound-service-auth files) can never silently drift.
 *
 * The test reproduces each historical implementation's
 * `buildCanonicalMessage` / `buildInboundCanonical` shape inline and
 * asserts byte equality against the shared SDK helper.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  buildCanonicalMacMessage,
  buildCanonicalMacBytes,
  sha256Hex,
} from '../auth/canonical-mac'

test('sha256Hex matches node:crypto SHA-256 hex', () => {
  const body = '{"hello":"world"}'
  const expected = createHash('sha256').update(body, 'utf8').digest('hex')
  assert.equal(sha256Hex(body), expected)
})

test('canonical message has v2 format `${ts}|${nonce}|${path}|${sha256(body)}`', () => {
  const ts = 1746902400
  const nonce = 'fixed-nonce-value'
  const path = '/session-store/insert'
  const body = '{"hello":"world"}'
  const expected = `${ts}|${nonce}|${path}|${createHash('sha256').update(body, 'utf8').digest('hex')}`
  assert.equal(buildCanonicalMacMessage(ts, nonce, path, body), expected)
})

test('canonical bytes match utf-8 encoding of canonical message', () => {
  const ts = 1746902400
  const nonce = 'n1'
  const path = '/x'
  const body = '{}'
  const msg = buildCanonicalMacMessage(ts, nonce, path, body)
  const bytes = buildCanonicalMacBytes(ts, nonce, path, body)
  assert.deepEqual(bytes, new TextEncoder().encode(msg))
})

test('timestamp accepts number or string with identical output', () => {
  const nonce = 'n1'
  const path = '/x'
  const body = '{}'
  const fromNum = buildCanonicalMacMessage(1746902400, nonce, path, body)
  const fromStr = buildCanonicalMacMessage('1746902400', nonce, path, body)
  assert.equal(fromNum, fromStr)
})

test('different bodies produce different canonical messages', () => {
  const a = buildCanonicalMacMessage(1, 'n', '/p', '{"a":1}')
  const b = buildCanonicalMacMessage(1, 'n', '/p', '{"a":2}')
  assert.notEqual(a, b)
})

// ─── Drift-prevention assertion against every historical impl shape ──

/** a2a-agent's `auth/inter-service.ts` historical `buildCanonicalMessage`. */
function a2aHistorical(timestamp: number | string, nonce: string, path: string, bodyRaw: string): Uint8Array {
  const bodyHash = createHash('sha256').update(bodyRaw, 'utf8').digest('hex')
  const canonical = `${timestamp}|${nonce}|${path}|${bodyHash}`
  return new TextEncoder().encode(canonical)
}

/** org-mcp's `lib/a2a-client.ts` historical inline canonical builder. */
function orgClientHistorical(timestamp: number | string, nonce: string, path: string, bodyJson: string): Uint8Array {
  const bodyHash = createHash('sha256').update(bodyJson, 'utf8').digest('hex')
  const canonical = `${timestamp}|${nonce}|${path}|${bodyHash}`
  return new TextEncoder().encode(canonical)
}

/** Any MCP `require-inbound-service-auth.ts` `buildInboundCanonical` (returns string). */
function inboundHistorical(timestamp: number | string, nonce: string, path: string, bodyRaw: string): string {
  const bodyHash = createHash('sha256').update(bodyRaw, 'utf8').digest('hex')
  return `${timestamp}|${nonce}|${path}|${bodyHash}`
}

test('byte-identical to a2a-agent historical buildCanonicalMessage', () => {
  const inputs = [
    { ts: 1, nonce: 'a', path: '/p', body: '{}' },
    { ts: 1746902400, nonce: 'abc-123', path: '/session/foo/redeem-tx', body: '{"hello":"world"}' },
    { ts: '99', nonce: 'n', path: '/x', body: '' },
  ]
  for (const i of inputs) {
    const shared = buildCanonicalMacBytes(i.ts, i.nonce, i.path, i.body)
    const historical = a2aHistorical(i.ts, i.nonce, i.path, i.body)
    assert.deepEqual(shared, historical, `mismatch for ${JSON.stringify(i)}`)
  }
})

test('byte-identical to org-mcp a2a-client historical inline builder', () => {
  const inputs = [
    { ts: 1746902400, nonce: 'org-nonce', path: '/session/s1/redeem-via-account', body: '{"foo":1}' },
    { ts: 0, nonce: 'z', path: '/', body: '{}' },
  ]
  for (const i of inputs) {
    const shared = buildCanonicalMacBytes(i.ts, i.nonce, i.path, i.body)
    const historical = orgClientHistorical(i.ts, i.nonce, i.path, i.body)
    assert.deepEqual(shared, historical)
  }
})

test('string-identical to MCP buildInboundCanonical', () => {
  const inputs = [
    { ts: 1, nonce: 'a', path: '/p', body: '{}' },
    { ts: 1746902400, nonce: 'nonce-1', path: '/session-store/insert', body: '{"a":[1,2,3]}' },
    { ts: '0', nonce: '', path: '', body: '' },
  ]
  for (const i of inputs) {
    const shared = buildCanonicalMacMessage(i.ts, i.nonce, i.path, i.body)
    const historical = inboundHistorical(i.ts, i.nonce, i.path, i.body)
    assert.equal(shared, historical)
  }
})

test('verifyCanonicalMac proxies through provider', async () => {
  const { verifyCanonicalMac } = await import('../auth/canonical-mac')
  let seenBytes: Uint8Array | null = null
  const provider = {
    async verifyMac({ canonicalMessage }: { canonicalMessage: Uint8Array; mac: Uint8Array }) {
      seenBytes = canonicalMessage
      return { valid: true }
    },
  }
  const ok = await verifyCanonicalMac(provider, {
    timestamp: 1746902400,
    nonce: 'n',
    path: '/x',
    bodyRaw: '{}',
    mac: new Uint8Array([1, 2, 3]),
  })
  assert.equal(ok, true)
  assert.deepEqual(seenBytes, buildCanonicalMacBytes(1746902400, 'n', '/x', '{}'))
})

test('generateCanonicalMac proxies through provider', async () => {
  const { generateCanonicalMac } = await import('../auth/canonical-mac')
  const provider = {
    async generateMac(_input: { canonicalMessage: Uint8Array }) {
      return { mac: new Uint8Array([9, 9, 9]) }
    },
  }
  const mac = await generateCanonicalMac(provider, {
    timestamp: 1,
    nonce: 'n',
    path: '/p',
    bodyRaw: '{}',
  })
  assert.deepEqual(mac, new Uint8Array([9, 9, 9]))
})
