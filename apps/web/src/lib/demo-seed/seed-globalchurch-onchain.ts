'use server'

import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import {
  deploySmartAccount, createRelationship, confirmRelationship,
  getPublicClient, getWalletClient,
} from '@/lib/contracts'
import {
  ORGANIZATION_GOVERNANCE, ORGANIZATION_MEMBERSHIP, ALLIANCE,
  GENERATIONAL_LINEAGE, HAS_MEMBER,
  ROLE_OWNER, ROLE_BOARD_MEMBER, ROLE_OPERATOR, ROLE_MEMBER,
  ROLE_UPSTREAM, ROLE_DOWNSTREAM,
  ATL_LATITUDE, ATL_LONGITUDE, ATL_SPATIAL_CRS, ATL_SPATIAL_TYPE, ATL_CONTROLLER,
  ATL_CITY, ATL_REGION, ATL_COUNTRY,
  ATL_GENMAP_DATA, ATL_PRIMARY_NAME, ATL_NAME_LABEL,
  agentNameRegistryAbi, agentNameResolverAbi,
} from '@smart-agent/sdk'
import { agentAccountResolverAbi } from '@smart-agent/sdk'
import { keccak256, toBytes, encodePacked } from 'viem'

const TYPE_ORGANIZATION = keccak256(toBytes('atl:OrganizationAgent'))
const TYPE_HUB = keccak256(toBytes('atl:HubAgent'))
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

async function setCity(addr: `0x${string}`, city: string, region: string, country: string) {
  const wc = getWalletClient()
  const resolver = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
  if (!resolver) return
  try {
    await wc.writeContract({ address: resolver, abi: agentAccountResolverAbi, functionName: 'setStringProperty', args: [addr, ATL_CITY as `0x${string}`, city] })
    await wc.writeContract({ address: resolver, abi: agentAccountResolverAbi, functionName: 'setStringProperty', args: [addr, ATL_REGION as `0x${string}`, region] })
    await wc.writeContract({ address: resolver, abi: agentAccountResolverAbi, functionName: 'setStringProperty', args: [addr, ATL_COUNTRY as `0x${string}`, country] })
  } catch (_e) { console.warn(`[gc-seed] City failed for ${addr}:`, _e) }
}

async function setGenMapData(addr: `0x${string}`, data: string) {
  const wc = getWalletClient()
  const resolver = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
  if (!resolver) return
  try {
    await wc.writeContract({ address: resolver, abi: agentAccountResolverAbi, functionName: 'setStringProperty', args: [addr, ATL_GENMAP_DATA as `0x${string}`, data] })
  } catch (_e) { console.warn(`[gc-seed] GenMap data failed for ${addr}:`, _e) }
}

