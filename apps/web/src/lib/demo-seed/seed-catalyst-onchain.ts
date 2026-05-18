'use server'

import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
// randomUUID no longer needed — agent_index uses address as PK
import {
  createRelationship, confirmRelationship,
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
import { keccak256, toBytes, type PrivateKeyAccount } from 'viem'
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
// TYPE_PERSON no longer needed — person agents deployed by generateDemoWallet
const TYPE_AI = keccak256(toBytes('atl:AIAgent'))
const TYPE_HUB = keccak256(toBytes('atl:HubAgent'))
// Spec 006 — Treasury Service Agent. Distinct AgentAccount per org, holds
// the org's funds, registered separately so the network graph renders
// "org → its treasury" as two nodes.
const TYPE_TREASURY_AGENT = keccak256(toBytes('atl:TreasuryAgent'))
const SA_HAS_TREASURY = keccak256(toBytes('sa:hasTreasury'))

// ─── Agent identity registry — same pattern as gc/cil-seed ────────────
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
    throw new Error(`[catalyst-seed] No agent identity registered for ${smartAccount} — call deploy(label, salt) before any resolver write.`)
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

/** Turn a display name like "Catalyst NoCo Network" into a DNS-safe
 *  slug "catalyst-noco-network" suitable for an A2A host label. The
 *  URL resolver derives the host's leftmost label as the slug, so
 *  every registered agent MUST have a primary name set or A2A routing
 *  fails 401 with "no primary name registered". */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}

async function register(addr: `0x${string}`, name: string, desc: string, agentType: `0x${string}`) {
  const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
  if (!resolverAddr) return
  try {
    const id = lookupIdentity(addr)
    const client = getPublicClient()
    const isReg = await client.readContract({ address: resolverAddr, abi: agentAccountResolverAbi, functionName: 'isRegistered', args: [addr] }) as boolean
    const primaryName = `${slugify(name)}.agent`

    if (!isReg) {
      // First seed pass — register + primary-name in ONE userOp so the
      // A2A URL resolver finds a slug immediately.
      await registerAgentAsSelf({
        smartAccount: addr,
        signerAccount: id.eoa,
        salt: id.salt,
        name, description: desc, agentType,
        properties: [
          { kind: 'string', predicate: ATL_PRIMARY_NAME as `0x${string}`, value: primaryName },
        ],
        label: `catalyst-seed:register(${name})`,
      })
      return
    }
    // Already registered: idempotently re-set the primary name if it
    // drifted. Re-runs of the seed re-derive the same name from `name`,
    // so this is a no-op unless an external write changed it.
    try {
      const existing = await client.readContract({
        address: resolverAddr, abi: agentAccountResolverAbi,
        functionName: 'getStringProperty', args: [addr, ATL_PRIMARY_NAME as `0x${string}`],
      }) as string
      if (existing !== primaryName) {
        await writeAgentPropertiesAsSelf({
          smartAccount: addr,
          signerAccount: id.eoa,
          salt: id.salt,
          properties: [
            { kind: 'string', predicate: ATL_PRIMARY_NAME as `0x${string}`, value: primaryName },
          ],
          label: `catalyst-seed:primaryName(${name})`,
        })
      }
    } catch (e) {
      console.warn(`[catalyst-seed] setStringProperty(ATL_PRIMARY_NAME) failed for ${name}:`, e)
    }
  } catch (_e) { console.warn(`[catalyst-seed] Failed to register ${name}:`, _e) }
}

/**
 * Spec 006 — deploy a dedicated Treasury AgentAccount for `orgAddr` and
 * link it via `sa:hasTreasury` on the org. The treasury agent is
 * registered with `TYPE_TREASURY_AGENT` so it renders as a distinct
 * Service node on the trust graph (color = teal in TrustGraphView's
 * NODE_COLORS map).
 *
 * Salt convention: `400000 + orgSalt` (orgSalt is the salt the org's own
 * AgentAccount was deployed with). Deterministic + non-colliding with
 * person / org / AI salts.
 */
