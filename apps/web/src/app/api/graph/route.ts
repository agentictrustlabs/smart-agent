import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db, schema } from '@/db'
import { getEdgesByObject, getEdge, getEdgeRoles } from '@/lib/contracts'
import { roleName, relationshipTypeName, toDidEthr } from '@smart-agent/sdk'

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')
const STATUS_LABELS = ['none', 'proposed', 'active', 'suspended', 'revoked']

export interface GraphNode {
  id: string
  label: string
  type: 'person' | 'org'
  did: string
  address: string
}

export interface GraphEdge {
  source: string
  target: string
  roles: string[]
  relationshipType: string
  status: string
  edgeId: string
}

export async function GET() {
  try {
    // Build address → name lookup from DB
    const allUsers = await db.select().from(schema.users)
    const allPersonAgents = await db.select().from(schema.personAgents)
    const allOrgAgents = await db.select().from(schema.orgAgents)

    // Map: smart account address (lowercase) → name
    const nameMap = new Map<string, string>()
    for (const p of allPersonAgents) {
      const user = allUsers.find((u) => u.id === p.userId)
      nameMap.set(p.smartAccountAddress.toLowerCase(), user?.name ?? 'Person Agent')
    }
    for (const o of allOrgAgents) {
      nameMap.set(o.smartAccountAddress.toLowerCase(), o.name)
    }

    const nodes: GraphNode[] = []
    const edges: GraphEdge[] = []
    const seenNodes = new Set<string>()
    const seenEdges = new Set<string>()

    function addNode(address: string, type: 'person' | 'org') {
      const key = address.toLowerCase()
      if (seenNodes.has(key)) return
      seenNodes.add(key)
      nodes.push({
        id: address,
        label: nameMap.get(key) ?? `Agent ${address.slice(0, 6)}`,
        type,
        did: toDidEthr(CHAIN_ID, address as `0x${string}`),
        address,
      })
    }

    // Add known nodes from DB
    for (const p of allPersonAgents) addNode(p.smartAccountAddress, 'person')
    for (const o of allOrgAgents) addNode(o.smartAccountAddress, 'org')

    // Fetch on-chain edges
    const allAddresses = [...seenNodes].map((a) => a as `0x${string}`)

    for (const addr of allAddresses) {
      try {
        const edgeIds = await getEdgesByObject(addr)
        for (const edgeId of edgeIds) {
          if (seenEdges.has(edgeId)) continue
          seenEdges.add(edgeId)

          const e = await getEdge(edgeId)
          const roleHashes = await getEdgeRoles(edgeId)

          // Discover nodes from edges
          addNode(e.subject, nameMap.has(e.subject.toLowerCase()) ? (allOrgAgents.some((o) => o.smartAccountAddress.toLowerCase() === e.subject.toLowerCase()) ? 'org' : 'person') : 'person')
          addNode(e.object_, nameMap.has(e.object_.toLowerCase()) ? (allOrgAgents.some((o) => o.smartAccountAddress.toLowerCase() === e.object_.toLowerCase()) ? 'org' : 'person') : 'org')

          edges.push({
            source: e.subject,
            target: e.object_,
            roles: roleHashes.map((r) => roleName(r)),
            relationshipType: relationshipTypeName(e.relationshipType),
            status: STATUS_LABELS[e.status] ?? 'unknown',
            edgeId,
          })
        }
      } catch {
        // skip
      }
    }

    return NextResponse.json({ nodes, edges })
  } catch (error) {
    return NextResponse.json({ nodes: [], edges: [], error: String(error) })
  }
}
