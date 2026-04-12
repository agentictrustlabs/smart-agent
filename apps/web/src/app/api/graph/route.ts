import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db, schema } from '@/db'
import { getEdgesByObject, getEdge, getEdgeRoles, getTemplateCount, getTemplate, getPublicClient } from '@/lib/contracts'
import { roleName, relationshipTypeName, toDidEthr, agentAccountResolverAbi, ATL_CAPABILITY, ATL_SUPPORTED_TRUST, ATL_A2A_ENDPOINT, ATL_CONTROLLER, AI_CLASS_LABELS } from '@smart-agent/sdk'

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

    // Build name + type map from on-chain resolver
    const { buildAgentNameMap } = await import('@/lib/agent-metadata')
    const resolverNames = await buildAgentNameMap()
    const nameMap = new Map<string, string>()
    const typeMap = new Map<string, string>()
    for (const [addr, info] of resolverNames) {
      nameMap.set(addr, info.name)
      typeMap.set(addr, info.type)
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

    // Add agent nodes from on-chain resolver
    const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
    if (resolverAddr) {
      try {
        const client = getPublicClient()
        const agentCount = await client.readContract({ address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'agentCount' }) as bigint
        for (let i = 0n; i < agentCount; i++) {
          const agentAddr = await client.readContract({ address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'getAgentAt', args: [i] }) as `0x${string}`
          const kind = (typeMap.get(agentAddr.toLowerCase()) ?? 'person') as 'person' | 'org' | 'ai'
          addNode(agentAddr, kind)

          // Controller edge: check ATL_CONTROLLER for wallet addresses
          try {
            const controllers = await client.readContract({
              address: resolverAddr, abi: agentAccountResolverAbi,
              functionName: 'getMultiAddressProperty',
              args: [agentAddr, ATL_CONTROLLER as `0x${string}`],
            }) as string[]
            for (const ctrl of controllers) {
              const user = allUsers.find(u => u.walletAddress.toLowerCase() === ctrl.toLowerCase())
              if (user) {
                edges.push({
                  source: user.walletAddress, target: agentAddr,
                  roles: ['controller'], relationshipType: 'Controller',
                  status: 'active', edgeId: `ctrl-${user.walletAddress}-${agentAddr}`, templates: [],
                })
              }
            }
          } catch { /* ignored */ }
        }
      } catch { /* ignored */ }
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
    const getNodeType = (a: string): 'person' | 'org' | 'ai' => (typeMap.get(a.toLowerCase()) as 'person' | 'org' | 'ai') ?? 'person'

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
          currentUserAddresses.push(currentUser[0].walletAddress.toLowerCase())
          // Find this user's person agent from on-chain registry
          const { getPersonAgentForUser, getOrgsForPersonAgent } = await import('@/lib/agent-registry')
          const personAddr = await getPersonAgentForUser(currentUser[0].id)
          if (personAddr) {
            currentUserAddresses.push(personAddr.toLowerCase())
            const orgs = await getOrgsForPersonAgent(personAddr)
            orgs.forEach(o => currentUserAddresses.push(o.address.toLowerCase()))
          }
        }
      }
    } catch { /* skip */ }

    return NextResponse.json({ nodes, edges, currentUserAddresses })
  } catch (error) {
    return NextResponse.json({ nodes: [], edges: [], currentUserAddresses: [], error: String(error) })
  }
}
