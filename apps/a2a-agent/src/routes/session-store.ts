/**
 * A2A bootstrap passthrough for person-mcp's SessionRecord storage.
 *
 * Phase 2 of the A2A+MCP consolidation moved the session-store reads
 * and writes off the web app's direct PERSON_MCP_URL holdout in
 * `apps/web/src/lib/auth/person-mcp-session-client.ts`. The web app now
 * calls these routes on a2a-agent; a2a-agent forwards to person-mcp.
 *
 * The endpoints fall into two groups:
 *
 *   Bootstrap-tier (no A2A session yet):
 *     GET  /session-store/epoch/:account
 *     POST /session-store/insert
 *     GET  /session-store/by-cookie/:cookieValue
 *
 *   Post-session-tier (caller has an A2A session):
 *     GET  /session-store/active/:account
 *     POST /session-store/revoke
 *     POST /session-store/bump-epoch
 *
 * Hardening §1.3 (Stream B Task B1): the WRITE routes
 *   - POST /insert
 *   - POST /revoke
 *   - POST /bump-epoch
 * now sit behind `requireServiceAuth('web')`. The web app signs each
 * request with `WEB_TO_A2A_HMAC_KEY`; before this change, anyone on the
 * network could mint a SessionRecord pointing at a victim's smart
 * account (full session-impersonation primitive).
 *
 * The READ routes (`/epoch/:account`, `/by-cookie/:cookieValue`,
 * `/active/:account`) are left unauthenticated at the a2a edge for now
 * — they're read-only and idempotent; the broader route-classification
 * sweep in Phase 1B will assign them to a service-auth tier alongside
 * the inbound MCP→A2A direction.
 *
 * Host-context middleware exempts `/session-store/*` so callers can
 * reach this route on any subdomain or even the bare a2a-agent host —
 * the session-store is a system-level surface.
 */

import { Hono } from 'hono'
import { requireServiceAuth } from '../auth/service-auth-web'

const PERSON_MCP_URL = process.env.PERSON_MCP_URL ?? 'http://localhost:3200'

const sessionStore = new Hono()

async function forwardJson(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Response> {
  const url = `${PERSON_MCP_URL}${path}`
  const init: RequestInit = {
    method,
    headers: { 'content-type': 'application/json' },
  }
  if (method === 'POST' && body !== undefined) {
    init.body = JSON.stringify(body)
  }
  return fetch(url, init)
}

sessionStore.get('/epoch/:account', async (c) => {
  const account = c.req.param('account')
  const res = await forwardJson('GET', `/session-store/epoch/${account}`)
  return c.json(await res.json() as Record<string, unknown>, res.status as 200)
})

sessionStore.post('/insert', requireServiceAuth('web'), async (c) => {
  const body = await c.req.json<unknown>()
  const res = await forwardJson('POST', '/session-store/insert', body)
  return c.json(await res.json() as Record<string, unknown>, res.status as 200)
})

sessionStore.get('/by-cookie/:cookieValue', async (c) => {
  const cookieValue = c.req.param('cookieValue')
  const res = await forwardJson('GET', `/session-store/by-cookie/${encodeURIComponent(cookieValue)}`)
  return c.json(await res.json() as Record<string, unknown>, res.status as 200)
})

sessionStore.get('/active/:account', async (c) => {
  const account = c.req.param('account')
  const res = await forwardJson('GET', `/session-store/active/${account}`)
  return c.json(await res.json() as Record<string, unknown>, res.status as 200)
})

sessionStore.post('/revoke', requireServiceAuth('web'), async (c) => {
  const body = await c.req.json<unknown>()
  const res = await forwardJson('POST', '/session-store/revoke', body)
  return c.json(await res.json() as Record<string, unknown>, res.status as 200)
})

sessionStore.post('/bump-epoch', requireServiceAuth('web'), async (c) => {
  const body = await c.req.json<unknown>()
  const res = await forwardJson('POST', '/session-store/bump-epoch', body)
  return c.json(await res.json() as Record<string, unknown>, res.status as 200)
})

export { sessionStore }