function upsertUser(u: { id: string; name: string; email: string; wallet: string; did: string }) {
  const existing = db.select().from(schema.users).where(eq(schema.users.id, u.id)).get()
  if (!existing) {
    db.insert(schema.users).values({ id: u.id, email: u.email, name: u.name, walletAddress: u.wallet, did: u.did }).run()
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
    { id: 'gc-user-001', name: 'Pastor James', email: 'james@gracecommunity.org', wallet: '0x0000000000000000000000000000000000010001', did: 'did:demo:gc-001' },
    { id: 'gc-user-002', name: 'Dr. Sarah Mitchell', email: 'sarah@sbc.net', wallet: '0x0000000000000000000000000000000000010002', did: 'did:demo:gc-002' },
    { id: 'gc-user-003', name: 'Dan Busby', email: 'dan@ecfa.org', wallet: '0x0000000000000000000000000000000000010003', did: 'did:demo:gc-003' },
    { id: 'gc-user-004', name: 'John Chesnut', email: 'john@wycliffe.org', wallet: '0x0000000000000000000000000000000000010004', did: 'did:demo:gc-004' },
    { id: 'gc-user-005', name: 'David Wills', email: 'david@ncf.org', wallet: '0x0000000000000000000000000000000000010005', did: 'did:demo:gc-005' },
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

  // ─── Demo-user EOA → Org controller links ─────────────────────────
  // Lets demo users approve PROPOSED relationship requests aimed at the
  // orgs they administer (the /relationships page only surfaces a
  // Confirm button when the signed-in user's wallet sits in the target
  // agent's ATL_CONTROLLER list).
  const ctrl: Array<[`0x${string}`, string, string]> = [
    // Pastor James shepherds Grace Community + sub-ministries.
    [graceChurch,    userMap.get('gc-user-001')!.walletAddress, 'James → Grace Community'],
    [youthMinistry,  userMap.get('gc-user-001')!.walletAddress, 'James → Grace Youth'],
    [smallGroups,    userMap.get('gc-user-001')!.walletAddress, 'James → Grace Small Groups'],
    [missionsTeam,   userMap.get('gc-user-001')!.walletAddress, 'James → Grace Missions'],
    // Network — both senior leaders.
    [gcNetwork,      userMap.get('gc-user-001')!.walletAddress, 'James → Network'],
    [gcNetwork,      userMap.get('gc-user-002')!.walletAddress, 'Sarah Mitchell → Network'],
    // Other top-level orgs — each persona's home org.
    [sbc,            userMap.get('gc-user-002')!.walletAddress, 'Sarah Mitchell → SBC'],
    [ecfa,           userMap.get('gc-user-003')!.walletAddress, 'Dan → ECFA'],
    [wycliffe,       userMap.get('gc-user-004')!.walletAddress, 'John Chesnut → Wycliffe'],
    [ncf,            userMap.get('gc-user-005')!.walletAddress, 'David Wills → NCF'],
  ]
  for (const [agent, wallet, label] of ctrl) {
    if (!wallet) continue
    await setController(agent, wallet)
    console.log(`[gc-seed] controller: ${label}`)
  }

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

  // City tags — coarse-tier input for geo-overlap.v1.
  console.log('[gc-seed] Setting city tags...')
  await setCity(gcNetwork,    'Atlanta',     'Georgia',    'US')
  await setCity(graceChurch,  'Sun Valley',  'California', 'US')
  await setCity(sbc,          'Nashville',   'Tennessee',  'US')
  await setCity(ecfa,         'Winchester',  'Virginia',   'US')
  await setCity(wycliffe,     'Orlando',     'Florida',    'US')
  await setCity(ncf,          'Alpharetta',  'Georgia',    'US')
  await setCity(youthMinistry,  'Sun Valley',  'California', 'US')
  await setCity(smallGroups,    'Sun Valley',  'California', 'US')
  await setCity(missionsTeam,   'Sun Valley',  'California', 'US')

  // Person agents — distribute the demo users across the org cities so
  // shared-city scoring exercises pairs both within and across hubs.
  const gcPersonCities: Array<[string, string, string, string]> = [
    ['gc-user-001', 'Atlanta',    'Georgia',    'US'],  // Pastor James
    ['gc-user-002', 'Atlanta',    'Georgia',    'US'],  // Sarah Mitchell
    ['gc-user-003', 'Sun Valley', 'California', 'US'],  // John Chesnut
    ['gc-user-004', 'Sun Valley', 'California', 'US'],  // Dan Busby
    ['gc-user-005', 'Winchester', 'Virginia',   'US'],  // David Wills
  ]
  for (const [uid, city, region, country] of gcPersonCities) {
    const u = userMap.get(uid)
    if (u?.personAgentAddress) await setCity(u.personAgentAddress as `0x${string}`, city, region, country)
  }

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
    console.log('[gc-seed] On-chain relationships already complete — skipping edges, continuing to hub + naming')
  } else {
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
  } // end of edge creation else block

  // ─── Hub Agent ──────────────────────────────────────────────────
  console.log('[gc-seed] Deploying hub agent...')
  const hubGC = await deploy(390001)
  await register(hubGC, 'Global.Church Hub', 'Global.Church network hub — church collaboration, stewardship, mission agencies', TYPE_HUB)

  // HAS_MEMBER edges
  console.log('[gc-seed] Creating HAS_MEMBER edges...')
  const allGcAgents = [gcNetwork, graceChurch, sbc, ecfa, wycliffe, ncf, youthMinistry, smallGroups, missionsTeam, paPastorJames, paSarahMitchell, paDanBusby, paJohnChesnut, paDavidWills]
  for (const agent of allGcAgents) {
    await createEdge(hubGC, agent, HAS_MEMBER as `0x${string}`, [ROLE_MEMBER])
  }

  // ─── Agent Naming (.agent namespace) ─────────────────────────────
  const nameRegistryAddr = process.env.AGENT_NAME_REGISTRY_ADDRESS as `0x${string}`
  const nameResolverAddr = process.env.AGENT_NAME_RESOLVER_ADDRESS as `0x${string}`
  const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`

  if (nameRegistryAddr && nameResolverAddr) {
    console.log('[gc-seed] Registering .agent names...')
    const wc = getWalletClient()
    const pc = getPublicClient()

    async function regName(parentNode: `0x${string}`, label: string, ownerAddr: `0x${string}`, fullName: string) {
      const lh = keccak256(toBytes(label))
      const cn = keccak256(encodePacked(['bytes32', 'bytes32'], [parentNode, lh]))
      try {
        const exists = await pc.readContract({ address: nameRegistryAddr, abi: agentNameRegistryAbi, functionName: 'recordExists', args: [cn] }) as boolean
        if (!exists) {
          const h = await wc.writeContract({ address: nameRegistryAddr, abi: agentNameRegistryAbi, functionName: 'register', args: [parentNode, label, ownerAddr, nameResolverAddr, 0n] })
          await pc.waitForTransactionReceipt({ hash: h })
        }
        try { await wc.writeContract({ address: nameResolverAddr, abi: agentNameResolverAbi, functionName: 'setAddr', args: [cn, ownerAddr] }) } catch { /* */ }
        if (resolverAddr) {
          try { await wc.writeContract({ address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'setStringProperty', args: [ownerAddr, ATL_NAME_LABEL as `0x${string}`, label] }) } catch { /* */ }
          try { await wc.writeContract({ address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'setStringProperty', args: [ownerAddr, ATL_PRIMARY_NAME as `0x${string}`, fullName] }) } catch { /* */ }
        }
        return cn
      } catch (e) { console.warn(`[gc-seed] Name reg failed for ${label}:`, e); return cn }
    }

    const agentRoot = await pc.readContract({ address: nameRegistryAddr, abi: agentNameRegistryAbi, functionName: 'AGENT_ROOT' }) as `0x${string}`

    // Register globalchurch.agent under root. Owner is the DEPLOYER (not
    // the hub agent) so the onboarding wizard's deployer-signed sub-name
    // calls succeed without needing UserOps from the hub's smart account.
    const deployerOwner = wc.account!.address as `0x${string}`
    const gcNode = await regName(agentRoot, 'globalchurch', deployerOwner, 'globalchurch.agent')
    if (gcNode) {
      await regName(gcNode, 'network', gcNetwork, 'network.globalchurch.agent')
      await regName(gcNode, 'grace', graceChurch, 'grace.globalchurch.agent')
      await regName(gcNode, 'sbc', sbc, 'sbc.globalchurch.agent')
      await regName(gcNode, 'ecfa', ecfa, 'ecfa.globalchurch.agent')
      await regName(gcNode, 'wycliffe', wycliffe, 'wycliffe.globalchurch.agent')
      await regName(gcNode, 'ncf', ncf, 'ncf.globalchurch.agent')
      await regName(gcNode, 'youth', youthMinistry, 'youth.globalchurch.agent')
      await regName(gcNode, 'smallgroups', smallGroups, 'smallgroups.globalchurch.agent')
      await regName(gcNode, 'missions', missionsTeam, 'missions.globalchurch.agent')
      await regName(gcNode, 'james', paPastorJames, 'james.globalchurch.agent')
      await regName(gcNode, 'sarah', paSarahMitchell, 'sarah.globalchurch.agent')
      await regName(gcNode, 'dan', paDanBusby, 'dan.globalchurch.agent')
      await regName(gcNode, 'chesnut', paJohnChesnut, 'chesnut.globalchurch.agent')
      await regName(gcNode, 'wills', paDavidWills, 'wills.globalchurch.agent')
      console.log('[gc-seed] Names registered under globalchurch.agent')
    }
  }

  console.log('[gc-seed] Global.Church community deployed: 15 agents, 32+ on-chain edges')
}
