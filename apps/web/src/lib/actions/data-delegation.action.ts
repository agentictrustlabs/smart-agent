'use server'

import { randomUUID } from 'crypto'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { requireSession } from '@/lib/auth/session'
import { getA2ASessionToken } from '@/lib/actions/a2a-session.action'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { getAgentMetadata } from '@/lib/agent-metadata'
import {
  getPublicClient, getWalletClient,
  createRelationship, confirmRelationship,
  getEdgesBySubject, getEdgesByObject, getEdge,
} from '@/lib/contracts'
import {
  hashDelegation, encodeTimestampTerms, buildCaveat, buildDataScopeCaveat,
  DATA_ACCESS_DELEGATION, ROLE_DATA_GRANTOR, ROLE_DATA_GRANTEE,
  ROOT_AUTHORITY, delegationManagerAbi, agentAccountAbi,
} from '@smart-agent/sdk'
import type { DataScopeGrant } from '@smart-agent/sdk'
import { privateKeyToAccount } from 'viem/accounts'

const A2A_AGENT_URL = process.env.A2A_AGENT_URL ?? 'http://localhost:3100'
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')

// ─── Types ─────────────────────────────────────────────────────────

export interface DataDelegationInfo {
  edgeId: string
  grantor: string
  grantee: string
  grantorName: string
  granteeName: string
  grants: DataScopeGrant[]
  delegationHash: string
  createdAt: string
}

// ─── Query delegations ─────────────────────────────────────────────

/** Get data delegations where other people shared data WITH the current user */
export async function getIncomingDelegations(userId: string): Promise<DataDelegationInfo[]> {
  const personAddr = await getPersonAgentForUser(userId)
  if (!personAddr) return []

  const edgeIds = await getEdgesByObject(personAddr as `0x${string}`)
  const results: DataDelegationInfo[] = []

  for (const edgeId of edgeIds) {
    const edge = await getEdge(edgeId)
    if (edge.relationshipType !== DATA_ACCESS_DELEGATION) continue
    if (edge.status < 2) continue // need at least CONFIRMED

    let grants: DataScopeGrant[] = []
    let delegationHash = ''
    try {
      const meta = JSON.parse(edge.metadataURI)
      grants = meta.grants ?? []
      delegationHash = meta.delegationHash ?? ''
    } catch { /* no metadata */ }

    const grantorMeta = await getAgentMetadata(edge.subject)
    const granteeMeta = await getAgentMetadata(edge.object_)

    results.push({
      edgeId,
      grantor: edge.subject,
      grantee: edge.object_,
      grantorName: grantorMeta.displayName,
      granteeName: granteeMeta.displayName,
      grants,
      delegationHash,
      createdAt: new Date(Number(edge.createdAt) * 1000).toISOString(),
    })
  }
  return results
}

/** Get data delegations where the current user shared data with others */
export async function getOutgoingDelegations(userId: string): Promise<DataDelegationInfo[]> {
  const personAddr = await getPersonAgentForUser(userId)
  if (!personAddr) return []

  const edgeIds = await getEdgesBySubject(personAddr as `0x${string}`)
  const results: DataDelegationInfo[] = []

  for (const edgeId of edgeIds) {
    const edge = await getEdge(edgeId)
    if (edge.relationshipType !== DATA_ACCESS_DELEGATION) continue
    if (edge.status < 2) continue

    let grants: DataScopeGrant[] = []
    let delegationHash = ''
    try {
      const meta = JSON.parse(edge.metadataURI)
      grants = meta.grants ?? []
      delegationHash = meta.delegationHash ?? ''
    } catch { /* no metadata */ }

    const grantorMeta = await getAgentMetadata(edge.subject)
    const granteeMeta = await getAgentMetadata(edge.object_)

    results.push({
      edgeId,
      grantor: edge.subject,
      grantee: edge.object_,
      grantorName: grantorMeta.displayName,
      granteeName: granteeMeta.displayName,
      grants,
      delegationHash,
      createdAt: new Date(Number(edge.createdAt) * 1000).toISOString(),
    })
  }
  return results
}

// ─── Create delegation ─────────────────────────────────────────────

/**
 * Create a data access delegation from the current user to a recipient.
 * - Signs delegation with the user's private key (demo) via DelegationManager
 * - Creates on-chain relationship edge
 * - Stores delegation in A2A agent
 * - Creates notification for the recipient
 */
