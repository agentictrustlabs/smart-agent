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
  ROLE_STRATEGIC_PARTNER, ROLE_UPSTREAM, ROLE_DOWNSTREAM,
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

// ─── Agent identity registry — same pattern as gc-seed ────────────────
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
    throw new Error(`[cil-seed] No agent identity registered for ${smartAccount} — call deploy(label, salt) before any resolver write.`)
  }
  return id
}

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
      name, description: desc, agentType,
      label: `cil-seed:register(${name})`,
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
      label: `cil-seed:setController(${agentAddr})`,
    })
  } catch (_e) { console.warn(`[cil-seed] Controller failed:`, _e) }
}

// Hub config setString removed — static fallback profiles provide nav config.

async function setGeo(addr: `0x${string}`, lat: string, lon: string) {
  const resolver = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
  if (!resolver) return
  try {
    const id = lookupIdentity(addr)
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
      label: `cil-seed:setGeo(${addr})`,
    })
  } catch (_e) { console.warn(`[cil-seed] Geo failed for ${addr}:`, _e) }
}

/** Mint a self-asserted geo claim from `subject`. See agent-self-register
 *  for the userOp routing — the call lands as `msg.sender == subject` so
 *  GeoClaimRegistry's `_isAuthorized` accepts it without needing the
 *  deployer to be a co-owner. */
async function mintGeoClaim(args: {
  subject: `0x${string}`
  cityKey: string
  relation: GeoRelation
  confidence: number
}) {
  let identity = agentIdentities.get(args.subject.toLowerCase() as `0x${string}`)
  if (!identity) {
    const personId = await loadDemoUserAgentIdentity(args.subject)
    if (personId) identity = personId
  }
  if (!identity) {
    console.warn(`[cil-seed] geo-claim skip: no identity for subject ${args.subject}`)
    return
  }
  await mintSelfGeoClaim({
    subject: args.subject,
    signerAccount: identity.eoa,
    salt: identity.salt,
    cityKey: args.cityKey,
    relation: args.relation,
    confidence: args.confidence,
    logPrefix: '[cil-seed]',
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
      label: `cil-seed:setGenMapData(${addr})`,
    })
  } catch (_e) { console.warn(`[cil-seed] GenMap data failed for ${addr}:`, _e) }
}

