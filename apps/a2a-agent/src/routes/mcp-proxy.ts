import { Hono, type MiddlewareHandler } from 'hono'
import { eq } from 'drizzle-orm'
import { privateKeyToAccount } from 'viem/accounts'
import { mintDelegationToken } from '@smart-agent/sdk'
import type { DelegationTokenClaims } from '@smart-agent/sdk'
import { db } from '../db'
import { sessions } from '../db/schema'
import { config } from '../config'
import { requireSession } from '../middleware/require-session'
import { decryptSessionPackage } from '../auth/encryption'
import { buildOutboundAuthHeaders } from '../auth/sign-outbound'
import type { MacKeyId } from '../auth/mac-provider'
import {
  SERVER_TOOL_ALLOWLIST,
  HUB_TOOLS,
} from './mcp-proxy-allowlist'

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

// Sprint 1 W2.1 / Sprint 4 A.1 / Spec 007 Phase D — each downstream MCP
// gets its own MAC key id for the a2a→MCP signing hop. Person-mcp,
// org-mcp, and (Phase D) people-group-mcp all enforce inbound HMAC
// envelopes via `require-inbound-service-auth.ts`. The remaining MCPs
// (family, geo, verifier, skill) have the verifier file in place but
// don't yet expose `/tools/*` surfaces, so the proxy entry is not wired
// for them. When those MCPs grow a `/tools/*` surface, add the entry
// here and set `allowedTools` to the matching set in
// `mcp-proxy-allowlist.ts`.
interface ServerConfig {
  url: string
  audience: 'urn:mcp:server:person' | 'urn:mcp:server:org' | 'urn:mcp:server:people-groups'
  macKeyId: MacKeyId | null
  allowedTools: Set<string>
}

const SERVERS: Record<string, ServerConfig> = {
  person: {
    url: PERSON_MCP_URL,
    audience: 'urn:mcp:server:person',
    macKeyId: 'a2a-to-person',
    allowedTools: SERVER_TOOL_ALLOWLIST.person,
  },
  org: {
    url: ORG_MCP_URL,
    audience: 'urn:mcp:server:org',
    macKeyId: 'a2a-to-org',
    allowedTools: SERVER_TOOL_ALLOWLIST.org,
  },
  'people-group': {
    url: PEOPLE_GROUP_MCP_URL,
    audience: 'urn:mcp:server:people-groups',
    macKeyId: 'a2a-to-people-group',
    allowedTools: SERVER_TOOL_ALLOWLIST['people-group'],
  },
} as const

type ServerKey = keyof typeof SERVERS

// ─── Spec 007 Phase E — production kill-switch + guard ────────────────
// In production, the generic catch-all proxy MUST have an explicit
// policy. `DISABLE_GENERIC_MCP_PROXY=true` makes every catch-all route
// return 503 (incident-response posture). `=false` keeps the proxy
// open. Unset in production is fail-loud: the agent throws at module
// load so an operator notices.
function genericProxyDisabled(): boolean {
  return process.env.DISABLE_GENERIC_MCP_PROXY === 'true'
}

/**
 * Validate the proxy kill-switch env at startup. Pure function so the
 * guard is testable without spawning a process or importing the rest of
 * the proxy module. Called once at module load below.
 *
 * @throws if NODE_ENV='production' and DISABLE_GENERIC_MCP_PROXY is not
 *   exactly 'true' or 'false'.
 */
export function assertGenericProxyPolicy(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV !== 'production') return
  const flag = env.DISABLE_GENERIC_MCP_PROXY
  if (flag !== 'true' && flag !== 'false') {
    throw new Error(
      "DISABLE_GENERIC_MCP_PROXY must be explicitly set to 'true' or 'false' in production " +
        '(Spec 007 Phase E). No silent default.',
    )
  }
}

assertGenericProxyPolicy(process.env)

/**
 * Mint a delegation token for the given audience and call the MCP server's
 * /tools/<toolName> endpoint with the user's signed delegation embedded.
 *
 * This is the generic path that web actions use to invoke any MCP tool
 * (person-mcp or org-mcp) without each route needing its own delegation
 * minting code. The route registers as /mcp/:server/:tool — see below.
 */
