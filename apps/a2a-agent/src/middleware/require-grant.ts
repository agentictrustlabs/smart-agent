/**
 * SessionGrant.v1 authentication middleware.
 *
 * Per design doc §6: a2a-agent is one of the audiences in the unified
 * grant. This middleware validates that the caller holds a current grant
 * authorising 'a2a-agent', without re-running the on-chain ERC-1271 check
 * (the verifier already did that at grant minting).
 *
 * Header:  Authorization: Bearer <session-id>
 * Lookup:  person-mcp /session-store/by-cookie/<sessionId>
 *
 * If the request includes a legacy a2a session token, this middleware does
 * not interfere — call sites can choose between requireSession and
 * requireGrantSession during the transition.
 */

import { createMiddleware } from 'hono/factory'

interface GrantRecord {
  sessionId: string
  smartAccountAddress: `0x${string}`
  sessionSignerAddress: `0x${string}`
  grant: {
    audience: string[]
    scope: { maxRisk: 'low' | 'medium'; walletActions: string[] }
    session: { revocationEpoch: number; expiresAt: number }
  }
  grantHash: string
  expiresAt: string
  revokedAt?: string | null
  revocationEpoch: number
}

declare module 'hono' {
  interface ContextVariableMap {
    grant: GrantRecord
  }
}

const PERSON_MCP_URL = process.env.PERSON_MCP_URL ?? 'http://localhost:3200'
const SERVICE_NAME = process.env.A2A_SERVICE_NAME ?? 'a2a-agent'

export const requireGrantSession = createMiddleware(async (c, next) => {
  const auth = c.req.header('Authorization')
  if (!auth?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401)
  }
  const sessionId = auth.slice(7)

  let record: GrantRecord | null = null
  try {
    const res = await fetch(`${PERSON_MCP_URL}/session-store/by-cookie/${encodeURIComponent(sessionId)}`)
    if (!res.ok) {
      return c.json({ error: `grant lookup failed: HTTP ${res.status}` }, 502)
    }
    const data = await res.json() as { record: GrantRecord | null }
    record = data.record
  } catch (err) {
    return c.json({ error: `grant lookup failed: ${(err as Error).message}` }, 502)
  }

  if (!record) {
    return c.json({ error: 'No grant for session-id' }, 401)
  }
  if (record.revokedAt) {
    return c.json({ error: 'Grant revoked' }, 401)
  }
  if (new Date(record.expiresAt).getTime() <= Date.now()) {
    return c.json({ error: 'Grant expired' }, 401)
  }
  if (!record.grant.audience.includes(SERVICE_NAME)) {
    return c.json({ error: `${SERVICE_NAME} not in grant.audience` }, 403)
  }

  c.set('grant', record)
  await next()
})
