/**
 * Host-context middleware (Phase 1 of A2A-first routing).
 *
 * Every non-public route on the A2A agent is host-aware: the agent is
 * identified by the request's `Host` header (e.g. `rich-pedersen.agent.localhost:3100`).
 *
 *   • The `.localhost` TLD resolves all subdomains to 127.0.0.1, so no
 *     DNS / reverse proxy is needed for local development.
 *   • One Hono process serves every agent on a single port; the subdomain
 *     selects which on-chain principal the request is bound to.
 *
 * Resolution order:
 *   1. Strip the port and the configured base suffix (default `agent.localhost`).
 *   2. Look up the resulting slug in the local `handles` table (fast path).
 *   3. Fall back to on-chain reverse: `AgentNameRegistry.owner(namehash("<slug>.agent"))`.
 *      Reverse-resolve the address back to a primary name + agent type via
 *      `AgentAccountResolver`.
 *
 * Routes exempt from host-context enforcement:
 *   - `/health`
 *   - `/.well-known/agent.json`
 *   - `/auth/challenge`, `/auth/verify`
 *   - `/session/init`
 *
 * All other routes return `400 { error: "agent host required" }` when the
 * host header has no resolvable subdomain. No back-compat for bare-port
 * callers; the user has opted out of compatibility.
 */

import { createMiddleware } from 'hono/factory'
import { createPublicClient, http } from 'viem'
import { localhost } from 'viem/chains'
import { eq } from 'drizzle-orm'
import {
  agentNameRegistryAbi,
  agentAccountResolverAbi,
  namehash,
  AGENT_TLD,
  ATL_PRIMARY_NAME,
  TYPE_PERSON,
  TYPE_ORGANIZATION,
  TYPE_AI_AGENT,
  TYPE_HUB,
} from '@smart-agent/sdk'
import { db } from '../db'
import { handles } from '../db/schema'
import { config } from '../config'

// ─── Hono context augmentation ───────────────────────────────────────

export interface AgentHostContext {
  slug: string
  agentAddress: `0x${string}`
  agentType: 'person' | 'org' | 'ai' | 'hub' | 'unknown'
  displayName: string
}

declare module 'hono' {
  interface ContextVariableMap {
    agentHostContext?: AgentHostContext
  }
}

// ─── Public-route allow list ─────────────────────────────────────────

// Returns true if the request path doesn't require host context. Anything
// past the strict prefix match (e.g. /auth/challenge/foo) is treated as a
// non-exempt sub-path and host-enforced — these surfaces are concrete
// terminal endpoints, not prefixes with children.
// Inter-service HMAC routes — MCPs call these on a2a-agent to redeem
// session delegations on-chain. Authenticated by HMAC, not by user
// session, and have no notion of "which agent" the request is for —
// the session id alone selects the right principal. Host-context
// would only confuse them.
const INTER_SERVICE_PATH_SUFFIXES = [
  '/redeem-via-account',
  '/deploy-agent',
]

// System-scoped prefixes (NOT bound to any agent slug). The session-store
// passthrough mirrors a system-level table; wallet-action dispatch is
// per-session, not per-agent. Without these exempts, the host-context
// middleware rejects every call as `agent host required` (which is what
// the reviewer found — the docs claimed exemption, the code never
// implemented it). Use strict prefix matching (NOT regex) so it's
// obvious what's allowed.
const SYSTEM_SCOPED_PREFIXES = [
  '/session-store/',  // session-store CRUD — system table, no agent binding
  '/wallet-action/',  // WalletAction dispatch — per-session, system-scoped
  // hub-mcp proxy — boot-seed, kb-sync, and per-pool sync hit this from
  // web without an A2A session cookie and (when the call is from a
  // server action) often without a `system.<base>` host header either.
  // The downstream signature (a2a-to-hub MAC verified by hub-mcp) is
  // the trust boundary; host-context has nothing useful to bind here.
  '/mcp/hub/',
]

export function isHostExempt(path: string): boolean {
  if (
    path === '/health' ||
    path === '/.well-known/agent.json' ||
    path === '/auth/challenge' ||
    path === '/auth/verify' ||
    path === '/session/init' ||
    // /session/package carries WebAuthn assertions + caveat blobs; the
    // session is keyed by session-id, not by any agent slug. Already
    // exempt prior to the P0-2 fix per memory note.
    path === '/session/package' ||
    // Spec 007 Phase B — hybrid session bootstrap is session-id-keyed
    // and not agent-bound (the session covers a scope of actions, not
    // an agent slug). Both the init handshake (returns signing payload
    // or userOp) and the finalize handshake (consumes the signed
    // payload, activates the session) are host-exempt.
    path === '/session/hybrid-init' ||
    path === '/session/hybrid-finalize'
  ) return true
  for (const prefix of SYSTEM_SCOPED_PREFIXES) {
    if (path.startsWith(prefix)) return true
  }
  // /session/<id>/<inter-service-verb>
  if (path.startsWith('/session/')) {
    for (const suffix of INTER_SERVICE_PATH_SUFFIXES) {
      if (path.endsWith(suffix)) return true
    }
  }
  return false
}

