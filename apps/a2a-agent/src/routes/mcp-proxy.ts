import { Hono } from 'hono'
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

const PERSON_MCP_URL = process.env.PERSON_MCP_URL ?? 'http://localhost:3200'
const ORG_MCP_URL = process.env.ORG_MCP_URL ?? 'http://localhost:3400'
const PEOPLE_GROUP_MCP_URL = process.env.PEOPLE_GROUP_MCP_URL ?? 'http://localhost:3300'

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

// Sprint 1 W2.1 — each downstream MCP gets its own MAC key id for the
// a2a→MCP signing hop. Person-mcp's `require-inbound-service-auth.ts`
// rejects unsigned tool calls; the other MCPs do not yet enforce this
// (`macKeyId` is `null` for them and the call goes unsigned, preserving
// the pre-W2.1 behavior). When org-mcp/people-group-mcp adopt the same
// inbound verifier, flip those to their respective `a2a-to-*` keys.
const SERVERS = {
  person:        { url: PERSON_MCP_URL,       audience: 'urn:mcp:server:person'        as const, macKeyId: 'a2a-to-person'        as MacKeyId | null },
  org:           { url: ORG_MCP_URL,          audience: 'urn:mcp:server:org'           as const, macKeyId: null as MacKeyId | null },
  'people-group': { url: PEOPLE_GROUP_MCP_URL, audience: 'urn:mcp:server:people-groups' as const, macKeyId: null as MacKeyId | null },
} as const

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
  const mcpBodyJson = JSON.stringify({ tool: toolName, args: { ...args, token } })
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
mcpProxy.post('/:server/:tool', requireSession, async (c) => {
  const sess = c.get('session')
  const serverKey = c.req.param('server') as ServerKey
  const toolName = c.req.param('tool')

  if (!(serverKey in SERVERS)) {
    return c.json({ error: `Unknown MCP server: ${serverKey}. Use 'person', 'org', or 'people-group'.` }, 400)
  }

  const args = await c.req.json().catch(() => ({}))

  const result = await callMcpTool(sess.accountAddress, serverKey, toolName, args ?? {})
  if (!result.ok) return c.json({ error: result.error }, (result.status ?? 502) as 400 | 401 | 403 | 404 | 500 | 502)
  return c.json(result.data)
})

export { mcpProxy }
