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
 * The proxy mints a delegation token bound to the user's smart account session
 * and attaches it to the MCP call. Web actions never see the token directly.
 *
 * Usage:
 *   const result = await callMcp<{ contacts: OikosContact[] }>(
 *     'person', 'list_oikos_contacts', {},
 *   )
 */

import { getA2ASessionToken } from '@/lib/actions/a2a-session.action'

const A2A_AGENT_URL = process.env.A2A_AGENT_URL ?? 'http://localhost:3100'

export type McpServer = 'person' | 'org'

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
): Promise<T> {
  const token = await getA2ASessionToken()
  if (!token) {
    throw new McpCallError(401, 'No A2A session — connect your agent to access private data')
  }

  const res = await fetch(`${A2A_AGENT_URL}/mcp/${server}/${tool}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(args),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new McpCallError(res.status, err.error ?? `MCP ${server}.${tool} failed: ${res.statusText}`)
  }

  return res.json() as Promise<T>
}
