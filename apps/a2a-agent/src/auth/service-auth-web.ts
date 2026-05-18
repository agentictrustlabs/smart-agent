/**
 * Service-auth middleware for the web app → a2a-agent path
 * (Hardening §1.3, Stream B Task B1).
 *
 * The session-store bootstrap routes (`/session-store/insert`,
 * `/session-store/revoke`, `/session-store/bump-epoch`) and the
 * `/wallet-action/dispatch` passthrough used to be pure passthroughs:
 * anyone on the network could POST a fabricated SessionRecord and plant
 * an attacker-controlled session for a known victim. The cryptographic
 * authority lives further downstream (passkey assertion + WalletAction
 * signature), but defense-in-depth at the a2a edge is non-optional once
 * langchain orchestration runs in-process.
 *
 * This middleware adds an HMAC-signed envelope between web and a2a-agent.
 * After KMS migration K3-extension lands, the underlying MAC key is the
 * `web-to-a2a` KMS HMAC key in production (or the legacy
 * `WEB_TO_A2A_HMAC_KEY` env var in dev). The canonical-message format is
 * UNCHANGED — only the signing primitive swaps to `kms:VerifyMac`.
 *
 *   X-SA-Service:   web
 *   X-SA-Timestamp: 1746902400          (unix seconds, ±60s window)
 *   X-SA-Nonce:     <fresh-per-request> (replay defense)
 *   X-SA-Signature: <base64url MAC>
 *
 *   canonical = `${ts}|${nonce}|${path}|${sha256(body)}`
 *
 * `path` is the request path (without host or query) — a captured
 * signature for `/session-store/insert` cannot be replayed against
 * `/session-store/revoke`. `sha256(body)` is the lowercase hex digest of
 * the raw request body bytes (empty string for empty bodies). Both
 * sides compute and compare base64url MACs.
 *
 * On success, the middleware sets `c.var.webService = { timestamp }` for
 * downstream observability. The downstream handler is free to do its
 * own re-verification (e.g. person-mcp's passkey re-check on insert —
 * Task B3).
 */

import { fromBase64Url } from '@smart-agent/sdk'
import { createHash } from 'node:crypto'
import type { Context, MiddlewareHandler } from 'hono'
import { recordNonce } from './replay-nonce'
import { defaultMacProviderCache } from './mac-provider'
import { auditDeny } from '../lib/audit'

export const WEB_SERVICE_HEADER = 'x-sa-service'
export const WEB_TIMESTAMP_HEADER = 'x-sa-timestamp'
export const WEB_NONCE_HEADER = 'x-sa-nonce'
export const WEB_SIGNATURE_HEADER = 'x-sa-signature'

export const WEB_MAX_CLOCK_SKEW_SECONDS = 60

/** Hex-encoded SHA-256 of the raw request body. */
export function sha256Hex(bodyRaw: string): string {
  return createHash('sha256').update(bodyRaw, 'utf8').digest('hex')
}

/** Build the canonical string that both client and server sign over. */
export function buildWebCanonical(
  timestamp: number | string,
  nonce: string,
  path: string,
  bodyRaw: string,
): string {
  return `${timestamp}|${nonce}|${path}|${sha256Hex(bodyRaw)}`
}

interface WebServiceContext {
  service: 'web'
  timestamp: number
}

declare module 'hono' {
  interface ContextVariableMap {
    webService?: WebServiceContext
  }
}

/**
 * Mount on bootstrap routes that the web app calls and that have no
 * other cryptographic authority at the a2a edge.
 *
 * `expectedService` is the literal service name expected in
 * X-SA-Service. For the web→a2a path that's `'web'`; the parameter
 * exists so a future planner / langchain service can reuse the
 * envelope shape with its own key.
 */
export function requireServiceAuth(expectedService: 'web'): MiddlewareHandler {
  return async (c: Context, next) => {
    // Hardening Phase 1D #2 — denial-path audit. Every reject path
    // writes one `status: 'denied'` row before returning the 4xx.
    const path = new URL(c.req.url).pathname
    const denyFields = {
      route: path,
      mcpServer: 'web',
      executionPath: 'mcp-only' as const,
    }

    const service = c.req.header(WEB_SERVICE_HEADER)
    const timestampStr = c.req.header(WEB_TIMESTAMP_HEADER)
    const nonce = c.req.header(WEB_NONCE_HEADER)
    const signature = c.req.header(WEB_SIGNATURE_HEADER)

    if (!service || !timestampStr || !nonce || !signature) {
      await auditDeny(c, { ...denyFields, reason: 'missing service-auth headers' })
      return c.json({ error: 'missing service-auth headers' }, 401)
    }
    if (service !== expectedService) {
      await auditDeny(c, { ...denyFields, reason: `unexpected service: ${service}` })
      return c.json({ error: `unexpected service: ${service}` }, 401)
    }

    const timestamp = Number(timestampStr)
    if (!Number.isFinite(timestamp)) {
      await auditDeny(c, { ...denyFields, reason: 'invalid timestamp' })
      return c.json({ error: 'invalid timestamp' }, 401)
    }
    const now = Math.floor(Date.now() / 1000)
    if (Math.abs(now - timestamp) > WEB_MAX_CLOCK_SKEW_SECONDS) {
      await auditDeny(c, { ...denyFields, reason: 'timestamp out of window' })
      return c.json({ error: 'timestamp out of window' }, 401)
    }

    let provider
    try {
      provider = defaultMacProviderCache.get('web-to-a2a')
    } catch (err) {
      // Misconfiguration — fail closed (same posture as the pre-K3-ext
      // missing-secret branch).
      await auditDeny(c, {
        ...denyFields,
        reason: `WEB_TO_A2A_HMAC_KEY not configured: ${(err as Error).message}`,
      })
      return c.json(
        { error: `WEB_TO_A2A_HMAC_KEY not configured: ${(err as Error).message}` },
        503,
      )
    }

    const bodyRaw = await c.req.text()
    // Use only the path portion of the URL (no host, no query) so the
    // canonical is identical whether the caller hits 127.0.0.1, the
    // bare loopback host, or a service-mesh DNS name.
    const canonical = buildWebCanonical(timestamp, nonce, path, bodyRaw)
    const canonicalMessage = new TextEncoder().encode(canonical)

    let macBytes: Uint8Array
    try {
      macBytes = fromBase64Url(signature)
    } catch {
      // Sprint 3 S3.2 — tag MAC verify failures.
      await auditDeny(c, {
        ...denyFields,
        reason: 'signature mismatch (bad base64url)',
        eventType: 'kms-mac-verify-failed',
      })
      return c.json({ error: 'signature mismatch' }, 401)
    }

    const { valid } = await provider.verifyMac({ canonicalMessage, mac: macBytes })
    if (!valid) {
      await auditDeny(c, {
        ...denyFields,
        reason: 'signature mismatch',
        eventType: 'kms-mac-verify-failed',
      })
      return c.json({ error: 'signature mismatch' }, 401)
    }

    // Replay defense — shared `inter_service_nonce` table with the
    // existing inter-service envelope. Same nonce burned across either
    // path is rejected.
    const accepted = recordNonce(nonce, expectedService)
    if (!accepted) {
      await auditDeny(c, { ...denyFields, reason: 'replay detected' })
      return c.json({ error: 'replay detected' }, 401)
    }

    c.set('webService', { service: expectedService, timestamp } satisfies WebServiceContext)
    await next()
  }
}