function upsertUser(u: { id: string; name: string; email: string; wallet: string; did: string }) {
  const existing = db.select().from(schema.localUserAccounts).where(eq(schema.localUserAccounts.id, u.id)).get()
  if (!existing) {
    db.insert(schema.localUserAccounts).values({ id: u.id, email: u.email, name: u.name, walletAddress: u.wallet, did: u.did }).run()
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
    // CIL HQ — Admin + Funder
    { id: 'cil-user-006', name: 'John F. Kim',    email: 'john@cil.org',          wallet: '0x00000000000000000000000000000000000c0006', did: 'did:demo:cil-006' },
    { id: 'cil-user-007', name: 'Paul Martel',    email: 'paul@funder.org',       wallet: '0x00000000000000000000000000000000000c0007', did: 'did:demo:cil-007' },
    // ILAD field operations
    { id: 'cil-user-001', name: 'Cameron Henrion', email: 'cameron@ilad.org',     wallet: '0x00000000000000000000000000000000000c0001', did: 'did:demo:cil-001' },
    { id: 'cil-user-002', name: 'Nick Courchesne', email: 'nick@ilad.org',        wallet: '0x00000000000000000000000000000000000c0002', did: 'did:demo:cil-002' },
    { id: 'cil-user-005', name: 'Yaw',             email: 'yaw@ilad-togo.org',    wallet: '0x00000000000000000000000000000000000c0005', did: 'did:demo:cil-005' },
    // Portfolio business owners
    { id: 'cil-user-003', name: 'Afia Mensah',    email: 'afia@market.tg',        wallet: '0x00000000000000000000000000000000000c0003', did: 'did:demo:cil-003' },
    { id: 'cil-user-004', name: 'Kossi Agbeko',   email: 'kossi@repairs.tg',      wallet: '0x00000000000000000000000000000000000c0004', did: 'did:demo:cil-004' },
    // Cohort coordinators — one per wave so each cohort has a distinct owner
    { id: 'cil-user-008', name: 'Akosua Boateng', email: 'akosua@cil.org',        wallet: '0x00000000000000000000000000000000000c0008', did: 'did:demo:cil-008' },
    { id: 'cil-user-009', name: 'Kwame Asante',   email: 'kwame@cil.org',         wallet: '0x00000000000000000000000000000000000c0009', did: 'did:demo:cil-009' },
  ]
  for (const u of USERS) upsertUser(u)

  // ─── Ensure community users have wallets + person agents ───────────
  console.log('[cil-seed] Ensuring community users provisioned...')
  const { ensureCommunityUsers } = await import('./lookup-users')
  const cilUsers = await ensureCommunityUsers('cil-user-')
  const userMap = new Map(cilUsers.map(u => [u.key, u]))

  const paCameron = userMap.get('cil-user-001')!.personAgentAddress as `0x${string}`
  const paNick    = userMap.get('cil-user-002')!.personAgentAddress as `0x${string}`
  const paAfia    = userMap.get('cil-user-003')!.personAgentAddress as `0x${string}`
  const paKossi   = userMap.get('cil-user-004')!.personAgentAddress as `0x${string}`
  const paYaw     = userMap.get('cil-user-005')!.personAgentAddress as `0x${string}`
  const paJohn    = userMap.get('cil-user-006')!.personAgentAddress as `0x${string}`
  const paPaul    = userMap.get('cil-user-007')!.personAgentAddress as `0x${string}`
  const paAkosua  = userMap.get('cil-user-008')!.personAgentAddress as `0x${string}`
  const paKwame   = userMap.get('cil-user-009')!.personAgentAddress as `0x${string}`

  // ─── Deploy Org Smart Accounts ───────────────────────────────────
  console.log('[cil-seed] Deploying org smart accounts...')

  // Organizations (salt 400001+). Stable per-org labels: each org's
  // smart account is owned by a deterministic EOA derived from its
  // label. Re-runs of the seed produce the same address.
  const cil         = await deploy('cil:cil',         400001)
  const ilad        = await deploy('cil:ilad',        400002)
  const ravah       = await deploy('cil:ravah',       400003)
  const afiaMarket  = await deploy('cil:afiaMarket',  400004)
  const kossiRepair = await deploy('cil:kossiRepair', 400005)
  const lomeCluster = await deploy('cil:lomeCluster', 400006)
  const wave1       = await deploy('cil:wave1',       400007)
  const wave2       = await deploy('cil:wave2',       400008)

  console.log('[cil-seed] Smart accounts deployed. CIL:', cil, 'ILAD:', ilad)

  // ─── Register in Resolver ─────────────────────────────────────────
  console.log('[cil-seed] Registering in resolver...')
  await register(cil,         'Collective Impact Labs', 'Top-level investment and impact organization', TYPE_ORGANIZATION)
  await register(ilad,        'ILAD', 'Implementing partner in Togo', TYPE_ORGANIZATION)
  await register(ravah,       'Ravah Capital Togo', 'Capital deployment vehicle for Togo portfolio', TYPE_ORGANIZATION)
  await register(afiaMarket,  "Afia's Market", 'Portfolio business — market stall in Grand Marche', TYPE_ORGANIZATION)
  await register(kossiRepair, 'Kossi Mobile Repairs', 'Portfolio business — mobile repair shop', TYPE_ORGANIZATION)
  await register(lomeCluster,     'Lomé Business Cluster', 'Cohort gathering point in Lome', TYPE_ORGANIZATION)
  await register(wave1,       'Wave 1 Cohort', 'First batch of funded businesses', TYPE_ORGANIZATION)
  await register(wave2,       'Wave 2 Cohort', 'Second batch of funded businesses', TYPE_ORGANIZATION)

  // Person agents already registered by generateDemoWallet — skip re-registration
  // Person agent controllers already set by generateDemoWallet — skip

  // ─── Demo-user EOA → Org controller links ─────────────────────────
  // Lets demo users approve PROPOSED relationship requests aimed at the
  // orgs they administer (the /relationships page only surfaces a
  // Confirm button when the signed-in user's wallet sits in the target
  // agent's ATL_CONTROLLER list).
  const ctrl: Array<[`0x${string}`, string, string]> = [
    // CIL HQ — Admin + Funder co-own.
    [cil,         userMap.get('cil-user-006')!.walletAddress, 'John Kim → CIL'],
    [cil,         userMap.get('cil-user-007')!.walletAddress, 'Paul → CIL'],
    // ILAD field operations — Operations Lead + Reviewer co-own; Yaw is
    // member-level, not an ILAD owner (he runs the local cluster).
    [ilad,        userMap.get('cil-user-001')!.walletAddress, 'Cameron → ILAD'],
    [ilad,        userMap.get('cil-user-002')!.walletAddress, 'Nick → ILAD'],
    // Portfolio business owners
    [afiaMarket,  userMap.get('cil-user-003')!.walletAddress, "Afia → Afia's Market"],
    [kossiRepair, userMap.get('cil-user-004')!.walletAddress, 'Kossi → Repairs'],
    // Lomé Business Cluster — Yaw runs it locally as Cluster Manager.
    [lomeCluster, userMap.get('cil-user-005')!.walletAddress, 'Yaw → Lomé Cluster'],
    // Cohorts — distinct coordinator per wave (no double-up on John).
    [wave1,       userMap.get('cil-user-008')!.walletAddress, 'Akosua → Wave 1'],
    [wave2,       userMap.get('cil-user-009')!.walletAddress, 'Kwame → Wave 2'],
    // Capital vehicle — funder
    [ravah,       userMap.get('cil-user-007')!.walletAddress, 'Paul → Ravah'],
  ]
  for (const [agent, wallet, label] of ctrl) {
    if (!wallet) continue
    await setController(agent, wallet)
    console.log(`[cil-seed] controller: ${label}`)
  }

  // ─── Geospatial Metadata ──────────────────────────────────────────
  console.log('[cil-seed] Setting geospatial metadata...')
  await setGeo(cil,         '40.7128', '-74.0060')   // NYC HQ
  await setGeo(ilad,        '6.1319',  '1.2228')     // Lome
  await setGeo(ravah,       '6.1375',  '1.2123')
  await setGeo(afiaMarket,  '6.1280',  '1.2310')     // Grand Marche area
  await setGeo(kossiRepair, '6.1350',  '1.2250')
  await setGeo(lomeCluster,     '6.1340',  '1.2200')
  await setGeo(wave1,       '6.1300',  '1.2280')
  await setGeo(wave2,       '6.1360',  '1.2190')

  // Geo affiliation — Public GeoClaims (operatesIn / residentOf) bind
  // each CIL agent to its city's `.geo` feature. See seed-catalyst-onchain
  // for the design notes (replaces the legacy atl:city/region/country path).
  console.log('[cil-seed] Minting geo claims...')
  await mintGeoClaim({ subject: cil,         cityKey: 'us/newyork/newyork', relation: 'operatesIn', confidence: 100 })
  await mintGeoClaim({ subject: ilad,        cityKey: 'tg/maritime/lome',   relation: 'operatesIn', confidence: 100 })
  await mintGeoClaim({ subject: ravah,       cityKey: 'tg/maritime/lome',   relation: 'operatesIn', confidence: 100 })
  await mintGeoClaim({ subject: afiaMarket,  cityKey: 'tg/maritime/lome',   relation: 'operatesIn', confidence: 100 })
  await mintGeoClaim({ subject: kossiRepair, cityKey: 'tg/maritime/lome',   relation: 'operatesIn', confidence: 100 })
  await mintGeoClaim({ subject: lomeCluster, cityKey: 'tg/maritime/lome',   relation: 'operatesIn', confidence: 100 })
  await mintGeoClaim({ subject: wave1,       cityKey: 'tg/maritime/lome',   relation: 'operatesIn', confidence: 100 })
  await mintGeoClaim({ subject: wave2,       cityKey: 'tg/maritime/lome',   relation: 'operatesIn', confidence: 100 })

  // Person agents — every CIL demo user is anchored in Lomé so the
  // panel scores same-city rich-overlap among the cohort, with cross-
  // hub trust (NYC) emerging only via shared org memberships.
  for (const u of cilUsers) {
    if (u.personAgentAddress) {
      await mintGeoClaim({
        subject: u.personAgentAddress as `0x${string}`,
        cityKey: 'tg/maritime/lome',
        relation: 'residentOf',
        confidence: 90,
      })
    }
  }

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
    console.log('[cil-seed] On-chain relationships already complete — skipping edges')
  } else {
  console.log('[cil-seed] Creating on-chain relationships...')

  // Person → Org governance + membership.
  // OWNER edges mirror ATL_CONTROLLER one-for-one so any owner can
  // approve PROPOSED requests aimed at their org.
  await createEdge(paJohn,    cil,         ORGANIZATION_GOVERNANCE,  [ROLE_OWNER])
  await createEdge(paPaul,    cil,         ORGANIZATION_GOVERNANCE,  [ROLE_OWNER])
  await createEdge(paCameron, ilad,        ORGANIZATION_GOVERNANCE,  [ROLE_OWNER])
  await createEdge(paNick,    ilad,        ORGANIZATION_GOVERNANCE,  [ROLE_OWNER])
  await createEdge(paYaw,     lomeCluster, ORGANIZATION_GOVERNANCE,  [ROLE_OWNER])
  await createEdge(paAfia,    afiaMarket,  ORGANIZATION_GOVERNANCE,  [ROLE_OWNER])
  await createEdge(paKossi,   kossiRepair, ORGANIZATION_GOVERNANCE,  [ROLE_OWNER])
  await createEdge(paAkosua,  wave1,       ORGANIZATION_GOVERNANCE,  [ROLE_OWNER])
  await createEdge(paKwame,   wave2,       ORGANIZATION_GOVERNANCE,  [ROLE_OWNER])
  await createEdge(paPaul,    ravah,       ORGANIZATION_GOVERNANCE,  [ROLE_OWNER])

  // Membership edges layered on top of the governance graph.
  await createEdge(paCameron, ravah,       ORGANIZATION_MEMBERSHIP, [ROLE_MEMBER])
  await createEdge(paNick,    ilad,        ORGANIZATION_MEMBERSHIP, [ROLE_MEMBER])
  await createEdge(paYaw,     ilad,        ORGANIZATION_MEMBERSHIP, [ROLE_MEMBER])
  await createEdge(paAfia,    wave1,       ORGANIZATION_MEMBERSHIP,  [ROLE_MEMBER])
  await createEdge(paKossi,   wave1,       ORGANIZATION_MEMBERSHIP,  [ROLE_MEMBER])

  // Org → Org ALLIANCE (5 edges)
  await createEdge(cil,     ilad,    ALLIANCE, [ROLE_STRATEGIC_PARTNER])
  await createEdge(cil,     ravah,   ALLIANCE, [ROLE_STRATEGIC_PARTNER])
  await createEdge(ilad,    lomeCluster, ALLIANCE, [ROLE_STRATEGIC_PARTNER])
  await createEdge(lomeCluster, wave1,   ALLIANCE, [ROLE_STRATEGIC_PARTNER])
  await createEdge(lomeCluster, wave2,   ALLIANCE, [ROLE_STRATEGIC_PARTNER])

  // Org → Business GENERATIONAL_LINEAGE (2 edges)
  await createEdge(wave1, afiaMarket,  GENERATIONAL_LINEAGE, [ROLE_UPSTREAM, ROLE_DOWNSTREAM])
  await createEdge(wave1, kossiRepair, GENERATIONAL_LINEAGE, [ROLE_UPSTREAM, ROLE_DOWNSTREAM])
  } // end of edge creation else block

  // ─── Org → User cross-delegations ────────────────────────────────
  // For every ORG_GOVERNANCE owner edge, mint a signed Org→user-smart-account
  // delegation and persist it on-chain so admin users can act for the org
  // via their own session (no DEPLOYER_PRIVATE_KEY shortcut at runtime).
  console.log('[cil-seed] Seeding Org→User cross-delegations...')
  try {
    const { seedOrgCrossDelegations } = await import('./seed-org-delegations')
    const created = await seedOrgCrossDelegations([
      { orgAddress: cil,         ownerUserId: 'cil-user-006' }, // paJohn
      { orgAddress: cil,         ownerUserId: 'cil-user-007' }, // paPaul
      { orgAddress: ilad,        ownerUserId: 'cil-user-001' }, // paCameron
      { orgAddress: ilad,        ownerUserId: 'cil-user-002' }, // paNick
      { orgAddress: lomeCluster, ownerUserId: 'cil-user-005' }, // paYaw
      { orgAddress: afiaMarket,  ownerUserId: 'cil-user-003' }, // paAfia
      { orgAddress: kossiRepair, ownerUserId: 'cil-user-004' }, // paKossi
      { orgAddress: wave1,       ownerUserId: 'cil-user-008' }, // paAkosua
      { orgAddress: wave2,       ownerUserId: 'cil-user-009' }, // paKwame
      { orgAddress: ravah,       ownerUserId: 'cil-user-007' }, // paPaul
    ])
    console.log(`[cil-seed] Cross-delegations created: ${created}`)
  } catch (err) {
    console.warn('[cil-seed] Cross-delegation seed failed:', (err as Error).message)
  }

  // ─── Hub Agent ─────────────────────────────────────────────���────
  console.log('[cil-seed] Deploying hub agent...')
  const hubMission = await deploy('cil:hub', 490001)
  await register(hubMission, 'Mission Collective Hub', 'Mission Collective — revenue-sharing capital deployment, ILAD operations, business health monitoring', TYPE_HUB)

  // Hub governance — paCameron (cil-user-001) is the operating admin.
  await createEdge(paCameron, hubMission, ORGANIZATION_GOVERNANCE, [ROLE_OWNER])

  // HAS_MEMBER edges — connect all agents to the hub
  console.log('[cil-seed] Creating HAS_MEMBER edges...')
  const allCilAgents = [
    cil, ilad, ravah, afiaMarket, kossiRepair, lomeCluster, wave1, wave2,
    paCameron, paNick, paAfia, paKossi, paYaw, paJohn, paPaul, paAkosua, paKwame,
  ]
  for (const agent of allCilAgents) {
    await createEdge(hubMission, agent, HAS_MEMBER as `0x${string}`, [ROLE_MEMBER])
  }

  // Hub cross-delegation (so seedProposals can act as the hub via cil-user-001).
  try {
    const { seedOrgCrossDelegations } = await import('./seed-org-delegations')
    await seedOrgCrossDelegations([
      { orgAddress: hubMission, ownerUserId: 'cil-user-001' },
    ])
  } catch (err) {
    console.warn('[cil-seed] Hub cross-delegation seed failed:', (err as Error).message)
  }

  // ─── Agent Naming (.agent namespace) ─────────────────────────────
  const nameRegistryAddr = process.env.AGENT_NAME_REGISTRY_ADDRESS as `0x${string}`
  const nameResolverAddr = process.env.AGENT_NAME_RESOLVER_ADDRESS as `0x${string}`
  const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`

  if (nameRegistryAddr && nameResolverAddr) {
    console.log('[cil-seed] Registering .agent names...')
    const wc = getWalletClient()
    const pc = getPublicClient()

    async function regName(parentNode: `0x${string}`, label: string, ownerAddr: `0x${string}`, fullName: string) {
      const lh = keccak256(toBytes(label))
      const cn = keccak256(encodePacked(['bytes32', 'bytes32'], [parentNode, lh]))
      try {
        // 1. Name-registry write — stays deployer-signed (deployer is
        //    owner of `mission.agent` parent; see report for separate
        //    refactor of name-registry parent ownership).
        const exists = await pc.readContract({ address: nameRegistryAddr, abi: agentNameRegistryAbi, functionName: 'recordExists', args: [cn] }) as boolean
        if (!exists) {
          const h = await wc.writeContract({ address: nameRegistryAddr, abi: agentNameRegistryAbi, functionName: 'register', args: [parentNode, label, ownerAddr, nameResolverAddr, 0n] })
          await pc.waitForTransactionReceipt({ hash: h })
        }
        try { await wc.writeContract({ address: nameResolverAddr, abi: agentNameResolverAbi, functionName: 'setAddr', args: [cn, ownerAddr] }) } catch { /* */ }

        // 2. Resolver name-label + primary-name MUST be agent-signed.
        //    Look up identity; skip silently if `ownerAddr` is not an
        //    agent we deployed in this seed.
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
                label: `cil-seed:regName(${label})`,
              })
            } catch { /* idempotent: silent on second pass */ }
          }
        }
        return cn
      } catch (e) { console.warn(`[cil-seed] Name reg failed for ${label}:`, e); return cn }
    }

    // Get root node
    const agentRoot = await pc.readContract({ address: nameRegistryAddr, abi: agentNameRegistryAbi, functionName: 'AGENT_ROOT' }) as `0x${string}`

    // Register mission.agent under root. Owner is the DEPLOYER (not the
    // hub agent) so the onboarding wizard's deployer-signed sub-name
    // calls succeed without needing UserOps from the hub's smart account.
    const deployerOwner = wc.account!.address as `0x${string}`
    const missionNode = await regName(agentRoot, 'mission', deployerOwner, 'mission.agent')
    if (missionNode) {
      await regName(missionNode, 'cil', cil, 'cil.mission.agent')
      await regName(missionNode, 'ilad', ilad, 'ilad.mission.agent')
      await regName(missionNode, 'ravah', ravah, 'ravah.mission.agent')
      await regName(missionNode, 'afia', afiaMarket, 'afia.mission.agent')
      await regName(missionNode, 'kossi', kossiRepair, 'kossi.mission.agent')
      await regName(missionNode, 'lome', lomeCluster, 'lome.mission.agent')
      await regName(missionNode, 'wave1', wave1, 'wave1.mission.agent')
      await regName(missionNode, 'wave2', wave2, 'wave2.mission.agent')
      await regName(missionNode, 'cameron', paCameron, 'cameron.mission.agent')
      await regName(missionNode, 'nick', paNick, 'nick.mission.agent')
      await regName(missionNode, 'afia-m', paAfia, 'afia-m.mission.agent')
      await regName(missionNode, 'kossi-a', paKossi, 'kossi-a.mission.agent')
      await regName(missionNode, 'yaw', paYaw, 'yaw.mission.agent')
      await regName(missionNode, 'john', paJohn, 'john.mission.agent')
      await regName(missionNode, 'paul', paPaul, 'paul.mission.agent')
      await regName(missionNode, 'akosua', paAkosua, 'akosua.mission.agent')
      await regName(missionNode, 'kwame', paKwame, 'kwame.mission.agent')
      console.log('[cil-seed] Names registered under mission.agent')
    }
  }

  console.log('[cil-seed] CIL community deployed: 16 agents, 33+ on-chain edges')
}