// ─── Host parsing ────────────────────────────────────────────────────

interface ParsedHost {
  slug: string | null
  hostBase: string
}

function parseHost(rawHost: string | undefined, hostBase: string): ParsedHost {
  if (!rawHost) return { slug: null, hostBase }
  // Strip port.
  const host = rawHost.split(':')[0].toLowerCase()
  // Strip base suffix (no port).
  const baseNoPort = hostBase.split(':')[0].toLowerCase()
  if (!host.endsWith('.' + baseNoPort)) return { slug: null, hostBase }
  const slug = host.slice(0, host.length - baseNoPort.length - 1)
  if (!slug || slug.includes('.')) return { slug: null, hostBase }
  // Slug must be a valid label.
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slug)) return { slug: null, hostBase }
  return { slug, hostBase }
}

// ─── Resolvers (cached in-memory; refresh on miss) ───────────────────

interface CachedAgent {
  address: `0x${string}`
  agentType: 'person' | 'org' | 'ai' | 'hub' | 'unknown'
  displayName: string
}

const slugCache = new Map<string, CachedAgent>()

function getChain() {
  return { ...localhost, id: config.CHAIN_ID }
}

function publicClient() {
  return createPublicClient({ chain: getChain(), transport: http(config.RPC_URL) })
}

function agentTypeFromHash(t: `0x${string}` | undefined): CachedAgent['agentType'] {
  if (!t) return 'unknown'
  if (t === TYPE_PERSON) return 'person'
  if (t === TYPE_ORGANIZATION) return 'org'
  if (t === TYPE_AI_AGENT) return 'ai'
  if (t === TYPE_HUB) return 'hub'
  return 'unknown'
}

async function resolveSlugViaDb(slug: string): Promise<CachedAgent | null> {
  try {
    const rows = await db.select().from(handles).where(eq(handles.handle, slug)).limit(1)
    const row = rows[0]
    if (!row) return null
    return {
      address: row.accountAddress as `0x${string}`,
      agentType: row.agentType === 'person' ? 'person'
        : row.agentType === 'org' ? 'org'
        : row.agentType === 'ai' ? 'ai'
        : 'unknown',
      displayName: row.handle,
    }
  } catch { return null }
}

