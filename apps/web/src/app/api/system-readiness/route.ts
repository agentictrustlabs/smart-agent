import { NextResponse } from 'next/server'
import { createPublicClient, http } from 'viem'
import { foundry } from 'viem/chains'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { agentAccountResolverAbi, agentRelationshipAbi, ATL_CONTROLLER } from '@smart-agent/sdk'

export const dynamic = 'force-dynamic'

interface Check { label: string; ok: boolean; detail?: string }

async function rpcReady(): Promise<Check> {
  try {
    const client = createPublicClient({ chain: foundry, transport: http(process.env.RPC_URL ?? 'http://127.0.0.1:8545') })
    const bn = await client.getBlockNumber()
    return { label: 'Local chain (anvil)', ok: true, detail: `block ${bn}` }
  } catch (e) {
    return { label: 'Local chain (anvil)', ok: false, detail: (e as Error).message }
  }
}

async function contractsDeployed(): Promise<Check> {
  try {
    const addr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}` | undefined
    if (!addr) return { label: 'Contracts deployed', ok: false, detail: 'no AGENT_ACCOUNT_RESOLVER_ADDRESS' }
    const client = createPublicClient({ chain: foundry, transport: http(process.env.RPC_URL ?? 'http://127.0.0.1:8545') })
    const code = await client.getCode({ address: addr })
    return { label: 'Contracts deployed', ok: !!code && code !== '0x', detail: addr }
  } catch (e) {
    return { label: 'Contracts deployed', ok: false, detail: (e as Error).message }
  }
}

async function ontologySeeded(): Promise<Check> {
  try {
    const addr = process.env.ONTOLOGY_REGISTRY_ADDRESS as `0x${string}` | undefined
    if (!addr) return { label: 'Ontology seeded', ok: false, detail: 'no ONTOLOGY_REGISTRY_ADDRESS' }
    const client = createPublicClient({ chain: foundry, transport: http(process.env.RPC_URL ?? 'http://127.0.0.1:8545') })
    const isActive = (await client.readContract({
      address: addr,
      abi: [{ type: 'function', name: 'isActive', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'bool' }] }],
      functionName: 'isActive',
      args: [ATL_CONTROLLER as `0x${string}`],
    })) as boolean
    return { label: 'Ontology seeded', ok: isActive, detail: isActive ? 'atl:hasController active' : 'atl:hasController not registered' }
  } catch (e) {
    return { label: 'Ontology seeded', ok: false, detail: (e as Error).message }
  }
}

async function checkPort(url: string, label: string, healthPath = '/health'): Promise<Check> {
  try {
    const r = await fetch(`${url}${healthPath}`, { signal: AbortSignal.timeout(1500) })
    return { label, ok: r.ok, detail: url }
  } catch (e) {
    return { label, ok: false, detail: (e as Error).message }
  }
}

async function userStatus(): Promise<{ personAgentRegistered: Check; orgsLinked: Check; hubResolved: Check }> {
  const pending = { label: 'Person agent registered on-chain', ok: false, detail: 'not logged in' }
  const pending2 = { label: 'Community seed — orgs linked', ok: false, detail: 'not logged in' }
  const pending3 = { label: 'Hub resolved', ok: false, detail: 'not logged in' }
  try {
    const user = await getCurrentUser()
    if (!user) return { personAgentRegistered: pending, orgsLinked: pending2, hubResolved: pending3 }

    const rows = await db.select().from(schema.users).where(eq(schema.users.id, user.id)).limit(1)
    const row = rows[0]
    if (!row?.personAgentAddress) {
      return {
        personAgentRegistered: { label: 'Person agent registered on-chain', ok: false, detail: 'no personAgentAddress in DB' },
        orgsLinked: pending2, hubResolved: pending3,
      }
    }

    const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
    const relAddr      = process.env.AGENT_RELATIONSHIP_ADDRESS   as `0x${string}`
    const client = createPublicClient({ chain: foundry, transport: http(process.env.RPC_URL ?? 'http://127.0.0.1:8545') })

    // Is PA registered + has a controller?
    const isReg = (await client.readContract({
      address: resolverAddr, abi: agentAccountResolverAbi,
      functionName: 'isRegistered', args: [row.personAgentAddress as `0x${string}`],
    })) as boolean
    const ctrls = isReg ? (await client.readContract({
      address: resolverAddr, abi: agentAccountResolverAbi,
      functionName: 'getMultiAddressProperty',
      args: [row.personAgentAddress as `0x${string}`, ATL_CONTROLLER as `0x${string}`],
    })) as string[] : []

    const personAgentRegistered: Check = {
      label: 'Person agent registered on-chain',
      ok: isReg && ctrls.length > 0,
      detail: isReg ? `${ctrls.length} controller(s)` : 'not registered yet',
    }

    // Does PA have at least one outgoing relationship edge?
    let edgeCount = 0
    try {
      const edges = (await client.readContract({
        address: relAddr, abi: agentRelationshipAbi,
        functionName: 'getEdgesBySubject',
        args: [row.personAgentAddress as `0x${string}`],
      })) as readonly `0x${string}`[]
      edgeCount = edges.length
    } catch { /* ignored */ }

    const orgsLinked: Check = {
      label: 'Community seed — orgs linked',
      ok: edgeCount >= 1,
      detail: `${edgeCount} outgoing edge(s)`,
    }

    // Hub resolved?
    const { getUserHubId } = await import('@/lib/get-user-hub')
    let hubId = 'generic'
    try { hubId = await getUserHubId(user.id) } catch { /* ignored */ }
    const hubResolved: Check = {
      label: 'Hub resolved',
      ok: hubId !== 'generic',
      detail: `hubId=${hubId}`,
    }

    return { personAgentRegistered, orgsLinked, hubResolved }
  } catch (e) {
    return {
      personAgentRegistered: { label: 'Person agent registered on-chain', ok: false, detail: (e as Error).message },
      orgsLinked: pending2, hubResolved: pending3,
    }
  }
}

export async function GET() {
  const [
    rpc, contracts, ontology,
    a2a, personMcp, ssi, orgMcp, familyMcp,
    userBits,
  ] = await Promise.all([
    rpcReady(),
    contractsDeployed(),
    ontologySeeded(),
    checkPort(process.env.A2A_AGENT_URL ?? 'http://localhost:3100', 'a2a-agent', '/.well-known/agent.json'),
    checkPort(process.env.PERSON_MCP_URL ?? 'http://localhost:3200', 'person-mcp'),
    checkPort(process.env.SSI_WALLET_MCP_URL ?? 'http://localhost:3300', 'ssi-wallet-mcp'),
    checkPort(process.env.ORG_MCP_URL ?? 'http://localhost:3400', 'org-mcp'),
    checkPort(process.env.FAMILY_MCP_URL ?? 'http://localhost:3500', 'family-mcp'),
    userStatus(),
  ])

  const infra: Check[] = [rpc, contracts, ontology]
  const services: Check[] = [a2a, personMcp, ssi, orgMcp, familyMcp]
  const user: Check[] = [userBits.personAgentRegistered, userBits.orgsLinked, userBits.hubResolved]

  const infraReady    = infra.every(c => c.ok)
  const servicesReady = services.every(c => c.ok)
  const userReady     = user.every(c => c.ok)
  const allReady      = infraReady && servicesReady && userReady

  return NextResponse.json({ infra, services, user, infraReady, servicesReady, userReady, allReady })
}
