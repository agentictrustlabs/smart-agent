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
 * Each MCP server gets its own HMAC secret at deploy time:
 *   A2A_INTERSERVICE_HMAC_KEY_ORG     — org-mcp's shared secret
 *   A2A_INTERSERVICE_HMAC_KEY_PERSON  — person-mcp's shared secret
 *   (etc. for family, geo, verifier, skill, people-group)
 *
 * Request signing: `HMAC-SHA256(secret, requestBodyJson + ":" + timestamp + ":" + sessionId)`
 * Header layout:
 *   x-a2a-service: org-mcp
 *   x-a2a-timestamp: 1746902400
 *   x-a2a-signature: 0xabc…
 *
 * Replay protection: timestamps must be within ±60s of the verifier's clock.
 */
import { hmacVerify } from '@smart-agent/sdk'
import type { Context, MiddlewareHandler } from 'hono'

export const SERVICE_HEADER = 'x-a2a-service'
export const TIMESTAMP_HEADER = 'x-a2a-timestamp'
export const SIGNATURE_HEADER = 'x-a2a-signature'

const MAX_CLOCK_SKEW_SECONDS = 60

const SERVICE_NAMES = ['org-mcp', 'person-mcp', 'family-mcp', 'people-group-mcp', 'verifier-mcp', 'skill-mcp', 'geo-mcp'] as const
type ServiceName = typeof SERVICE_NAMES[number]

function envKeyFor(service: ServiceName): string {
  // org-mcp → A2A_INTERSERVICE_HMAC_KEY_ORG
  const tail = service.replace('-mcp', '').toUpperCase().replace(/-/g, '_')
  return `A2A_INTERSERVICE_HMAC_KEY_${tail}`
}

export function getInterServiceSecret(service: string): string | undefined {
  if (!SERVICE_NAMES.includes(service as ServiceName)) return undefined
  return process.env[envKeyFor(service as ServiceName)]
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
    const service = c.req.header(SERVICE_HEADER)
    const timestampStr = c.req.header(TIMESTAMP_HEADER)
    const signature = c.req.header(SIGNATURE_HEADER)

    if (!service || !timestampStr || !signature) {
      return c.json({ error: 'missing inter-service auth headers' }, 401)
    }
    if (!SERVICE_NAMES.includes(service as ServiceName)) {
      return c.json({ error: `unknown service: ${service}` }, 401)
    }

    const timestamp = Number(timestampStr)
    if (!Number.isFinite(timestamp)) {
      return c.json({ error: 'invalid timestamp' }, 401)
    }
    const now = Math.floor(Date.now() / 1000)
    if (Math.abs(now - timestamp) > MAX_CLOCK_SKEW_SECONDS) {
      return c.json({ error: 'timestamp out of window' }, 401)
    }

    const secret = getInterServiceSecret(service)
    if (!secret) {
      return c.json({ error: `service ${service} not enrolled (env missing)` }, 403)
    }

    // The path's :id is part of the canonical message so a signature for
    // one session can't be replayed against another.
    const sessionId = c.req.param('id') ?? ''
    const bodyRaw = await c.req.text()
    const canonical = `${bodyRaw}:${timestamp}:${sessionId}`

    const ok = await hmacVerify(canonical, signature, secret)
    if (!ok) {
      return c.json({ error: 'signature mismatch' }, 401)
    }

    c.set('interService', { service: service as ServiceName, timestamp, bodyRaw } satisfies InterServiceContext)
    // Re-set the body so downstream `c.req.json()` works (hono caches text vs json).
    await next()
  }
}
