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
  ATL_HUB_NAV_CONFIG, ATL_HUB_FEATURES, ATL_HUB_THEME, ATL_HUB_VIEW_MODES, ATL_HUB_GREETING,
} from '@smart-agent/sdk'
import { agentAccountResolverAbi } from '@smart-agent/sdk'
import { keccak256, toBytes } from 'viem'

const TYPE_ORGANIZATION = keccak256(toBytes('atl:OrganizationAgent'))
const TYPE_PERSON = keccak256(toBytes('atl:PersonAgent'))
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

async function setString(addr: `0x${string}`, predicate: `0x${string}`, value: string) {
  const wc = getWalletClient()
  const resolver = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
  if (!resolver) return
  try {
    await wc.writeContract({ address: resolver, abi: agentAccountResolverAbi, functionName: 'setStringProperty', args: [addr, predicate, value] })
  } catch (_e) { console.warn(`[catalyst-seed] setString failed for ${addr}:`, _e) }
}

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

  // ─── Users (DB only) ──────────────────────────────────────────────
  const USERS = [
    { id: 'cat-user-001', name: 'Elena Vasquez', email: 'elena@catalystglobal.org', wallet: '0x00000000000000000000000000000000000b0001', privy: 'did:privy:cat-001' },
    { id: 'cat-user-002', name: 'Linh Nguyen', email: 'linh@catalystglobal.org', wallet: '0x00000000000000000000000000000000000b0002', privy: 'did:privy:cat-002' },
    { id: 'cat-user-003', name: 'Tran Minh', email: 'tran@community.vn', wallet: '0x00000000000000000000000000000000000b0003', privy: 'did:privy:cat-003' },
    { id: 'cat-user-004', name: 'Mai Pham', email: 'mai@community.vn', wallet: '0x00000000000000000000000000000000000b0004', privy: 'did:privy:cat-004' },
    { id: 'cat-user-005', name: 'James Okafor', email: 'james@impactfund.org', wallet: '0x00000000000000000000000000000000000b0005', privy: 'did:privy:cat-005' },
    { id: 'cat-user-006', name: 'Hoa Tran', email: 'hoa@group-sontra.vn', wallet: '0x00000000000000000000000000000000000b0006', privy: 'did:privy:cat-006' },
    { id: 'cat-user-007', name: 'Duc Le', email: 'duc@group-hanhoa.vn', wallet: '0x00000000000000000000000000000000000b0007', privy: 'did:privy:cat-007' },
  ]
  for (const u of USERS) upsertUser(u)

  // ─── Deploy Agent Smart Accounts ──────────────────────────────────
  console.log('[catalyst-seed] Deploying smart accounts...')
  const network = await deploy(200001)
  const hub = await deploy(200002)
  const grpSontra = await deploy(200003)
  const grpHanhoa = await deploy(200004)
  const grpMyke = await deploy(200005)
  const grpThanh = await deploy(200006)
  const grpLien = await deploy(200007)
  const grpNgu = await deploy(200008)
  const grpCam = await deploy(200009)
  const analytics = await deploy(210001)
  const paElena = await deploy(220001)
  const paLinh = await deploy(220002)
  const paTran = await deploy(220003)
  const paMai = await deploy(220004)
  const paJames = await deploy(220005)
  const paHoa = await deploy(220006)
  const paDuc = await deploy(220007)

  console.log('[catalyst-seed] Smart accounts deployed. Network:', network, 'Hub:', hub)

  // ─── Register in Resolver ─────────────────────────────────────────
  console.log('[catalyst-seed] Registering in resolver...')
  await register(network, 'Mekong Catalyst Network', 'Regional coordination for grassroots community development', TYPE_ORGANIZATION)
  await register(hub, 'Da Nang Hub', 'Facilitator hub — community development in Da Nang', TYPE_ORGANIZATION)
  await register(grpSontra, 'Son Tra Group', 'Established group — Son Tra district (G1)', TYPE_ORGANIZATION)
  await register(grpHanhoa, 'Han Hoa Group', 'Established group — Han Hoa ward (G2)', TYPE_ORGANIZATION)
  await register(grpMyke, 'My Khe Group', 'Group — My Khe Beach area (G2)', TYPE_ORGANIZATION)
  await register(grpThanh, 'Thanh Khe Group', 'Group — Thanh Khe district (G1)', TYPE_ORGANIZATION)
  await register(grpLien, 'Lien Chieu Group', 'Group — Lien Chieu district (G2)', TYPE_ORGANIZATION)
  await register(grpNgu, 'Ngu Hanh Son Group', 'Group — Ngu Hanh Son (G3)', TYPE_ORGANIZATION)
  await register(grpCam, 'Cam Le Group', 'Group — Cam Le district (G1)', TYPE_ORGANIZATION)
  await register(analytics, 'Growth Analytics', 'Generational multiplication tracking and movement health', TYPE_AI)
  await register(paElena, 'Elena Vasquez', 'Program Director — Mekong Catalyst Network', TYPE_PERSON)
  await register(paLinh, 'Linh Nguyen', 'Hub Lead — Da Nang Hub', TYPE_PERSON)
  await register(paTran, 'Tran Minh', 'Facilitator — Da Nang Hub', TYPE_PERSON)
  await register(paMai, 'Mai Pham', 'Community Partner — Da Nang Hub', TYPE_PERSON)
  await register(paJames, 'James Okafor', 'Regional Lead — Mekong Network', TYPE_PERSON)
  await register(paHoa, 'Hoa Tran', 'Group Leader — Son Tra Group', TYPE_PERSON)
  await register(paDuc, 'Duc Le', 'Group Leader — Han Hoa Group', TYPE_PERSON)

  // ─── Set ATL_CONTROLLER on person agents (wallet → agent mapping) ──
  console.log('[catalyst-seed] Setting controller predicates...')
  await setController(paElena, '0x00000000000000000000000000000000000b0001')
  await setController(paLinh, '0x00000000000000000000000000000000000b0002')
  await setController(paTran, '0x00000000000000000000000000000000000b0003')
  await setController(paMai, '0x00000000000000000000000000000000000b0004')
  await setController(paJames, '0x00000000000000000000000000000000000b0005')
  await setController(paHoa, '0x00000000000000000000000000000000000b0006')
  await setController(paDuc, '0x00000000000000000000000000000000000b0007')

  // ─── Geospatial Metadata (Da Nang coordinates) ────────────────────
  console.log('[catalyst-seed] Setting geospatial metadata...')
  await setGeo(network, '16.0544', '108.2022')   // Da Nang city-level
  await setGeo(hub, '16.0470', '108.2240')        // Hai Chau central
  await setGeo(grpSontra, '16.1000', '108.2780')  // Son Tra peninsula
  await setGeo(grpHanhoa, '16.0380', '108.2100')  // Hoa Cuong ward
  await setGeo(grpMyke, '16.0590', '108.2480')    // My Khe Beach
  await setGeo(grpThanh, '16.0670', '108.1930')   // Thanh Khe district
  await setGeo(grpLien, '16.0850', '108.1510')    // Lien Chieu district
  await setGeo(grpNgu, '16.0060', '108.2630')     // Ngu Hanh Son
  await setGeo(grpCam, '16.0200', '108.1950')     // Cam Le district

  // ─── Hub Configuration (on-chain) ─────────────────────────────────
  console.log('[catalyst-seed] Writing hub configuration on-chain...')
  await setString(network, ATL_HUB_NAV_CONFIG as `0x${string}`, JSON.stringify([
    { href: '/catalyst', label: 'Home', section: 'primary', exact: true, activePrefixes: ['/', '/catalyst', '/dashboard'] },
    { href: '/circles', label: 'Connect', section: 'primary', activePrefixes: ['/circles', '/catalyst/circles'] },
    { href: '/nurture', label: 'Nurture', section: 'primary', activePrefixes: ['/nurture', '/catalyst/prayer', '/catalyst/grow', '/catalyst/coach'] },
    { href: '/groups', label: 'Build', section: 'primary', activePrefixes: ['/groups', '/catalyst/groups', '/catalyst/members', '/catalyst/map'] },
    { href: '/steward', label: 'Steward', section: 'primary', requiresCapability: 'governance', activePrefixes: ['/steward', '/treasury', '/reviews', '/network', '/trust'] },
    { href: '/activity', label: 'Activity', section: 'primary', activePrefixes: ['/activity', '/catalyst/activities', '/activities'] },
    { href: '/agents', label: 'Agents', section: 'admin', requiresCapability: 'agents' },
    { href: '/settings', label: 'Settings', section: 'admin', requiresCapability: 'settings' },
    { href: '/me', label: 'Profile', section: 'personal' },
  ]))
  await setString(network, ATL_HUB_FEATURES as `0x${string}`, JSON.stringify({ circles: true, prayer: true, grow: true, coaching: true, genmap: true, activities: true, members: true, map: true }))
  await setString(network, ATL_HUB_THEME as `0x${string}`, JSON.stringify({ accent: '#8b5e3c', accentLight: 'rgba(139,94,60,0.10)', bg: '#faf8f3', headerBg: '#ffffff', text: '#5c4a3a', textMuted: '#9a8c7e' }))
  await setString(network, ATL_HUB_VIEW_MODES as `0x${string}`, JSON.stringify([{ key: 'disciple', label: 'Disciple' }, { key: 'coach', label: 'Coach', requiresCapability: 'coaching' }]))
  await setString(network, ATL_HUB_GREETING as `0x${string}`, 'Good day, {name}')

  // No DB writes needed — all agent identity, relationships, and metadata are on-chain.
  // The only DB table used is `users` (for Privy auth → wallet mapping).

  // ─── On-Chain Relationships (22 edges) ────────────────────────────
  // Quick check: if Hub already has outgoing ALLIANCE edges, skip all edge creation
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
  await createEdge(paElena, network, ORGANIZATION_GOVERNANCE, [ROLE_OWNER])
  await createEdge(paJames, network, ORGANIZATION_GOVERNANCE, [ROLE_BOARD_MEMBER])
  await createEdge(paLinh, hub, ORGANIZATION_GOVERNANCE, [ROLE_OWNER])
  await createEdge(paLinh, network, ORGANIZATION_MEMBERSHIP, [ROLE_OPERATOR])
  await createEdge(paTran, hub, ORGANIZATION_MEMBERSHIP, [ROLE_OPERATOR])
  await createEdge(paMai, hub, ORGANIZATION_MEMBERSHIP, [ROLE_MEMBER])
  await createEdge(paHoa, grpSontra, ORGANIZATION_GOVERNANCE, [ROLE_OWNER])
  await createEdge(paHoa, hub, ORGANIZATION_MEMBERSHIP, [ROLE_MEMBER])
  await createEdge(paDuc, grpHanhoa, ORGANIZATION_GOVERNANCE, [ROLE_OWNER])
  await createEdge(paDuc, hub, ORGANIZATION_MEMBERSHIP, [ROLE_MEMBER])
  await createEdge(paLinh, grpSontra, ORGANIZATION_MEMBERSHIP, [ROLE_ADVISOR])
  await createEdge(paTran, grpHanhoa, ORGANIZATION_MEMBERSHIP, [ROLE_ADVISOR])
  await createEdge(paTran, grpCam, ORGANIZATION_MEMBERSHIP, [ROLE_ADVISOR])

  // Org → Org ALLIANCE (network hierarchy)
  await createEdge(network, hub, ALLIANCE, [ROLE_STRATEGIC_PARTNER])
  await createEdge(hub, grpSontra, ALLIANCE, [ROLE_STRATEGIC_PARTNER])
  await createEdge(hub, grpThanh, ALLIANCE, [ROLE_STRATEGIC_PARTNER])
  await createEdge(hub, grpCam, ALLIANCE, [ROLE_STRATEGIC_PARTNER])

  // Group → Group GENERATIONAL LINEAGE (upstream planted downstream)
  await createEdge(grpSontra, grpHanhoa, GENERATIONAL_LINEAGE, [ROLE_UPSTREAM, ROLE_DOWNSTREAM])
  await createEdge(grpSontra, grpMyke, GENERATIONAL_LINEAGE, [ROLE_UPSTREAM, ROLE_DOWNSTREAM])
  await createEdge(grpThanh, grpLien, GENERATIONAL_LINEAGE, [ROLE_UPSTREAM, ROLE_DOWNSTREAM])
  await createEdge(grpHanhoa, grpNgu, GENERATIONAL_LINEAGE, [ROLE_UPSTREAM, ROLE_DOWNSTREAM])

  // AI → Org (1 edge)
  await createEdge(analytics, network, ORGANIZATIONAL_CONTROL, [ROLE_OPERATED_AGENT])

  console.log('[catalyst-seed] Catalyst community deployed: 17 agents, 22 on-chain edges')
}
