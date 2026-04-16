'use server'

import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import {
  deploySmartAccount, createRelationship, confirmRelationship,
  getPublicClient, getWalletClient,
} from '@/lib/contracts'
import {
  ORGANIZATION_GOVERNANCE, ORGANIZATION_MEMBERSHIP, ALLIANCE,
  GENERATIONAL_LINEAGE,
  ROLE_OWNER, ROLE_BOARD_MEMBER, ROLE_OPERATOR, ROLE_MEMBER,
  ROLE_UPSTREAM, ROLE_DOWNSTREAM,
  ATL_LATITUDE, ATL_LONGITUDE, ATL_SPATIAL_CRS, ATL_SPATIAL_TYPE, ATL_CONTROLLER,
  ATL_GENMAP_DATA,
} from '@smart-agent/sdk'
import { agentAccountResolverAbi } from '@smart-agent/sdk'
import { keccak256, toBytes } from 'viem'

const TYPE_ORGANIZATION = keccak256(toBytes('atl:OrganizationAgent'))
// TYPE_PERSON no longer needed — person agents deployed by generateDemoWallet
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
  } catch (_e) { console.warn(`[gc-seed] Failed to register ${name}:`, _e) }
}

async function createEdge(subject: `0x${string}`, object: `0x${string}`, relType: `0x${string}`, roles: `0x${string}`[]) {
  try {
    const edgeId = await createRelationship({ subject, object, roles, relationshipType: relType })
    await confirmRelationship(edgeId)
    return edgeId
  } catch (_e) { console.warn(`[gc-seed] Edge failed:`, _e); return null }
}

async function setController(agentAddr: `0x${string}`, walletAddr: string) {
  const wc = getWalletClient()
  const res = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
  if (!res) return
  try {
    await wc.writeContract({ address: res, abi: agentAccountResolverAbi, functionName: 'addMultiAddressProperty', args: [agentAddr, ATL_CONTROLLER as `0x${string}`, walletAddr as `0x${string}`] })
  } catch (_e) { console.warn(`[gc-seed] Controller failed:`, _e) }
}

// Hub config setString removed — static fallback profiles provide nav config.

async function setGeo(addr: `0x${string}`, lat: string, lon: string) {
  const wc = getWalletClient()
  const resolver = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
  if (!resolver) return
  try {
    await wc.writeContract({ address: resolver, abi: agentAccountResolverAbi, functionName: 'setStringProperty', args: [addr, ATL_LATITUDE as `0x${string}`, lat] })
    await wc.writeContract({ address: resolver, abi: agentAccountResolverAbi, functionName: 'setStringProperty', args: [addr, ATL_LONGITUDE as `0x${string}`, lon] })
    await wc.writeContract({ address: resolver, abi: agentAccountResolverAbi, functionName: 'setStringProperty', args: [addr, ATL_SPATIAL_CRS as `0x${string}`, 'EPSG:4326'] })
    await wc.writeContract({ address: resolver, abi: agentAccountResolverAbi, functionName: 'setStringProperty', args: [addr, ATL_SPATIAL_TYPE as `0x${string}`, 'Point'] })
  } catch (_e) { console.warn(`[gc-seed] Geo failed for ${addr}:`, _e) }
}

async function setGenMapData(addr: `0x${string}`, data: string) {
  const wc = getWalletClient()
  const resolver = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
  if (!resolver) return
  try {
    await wc.writeContract({ address: resolver, abi: agentAccountResolverAbi, functionName: 'setStringProperty', args: [addr, ATL_GENMAP_DATA as `0x${string}`, data] })
  } catch (_e) { console.warn(`[gc-seed] GenMap data failed for ${addr}:`, _e) }
}

function upsertUser(u: { id: string; name: string; email: string; wallet: string; privy: string }) {
  const existing = db.select().from(schema.users).where(eq(schema.users.id, u.id)).get()
  if (!existing) {
    db.insert(schema.users).values({ id: u.id, email: u.email, name: u.name, walletAddress: u.wallet, privyUserId: u.privy }).run()
  }
}

/**
 * Auto-seed the Global.Church community on-chain.
 * Deploys all agents, creates all relationships, registers metadata.
 * Requires anvil + deployed contracts.
 */
// Simple lock to prevent concurrent seeds
let seeding = false

export async function seedGlobalChurchOnChain() {
  if (seeding) { console.log('[gc-seed] Already in progress'); return }
  seeding = true
  try { await doSeed() } finally { seeding = false }
}

