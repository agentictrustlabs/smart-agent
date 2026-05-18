/**
 * `a2aFetch` — fetch wrapper that always connects to the local A2A
 * agent at 127.0.0.1:<port> regardless of the URL's hostname. Use this
 * for any request whose URL embeds an agent slug like
 * `http://<slug>.agent.localhost:3100/...` — Node's getaddrinfo can't
 * resolve `*.localhost` subdomains, so we override the connection
 * target via an undici dispatcher while keeping the URL (and therefore
 * the Host header that A2A's host-context middleware reads) intact.
 *
 * Server-only — undici is Node's built-in fetch transport.
 */

import 'server-only'
import { Agent, fetch as undiciFetch } from 'undici'
import { CORRELATION_HEADER, newCorrelationId } from '../audit/correlation-id'

// Re-export so callers can build the header manually when needed.
export { CORRELATION_HEADER } from '../audit/correlation-id'

const a2aPort = (() => {
  const base = process.env.NEXT_PUBLIC_A2A_HOST_BASE ?? 'agent.localhost:3100'
  return base.includes(':') ? parseInt(base.split(':')[1], 10) || 3100 : 3100
})()

// Always connect to 127.0.0.1:<port> — the agent slug in the URL is
// informational + drives the Host header; the wire connection is
// loopback. Undici calls `lookup` with `{ all: true }`, so the
// callback returns an array of `{address, family}` records — NOT the
// single-tuple form that bare `dns.lookup` uses.
type AllLookupCb = (
  err: Error | null,
  records: Array<{ address: string; family: number }>,
) => void
type SingleLookupCb = (err: Error | null, address: string, family: number) => void

const lookupLoopback = (
  _hostname: string,
  options: { all?: boolean } | undefined,
  cb: AllLookupCb | SingleLookupCb,
): void => {
  if (options && options.all) {
    (cb as AllLookupCb)(null, [{ address: '127.0.0.1', family: 4 }])
  } else {
    (cb as SingleLookupCb)(null, '127.0.0.1', 4)
  }
}

const a2aAgent = new Agent({
  connect: { lookup: lookupLoopback as unknown as undefined },
})

export async function a2aFetch(url: string, init?: Parameters<typeof undiciFetch>[1]) {
  // The URL's hostname might be `<slug>.agent.localhost:3100` (with a
  // port in the host part — invalid for URL parsing). Normalize: drop
  // the port from the path-string host but keep our dispatcher pinned
  // to the right port.
  const norm = url.replace(/(\.agent\.localhost):\d+/, '$1')
  // Force the URL onto the right port so fetch builds the right Host
  // header (Host: <slug>.agent.localhost:<port>).
  const final = norm.replace(/(\.agent\.localhost)/, `$1:${a2aPort}`)

  // Hardening Phase 1D — always thread a correlation id through so the
  // a2a-side audit row (and any downstream MCP / chain step) can be
  // joined back to this user-facing action. If the caller already set
  // the header (e.g. from a Next.js request scope), preserve it; else
  // generate a fresh one.
  const headers = new Headers(init?.headers as HeadersInit | undefined)
  if (!headers.has(CORRELATION_HEADER)) {
    headers.set(CORRELATION_HEADER, newCorrelationId())
  }

  return undiciFetch(final, { ...init, headers, dispatcher: a2aAgent })
}
