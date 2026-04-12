'use server'

import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { requireSession } from '@/lib/auth/session'

/**
 * Create a circle: org_agent (identity) + metadata (health) + demo_edge (parent relationship) + gen_map_node (cache)
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

  const nodeId = `gen-${randomUUID().slice(0, 8)}`
  const orgAgentId = randomUUID()
  const orgAddress = `0x${randomUUID().replace(/-/g, '').slice(0, 40)}`

  // 1. Create org agent (source of truth for identity + metadata)
  const metadata = data.healthData ? JSON.stringify({
    ...data.healthData,
    generation: data.generation,
    leaderName: data.leaderName,
    location: data.location,
    startedAt: data.startedAt ?? new Date().toISOString().split('T')[0],
    circleStatus: 'active',
  }) : null

  await db.insert(schema.orgAgents).values({
    id: orgAgentId, name: data.name,
    description: `${data.location ? data.location + ' — ' : ''}Generation ${data.generation}${data.leaderName ? ', led by ' + data.leaderName : ''}`,
    metadata,
    createdBy: user[0].id, smartAccountAddress: orgAddress,
    templateId: 'local-group', chainId: 31337,
    salt: '0x' + randomUUID().replace(/-/g, '').slice(0, 8),
    implementationType: 'hybrid', status: 'deployed',
  })

  // 2. Create demo_edge for parent-child ALLIANCE relationship
  // Find parent's org address from gen_map_node or use networkAddress
  let parentOrgAddress = data.networkAddress.toLowerCase()
  if (data.parentId) {
    const parentNode = await db.select().from(schema.genMapNodes)
      .where(eq(schema.genMapNodes.id, data.parentId)).limit(1)
    if (parentNode[0]?.groupAddress) {
      parentOrgAddress = parentNode[0].groupAddress
    }
  }

  try {
    await db.insert(schema.demoEdges).values({
      id: randomUUID(),
      subjectAddress: parentOrgAddress,
      objectAddress: orgAddress.toLowerCase(),
      relationshipType: 'ALLIANCE',
      roles: JSON.stringify(['strategic-partner']),
      status: 'active',
    })
  } catch { /* ignored */ }

  // 3. Create person→circle ownership edge
  const personAgent = await db.select().from(schema.personAgents)
    .where(eq(schema.personAgents.userId, user[0].id)).limit(1)
  if (personAgent[0]) {
    try {
      await db.insert(schema.demoEdges).values({
        id: randomUUID(),
        subjectAddress: personAgent[0].smartAccountAddress.toLowerCase(),
        objectAddress: orgAddress.toLowerCase(),
        relationshipType: 'ORGANIZATION_GOVERNANCE',
        roles: JSON.stringify(['owner']),
        status: 'active',
      })
    } catch { /* ignored */ }
  }

  // 4. Insert gen_map_node (cache for fast tree queries)
  await db.insert(schema.genMapNodes).values({
    id: nodeId, networkAddress: data.networkAddress.toLowerCase(),
    groupAddress: orgAddress.toLowerCase(), parentId: data.parentId,
    generation: data.generation, name: data.name,
    leaderName: data.leaderName ?? null, location: data.location ?? null,
    healthData: data.healthData ? JSON.stringify(data.healthData) : null,
    status: 'active', startedAt: data.startedAt ?? new Date().toISOString().split('T')[0],
  })

  return { id: nodeId, orgAddress }
}

/**
 * Update a circle: sync to org_agent metadata + gen_map_node cache
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

  // Update gen_map_node cache
  const cacheUpdates: Record<string, unknown> = {}
  if (data.name !== undefined) cacheUpdates.name = data.name
  if (data.leaderName !== undefined) cacheUpdates.leaderName = data.leaderName
  if (data.location !== undefined) cacheUpdates.location = data.location
  if (data.healthData !== undefined) cacheUpdates.healthData = JSON.stringify(data.healthData)
  if (data.status !== undefined) cacheUpdates.status = data.status

  if (Object.keys(cacheUpdates).length > 0) {
    await db.update(schema.genMapNodes).set(cacheUpdates).where(eq(schema.genMapNodes.id, data.id))
  }

  // Sync to org_agent (source of truth)
  const node = await db.select().from(schema.genMapNodes).where(eq(schema.genMapNodes.id, data.id)).limit(1)
  if (node[0]?.groupAddress) {
    const orgUpdates: Record<string, unknown> = {}
    if (data.name !== undefined) orgUpdates.name = data.name
    if (data.name !== undefined || data.location !== undefined || data.leaderName !== undefined) {
      const currentNode = node[0]
      orgUpdates.description = `${(data.location ?? currentNode.location) ? (data.location ?? currentNode.location) + ' — ' : ''}Generation ${currentNode.generation}${(data.leaderName ?? currentNode.leaderName) ? ', led by ' + (data.leaderName ?? currentNode.leaderName) : ''}`
    }
    // Update metadata JSON with health data
    if (data.healthData !== undefined || data.leaderName !== undefined || data.location !== undefined || data.status !== undefined) {
      const currentNode = node[0]
      const existingHealth = currentNode.healthData ? JSON.parse(currentNode.healthData) : {}
      orgUpdates.metadata = JSON.stringify({
        ...(data.healthData ?? existingHealth),
        generation: currentNode.generation,
        leaderName: data.leaderName ?? currentNode.leaderName,
        location: data.location ?? currentNode.location,
        circleStatus: data.status ?? currentNode.status,
      })
    }
    if (Object.keys(orgUpdates).length > 0) {
      await db.update(schema.orgAgents).set(orgUpdates)
        .where(eq(schema.orgAgents.smartAccountAddress, node[0].groupAddress))
    }
  }
}

/**
 * Move a circle to a different parent: update demo_edge + gen_map_node cache
 */
