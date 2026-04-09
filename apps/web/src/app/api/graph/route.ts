import { NextResponse } from 'next/server'
import { db, schema } from '@/db'
import { getEdgesByObject, getEdge, getEdgeRoles, getTemplateCount, getTemplate } from '@/lib/contracts'
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

export interface TemplateInfo {
  id: number
  name: string
  description: string
  forRole: string
  forType: string
  active: boolean
}

export interface GraphEdge {
  source: string
  target: string
  roles: string[]
  relationshipType: string
  status: string
  edgeId: string
  templates: TemplateInfo[]
}

export async function GET() {
  try {
    const allUsers = await db.select().from(schema.users)
    const allPersonAgents = await db.select().from(schema.personAgents)
    const allOrgAgents = await db.select().from(schema.orgAgents)

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

    for (const p of allPersonAgents) addNode(p.smartAccountAddress, 'person')
    for (const o of allOrgAgents) addNode(o.smartAccountAddress, 'org')

    // Load all templates: (relType:role) → TemplateInfo[]
    const templatesByKey = new Map<string, TemplateInfo[]>()
    try {
      const count = await getTemplateCount()
      for (let i = 0n; i < count; i++) {
        const t = await getTemplate(i)
        const key = `${t.relationshipType}:${t.role}`
        const info: TemplateInfo = {
          id: Number(t.id),
          name: t.name,
          description: t.description,
          forRole: roleName(t.role),
          forType: relationshipTypeName(t.relationshipType),
          active: t.active,
        }
        const arr = templatesByKey.get(key) ?? []
        arr.push(info)
        templatesByKey.set(key, arr)
      }
    } catch { /* templates may not be deployed */ }

    // Fetch on-chain edges
    const allAddresses = [...seenNodes].map((a) => a as `0x${string}`)
    const isOrg = (a: string) => allOrgAgents.some((o) => o.smartAccountAddress.toLowerCase() === a.toLowerCase())

    for (const addr of allAddresses) {
      try {
        const edgeIds = await getEdgesByObject(addr)
        for (const edgeId of edgeIds) {
          if (seenEdges.has(edgeId)) continue
          seenEdges.add(edgeId)

          const e = await getEdge(edgeId)
          const roleHashes = await getEdgeRoles(edgeId)

          addNode(e.subject, isOrg(e.subject) ? 'org' : 'person')
          addNode(e.object_, isOrg(e.object_) ? 'org' : 'person')

          // Gather templates for this edge's role+type combos
          const edgeTemplates: TemplateInfo[] = []
          for (const rh of roleHashes) {
            const key = `${e.relationshipType}:${rh}`
            const tpls = templatesByKey.get(key)
            if (tpls) edgeTemplates.push(...tpls)
          }

          edges.push({
            source: e.subject,
            target: e.object_,
            roles: roleHashes.map((r) => roleName(r)),
            relationshipType: relationshipTypeName(e.relationshipType),
            status: STATUS_LABELS[e.status] ?? 'unknown',
            edgeId,
            templates: edgeTemplates,
          })
        }
      } catch { /* skip */ }
    }

    return NextResponse.json({ nodes, edges })
  } catch (error) {
    return NextResponse.json({ nodes: [], edges: [], error: String(error) })
  }
}