export async function createDataDelegation(
  recipientPersonAgent: string,
  grants: DataScopeGrant[],
): Promise<{ success: boolean; error?: string }> {
  const session = await requireSession()
  if (!session) return { success: false, error: 'Not authenticated' }

  // Look up current user's person agent and private key
  const users = await db.select().from(schema.users)
    .where(eq(schema.users.did, session.userId)).limit(1)
  const user = users[0]
  if (!user?.privateKey) return { success: false, error: 'No private key (demo users only for now)' }

  const granterPersonAgent = await getPersonAgentForUser(user.id)
  if (!granterPersonAgent) return { success: false, error: 'No person agent found' }

  const delegationManagerAddr = process.env.DELEGATION_MANAGER_ADDRESS as `0x${string}`
  const timestampEnforcerAddr = process.env.TIMESTAMP_ENFORCER_ADDRESS as `0x${string}`
  if (!delegationManagerAddr) return { success: false, error: 'DelegationManager not deployed' }

  // Build delegation: grantor → recipient, 90-day window, with data scope
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + 90 * 24 * 60 * 60 // 90 days
  const salt = BigInt(Date.now() + Math.floor(Math.random() * 100000))

  const caveats = [
    buildCaveat(timestampEnforcerAddr, encodeTimestampTerms(now, expiresAt)),
    buildDataScopeCaveat(grants),
  ]

  const delegation = {
    delegator: granterPersonAgent as `0x${string}`,
    delegate: recipientPersonAgent as `0x${string}`,
    authority: ROOT_AUTHORITY as `0x${string}`,
    caveats,
    salt,
  }

  // Compute delegation hash
  const delHash = hashDelegation(
    { ...delegation, salt: salt.toString() },
    CHAIN_ID,
    delegationManagerAddr,
  )

  // Sign the delegation hash with the user's private key
  const account = privateKeyToAccount(user.privateKey as `0x${string}`)
  const signature = await account.signMessage({ message: { raw: delHash } })

  const signedDelegation = {
    ...delegation,
    salt: salt.toString(),
    signature,
    caveats: caveats.map(c => ({ enforcer: c.enforcer, terms: c.terms })),
  }

  // Store full signed delegation in on-chain edge's metadataURI.
  // Any A2A agent can read this and present it to MCP for verification.
  const metadataURI = JSON.stringify({
    delegation: signedDelegation,
    delegationHash: delHash,
    grants,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
  })

  try {
    const edgeId = await createRelationship({
      subject: granterPersonAgent as `0x${string}`,
      object: recipientPersonAgent as `0x${string}`,
      relationshipType: DATA_ACCESS_DELEGATION as `0x${string}`,
      roles: [ROLE_DATA_GRANTOR as `0x${string}`, ROLE_DATA_GRANTEE as `0x${string}`],
      metadataURI,
    })
    await confirmRelationship(edgeId)
    const { scheduleKbSync } = await import('@/lib/ontology/kb-write-through')
    scheduleKbSync()
  } catch (err) {
    console.warn('[data-delegation] Edge creation failed:', err)
    // Continue — delegation still works without the edge
  }

  // Delegation is stored in the on-chain edge's metadataURI — any A2A agent
  // can read it. No need to store separately in the A2A agent's local DB.

  // Create notification for the recipient
  try {
    // Find the recipient's user ID from their person agent
    const allUsers = await db.select().from(schema.users).all()
    for (const u of allUsers) {
      const pa = await getPersonAgentForUser(u.id)
      if (pa?.toLowerCase() === recipientPersonAgent.toLowerCase()) {
        await db.insert(schema.messages).values({
          id: randomUUID(),
          userId: u.id,
          type: 'data_access_granted',
          title: `${user.name} shared personal data with you`,
          body: `${user.name} has shared their personal information with you. View it in your Data Sharing page.`,
          link: '/catalyst/me/sharing',
        })
        break
      }
    }
  } catch (err) {
    console.warn('[data-delegation] Notification failed:', err)
  }

  return { success: true }
}

// ─── Revoke delegation ─────────────────────────────────────────────

export async function revokeDataDelegation(
  delegationHash: string,
  edgeId: string,
): Promise<{ success: boolean; error?: string }> {
  const session = await requireSession()
  if (!session) return { success: false, error: 'Not authenticated' }

  const walletClient = getWalletClient()
  const publicClient = getPublicClient()
  const delegationManagerAddr = process.env.DELEGATION_MANAGER_ADDRESS as `0x${string}`

  // Revoke on-chain via DelegationManager
  try {
    const hash = await walletClient.writeContract({
      address: delegationManagerAddr,
      abi: delegationManagerAbi,
      functionName: 'revokeDelegation',
      args: [delegationHash as `0x${string}`],
    })
    await publicClient.waitForTransactionReceipt({ hash })
  } catch (err) {
    return { success: false, error: `On-chain revocation failed: ${err instanceof Error ? err.message : String(err)}` }
  }

  // Update edge status to REVOKED (5)
  try {
    const relAddr = process.env.AGENT_RELATIONSHIP_ADDRESS as `0x${string}`
    if (relAddr) {
      const { agentRelationshipAbi } = await import('@smart-agent/sdk')
      const revokeHash = await walletClient.writeContract({
        address: relAddr,
        abi: agentRelationshipAbi,
        functionName: 'setEdgeStatus',
        args: [edgeId as `0x${string}`, 5], // REVOKED
      })
      await publicClient.waitForTransactionReceipt({ hash: revokeHash })
    }
  } catch (err) {
    console.warn('[data-delegation] Edge revocation failed:', err)
  }

  return { success: true }
}

// ─── Revoke relationship with cascade ──────────────────────────────

/**
 * Revoke a relationship edge AND cascade-revoke any associated data delegations.
 * For example, revoking a COACHING_MENTORSHIP edge between David→Ana also
 * revokes the DATA_ACCESS_DELEGATION from Ana→David.
 */
