/**
 * Inbound service-auth middleware for verifier-mcp (Spec 007 Phase D).
 *
 * Mirrors the analogous middleware on hub-mcp, person-mcp, org-mcp, and
 * people-group-mcp. Verifier-mcp's surface today is AnonCreds presentation
 * verification (`/verify/*`) — no `/tools/*` routes yet — but the MAC
 * envelope shape is wired so a future tool surface (or signed inter-service
 * hop) can mount this middleware without reinventing the verifier.
 *
 * Wire format mirrors the rest of the family:
 *
 *   X-SA-Service:   a2a-agent
 *   X-SA-Timestamp: <unix seconds, ±60s>
 *   X-SA-Nonce:     <fresh per-request>
 *   X-SA-Signature: <base64url MAC>
 *
 *   canonical = `${ts}|${nonce}|${path}|${sha256(body)}`
 *
 * MAC key id is `a2a-to-verifier`. HMAC is symmetric — a2a-agent and
 * verifier-mcp share the secret (`A2A_INTERSERVICE_HMAC_KEY_VERIFIER` in
 * local-aes mode, `AWS_KMS_MAC_KEY_ID_A2A_TO_VERIFIER` in aws-kms mode, or
 * `GCP_KMS_MAC_A2A_TO_VERIFIER_VERSION` in gcp-kms mode).
 *
 * NOTE: `/verify/*` AnonCreds endpoints remain PUBLIC by protocol design.
 * This middleware should only be mounted on routes that represent
 * system-internal authority (e.g., any future `/tools/*` surface).
 */

import { fromBase64Url, buildCanonicalMacMessage, sha256Hex as sdkSha256Hex } from '@smart-agent/sdk'
import { buildMcpMacProvider, type KmsMacProvider } from '@smart-agent/sdk/key-custody'
import type { Context, MiddlewareHandler } from 'hono'

export const SERVICE_HEADER = 'x-sa-service'
export const TIMESTAMP_HEADER = 'x-sa-timestamp'
export const NONCE_HEADER = 'x-sa-nonce'
export const SIGNATURE_HEADER = 'x-sa-signature'

export const MAX_CLOCK_SKEW_SECONDS = 60

export const ALLOWED_INBOUND_SERVICES = ['a2a-agent'] as const
export type InboundService = (typeof ALLOWED_INBOUND_SERVICES)[number]

/**
 * Hex SHA-256 of the raw request body — re-exported from the shared SDK
 * helper. Spec 007 Phase G.3 collapsed every per-service copy into
 * `@smart-agent/sdk` so sender/verifier can never silently drift.
 */
export const sha256Hex = sdkSha256Hex

/**
 * Canonical message both sides sign over —
 * `${ts}|${nonce}|${path}|${sha256(body)}`. Sourced from the shared SDK
 * helper since spec 007 Phase G.3.
 */
export const buildInboundCanonical = buildCanonicalMacMessage

interface InboundServiceContext {
  service: InboundService
  timestamp: number
}

declare module 'hono' {
  interface ContextVariableMap {
    inboundService?: InboundServiceContext
  }
}

const NONCE_MAX_AGE_MS = 2 * MAX_CLOCK_SKEW_SECONDS * 1000
const nonceCache = new Map<string, number>()

function recordNonce(nonce: string): boolean {
  if (!nonce || nonce.length < 8) return false
  const now = Date.now()
  if (nonceCache.size > 1000) {
    for (const [k, usedAt] of nonceCache) {
      if (now - usedAt > NONCE_MAX_AGE_MS) nonceCache.delete(k)
    }
  }
  if (nonceCache.has(nonce)) return false
  nonceCache.set(nonce, now)
  return true
}

export function resetInboundNonceCacheForTest(): void {
  nonceCache.clear()
}

let cachedMacProvider: KmsMacProvider | null = null
function inboundMacProvider(): KmsMacProvider {
  if (!cachedMacProvider) {
    cachedMacProvider = buildMcpMacProvider('verifier', process.env)
  }
  return cachedMacProvider
}

export function resetInboundMacProviderForTest(): void {
  cachedMacProvider = null
}

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
        { error: `a2a-to-verifier key not configured: ${(err as Error).message}` },
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

    if (!recordNonce(nonce)) {
      return c.json({ error: 'replay detected' }, 401)
    }

    c.set('inboundService', { service: service as InboundService, timestamp })
    await next()
  }
}
