/**
 * Inter-service HMAC authentication.
 *
 * MCPs that call a2a-agent's privileged endpoints (`/session/:id/redeem-tx`,
 * `/session/:id/deploy-agent`, `/session/:id/sign-subdelegation`,
 * `/session/:id/redeem-subdelegated`) must prove they are an authorized
 * MCP server, not the user's session bearer. This is a SEPARATE auth plane
 * from user delegation:
 *
 *   - User-delegation auth (existing): proves "the user authorized this call"
 *   - Inter-service auth (this file): proves "the requesting service is an
 *     enrolled MCP server in this deployment"
 *
 * Each MCP server gets its own KMS HMAC key (KMS migration K3-extension —
 * `KeySpec=HMAC_256`, `KeyUsage=GENERATE_VERIFY_MAC`). In dev the key is a
 * static env var read by the local-hmac provider; in prod the key lives in
 * AWS KMS and is accessed via `kms:VerifyMac`. The wire format and
 * canonical message are UNCHANGED — only the signing primitive swaps:
 *
 *   A2A_INTERSERVICE_HMAC_KEY_ORG     — org-mcp's secret (dev)
 *                                       → AWS_KMS_MAC_KEY_ID_A2A_TO_ORG (prod)
 *   A2A_INTERSERVICE_HMAC_KEY_PERSON  — person-mcp ...
 *   (etc. for family, geo, verifier, skill, people-group)
 *
 * Canonical message: `${ts}|${nonce}|${path}|${sha256(body)}` — every
 * binding (timestamp, nonce, route, body-hash) lives INSIDE the signed
 * message because KMS HMAC keys do not support EncryptionContext (see
 * `KMS-IMPLEMENTATION-PLAN.md` §13).
 *
 * Header layout:
 *   x-a2a-service: org-mcp
 *   x-a2a-timestamp: 1746902400
 *   x-a2a-signature: <base64url MAC>
 *   x-a2a-nonce: <fresh-per-request>      (Hardening §1.10)
 *
 * Replay protection:
 *   - Timestamps must be within ±60s of the verifier's clock.
 *   - Each `x-a2a-nonce` is recorded in the `inter_service_nonce` table;
 *     a duplicate within the window fails the UNIQUE constraint and the
 *     verifier rejects with 401 "replay detected".
 */
import { fromBase64Url } from '@smart-agent/sdk'
import type { Context, MiddlewareHandler } from 'hono'
import { recordNonce } from './replay-nonce'
import { defaultMacProviderCache, type MacKeyId } from './mac-provider'
import { auditDeny } from '../lib/audit'

export const SERVICE_HEADER = 'x-a2a-service'
export const TIMESTAMP_HEADER = 'x-a2a-timestamp'
export const SIGNATURE_HEADER = 'x-a2a-signature'
export const NONCE_HEADER = 'x-a2a-nonce'

export const MAX_CLOCK_SKEW_SECONDS = 60

const SERVICE_NAMES = ['org-mcp', 'person-mcp', 'family-mcp', 'people-group-mcp', 'verifier-mcp', 'skill-mcp', 'geo-mcp'] as const
type ServiceName = typeof SERVICE_NAMES[number]

/**
 * Map a service header value to its KMS MAC key id. Per K3-extension
 * defense-in-depth: each MCP signs with ITS OWN key, so a compromised
 * MCP's signing capability cannot impersonate a different MCP.
 */
function macKeyIdFor(service: ServiceName): MacKeyId {
  switch (service) {
    case 'org-mcp':
      return 'a2a-to-org'
    case 'person-mcp':
      return 'a2a-to-person'
    case 'family-mcp':
      return 'a2a-to-family'
    case 'people-group-mcp':
      return 'a2a-to-people-group'
    case 'verifier-mcp':
      return 'a2a-to-verifier'
    case 'skill-mcp':
      return 'a2a-to-skill'
    case 'geo-mcp':
      return 'a2a-to-geo'
  }
}

/**
 * Build the canonical message bytes — identical shape on both sides of
 * the wire. Includes timestamp, fresh nonce, request path, and sha256 of
 * the body so a captured signature cannot be replayed against a different
 * (path, body, timestamp, nonce) tuple.
 */
function buildCanonicalMessage(
  bodyRaw: string,
  timestamp: number | string,
  sessionId: string,
): Uint8Array {
  // The legacy canonical was `${body}:${ts}:${sessionId}`. We keep that
  // exact byte sequence so wire compatibility is preserved during the
  // rollout — local-aes provider replicates the old `crypto.createHmac`
  // computation byte-for-byte.
  const canonical = `${bodyRaw}:${timestamp}:${sessionId}`
  return new TextEncoder().encode(canonical)
}

export interface InterServiceContext {
  service: ServiceName
  timestamp: number
  bodyRaw: string
}

/**
 * Hono middleware that requires a valid inter-service signature.
 * Mounts on /session/:id/* endpoints that perform privileged actions.
 *
 * On success, attaches { service } to c.var for downstream handlers.
 */
