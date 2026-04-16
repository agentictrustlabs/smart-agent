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
  ROLE_STRATEGIC_PARTNER, ROLE_UPSTREAM, ROLE_DOWNSTREAM,
  ATL_LATITUDE, ATL_LONGITUDE, ATL_SPATIAL_CRS, ATL_SPATIAL_TYPE, ATL_CONTROLLER,
  ATL_GENMAP_DATA,
} from '@smart-agent/sdk'
import { agentAccountResolverAbi } from '@smart-agent/sdk'
import { keccak256, toBytes } from 'viem'

const TYPE_ORGANIZATION = keccak256(toBytes('atl:OrganizationAgent'))
const TYPE_PERSON = keccak256(toBytes('atl:PersonAgent'))
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
  } catch (_e) { console.warn(`[cil-seed] Failed to register ${name}:`, _e) }
}

async function createEdge(subject: `0x${string}`, object: `0x${string}`, relType: `0x${string}`, roles: `0x${string}`[]) {
  try {
    const edgeId = await createRelationship({ subject, object, roles, relationshipType: relType })
    await confirmRelationship(edgeId)
    return edgeId
  } catch (_e) { console.warn(`[cil-seed] Edge failed:`, _e); return null }
}

async function setController(agentAddr: `0x${string}`, walletAddr: string) {
  const wc = getWalletClient()
  const res = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
  if (!res) return
  try {
    await wc.writeContract({ address: res, abi: agentAccountResolverAbi, functionName: 'addMultiAddressProperty', args: [agentAddr, ATL_CONTROLLER as `0x${string}`, walletAddr as `0x${string}`] })
  } catch (_e) { console.warn(`[cil-seed] Controller failed:`, _e) }
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
  } catch (_e) { console.warn(`[cil-seed] Geo failed for ${addr}:`, _e) }
}

async function setGenMapData(addr: `0x${string}`, data: string) {
  const wc = getWalletClient()
  const resolver = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
  if (!resolver) return
  try {
    await wc.writeContract({ address: resolver, abi: agentAccountResolverAbi, functionName: 'setStringProperty', args: [addr, ATL_GENMAP_DATA as `0x${string}`, data] })
  } catch (_e) { console.warn(`[cil-seed] GenMap data failed for ${addr}:`, _e) }
}

function upsertUser(u: { id: string; name: string; email: string; wallet: string; privy: string }) {
  const existing = db.select().from(schema.users).where(eq(schema.users.id, u.id)).get()
  if (!existing) {
    db.insert(schema.users).values({ id: u.id, email: u.email, name: u.name, walletAddress: u.wallet, privyUserId: u.privy }).run()
  }
}

/**
 * Auto-seed the Collective Impact Labs (CIL) community on-chain.
 * Deploys all agents, creates all relationships, registers metadata.
 * Requires anvil + deployed contracts.
 */
let seeding = false

export async function seedCILOnChain() {
  if (seeding) { console.log('[cil-seed] Already in progress'); return }
  seeding = true
  try { await doSeed() } finally { seeding = false }
}

