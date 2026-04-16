import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { createPublicClient, http } from 'viem'
import { localhost } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import {
  decryptPayload, mintDelegationToken,
  agentRelationshipAbi, DATA_ACCESS_DELEGATION,
} from '@smart-agent/sdk'
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

/**
 * Read a cross-principal delegation from an on-chain relationship edge.
 * The full signed delegation is stored in the edge's metadataURI.
 * Any A2A agent can read this — the delegation is self-authenticating.
 */
async function readDelegationFromEdge(
  grantor: string,
  grantee: string,
): Promise<{ delegation: Record<string, unknown> } | { error: string }> {
  const relAddr = config.AGENT_RELATIONSHIP_ADDRESS
  if (!relAddr || relAddr === '0x0000000000000000000000000000000000000000') {
    return { error: 'AGENT_RELATIONSHIP_ADDRESS not configured' }
  }

  const publicClient = createPublicClient({
    chain: { ...localhost, id: config.CHAIN_ID },
    transport: http(config.RPC_URL),
  })

  // Compute edge ID: keccak256(subject, object, relationshipType)
  // subject = grantor (data owner), object = grantee (reader)
  const edgeId = await publicClient.readContract({
    address: relAddr,
    abi: agentRelationshipAbi,
    functionName: 'computeEdgeId',
    args: [grantor as `0x${string}`, grantee as `0x${string}`, DATA_ACCESS_DELEGATION as `0x${string}`],
  }) as `0x${string}`

  // Check if edge exists
  const exists = await publicClient.readContract({
    address: relAddr,
    abi: agentRelationshipAbi,
    functionName: 'edgeExists',
    args: [edgeId],
  }) as boolean

  if (!exists) {
    return { error: 'No data access delegation edge found on-chain' }
  }

  // Read the edge — viem returns named fields matching the ABI struct
  const edge = await publicClient.readContract({
    address: relAddr,
    abi: agentRelationshipAbi,
    functionName: 'getEdge',
    args: [edgeId],
  }) as {
    edgeId: `0x${string}`; subject: `0x${string}`; object_: `0x${string}`
    relationshipType: `0x${string}`; status: number
    createdBy: `0x${string}`; createdAt: bigint; updatedAt: bigint
    metadataURI: string
  }

  const status = Number(edge.status)

  // Reject if not CONFIRMED(2) or ACTIVE(3)
  if (status < 2 || status >= 4) {
    return { error: `Data access delegation edge is not active (status: ${status})` }
  }

  const metadataURI = edge.metadataURI
  if (!metadataURI) {
    return { error: 'Edge has no metadataURI — delegation not stored' }
  }

  // Parse metadataURI — contains { delegation: {...}, delegationHash, grants, expiresAt }
  try {
    const meta = JSON.parse(edge.metadataURI)
    if (!meta.delegation) {
      return { error: 'Edge metadataURI does not contain a delegation' }
    }
    return { delegation: meta.delegation }
  } catch {
    return { error: 'Failed to parse edge metadataURI' }
  }
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

// ─── GET /profile/delegated?target=<addr>&grantee=<addr> ───────────
// Reads the cross-delegation from on-chain (AgentRelationship edge metadataURI).
// Any A2A agent can call this — the delegation is self-authenticating.
profile.get('/delegated', requireSession, async (c) => {
  const sess = c.get('session')
  const targetPrincipal = c.req.query('target')
  const granteeAddr = c.req.query('grantee')
  if (!targetPrincipal) return c.json({ error: 'Missing target query parameter' }, 400)
  if (!granteeAddr) return c.json({ error: 'Missing grantee query parameter' }, 400)

  // Read the signed delegation from the on-chain edge
  const edgeResult = await readDelegationFromEdge(targetPrincipal, granteeAddr)
  if ('error' in edgeResult) {
    return c.json({ error: edgeResult.error }, 404)
  }

  // Call MCP with the cross-delegation from on-chain
  const result = await callMcpTool(sess.accountAddress, 'get_delegated_profile', {
    targetPrincipal,
    crossDelegation: edgeResult.delegation,
  })

  if (!result.ok) return c.json({ error: result.error }, 502)
  return c.json(result.data)
})

export { profile }