async function doSeed() {
  // All operations are idempotent — safe to run multiple times.
  console.log('[gc-seed] Ensuring Global.Church community on-chain...')

  // ─── Users (DB only) ──────────────────────────────────────────────
  const USERS = [
    { id: 'gc-user-001', name: 'Pastor James', email: 'james@gracecommunity.org', wallet: '0x0000000000000000000000000000000000010001', privy: 'did:privy:gc-001' },
    { id: 'gc-user-002', name: 'Dr. Sarah Mitchell', email: 'sarah@sbc.net', wallet: '0x0000000000000000000000000000000000010002', privy: 'did:privy:gc-002' },
    { id: 'gc-user-003', name: 'Dan Busby', email: 'dan@ecfa.org', wallet: '0x0000000000000000000000000000000000010003', privy: 'did:privy:gc-003' },
    { id: 'gc-user-004', name: 'John Chesnut', email: 'john@wycliffe.org', wallet: '0x0000000000000000000000000000000000010004', privy: 'did:privy:gc-004' },
    { id: 'gc-user-005', name: 'David Wills', email: 'david@ncf.org', wallet: '0x0000000000000000000000000000000000010005', privy: 'did:privy:gc-005' },
  ]
  for (const u of USERS) upsertUser(u)

  // ─── Ensure community users have wallets + person agents ───────────
  console.log('[gc-seed] Ensuring community users provisioned...')
  const { ensureCommunityUsers } = await import('./lookup-users')
  const gcUsers = await ensureCommunityUsers('gc-user-')
  const userMap = new Map(gcUsers.map(u => [u.key, u]))

  const paPastorJames = userMap.get('gc-user-001')!.personAgentAddress as `0x${string}`
  const paSarahMitchell = userMap.get('gc-user-002')!.personAgentAddress as `0x${string}`
  const paDanBusby = userMap.get('gc-user-003')!.personAgentAddress as `0x${string}`
  const paJohnChesnut = userMap.get('gc-user-004')!.personAgentAddress as `0x${string}`
  const paDavidWills = userMap.get('gc-user-005')!.personAgentAddress as `0x${string}`

  // ─── Deploy Org Smart Accounts ───────────────────────────────────
  console.log('[gc-seed] Deploying org smart accounts...')
  // Organizations (salt 300001+)
  const gcNetwork = await deploy(300001)
  const graceChurch = await deploy(300002)
  const sbc = await deploy(300003)
  const ecfa = await deploy(300004)
  const wycliffe = await deploy(300005)
  const ncf = await deploy(300006)
  const youthMinistry = await deploy(300007)
  const smallGroups = await deploy(300008)
  const missionsTeam = await deploy(300009)

  console.log('[gc-seed] Smart accounts deployed. Network:', gcNetwork, 'Grace Church:', graceChurch)

  // ─── Register in Resolver ─────────────────────────────────────────
  console.log('[gc-seed] Registering in resolver...')
  await register(gcNetwork, 'Global.Church Network', 'Denomination/network umbrella for church collaboration', TYPE_ORGANIZATION)
  await register(graceChurch, 'Grace Community Church', 'Local church in Sun Valley, CA — Pastor James', TYPE_ORGANIZATION)
  await register(sbc, 'Southern Baptist Convention', 'Denomination/network — Nashville, TN', TYPE_ORGANIZATION)
  await register(ecfa, 'ECFA', 'Evangelical Council for Financial Accountability', TYPE_ORGANIZATION)
  await register(wycliffe, 'Wycliffe Bible Translators', 'Mission agency — Bible translation worldwide', TYPE_ORGANIZATION)
  await register(ncf, 'National Christian Foundation', 'Funding organization — Christian philanthropy', TYPE_ORGANIZATION)
  await register(youthMinistry, 'Grace Youth Ministry', 'Sub-ministry of Grace Community Church — youth programs', TYPE_ORGANIZATION)
  await register(smallGroups, 'Grace Small Groups', 'Sub-ministry of Grace Community Church — small group discipleship', TYPE_ORGANIZATION)
  await register(missionsTeam, 'Grace Missions Team', 'Sub-ministry of Grace Community Church — missions outreach', TYPE_ORGANIZATION)
  // Person agents already registered by generateDemoWallet — skip re-registration
  // Person agent controllers already set by generateDemoWallet — skip

  // ─── Geospatial Metadata (US locations) ───────────────────────────
  console.log('[gc-seed] Setting geospatial metadata...')
  await setGeo(gcNetwork, '33.7490', '-84.3880')       // Atlanta, GA
  await setGeo(graceChurch, '34.1759', '-118.3148')    // Sun Valley, CA
  await setGeo(sbc, '36.1627', '-86.7816')             // Nashville, TN
  await setGeo(ecfa, '38.8951', '-77.0364')            // Winchester, VA
  await setGeo(wycliffe, '28.8036', '-81.2723')        // Orlando, FL
  await setGeo(ncf, '33.8421', '-84.3769')             // Alpharetta, GA
  await setGeo(youthMinistry, '34.1760', '-118.3150')
  await setGeo(smallGroups, '34.1758', '-118.3146')
  await setGeo(missionsTeam, '34.1762', '-118.3152')

  // ─── GenMap Health Data ───────────────────────────────────────────
  console.log('[gc-seed] Setting GenMap health data...')
  await setGenMapData(graceChurch, JSON.stringify({"isChurch":true,"attenders":450,"believers":380,"baptized":320,"leaders":45,"groupsStarted":3,"appointedLeaders":true,"practicesBaptism":true,"lordsSupper":true,"makingDisciples":true,"practicesGiving":true,"regularTeaching":true,"practicesService":true,"accountability":true,"practicesPrayer":true,"practicesPraising":true}))
  await setGenMapData(youthMinistry, JSON.stringify({"isChurch":false,"attenders":85,"believers":60,"baptized":30,"leaders":8,"groupsStarted":0,"practicesPrayer":true,"practicesPraising":true,"regularTeaching":true}))
  await setGenMapData(smallGroups, JSON.stringify({"isChurch":false,"attenders":120,"believers":100,"baptized":80,"leaders":15,"groupsStarted":2,"makingDisciples":true,"accountability":true,"practicesPrayer":true}))
  await setGenMapData(missionsTeam, JSON.stringify({"isChurch":false,"attenders":25,"believers":25,"baptized":22,"leaders":5,"groupsStarted":1,"practicesGiving":true,"practicesService":true}))

  // Hub config writes skipped when edges already exist (deployer loses ownership after first seed).
  // Static fallback profiles in hub-profiles.ts provide the nav config.

  // ─── On-Chain Relationships ───────────────────────────────────────
  // Quick check: if Network already has outgoing ALLIANCE edges, skip all edge creation
  let edgesComplete = false
  try {
    const { getEdgesBySubject: checkEdges } = await import('@/lib/contracts')
    const networkOutEdges = await checkEdges(gcNetwork)
    edgesComplete = networkOutEdges.length >= 5 // Network → 5 alliance orgs
  } catch { /* ignored */ }

  if (edgesComplete) {
    console.log('[gc-seed] On-chain relationships already complete')
    return
  }

  console.log('[gc-seed] Creating on-chain relationships...')

  // Person → Org governance/membership (10 edges)
  await createEdge(paPastorJames, graceChurch, ORGANIZATION_GOVERNANCE, [ROLE_OWNER])
  await createEdge(paPastorJames, gcNetwork, ORGANIZATION_MEMBERSHIP, [ROLE_BOARD_MEMBER])
  await createEdge(paSarahMitchell, sbc, ORGANIZATION_GOVERNANCE, [ROLE_OWNER])
  await createEdge(paSarahMitchell, gcNetwork, ORGANIZATION_MEMBERSHIP, [ROLE_OPERATOR])
  await createEdge(paDanBusby, ecfa, ORGANIZATION_GOVERNANCE, [ROLE_OWNER])
  await createEdge(paDanBusby, gcNetwork, ORGANIZATION_MEMBERSHIP, [ROLE_MEMBER])
  await createEdge(paJohnChesnut, wycliffe, ORGANIZATION_GOVERNANCE, [ROLE_OWNER])
  await createEdge(paJohnChesnut, gcNetwork, ORGANIZATION_MEMBERSHIP, [ROLE_MEMBER])
  await createEdge(paDavidWills, ncf, ORGANIZATION_GOVERNANCE, [ROLE_OWNER])
  await createEdge(paDavidWills, gcNetwork, ORGANIZATION_MEMBERSHIP, [ROLE_BOARD_MEMBER])

  // Org → Org ALLIANCE (5 edges)
  await createEdge(gcNetwork, graceChurch, ALLIANCE, [ROLE_UPSTREAM, ROLE_DOWNSTREAM])
  await createEdge(gcNetwork, sbc, ALLIANCE, [ROLE_UPSTREAM, ROLE_DOWNSTREAM])
  await createEdge(gcNetwork, ecfa, ALLIANCE, [ROLE_UPSTREAM, ROLE_DOWNSTREAM])
  await createEdge(gcNetwork, wycliffe, ALLIANCE, [ROLE_UPSTREAM, ROLE_DOWNSTREAM])
  await createEdge(gcNetwork, ncf, ALLIANCE, [ROLE_UPSTREAM, ROLE_DOWNSTREAM])

  // Church → Ministry GENERATIONAL_LINEAGE (3 edges)
  await createEdge(graceChurch, youthMinistry, GENERATIONAL_LINEAGE, [ROLE_UPSTREAM, ROLE_DOWNSTREAM])
  await createEdge(graceChurch, smallGroups, GENERATIONAL_LINEAGE, [ROLE_UPSTREAM, ROLE_DOWNSTREAM])
  await createEdge(graceChurch, missionsTeam, GENERATIONAL_LINEAGE, [ROLE_UPSTREAM, ROLE_DOWNSTREAM])

  console.log('[gc-seed] Global.Church community deployed: 14 agents, 18 on-chain edges')
}
