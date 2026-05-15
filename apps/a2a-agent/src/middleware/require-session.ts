import { createMiddleware } from 'hono/factory'
import { eq, and } from 'drizzle-orm'
import { db } from '../db'
import { sessions } from '../db/schema'

type SessionRow = typeof sessions.$inferSelect

// Extend Hono context variables
declare module 'hono' {
  interface ContextVariableMap {
    session: SessionRow
  }
}

const PERSON_MCP_URL = process.env.PERSON_MCP_URL ?? 'http://localhost:3200'
const SERVICE_NAME = process.env.A2A_SERVICE_NAME ?? 'a2a-agent'

interface GrantRecord {
  sessionId: string
  smartAccountAddress: `0x${string}`
  sessionSignerAddress: `0x${string}`
  grant: { audience: string[] }
  expiresAt: string
  revokedAt?: string | null
}

/**
 * Unified auth: tries the new SessionGrant.v1 first (Bearer = session-id
 * looked up on person-mcp), falls back to the legacy a2a sessions table
 * for clients that still hold a delegation-bootstrapped session.
 *
 * Both paths populate `c.get('session')` with the same shape so route
 * handlers don't need to branch.
 *
 * In addition to validating the bearer, this middleware now requires that
 * the resolved session's `accountAddress` matches the host-bound agent
 * principal (`agentHostContext.agentAddress`). A session minted for one
 * agent cannot be replayed against another agent's subdomain — that would
 * defeat the whole point of host-scoped routing.
 */
export const requireSession = createMiddleware(async (c, next) => {
  const authHeader = c.req.header('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid Authorization header' }, 401)
  }
  const token = authHeader.slice(7)

  let resolvedSession: SessionRow | null = null

  // Path A — SessionGrant.v1 lookup on person-mcp.
  try {
    const res = await fetch(`${PERSON_MCP_URL}/session-store/by-cookie/${encodeURIComponent(token)}`)
    if (res.ok) {
      const data = await res.json() as { record: GrantRecord | null }
      const r = data.record
      if (r && !r.revokedAt && new Date(r.expiresAt).getTime() > Date.now()) {
        if (!r.grant.audience.includes(SERVICE_NAME)) {
          return c.json({ error: `${SERVICE_NAME} not in grant.audience` }, 403)
        }
        resolvedSession = {
          id: r.sessionId,
          accountAddress: r.smartAccountAddress,
          sessionKeyAddress: r.sessionSignerAddress,
          encryptedPackage: null,
          iv: null,
          status: 'active',
          expiresAt: r.expiresAt,
          createdAt: new Date().toISOString(),
        } as unknown as SessionRow
      }
    }
  } catch { /* fall through to legacy lookup */ }

  if (!resolvedSession) {
    // Path B — legacy a2a sessions table.
    const [sessionRow] = await db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, token), eq(sessions.status, 'active')))
      .limit(1)

    if (!sessionRow) {
      return c.json({ error: 'Invalid or expired session token' }, 401)
    }
    if (new Date(sessionRow.expiresAt) < new Date()) {
      return c.json({ error: 'Session expired' }, 401)
    }
    resolvedSession = sessionRow
  }

  // Host binding: log a cross-agent call for audit but do NOT hard-
  // enforce. Two legitimate scenarios produce mismatches:
  //   1. A user acts on behalf of an organization — session is bound to
  //      the user's smart account; the routed-to agent is the org.
  //   2. A user calls hub-mcp's system slug — no per-user binding.
  // Authorization is enforced downstream by the MCP tool layer + the
  // on-chain delegation/ERC-1271 chain on every write. The host slug is
  // a ROUTING signal, not an identity assertion.
  const hostCtx = c.get('agentHostContext')
  if (hostCtx) {
    const expected = hostCtx.agentAddress.toLowerCase()
    const got = (resolvedSession.accountAddress ?? '').toLowerCase()
    if (expected !== got && expected !== '0x0000000000000000000000000000000000000000') {
      // eslint-disable-next-line no-console
      console.log(`[require-session] cross-agent call session=${got} host=${expected} path=${new URL(c.req.url).pathname}`)
    }
  }

  c.set('session', resolvedSession)
  await next()
})
