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
 * sit behind `requireServiceAuth('web')`. The web app signs each
 * request with `WEB_TO_A2A_HMAC_KEY`; before this change, anyone on the
 * network could mint a SessionRecord pointing at a victim's smart
 * account (full session-impersonation primitive).
 *
 * Sprint 1 W2.1 — downstream re-signing. After verifying the inbound
 * web→a2a envelope, EVERY forwarded request to person-mcp is re-signed
 * with the `a2a-to-person` MAC key so person-mcp's inbound verifier
 * (apps/person-mcp/src/auth/require-inbound-service-auth.ts) can prove
 * the call came from a2a-agent and not from an attacker who reached
 * person-mcp's HTTP port directly. The read passthroughs are also
 * signed — they leak session metadata, so person-mcp gates them too.
 *
 * Host-context middleware exempts `/session-store/*` so callers can
 * reach this route on any subdomain or even the bare a2a-agent host —
 * the session-store is a system-level surface.
 */

import { Hono } from 'hono'
import { requireServiceAuth } from '../auth/service-auth-web'
import { buildOutboundAuthHeaders } from '../auth/sign-outbound'
import { auditAppend, readCorrelationId } from '../lib/audit'
import { randomUUID } from 'node:crypto'

const PERSON_MCP_URL = process.env.PERSON_MCP_URL ?? 'http://localhost:3200'

const sessionStore = new Hono()

async function forwardJsonSigned(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<Response> {
  const url = `${PERSON_MCP_URL}${path}`
  const bodyJson = method === 'POST' && body !== undefined ? JSON.stringify(body) : ''
  const authHeaders = await buildOutboundAuthHeaders('a2a-to-person', path, bodyJson)
  const init: RequestInit = {
    method,
    headers: {
      'content-type': 'application/json',
      ...authHeaders,
    },
  }
  if (method === 'POST' && body !== undefined) {
    init.body = bodyJson
  }
  return fetch(url, init)
}

sessionStore.get('/epoch/:account', async (c) => {
  const account = c.req.param('account')
  const res = await forwardJsonSigned('GET', `/session-store/epoch/${account}`)
  return c.json(await res.json() as Record<string, unknown>, res.status as 200)
})

sessionStore.post('/insert', requireServiceAuth('web'), async (c) => {
  const body = await c.req.json<unknown>()
  const res = await forwardJsonSigned('POST', '/session-store/insert', body)
  return c.json(await res.json() as Record<string, unknown>, res.status as 200)
})

sessionStore.get('/by-cookie/:cookieValue', async (c) => {
  const cookieValue = c.req.param('cookieValue')
  const res = await forwardJsonSigned('GET', `/session-store/by-cookie/${encodeURIComponent(cookieValue)}`)
  return c.json(await res.json() as Record<string, unknown>, res.status as 200)
})

sessionStore.get('/active/:account', async (c) => {
  const account = c.req.param('account')
  const res = await forwardJsonSigned('GET', `/session-store/active/${account}`)
  return c.json(await res.json() as Record<string, unknown>, res.status as 200)
})

sessionStore.post('/revoke', requireServiceAuth('web'), async (c) => {
  const body = await c.req.json<{ sessionId?: string; smartAccountAddress?: string }>()
  const res = await forwardJsonSigned('POST', '/session-store/revoke', body)
  // Sprint 3 S3.2 — session-revoke audit. Records the revoke AFTER
  // person-mcp confirms (status reflects person-mcp's response).
  try {
    await auditAppend({
      rootGrantHash: '',
      sessionId: body.sessionId ?? '',
      sessionPrincipal: body.smartAccountAddress ?? '',
      mcpServer: 'web',
      mcpTool: 'session-store:revoke',
      eventType: 'session-revoke',
      executionPath: 'mcp-only',
      target: body.smartAccountAddress ?? null,
      status: res.ok ? 'completed' : 'denied',
      errorReason: res.ok ? '' : `person-mcp returned ${res.status}`,
      correlationId: readCorrelationId(c),
      mcpCallId: `session-revoke:${body.sessionId ?? randomUUID()}`,
    })
  } catch (err) {
    console.error('[session-store/revoke audit] failed:', err)
  }
  return c.json(await res.json() as Record<string, unknown>, res.status as 200)
})

sessionStore.post('/bump-epoch', requireServiceAuth('web'), async (c) => {
  const body = await c.req.json<{ smartAccountAddress?: string }>()
  const res = await forwardJsonSigned('POST', '/session-store/bump-epoch', body)
  // Sprint 3 S3.2 — session-epoch-bump audit. The bump invalidates every
  // session for the account; record it before returning so a malicious
  // bumper leaves a trail.
  try {
    await auditAppend({
      rootGrantHash: '',
      sessionId: '',
      sessionPrincipal: body.smartAccountAddress ?? '',
      mcpServer: 'web',
      mcpTool: 'session-store:bump-epoch',
      eventType: 'session-epoch-bump',
      executionPath: 'mcp-only',
      target: body.smartAccountAddress ?? null,
      status: res.ok ? 'completed' : 'denied',
      errorReason: res.ok ? '' : `person-mcp returned ${res.status}`,
      correlationId: readCorrelationId(c),
      mcpCallId: `session-epoch-bump:${body.smartAccountAddress ?? ''}:${randomUUID()}`,
    })
  } catch (err) {
    console.error('[session-store/bump-epoch audit] failed:', err)
  }
  return c.json(await res.json() as Record<string, unknown>, res.status as 200)
})

export { sessionStore }