async function callMcpTool(
  accountAddress: string,
  serverKey: ServerKey,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; status?: number; data?: unknown; error?: string }> {
  const server = SERVERS[serverKey]
  if (!server) return { ok: false, error: `Unknown MCP server: ${serverKey}` }

  const rows = await db.select().from(sessions).where(eq(sessions.accountAddress, accountAddress))
  const active = rows.find(r => r.encryptedPackage && r.iv && r.status === 'active')
  if (!active) return { ok: false, status: 401, error: 'No active agent session' }
  if (new Date(active.expiresAt) < new Date()) return { ok: false, status: 401, error: 'Session expired' }

  // Decrypt via the KMS-aware helper. AAD trip-wires on both the KMS
  // provider's aadContext and the AES-GCM additionalData — any drift in
  // (id, account, chain, expiresAt, keyVersion) throws.
  const pkg = await decryptSessionPackage<StoredSessionPackage>(
    {
      encryptedPackage: active.encryptedPackage,
      iv: active.iv,
      encryptedDataKey: active.encryptedDataKey,
      keyVersion: active.keyVersion,
      kmsKeyId: active.kmsKeyId,
    },
    {
      sessionId: active.id,
      accountAddress: active.accountAddress,
      chainId: config.CHAIN_ID,
      expiresAt: active.expiresAt,
    },
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

  const mcpPath = `/tools/${toolName}`
  // Inject _a2aSessionId so MCP tools that route on-chain redemption + deploy
  // calls back through this a2a-agent's /session/<id>/* endpoints can find
  // their session. Several org-mcp tools call requireA2aSessionId(args)
  // and throw if absent — see apps/org-mcp/src/tools/{pools,rounds,
  // proposal_registry,commitment,agent_deploy,agent_resolver}.ts and
  // apps/person-mcp/src/tools/relationship.ts.
  const mcpBodyJson = JSON.stringify({
    tool: toolName,
    args: { ...args, token, _a2aSessionId: active.id },
  })
  const authHeaders = server.macKeyId
    ? await buildOutboundAuthHeaders(server.macKeyId, mcpPath, mcpBodyJson)
    : {}
  const mcpRes = await fetch(`${server.url}${mcpPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
    body: mcpBodyJson,
  })

  if (!mcpRes.ok) {
    const err = await mcpRes.json().catch(() => ({ error: mcpRes.statusText }))
    return { ok: false, status: mcpRes.status, error: `MCP error: ${err.error ?? mcpRes.statusText}` }
  }

  return { ok: true, data: await mcpRes.json() }
}

const mcpProxy = new Hono()

/**
 * POST /mcp/hub/:tool — system-level hub-mcp gateway (#132 bypass).
 *
 * Hub-mcp serves cached KB reads + GraphDB sync writes and does NOT run
 * on behalf of any user, so this route does NOT enforce per-user session
 * binding. The trust boundary is the `a2a-to-hub` MAC envelope verified
 * downstream by hub-mcp's `requireInboundServiceAuth`. The host-context
 * middleware already exempts `/mcp/hub/*` (see
 * `apps/a2a-agent/src/middleware/host-context.ts`).
 *
 * Body is forwarded VERBATIM to hub-mcp's `/tools/<toolName>` endpoint;
 * no delegation token is injected (hub-mcp tools don't redeem against a
 * user account). The downstream MAC binds path + body-hash, so any
 * tamper in transit fails closed.
 *
 * Phase E hardening: tool name is checked against the `HUB_TOOLS`
 * allowlist before forwarding; unknown tools return 404. The kill-switch
 * applies here too — `DISABLE_GENERIC_MCP_PROXY=true` returns 503.
 */
mcpProxy.post('/hub/:tool', async (c) => {
  if (genericProxyDisabled()) {
    return c.json(
      { error: 'generic MCP proxy disabled in production; use dedicated dispatch routes' },
      503,
    )
  }
  const toolName = c.req.param('tool')
  if (!HUB_TOOLS.has(toolName)) {
    return c.json({ error: `Unknown hub tool: ${toolName}` }, 404)
  }
  const bodyRaw = await c.req.text()
  const mcpPath = `/tools/${toolName}`
  const authHeaders = await buildOutboundAuthHeaders('a2a-to-hub', mcpPath, bodyRaw)
  const upstream = await fetch(`${HUB_MCP_URL}${mcpPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
    body: bodyRaw,
  })
  const upstreamBody = await upstream.text()
  // Re-emit upstream content-type if it parses as JSON so callers see the
  // structured shape they expect; fall through to text otherwise.
  try {
    return c.json(JSON.parse(upstreamBody), upstream.status as 200 | 400 | 401 | 403 | 404 | 500 | 502)
  } catch {
    return c.text(upstreamBody, upstream.status as 200 | 400 | 401 | 403 | 404 | 500 | 502)
  }
})

/**
 * POST /mcp/:server/:tool — generic MCP tool proxy.
 *
 *   :server is "person", "org", or "people-group"
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
 *
 * Spec 007 Phase E hardening:
 *   - Tool name is validated against `SERVERS[serverKey].allowedTools`
 *     BEFORE forwarding; unknown tools return 404.
 *   - `DISABLE_GENERIC_MCP_PROXY=true` short-circuits to 503 (incident
 *     response). Production requires an explicit value (guard at module
 *     load above).
 */
// Kill-switch middleware runs BEFORE requireSession so an incident
// responder flipping the flag terminates traffic without needing a
// valid session cookie on the inspection request.
const killSwitch: MiddlewareHandler = async (c, next) => {
  if (genericProxyDisabled()) {
    return c.json(
      { error: 'generic MCP proxy disabled in production; use dedicated dispatch routes' },
      503,
    )
  }
  await next()
}

mcpProxy.post('/:server/:tool', killSwitch, requireSession, async (c) => {
  const sess = c.get('session')
  const serverKey = c.req.param('server') as ServerKey
  const toolName = c.req.param('tool')

  if (!(serverKey in SERVERS)) {
    return c.json({ error: `Unknown MCP server: ${serverKey}. Use 'person', 'org', or 'people-group'.` }, 400)
  }

  // Phase E — per-tool allowlist. Reject before forwarding.
  const server = SERVERS[serverKey]
  if (!server.allowedTools.has(toolName)) {
    return c.json({ error: `Unknown tool: ${serverKey}/${toolName}` }, 404)
  }

  const args = await c.req.json().catch(() => ({}))

  const result = await callMcpTool(sess.accountAddress, serverKey, toolName, args ?? {})
  if (!result.ok) return c.json({ error: result.error }, (result.status ?? 502) as 400 | 401 | 403 | 404 | 500 | 502)
  return c.json(result.data)
})

export { mcpProxy }
