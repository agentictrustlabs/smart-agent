'use server'

import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { requireSession } from '@/lib/auth/session'
import {
  createRelationship,
  confirmRelationship,
  deploySmartAccount,
  getEdge,
  getEdgesByObject,
  getEdgesBySubject,
  getPublicClient,
  getWalletClient,
} from '@/lib/contracts'
import {
  addAgentController,
  getAgentGenMapData,
  setAgentGenMapData,
  setAgentTemplateId,
} from '@/lib/agent-resolver'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { getAgentMetadata } from '@/lib/agent-metadata'
import { registerAgentMetadata } from '@/lib/actions/agent-metadata.action'
import {
  agentRelationshipAbi,
  ALLIANCE,
  ORGANIZATION_GOVERNANCE,
  ROLE_OWNER,
  ROLE_STRATEGIC_PARTNER,
} from '@smart-agent/sdk'
import { keccak256, encodePacked } from 'viem'

function buildDescription(data: {
  generation: number
  location?: string
  leaderName?: string
}) {
  return `${data.location ? `${data.location} — ` : ''}Generation ${data.generation}${data.leaderName ? `, led by ${data.leaderName}` : ''}`
}

async function revokeAllianceEdgesTo(address: string) {
  const edgeIds = await getEdgesByObject(address as `0x${string}`)
  const walletClient = getWalletClient()
  const publicClient = getPublicClient()
  const relAddr = process.env.AGENT_RELATIONSHIP_ADDRESS as `0x${string}`
  if (!relAddr) return

  for (const edgeId of edgeIds) {
    const edge = await getEdge(edgeId)
    if (edge.relationshipType !== ALLIANCE) continue
    if (edge.status >= 5 || edge.status === 0) continue
    const hash = await walletClient.writeContract({
      address: relAddr,
      abi: agentRelationshipAbi,
      functionName: 'setEdgeStatus',
      args: [edgeId, 5],
    })
    await publicClient.waitForTransactionReceipt({ hash })
  }
}

async function getDirectChildren(address: string): Promise<string[]> {
  const children: string[] = []
  const edgeIds = await getEdgesBySubject(address as `0x${string}`)
  for (const edgeId of edgeIds) {
    const edge = await getEdge(edgeId)
    if (edge.relationshipType !== ALLIANCE) continue
    if (edge.status < 2 || edge.status >= 5) continue
    children.push(edge.object_.toLowerCase())
  }
  return children
}

/**
 * Create a circle as an on-chain org agent plus ALLIANCE relationships.
 */
export async function createGenMapNode(data: {
  networkAddress: string
  parentId: string | null
  generation: number
  name: string
  leaderName?: string
  location?: string
  healthData?: Record<string, unknown>
  startedAt?: string
}) {
  const session = await requireSession()
  const user = await db.select().from(schema.users)
    .where(eq(schema.users.walletAddress, session.walletAddress ?? '')).limit(1)
  if (!user[0]) throw new Error('User not found')

  const ownerAddress = session.walletAddress as `0x${string}`
  const saltHash = keccak256(
    encodePacked(
      ['string', 'address', 'string'],
      ['genmap', ownerAddress, `${data.name.trim()}-${Date.now()}`],
    ),
  )
  const salt = BigInt(saltHash)
  const orgAddress = await deploySmartAccount(ownerAddress, salt)
  const metadata = {
    ...data.healthData,
    generation: data.generation,
    leaderName: data.leaderName,
    location: data.location,
    startedAt: data.startedAt ?? new Date().toISOString().split('T')[0],
    circleStatus: 'active',
  }

  await registerAgentMetadata({
    agentAddress: orgAddress,
    displayName: data.name,
    description: buildDescription({
      generation: data.generation,
      location: data.location,
      leaderName: data.leaderName,
    }),
    agentType: 'org',
  })
  await addAgentController(orgAddress, ownerAddress)
  await setAgentTemplateId(orgAddress, 'local-group')
  await setAgentGenMapData(orgAddress, metadata)

  const parentOrgAddress = (data.parentId || data.networkAddress).toLowerCase()

  try {
    const edgeId = await createRelationship({
      subject: parentOrgAddress as `0x${string}`,
      object: orgAddress as `0x${string}`,
      roles: [ROLE_STRATEGIC_PARTNER],
      relationshipType: ALLIANCE,
    })
    await confirmRelationship(edgeId)
  } catch { /* ignored */ }

  // 3. Create person→circle ownership edge
  const personAgent = await getPersonAgentForUser(user[0].id)
  if (personAgent) {
    try {
      const edgeId = await createRelationship({
        subject: personAgent as `0x${string}`,
        object: orgAddress as `0x${string}`,
        roles: [ROLE_OWNER],
        relationshipType: ORGANIZATION_GOVERNANCE,
      })
      await confirmRelationship(edgeId)
    } catch { /* ignored */ }
  }

  return { id: orgAddress.toLowerCase(), orgAddress }
}