async function resolveSlugOnChain(slug: string): Promise<CachedAgent | null> {
  // Two on-chain name systems can produce a slug:
  //   (a) AgentNameRegistry — DNS-style; the catalyst seed registers
  //       top-level names like `catalyst.agent` but does NOT seed every
  //       individual agent.
  //   (b) AgentAccountResolver — per-agent `ATL_PRIMARY_NAME` property
  //       set by `generate-wallet` for every demo user and by the
  //       catalyst seed's `register()` helper for orgs/hubs.
  // We try (a) first (cheap point read), then fall back to (b) which
  // requires iterating registered agents. Both results are cached in
  // memory so the iteration cost is amortized.
  const registryAddr = process.env.AGENT_NAME_REGISTRY_ADDRESS as `0x${string}` | undefined
  const resolverAddr = config.AGENT_ACCOUNT_RESOLVER_ADDRESS
  const client = publicClient()

  // ── (a) AgentNameRegistry lookup ─────────────────────────────────
  if (registryAddr && registryAddr !== '0x0000000000000000000000000000000000000000') {
    try {
      const fqn = `${slug}.${AGENT_TLD}`
      const node = namehash(fqn)
      const exists = await client.readContract({
        address: registryAddr, abi: agentNameRegistryAbi,
        functionName: 'recordExists', args: [node],
      }) as boolean
      if (exists) {
        const owner = await client.readContract({
          address: registryAddr, abi: agentNameRegistryAbi,
          functionName: 'owner', args: [node],
        }) as `0x${string}`
        if (owner && owner !== '0x0000000000000000000000000000000000000000') {
          let agentType: CachedAgent['agentType'] = 'unknown'
          let displayName = slug
          if (resolverAddr && resolverAddr !== '0x0000000000000000000000000000000000000000') {
            try {
              const core = await client.readContract({
                address: resolverAddr, abi: agentAccountResolverAbi,
                functionName: 'getCore', args: [owner],
              }) as { agentType: `0x${string}` }
              agentType = agentTypeFromHash(core.agentType)
            } catch { /* not registered as agent — leave 'unknown' */ }
            try {
              const primary = await client.readContract({
                address: resolverAddr, abi: agentAccountResolverAbi,
                functionName: 'getStringProperty',
                args: [owner, ATL_PRIMARY_NAME as `0x${string}`],
              }) as string
              if (primary) displayName = primary
            } catch { /* keep slug */ }
          }
          return { address: owner, agentType, displayName }
        }
      }
    } catch { /* fall through to (b) */ }
  }

  // ── (b) AgentAccountResolver reverse lookup ──────────────────────
  // Iterate enumerated agents, find one whose `ATL_PRIMARY_NAME` slug
  // equals our requested slug. O(n) but cached per slug.
  if (!resolverAddr || resolverAddr === '0x0000000000000000000000000000000000000000') return null
  try {
    const count = await client.readContract({
      address: resolverAddr, abi: agentAccountResolverAbi,
      functionName: 'agentCount',
    }) as bigint
    const wantedSuffix = `.${AGENT_TLD}`
    for (let i = 0n; i < count; i++) {
      let addr: `0x${string}`
      try {
        addr = await client.readContract({
          address: resolverAddr, abi: agentAccountResolverAbi,
          functionName: 'getAgentAt', args: [i],
        }) as `0x${string}`
      } catch { continue }
      let primary = ''
      try {
        primary = await client.readContract({
          address: resolverAddr, abi: agentAccountResolverAbi,
          functionName: 'getStringProperty',
          args: [addr, ATL_PRIMARY_NAME as `0x${string}`],
        }) as string
      } catch { continue }
      if (!primary) continue
      const candidateSlug = primary.endsWith(wantedSuffix)
        ? primary.slice(0, primary.length - wantedSuffix.length)
        : primary
      if (candidateSlug !== slug) continue
      let agentType: CachedAgent['agentType'] = 'unknown'
      let displayName = primary
      try {
        const core = await client.readContract({
          address: resolverAddr, abi: agentAccountResolverAbi,
          functionName: 'getCore', args: [addr],
        }) as { agentType: `0x${string}` }
        agentType = agentTypeFromHash(core.agentType)
      } catch { /* ignore */ }
      return { address: addr, agentType, displayName }
    }
  } catch { /* fall through */ }
  return null
}

/** Special system-level slug used by hub-mcp (KB reads + sync). The
 *  `/mcp/hub/*` proxy route does NOT enforce per-user session — see
 *  `routes/mcp-proxy.ts` for the bypass — but we still need the
 *  host-context middleware to accept the host so the request reaches
 *  the route. We synthesize a zero-address "system" agent here. */
const SYSTEM_SLUG = 'system'

async function resolveSlug(slug: string): Promise<CachedAgent | null> {
  if (slug === SYSTEM_SLUG) {
    return {
      address: '0x0000000000000000000000000000000000000000',
      agentType: 'unknown',
      displayName: 'Smart Agent System Hub',
    }
  }
  const cached = slugCache.get(slug)
  if (cached) return cached
  const dbHit = await resolveSlugViaDb(slug)
  if (dbHit) {
    slugCache.set(slug, dbHit)
    return dbHit
  }
  const chainHit = await resolveSlugOnChain(slug)
  if (chainHit) {
    slugCache.set(slug, chainHit)
    return chainHit
  }
  return null
}

// ─── Middleware factory ──────────────────────────────────────────────

export const hostContext = createMiddleware(async (c, next) => {
  const path = new URL(c.req.url).pathname
  const exempt = isHostExempt(path)

  const rawHost = c.req.header('Host') ?? c.req.header('host')
  const { slug } = parseHost(rawHost, config.A2A_HOST_BASE)

  if (slug) {
    const agent = await resolveSlug(slug)
    if (agent) {
      c.set('agentHostContext', {
        slug,
        agentAddress: agent.address,
        agentType: agent.agentType,
        displayName: agent.displayName,
      })
    } else if (!exempt) {
      // Slug shape was valid but doesn't resolve to a known agent. We
      // surface a distinct error so the caller can tell "unknown agent"
      // from "missing subdomain".
      return c.json({ error: 'agent host required', detail: `slug "${slug}" not registered` }, 400)
    }
  } else if (!exempt) {
    return c.json({ error: 'agent host required' }, 400)
  }

  await next()
})

// Test / fresh-start convenience: clear the in-memory slug cache.
export function _resetHostContextCache() {
  slugCache.clear()
}
