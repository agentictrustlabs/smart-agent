/**
 * Inbound service-auth middleware for hub-mcp.
 *
 * Mirrors the analogous middleware on person-mcp and org-mcp — every
 * authority-bearing route on hub-mcp re-verifies that the caller is an
 * enrolled upstream service (only `a2a-agent` is allowed inbound). The
 * `/tools/:toolName` surface is authority-bearing because the `sync:*`
 * tools touch GraphDB write credentials and the `discovery:*` tools
 * proxy KB reads. Pre-existing dev posture left port 3900 unauthenticated
 * ("dev-only / inter-MCP"); this hop closes that gap so the same wire
 * works in production where hub-mcp may be reachable across the cluster.
 *
 * Wire format mirrors the web→a2a / a2a→person / a2a→org envelope:
 *
 *   X-SA-Service:   a2a-agent
 *   X-SA-Timestamp: 1746902400          (unix seconds, ±60s window)
 *   X-SA-Nonce:     <fresh-per-request> (replay defense)
 *   X-SA-Signature: <base64url MAC>
 *
 *   canonical = `${ts}|${nonce}|${path}|${sha256(body)}`
 *
 * MAC key id is `a2a-to-hub`. HMAC is symmetric — a2a-agent and hub-mcp
 * share the secret (`A2A_INTERSERVICE_HMAC_KEY_HUB` in local-aes mode,
 * `AWS_KMS_MAC_KEY_ID_A2A_TO_HUB` in aws-kms mode, or
 * `GCP_KMS_MAC_A2A_TO_HUB_VERSION` in gcp-kms mode).
 *
 * Replay defense is in-memory (hub-mcp has no SQLite). The Map is keyed
 * by nonce with a `usedAt` timestamp; entries older than 2× the clock-skew
 * window are evicted on every lookup so memory stays bounded under load.
 */

import { fromBase64Url } from '@smart-agent/sdk'
import { buildMcpMacProvider, type KmsMacProvider } from '@smart-agent/sdk/key-custody'
import { createHash } from 'node:crypto'
import type { Context, MiddlewareHandler } from 'hono'

export const SERVICE_HEADER = 'x-sa-service'
export const TIMESTAMP_HEADER = 'x-sa-timestamp'
export const NONCE_HEADER = 'x-sa-nonce'
export const SIGNATURE_HEADER = 'x-sa-signature'

export const MAX_CLOCK_SKEW_SECONDS = 60

/** The only inbound service allowed to talk to hub-mcp's control plane. */
export const ALLOWED_INBOUND_SERVICES = ['a2a-agent'] as const
export type InboundService = (typeof ALLOWED_INBOUND_SERVICES)[number]

/** Hex SHA-256 of the raw request body — bound into the canonical string. */
export function sha256Hex(bodyRaw: string): string {
  return createHash('sha256').update(bodyRaw, 'utf8').digest('hex')
}

/** Canonical message both sides sign over. */
export function buildInboundCanonical(
  timestamp: number | string,
  nonce: string,
  path: string,
  bodyRaw: string,
): string {
  return `${timestamp}|${nonce}|${path}|${sha256Hex(bodyRaw)}`
}

interface InboundServiceContext {
  service: InboundService
  timestamp: number
}

declare module 'hono' {
  interface ContextVariableMap {
    inboundService?: InboundServiceContext
  }
}

// ─── In-memory replay-nonce cache ─────────────────────────────────────
// Hub-mcp has no SQLite — keep the cache in process. Entries expire
// after 2× the clock-skew window (the timestamp guard already rejects
// anything older, so evicted entries can never be revived).

const NONCE_MAX_AGE_MS = 2 * MAX_CLOCK_SKEW_SECONDS * 1000
const nonceCache = new Map<string, number>()

