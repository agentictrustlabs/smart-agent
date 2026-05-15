import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { privateKeyToAccount } from 'viem/accounts'
import { decryptPayload, mintDelegationToken } from '@smart-agent/sdk'
import type { DelegationTokenClaims } from '@smart-agent/sdk'
import { db } from '../db'
import { sessions } from '../db/schema'
import { config } from '../config'
import { requireSession } from '../middleware/require-session'

const PERSON_MCP_URL = process.env.PERSON_MCP_URL ?? 'http://localhost:3200'
const ORG_MCP_URL = process.env.ORG_MCP_URL ?? 'http://localhost:3400'
const PEOPLE_GROUP_MCP_URL = process.env.PEOPLE_GROUP_MCP_URL ?? 'http://localhost:3300'
const HUB_MCP_URL = process.env.HUB_MCP_URL ?? 'http://localhost:3900'

interface StoredSessionPackage {
  sessionPrivateKey: string
  sessionKeyAddress: string
  delegation: {
    delegator: string
    delegate: string
    authority: string
    caveats: Array<{ enforcer: string; terms: string }>
    salt: string
    signature: string
  }
  accountAddress: string
  expiresAt: string
}

const SERVERS = {
  person:        { url: PERSON_MCP_URL,       audience: 'urn:mcp:server:person'        as const },
  org:           { url: ORG_MCP_URL,          audience: 'urn:mcp:server:org'           as const },
  'people-group': { url: PEOPLE_GROUP_MCP_URL, audience: 'urn:mcp:server:people-groups' as const },
} as const

// hub-mcp is system-level (no per-user delegation). Routed separately
// below — see the `/hub/:tool` handler that bypasses requireSession.
const HUB_AUDIENCE = 'urn:mcp:server:hub' as const
void HUB_AUDIENCE // reserved for future request-signing if needed

type ServerKey = keyof typeof SERVERS

/**
 * Mint a delegation token for the given audience and call the MCP server's
 * /tools/<toolName> endpoint with the user's signed delegation embedded.
 *
 * This is the generic path that web actions use to invoke any MCP tool
 * (person-mcp or org-mcp) without each route needing its own delegation
 * minting code. The route registers as /mcp/:server/:tool — see below.
 */
