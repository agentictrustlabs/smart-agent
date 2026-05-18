'use server'

import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import {
  createRelationship, confirmRelationship,
  getPublicClient, getWalletClient,
} from '@/lib/contracts'
import {
  ORGANIZATION_GOVERNANCE, ORGANIZATION_MEMBERSHIP, ALLIANCE,
  GENERATIONAL_LINEAGE, HAS_MEMBER,
  ROLE_OWNER, ROLE_BOARD_MEMBER, ROLE_OPERATOR, ROLE_MEMBER,
  ROLE_UPSTREAM, ROLE_DOWNSTREAM,
  ATL_LATITUDE, ATL_LONGITUDE, ATL_SPATIAL_CRS, ATL_SPATIAL_TYPE, ATL_CONTROLLER,
  ATL_GENMAP_DATA, ATL_PRIMARY_NAME, ATL_NAME_LABEL,
  GeoFeatureClient, GeoClaimClient, type GeoRelation,
  agentNameRegistryAbi, agentNameResolverAbi,
} from '@smart-agent/sdk'
import { agentAccountResolverAbi } from '@smart-agent/sdk'
import { keccak256, toBytes, encodePacked, type PrivateKeyAccount } from 'viem'
import {
  registerAgentAsSelf,
  writeAgentPropertiesAsSelf,
  mintSelfGeoClaim,
  getCounterfactualAddress,
  deterministicEoaFromLabel,
  loadDemoUserAgentIdentity,
  type AgentProperty,
} from './agent-self-register'

const TYPE_ORGANIZATION = keccak256(toBytes('atl:OrganizationAgent'))
const TYPE_HUB = keccak256(toBytes('atl:HubAgent'))

// ─── Agent identity registry (in-memory) ──────────────────────────────
//
// Architectural refactor: every org/hub agent now has its OWN owner EOA
// (deterministic, derived from a stable label). The smart account's
// `initialOwner` is that EOA, and that EOA signs every userOp the agent
// emits. The deployer is NEVER an owner of these accounts.
//
// We keep a per-seed `Map<smartAccountAddress, {eoa, salt}>` so the
// register/setController/setGeo helpers below can look up the right
// signer for each agent. The salt is needed for counterfactual deploy
// via initCode if the userOp lands before any other tx has deployed
// the account.
//
// Label scheme (MUST stay stable across runs and across seed files that
// share addresses — e.g. seed-disciple-networks needs to derive the
// same Catalyst NoCo + Catalyst Hub addresses computed here for seed-
// catalyst). The label prefix `globalchurch:` namespaces this seed.
interface AgentIdentity {
  eoa: PrivateKeyAccount
  salt: bigint
}
const agentIdentities = new Map<`0x${string}`, AgentIdentity>()

function rememberIdentity(smartAccount: `0x${string}`, id: AgentIdentity) {
  agentIdentities.set(smartAccount.toLowerCase() as `0x${string}`, id)
}
function lookupIdentity(smartAccount: `0x${string}`): AgentIdentity {
  const id = agentIdentities.get(smartAccount.toLowerCase() as `0x${string}`)
  if (!id) {
    throw new Error(`[gc-seed] No agent identity registered for ${smartAccount} — call deploy(label, salt) before any resolver write.`)
  }
  return id
}

/**
 * Deploy (counterfactually) a smart account owned by a deterministic EOA
 * derived from `label`. Returns the counterfactual address WITHOUT
 * actually deploying — the account is deployed lazily by the first
 * `registerAgentAsSelf` userOp via `initCode`.
 */
async function deploy(label: string, salt: number): Promise<`0x${string}`> {
  const eoa = deterministicEoaFromLabel(label)
  const saltBig = BigInt(salt)
  const addr = await getCounterfactualAddress(eoa.address, saltBig)
  rememberIdentity(addr, { eoa, salt: saltBig })
  return addr
}