function recordNonce(nonce: string): boolean {
  if (!nonce || nonce.length < 8) return false
  const now = Date.now()
  // GC expired entries inline — cheap because we already iterate on miss.
  if (nonceCache.size > 1000) {
    for (const [k, usedAt] of nonceCache) {
      if (now - usedAt > NONCE_MAX_AGE_MS) nonceCache.delete(k)
    }
  }
  if (nonceCache.has(nonce)) return false
  nonceCache.set(nonce, now)
  return true
}

/** Test-only — reset the in-memory nonce cache between cases. */
export function resetInboundNonceCacheForTest(): void {
  nonceCache.clear()
}

// ─── MAC provider — lazy, per-process ────────────────────────────────

let cachedMacProvider: KmsMacProvider | null = null
function inboundMacProvider(): KmsMacProvider {
  if (!cachedMacProvider) {
    // `buildMcpMacProvider('hub', env)` returns the provider scoped to the
    // `a2a-to-hub` MAC key id. HMAC is symmetric, so the same provider
    // verifies inbound MACs that a2a-agent generates with this key on
    // the other end of the wire.
    cachedMacProvider = buildMcpMacProvider('hub', process.env)
  }
  return cachedMacProvider
}

/** Test-only — reset the cached provider so a new env shape can take effect. */
export function resetInboundMacProviderForTest(): void {
  cachedMacProvider = null
}

/**
 * Mount on every authority-bearing route. Currently only `a2a-agent` is
 * an allowed inbound, but the parameter exists so future planners /
 * other MCPs can reuse the envelope shape with their own key.
 */
export function requireInboundServiceAuth(
  allowedServices: readonly InboundService[] = ALLOWED_INBOUND_SERVICES,
): MiddlewareHandler {
  return async (c: Context, next) => {
    const service = c.req.header(SERVICE_HEADER)
    const timestampStr = c.req.header(TIMESTAMP_HEADER)
    const nonce = c.req.header(NONCE_HEADER)
    const signature = c.req.header(SIGNATURE_HEADER)

    if (!service || !timestampStr || !nonce || !signature) {
      return c.json({ error: 'missing service-auth headers' }, 401)
    }
    if (!allowedServices.includes(service as InboundService)) {
      return c.json({ error: `unexpected service: ${service}` }, 401)
    }

    const timestamp = Number(timestampStr)
    if (!Number.isFinite(timestamp)) {
      return c.json({ error: 'invalid timestamp' }, 401)
    }
    const now = Math.floor(Date.now() / 1000)
    if (Math.abs(now - timestamp) > MAX_CLOCK_SKEW_SECONDS) {
      return c.json({ error: 'timestamp out of window' }, 401)
    }

    let provider: KmsMacProvider
    try {
      provider = inboundMacProvider()
    } catch (err) {
      return c.json(
        { error: `a2a-to-hub key not configured: ${(err as Error).message}` },
        503,
      )
    }

    const path = new URL(c.req.url).pathname
    const bodyRaw = await c.req.text()
    const canonical = buildInboundCanonical(timestamp, nonce, path, bodyRaw)
    const canonicalMessage = new TextEncoder().encode(canonical)

    let macBytes: Uint8Array
    try {
      macBytes = fromBase64Url(signature)
    } catch {
      return c.json({ error: 'signature mismatch' }, 401)
    }

    const { valid } = await provider.verifyMac({ canonicalMessage, mac: macBytes })
    if (!valid) {
      return c.json({ error: 'signature mismatch' }, 401)
    }

    // Replay defense — record AFTER signature verifies so a valid
    // attacker-collision can't pre-burn a nonce. First insert wins.
    if (!recordNonce(nonce)) {
      return c.json({ error: 'replay detected' }, 401)
    }

    c.set('inboundService', { service: service as InboundService, timestamp })

    // Re-parse the body downstream — Hono's `c.req.text()` already
    // buffered it once, but `/tools/:toolName` still calls `c.req.json()`
    // afterward. Hono memoizes the raw body string so the second call
    // round-trips through `JSON.parse` against the same bytes; no
    // re-read of the socket happens.
    await next()
  }
}
