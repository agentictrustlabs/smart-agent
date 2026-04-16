'use server'

import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
// randomUUID no longer needed — agent_index uses address as PK
import {
  deploySmartAccount, createRelationship, confirmRelationship,
  getPublicClient, getWalletClient,
} from '@/lib/contracts'
// getPublicClient used by register() for isRegistered check
import {
  ORGANIZATION_GOVERNANCE, ORGANIZATION_MEMBERSHIP, ALLIANCE, ORGANIZATIONAL_CONTROL,
  GENERATIONAL_LINEAGE,
  ROLE_OWNER, ROLE_BOARD_MEMBER, ROLE_OPERATOR, ROLE_MEMBER, ROLE_ADVISOR, ROLE_OPERATED_AGENT,
  ROLE_STRATEGIC_PARTNER, ROLE_UPSTREAM, ROLE_DOWNSTREAM,
  ATL_LATITUDE, ATL_LONGITUDE, ATL_SPATIAL_CRS, ATL_SPATIAL_TYPE, ATL_CONTROLLER,
} from '@smart-agent/sdk'
import { agentAccountResolverAbi } from '@smart-agent/sdk'
import { keccak256, toBytes } from 'viem'

const TYPE_ORGANIZATION = keccak256(toBytes('atl:OrganizationAgent'))
// TYPE_PERSON no longer needed — person agents deployed by generateDemoWallet
const TYPE_AI = keccak256(toBytes('atl:AIAgent'))
const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`

async function deploy(salt: number): Promise<`0x${string}`> {
  const walletClient = getWalletClient()
  return deploySmartAccount(walletClient.account!.address, BigInt(salt))
}

async function register(addr: `0x${string}`, name: string, desc: string, agentType: `0x${string}`) {
  const walletClient = getWalletClient()
  const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
  if (!resolverAddr) return
  try {
    const client = getPublicClient()
    const isReg = await client.readContract({ address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'isRegistered', args: [addr] }) as boolean
    if (isReg) return
    await walletClient.writeContract({
      address: resolverAddr, abi: agentAccountResolverAbi,
      functionName: 'register', args: [addr, name, desc, agentType, ZERO_HASH, ''],
    })
  } catch (_e) { console.warn(`[catalyst-seed] Failed to register ${name}:`, _e) }
}

async function createEdge(subject: `0x${string}`, object: `0x${string}`, relType: `0x${string}`, roles: `0x${string}`[]) {
  try {
    const edgeId = await createRelationship({ subject, object, roles, relationshipType: relType })
    await confirmRelationship(edgeId)
    return edgeId
  } catch (_e) { console.warn(`[catalyst-seed] Edge failed:`, _e); return null }
}

async function setController(agentAddr: `0x${string}`, walletAddr: string) {
  const wc = getWalletClient()
  const res = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
  if (!res) return
  try {
    await wc.writeContract({ address: res, abi: agentAccountResolverAbi, functionName: 'addMultiAddressProperty', args: [agentAddr, ATL_CONTROLLER as `0x${string}`, walletAddr as `0x${string}`] })
  } catch (_e) { console.warn(`[catalyst-seed] Controller failed:`, _e) }
}

// Hub config setString removed — deployer loses ownership after first seed.
// Static fallback profiles in hub-profiles.ts provide nav config.

async function setGeo(addr: `0x${string}`, lat: string, lon: string) {
  const wc = getWalletClient()
  const resolver = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
  if (!resolver) return
  try {
    await wc.writeContract({ address: resolver, abi: agentAccountResolverAbi, functionName: 'setStringProperty', args: [addr, ATL_LATITUDE as `0x${string}`, lat] })
    await wc.writeContract({ address: resolver, abi: agentAccountResolverAbi, functionName: 'setStringProperty', args: [addr, ATL_LONGITUDE as `0x${string}`, lon] })
    await wc.writeContract({ address: resolver, abi: agentAccountResolverAbi, functionName: 'setStringProperty', args: [addr, ATL_SPATIAL_CRS as `0x${string}`, 'EPSG:4326'] })
    await wc.writeContract({ address: resolver, abi: agentAccountResolverAbi, functionName: 'setStringProperty', args: [addr, ATL_SPATIAL_TYPE as `0x${string}`, 'Point'] })
  } catch (_e) { console.warn(`[catalyst-seed] Geo failed for ${addr}:`, _e) }
}

function upsertUser(u: { id: string; name: string; email: string; wallet: string; privy: string }) {
  const existing = db.select().from(schema.users).where(eq(schema.users.id, u.id)).get()
  if (!existing) {
    db.insert(schema.users).values({ id: u.id, email: u.email, name: u.name, walletAddress: u.wallet, privyUserId: u.privy }).run()
  }
}

/**
 * Auto-seed the Catalyst community on-chain.
 * Deploys all agents, creates all relationships, registers metadata.
 * Requires anvil + deployed contracts.
 */
// Simple lock to prevent concurrent seeds
let seeding = false

export async function seedCatalystOnChain() {
  if (seeding) { console.log('[catalyst-seed] Already in progress'); return }
  seeding = true
  try { await doSeed() } finally { seeding = false }
}

async function doSeed() {
  // All operations are idempotent — safe to run multiple times.
  console.log('[catalyst-seed] Ensuring Catalyst community on-chain...')

  // ─── Users (DB only) — Northern Colorado Hispanic Outreach ─────────
  const USERS = [
    { id: 'cat-user-001', name: 'Maria Gonzalez', email: 'maria@catalystnoco.org', wallet: '0x00000000000000000000000000000000000b0001', privy: 'did:privy:cat-001' },
    { id: 'cat-user-002', name: 'Pastor David Chen', email: 'david@catalystnoco.org', wallet: '0x00000000000000000000000000000000000b0002', privy: 'did:privy:cat-002' },
    { id: 'cat-user-003', name: 'Rosa Martinez', email: 'rosa@comunidad-noco.org', wallet: '0x00000000000000000000000000000000000b0003', privy: 'did:privy:cat-003' },
    { id: 'cat-user-004', name: 'Carlos Herrera', email: 'carlos@comunidad-noco.org', wallet: '0x00000000000000000000000000000000000b0004', privy: 'did:privy:cat-004' },
    { id: 'cat-user-005', name: 'Sarah Thompson', email: 'sarah@catalystnoco.org', wallet: '0x00000000000000000000000000000000000b0005', privy: 'did:privy:cat-005' },
    { id: 'cat-user-006', name: 'Ana Reyes', email: 'ana@wellington-circle.org', wallet: '0x00000000000000000000000000000000000b0006', privy: 'did:privy:cat-006' },
    { id: 'cat-user-007', name: 'Miguel Santos', email: 'miguel@laporte-circle.org', wallet: '0x00000000000000000000000000000000000b0007', privy: 'did:privy:cat-007' },
  ]
  for (const u of USERS) upsertUser(u)

  // ─── Ensure community users have wallets + person agents ───────────
  console.log('[catalyst-seed] Ensuring community users provisioned...')
  const { ensureCommunityUsers } = await import('./lookup-users')
  const catUsers = await ensureCommunityUsers('cat-user-')
  const userMap = new Map(catUsers.map(u => [u.key, u]))

  // Person agents come from the user provisioning (generateDemoWallet),
  // not separate deployments — avoids duplicate person agents.
  const paMaria = userMap.get('cat-user-001')!.personAgentAddress as `0x${string}`
  const paDavid = userMap.get('cat-user-002')!.personAgentAddress as `0x${string}`
  const paRosa = userMap.get('cat-user-003')!.personAgentAddress as `0x${string}`
  const paCarlos = userMap.get('cat-user-004')!.personAgentAddress as `0x${string}`
  const paSarah = userMap.get('cat-user-005')!.personAgentAddress as `0x${string}`
  const paAna = userMap.get('cat-user-006')!.personAgentAddress as `0x${string}`
  const paMiguel = userMap.get('cat-user-007')!.personAgentAddress as `0x${string}`

  // ─── Deploy Org/AI Agent Smart Accounts ──────────────────────────
  console.log('[catalyst-seed] Deploying org smart accounts...')
  const network = await deploy(200001)      // Catalyst NoCo Network
  const hub = await deploy(200002)          // Fort Collins Hub
  const grpWellington = await deploy(200003)  // Wellington Circle
  const grpLaporte = await deploy(200004)     // Laporte Circle
  const grpTimnath = await deploy(200005)     // Timnath Circle
  const grpLoveland = await deploy(200006)    // Loveland Circle
  const grpBerthoud = await deploy(200007)    // Berthoud Circle
  const grpJohnstown = await deploy(200008)   // Johnstown Circle
  const grpRedFeather = await deploy(200009)  // Red Feather Lakes Circle
  const analytics = await deploy(210001)

  console.log('[catalyst-seed] Smart accounts deployed. Network:', network, 'Hub:', hub)

  // ─── Register in Resolver ─────────────────────────────────────────
  console.log('[catalyst-seed] Registering in resolver...')
  await register(network, 'Catalyst NoCo Network', 'Northern Colorado catalyst network — Hispanic community outreach and church planting north of Fort Collins', TYPE_ORGANIZATION)
  await register(hub, 'Fort Collins Hub', 'Facilitator hub — bilingual community development in Fort Collins and surrounding communities', TYPE_ORGANIZATION)
  await register(grpWellington, 'Wellington Circle', 'Established circle — Hispanic families in Wellington (G1)', TYPE_ORGANIZATION)
  await register(grpLaporte, 'Laporte Circle', 'Circle — farm worker community in Laporte (G1)', TYPE_ORGANIZATION)
  await register(grpTimnath, 'Timnath Circle', 'Circle — growing Hispanic neighborhood in Timnath (G2)', TYPE_ORGANIZATION)
  await register(grpLoveland, 'Loveland Circle', 'Circle — Loveland Latino outreach (G1)', TYPE_ORGANIZATION)
  await register(grpBerthoud, 'Berthoud Circle', 'Circle — Berthoud agricultural workers (G2)', TYPE_ORGANIZATION)
  await register(grpJohnstown, 'Johnstown Circle', 'Circle — Johnstown and Milliken families (G3)', TYPE_ORGANIZATION)
  await register(grpRedFeather, 'Red Feather Circle', 'Circle — rural mountain community near Red Feather Lakes (G2)', TYPE_ORGANIZATION)
  await register(analytics, 'NoCo Growth Analytics', 'Movement health tracking for Northern Colorado circles', TYPE_AI)
  // Person agents already registered by generateDemoWallet — skip re-registration

  // Person agent controllers already set by generateDemoWallet — skip

  // ─── Geospatial Metadata (Northern Colorado) ──────────────────────
  console.log('[catalyst-seed] Setting geospatial metadata...')
  await setGeo(network, '40.5853', '-105.0844')     // Fort Collins (network level)
  await setGeo(hub, '40.5734', '-105.0836')          // Old Town Fort Collins
  await setGeo(grpWellington, '40.7036', '-105.0064') // Wellington
  await setGeo(grpLaporte, '40.6258', '-105.1358')    // Laporte
  await setGeo(grpTimnath, '40.5281', '-104.9864')    // Timnath
  await setGeo(grpLoveland, '40.3978', '-105.0750')   // Loveland
  await setGeo(grpBerthoud, '40.3083', '-105.0811')   // Berthoud
  await setGeo(grpJohnstown, '40.3369', '-104.9522')  // Johnstown
  await setGeo(grpRedFeather, '40.8028', '-105.5819') // Red Feather Lakes

  // ─── On-Chain Relationships (22 edges) ────────────────────────────
  // Quick check: if Hub already has outgoing ALLIANCE edges, skip all edge creation
  // (Hub config writes also skipped when edges exist — deployer lost ownership after first seed)
  let edgesComplete = false
  try {
    const { getEdgesBySubject: checkEdges } = await import('@/lib/contracts')
    const hubOutEdges = await checkEdges(hub)
    edgesComplete = hubOutEdges.length >= 3 // Hub → SonTra, Thanh, Cam
  } catch { /* ignored */ }

  if (edgesComplete) {
    console.log('[catalyst-seed] On-chain relationships already complete')
    return
  }

  console.log('[catalyst-seed] Creating on-chain relationships (this takes ~60 seconds)...')

  // Person → Org (13 edges)
  await createEdge(paMaria, network, ORGANIZATION_GOVERNANCE, [ROLE_OWNER])
  await createEdge(paSarah, network, ORGANIZATION_GOVERNANCE, [ROLE_BOARD_MEMBER])
  await createEdge(paDavid, hub, ORGANIZATION_GOVERNANCE, [ROLE_OWNER])
  await createEdge(paDavid, network, ORGANIZATION_MEMBERSHIP, [ROLE_OPERATOR])
  await createEdge(paRosa, hub, ORGANIZATION_MEMBERSHIP, [ROLE_OPERATOR])
  await createEdge(paCarlos, hub, ORGANIZATION_MEMBERSHIP, [ROLE_MEMBER])
  await createEdge(paAna, grpWellington, ORGANIZATION_GOVERNANCE, [ROLE_OWNER])
  await createEdge(paAna, hub, ORGANIZATION_MEMBERSHIP, [ROLE_MEMBER])
  await createEdge(paMiguel, grpLaporte, ORGANIZATION_GOVERNANCE, [ROLE_OWNER])
  await createEdge(paMiguel, hub, ORGANIZATION_MEMBERSHIP, [ROLE_MEMBER])
  await createEdge(paDavid, grpWellington, ORGANIZATION_MEMBERSHIP, [ROLE_ADVISOR])
  await createEdge(paRosa, grpLaporte, ORGANIZATION_MEMBERSHIP, [ROLE_ADVISOR])
  await createEdge(paRosa, grpRedFeather, ORGANIZATION_MEMBERSHIP, [ROLE_ADVISOR])

  // Org → Org ALLIANCE (network hierarchy)
  await createEdge(network, hub, ALLIANCE, [ROLE_STRATEGIC_PARTNER])
  await createEdge(hub, grpWellington, ALLIANCE, [ROLE_STRATEGIC_PARTNER])
  await createEdge(hub, grpLoveland, ALLIANCE, [ROLE_STRATEGIC_PARTNER])
  await createEdge(hub, grpRedFeather, ALLIANCE, [ROLE_STRATEGIC_PARTNER])

  // Circle → Circle GENERATIONAL LINEAGE (upstream planted downstream)
  await createEdge(grpWellington, grpLaporte, GENERATIONAL_LINEAGE, [ROLE_UPSTREAM, ROLE_DOWNSTREAM])
  await createEdge(grpWellington, grpTimnath, GENERATIONAL_LINEAGE, [ROLE_UPSTREAM, ROLE_DOWNSTREAM])
  await createEdge(grpLoveland, grpBerthoud, GENERATIONAL_LINEAGE, [ROLE_UPSTREAM, ROLE_DOWNSTREAM])
  await createEdge(grpLaporte, grpJohnstown, GENERATIONAL_LINEAGE, [ROLE_UPSTREAM, ROLE_DOWNSTREAM])

  // AI → Org (1 edge)
  await createEdge(analytics, network, ORGANIZATIONAL_CONTROL, [ROLE_OPERATED_AGENT])

  console.log('[catalyst-seed] NoCo Catalyst community deployed: 17 agents, 22 on-chain edges')
}
