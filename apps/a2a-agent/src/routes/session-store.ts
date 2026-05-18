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
 * Sprint 5 Wave 2 P1-1: EVERY route — read or write — sits behind
 * `requireServiceAuth('web')`. Session metadata is sensitive: a
 * /by-cookie or /active read leaks which smart account a cookie maps
 * to, the active-session set for any account, and the revocation
 * epoch. Even though the cryptographic authority lives further down
 * (passkey + WalletAction), defense-in-depth at the a2a edge is
 * non-optional once langchain orchestration runs in-process. The
 * canonical-message format is the unified v2 spec from Sprint 5 P0-3
 * (`${ts}|${nonce}|${path}|${sha256(body)}`); for GETs the body hash
 * is the sha256 of the empty string. The web app signs every request
 * with `WEB_TO_A2A_HMAC_KEY`; before P1-1 closed this, anyone on the
 * network could list session metadata or (for writes) mint a
 * SessionRecord pointing at a victim's smart account.
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

// Sprint 5 P1-1 — GETs on session-store leak session metadata
// (account ↔ cookie binding, active sessions, revocation epoch). Gate
// every read with the same web→a2a HMAC envelope as the writes. For a
// GET the request body is empty, so the body-hash in the canonical
// string is sha256("") — handled transparently by buildWebCanonical.
sessionStore.get('/epoch/:account', requireServiceAuth('web'), async (c) => {
  const account = c.req.param('account')
  const res = await forwardJsonSigned('GET', `/session-store/epoch/${account}`)
  return c.json(await res.json() as Record<string, unknown>, res.status as 200)
})

sessionStore.post('/insert', requireServiceAuth('web'), async (c) => {
  const body = await c.req.json<unknown>()
  const res = await forwardJsonSigned('POST', '/session-store/insert', body)
  return c.json(await res.json() as Record<string, unknown>, res.status as 200)
})

sessionStore.get('/by-cookie/:cookieValue', requireServiceAuth('web'), async (c) => {
  const cookieValue = c.req.param('cookieValue')
  const res = await forwardJsonSigned('GET', `/session-store/by-cookie/${encodeURIComponent(cookieValue)}`)
  return c.json(await res.json() as Record<string, unknown>, res.status as 200)
})

// Operator-class read used only by the web app's "active sessions"
// admin view. Like the other reads, it leaks session metadata; if a
// future operator console ever needs to call this, it should mint its
// own service-auth key rather than fall back to no-auth.
sessionStore.get('/active/:account', requireServiceAuth('web'), async (c) => {
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