/**
 * Update a circle through resolver metadata.
 */
export async function updateGenMapNode(data: {
  id: string
  name?: string
  leaderName?: string
  location?: string
  healthData?: Record<string, unknown>
  status?: 'active' | 'inactive' | 'multiplied' | 'closed'
}) {
  await requireSession()
  const currentMeta = await getAgentMetadata(data.id)
  const currentData = await getAgentGenMapData(data.id) ?? {}
  const mergedData = {
    ...currentData,
    ...(data.healthData ?? {}),
    leaderName: data.leaderName ?? currentData.leaderName,
    location: data.location ?? currentData.location,
    circleStatus: data.status ?? currentData.circleStatus ?? 'active',
  }

  await registerAgentMetadata({
    agentAddress: data.id,
    displayName: data.name ?? currentMeta.displayName,
    description: buildDescription({
      generation: Number(currentData.generation ?? 0),
      location: String(mergedData.location ?? ''),
      leaderName: typeof mergedData.leaderName === 'string' ? mergedData.leaderName : undefined,
    }),
    agentType: 'org',
  })
  await setAgentGenMapData(data.id, mergedData)
}

/**
 * Move a circle by rewiring its incoming ALLIANCE edge.
 */
export async function moveGenMapNode(data: {
  id: string
  newParentId: string | null
  newGeneration: number
  networkAddress: string
}) {
  await requireSession()
  await revokeAllianceEdgesTo(data.id)
  const newParent = (data.newParentId || data.networkAddress).toLowerCase()
  const edgeId = await createRelationship({
    subject: newParent as `0x${string}`,
    object: data.id as `0x${string}`,
    roles: [ROLE_STRATEGIC_PARTNER],
    relationshipType: ALLIANCE,
  })
  await confirmRelationship(edgeId)

  const currentData = await getAgentGenMapData(data.id) ?? {}
  await setAgentGenMapData(data.id, {
    ...currentData,
    generation: data.newGeneration,
  })
}

/**
 * Delete a circle from the active lineage by revoking incoming ALLIANCE edges and marking it closed.
 */
export async function deleteGenMapNode(id: string) {
  await requireSession()

  const toDelete = new Set<string>([id.toLowerCase()])
  const queue = [id.toLowerCase()]
  while (queue.length > 0) {
    const current = queue.shift()!
    for (const child of await getDirectChildren(current)) {
      if (toDelete.has(child)) continue
      toDelete.add(child)
      queue.push(child)
    }
  }

  for (const addr of toDelete) {
    await revokeAllianceEdgesTo(addr)
    const currentData = await getAgentGenMapData(addr) ?? {}
    await setAgentGenMapData(addr, {
      ...currentData,
      circleStatus: 'closed',
    })
  }
}

// ─── Activity actions (kept here for co-location) ───────────────────

export async function deleteActivity(id: string) {
  await requireSession()
  await db.delete(schema.activityLogs).where(eq(schema.activityLogs.id, id))
}

export async function updateActivity(data: {
  id: string; title?: string; description?: string; participants?: number
  location?: string; durationMinutes?: number; activityType?: string
}) {
  await requireSession()
  const updates: Record<string, unknown> = {}
  if (data.title !== undefined) updates.title = data.title
  if (data.description !== undefined) updates.description = data.description
  if (data.participants !== undefined) updates.participants = data.participants
  if (data.location !== undefined) updates.location = data.location
  if (data.durationMinutes !== undefined) updates.durationMinutes = data.durationMinutes
  if (data.activityType !== undefined) updates.activityType = data.activityType
  if (Object.keys(updates).length > 0) {
    await db.update(schema.activityLogs).set(updates).where(eq(schema.activityLogs.id, data.id))
  }
}