async function doSeed() {
  console.log('[cil-seed] Ensuring CIL community on-chain...')

  // ─── Users (DB only) ──────────────────────────────────────────────
  const USERS = [
    { id: 'cil-user-001', name: 'Cameron Henrion', email: 'cameron@ilad.org', wallet: '0x00000000000000000000000000000000000c0001', privy: 'did:privy:cil-001' },
    { id: 'cil-user-002', name: 'Nick Courchesne', email: 'nick@ilad.org', wallet: '0x00000000000000000000000000000000000c0002', privy: 'did:privy:cil-002' },
    { id: 'cil-user-003', name: 'Afia Mensah', email: 'afia@market.tg', wallet: '0x00000000000000000000000000000000000c0003', privy: 'did:privy:cil-003' },
    { id: 'cil-user-004', name: 'Kossi Agbeko', email: 'kossi@repairs.tg', wallet: '0x00000000000000000000000000000000000c0004', privy: 'did:privy:cil-004' },
    { id: 'cil-user-005', name: 'Yaw', email: 'yaw@ilad-togo.org', wallet: '0x00000000000000000000000000000000000c0005', privy: 'did:privy:cil-005' },
    { id: 'cil-user-006', name: 'John F. Kim', email: 'john@cil.org', wallet: '0x00000000000000000000000000000000000c0006', privy: 'did:privy:cil-006' },
    { id: 'cil-user-007', name: 'Paul Martel', email: 'paul@funder.org', wallet: '0x00000000000000000000000000000000000c0007', privy: 'did:privy:cil-007' },
  ]
  for (const u of USERS) upsertUser(u)

  // ─── Deploy Agent Smart Accounts ──────────────────────────────────
  console.log('[cil-seed] Deploying smart accounts...')

  // Organizations (salt 400001+)
  const cil         = await deploy(400001)
  const ilad        = await deploy(400002)
  const ravah       = await deploy(400003)
  const afiaMarket  = await deploy(400004)
  const kossiRepair = await deploy(400005)
  const lomeHub     = await deploy(400006)
  const wave1       = await deploy(400007)
  const wave2       = await deploy(400008)

  // Person agents (salt 420001+)
  const paCameron = await deploy(420001)
  const paNick    = await deploy(420002)
  const paAfia    = await deploy(420003)
  const paKossi   = await deploy(420004)
  const paYaw     = await deploy(420005)
  const paJohn    = await deploy(420006)
  const paPaul    = await deploy(420007)

  console.log('[cil-seed] Smart accounts deployed. CIL:', cil, 'ILAD:', ilad)

  // ─── Register in Resolver ─────────────────────────────────────────
  console.log('[cil-seed] Registering in resolver...')
  await register(cil,         'Collective Impact Labs', 'Top-level investment and impact organization', TYPE_ORGANIZATION)
  await register(ilad,        'ILAD', 'Implementing partner in Togo', TYPE_ORGANIZATION)
  await register(ravah,       'Ravah Capital Togo', 'Capital deployment vehicle for Togo portfolio', TYPE_ORGANIZATION)
  await register(afiaMarket,  "Afia's Market", 'Portfolio business — market stall in Grand Marche', TYPE_ORGANIZATION)
  await register(kossiRepair, 'Kossi Mobile Repairs', 'Portfolio business — mobile repair shop', TYPE_ORGANIZATION)
  await register(lomeHub,     'Lome Business Hub', 'Cohort gathering point in Lome', TYPE_ORGANIZATION)
  await register(wave1,       'Wave 1 Cohort', 'First batch of funded businesses', TYPE_ORGANIZATION)
  await register(wave2,       'Wave 2 Cohort', 'Second batch of funded businesses', TYPE_ORGANIZATION)

  await register(paCameron, 'Cameron Henrion', 'Operations Lead — ILAD', TYPE_PERSON)
  await register(paNick,    'Nick Courchesne', 'Reviewer — ILAD', TYPE_PERSON)
  await register(paAfia,    'Afia Mensah', "Business Owner — Afia's Market", TYPE_PERSON)
  await register(paKossi,   'Kossi Agbeko', 'Business Owner — Kossi Mobile Repairs', TYPE_PERSON)
  await register(paYaw,     'Yaw', 'Local Manager — ILAD', TYPE_PERSON)
  await register(paJohn,    'John F. Kim', 'Admin — Collective Impact Labs', TYPE_PERSON)
  await register(paPaul,    'Paul Martel', 'Funder — Collective Impact Labs', TYPE_PERSON)

  // ─── Set ATL_CONTROLLER on person agents (wallet → agent mapping) ──
  console.log('[cil-seed] Setting controller predicates...')
  const { ensureCommunityUsers } = await import('./lookup-users')
  const cilUsers = await ensureCommunityUsers('cil-user-')
  const cilWallets = new Map(cilUsers.map(u => [u.key, u.walletAddress]))
  await setController(paCameron, cilWallets.get('cil-user-001') ?? USERS[0].wallet)
  await setController(paNick,    cilWallets.get('cil-user-002') ?? USERS[1].wallet)
  await setController(paAfia,    cilWallets.get('cil-user-003') ?? USERS[2].wallet)
  await setController(paKossi,   cilWallets.get('cil-user-004') ?? USERS[3].wallet)
  await setController(paYaw,     cilWallets.get('cil-user-005') ?? USERS[4].wallet)
  await setController(paJohn,    cilWallets.get('cil-user-006') ?? USERS[5].wallet)
  await setController(paPaul,    cilWallets.get('cil-user-007') ?? USERS[6].wallet)

  // ─── Geospatial Metadata ──────────────────────────────────────────
  console.log('[cil-seed] Setting geospatial metadata...')
  await setGeo(cil,         '40.7128', '-74.0060')   // NYC HQ
  await setGeo(ilad,        '6.1319',  '1.2228')     // Lome
  await setGeo(ravah,       '6.1375',  '1.2123')
  await setGeo(afiaMarket,  '6.1280',  '1.2310')     // Grand Marche area
  await setGeo(kossiRepair, '6.1350',  '1.2250')
  await setGeo(lomeHub,     '6.1340',  '1.2200')
  await setGeo(wave1,       '6.1300',  '1.2280')
  await setGeo(wave2,       '6.1360',  '1.2190')

  // ─── GenMap Health Data ───────────────────────────────────────────
  console.log('[cil-seed] Setting genmap health data...')
  await setGenMapData(afiaMarket,  JSON.stringify({"isChurch":false,"attenders":3,"believers":0,"baptized":0,"leaders":1,"groupsStarted":0,"peoplGroup":"Market vendors"}))
  await setGenMapData(kossiRepair, JSON.stringify({"isChurch":false,"attenders":2,"believers":0,"baptized":0,"leaders":1,"groupsStarted":0,"peoplGroup":"Tech repair"}))
  await setGenMapData(wave1,       JSON.stringify({"isChurch":false,"attenders":8,"believers":0,"baptized":0,"leaders":2,"groupsStarted":2}))
  await setGenMapData(wave2,       JSON.stringify({"isChurch":false,"attenders":5,"believers":0,"baptized":0,"leaders":1,"groupsStarted":0}))

  // Hub config writes skipped when edges already exist (deployer loses ownership after first seed).
  // Static fallback profiles in hub-profiles.ts provide the nav config.

  // ─── On-Chain Relationships ───────────────────────────────────────
  // Quick check: if ILAD already has outgoing ALLIANCE edges, skip all edge creation
  let edgesComplete = false
  try {
    const { getEdgesBySubject: checkEdges } = await import('@/lib/contracts')
    const cilOutEdges = await checkEdges(cil)
    edgesComplete = cilOutEdges.length >= 2 // CIL → ILAD, CIL → Ravah
  } catch { /* ignored */ }

  if (edgesComplete) {
    console.log('[cil-seed] On-chain relationships already complete')
    return
  }

  console.log('[cil-seed] Creating on-chain relationships...')

  // Person → Org (11 edges)
  await createEdge(paJohn,    cil,         ORGANIZATION_GOVERNANCE,  [ROLE_OWNER])
  await createEdge(paPaul,    cil,         ORGANIZATION_GOVERNANCE,  [ROLE_BOARD_MEMBER])
  await createEdge(paCameron, ilad,        ORGANIZATION_GOVERNANCE,  [ROLE_OWNER])
  await createEdge(paCameron, ravah,       ORGANIZATION_MEMBERSHIP,  [ROLE_OPERATOR])
  await createEdge(paNick,    ilad,        ORGANIZATION_MEMBERSHIP,  [ROLE_OPERATOR])
  await createEdge(paYaw,     ilad,        ORGANIZATION_MEMBERSHIP,  [ROLE_OPERATOR])
  await createEdge(paYaw,     lomeHub,     ORGANIZATION_GOVERNANCE,  [ROLE_OWNER])
  await createEdge(paAfia,    afiaMarket,  ORGANIZATION_GOVERNANCE,  [ROLE_OWNER])
  await createEdge(paAfia,    wave1,       ORGANIZATION_MEMBERSHIP,  [ROLE_MEMBER])
  await createEdge(paKossi,   kossiRepair, ORGANIZATION_GOVERNANCE,  [ROLE_OWNER])
  await createEdge(paKossi,   wave1,       ORGANIZATION_MEMBERSHIP,  [ROLE_MEMBER])

  // Org → Org ALLIANCE (5 edges)
  await createEdge(cil,     ilad,    ALLIANCE, [ROLE_STRATEGIC_PARTNER])
  await createEdge(cil,     ravah,   ALLIANCE, [ROLE_STRATEGIC_PARTNER])
  await createEdge(ilad,    lomeHub, ALLIANCE, [ROLE_STRATEGIC_PARTNER])
  await createEdge(lomeHub, wave1,   ALLIANCE, [ROLE_STRATEGIC_PARTNER])
  await createEdge(lomeHub, wave2,   ALLIANCE, [ROLE_STRATEGIC_PARTNER])

  // Org → Business GENERATIONAL_LINEAGE (2 edges)
  await createEdge(wave1, afiaMarket,  GENERATIONAL_LINEAGE, [ROLE_UPSTREAM, ROLE_DOWNSTREAM])
  await createEdge(wave1, kossiRepair, GENERATIONAL_LINEAGE, [ROLE_UPSTREAM, ROLE_DOWNSTREAM])

  console.log('[cil-seed] CIL community deployed: 15 agents, 18 on-chain edges')
}
