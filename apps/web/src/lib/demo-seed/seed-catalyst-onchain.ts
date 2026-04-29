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
  GENERATIONAL_LINEAGE, HAS_MEMBER, COACHING_MENTORSHIP,
  NAMESPACE_CONTAINS, ROLE_NAMESPACE_PARENT, ROLE_NAMESPACE_CHILD,
  ROLE_OWNER, ROLE_BOARD_MEMBER, ROLE_OPERATOR, ROLE_MEMBER, ROLE_ADVISOR, ROLE_OPERATED_AGENT,
  ROLE_STRATEGIC_PARTNER, ROLE_UPSTREAM, ROLE_DOWNSTREAM, ROLE_COACH, ROLE_DISCIPLE,
  ATL_LATITUDE, ATL_LONGITUDE, ATL_SPATIAL_CRS, ATL_SPATIAL_TYPE, ATL_CONTROLLER,
  ATL_PRIMARY_NAME, ATL_NAME_LABEL,
  GeoFeatureClient, GeoClaimClient, type GeoRelation,
} from '@smart-agent/sdk'
import { agentAccountResolverAbi, agentDisputeRecordAbi } from '@smart-agent/sdk'
import { keccak256, toBytes } from 'viem'

const TYPE_ORGANIZATION = keccak256(toBytes('atl:OrganizationAgent'))
// TYPE_PERSON no longer needed — person agents deployed by generateDemoWallet
const TYPE_AI = keccak256(toBytes('atl:AIAgent'))
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
  } catch (_e) { console.warn(`[catalyst-seed] Failed to register ${name}:`, _e) }
}

async function createEdge(subject: `0x${string}`, object: `0x${string}`, relType: `0x${string}`, roles: `0x${string}`[], metadataURI?: string) {
  try {
    const edgeId = await createRelationship({ subject, object, roles, relationshipType: relType, metadataURI })
    await confirmRelationship(edgeId)
    return edgeId
  } catch (_e) { console.warn(`[catalyst-seed] Edge failed:`, _e); return null }
}

