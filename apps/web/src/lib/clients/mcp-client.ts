/**
 * Generic MCP client used by web server actions to invoke person-mcp / org-mcp
 * tools through the A2A agent's `/mcp/:server/:tool` proxy.
 *
 * Server-only module. Not a `'use server'` action surface itself — it's
 * imported by action files (which carry their own 'use server' directive)
 * and by API routes. Keeping non-async exports (the `McpCallError` class,
 * the `McpServer` type) here is fine because this file isn't a server-action
 * boundary — it's a regular server-side helper.
 *
 * Routing is host-aware (Phase 2 of A2A-first routing). Each request is
 * sent to `http://<slug>.agent.localhost:3100`, where the slug is derived
 * from the agent address the call is bound to. Two modes:
 *
 *   • `opts.agentAddress` is set → resolve THAT agent's slug. Use this for
 *     org-mcp tools where the org address is the principal.
 *   • `opts.agentAddress` is absent → fall back to the current user's
 *     person agent. Use this for person-mcp tools.
 *
 * No fallback to a bare-port URL — if the resolver can't find a slug for
 * the address, the call fails fast with `McpCallError` and the caller is
 * expected to surface the error.
 */

import 'server-only'
import { getA2ASessionToken } from '@/lib/actions/a2a-session.action'
import {
  resolveA2AEndpointForAgent,
  resolveA2AEndpointForCurrentUser,
  A2AUrlResolverError,
} from './a2a-url-resolver'
import { a2aFetch } from './a2a-fetch'

export type McpServer = 'person' | 'org' | 'people-group' | 'hub'

export interface CallMcpOptions {
  /** Address of the agent the call is bound to (org for org-mcp, person
   *  for person-mcp). When omitted, defaults to the current user's
   *  person agent. Ignored when `server === 'hub'` — hub-mcp is a
   *  system service routed via a fixed `system.<base>` host. */
  agentAddress?: string
}

/** The A2A host for hub-mcp. Hub-mcp is system-level (public KB reads +
 *  GraphDB writes); it isn't user-bound. The A2A gateway recognizes this
 *  slug specifically and bypasses the per-user session check for hub
 *  routes. */
const HUB_HOST_SLUG = 'system'

export class McpCallError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'McpCallError'
  }
}

export async function callMcp<T = unknown>(
  server: McpServer,
  tool: string,
  args: Record<string, unknown> = {},
  opts: CallMcpOptions = {},
): Promise<T> {
  // ── hub-mcp: system-level routing ──────────────────────────────────
  // Hub doesn't run on behalf of any user — it serves cached KB reads +
  // GraphDB sync writes. Route through A2A's `system.<base>` slug, which
  // bypasses the per-user session enforcement at the gateway.
  if (server === 'hub') {
    const base = process.env.NEXT_PUBLIC_A2A_HOST_BASE ?? 'agent.localhost:3100'
    const scheme = process.env.NEXT_PUBLIC_A2A_SCHEME ?? 'http'
    // Use the slug-prefixed URL so the Host header (which Node sets from
    // the URL automatically) carries `system.<base>`. The a2aFetch
    // dispatcher will still wire the actual TCP connection to
    // 127.0.0.1:<port>.
    const endpoint = `${scheme}://${HUB_HOST_SLUG}.${base}`
    const res = await a2aFetch(`${endpoint}/mcp/hub/${tool}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string }
      throw new McpCallError(res.status, err.error ?? `MCP hub.${tool} failed: ${res.statusText}`)
    }
    return res.json() as Promise<T>
  }

  // ── per-user routing (person, org, people-group) ───────────────────
  const token = await getA2ASessionToken()
  if (!token) {
    throw new McpCallError(401, 'No A2A session — connect your agent to access private data')
  }

  let endpoint: { endpoint: string; hostHeader: string; slug: string }
  try {
    endpoint = opts.agentAddress
      ? await resolveA2AEndpointForAgent(opts.agentAddress)
      : await resolveA2AEndpointForCurrentUser()
  } catch (e) {
    if (e instanceof A2AUrlResolverError) {
      throw new McpCallError(
        500,
        `A2A endpoint not resolvable for ${opts.agentAddress ?? 'current user'}: ${e.message}`,
      )
    }
    throw e
  }

  // We set the Host header explicitly so the request reaches the correct
  // virtual host inside the single A2A process even when running through
  // proxies or runtimes whose fetch doesn't transparently forward the
  // subdomain. The `*.localhost` TLD resolves to 127.0.0.1 by spec.
  const res = await a2aFetch(`${endpoint.endpoint}/mcp/${server}/${tool}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'Host': endpoint.hostHeader,
    },
    body: JSON.stringify(args),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string }
    throw new McpCallError(res.status, err.error ?? `MCP ${server}.${tool} failed: ${res.statusText}`)
  }

  return res.json() as Promise<T>
}
