import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getPublicClient, getWalletClient } from '@/lib/contracts'
import {
  agentAccountResolverAbi,
  ATL_CONTROLLER,
  TYPE_AI_AGENT,
  TYPE_ORGANIZATION,
  TYPE_PERSON,
} from '@smart-agent/sdk'
import { keccak256, toBytes } from 'viem'

export const ATL_TEMPLATE_ID = keccak256(toBytes('smart-agent:template-id'))
export const ATL_GENMAP_DATA = keccak256(toBytes('smart-agent:genmap-data'))
export const ATL_HEALTH_DATA = keccak256(toBytes('atl:healthData'))

type AgentKind = 'person' | 'org' | 'ai' | 'unknown'

export interface RegisteredAgent {
  address: string
  name: string
  description: string
  kind: AgentKind
  controllers: string[]
}

function getResolverAddress() {
  return process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
}

function kindFromType(agentType: `0x${string}`): AgentKind {
  if (agentType === TYPE_PERSON) return 'person'
  if (agentType === TYPE_ORGANIZATION) return 'org'
  if (agentType === TYPE_AI_AGENT) return 'ai'
  return 'unknown'
}

export async function getAgentStringProperty(agentAddress: string, predicate: `0x${string}`): Promise<string> {
  const resolverAddr = getResolverAddress()
  if (!resolverAddr) return ''

  try {
    const client = getPublicClient()
    return await client.readContract({
      address: resolverAddr,
      abi: agentAccountResolverAbi,
      functionName: 'getStringProperty',
      args: [agentAddress as `0x${string}`, predicate],
    }) as string
  } catch {
    return ''
  }
}

export async function setAgentStringProperty(agentAddress: string, predicate: `0x${string}`, value: string) {
  const resolverAddr = getResolverAddress()
  if (!resolverAddr) return

  const walletClient = getWalletClient()
  const publicClient = getPublicClient()
  const hash = await walletClient.writeContract({
    address: resolverAddr,
    abi: agentAccountResolverAbi,
    functionName: 'setStringProperty',
    args: [agentAddress as `0x${string}`, predicate, value],
  })
  await publicClient.waitForTransactionReceipt({ hash })
}

export async function addAgentController(agentAddress: string, walletAddress: string) {
  const resolverAddr = getResolverAddress()
  if (!resolverAddr) return

  const client = getPublicClient()
  const existing = await client.readContract({
    address: resolverAddr,
    abi: agentAccountResolverAbi,
    functionName: 'getMultiAddressProperty',
    args: [agentAddress as `0x${string}`, ATL_CONTROLLER as `0x${string}`],
  }) as string[]

  if (existing.some(addr => addr.toLowerCase() === walletAddress.toLowerCase())) return

  const walletClient = getWalletClient()
  const hash = await walletClient.writeContract({
    address: resolverAddr,
    abi: agentAccountResolverAbi,
    functionName: 'addMultiAddressProperty',
    args: [agentAddress as `0x${string}`, ATL_CONTROLLER as `0x${string}`, walletAddress as `0x${string}`],
  })
  await client.waitForTransactionReceipt({ hash })
}

export async function listRegisteredAgents(): Promise<RegisteredAgent[]> {
  const resolverAddr = getResolverAddress()
  if (!resolverAddr) return []

  const client = getPublicClient()
  const results: RegisteredAgent[] = []

  try {
    const count = await client.readContract({
      address: resolverAddr,
      abi: agentAccountResolverAbi,
      functionName: 'agentCount',
    }) as bigint

    for (let i = 0n; i < count; i++) {
      const agentAddr = await client.readContract({
        address: resolverAddr,
        abi: agentAccountResolverAbi,
        functionName: 'getAgentAt',
        args: [i],
      }) as `0x${string}`

      const core = await client.readContract({
        address: resolverAddr,
        abi: agentAccountResolverAbi,
        functionName: 'getCore',
        args: [agentAddr],
      }) as {
        displayName: string
        description: string
        agentType: `0x${string}`
      }

      const controllers = await client.readContract({
        address: resolverAddr,
        abi: agentAccountResolverAbi,
        functionName: 'getMultiAddressProperty',
        args: [agentAddr, ATL_CONTROLLER as `0x${string}`],
      }) as string[]

      results.push({
        address: agentAddr,
        name: core.displayName || `${agentAddr.slice(0, 6)}...${agentAddr.slice(-4)}`,
        description: core.description || '',
        kind: kindFromType(core.agentType),
        controllers,
      })
    }
  } catch {
    return []
  }

  return results
}

export async function getControlledAgentsForUser(userId: string): Promise<RegisteredAgent[]> {
  const user = await db.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1)
  if (!user[0]) return []

  const wallet = user[0].walletAddress.toLowerCase()
  const agents = await listRegisteredAgents()
  return agents.filter(agent => agent.controllers.some(controller => controller.toLowerCase() === wallet))
}

export async function findAgentOwnerUserIds(agentAddress: string): Promise<string[]> {
  const agents = await listRegisteredAgents()
  const agent = agents.find(entry => entry.address.toLowerCase() === agentAddress.toLowerCase())
  if (!agent || agent.controllers.length === 0) return []

  const users = await db.select().from(schema.users)
  const walletSet = new Set(agent.controllers.map(controller => controller.toLowerCase()))
  return users
    .filter(user => walletSet.has(user.walletAddress.toLowerCase()))
    .map(user => user.id)
}

export async function getAgentTemplateId(agentAddress: string): Promise<string | null> {
  const value = await getAgentStringProperty(agentAddress, ATL_TEMPLATE_ID)
  return value || null
}

export async function setAgentTemplateId(agentAddress: string, templateId: string) {
  await setAgentStringProperty(agentAddress, ATL_TEMPLATE_ID, templateId)
}

export async function getAgentGenMapData(agentAddress: string): Promise<Record<string, unknown> | null> {
  const value = await getAgentStringProperty(agentAddress, ATL_GENMAP_DATA)
  const fallback = value || await getAgentStringProperty(agentAddress, ATL_HEALTH_DATA)
  if (!fallback) return null
  try {
    return JSON.parse(fallback) as Record<string, unknown>
  } catch {
    return null
  }
}

export async function setAgentGenMapData(agentAddress: string, data: Record<string, unknown>) {
  await setAgentStringProperty(agentAddress, ATL_GENMAP_DATA, JSON.stringify(data))
}
