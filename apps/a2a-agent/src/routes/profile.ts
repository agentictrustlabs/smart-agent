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

/**
 * Mint a delegation token for this session, then call person-mcp.
 */
async function callMcpTool(
  accountAddress: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  // Find active session with package
  const rows = await db.select().from(sessions)
    .where(eq(sessions.accountAddress, accountAddress))
  const active = rows.find(r => r.encryptedPackage && r.iv && r.status === 'active')

  if (!active) return { ok: false, error: 'No active agent session' }
  if (new Date(active.expiresAt) < new Date()) return { ok: false, error: 'Session expired' }

  // Decrypt session package
  const pkg = await decryptPayload<StoredSessionPackage>(
    { ciphertext: active.encryptedPackage!, iv: active.iv! },
    config.A2A_SESSION_SECRET,
  )

  // Build + sign delegation token
  const claims: DelegationTokenClaims = {
    v: 1,
    iss: 'smart-agent-a2a',
    aud: 'urn:mcp:server:person',
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

  // Call person-mcp tool with the delegation token
  const mcpRes = await fetch(`${PERSON_MCP_URL}/tools/${toolName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool: toolName, args: { ...args, token } }),
  })

  if (!mcpRes.ok) {
    const err = await mcpRes.json().catch(() => ({ error: mcpRes.statusText }))
    return { ok: false, error: `MCP error: ${err.error ?? mcpRes.statusText}` }
  }

  return { ok: true, data: await mcpRes.json() }
}

const profile = new Hono()

// ─── GET /profile ───────────────────────────────────────────────────
profile.get('/', requireSession, async (c) => {
  const sess = c.get('session')
  const result = await callMcpTool(sess.accountAddress, 'get_profile', {})
  if (!result.ok) return c.json({ error: result.error }, 502)
  return c.json(result.data)
})

// ─── PUT /profile ───────────────────────────────────────────────────
profile.put('/', requireSession, async (c) => {
  const sess = c.get('session')
  const body = await c.req.json()
  const result = await callMcpTool(sess.accountAddress, 'update_profile', body)
  if (!result.ok) return c.json({ error: result.error }, 502)
  return c.json(result.data)
})

export { profile }
