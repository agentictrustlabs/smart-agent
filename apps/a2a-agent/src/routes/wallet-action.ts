/**
 * A2A bootstrap passthrough for person-mcp's WalletActionV1 dispatch.
 *
 * Phase 3 of the A2A+MCP consolidation. The web app no longer opens a
 * direct PERSON_MCP_URL connection for wallet-action dispatch; it
 * routes through this passthrough instead.
 *
 * Hardening §1.3 (Stream B Task B1): the passthrough is signed by
 * the web app with `WEB_TO_A2A_HMAC_KEY` and verified at the a2a edge.
 * The WalletAction signature remains the cryptographic authority that
 * person-mcp re-verifies on receipt — but defense-in-depth at the edge
 * keeps an in-process langchain runtime (or any other a2a-side caller)
 * from forging dispatches without going through web.
 *
 * Sprint 1 W2.1 — downstream re-signing. After verifying the inbound
 * web→a2a envelope, the forwarded request to person-mcp is re-signed
 * with the `a2a-to-person` MAC key. Person-mcp's inbound verifier
 * rejects unauthenticated dispatches; the WalletAction signature is the
 * "what the user authorized" authority, the HMAC envelope is the "which
 * service made this call" authority.
 *
 * Person-mcp owns the verifier + handlers. The passthrough only
 * relays the JSON body. The host-context middleware exempts
 * `/wallet-action/*` so callers can reach this route on the bare A2A
 * host (no agent slug needed — wallet-action dispatch is
 * system-scoped, per-session, not per-agent).
 */

import { Hono } from 'hono'
import { requireServiceAuth } from '../auth/service-auth-web'
import { buildOutboundAuthHeaders } from '../auth/sign-outbound'

const PERSON_MCP_URL = process.env.PERSON_MCP_URL ?? 'http://localhost:3200'

const walletAction = new Hono()

walletAction.post('/dispatch', requireServiceAuth('web'), async (c) => {
  const body = await c.req.json<unknown>()
  const bodyJson = JSON.stringify(body)
  const path = '/wallet-action/dispatch'
  const authHeaders = await buildOutboundAuthHeaders('a2a-to-person', path, bodyJson)
  const res = await fetch(`${PERSON_MCP_URL}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...authHeaders,
    },
    body: bodyJson,
  })
  const text = await res.text()
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { parsed = { ok: false, code: 'invalid_response', detail: text } }
  return c.json(parsed as Record<string, unknown>, res.status as 200)
})

export { walletAction }