async function register(addr: `0x${string}`, name: string, desc: string, agentType: `0x${string}`) {
  const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
  if (!resolverAddr) return
  try {
    const id = lookupIdentity(addr)
    const client = getPublicClient()
    const isReg = await client.readContract({ address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'isRegistered', args: [addr] }) as boolean
    if (isReg) return
    await registerAgentAsSelf({
      smartAccount: addr,
      signerAccount: id.eoa,
      salt: id.salt,
      name,
      description: desc,
      agentType,
      label: `gc-seed:register(${name})`,
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
  const res = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
  if (!res) return
  try {
    const existing = await getPublicClient().readContract({
      address: res, abi: agentAccountResolverAbi,
      functionName: 'getMultiAddressProperty',
      args: [agentAddr, ATL_CONTROLLER as `0x${string}`],
    }) as string[]
    if (existing.some(a => a.toLowerCase() === walletAddr.toLowerCase())) return
    const id = lookupIdentity(agentAddr)
    await writeAgentPropertiesAsSelf({
      smartAccount: agentAddr,
      signerAccount: id.eoa,
      salt: id.salt,
      properties: [
        { kind: 'multiAddress-append', predicate: ATL_CONTROLLER as `0x${string}`, value: walletAddr as `0x${string}` },
      ],
      label: `gc-seed:setController(${agentAddr})`,
    })
  } catch (_e) { console.warn(`[gc-seed] Controller failed:`, _e) }
}

// Hub config setString removed — static fallback profiles provide nav config.

async function setGeo(addr: `0x${string}`, lat: string, lon: string) {
  const resolver = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
  if (!resolver) return
  try {
    const id = lookupIdentity(addr)
    // Batch all four geo writes into ONE userOp so we don't pay the
    // EntryPoint overhead 4x per agent.
    const props: AgentProperty[] = [
      { kind: 'string', predicate: ATL_LATITUDE as `0x${string}`,    value: lat },
      { kind: 'string', predicate: ATL_LONGITUDE as `0x${string}`,   value: lon },
      { kind: 'string', predicate: ATL_SPATIAL_CRS as `0x${string}`, value: 'EPSG:4326' },
      { kind: 'string', predicate: ATL_SPATIAL_TYPE as `0x${string}`, value: 'Point' },
    ]
    await writeAgentPropertiesAsSelf({
      smartAccount: addr,
      signerAccount: id.eoa,
      salt: id.salt,
      properties: props,
      label: `gc-seed:setGeo(${addr})`,
    })
  } catch (_e) { console.warn(`[gc-seed] Geo failed for ${addr}:`, _e) }
}

/** See seed-catalyst-onchain.ts for the design notes — same shape here. */
async function mintGeoClaim(args: {
  subject: `0x${string}`
  cityKey: string
  relation: GeoRelation
  confidence: number
}) {
  // Look up the subject's signer identity: org agents are in the
  // in-memory map, person agents have their owner EOA in the local
  // users DB. If neither, this is an agent we don't control here.
  let identity = agentIdentities.get(args.subject.toLowerCase() as `0x${string}`)
  if (!identity) {
    const personId = await loadDemoUserAgentIdentity(args.subject)
    if (personId) identity = personId
  }
  if (!identity) {
    console.warn(`[gc-seed] geo-claim skip: no identity for subject ${args.subject}`)
    return
  }
  await mintSelfGeoClaim({
    subject: args.subject,
    signerAccount: identity.eoa,
    salt: identity.salt,
    cityKey: args.cityKey,
    relation: args.relation,
    confidence: args.confidence,
    logPrefix: '[gc-seed]',
  })
}

async function setGenMapData(addr: `0x${string}`, data: string) {
  const resolver = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
  if (!resolver) return
  try {
    const id = lookupIdentity(addr)
    await writeAgentPropertiesAsSelf({
      smartAccount: addr,
      signerAccount: id.eoa,
      salt: id.salt,
      properties: [
        { kind: 'string', predicate: ATL_GENMAP_DATA as `0x${string}`, value: data },
      ],
      label: `gc-seed:setGenMapData(${addr})`,
    })
  } catch (_e) { console.warn(`[gc-seed] GenMap data failed for ${addr}:`, _e) }
}

function upsertUser(u: { id: string; name: string; email: string; wallet: string; did: string }) {
  const existing = db.select().from(schema.localUserAccounts).where(eq(schema.localUserAccounts.id, u.id)).get()
  if (!existing) {
    db.insert(schema.localUserAccounts).values({ id: u.id, email: u.email, name: u.name, walletAddress: u.wallet, did: u.did }).run()
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
    // Local Grace Community Church + sub-ministry leaders
    { id: 'gc-user-001', name: 'Pastor James',         email: 'james@gracecommunity.org',  wallet: '0x0000000000000000000000000000000000010001', did: 'did:demo:gc-001' },
    { id: 'gc-user-006', name: 'Pastor Mike Thompson', email: 'mike@gracecommunity.org',   wallet: '0x0000000000000000000000000000000000010006', did: 'did:demo:gc-006' },
    { id: 'gc-user-007', name: 'Janet Wilson',         email: 'janet@gracecommunity.org',  wallet: '0x0000000000000000000000000000000000010007', did: 'did:demo:gc-007' },
    { id: 'gc-user-008', name: 'Marcus Lee',           email: 'marcus@gracecommunity.org', wallet: '0x0000000000000000000000000000000000010008', did: 'did:demo:gc-008' },
    // Network + denomination + mission-agency + funding leaders
    { id: 'gc-user-002', name: 'Dr. Sarah Mitchell',   email: 'sarah@sbc.net',             wallet: '0x0000000000000000000000000000000000010002', did: 'did:demo:gc-002' },
    { id: 'gc-user-003', name: 'Dan Busby',            email: 'dan@ecfa.org',              wallet: '0x0000000000000000000000000000000000010003', did: 'did:demo:gc-003' },
    { id: 'gc-user-004', name: 'John Chesnut',         email: 'john@wycliffe.org',         wallet: '0x0000000000000000000000000000000000010004', did: 'did:demo:gc-004' },
    { id: 'gc-user-005', name: 'David Wills',          email: 'david@ncf.org',             wallet: '0x0000000000000000000000000000000000010005', did: 'did:demo:gc-005' },
  ]
  for (const u of USERS) upsertUser(u)

  // ─── Ensure community users have wallets + person agents ───────────
  console.log('[gc-seed] Ensuring community users provisioned...')
  const { ensureCommunityUsers } = await import('./lookup-users')
  const gcUsers = await ensureCommunityUsers('gc-user-')
  const userMap = new Map(gcUsers.map(u => [u.key, u]))

  const paPastorJames   = userMap.get('gc-user-001')!.personAgentAddress as `0x${string}`
  const paSarahMitchell = userMap.get('gc-user-002')!.personAgentAddress as `0x${string}`
  const paDanBusby      = userMap.get('gc-user-003')!.personAgentAddress as `0x${string}`
  const paJohnChesnut   = userMap.get('gc-user-004')!.personAgentAddress as `0x${string}`
  const paDavidWills    = userMap.get('gc-user-005')!.personAgentAddress as `0x${string}`
  const paMikeThompson  = userMap.get('gc-user-006')!.personAgentAddress as `0x${string}`
  const paJanetWilson   = userMap.get('gc-user-007')!.personAgentAddress as `0x${string}`
  const paMarcusLee     = userMap.get('gc-user-008')!.personAgentAddress as `0x${string}`

  // ─── Deploy Org Smart Accounts ───────────────────────────────────
  console.log('[gc-seed] Deploying org smart accounts...')
  // Organizations (salt 300001+). Each org owns ITSELF via a
  // deterministic EOA derived from the org's label — that EOA is the
  // smart account's `initialOwner` AND the userOp signer for every
  // resolver write below. Stable labels = stable addresses across runs.
  const gcNetwork     = await deploy('globalchurch:network',         300001)
  const graceChurch   = await deploy('globalchurch:graceChurch',     300002)
  const sbc           = await deploy('globalchurch:sbc',             300003)
  const ecfa          = await deploy('globalchurch:ecfa',            300004)
  const wycliffe      = await deploy('globalchurch:wycliffe',        300005)
  const ncf           = await deploy('globalchurch:ncf',             300006)
  const youthMinistry = await deploy('globalchurch:youthMinistry',   300007)
  const smallGroups   = await deploy('globalchurch:smallGroups',     300008)
  const missionsTeam  = await deploy('globalchurch:missionsTeam',    300009)

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
    // Local church + sub-ministries — each ministry has its own director;
    // James only owns the parent church (no James-everywhere).
    [graceChurch,    userMap.get('gc-user-001')!.walletAddress, 'James → Grace Community'],
    [youthMinistry,  userMap.get('gc-user-006')!.walletAddress, 'Mike Thompson → Youth'],
    [smallGroups,    userMap.get('gc-user-007')!.walletAddress, 'Janet Wilson → Small Groups'],
    [missionsTeam,   userMap.get('gc-user-008')!.walletAddress, 'Marcus Lee → Missions'],
    // Network — both senior leaders.
    [gcNetwork,      userMap.get('gc-user-001')!.walletAddress, 'James → Network'],
    [gcNetwork,      userMap.get('gc-user-002')!.walletAddress, 'Sarah Mitchell → Network'],
    // Top-level org leaders.
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

  // Geo affiliation — Public GeoClaims (operatesIn / residentOf) bind
  // each Global Church agent to its city's `.geo` feature.
  console.log('[gc-seed] Minting geo claims...')
  await mintGeoClaim({ subject: gcNetwork,     cityKey: 'us/georgia/atlanta',       relation: 'operatesIn', confidence: 100 })
  await mintGeoClaim({ subject: graceChurch,   cityKey: 'us/california/sunvalley',  relation: 'operatesIn', confidence: 100 })
  await mintGeoClaim({ subject: sbc,           cityKey: 'us/tennessee/nashville',   relation: 'operatesIn', confidence: 100 })
  await mintGeoClaim({ subject: ecfa,          cityKey: 'us/virginia/winchester',   relation: 'operatesIn', confidence: 100 })
  await mintGeoClaim({ subject: wycliffe,      cityKey: 'us/florida/orlando',       relation: 'operatesIn', confidence: 100 })
  await mintGeoClaim({ subject: ncf,           cityKey: 'us/georgia/alpharetta',    relation: 'operatesIn', confidence: 100 })
  await mintGeoClaim({ subject: youthMinistry, cityKey: 'us/california/sunvalley',  relation: 'operatesIn', confidence: 100 })
  await mintGeoClaim({ subject: smallGroups,   cityKey: 'us/california/sunvalley',  relation: 'operatesIn', confidence: 100 })
  await mintGeoClaim({ subject: missionsTeam,  cityKey: 'us/california/sunvalley',  relation: 'operatesIn', confidence: 100 })

  // Person agents — distribute the demo users across the org cities so
  // shared-city scoring exercises pairs both within and across hubs.
  const gcPersonGeo: Array<[string, string]> = [
    ['gc-user-001', 'us/california/sunvalley'], // Pastor James
    ['gc-user-002', 'us/tennessee/nashville'],  // Sarah Mitchell
    ['gc-user-003', 'us/virginia/winchester'],  // Dan Busby
    ['gc-user-004', 'us/florida/orlando'],      // John Chesnut
    ['gc-user-005', 'us/georgia/alpharetta'],   // David Wills
    ['gc-user-006', 'us/california/sunvalley'], // Mike Thompson
    ['gc-user-007', 'us/california/sunvalley'], // Janet Wilson
    ['gc-user-008', 'us/california/sunvalley'], // Marcus Lee
  ]
  for (const [uid, cityKey] of gcPersonGeo) {
    const u = userMap.get(uid)
    if (u?.personAgentAddress) {
      await mintGeoClaim({
        subject: u.personAgentAddress as `0x${string}`,
        cityKey,
        relation: 'residentOf',
        confidence: 90,
      })
    }
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

  // Person → Org governance + membership.
  // OWNER edges mirror ATL_CONTROLLER one-for-one. Sub-ministries each have
  // their own director (no James-everywhere); James only owns the parent
  // church + sits on the network alongside Sarah Mitchell.
  await createEdge(paPastorJames,   graceChurch,   ORGANIZATION_GOVERNANCE, [ROLE_OWNER])
  await createEdge(paMikeThompson,  youthMinistry, ORGANIZATION_GOVERNANCE, [ROLE_OWNER])
  await createEdge(paJanetWilson,   smallGroups,   ORGANIZATION_GOVERNANCE, [ROLE_OWNER])
  await createEdge(paMarcusLee,     missionsTeam,  ORGANIZATION_GOVERNANCE, [ROLE_OWNER])
  await createEdge(paPastorJames,   gcNetwork,     ORGANIZATION_GOVERNANCE, [ROLE_OWNER])
  await createEdge(paSarahMitchell, gcNetwork,     ORGANIZATION_GOVERNANCE, [ROLE_OWNER])
  await createEdge(paSarahMitchell, sbc,           ORGANIZATION_GOVERNANCE, [ROLE_OWNER])
  await createEdge(paDanBusby,      ecfa,          ORGANIZATION_GOVERNANCE, [ROLE_OWNER])
  await createEdge(paJohnChesnut,   wycliffe,      ORGANIZATION_GOVERNANCE, [ROLE_OWNER])
  await createEdge(paDavidWills,    ncf,           ORGANIZATION_GOVERNANCE, [ROLE_OWNER])

  // Membership edges layered on top of the governance graph — sub-ministry
  // directors are members of the parent church; senior staff sit on the
  // network board.
  await createEdge(paMikeThompson, graceChurch, ORGANIZATION_MEMBERSHIP, [ROLE_MEMBER])
  await createEdge(paJanetWilson,  graceChurch, ORGANIZATION_MEMBERSHIP, [ROLE_MEMBER])
  await createEdge(paMarcusLee,    graceChurch, ORGANIZATION_MEMBERSHIP, [ROLE_MEMBER])
  await createEdge(paDanBusby,     gcNetwork,   ORGANIZATION_MEMBERSHIP, [ROLE_MEMBER])
  await createEdge(paJohnChesnut,  gcNetwork,   ORGANIZATION_MEMBERSHIP, [ROLE_MEMBER])
  await createEdge(paDavidWills,   gcNetwork,   ORGANIZATION_MEMBERSHIP, [ROLE_BOARD_MEMBER])

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
  const hubGC = await deploy('globalchurch:hub', 390001)
  await register(hubGC, 'Global.Church Hub', 'Global.Church network hub — church collaboration, stewardship, mission agencies', TYPE_HUB)

  // HAS_MEMBER edges
  console.log('[gc-seed] Creating HAS_MEMBER edges...')
  const allGcAgents = [
    gcNetwork, graceChurch, sbc, ecfa, wycliffe, ncf,
    youthMinistry, smallGroups, missionsTeam,
    paPastorJames, paSarahMitchell, paDanBusby, paJohnChesnut, paDavidWills,
    paMikeThompson, paJanetWilson, paMarcusLee,
  ]
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
        // 1. Name registry writes (`AgentNameRegistry.register` +
        //    `AgentNameResolver.setAddr`) remain deployer-signed for this
        //    pass: the deployer is set as the owner of `globalchurch.agent`
        //    at the root level so it has parent-auth to register all the
        //    sub-labels. Switching the name-registry parent ownership to
        //    individual agent EOAs is a separate refactor (see report).
        const exists = await pc.readContract({ address: nameRegistryAddr, abi: agentNameRegistryAbi, functionName: 'recordExists', args: [cn] }) as boolean
        if (!exists) {
          const h = await wc.writeContract({ address: nameRegistryAddr, abi: agentNameRegistryAbi, functionName: 'register', args: [parentNode, label, ownerAddr, nameResolverAddr, 0n] })
          await pc.waitForTransactionReceipt({ hash: h })
        }
        try { await wc.writeContract({ address: nameResolverAddr, abi: agentNameResolverAbi, functionName: 'setAddr', args: [cn, ownerAddr] }) } catch { /* */ }

        // 2. ATL_NAME_LABEL + ATL_PRIMARY_NAME on the resolver MUST be
        //    written as the agent itself — that's an `onlyAgentOwner`-
        //    gated path. Look up the identity in the in-memory map; if
        //    `ownerAddr` is not an agent we deployed in this seed (e.g.
        //    it's the deployer's EOA for the root `globalchurch.agent`,
        //    or a person agent owned by generate-wallet which lives in
        //    a different identity space), skip the resolver writes —
        //    the per-agent primary name is set elsewhere in that case.
        if (resolverAddr) {
          const id = agentIdentities.get(ownerAddr.toLowerCase() as `0x${string}`)
          if (id) {
            try {
              await writeAgentPropertiesAsSelf({
                smartAccount: ownerAddr,
                signerAccount: id.eoa,
                salt: id.salt,
                properties: [
                  { kind: 'string', predicate: ATL_NAME_LABEL as `0x${string}`,   value: label },
                  { kind: 'string', predicate: ATL_PRIMARY_NAME as `0x${string}`, value: fullName },
                ],
                label: `gc-seed:regName(${label})`,
              })
            } catch { /* idempotent: silent on second pass */ }
          }
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
      await regName(gcNode, 'james',   paPastorJames,   'james.globalchurch.agent')
      await regName(gcNode, 'sarah',   paSarahMitchell, 'sarah.globalchurch.agent')
      await regName(gcNode, 'dan',     paDanBusby,      'dan.globalchurch.agent')
      await regName(gcNode, 'chesnut', paJohnChesnut,   'chesnut.globalchurch.agent')
      await regName(gcNode, 'wills',   paDavidWills,    'wills.globalchurch.agent')
      await regName(gcNode, 'mike',    paMikeThompson,  'mike.globalchurch.agent')
      await regName(gcNode, 'janet',   paJanetWilson,   'janet.globalchurch.agent')
      await regName(gcNode, 'marcus',  paMarcusLee,     'marcus.globalchurch.agent')
      console.log('[gc-seed] Names registered under globalchurch.agent')
    }
  }

  console.log('[gc-seed] Global.Church community deployed: 15 agents, 32+ on-chain edges')
}