export async function revokeRelationshipWithCascade(
  edgeId: string,
  subject: string,
  object_: string,
): Promise<{ success: boolean; error?: string; revokedDelegations: number }> {
  const session = await requireSession()
  if (!session) return { success: false, error: 'Not authenticated', revokedDelegations: 0 }

  const walletClient = getWalletClient()
  const publicClient = getPublicClient()
  const relAddr = process.env.AGENT_RELATIONSHIP_ADDRESS as `0x${string}`
  const delegationManagerAddr = process.env.DELEGATION_MANAGER_ADDRESS as `0x${string}`

  if (!relAddr) return { success: false, error: 'Relationship contract not configured', revokedDelegations: 0 }

  // 1. Revoke the relationship edge itself
  try {
    const { agentRelationshipAbi } = await import('@smart-agent/sdk')
    const hash = await walletClient.writeContract({
      address: relAddr,
      abi: agentRelationshipAbi,
      functionName: 'setEdgeStatus',
      args: [edgeId as `0x${string}`, 5], // REVOKED
    })
    await publicClient.waitForTransactionReceipt({ hash })
  } catch (err) {
    return { success: false, error: `Relationship revocation failed: ${err instanceof Error ? err.message : String(err)}`, revokedDelegations: 0 }
  }

  // 2. Cascade: find DATA_ACCESS_DELEGATION edges between these principals (both directions)
  let revokedDelegations = 0
  const pairsToCheck = [
    [subject, object_],  // e.g., Ana→David delegation
    [object_, subject],  // e.g., David→Ana delegation (if any)
  ]

  for (const [grantor, grantee] of pairsToCheck) {
    try {
      const { agentRelationshipAbi: relAbi } = await import('@smart-agent/sdk')

      // Compute the DATA_ACCESS_DELEGATION edge ID
      const delEdgeId = await publicClient.readContract({
        address: relAddr,
        abi: relAbi,
        functionName: 'computeEdgeId',
        args: [grantor as `0x${string}`, grantee as `0x${string}`, DATA_ACCESS_DELEGATION as `0x${string}`],
      }) as `0x${string}`

      const exists = await publicClient.readContract({
        address: relAddr, abi: relAbi,
        functionName: 'edgeExists', args: [delEdgeId],
      }) as boolean

      if (!exists) continue

      const edge = await publicClient.readContract({
        address: relAddr, abi: relAbi,
        functionName: 'getEdge', args: [delEdgeId],
      }) as { status: number; metadataURI: string }

      if (edge.status >= 5) continue // already revoked

      // Extract delegation hash from metadataURI
      let delegationHash: string | null = null
      try {
        const meta = JSON.parse(edge.metadataURI)
        delegationHash = meta.delegationHash ?? null
      } catch { /* no metadata */ }

      // Revoke the delegation via DelegationManager
      if (delegationHash && delegationManagerAddr) {
        try {
          const dHash = await walletClient.writeContract({
            address: delegationManagerAddr,
            abi: delegationManagerAbi,
            functionName: 'revokeDelegation',
            args: [delegationHash as `0x${string}`],
          })
          await publicClient.waitForTransactionReceipt({ hash: dHash })
        } catch (err) {
          console.warn('[cascade-revoke] DelegationManager revocation failed:', err)
        }
      }

      // Revoke the delegation edge
      try {
        const eHash = await walletClient.writeContract({
          address: relAddr, abi: relAbi,
          functionName: 'setEdgeStatus',
          args: [delEdgeId, 5],
        })
        await publicClient.waitForTransactionReceipt({ hash: eHash })
        revokedDelegations++
      } catch (err) {
        console.warn('[cascade-revoke] Delegation edge revocation failed:', err)
      }
    } catch (err) {
      console.warn('[cascade-revoke] Cascade check failed for pair:', grantor, grantee, err)
    }
  }

  return { success: true, revokedDelegations }
}

// ─── Load delegated profile ────────────────────────────────────────

export async function loadDelegatedProfile(
  targetPrincipal: string,
): Promise<{ success: boolean; error?: string; profile?: Record<string, unknown>; allowedFields?: string[] }> {
  const session = await requireSession()

  const token = await getA2ASessionToken()
  if (!token) return { success: false, error: 'No A2A session' }

  // Resolve the current user's person agent address (used as grantee in delegations)
  const users = await db.select().from(schema.users)
    .where(eq(schema.users.did, session.userId)).limit(1)
  const user = users[0]
  const myPersonAgent = user ? await getPersonAgentForUser(user.id) : null

  try {
    let url = `${A2A_AGENT_URL}/profile/delegated?target=${encodeURIComponent(targetPrincipal)}`
    if (myPersonAgent) url += `&grantee=${encodeURIComponent(myPersonAgent)}`

    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return { success: false, error: err.error ?? 'Failed to load delegated profile' }
    }

    const data = await res.json()
    return { success: true, profile: data.profile ?? null, allowedFields: data.allowedFields }
  } catch {
    return { success: false, error: 'A2A agent unreachable' }
  }
}