export async function moveGenMapNode(data: { id: string; newParentId: string | null; newGeneration: number }) {
  await requireSession()

  const node = await db.select().from(schema.genMapNodes).where(eq(schema.genMapNodes.id, data.id)).limit(1)
  if (!node[0]) return

  // Update the demo_edge — delete old parent ALLIANCE, create new one
  if (node[0].groupAddress) {
    // Delete old parent edge (where this circle is the object)
    try {
      const allEdges = await db.select().from(schema.demoEdges).all()
      const oldEdge = allEdges.find(e => e.objectAddress === node[0].groupAddress && e.relationshipType === 'ALLIANCE')
      if (oldEdge) {
        await db.delete(schema.demoEdges).where(eq(schema.demoEdges.id, oldEdge.id))
      }
    } catch { /* ignored */ }

    // Create new parent edge
    let newParentOrgAddr = node[0].networkAddress
    if (data.newParentId) {
      const parentNode = await db.select().from(schema.genMapNodes).where(eq(schema.genMapNodes.id, data.newParentId)).limit(1)
      if (parentNode[0]?.groupAddress) newParentOrgAddr = parentNode[0].groupAddress
    }

    try {
      await db.insert(schema.demoEdges).values({
        id: randomUUID(),
        subjectAddress: newParentOrgAddr,
        objectAddress: node[0].groupAddress,
        relationshipType: 'ALLIANCE',
        roles: JSON.stringify(['strategic-partner']),
        status: 'active',
      })
    } catch { /* ignored */ }
  }

  // Update gen_map_node cache
  await db.update(schema.genMapNodes)
    .set({ parentId: data.newParentId, generation: data.newGeneration })
    .where(eq(schema.genMapNodes.id, data.id))

  // Recursively update children's generation numbers
  const allNodes = await db.select().from(schema.genMapNodes)
  const updateChildren = async (parentId: string, parentGen: number) => {
    const children = allNodes.filter(n => n.parentId === parentId)
    for (const child of children) {
      const newGen = parentGen + 1
      await db.update(schema.genMapNodes).set({ generation: newGen }).where(eq(schema.genMapNodes.id, child.id))
      // Also update org agent metadata
      if (child.groupAddress) {
        try {
          const org = await db.select().from(schema.orgAgents).where(eq(schema.orgAgents.smartAccountAddress, child.groupAddress)).limit(1)
          if (org[0]?.metadata) {
            const meta = JSON.parse(org[0].metadata)
            meta.generation = newGen
            await db.update(schema.orgAgents).set({ metadata: JSON.stringify(meta) }).where(eq(schema.orgAgents.smartAccountAddress, child.groupAddress))
          }
        } catch { /* ignored */ }
      }
      await updateChildren(child.id, newGen)
    }
  }
  await updateChildren(data.id, data.newGeneration)
}

/**
 * Delete a circle: remove org_agent + demo_edges + gen_map_node cache
 */
export async function deleteGenMapNode(id: string) {
  await requireSession()

  const allNodes = await db.select().from(schema.genMapNodes)
  const toDelete = new Set<string>([id])
  let changed = true
  while (changed) {
    changed = false
    for (const n of allNodes) {
      if (n.parentId && toDelete.has(n.parentId) && !toDelete.has(n.id)) {
        toDelete.add(n.id)
        changed = true
      }
    }
  }

  for (const nid of toDelete) {
    const node = allNodes.find(n => n.id === nid)
    if (node?.groupAddress) {
      // Delete demo_edges referencing this circle
      try {
        const edges = await db.select().from(schema.demoEdges).all()
        for (const e of edges) {
          if (e.subjectAddress === node.groupAddress || e.objectAddress === node.groupAddress) {
            await db.delete(schema.demoEdges).where(eq(schema.demoEdges.id, e.id))
          }
        }
      } catch { /* ignored */ }

      // Soft-delete org agent (mark as failed)
      try {
        await db.update(schema.orgAgents).set({ status: 'failed' }).where(eq(schema.orgAgents.smartAccountAddress, node.groupAddress))
      } catch { /* ignored */ }
    }

    // Delete gen_map_node cache entry
    await db.delete(schema.genMapNodes).where(eq(schema.genMapNodes.id, nid))
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