async function callMcpTool(
  sessionId: string,
  serverKey: ServerKey,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; status?: number; data?: unknown; error?: string }> {
  const server = SERVERS[serverKey]
  if (!server) return { ok: false, error: `Unknown MCP server: ${serverKey}` }

  // Look up the SPECIFIC session referenced by the bearer token, not any
  // session for the account. Picking the first session by account was the
  // source of "Tool not permitted by delegation scope" after tool-policy
  // updates — the user's old sessions (with stale tool lists) shadowed
  // the freshly-bootstrapped one. Cookie session id is the authoritative
  // identifier; respect it.
  const rows = await db.select().from(sessions).where(eq(sessions.id, sessionId))
  const active = rows[0]
  if (!active || active.status !== 'active' || !active.encryptedPackage || !active.iv) {
    return { ok: false, status: 401, error: 'No active agent session' }
  }
  if (new Date(active.expiresAt) < new Date()) return { ok: false, status: 401, error: 'Session expired' }

  const a2aSessionId = active.id

  const pkg = await decryptPayload<StoredSessionPackage>(
    { ciphertext: active.encryptedPackage!, iv: active.iv! },
    config.A2A_SESSION_SECRET,
  )

  const claims: DelegationTokenClaims = {
    v: 1,
    iss: 'smart-agent-a2a',
    aud: server.audience,
    sub: pkg.accountAddress as `0x${string}`,
    chainId: config.CHAIN_ID,
    delegation: {
      delegator: pkg.delegation.delegator as `0x${string}`,
      delegate: pkg.delegation.delegate as `0x${string}`,
      authority: pkg.delegation.authority as `0x${string}`,
      caveats: pkg.delegation.caveats.map(c => ({
        enforcer: c.enforcer as `0x${string}`,
        terms: c.terms as `0x${string}`,
      })),
      salt: pkg.delegation.salt,
      signature: pkg.delegation.signature as `0x${string}`,
    },
    sessionKeyAddress: pkg.sessionKeyAddress as `0x${string}`,
    issuedAtISO: new Date().toISOString(),
    expiresAtISO: active.expiresAt,
    jti: crypto.randomUUID(),
    usageLimit: 10,
  }

  const sessionAccount = privateKeyToAccount(pkg.sessionPrivateKey as `0x${string}`)
  const { token } = await mintDelegationToken(
    claims,
    async (msg) => sessionAccount.signMessage({ message: msg }),
  )

  // Phase 1: forward the a2a-agent session id so the MCP tool can call back
  // into /session/:id/redeem-tx for on-chain redemption. The MCP must NOT
  // treat _a2aSessionId as user-controlled — it's injected here and the
  // inbound bearer token is already verified above (the rows lookup is
  // keyed by the principal smart-account address derived from the cookie).
  const mcpRes = await fetch(`${server.url}/tools/${toolName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool: toolName, args: { ...args, token, _a2aSessionId: a2aSessionId } }),
  })

  if (!mcpRes.ok) {
    const err = await mcpRes.json().catch(() => ({ error: mcpRes.statusText }))
    return { ok: false, status: mcpRes.status, error: `MCP error: ${err.error ?? mcpRes.statusText}` }
  }

  return { ok: true, data: await mcpRes.json() }
}

const mcpProxy = new Hono()

/**
 * POST /mcp/:server/:tool — generic MCP tool proxy.
 *
 *   :server is "person" or "org"
 *   :tool   is the MCP tool name (e.g. "list_oikos_contacts")
 *
 * Body: any JSON. Forwarded to the MCP tool as `args` with a freshly-minted
 * delegation token attached. The MCP tool extracts the token, verifies it
 * against the session's smart-account ERC-1271, and gates by tool scope.
 *
 * Web app server actions become thin wrappers around this:
 *
 *   await fetch(`${A2A_AGENT_URL}/mcp/person/list_oikos_contacts`, {
 *     method: 'POST',
 *     headers: { Authorization: `Bearer ${cookie}` },
 *     body: JSON.stringify({}),
 *   })
 */
// ── Hub-mcp proxy — system-level, no session required ──────────────
//
// hub-mcp serves public knowledge-base reads (DiscoveryService over
// GraphDB) and on-chain → KB sync writes. It is NOT bound to any
// user's smart account, so we deliberately skip `requireSession` and
// the per-agent host check here. Cache invalidation lives inside
// hub-mcp itself (`sync:*` tools call `cacheInvalidateFamily` after
// successful writes), so the read-after-write fence is preserved.
//
// The host-context middleware allows the `system.<base>` subdomain
// without requiring a slug→agent resolution; that's how web clients
// reach this route (via `callMcp('hub', …)` with Host: system.agent.localhost).
mcpProxy.post('/hub/:tool', async (c) => {
  const toolName = c.req.param('tool')
  const args = await c.req.json().catch(() => ({}))
  try {
    const res = await fetch(`${HUB_MCP_URL}/tools/${toolName}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args ?? {}),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return c.json({ error: `hub-mcp ${toolName} failed: ${res.status} ${body.slice(0, 200)}` }, 502)
    }
    return c.json(await res.json())
  } catch (e) {
    return c.json({ error: `hub-mcp ${toolName} unreachable: ${e instanceof Error ? e.message : String(e)}` }, 502)
  }
})

mcpProxy.post('/:server/:tool', requireSession, async (c) => {
  const sess = c.get('session')
  const serverKey = c.req.param('server') as ServerKey
  const toolName = c.req.param('tool')

  if (!(serverKey in SERVERS)) {
    return c.json({ error: `Unknown MCP server: ${serverKey}. Use 'person', 'org', or 'people-group'.` }, 400)
  }

  const args = await c.req.json().catch(() => ({}))

  const result = await callMcpTool(sess.id, serverKey, toolName, args ?? {})
  if (!result.ok) return c.json({ error: result.error }, (result.status ?? 502) as 400 | 401 | 403 | 404 | 500 | 502)
  return c.json(result.data)
})

export { mcpProxy }
