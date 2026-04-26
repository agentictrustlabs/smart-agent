import { NextResponse } from 'next/server'
import { createPublicClient, http } from 'viem'
import { foundry } from 'viem/chains'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { db, schema } from '@/db'
import { eq, sql } from 'drizzle-orm'
import { agentAccountResolverAbi, agentRelationshipAbi, ATL_CONTROLLER } from '@smart-agent/sdk'
import { DEMO_USER_META } from '@/lib/auth/session'
import { getBootState, triggerBootSeed } from '@/lib/boot-seed'

export const dynamic = 'force-dynamic'

interface Check { label: string; ok: boolean; detail?: string }

const EXPECTED_DEMO_USER_COUNT = Object.keys(DEMO_USER_META).length            // 19 today
const EXPECTED_MIN_ONCHAIN_AGENTS = 40                                          // persons + orgs + hubs across all 3 communities

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

// ─── Community — system-wide ────────────────────────────────────────────────
//
// These checks verify the RULE: "System ready" only when every demo user and
// every demo org is provisioned. Triggers boot-seed if not yet started.

async function communityStatus(): Promise<{ usersProvisioned: Check; onChainAgents: Check; bootSeed: Check }> {
  // Users provisioned in DB (has private key, smart account, person agent).
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.users)
    .where(sql`${schema.users.privateKey} IS NOT NULL AND ${schema.users.smartAccountAddress} IS NOT NULL AND ${schema.users.personAgentAddress} IS NOT NULL`)
  const usersProvisioned: Check = {
    label: 'All demo users provisioned',
    ok: (count ?? 0) >= EXPECTED_DEMO_USER_COUNT,
    detail: `${count ?? 0} / ${EXPECTED_DEMO_USER_COUNT}`,
  }

  // On-chain agent count (persons + orgs + hubs across all 3 communities).
  let onChainAgents: Check
  try {
    const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
    const client = createPublicClient({ chain: foundry, transport: http(process.env.RPC_URL ?? 'http://127.0.0.1:8545') })
    const countChain = (await client.readContract({
      address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'agentCount',
    })) as bigint
    onChainAgents = {
      label: 'Community agents registered on-chain',
      ok: Number(countChain) >= EXPECTED_MIN_ONCHAIN_AGENTS,
      detail: `${countChain} / ≥ ${EXPECTED_MIN_ONCHAIN_AGENTS}`,
    }
  } catch (e) {
    onChainAgents = { label: 'Community agents registered on-chain', ok: false, detail: (e as Error).message }
  }

  const boot = getBootState()
  // Self-healing: if both data-level checks pass, the community is actually
  // provisioned regardless of whether the in-memory boot flag got stuck on a
  // transient error (e.g. a UNIQUE-constraint race during parallel seeds).
  const dataReady = usersProvisioned.ok && onChainAgents.ok
  const bootSeed: Check = {
    label: 'Boot seed',
    ok: boot.completed || dataReady,
    detail: boot.completed
      ? 'complete'
      : dataReady
        ? 'complete (verified from on-chain + DB state)'
        : boot.started
          ? `in progress — ${boot.phase}`
          : 'not started',
  }

  // Auto-trigger only if data isn't already provisioned and boot hasn't run.
  if (!boot.started && !dataReady) {
    triggerBootSeed().catch(() => { /* state.error captures */ })
  }

  return { usersProvisioned, onChainAgents, bootSeed }
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

    // OAuth / passkey / SIWE users don't have a separate personAgentAddress —
    // the smart account itself IS their person agent. Fall back accordingly so
    // the readiness check works for every auth path.
    const personAddr = (row?.personAgentAddress ?? row?.smartAccountAddress) as `0x${string}` | null | undefined
    if (!personAddr) {
      return {
        personAgentRegistered: { label: 'Person agent registered on-chain', ok: false, detail: 'no personAgentAddress / smartAccountAddress in DB' },
        orgsLinked: pending2, hubResolved: pending3,
      }
    }

    const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
    const relAddr      = process.env.AGENT_RELATIONSHIP_ADDRESS   as `0x${string}`
    const client = createPublicClient({ chain: foundry, transport: http(process.env.RPC_URL ?? 'http://127.0.0.1:8545') })

    const isReg = (await client.readContract({
      address: resolverAddr, abi: agentAccountResolverAbi,
      functionName: 'isRegistered', args: [personAddr],
    })) as boolean
    const ctrls = isReg ? (await client.readContract({
      address: resolverAddr, abi: agentAccountResolverAbi,
      functionName: 'getMultiAddressProperty',
      args: [personAddr, ATL_CONTROLLER as `0x${string}`],
    })) as string[] : []

    // For OAuth-only accounts there's no separate EOA controller — the wallet
    // address equals the smart account itself. Treat "registered with no
    // separate controllers" as healthy in that case (bootstrap server stays
    // as a co-owner of the AgentAccount, which is sufficient for trust).
    const isOauthSelfControlled = !!row?.walletAddress
      && row.walletAddress.toLowerCase() === personAddr.toLowerCase()
    const personAgentRegistered: Check = {
      label: 'Person agent registered on-chain',
      ok: isReg && (ctrls.length > 0 || isOauthSelfControlled),
      detail: isReg
        ? (ctrls.length > 0 ? `${ctrls.length} controller(s)` : 'self-controlled (OAuth)')
        : 'not registered yet',
    }

    let edgeCount = 0
    try {
      const edges = (await client.readContract({
        address: relAddr, abi: agentRelationshipAbi,
        functionName: 'getEdgesBySubject',
        args: [personAddr],
      })) as readonly `0x${string}`[]
      edgeCount = edges.length
    } catch { /* ignored */ }

    // Org links and hub affiliation are post-onboarding actions for OAuth
    // users (they choose New Org / Join Org explicitly). Mark these as ok
    // once the user has finished onboarding (onboardedAt set) — they're
    // legitimately in a state where no orgs/hub is the desired outcome.
    const onboarded = !!row?.onboardedAt
    const orgsLinked: Check = {
      label: 'Community seed — orgs linked',
      ok: edgeCount >= 1 || onboarded,
      detail: edgeCount >= 1 ? `${edgeCount} outgoing edge(s)` : (onboarded ? 'no orgs joined yet (ok)' : '0 outgoing edges'),
    }

    const { getUserHubId } = await import('@/lib/get-user-hub')
    let hubId = 'generic'
    try { hubId = await getUserHubId(user.id) } catch { /* ignored */ }
    const hubResolved: Check = {
      label: 'Hub resolved',
      ok: hubId !== 'generic' || onboarded,
      detail: `hubId=${hubId}${hubId === 'generic' && onboarded ? ' (ok — no hub joined yet)' : ''}`,
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
    communityBits,
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
    communityStatus(),
    userStatus(),
  ])

  const infra: Check[] = [rpc, contracts, ontology]
  const services: Check[] = [a2a, personMcp, ssi, orgMcp, familyMcp]
  const community: Check[] = [communityBits.usersProvisioned, communityBits.onChainAgents, communityBits.bootSeed]
  const user: Check[] = [userBits.personAgentRegistered, userBits.orgsLinked, userBits.hubResolved]

  const infraReady     = infra.every(c => c.ok)
  const servicesReady  = services.every(c => c.ok)
  const communityReady = community.every(c => c.ok)
  const userReady      = user.every(c => c.ok)
  const allReady       = infraReady && servicesReady && communityReady && userReady

  return NextResponse.json({
    infra, services, community, user,
    infraReady, servicesReady, communityReady, userReady, allReady,
    bootPhase: getBootState().phase,
  })
}
