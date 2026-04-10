import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db, schema } from '@/db'
import { getEdgesByObject, getEdge, getEdgeRoles, getTemplateCount, getTemplate, getPublicClient } from '@/lib/contracts'
import { roleName, relationshipTypeName, toDidEthr, agentAccountResolverAbi, ATL_CAPABILITY, ATL_SUPPORTED_TRUST, ATL_A2A_ENDPOINT, AI_CLASS_LABELS } from '@smart-agent/sdk'

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')
const STATUS_LABELS = ['none', 'proposed', 'confirmed', 'active', 'suspended', 'revoked', 'rejected']

export interface GraphNode {
  id: string
  label: string
  type: 'person' | 'org' | 'ai' | 'eoa'
  did: string
  address: string
  description?: string
  capabilities?: string[]
  trustModels?: string[]
  a2aEndpoint?: string
  aiClass?: string
  isResolverRegistered?: boolean
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
    const allAIAgents = await db.select().from(schema.aiAgents)

    const nameMap = new Map<string, string>()
    for (const p of allPersonAgents) {
      const user = allUsers.find((u) => u.id === p.userId)
      const agentName = (p as Record<string, unknown>).name as string | undefined
      nameMap.set(p.smartAccountAddress.toLowerCase(), agentName || user?.name || 'Person Agent')
    }
    for (const o of allOrgAgents) {
      nameMap.set(o.smartAccountAddress.toLowerCase(), o.name)
    }
    for (const a of allAIAgents) {
      nameMap.set(a.smartAccountAddress.toLowerCase(), a.name)
    }

    const nodes: GraphNode[] = []
    const edges: GraphEdge[] = []
    const seenNodes = new Set<string>()
    const seenEdges = new Set<string>()

    function addNode(address: string, type: 'person' | 'org' | 'ai' | 'eoa') {
      const key = address.toLowerCase()
      if (seenNodes.has(key)) return
      seenNodes.add(key)
      nodes.push({
        id: address,
        label: nameMap.get(key) ?? `${address.slice(0, 6)}...${address.slice(-4)}`,
        type,
        did: type === 'eoa' ? `eoa:${address}` : toDidEthr(CHAIN_ID, address as `0x${string}`),
        address,
      })
    }

    // Add EOA wallet nodes and controller edges
    for (const u of allUsers) {
      nameMap.set(u.walletAddress.toLowerCase(), u.name)
      addNode(u.walletAddress, 'eoa')
    }

    for (const p of allPersonAgents) {
      addNode(p.smartAccountAddress, 'person')
      // EOA → Person Agent controller edge
      const user = allUsers.find((u) => u.id === p.userId)
      if (user) {
        edges.push({
          source: user.walletAddress,
          target: p.smartAccountAddress,
          roles: ['controller'],
          relationshipType: 'Controller',
          status: 'active',
          edgeId: `ctrl-${user.walletAddress}-${p.smartAccountAddress}`,
          templates: [],
        })
      }
    }
    for (const o of allOrgAgents) {
      addNode(o.smartAccountAddress, 'org')
      const user = allUsers.find((u) => u.id === o.createdBy)
      if (user) {
        edges.push({
          source: user.walletAddress,
          target: o.smartAccountAddress,
          roles: ['controller'],
          relationshipType: 'Controller',
          status: 'active',
          edgeId: `ctrl-${user.walletAddress}-${o.smartAccountAddress}`,
          templates: [],
        })
      }
    }
    for (const a of allAIAgents) {
      addNode(a.smartAccountAddress, 'ai')
      const user = allUsers.find((u) => u.id === a.createdBy)
      if (user) {
        edges.push({
          source: user.walletAddress,
          target: a.smartAccountAddress,
          roles: ['controller'],
          relationshipType: 'Controller',
          status: 'active',
          edgeId: `ctrl-${user.walletAddress}-${a.smartAccountAddress}`,
          templates: [],
        })
      }
    }

    // Enrich nodes with resolver metadata
    try {
      const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
      if (resolverAddr) {
        const client = getPublicClient()
        for (const node of nodes) {
          if (node.type === 'eoa') continue
          try {
            const isReg = await client.readContract({ address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'isRegistered', args: [node.address as `0x${string}`] }) as boolean
            if (!isReg) continue
            node.isResolverRegistered = true
            const core = await client.readContract({ address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'getCore', args: [node.address as `0x${string}`] }) as { displayName: string; description: string; agentClass: `0x${string}` }
            if (core.displayName) node.label = core.displayName
            if (core.description) node.description = core.description
            if (AI_CLASS_LABELS[core.agentClass]) node.aiClass = AI_CLASS_LABELS[core.agentClass]
            node.capabilities = await client.readContract({ address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'getMultiStringProperty', args: [node.address as `0x${string}`, ATL_CAPABILITY as `0x${string}`] }) as string[]
            node.trustModels = await client.readContract({ address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'getMultiStringProperty', args: [node.address as `0x${string}`, ATL_SUPPORTED_TRUST as `0x${string}`] }) as string[]
            const a2a = await client.readContract({ address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'getStringProperty', args: [node.address as `0x${string}`, ATL_A2A_ENDPOINT as `0x${string}`] }) as string
            if (a2a) node.a2aEndpoint = a2a
          } catch { /* skip individual agent errors */ }
        }
      }
    } catch { /* resolver not deployed */ }

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
    const isAI = (a: string) => allAIAgents.some((ai) => ai.smartAccountAddress.toLowerCase() === a.toLowerCase())
    const getNodeType = (a: string): 'person' | 'org' | 'ai' => isAI(a) ? 'ai' : isOrg(a) ? 'org' : 'person'

    for (const addr of allAddresses) {
      try {
        const edgeIds = await getEdgesByObject(addr)
        for (const edgeId of edgeIds) {
          if (seenEdges.has(edgeId)) continue
          seenEdges.add(edgeId)

          const e = await getEdge(edgeId)
          const roleHashes = await getEdgeRoles(edgeId)

          addNode(e.subject, getNodeType(e.subject))
          addNode(e.object_, getNodeType(e.object_))

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

    // Include current user's agent addresses for client-side filtering
    const currentUserAddresses: string[] = []
    try {
      const { getSession } = await import('@/lib/auth/session')
      const session = await getSession()
      if (session) {
        const currentUser = await db.select().from(schema.users).where(eq(schema.users.privyUserId, session.userId)).limit(1)
        if (currentUser[0]) {
          const myPerson = allPersonAgents.filter((p) => p.userId === currentUser[0].id)
          const myOrgs = allOrgAgents.filter((o) => o.createdBy === currentUser[0].id)
          const myAIs = allAIAgents.filter((a) => a.createdBy === currentUser[0].id)
          currentUserAddresses.push(currentUser[0].walletAddress.toLowerCase())
          myPerson.forEach((p) => currentUserAddresses.push(p.smartAccountAddress.toLowerCase()))
          myOrgs.forEach((o) => currentUserAddresses.push(o.smartAccountAddress.toLowerCase()))
          myAIs.forEach((a) => currentUserAddresses.push(a.smartAccountAddress.toLowerCase()))
        }
      }
    } catch { /* skip */ }

    return NextResponse.json({ nodes, edges, currentUserAddresses })
  } catch (error) {
    return NextResponse.json({ nodes: [], edges: [], currentUserAddresses: [], error: String(error) })
  }
}
