/**
 * Inbound service-auth middleware for org-mcp (Sprint 4 A.1).
 *
 * Mirrors `apps/person-mcp/src/auth/require-inbound-service-auth.ts`
 * (W2.1) for the a2a-agent → org-mcp hop. Before A.1, org-mcp's tool
 * surface (`/tools/*`) accepted any caller that could reach the HTTP
 * port — a compromised peer or misconfigured proxy could invoke any
 * tool (list_proposals, deploy_agent, etc.) without authorization.
 *
 * This middleware closes the gap. Every authority-bearing route on
 * org-mcp now re-verifies that the caller is an enrolled upstream
 * service (currently only `a2a-agent` is allowed inbound — web shouldn't
 * bypass a2a-agent).
 *
 * Wire format mirrors the web→a2a / a2a→person envelope:
 *
 *   X-SA-Service:   a2a-agent
 *   X-SA-Timestamp: 1746902400          (unix seconds, ±60s window)
 *   X-SA-Nonce:     <fresh-per-request> (replay defense)
 *   X-SA-Signature: <base64url MAC>
 *
 *   canonical = `${ts}|${nonce}|${path}|${sha256(body)}`
 *
 * MAC key id is `a2a-to-org`. HMAC is symmetric — a2a-agent and
 * org-mcp share the secret (`A2A_INTERSERVICE_HMAC_KEY_ORG` in
 * local-aes mode, `AWS_KMS_MAC_KEY_ID_A2A_TO_ORG` in aws-kms mode).
 * a2a-agent already holds it as an OUTBOUND signing key for some
 * existing flows; we now reuse the same key for the generic mcp-proxy
 * hop and verify on receipt.
 *
 * On failure: write a `decision: 'denied'` audit row (via
 * `lib/audit.ts::auditDeny`) and return 401 with a short error code.
 * On success: attach `{ service }` to the context for downstream handlers.
 */

import { fromBase64Url } from '@smart-agent/sdk'
import { buildMcpMacProvider, type KmsMacProvider } from '@smart-agent/sdk/key-custody'
import { createHash } from 'node:crypto'
import type { Context, MiddlewareHandler } from 'hono'
import { recordNonce } from './replay-nonce.js'
import { auditDeny } from '../lib/audit.js'

export const SERVICE_HEADER = 'x-sa-service'
export const TIMESTAMP_HEADER = 'x-sa-timestamp'
export const NONCE_HEADER = 'x-sa-nonce'
export const SIGNATURE_HEADER = 'x-sa-signature'

export const MAX_CLOCK_SKEW_SECONDS = 60

/** The only inbound service allowed to talk to org-mcp's control plane. */
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

// Lazy provider cache — the MAC provider for `a2a-to-org` is
// constructed once on first request and reused thereafter. Test code
// can force a fresh build by clearing this via `resetInboundMacProvider`.
let cachedMacProvider: KmsMacProvider | null = null
function inboundMacProvider(): KmsMacProvider {
  if (!cachedMacProvider) {
    // `buildMcpMacProvider('org', env)` returns the provider scoped
    // to the `a2a-to-org` MAC key id. HMAC is symmetric, so the same
    // provider verifies inbound MACs that a2a-agent generates using
    // this same key id on the OTHER end of the wire.
    cachedMacProvider = buildMcpMacProvider('org', process.env)
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
    const path = new URL(c.req.url).pathname
    const denyFields = { route: path, mcpServer: 'unknown' as string | undefined }

    const service = c.req.header(SERVICE_HEADER)
    const timestampStr = c.req.header(TIMESTAMP_HEADER)
    const nonce = c.req.header(NONCE_HEADER)
    const signature = c.req.header(SIGNATURE_HEADER)

    if (!service || !timestampStr || !nonce || !signature) {
      auditDeny(c, { ...denyFields, reason: 'missing service-auth headers' })
      return c.json({ error: 'missing service-auth headers' }, 401)
    }
    if (!allowedServices.includes(service as InboundService)) {
      auditDeny(c, { ...denyFields, mcpServer: service, reason: `unexpected service: ${service}` })
      return c.json({ error: `unexpected service: ${service}` }, 401)
    }

    const timestamp = Number(timestampStr)
    if (!Number.isFinite(timestamp)) {
      auditDeny(c, { ...denyFields, mcpServer: service, reason: 'invalid timestamp' })
      return c.json({ error: 'invalid timestamp' }, 401)
    }
    const now = Math.floor(Date.now() / 1000)
    if (Math.abs(now - timestamp) > MAX_CLOCK_SKEW_SECONDS) {
      auditDeny(c, { ...denyFields, mcpServer: service, reason: 'timestamp out of window' })
      return c.json({ error: 'timestamp out of window' }, 401)
    }

    let provider: KmsMacProvider
    try {
      provider = inboundMacProvider()
    } catch (err) {
      auditDeny(c, {
        ...denyFields,
        mcpServer: service,
        reason: `a2a-to-org key not configured: ${(err as Error).message}`,
      })
      return c.json(
        { error: `a2a-to-org key not configured: ${(err as Error).message}` },
        503,
      )
    }

    const bodyRaw = await c.req.text()
    const canonical = buildInboundCanonical(timestamp, nonce, path, bodyRaw)
    const canonicalMessage = new TextEncoder().encode(canonical)

    let macBytes: Uint8Array
    try {
      macBytes = fromBase64Url(signature)
    } catch {
      auditDeny(c, { ...denyFields, mcpServer: service, reason: 'signature mismatch (bad base64url)' })
      return c.json({ error: 'signature mismatch' }, 401)
    }

    const { valid } = await provider.verifyMac({ canonicalMessage, mac: macBytes })
    if (!valid) {
      auditDeny(c, { ...denyFields, mcpServer: service, reason: 'signature mismatch' })
      return c.json({ error: 'signature mismatch' }, 401)
    }

    // Replay defense — record AFTER signature verifies so a valid
    // attacker-collision can't pre-burn a nonce. First INSERT wins.
    const accepted = recordNonce(nonce, service)
    if (!accepted) {
      auditDeny(c, { ...denyFields, mcpServer: service, reason: 'replay detected' })
      return c.json({ error: 'replay detected' }, 401)
    }

    c.set('inboundService', { service: service as InboundService, timestamp })
    await next()
  }
}