async function deployAndLinkTreasury(
  orgAddr: `0x${string}`,
  orgSalt: number,
  orgName: string,
): Promise<`0x${string}` | null> {
  try {
    const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}` | undefined
    if (!resolverAddr) return null

    // Deterministic treasury label namespaced under the org name. Salt
    // pattern (400000 + orgSalt) preserved from the original code.
    const treasuryLabel = `catalyst:treasury:${orgName}`
    const treasury = await deploy(treasuryLabel, 400000 + orgSalt)
    await register(
      treasury,
      `${orgName} Treasury`,
      `Treasury Service Agent for ${orgName} — holds the org's USDC and serves as the donor address for grant-lane commitments.`,
      TYPE_TREASURY_AGENT,
    )

    // Link org → treasury via sa:hasTreasury on the AgentAccountResolver.
    // This is a write ON the org agent (`onlyAgentOwner(orgAddr)`), so it
    // MUST be signed by the org's own EOA — looked up from the identity
    // map populated when the org was deployed.
    const orgId = lookupIdentity(orgAddr)
    await writeAgentPropertiesAsSelf({
      smartAccount: orgAddr,
      signerAccount: orgId.eoa,
      salt: orgId.salt,
      properties: [
        { kind: 'address', predicate: SA_HAS_TREASURY, value: treasury },
      ],
      label: `catalyst-seed:linkTreasury(${orgName})`,
    })
    return treasury
  } catch (e) {
    console.warn(`[catalyst-seed] Treasury for ${orgName} failed:`, e)
    return null
  }
}

async function createEdge(subject: `0x${string}`, object: `0x${string}`, relType: `0x${string}`, roles: `0x${string}`[], metadataURI?: string) {
  try {
    const edgeId = await createRelationship({ subject, object, roles, relationshipType: relType, metadataURI })
    await confirmRelationship(edgeId)
    return edgeId
  } catch (_e) { console.warn(`[catalyst-seed] Edge failed:`, _e); return null }
}

async function setController(agentAddr: `0x${string}`, walletAddr: string) {
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
    const id = lookupIdentity(agentAddr)
    await writeAgentPropertiesAsSelf({
      smartAccount: agentAddr,
      signerAccount: id.eoa,
      salt: id.salt,
      properties: [
        { kind: 'multiAddress-append', predicate: ATL_CONTROLLER as `0x${string}`, value: walletAddr as `0x${string}` },
      ],
      label: `catalyst-seed:setController(${agentAddr})`,
    })
  } catch (_e) { console.warn(`[catalyst-seed] Controller failed:`, _e) }
}

// Hub config setString removed — deployer loses ownership after first seed.
// Static fallback profiles in hub-profiles.ts provide nav config.

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
      label: `catalyst-seed:setGeo(${addr})`,
    })
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
  let identity = agentIdentities.get(args.subject.toLowerCase() as `0x${string}`)
  if (!identity) {
    const personId = await loadDemoUserAgentIdentity(args.subject)
    if (personId) identity = personId
  }
  if (!identity) {
    console.warn(`[catalyst-seed] geo-claim skip: no identity for subject ${args.subject}`)
    return
  }
  await mintSelfGeoClaim({
    subject: args.subject,
    signerAccount: identity.eoa,
    salt: identity.salt,
    cityKey: args.cityKey,
    relation: args.relation,
    confidence: args.confidence,
    logPrefix: '[catalyst-seed]',
  })
}

function upsertUser(u: { id: string; name: string; email: string; wallet: string; did: string }) {
  const existing = db.select().from(schema.localUserAccounts).where(eq(schema.localUserAccounts.id, u.id)).get()
  if (!existing) {
    db.insert(schema.localUserAccounts).values({ id: u.id, email: u.email, name: u.name, walletAddress: u.wallet, did: u.did }).run()
  }
}

/**
 * Auto-seed the Catalyst community on-chain.
 * Deploys all agents, creates all relationships, registers metadata.
 * Requires anvil + deployed contracts.
 */
// Process-lifetime locks live on globalThis so Next.js HMR module reloads
// don't reset them — without this, every hot-reload of the dev server
// resets the flags and lets re-seeds slip through.
//
// `__catalystSeeding` is the in-flight guard (concurrent calls return
// early); `__catalystSeededOnce` is the completed-once guard (subsequent
// calls in the same process short-circuit). Re-runs ARE idempotent at
// the individual-write level (each register / setController /
// mintGeoClaim re-checks state before writing), but the cumulative cost
// of N×M idempotent writes — multiplied by every demo-login fired by
// Playwright, fresh-start polling, etc. — saturates the deployer-lock
// and ends up scheduling enough kb-syncs to crash GraphDB.
//
// `fresh-start.sh` resets the process so the flags clear naturally; a
// running dev server reseeds only after a manual restart. That's the
// right tradeoff for the demo workflow.
const G = globalThis as { __catalystSeeding?: boolean; __catalystSeededOnce?: boolean }