async function setController(agentAddr: `0x${string}`, walletAddr: string) {
  const wc = getWalletClient()
  const res = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
  if (!res) return
  try {
    // Idempotent: addMultiAddressProperty appends without dedup, so a
    // re-run of boot-seed would otherwise produce N copies of the same
    // controller address. Read first, skip if present.
    const existing = await getPublicClient().readContract({
      address: res, abi: agentAccountResolverAbi,
      functionName: 'getMultiAddressProperty',
      args: [agentAddr, ATL_CONTROLLER as `0x${string}`],
    }) as string[]
    if (existing.some(a => a.toLowerCase() === walletAddr.toLowerCase())) return
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

/**
 * Mint a Public GeoClaim binding `subject` to a city's `.geo` feature.
 * Replaces the legacy `atl:city / atl:region / atl:country` resolver
 * properties — coarse-tier overlap is now derived from these claims by
 * walking `claimsBySubject` → looking up the feature → parsing its
 * `metadataURI` for city/region/country.
 *
 * Idempotent at the deterministic-nonce layer: same (subject, feature,
 * relation, nonce) yields the same `claimId`; the contract's
 * `ClaimExists` check makes a re-run a no-op.
 */
async function mintGeoClaim(args: {
  subject: `0x${string}`
  cityKey: string                  // "us/colorado/loveland"
  relation: GeoRelation            // 'residentOf' | 'operatesIn' | …
  confidence: number               // 0..100
}) {
  const wc = getWalletClient()
  const pc = getPublicClient()
  const featReg = process.env.GEO_FEATURE_REGISTRY_ADDRESS as `0x${string}` | undefined
  const claimReg = process.env.GEO_CLAIM_REGISTRY_ADDRESS as `0x${string}` | undefined
  if (!featReg || !claimReg) return
  const [country, region, city] = args.cityKey.split('/')
  const featureId = GeoFeatureClient.featureIdFor({ countryCode: country, region, city })
  const featureClient = new GeoFeatureClient(pc, featReg)
  const claimClient = new GeoClaimClient(pc, claimReg)

  let version: bigint
  try {
    const latest = await featureClient.getLatest(featureId)
    version = latest.version
  } catch {
    console.warn(`[catalyst-seed] feature ${args.cityKey} not published yet — skip claim for ${args.subject}`)
    return
  }
  if (version === 0n) return

  // Deterministic nonce so re-runs hit the contract's ClaimExists guard
  // instead of stacking duplicate claims for the same (subject, feature,
  // relation) tuple. keccak fits the bytes32 nonce slot.
  const nonceLabel = `seed:${args.subject.toLowerCase()}|${args.cityKey}|${args.relation}|v1`
  const nonce = keccak256(toBytes(nonceLabel)) as `0x${string}`
  const evidenceCommit = keccak256(toBytes(`evidence:${nonceLabel}`)) as `0x${string}`

  try {
    const hash = await claimClient.mint(wc, {
      subjectAgent: args.subject,
      issuer: args.subject,             // self-asserted seed claim
      featureId,
      featureVersion: version,
      relation: args.relation,
      visibility: 'Public',
      evidenceCommit,
      confidence: args.confidence,
      policyId: 'smart-agent.geo-overlap.v1',
      nonce,
    })
    await pc.waitForTransactionReceipt({ hash })
  } catch (_e) {
    // The contract's ClaimExists revert is the idempotent path; only
    // truly unexpected reverts get logged.
    const msg = (_e as Error)?.message ?? ''
    if (!/ClaimExists/.test(msg)) {
      console.warn(`[catalyst-seed] geo-claim mint failed for ${args.subject} → ${args.cityKey}:`, msg.slice(0, 120))
    }
  }
}

function upsertUser(u: { id: string; name: string; email: string; wallet: string; did: string }) {
  const existing = db.select().from(schema.users).where(eq(schema.users.id, u.id)).get()
  if (!existing) {
    db.insert(schema.users).values({ id: u.id, email: u.email, name: u.name, walletAddress: u.wallet, did: u.did }).run()
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
    // Network-level
    { id: 'cat-user-001', name: 'Maria Gonzalez',     email: 'maria@catalystnoco.org',       wallet: '0x00000000000000000000000000000000000b0001', did: 'did:demo:cat-001' },
    { id: 'cat-user-005', name: 'Sarah Thompson',     email: 'sarah@catalystnoco.org',       wallet: '0x00000000000000000000000000000000000b0005', did: 'did:demo:cat-005' },
    // Fort Collins Network — regional facilitator
    { id: 'cat-user-002', name: 'Pastor David Chen',  email: 'david@catalystnoco.org',       wallet: '0x00000000000000000000000000000000000b0002', did: 'did:demo:cat-002' },
    { id: 'cat-user-003', name: 'Rosa Martinez',      email: 'rosa@comunidad-noco.org',      wallet: '0x00000000000000000000000000000000000b0003', did: 'did:demo:cat-003' },
    { id: 'cat-user-004', name: 'Carlos Herrera',     email: 'carlos@comunidad-noco.org',    wallet: '0x00000000000000000000000000000000000b0004', did: 'did:demo:cat-004' },
    // Local circle leaders — one owner per circle.
    { id: 'cat-user-006', name: 'Ana Reyes',          email: 'ana@wellington-circle.org',    wallet: '0x00000000000000000000000000000000000b0006', did: 'did:demo:cat-006' },
    { id: 'cat-user-007', name: 'Miguel Santos',      email: 'miguel@laporte-circle.org',    wallet: '0x00000000000000000000000000000000000b0007', did: 'did:demo:cat-007' },
    { id: 'cat-user-008', name: 'Elena Vasquez',      email: 'elena@timnath-circle.org',     wallet: '0x00000000000000000000000000000000000b0008', did: 'did:demo:cat-008' },
    { id: 'cat-user-009', name: 'Luis Hernandez',     email: 'luis@loveland-circle.org',     wallet: '0x00000000000000000000000000000000000b0009', did: 'did:demo:cat-009' },
    { id: 'cat-user-010', name: 'Sofia Ramirez',      email: 'sofia@berthoud-circle.org',    wallet: '0x00000000000000000000000000000000000b000a', did: 'did:demo:cat-010' },
    { id: 'cat-user-011', name: 'Diego Morales',      email: 'diego@johnstown-circle.org',   wallet: '0x00000000000000000000000000000000000b000b', did: 'did:demo:cat-011' },
    { id: 'cat-user-012', name: 'Isabel Cruz',        email: 'isabel@redfeather-circle.org', wallet: '0x00000000000000000000000000000000000b000c', did: 'did:demo:cat-012' },
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
  const paElena = userMap.get('cat-user-008')!.personAgentAddress as `0x${string}`
  const paLuis = userMap.get('cat-user-009')!.personAgentAddress as `0x${string}`
  const paSofia = userMap.get('cat-user-010')!.personAgentAddress as `0x${string}`
  const paDiego = userMap.get('cat-user-011')!.personAgentAddress as `0x${string}`
  const paIsabel = userMap.get('cat-user-012')!.personAgentAddress as `0x${string}`

  // ─── Deploy Org/AI Agent Smart Accounts ──────────────────────────
  console.log('[catalyst-seed] Deploying org smart accounts...')
  const network = await deploy(200001)      // Catalyst NoCo Network
  const hub = await deploy(200002)          // Fort Collins Network (regional facilitator org, not the Hub agent)
  const grpWellington = await deploy(200003)  // Wellington Circle
  const grpLaporte = await deploy(200004)     // Laporte Circle
  const grpTimnath = await deploy(200005)     // Timnath Circle
  const grpLoveland = await deploy(200006)    // Loveland Circle
  const grpBerthoud = await deploy(200007)    // Berthoud Circle
  const grpJohnstown = await deploy(200008)   // Johnstown Circle
  const grpRedFeather = await deploy(200009)  // Red Feather Lakes Circle
  const analytics = await deploy(210001)

  console.log('[catalyst-seed] Smart accounts deployed. Network:', network, 'Fort Collins Network:', hub)

  // ─── Register in Resolver ─────────────────────────────────────────
  console.log('[catalyst-seed] Registering in resolver...')
  await register(network, 'Catalyst NoCo Network', 'Northern Colorado catalyst network — Hispanic community outreach and church planting north of Fort Collins', TYPE_ORGANIZATION)
  await register(hub, 'Fort Collins Network', 'Regional facilitator org — bilingual community development across Fort Collins and surrounding circles', TYPE_ORGANIZATION)
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

  // ─── Issuer EOA → Catalyst NoCo Network controller link ───────────
  // The org-mcp service issues OrgMembershipCredentials with `issuerId` set
  // to `did:ethr:<chainId>:<orgIssuerEoa>`, where the EOA is derived from
  // ORG_PRIVATE_KEY. Wallets that hold those credentials need a way to
  // resolve the issuer-EOA back to a human-readable org name. We achieve
  // that by registering the issuer EOA as a controller of the Catalyst
  // NoCo Network agent — `list.action.ts > buildIssuerLookup` then walks
  // ATL_CONTROLLER lists to find the matching org.
  try {
    const orgKey = (process.env.ORG_PRIVATE_KEY ?? ('0x' + 'c'.repeat(64))) as `0x${string}`
    const { privateKeyToAccount } = await import('viem/accounts')
    const orgIssuerEoa = privateKeyToAccount(orgKey).address
    await setController(network, orgIssuerEoa)
    console.log('[catalyst-seed] linked issuer EOA → Catalyst NoCo Network:', orgIssuerEoa)
  } catch (e) {
    console.warn('[catalyst-seed] issuer→org controller link failed (non-fatal):', e)
  }

  // ─── Demo-user EOA → Org controller links ─────────────────────────
  // Without this, no demo user controls any org and PROPOSED relationship
  // requests directed at orgs are stuck forever — the /relationships page
  // only shows a "Confirm" button when the signed-in user's wallet appears
  // in the target agent's ATL_CONTROLLER list. Each org gets a single
  // persona-aligned owner (with secondaries only where multiple users hold
  // similarly-scoped roles); ownership spans the whole hierarchy instead
  // of concentrating on one user.
  const ctrl: Array<[`0x${string}`, string, string]> = [
    // Network — Program Director + Regional Lead.
    [network,        userMap.get('cat-user-001')!.walletAddress, 'Maria → Network'],
    [network,        userMap.get('cat-user-005')!.walletAddress, 'Sarah → Network'],
    // Fort Collins Network — Network Lead + Outreach Coordinator.
    [hub,            userMap.get('cat-user-002')!.walletAddress, 'David → Fort Collins Network'],
    [hub,            userMap.get('cat-user-003')!.walletAddress, 'Rosa → Fort Collins Network'],
    // Local circles — one circle leader each.
    [grpWellington,  userMap.get('cat-user-006')!.walletAddress, 'Ana → Wellington'],
    [grpLaporte,     userMap.get('cat-user-007')!.walletAddress, 'Miguel → Laporte'],
    [grpTimnath,     userMap.get('cat-user-008')!.walletAddress, 'Elena → Timnath'],
    [grpLoveland,    userMap.get('cat-user-009')!.walletAddress, 'Luis → Loveland'],
    [grpBerthoud,    userMap.get('cat-user-010')!.walletAddress, 'Sofia → Berthoud'],
    [grpJohnstown,   userMap.get('cat-user-011')!.walletAddress, 'Diego → Johnstown'],
    [grpRedFeather,  userMap.get('cat-user-012')!.walletAddress, 'Isabel → Red Feather'],
    // Analytics AI — operated by the Program Director.
    [analytics,      userMap.get('cat-user-001')!.walletAddress, 'Maria → Analytics'],
  ]
  for (const [agent, wallet, label] of ctrl) {
    if (!wallet) continue
    await setController(agent, wallet)
    console.log(`[catalyst-seed] controller: ${label}`)
  }

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

  // Geo affiliation — public on-chain `GeoClaimRegistry` rows binding
  // each demo agent to its city's `.geo` feature. This replaces the
  // legacy `atl:city / atl:region / atl:country` resolver writes; the
  // coarse tier of geo-overlap.v1 is now derived from these claims.
  //
  //   Circles → operatesIn  (the org operates within the city polygon)
  //   People  → residentOf  (the person is anchored to that city)
  //
  // Both are Public Visibility so anyone reading the registry sees them.
  console.log('[catalyst-seed] Minting geo claims (operatesIn / residentOf) ...')
  // Circle org → city. ROLE_OPERATES_IN equivalent for orgs.
  await mintGeoClaim({ subject: network,       cityKey: 'us/colorado/fortcollins',  relation: 'operatesIn', confidence: 100 })
  await mintGeoClaim({ subject: hub,           cityKey: 'us/colorado/fortcollins',  relation: 'operatesIn', confidence: 100 })
  await mintGeoClaim({ subject: grpWellington, cityKey: 'us/colorado/wellington',   relation: 'operatesIn', confidence: 100 })
  await mintGeoClaim({ subject: grpLaporte,    cityKey: 'us/colorado/laporte',      relation: 'operatesIn', confidence: 100 })
  await mintGeoClaim({ subject: grpTimnath,    cityKey: 'us/colorado/timnath',      relation: 'operatesIn', confidence: 100 })
  await mintGeoClaim({ subject: grpLoveland,   cityKey: 'us/colorado/loveland',     relation: 'operatesIn', confidence: 100 })
  await mintGeoClaim({ subject: grpBerthoud,   cityKey: 'us/colorado/berthoud',     relation: 'operatesIn', confidence: 100 })
  await mintGeoClaim({ subject: grpJohnstown,  cityKey: 'us/colorado/johnstown',    relation: 'operatesIn', confidence: 100 })
  await mintGeoClaim({ subject: grpRedFeather, cityKey: 'us/colorado/redfeather',   relation: 'operatesIn', confidence: 100 })

  // stewardOf claims express "this circle is the steward of church-planting in
  // this place" — a stronger claim than operatesIn. Loveland claims its own
  // city; Berthoud deliberately also claims Loveland to set up an engagement
  // overlap that the dispute below resolves.
  await mintGeoClaim({ subject: grpLoveland,   cityKey: 'us/colorado/loveland',     relation: 'stewardOf', confidence: 90 })
  await mintGeoClaim({ subject: grpBerthoud,   cityKey: 'us/colorado/loveland',     relation: 'stewardOf', confidence: 70 })

  // Person → city. residentOf gets a stage-B weight of 1.0 in
  // geo-overlap.v1 — the strongest local-affinity signal we ship.
  const personGeoMap: Array<[string, string]> = [
    ['cat-user-001', 'us/colorado/fortcollins'],  // Maria
    ['cat-user-002', 'us/colorado/fortcollins'],  // David
    ['cat-user-003', 'us/colorado/fortcollins'],  // Rosa
    ['cat-user-004', 'us/colorado/fortcollins'],  // Carlos
    ['cat-user-005', 'us/colorado/fortcollins'],  // Sarah Thompson
    ['cat-user-006', 'us/colorado/wellington'],   // Ana
    ['cat-user-007', 'us/colorado/laporte'],      // Miguel
    ['cat-user-008', 'us/colorado/timnath'],      // Elena
    ['cat-user-009', 'us/colorado/loveland'],     // Luis
    ['cat-user-010', 'us/colorado/berthoud'],     // Sofia
    ['cat-user-011', 'us/colorado/johnstown'],    // Diego
    ['cat-user-012', 'us/colorado/redfeather'],   // Isabel
  ]
  for (const [uid, cityKey] of personGeoMap) {
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
    console.log('[catalyst-seed] On-chain relationships already complete — skipping edges')
  } else {
  console.log('[catalyst-seed] Creating on-chain relationships (this takes ~60 seconds)...')

  // Person → Org governance + membership.
  // OWNER edges mirror ATL_CONTROLLER one-for-one: a single persona-aligned
  // owner per circle, network-level orgs co-owned by their two senior
  // leaders. Every owner can approve PROPOSED requests aimed at their org.
  await createEdge(paMaria,  network,        ORGANIZATION_GOVERNANCE, [ROLE_OWNER])
  await createEdge(paSarah,  network,        ORGANIZATION_GOVERNANCE, [ROLE_OWNER])
  await createEdge(paDavid,  hub,            ORGANIZATION_GOVERNANCE, [ROLE_OWNER])
  await createEdge(paRosa,   hub,            ORGANIZATION_GOVERNANCE, [ROLE_OWNER])
  await createEdge(paAna,    grpWellington,  ORGANIZATION_GOVERNANCE, [ROLE_OWNER])
  await createEdge(paMiguel, grpLaporte,     ORGANIZATION_GOVERNANCE, [ROLE_OWNER])
  await createEdge(paElena,  grpTimnath,     ORGANIZATION_GOVERNANCE, [ROLE_OWNER])
  await createEdge(paLuis,   grpLoveland,    ORGANIZATION_GOVERNANCE, [ROLE_OWNER])
  await createEdge(paSofia,  grpBerthoud,    ORGANIZATION_GOVERNANCE, [ROLE_OWNER])
  await createEdge(paDiego,  grpJohnstown,   ORGANIZATION_GOVERNANCE, [ROLE_OWNER])
  await createEdge(paIsabel, grpRedFeather,  ORGANIZATION_GOVERNANCE, [ROLE_OWNER])
  await createEdge(paMaria,  analytics,      ORGANIZATION_GOVERNANCE, [ROLE_OWNER])

  // Membership / advisory edges layered on top of the governance graph.
  // Circle leaders are also members of the regional Fort Collins Network.
  await createEdge(paDavid,  network,        ORGANIZATION_MEMBERSHIP, [ROLE_OPERATOR])
  await createEdge(paCarlos, hub,            ORGANIZATION_MEMBERSHIP, [ROLE_MEMBER])
  await createEdge(paAna,    hub,            ORGANIZATION_MEMBERSHIP, [ROLE_MEMBER])
  await createEdge(paMiguel, hub,            ORGANIZATION_MEMBERSHIP, [ROLE_MEMBER])
  await createEdge(paElena,  hub,            ORGANIZATION_MEMBERSHIP, [ROLE_MEMBER])
  await createEdge(paLuis,   hub,            ORGANIZATION_MEMBERSHIP, [ROLE_MEMBER])
  await createEdge(paSofia,  hub,            ORGANIZATION_MEMBERSHIP, [ROLE_MEMBER])
  await createEdge(paDiego,  hub,            ORGANIZATION_MEMBERSHIP, [ROLE_MEMBER])
  await createEdge(paIsabel, hub,            ORGANIZATION_MEMBERSHIP, [ROLE_MEMBER])
  // Cross-circle advisory by the regional staff.
  await createEdge(paDavid, grpWellington,  ORGANIZATION_MEMBERSHIP, [ROLE_ADVISOR])
  await createEdge(paRosa,  grpLaporte,     ORGANIZATION_MEMBERSHIP, [ROLE_ADVISOR])
  await createEdge(paRosa,  grpRedFeather,  ORGANIZATION_MEMBERSHIP, [ROLE_ADVISOR])
  await createEdge(paSarah, grpLoveland,    ORGANIZATION_MEMBERSHIP, [ROLE_ADVISOR])

  // Coaching / mentorship edges (person → person). Director coaches a circle
  // leader; hub lead coaches a community partner. Surfaces in the agent
  // network graph and feeds the coaching panel.
  await createEdge(paMaria,  paAna,    COACHING_MENTORSHIP as `0x${string}`, [ROLE_COACH as `0x${string}`, ROLE_DISCIPLE as `0x${string}`])
  await createEdge(paDavid,  paCarlos, COACHING_MENTORSHIP as `0x${string}`, [ROLE_COACH as `0x${string}`, ROLE_DISCIPLE as `0x${string}`])

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
  } // end of edge creation else block

  // ─── Hub Agent ──────────────────────────────────────────────────
  console.log('[catalyst-seed] Deploying hub agent...')
  const hubCatalyst = await deploy(290001)
  await register(hubCatalyst, 'Catalyst Hub', 'Catalyst NoCo Network hub — Hispanic outreach, activity tracking, multiplication mapping', TYPE_HUB)

  // HAS_MEMBER edges — connect all agents to the hub
  console.log('[catalyst-seed] Creating HAS_MEMBER edges...')
  const allAgents = [
    network, hub,
    grpWellington, grpLaporte, grpTimnath, grpLoveland, grpBerthoud, grpJohnstown, grpRedFeather,
    analytics,
    paMaria, paDavid, paRosa, paCarlos, paSarah, paAna, paMiguel,
    paElena, paLuis, paSofia, paDiego, paIsabel,
  ]
  for (const agent of allAgents) {
    await createEdge(hubCatalyst, agent, HAS_MEMBER as `0x${string}`, [ROLE_MEMBER])
  }

  // ─── Agent Naming (.agent namespace) ─────────────────────────────
  console.log('[catalyst-seed] Setting up .agent naming hierarchy...')

  async function setNameProps(addr: `0x${string}`, label: string, fullName: string) {
    const wc = getWalletClient()
    const resolver = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
    if (!resolver) return
    try {
      await wc.writeContract({ address: resolver, abi: agentAccountResolverAbi, functionName: 'setStringProperty', args: [addr, ATL_NAME_LABEL as `0x${string}`, label] })
      await wc.writeContract({ address: resolver, abi: agentAccountResolverAbi, functionName: 'setStringProperty', args: [addr, ATL_PRIMARY_NAME as `0x${string}`, fullName] })
    } catch (_e) { console.warn(`[catalyst-seed] Name props failed for ${label}:`, _e) }
  }

  const NS = NAMESPACE_CONTAINS as `0x${string}`
  const NS_ROLES = [ROLE_NAMESPACE_PARENT as `0x${string}`, ROLE_NAMESPACE_CHILD as `0x${string}`]

  // ─── Register names in AgentNameRegistry ─────────────────────────
  const nameRegistryAddr = process.env.AGENT_NAME_REGISTRY_ADDRESS as `0x${string}`
  const nameResolverAddr = process.env.AGENT_NAME_RESOLVER_ADDRESS as `0x${string}`

  async function registerName(parentNode: `0x${string}`, label: string, ownerAddr: `0x${string}`) {
    if (!nameRegistryAddr) return null
    const wc = getWalletClient()
    const pc = getPublicClient()
    const { agentNameRegistryAbi: nrAbi, agentNameResolverAbi: nresAbi } = await import('@smart-agent/sdk')
    const { keccak256: k256, toBytes: tb, encodePacked: ep } = await import('viem')
    const lh = k256(tb(label))
    const childNode = k256(ep(['bytes32', 'bytes32'], [parentNode, lh]))
    try {
      // Idempotent: skip if already registered
      const exists = await pc.readContract({ address: nameRegistryAddr, abi: nrAbi, functionName: 'recordExists', args: [childNode] }) as boolean
      if (!exists) {
        const hash = await wc.writeContract({ address: nameRegistryAddr, abi: nrAbi, functionName: 'register', args: [parentNode, label, ownerAddr, nameResolverAddr, 0n] })
        await pc.waitForTransactionReceipt({ hash })
      }
      try { await wc.writeContract({ address: nameResolverAddr, abi: nresAbi, functionName: 'setAddr', args: [childNode, ownerAddr] }) } catch { /* */ }
      return childNode as `0x${string}`
    } catch (e) {
      console.warn(`[catalyst-seed] Name registration failed for ${label}:`, e)
      return childNode as `0x${string}`
    }
  }

  // Get the .agent root node from the registry
  let agentRoot: `0x${string}` = '0x0000000000000000000000000000000000000000000000000000000000000000'
  if (nameRegistryAddr) {
    try {
      const { agentNameRegistryAbi } = await import('@smart-agent/sdk')
      agentRoot = await getPublicClient().readContract({
        address: nameRegistryAddr, abi: agentNameRegistryAbi, functionName: 'AGENT_ROOT',
      }) as `0x${string}`
      console.log('[catalyst-seed] .agent root:', agentRoot)
    } catch { /* registry not deployed */ }
  }

  // Register catalyst.agent under root. Owner is the DEPLOYER (not the
  // hub agent) so the onboarding wizard's deployer-signed sub-name calls
  // (e.g. `joefonda.catalyst.agent`) succeed without needing UserOps from
  // the hub's smart account. Hub-agent ownership semantics live at the
  // resolver (ATL_PRIMARY_NAME etc.); the registry owner is purely a
  // signing key.
  const deployerOwner = getWalletClient().account!.address as `0x${string}`
  const catalystNode = await registerName(agentRoot, 'catalyst', deployerOwner)
  console.log('[catalyst-seed] catalyst.agent registered:', catalystNode ? 'yes' : 'no')

  if (catalystNode) {
    // Register direct children under catalyst.agent
    const fcNode    = await registerName(catalystNode, 'fortcollins', hub)
    const welNode   = await registerName(catalystNode, 'wellington', grpWellington)
    const lapNode   = await registerName(catalystNode, 'laporte', grpLaporte)
    const timNode   = await registerName(catalystNode, 'timnath', grpTimnath)
    const lovNode   = await registerName(catalystNode, 'loveland', grpLoveland)
    const berNode   = await registerName(catalystNode, 'berthoud', grpBerthoud)
    const johNode   = await registerName(catalystNode, 'johnstown', grpJohnstown)
    const redNode   = await registerName(catalystNode, 'redfeather', grpRedFeather)
    await registerName(catalystNode, 'network', network)
    await registerName(catalystNode, 'analytics', analytics)
    await registerName(catalystNode, 'maria', paMaria)
    await registerName(catalystNode, 'sarah', paSarah)

    // Register people under their orgs
    if (fcNode) {
      await registerName(fcNode, 'david', paDavid)
      await registerName(fcNode, 'rosa', paRosa)
      await registerName(fcNode, 'carlos', paCarlos)
    }
    if (welNode) await registerName(welNode, 'ana', paAna)
    if (lapNode) await registerName(lapNode, 'miguel', paMiguel)
    if (timNode) await registerName(timNode, 'elena', paElena)
    if (lovNode) await registerName(lovNode, 'luis', paLuis)
    if (berNode) await registerName(berNode, 'sofia', paSofia)
    if (johNode) await registerName(johNode, 'diego', paDiego)
    if (redNode) await registerName(redNode, 'isabel', paIsabel)

    console.log('[catalyst-seed] Name registry populated')
  }

  // Set labels + primary names on AgentAccountResolver
  await setNameProps(hubCatalyst, 'catalyst', 'catalyst.agent')
  await setNameProps(network, 'network', 'network.catalyst.agent')
  await setNameProps(hub, 'fortcollins', 'fortcollins.catalyst.agent')
  await setNameProps(grpWellington, 'wellington', 'wellington.catalyst.agent')
  await setNameProps(grpLaporte, 'laporte', 'laporte.catalyst.agent')
  await setNameProps(grpTimnath, 'timnath', 'timnath.catalyst.agent')
  await setNameProps(grpLoveland, 'loveland', 'loveland.catalyst.agent')
  await setNameProps(grpBerthoud, 'berthoud', 'berthoud.catalyst.agent')
  await setNameProps(grpJohnstown, 'johnstown', 'johnstown.catalyst.agent')
  await setNameProps(grpRedFeather, 'redfeather', 'redfeather.catalyst.agent')
  await setNameProps(analytics, 'analytics', 'analytics.catalyst.agent')
  await setNameProps(paMaria,  'maria',  'maria.catalyst.agent')
  await setNameProps(paDavid,  'david',  'david.fortcollins.catalyst.agent')
  await setNameProps(paRosa,   'rosa',   'rosa.fortcollins.catalyst.agent')
  await setNameProps(paCarlos, 'carlos', 'carlos.fortcollins.catalyst.agent')
  await setNameProps(paSarah,  'sarah',  'sarah.catalyst.agent')
  await setNameProps(paAna,    'ana',    'ana.wellington.catalyst.agent')
  await setNameProps(paMiguel, 'miguel', 'miguel.laporte.catalyst.agent')
  await setNameProps(paElena,  'elena',  'elena.timnath.catalyst.agent')
  await setNameProps(paLuis,   'luis',   'luis.loveland.catalyst.agent')
  await setNameProps(paSofia,  'sofia',  'sofia.berthoud.catalyst.agent')
  await setNameProps(paDiego,  'diego',  'diego.johnstown.catalyst.agent')
  await setNameProps(paIsabel, 'isabel', 'isabel.redfeather.catalyst.agent')

  // NAMESPACE_CONTAINS edges: hub → orgs, orgs → people
  // catalyst.agent contains everything at the top level
  const nsEdgeMeta = (label: string) => JSON.stringify({ label })

  await createEdge(hubCatalyst, network, NS, NS_ROLES, nsEdgeMeta('network'))
  await createEdge(hubCatalyst, hub, NS, NS_ROLES, nsEdgeMeta('fortcollins'))
  await createEdge(hubCatalyst, grpWellington, NS, NS_ROLES, nsEdgeMeta('wellington'))
  await createEdge(hubCatalyst, grpLaporte, NS, NS_ROLES, nsEdgeMeta('laporte'))
  await createEdge(hubCatalyst, grpTimnath, NS, NS_ROLES, nsEdgeMeta('timnath'))
  await createEdge(hubCatalyst, grpLoveland, NS, NS_ROLES, nsEdgeMeta('loveland'))
  await createEdge(hubCatalyst, grpBerthoud, NS, NS_ROLES, nsEdgeMeta('berthoud'))
  await createEdge(hubCatalyst, grpJohnstown, NS, NS_ROLES, nsEdgeMeta('johnstown'))
  await createEdge(hubCatalyst, grpRedFeather, NS, NS_ROLES, nsEdgeMeta('redfeather'))
  await createEdge(hubCatalyst, analytics, NS, NS_ROLES, nsEdgeMeta('analytics'))
  await createEdge(hubCatalyst, paMaria, NS, NS_ROLES, nsEdgeMeta('maria'))
  await createEdge(hubCatalyst, paSarah, NS, NS_ROLES, nsEdgeMeta('sarah'))

  // Fort Collins Network contains its staff
  await createEdge(hub, paDavid,  NS, NS_ROLES, nsEdgeMeta('david'))
  await createEdge(hub, paRosa,   NS, NS_ROLES, nsEdgeMeta('rosa'))
  await createEdge(hub, paCarlos, NS, NS_ROLES, nsEdgeMeta('carlos'))

  // Circles contain their leaders
  await createEdge(grpWellington, paAna,    NS, NS_ROLES, nsEdgeMeta('ana'))
  await createEdge(grpLaporte,    paMiguel, NS, NS_ROLES, nsEdgeMeta('miguel'))
  await createEdge(grpTimnath,    paElena,  NS, NS_ROLES, nsEdgeMeta('elena'))
  await createEdge(grpLoveland,   paLuis,   NS, NS_ROLES, nsEdgeMeta('luis'))
  await createEdge(grpBerthoud,   paSofia,  NS, NS_ROLES, nsEdgeMeta('sofia'))
  await createEdge(grpJohnstown,  paDiego,  NS, NS_ROLES, nsEdgeMeta('diego'))
  await createEdge(grpRedFeather, paIsabel, NS, NS_ROLES, nsEdgeMeta('isabel'))

  console.log('[catalyst-seed] Naming hierarchy created')

  // ─── Helper: Build and sign a data access delegation ──────────────
  async function buildSignedDelegation(
    grantorAgent: `0x${string}`,
    granteeAgent: `0x${string}`,
    grantorUserId: string,
    grants: Array<{ server: string; resources: string[]; fields: string[] }>,
  ) {
    const {
      DATA_ACCESS_DELEGATION: DAD, ROLE_DATA_GRANTOR, ROLE_DATA_GRANTEE,
      hashDelegation: hashDel, encodeTimestampTerms: encTimestamp,
      buildCaveat: bCaveat, buildDataScopeCaveat: bDataScope,
      ROOT_AUTHORITY: ROOT,
    } = await import('@smart-agent/sdk')
    const { privateKeyToAccount } = await import('viem/accounts')

    const grantorUser = db.select().from(schema.users).where(eq(schema.users.id, grantorUserId)).get()
    if (!grantorUser?.privateKey) return null

    const now = Math.floor(Date.now() / 1000)
    const expiresAt = now + 90 * 24 * 60 * 60
    const salt = BigInt(Date.now() + Math.floor(Math.random() * 100000))
    const timestampAddr = process.env.TIMESTAMP_ENFORCER_ADDRESS as `0x${string}`
    const delegationManagerAddr = process.env.DELEGATION_MANAGER_ADDRESS as `0x${string}`
    const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')

    const caveats = [
      bCaveat(timestampAddr, encTimestamp(now, expiresAt)),
      bDataScope(grants),
    ]

    const delegation = {
      delegator: grantorAgent,
      delegate: granteeAgent,
      authority: ROOT as `0x${string}`,
      caveats: caveats.map(c => ({ enforcer: c.enforcer, terms: c.terms })),
      salt: salt.toString(),
    }

    const delHash = hashDel(delegation, chainId, delegationManagerAddr)
    const account = privateKeyToAccount(grantorUser.privateKey as `0x${string}`)
    const signature = await account.signMessage({ message: { raw: delHash } })

    const signedDelegation = { ...delegation, signature }

    // Full metadataURI: delegation + hash + grants + expiry
    // Any A2A agent can read this from on-chain and present to MCP
    const metadataURI = JSON.stringify({
      delegation: signedDelegation,
      delegationHash: delHash,
      grants,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
    })

    return { DAD, ROLE_DATA_GRANTOR, ROLE_DATA_GRANTEE, metadataURI }
  }

  // ─── Data Access Delegation: Ana → Maria (standalone sharing) ────
  console.log('[catalyst-seed] Creating data access delegation: Ana → Maria')
  try {
    const piiGrants = [{
      server: 'urn:mcp:server:person',
      resources: ['profile'],
      fields: ['email', 'phone', 'city', 'stateProvince', 'country', 'displayName'],
    }]

    const result = await buildSignedDelegation(paAna, paMaria, 'cat-user-006', piiGrants)
    if (result) {
      await createEdge(paAna, paMaria, result.DAD as `0x${string}`, [result.ROLE_DATA_GRANTOR as `0x${string}`, result.ROLE_DATA_GRANTEE as `0x${string}`], result.metadataURI)
      console.log('[catalyst-seed] Data delegation created: Ana → Maria (on-chain)')
    }
  } catch (err) {
    console.warn('[catalyst-seed] Ana→Maria delegation failed:', err)
  }

  // ─── Coaching: David coaches Ana + auto-delegation ───────────────
  console.log('[catalyst-seed] Creating coaching relationship: David → Ana')
  try {
    // 1. Coaching edge: David (coach) → Ana (disciple)
    await createEdge(paDavid, paAna, COACHING_MENTORSHIP as `0x${string}`, [ROLE_COACH as `0x${string}`, ROLE_DISCIPLE as `0x${string}`])

    // 2. Data delegation: Ana → David (disciple shares PII with coach)
    const coachGrants = [{
      server: 'urn:mcp:server:person',
      resources: ['profile'],
      fields: ['email', 'phone', 'displayName', 'language', 'city', 'stateProvince'],
    }]

    const result = await buildSignedDelegation(paAna, paDavid, 'cat-user-006', coachGrants)
    if (result) {
      await createEdge(paAna, paDavid, result.DAD as `0x${string}`, [result.ROLE_DATA_GRANTOR as `0x${string}`, result.ROLE_DATA_GRANTEE as `0x${string}`], result.metadataURI)
      console.log('[catalyst-seed] Coaching delegation created: Ana → David (on-chain)')
    }
  } catch (err) {
    console.warn('[catalyst-seed] Coaching delegation failed:', err)
  }

  // ─── Engagement Dispute (Berthoud's stewardOf overlap on Loveland) ──
  // The stewardOf claims above set up an engagement overlap: Loveland and
  // Berthoud both claim to steward church-planting in Loveland. The hub
  // files a FLAG dispute against Berthoud so the /reviews page surfaces it
  // and the network graph can render the disputed engagement.
  const disputeAddr = process.env.AGENT_DISPUTE_ADDRESS as `0x${string}` | undefined
  if (disputeAddr) {
    try {
      const wc = getWalletClient()
      const pc = getPublicClient()
      const existing = await pc.readContract({
        address: disputeAddr, abi: agentDisputeRecordAbi,
        functionName: 'getDisputesBySubject', args: [grpBerthoud],
      }) as bigint[]
      if (existing.length === 0) {
        const hash = await wc.writeContract({
          address: disputeAddr, abi: agentDisputeRecordAbi,
          functionName: 'fileDispute',
          args: [
            grpBerthoud,
            1, // DisputeType.FLAG
            'Engagement overlap: Berthoud Circle stewardOf claim duplicates Loveland Circle in Loveland CO',
            '',
          ],
        })
        await pc.waitForTransactionReceipt({ hash })
        console.log('[catalyst-seed] Filed engagement-overlap dispute against Berthoud')
      }
    } catch (err) {
      console.warn('[catalyst-seed] Dispute filing failed:', err)
    }
  }

  console.log('[catalyst-seed] NoCo Catalyst community deployed: 18 agents, 27+ on-chain edges')
}