export function requireInterServiceAuth(): MiddlewareHandler {
  return async (c: Context, next) => {
    // Hardening Phase 1D #2 — denial-path audit. Every reject below
    // writes a `status: 'denied'` row via `auditDeny()` BEFORE
    // returning the 4xx response. The route family is the request
    // path (e.g. `/session/<id>/redeem-tx`).
    const sessionId = c.req.param('id') ?? ''
    const route = new URL(c.req.url).pathname
    const denyFields = {
      route,
      sessionId,
      executionPath: 'stateless-redeem' as const,
    }

    const service = c.req.header(SERVICE_HEADER)
    const timestampStr = c.req.header(TIMESTAMP_HEADER)
    const signature = c.req.header(SIGNATURE_HEADER)

    if (!service || !timestampStr || !signature) {
      await auditDeny(c, { ...denyFields, reason: 'missing inter-service auth headers' })
      return c.json({ error: 'missing inter-service auth headers' }, 401)
    }
    if (!SERVICE_NAMES.includes(service as ServiceName)) {
      await auditDeny(c, { ...denyFields, mcpServer: service, reason: `unknown service: ${service}` })
      return c.json({ error: `unknown service: ${service}` }, 401)
    }

    const timestamp = Number(timestampStr)
    if (!Number.isFinite(timestamp)) {
      await auditDeny(c, { ...denyFields, mcpServer: service, reason: 'invalid timestamp' })
      return c.json({ error: 'invalid timestamp' }, 401)
    }
    const now = Math.floor(Date.now() / 1000)
    if (Math.abs(now - timestamp) > MAX_CLOCK_SKEW_SECONDS) {
      await auditDeny(c, { ...denyFields, mcpServer: service, reason: 'timestamp out of window' })
      return c.json({ error: 'timestamp out of window' }, 401)
    }

    // The path's :id is part of the canonical message so a signature for
    // one session can't be replayed against another.
    const bodyRaw = await c.req.text()
    const canonicalMessage = buildCanonicalMessage(bodyRaw, timestamp, sessionId)

    let provider
    try {
      provider = defaultMacProviderCache.get(macKeyIdFor(service as ServiceName))
    } catch (err) {
      // Misconfiguration (e.g. env var missing) — fail closed.
      await auditDeny(c, {
        ...denyFields,
        mcpServer: service,
        reason: `service ${service} not enrolled: ${(err as Error).message}`,
      })
      return c.json(
        { error: `service ${service} not enrolled: ${(err as Error).message}` },
        403,
      )
    }

    let macBytes: Uint8Array
    try {
      macBytes = fromBase64Url(signature)
    } catch {
      // Sprint 3 S3.2 — tag MAC verify failures so the operator can
      // join across the inter-service and web-service planes.
      await auditDeny(c, {
        ...denyFields,
        mcpServer: service,
        reason: 'signature mismatch (bad base64url)',
        eventType: 'kms-mac-verify-failed',
      })
      return c.json({ error: 'signature mismatch' }, 401)
    }

    const { valid } = await provider.verifyMac({
      canonicalMessage,
      mac: macBytes,
    })
    if (!valid) {
      await auditDeny(c, {
        ...denyFields,
        mcpServer: service,
        reason: 'signature mismatch',
        eventType: 'kms-mac-verify-failed',
      })
      return c.json({ error: 'signature mismatch' }, 401)
    }

    // ─── Hardening §1.10 — replay-nonce cache ────────────────────────
    // Reject envelopes lacking a fresh per-request nonce; reject repeats
    // of a previously-seen nonce. Both arms together close the
    // within-window replay window left open by the ±60s timestamp check.
    const nonce = c.req.header(NONCE_HEADER)
    if (!nonce) {
      await auditDeny(c, { ...denyFields, mcpServer: service, reason: 'missing nonce header' })
      return c.json({ error: 'missing nonce header' }, 401)
    }
    const accepted = recordNonce(nonce, service as ServiceName)
    if (!accepted) {
      await auditDeny(c, { ...denyFields, mcpServer: service, reason: 'replay detected' })
      return c.json({ error: 'replay detected' }, 401)
    }

    c.set('interService', { service: service as ServiceName, timestamp, bodyRaw } satisfies InterServiceContext)
    // Re-set the body so downstream `c.req.json()` works (hono caches text vs json).
    await next()
  }
}

// Re-exported for legacy callers / tests that need to know whether a
// given service is enrolled without going through the provider cache.
export function isEnrolledService(service: string): service is ServiceName {
  return SERVICE_NAMES.includes(service as ServiceName)
}

// Re-exported for any tests that still build a canonical inline.
export const canonicalMessageBytesForTest = buildCanonicalMessage

// Re-exported for backwards-compat with any code that relied on this old
// env-lookup behavior. New code should not use this; the provider cache
// handles env reads.
export function getInterServiceSecret(service: string): string | undefined {
  if (!SERVICE_NAMES.includes(service as ServiceName)) return undefined
  const tail = (service as ServiceName).replace('-mcp', '').toUpperCase().replace(/-/g, '_')
  return process.env[`A2A_INTERSERVICE_HMAC_KEY_${tail}`]
}