/**
 * `CATALYST_SEED_MODE` selects how much of the catalyst community we seed.
 *
 *   minimal (default) — just Maria, Pastor David, the Catalyst NoCo Network
 *     org, the Fort Collins Network facilitator org, and the Catalyst Hub
 *     agent. ~30 on-chain ops total. Plenty for testing the three intent-
 *     marketplace lanes without crushing the public GraphDB instance.
 *
 *   full — the historical seed: 12 users, 11 orgs/AI agents, naming
 *     hierarchy, namespace edges, cross-delegations, dispute records.
 *     ~3000 on-chain ops; reserved for full demo recordings.
 *
 * Lane-specific seed scripts (seed-test-round / pool / proposal /
 * match-initiation) only need Maria + Network + Hub, so minimal is enough
 * to drive every spec-001/002/003 surface.
 */
function seedMode(): 'minimal' | 'full' {
  return (process.env.CATALYST_SEED_MODE ?? 'minimal') === 'full' ? 'full' : 'minimal'
}

export async function seedCatalystOnChain() {
  if (G.__catalystSeeding) { console.log('[catalyst-seed] Already in progress'); return }
  if (G.__catalystSeededOnce) { return }
  G.__catalystSeeding = true
  try {
    if (seedMode() === 'full') await doSeed()
    else await doMinimalSeed()
    G.__catalystSeededOnce = true
  } finally { G.__catalystSeeding = false }
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
  // R17 — Hannah is the G2 apprentice in Berthoud. Beneficiary of Sofia's
  // "needs a coach" intent; resolves through Berthoud → catalyst hub.
  const paHannah = userMap.get('cat-user-013')!.personAgentAddress as `0x${string}`
  // Sione — owner of Senegal Wolof Outreach (people-group research sub-org).
  const paSione = userMap.get('cat-user-014')?.personAgentAddress as `0x${string}` | undefined

  // ─── Deploy Org/AI Agent Smart Accounts ──────────────────────────
  // Each label MUST stay stable: the cross-network seed
  // (seed-disciple-networks-onchain.ts) reuses `catalyst:catalystNoco`
  // and `catalyst:hub` to compute the SAME counterfactual addresses
  // without re-deriving the salt/owner pair on its own.
  console.log('[catalyst-seed] Deploying org smart accounts...')
  const network              = await deploy('catalyst:catalystNoco',         200001)  // Catalyst NoCo Network
  const hub                  = await deploy('catalyst:fortCollinsNetwork',   200002)  // Fort Collins Network (regional facilitator org)
  const grpWellington        = await deploy('catalyst:grpWellington',        200003)
  const grpLaporte           = await deploy('catalyst:grpLaporte',           200004)
  const grpTimnath           = await deploy('catalyst:grpTimnath',           200005)
  const grpLoveland          = await deploy('catalyst:grpLoveland',          200006)
  const grpBerthoud          = await deploy('catalyst:grpBerthoud',          200007)
  const grpJohnstown         = await deploy('catalyst:grpJohnstown',         200008)
  const grpRedFeather        = await deploy('catalyst:grpRedFeather',        200009)
  const senegalWolofOutreach = await deploy('catalyst:senegalWolofOutreach', 200014)  // Sione's people-group research sub-org
  const analytics            = await deploy('catalyst:analytics',            210001)

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
  await register(senegalWolofOutreach, 'Senegal Wolof Outreach', 'Catalyst sub-tenant — diaspora research and people-group segmentation for the Wolof people in Senegal/Dakar', TYPE_ORGANIZATION)
  await register(analytics, 'NoCo Growth Analytics', 'Movement health tracking for Northern Colorado circles', TYPE_AI)
  // Person agents already registered by generateDemoWallet — skip re-registration

  // ─── Spec 006 — Treasury Service Agents per org ───────────────────
  // Each org gets a dedicated TreasuryAgent (separate AgentAccount, own
  // type, sa:hasTreasury back-link). Renders on the trust graph as a
  // teal node next to its parent org.
  console.log('[catalyst-seed] Deploying treasury service agents...')
  await deployAndLinkTreasury(network,              200001, 'Catalyst NoCo Network')
  await deployAndLinkTreasury(hub,                  200002, 'Fort Collins Network')
  await deployAndLinkTreasury(grpWellington,        200003, 'Wellington Circle')
  await deployAndLinkTreasury(grpLaporte,           200004, 'Laporte Circle')
  await deployAndLinkTreasury(grpTimnath,           200005, 'Timnath Circle')
  await deployAndLinkTreasury(grpLoveland,          200006, 'Loveland Circle')
  await deployAndLinkTreasury(grpBerthoud,          200007, 'Berthoud Circle')
  await deployAndLinkTreasury(grpJohnstown,         200008, 'Johnstown Circle')
  await deployAndLinkTreasury(grpRedFeather,        200009, 'Red Feather Circle')
  await deployAndLinkTreasury(senegalWolofOutreach, 200014, 'Senegal Wolof Outreach')

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
  // Sione owns Senegal Wolof Outreach; only seeded if user-014 is provisioned.
  if (paSione) {
    await createEdge(paSione, senegalWolofOutreach, ORGANIZATION_GOVERNANCE, [ROLE_OWNER])
  }

  // Membership edges layered on top of the governance graph.
  // Unified governance rule: Membership/member is the only descriptive
  // affiliation role; Membership/operator was removed because it
  // confused readers into thinking it granted admin authority (it didn't —
  // canManageAgent gates on Governance/owner). Members of an org gain
  // read access + vote rights on proposals in rounds anchored to that org.
  await createEdge(paDavid,  network,        ORGANIZATION_MEMBERSHIP, [ROLE_MEMBER])
  await createEdge(paCarlos, hub,            ORGANIZATION_MEMBERSHIP, [ROLE_MEMBER])
  await createEdge(paAna,    hub,            ORGANIZATION_MEMBERSHIP, [ROLE_MEMBER])
  await createEdge(paMiguel, hub,            ORGANIZATION_MEMBERSHIP, [ROLE_MEMBER])
  await createEdge(paElena,  hub,            ORGANIZATION_MEMBERSHIP, [ROLE_MEMBER])
  await createEdge(paLuis,   hub,            ORGANIZATION_MEMBERSHIP, [ROLE_MEMBER])
  await createEdge(paSofia,  hub,            ORGANIZATION_MEMBERSHIP, [ROLE_MEMBER])
  await createEdge(paDiego,  hub,            ORGANIZATION_MEMBERSHIP, [ROLE_MEMBER])
  await createEdge(paIsabel, hub,            ORGANIZATION_MEMBERSHIP, [ROLE_MEMBER])
  // R17 — Hannah is a member of Berthoud Circle (G2 apprentice).
  await createEdge(paHannah, grpBerthoud,    ORGANIZATION_MEMBERSHIP, [ROLE_MEMBER])
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

  // ─── Org → User cross-delegations ────────────────────────────────
  // For every ORG_GOVERNANCE owner edge, mint a signed Org→user-smart-account
  // delegation and persist it on-chain so admin users can act for the org
  // via their own session (no DEPLOYER_PRIVATE_KEY shortcut at runtime).
  console.log('[catalyst-seed] Seeding Org→User cross-delegations...')
  try {
    const { seedOrgCrossDelegations } = await import('./seed-org-delegations')
    const created = await seedOrgCrossDelegations([
      { orgAddress: network,        ownerUserId: 'cat-user-001' }, // paMaria
      { orgAddress: network,        ownerUserId: 'cat-user-005' }, // paSarah
      { orgAddress: hub,            ownerUserId: 'cat-user-002' }, // paDavid
      { orgAddress: hub,            ownerUserId: 'cat-user-003' }, // paRosa
      { orgAddress: grpWellington,  ownerUserId: 'cat-user-006' }, // paAna
      { orgAddress: grpLaporte,     ownerUserId: 'cat-user-007' }, // paMiguel
      { orgAddress: grpTimnath,     ownerUserId: 'cat-user-008' }, // paElena
      { orgAddress: grpLoveland,    ownerUserId: 'cat-user-009' }, // paLuis
      { orgAddress: grpBerthoud,    ownerUserId: 'cat-user-010' }, // paSofia
      { orgAddress: grpJohnstown,   ownerUserId: 'cat-user-011' }, // paDiego
      { orgAddress: grpRedFeather,  ownerUserId: 'cat-user-012' }, // paIsabel
      { orgAddress: analytics,      ownerUserId: 'cat-user-001' }, // paMaria
    ])
    console.log(`[catalyst-seed] Cross-delegations created: ${created}`)
  } catch (err) {
    console.warn('[catalyst-seed] Cross-delegation seed failed:', (err as Error).message)
  }

  // ─── People-Group cross-delegations (audience: people-groups) ────
  // Sione gets a delegation to act as Senegal Wolof Outreach against
  // people-group-mcp; Maria gets a separate delegation as a delegated
  // reader so the org-viewer "People-Group Focus" section renders for her.
  if (paSione) {
    console.log('[catalyst-seed] Seeding people-group cross-delegations...')
    try {
      const { seedOrgCrossDelegations } = await import('./seed-org-delegations')
      const PG_AUDIENCE = 'urn:mcp:server:people-groups'
      const PG_GRANTS = [{
        server: PG_AUDIENCE,
        resources: ['segments', 'estimates', 'reachedness', 'communities', 'community-locations', 'geometries', 'classifications'],
        fields: ['*'],
      }]
      // Sione also needs the standard org-mcp delegation for his own org.
      await seedOrgCrossDelegations([
        { orgAddress: senegalWolofOutreach, ownerUserId: 'cat-user-014' }, // org-mcp
      ])
      // PG-mcp delegations: Sione (full owner-style) + Maria (delegated reader).
      const created = await seedOrgCrossDelegations([
        { orgAddress: senegalWolofOutreach, ownerUserId: 'cat-user-014',
          audience: PG_AUDIENCE, grants: PG_GRANTS, saltLabel: 'people-groups:owner:v1' },
        { orgAddress: senegalWolofOutreach, ownerUserId: 'cat-user-001',
          audience: PG_AUDIENCE, grants: PG_GRANTS, saltLabel: 'people-groups:reader:v1' },
      ])
      console.log(`[catalyst-seed] People-group cross-delegations created: ${created}`)
    } catch (err) {
      console.warn('[catalyst-seed] People-group cross-delegation seed failed:', (err as Error).message)
    }
  }

  // ─── Coaching → profile cross-delegations ────────────────────────
  // For every COACHING_MENTORSHIP edge, mint a signed delegation that
  // grants the coach read access to a slice of the disciple's profile.
  // Disciple signs with their own EOA — explicit user consent.
  console.log('[catalyst-seed] Seeding coaching profile cross-delegations...')
  try {
    const { seedCoachingCrossDelegations } = await import('./seed-coaching-delegations')
    const created = await seedCoachingCrossDelegations([
      { discipleUserId: 'cat-user-006', coachUserId: 'cat-user-001' }, // Maria coaches Ana
      { discipleUserId: 'cat-user-004', coachUserId: 'cat-user-002' }, // David coaches Carlos
    ])
    console.log(`[catalyst-seed] Coaching cross-delegations created: ${created}`)
  } catch (err) {
    console.warn('[catalyst-seed] Coaching cross-delegation seed failed:', (err as Error).message)
  }

  // ─── Hub Agent ──────────────────────────────────────────────────
  console.log('[catalyst-seed] Deploying hub agent...')
  // Same label MUST match seed-disciple-networks-onchain.ts.
  const hubCatalyst = await deploy('catalyst:hub', 290001)
  await register(hubCatalyst, 'Catalyst Hub', 'Catalyst NoCo Network hub — Hispanic outreach, activity tracking, multiplication mapping', TYPE_HUB)

  // HAS_MEMBER edges — connect all agents to the hub
  console.log('[catalyst-seed] Creating HAS_MEMBER edges...')
  const allAgents = [
    network, hub,
    grpWellington, grpLaporte, grpTimnath, grpLoveland, grpBerthoud, grpJohnstown, grpRedFeather,
    senegalWolofOutreach,
    analytics,
    paMaria, paDavid, paRosa, paCarlos, paSarah, paAna, paMiguel,
    paElena, paLuis, paSofia, paDiego, paIsabel, paHannah,
    ...(paSione ? [paSione] : []),
  ]
  for (const agent of allAgents) {
    await createEdge(hubCatalyst, agent, HAS_MEMBER as `0x${string}`, [ROLE_MEMBER])
  }

  // ─── Agent Naming (.agent namespace) ─────────────────────────────
  console.log('[catalyst-seed] Setting up .agent naming hierarchy...')

  async function setNameProps(addr: `0x${string}`, label: string, fullName: string) {
    const resolver = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
    if (!resolver) return
    try {
      // Look up identity; person agents (deployed by generate-wallet)
      // live in a separate identity space and aren't in our map — for
      // those, the primary name was already set at generate time, so
      // skip silently rather than rewriting with a deployer the agent
      // doesn't recognize.
      const id = agentIdentities.get(addr.toLowerCase() as `0x${string}`)
      if (!id) return
      await writeAgentPropertiesAsSelf({
        smartAccount: addr,
        signerAccount: id.eoa,
        salt: id.salt,
        properties: [
          { kind: 'string', predicate: ATL_NAME_LABEL as `0x${string}`,   value: label },
          { kind: 'string', predicate: ATL_PRIMARY_NAME as `0x${string}`, value: fullName },
        ],
        label: `catalyst-seed:setNameProps(${label})`,
      })
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
    if (berNode) {
      await registerName(berNode, 'sofia', paSofia)
      // R17 — Hannah lives under berthoud.catalyst.agent.
      await registerName(berNode, 'hannah', paHannah)
    }
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
  await setNameProps(paHannah, 'hannah', 'hannah.berthoud.catalyst.agent')
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
  // R17 — Hannah lives under Berthoud Circle in the namespace tree.
  await createEdge(grpBerthoud,   paHannah, NS, NS_ROLES, nsEdgeMeta('hannah'))
  await createEdge(grpJohnstown,  paDiego,  NS, NS_ROLES, nsEdgeMeta('diego'))
  await createEdge(grpRedFeather, paIsabel, NS, NS_ROLES, nsEdgeMeta('isabel'))

  console.log('[catalyst-seed] Naming hierarchy created')

  // ─── Helper: Build and sign a data access delegation ──────────────
  // Sprint 2 S2.3 — also commits the recipient's smart-account +
  // person-agent into a DelegateBinding caveat so person-mcp (or
  // org-mcp) can verify the caller's session subject matches the bound
  // delegate at verify time. In single-account mode (the catalyst
  // demo's default) `granteeAgent === granteeSmartAccount`; the
  // binding is still emitted for cryptographic completeness.
  async function buildSignedDelegation(
    grantorAgent: `0x${string}`,
    granteeAgent: `0x${string}`,
    grantorUserId: string,
    grants: Array<{ server: string; resources: string[]; fields: string[] }>,
    granteeUserId?: string,
  ) {
    const {
      DATA_ACCESS_DELEGATION: DAD, ROLE_DATA_GRANTOR, ROLE_DATA_GRANTEE,
      hashDelegation: hashDel, encodeTimestampTerms: encTimestamp,
      buildCaveat: bCaveat, buildDataScopeCaveat: bDataScope,
      buildDelegateBindingCaveat: bDelegateBinding,
      ROOT_AUTHORITY: ROOT,
    } = await import('@smart-agent/sdk')
    const { privateKeyToAccount } = await import('viem/accounts')

    const grantorUser = db.select().from(schema.localUserAccounts).where(eq(schema.localUserAccounts.id, grantorUserId)).get()
    if (!grantorUser?.privateKey) return null

    // Resolve the grantee's smart-account for the binding caveat. In
    // single-account mode this equals `granteeAgent`; we look it up
    // when `granteeUserId` is provided.
    let granteeSmartAccount = granteeAgent
    if (granteeUserId) {
      const granteeUser = db.select().from(schema.localUserAccounts).where(eq(schema.localUserAccounts.id, granteeUserId)).get()
      if (granteeUser?.smartAccountAddress) {
        granteeSmartAccount = granteeUser.smartAccountAddress.toLowerCase() as `0x${string}`
      }
    }

    const now = Math.floor(Date.now() / 1000)
    const expiresAt = now + 90 * 24 * 60 * 60
    const salt = BigInt(Date.now() + Math.floor(Math.random() * 100000))
    const timestampAddr = process.env.TIMESTAMP_ENFORCER_ADDRESS as `0x${string}`
    const delegationManagerAddr = process.env.DELEGATION_MANAGER_ADDRESS as `0x${string}`
    const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')

    const caveats = [
      bCaveat(timestampAddr, encTimestamp(now, expiresAt)),
      bDataScope(grants),
      bDelegateBinding(granteeSmartAccount, granteeAgent),
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

    const result = await buildSignedDelegation(paAna, paMaria, 'cat-user-006', piiGrants, 'cat-user-001')
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

    const result = await buildSignedDelegation(paAna, paDavid, 'cat-user-006', coachGrants, 'cat-user-002')
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

/**
 * Minimal seed — just enough on-chain state to drive the proposal-funding
 * demo video + every page in the three intent-marketplace lanes (specs 001
 * / 002 / 003) without overloading the public GraphDB instance.
 *
 * Seeds:
 *   - 3 demo users: Maria Gonzalez (cat-user-001), Pastor David Chen
 *     (cat-user-002), Sarah Thompson (cat-user-005)
 *   - 3 org/hub agents: Catalyst NoCo Network, Fort Collins Network, Catalyst Hub
 *   - Geo claims (residentOf for users, operatesIn for orgs)
 *   - Governance + membership edges (Maria→Network OWNER, David→Hub OWNER,
 *     David→Network MEMBER, Sarah→Network MEMBER)
 *   - Issuer-EOA → Network controller link (org-mcp credential lookup)
 *   - Org→User cross-delegations (Network/Maria, Hub/David)
 *   - HAS_MEMBER edges from Catalyst Hub to all member agents
 *
 * Skipped vs full mode: 9 sub-circles, 1 people-group sub-org, analytics
 * AI agent, naming hierarchy, namespace edges, cross-circle alliances,
 * generational lineage, coaching delegations, engagement-overlap dispute.
 */
async function doMinimalSeed() {
  console.log('[catalyst-seed:minimal] Seeding catalyst essentials only (CATALYST_SEED_MODE=minimal)...')

  // Seed only the three users we exercise across the proposal-funding video
  // + three intent-marketplace lanes.
  upsertUser({ id: 'cat-user-001', name: 'Maria Gonzalez',    email: 'maria@catalystnoco.org', wallet: '0x00000000000000000000000000000000000b0001', did: 'did:demo:cat-001' })
  upsertUser({ id: 'cat-user-002', name: 'Pastor David Chen', email: 'david@catalystnoco.org', wallet: '0x00000000000000000000000000000000000b0002', did: 'did:demo:cat-002' })
  upsertUser({ id: 'cat-user-005', name: 'Sarah Thompson',    email: 'sarah@catalystnoco.org', wallet: '0x00000000000000000000000000000000000b0005', did: 'did:demo:cat-005' })

  // Provision wallets + person agents (one-time per user). `ensureDemoUser`
  // is idempotent — re-runs are no-ops.
  const { ensureDemoUser } = await import('./lookup-users')
  const maria = await ensureDemoUser('cat-user-001')
  const david = await ensureDemoUser('cat-user-002')
  const sarah = await ensureDemoUser('cat-user-005')
  const paMaria = maria.personAgentAddress as `0x${string}`
  const paDavid = david.personAgentAddress as `0x${string}`
  const paSarah = sarah.personAgentAddress as `0x${string}`

  // Deploy the three org-tier smart accounts. Labels MUST match the
  // full-seed pass + seed-disciple-networks so cross-seed deploy() calls
  // resolve to the same addresses.
  const network = await deploy('catalyst:catalystNoco', 200001)
  const hub = await deploy('catalyst:fortCollinsNetwork', 200002)
  const hubCatalyst = await deploy('catalyst:hub', 290001)
  console.log(`[catalyst-seed:minimal] Deployed: network=${network} hub=${hub} catalystHub=${hubCatalyst}`)

  await register(network, 'Catalyst NoCo Network', 'Northern Colorado catalyst network — Hispanic community outreach and church planting north of Fort Collins', TYPE_ORGANIZATION)
  await register(hub, 'Fort Collins Network', 'Regional facilitator org — bilingual community development across Fort Collins and surrounding circles', TYPE_ORGANIZATION)
  await register(hubCatalyst, 'Catalyst Hub', 'Catalyst NoCo Network hub — Hispanic outreach, activity tracking, multiplication mapping', TYPE_HUB)

  // Spec 006 — Treasury Service Agents (minimal-mode subset).
  console.log('[catalyst-seed:minimal] Deploying treasury service agents...')
  await deployAndLinkTreasury(network, 200001, 'Catalyst NoCo Network')
  await deployAndLinkTreasury(hub,     200002, 'Fort Collins Network')

  // Controllers — let signed-in users approve PROPOSED edges.
  await setController(network, maria.walletAddress)
  await setController(hub, david.walletAddress)

  // Issuer EOA → Network controller. The org-mcp service mints credentials
  // signed by ORG_PRIVATE_KEY; the wallet UI walks ATL_CONTROLLER lists
  // back to a human-readable org name.
  try {
    const orgKey = (process.env.ORG_PRIVATE_KEY ?? ('0x' + 'c'.repeat(64))) as `0x${string}`
    const { privateKeyToAccount } = await import('viem/accounts')
    const orgIssuerEoa = privateKeyToAccount(orgKey).address
    await setController(network, orgIssuerEoa)
    console.log('[catalyst-seed:minimal] Linked issuer EOA → Network:', orgIssuerEoa)
  } catch (e) {
    console.warn('[catalyst-seed:minimal] Issuer→Network controller link failed (non-fatal):', e)
  }

  // Geo (Fort Collins anchor for both orgs) + GeoClaims.
  await setGeo(network, '40.5853', '-105.0844')
  await setGeo(hub, '40.5734', '-105.0836')
  await mintGeoClaim({ subject: network, cityKey: 'us/colorado/fortcollins', relation: 'operatesIn', confidence: 100 })
  await mintGeoClaim({ subject: hub,     cityKey: 'us/colorado/fortcollins', relation: 'operatesIn', confidence: 100 })
  await mintGeoClaim({ subject: paMaria, cityKey: 'us/colorado/fortcollins', relation: 'residentOf', confidence: 90 })
  await mintGeoClaim({ subject: paDavid, cityKey: 'us/colorado/fortcollins', relation: 'residentOf', confidence: 90 })
  await mintGeoClaim({ subject: paSarah, cityKey: 'us/colorado/fortcollins', relation: 'residentOf', confidence: 90 })

  // Governance + membership — minimum for proposal/pledge/match flows.
  await createEdge(paMaria, network, ORGANIZATION_GOVERNANCE, [ROLE_OWNER])
  await createEdge(paDavid, hub,     ORGANIZATION_GOVERNANCE, [ROLE_OWNER])
  await createEdge(paDavid, network, ORGANIZATION_MEMBERSHIP, [ROLE_MEMBER])
  await createEdge(paSarah, network, ORGANIZATION_MEMBERSHIP, [ROLE_MEMBER])
  await createEdge(network, hub,     ALLIANCE,                [ROLE_STRATEGIC_PARTNER])

  // Org→user cross-delegations so org-acting actions don't need the deployer key.
  try {
    const { seedOrgCrossDelegations } = await import('./seed-org-delegations')
    const created = await seedOrgCrossDelegations([
      { orgAddress: network, ownerUserId: 'cat-user-001' },
      { orgAddress: hub,     ownerUserId: 'cat-user-002' },
    ])
    console.log(`[catalyst-seed:minimal] Cross-delegations created: ${created}`)
  } catch (err) {
    console.warn('[catalyst-seed:minimal] Cross-delegation seed failed:', (err as Error).message)
  }

  // HAS_MEMBER edges connect agents to the hub (drives /h/catalyst routing).
  for (const agent of [network, hub, paMaria, paDavid, paSarah]) {
    await createEdge(hubCatalyst, agent, HAS_MEMBER as `0x${string}`, [ROLE_MEMBER])
  }

  console.log('[catalyst-seed:minimal] Done — 3 users + 3 orgs + 2 treasuries. Set CATALYST_SEED_MODE=full to seed the complete community.')
}
