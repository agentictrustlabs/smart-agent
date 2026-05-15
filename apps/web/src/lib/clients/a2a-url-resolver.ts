/**
 * Phase 2 of A2A-first routing — agent-scoped A2A URL resolution.
 *
 * Every request the web tier makes to the A2A agent is bound to a
 * concrete agent principal. The A2A process listens on a single port
 * (default 3100) and dispatches on the `Host` header subdomain, e.g.
 * `rich-pedersen.agent.localhost:3100`. This module turns an agent
 * address or slug into the right base URL and provides the `Host` header
 * override needed when fetch() can't be trusted to resolve the subdomain
 * (Node's fetch resolves `*.localhost` to 127.0.0.1 but we set Host
 * explicitly to keep it deterministic and tooling-friendly).
 *
 * Slug discovery is on-chain: the resolver reads `ATL_PRIMARY_NAME` from
 * `AgentAccountResolver` for the address and uses the leftmost label as
 * the slug. Results are cached in-process (per-Node-instance) and refresh
 * on miss.
 *
 * Failure mode: when no slug can be resolved for an address, the helper
 * throws `A2AUrlResolverError` — there is intentionally no fallback to
 * the legacy `A2A_AGENT_URL`. The user has opted out of back-compat.
 */

import 'server-only'
import { getPublicClient } from '@/lib/contracts'
import { agentAccountResolverAbi, ATL_PRIMARY_NAME, AGENT_TLD } from '@smart-agent/sdk'
import { getSession } from '@/lib/auth/session'
import { getPersonAgentForUser } from '@/lib/agent-registry'

// ─── Errors ─────────────────────────────────────────────────────────

export class A2AUrlResolverError extends Error {
  constructor(public readonly code:
    | 'no-resolver-address'
    | 'no-primary-name'
    | 'no-current-user'
    | 'no-person-agent',
    message: string,
  ) {
    super(message)
    this.name = 'A2AUrlResolverError'
  }
}

// ─── Config ─────────────────────────────────────────────────────────

function hostBase(): string {
  return process.env.NEXT_PUBLIC_A2A_HOST_BASE ?? 'agent.localhost:3100'
}

function resolverAddress(): `0x${string}` | null {
  const v = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS
  if (!v) return null
  if (v === '0x0000000000000000000000000000000000000000') return null
  return v as `0x${string}`
}

// ─── Slug shape ─────────────────────────────────────────────────────

// Slug-shaped strings: a single DNS label (no dots). Anything that looks
// like a full hex address or contains a dot is NOT a slug.
function isSlugShaped(s: string): boolean {
  if (!s) return false
  if (s.startsWith('0x')) return false
  if (s.includes('.')) return false
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(s.toLowerCase())
}

function isHexAddress(s: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(s)
}

// Take a primary name like `rich-pedersen.fortcollins.catalyst.agent`
// and return the leftmost label as the slug.
function slugFromPrimaryName(primary: string): string | null {
  if (!primary) return null
  const labels = primary.toLowerCase().split('.').filter(Boolean)
  if (labels.length === 0) return null
  // Drop the TLD if present.
  if (labels[labels.length - 1] === AGENT_TLD) labels.pop()
  if (labels.length === 0) return null
  const slug = labels[0]
  return isSlugShaped(slug) ? slug : null
}

// ─── Cache ──────────────────────────────────────────────────────────

const addrToSlug = new Map<string, string>() // lowercased addr → slug

async function resolveSlugForAddress(addr: `0x${string}`): Promise<string> {
  const key = addr.toLowerCase()
  const cached = addrToSlug.get(key)
  if (cached) return cached

  const resolver = resolverAddress()
  if (!resolver) {
    throw new A2AUrlResolverError(
      'no-resolver-address',
      'AGENT_ACCOUNT_RESOLVER_ADDRESS not set — cannot resolve agent slug',
    )
  }

  const client = getPublicClient()
  let primary = ''
  try {
    primary = await client.readContract({
      address: resolver,
      abi: agentAccountResolverAbi,
      functionName: 'getStringProperty',
      args: [addr, ATL_PRIMARY_NAME as `0x${string}`],
    }) as string
  } catch (e) {
    throw new A2AUrlResolverError(
      'no-primary-name',
      `Failed to read ATL_PRIMARY_NAME for ${addr}: ${e instanceof Error ? e.message : String(e)}`,
    )
  }

  const slug = slugFromPrimaryName(primary)
  if (!slug) {
    throw new A2AUrlResolverError(
      'no-primary-name',
      `Agent ${addr} has no primary name registered — cannot route A2A traffic`,
    )
  }

  addrToSlug.set(key, slug)
  return slug
}

// ─── Public API ─────────────────────────────────────────────────────

export interface ResolvedA2AEndpoint {
  /** Absolute base URL including scheme + host + port. */
  endpoint: string
  /** Host header value (with port) for the request — required when fetch()
   *  doesn't reach `<slug>.agent.localhost` correctly. */
  hostHeader: string
  /** The slug that was resolved (for logging / diagnostics). */
  slug: string
}

/**
 * Resolve the A2A endpoint for a given agent. Accepts either:
 *   • a 0x address — reverse-resolved to a slug via the on-chain registry, OR
 *   • a slug-shaped string — used directly without further verification.
 *
 * Throws `A2AUrlResolverError` if no slug can be resolved. No back-compat
 * fallback.
 */
export async function resolveA2AEndpointForAgent(
  addrOrName: string,
): Promise<ResolvedA2AEndpoint> {
  let slug: string
  if (isHexAddress(addrOrName)) {
    slug = await resolveSlugForAddress(addrOrName as `0x${string}`)
  } else if (isSlugShaped(addrOrName)) {
    slug = addrOrName.toLowerCase()
  } else {
    throw new A2AUrlResolverError(
      'no-primary-name',
      `resolveA2AEndpointForAgent: "${addrOrName}" is neither a hex address nor a slug`,
    )
  }

  const base = hostBase()
  // Strip protocol if someone set it; we add it back deterministically.
  const cleanBase = base.replace(/^https?:\/\//, '')
  const hostHeader = `${slug}.${cleanBase}`
  // We keep the slug in the URL so the request URI carries the agent
  // identity end-to-end. Node's fetch can't resolve `*.agent.localhost`
  // via getaddrinfo though, so the actual wire connection uses the
  // undici dispatcher returned by `a2aFetch` (lib/clients/a2a-fetch.ts)
  // which always connects to 127.0.0.1:<port> regardless of the URL
  // host. The A2A host-context middleware reads the URL's Host header
  // to derive the slug — both paths converge there.
  const scheme = process.env.NEXT_PUBLIC_A2A_SCHEME ?? 'http'
  return {
    endpoint: `${scheme}://${hostHeader}`,
    hostHeader,
    slug,
  }
}

/**
 * Resolve the A2A endpoint for the current request's user. The user's
 * person agent address is read via `getPersonAgentForUser`; throws if no
 * session / no person agent exists.
 */
export async function resolveA2AEndpointForCurrentUser(): Promise<ResolvedA2AEndpoint> {
  const session = await getSession()
  if (!session?.userId) {
    throw new A2AUrlResolverError('no-current-user', 'No active user session')
  }
  const personAgent = await getPersonAgentForUser(session.userId)
  if (!personAgent) {
    throw new A2AUrlResolverError(
      'no-person-agent',
      `No person agent found for current user ${session.userId}`,
    )
  }
  return resolveA2AEndpointForAgent(personAgent)
}

// Test / fresh-start helper.
export function _resetA2AUrlCache() {
  addrToSlug.clear()
}
