'use server'

/**
 * Catalyst sister networks — disciple-tools-flavoured demo orgs, all
 * located in Northern Colorado (sibling regions to Catalyst NoCo):
 *
 *   • Front Range House Churches  (foothills / Estes / Loveland — 5 actors)
 *   • Plains Church Planters       (eastern CO — Greeley / Sterling — 4 actors)
 *   • Denver Metro Bridge          (Denver / Aurora / Lakewood — 3 actors)
 *
 * The actors introduce role archetypes the original Catalyst seed
 * doesn't have — Multiplier (frontline disciple-maker), Dispatcher
 * (lead routing), Strategist (movement-vitality reading), Digital
 * Responder (online seeker follow-up), Multi-Generation Coach.
 *
 * These three orgs sit at the same level as `Catalyst NoCo Network`
 * in the hub graph: each is a top-level org agent with member edges
 * to its actors and a HAS_MEMBER edge from the Catalyst Hub agent.
 * Cross-network discovery (e.g. NoCo → Priya in Denver Metro) is the
 * primary motivation — they're sisters, not children.
 *
 * Idempotent at every step (skip-if-already-on-chain checks via the
 * resolver; createEdge no-ops on existing edges).
 */

import {
  deploySmartAccount, createRelationship, confirmRelationship,
  getPublicClient, getWalletClient,
} from '@/lib/contracts'
import {
  ORGANIZATION_GOVERNANCE, ORGANIZATION_MEMBERSHIP, ALLIANCE,
  HAS_MEMBER, COACHING_MENTORSHIP,
  ROLE_OWNER, ROLE_OPERATOR, ROLE_MEMBER, ROLE_ADVISOR,
  ROLE_STRATEGIC_PARTNER, ROLE_COACH, ROLE_DISCIPLE,
  ATL_CONTROLLER,
} from '@smart-agent/sdk'
import { agentAccountResolverAbi } from '@smart-agent/sdk'
import { keccak256, toBytes } from 'viem'
import { ensureCommunityUsers } from '@/lib/demo-seed/lookup-users'

const TYPE_ORGANIZATION = keccak256(toBytes('atl:OrganizationAgent'))
const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`

// CREATE2 salt buckets — disjoint from catalyst-seed (200001..299999),
// gc-seed, cil-seed. We use 600000s to avoid collisions on redeploy.
const SALT_FRONT_RANGE   = 600001
const SALT_PLAINS        = 600101
const SALT_DENVER_METRO  = 600201

// ─── Helpers (mirror seed-catalyst-onchain.ts patterns) ───────────────

async function deploy(salt: number) {
  const wc = getWalletClient()
  return deploySmartAccount(wc.account!.address, BigInt(salt))
}

async function register(addr: `0x${string}`, name: string, desc: string, agentType: `0x${string}`) {
  const wc = getWalletClient()
  const resolver = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
  if (!resolver) return
  try {
    const pc = getPublicClient()
    const isReg = await pc.readContract({
      address: resolver, abi: agentAccountResolverAbi,
      functionName: 'isRegistered', args: [addr],
    }) as boolean
    if (isReg) return
    await wc.writeContract({
      address: resolver, abi: agentAccountResolverAbi,
      functionName: 'register', args: [addr, name, desc, agentType, ZERO_HASH, ''],
    })
  } catch (e) {
    console.warn(`[disciple-networks-seed] Failed to register ${name}:`, (e as Error).message?.slice(0, 200))
  }
}

async function setController(agentAddr: `0x${string}`, walletAddr: string) {
  const wc = getWalletClient()
  const resolver = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
  if (!resolver) return
  try {
    const existing = await getPublicClient().readContract({
      address: resolver, abi: agentAccountResolverAbi,
      functionName: 'getMultiAddressProperty',
      args: [agentAddr, ATL_CONTROLLER as `0x${string}`],
    }) as string[]
    if (existing.some(a => a.toLowerCase() === walletAddr.toLowerCase())) return
    await wc.writeContract({
      address: resolver, abi: agentAccountResolverAbi,
      functionName: 'addMultiAddressProperty',
      args: [agentAddr, ATL_CONTROLLER as `0x${string}`, walletAddr as `0x${string}`],
    })
  } catch (e) {
    console.warn(`[disciple-networks-seed] Controller failed for ${agentAddr}:`, (e as Error).message?.slice(0, 200))
  }
}

async function createEdge(
  subject: `0x${string}`,
  object: `0x${string}`,
  relType: `0x${string}`,
  roles: `0x${string}`[],
  metadataURI?: string,
) {
  try {
    const edgeId = await createRelationship({ subject, object, roles, relationshipType: relType, metadataURI })
    await confirmRelationship(edgeId)
    return edgeId
  } catch (e) {
    console.warn('[disciple-networks-seed] Edge failed:', (e as Error).message?.slice(0, 200))
    return null
  }
}

// ─── Main entry ───────────────────────────────────────────────────────

export async function seedDiscipleNetworksOnChain() {
  console.log('[disciple-networks-seed] Provisioning users for Front Range / Plains / Denver Metro networks...')

  // Provision EOAs + person agents for the 12 new actors.
  const [frUsers, plUsers, dmUsers] = await Promise.all([
    ensureCommunityUsers('fr-user-'),
    ensureCommunityUsers('pl-user-'),
    ensureCommunityUsers('dm-user-'),
  ])
  if (frUsers.length === 0 && plUsers.length === 0 && dmUsers.length === 0) {
    console.log('[disciple-networks-seed] No fr/pl/dm users in DEMO_USER_META — skipping')
    return
  }

  const byKey = (users: typeof frUsers, key: string) =>
    users.find(u => u.key === key)?.personAgentAddress as `0x${string}` | undefined

  // ─── Deploy org agents ─────────────────────────────────────────────
  console.log('[disciple-networks-seed] Deploying 3 sister network org agents...')
  const frontRange  = await deploy(SALT_FRONT_RANGE)
  const plains      = await deploy(SALT_PLAINS)
  const denverMetro = await deploy(SALT_DENVER_METRO)

  await register(
    frontRange, 'Front Range House Churches',
    'Northern Colorado foothills + mountain corridor (Estes Park, Loveland, Berthoud) — house-church multiplication, multi-generation discipleship, frontline multipliers.',
    TYPE_ORGANIZATION,
  )
  await register(
    plains, 'Plains Church Planters',
    'Eastern Colorado plains (Greeley, Sterling, Yuma) — church planting via radio + digital seeker follow-up, daughter-church multiplication, movement-health reporting.',
    TYPE_ORGANIZATION,
  )
  await register(
    denverMetro, 'Denver Metro Bridge',
    'Denver / Aurora / Lakewood urban disciple-making — secular-context relational evangelism across neighborhood hubs, dispatcher-routed lead flow.',
    TYPE_ORGANIZATION,
  )

  // ─── Person agents (look up wallets for each actor) ────────────────
  const paAnnika   = byKey(frUsers, 'fr-user-001')
  const paBrent    = byKey(frUsers, 'fr-user-002')
  const paRachel   = byKey(frUsers, 'fr-user-003')
  const paKenji    = byKey(frUsers, 'fr-user-004')
  const paLina     = byKey(frUsers, 'fr-user-005')

  const paJoseph   = byKey(plUsers, 'pl-user-001')
  const paSophia   = byKey(plUsers, 'pl-user-002')
  const paPeter    = byKey(plUsers, 'pl-user-003')
  const paEsther   = byKey(plUsers, 'pl-user-004')

  const paMarcus   = byKey(dmUsers, 'dm-user-001')
  const paPriya    = byKey(dmUsers, 'dm-user-002')
  const paTerrence = byKey(dmUsers, 'dm-user-003')

  // ─── ATL_CONTROLLER wiring (admin's EOA controls the org) ──────────
  console.log('[disciple-networks-seed] Setting ATL_CONTROLLER on each org...')
  const frAdminEoa = frUsers.find(u => u.key === 'fr-user-001')?.walletAddress
  if (frAdminEoa) await setController(frontRange, frAdminEoa)
  const plAdminEoa = plUsers.find(u => u.key === 'pl-user-001')?.walletAddress
  if (plAdminEoa) await setController(plains, plAdminEoa)
  const dmAdminEoa = dmUsers.find(u => u.key === 'dm-user-001')?.walletAddress
  if (dmAdminEoa) await setController(denverMetro, dmAdminEoa)

  // ─── Governance + membership edges ─────────────────────────────────
  // Admins are owners; everyone else is operator/member with role
  // edges that reflect their archetype. Strategist gets an Advisor
  // role — they don't transact, they read + report.
  console.log('[disciple-networks-seed] Creating governance + membership edges...')

  // Front Range
  if (paAnnika)  await createEdge(paAnnika,  frontRange, ORGANIZATION_GOVERNANCE, [ROLE_OWNER])
  if (paBrent)   await createEdge(paBrent,   frontRange, ORGANIZATION_MEMBERSHIP, [ROLE_OPERATOR])
  if (paRachel)  await createEdge(paRachel,  frontRange, ORGANIZATION_MEMBERSHIP, [ROLE_OPERATOR])
  if (paKenji)   await createEdge(paKenji,   frontRange, ORGANIZATION_MEMBERSHIP, [ROLE_OPERATOR])
  if (paLina)    await createEdge(paLina,    frontRange, ORGANIZATION_MEMBERSHIP, [ROLE_ADVISOR])

  // Plains
  if (paJoseph)  await createEdge(paJoseph,  plains, ORGANIZATION_GOVERNANCE, [ROLE_OWNER])
  if (paSophia)  await createEdge(paSophia,  plains, ORGANIZATION_MEMBERSHIP, [ROLE_OPERATOR])
  if (paPeter)   await createEdge(paPeter,   plains, ORGANIZATION_MEMBERSHIP, [ROLE_OPERATOR])
  if (paEsther)  await createEdge(paEsther,  plains, ORGANIZATION_MEMBERSHIP, [ROLE_ADVISOR])

  // Denver Metro
  if (paMarcus)   await createEdge(paMarcus,   denverMetro, ORGANIZATION_GOVERNANCE, [ROLE_OWNER])
  if (paPriya)    await createEdge(paPriya,    denverMetro, ORGANIZATION_MEMBERSHIP, [ROLE_OPERATOR])
  if (paTerrence) await createEdge(paTerrence, denverMetro, ORGANIZATION_MEMBERSHIP, [ROLE_OPERATOR])

  // ─── HAS_MEMBER edges (org → person; mirrors hub seeds) ────────────
  console.log('[disciple-networks-seed] Creating HAS_MEMBER edges...')
  const frMembers = [paAnnika, paBrent, paRachel, paKenji, paLina].filter(Boolean) as `0x${string}`[]
  for (const m of frMembers) await createEdge(frontRange, m, HAS_MEMBER as `0x${string}`, [ROLE_MEMBER])
  const plMembers = [paJoseph, paSophia, paPeter, paEsther].filter(Boolean) as `0x${string}`[]
  for (const m of plMembers) await createEdge(plains, m, HAS_MEMBER as `0x${string}`, [ROLE_MEMBER])
  const dmMembers = [paMarcus, paPriya, paTerrence].filter(Boolean) as `0x${string}`[]
  for (const m of dmMembers) await createEdge(denverMetro, m, HAS_MEMBER as `0x${string}`, [ROLE_MEMBER])

  // ─── Mentor / coach relationships (the missional flavour) ──────────
  // Kenji (multi-gen coach) coaches Rachel (frontline multiplier) — the
  // archetypal 1st-gen → 2nd-gen multiplier handoff. Peter (church
  // planter) coaches Sophia (digital responder) — she surfaces seekers,
  // he plants the church they end up in. Marcus (admin) advises Priya
  // (coffee-shop discipler) — admin/strategy coaching. These edges
  // power the proposed "find a coach" surface by giving the trust-
  // search graph 1-hop coaching paths.
  console.log('[disciple-networks-seed] Creating coaching relationships...')
  if (paKenji && paRachel)   await createEdge(paKenji,  paRachel,  COACHING_MENTORSHIP, [ROLE_COACH, ROLE_DISCIPLE], 'multi-generation multiplier coaching')
  if (paPeter && paSophia)   await createEdge(paPeter,  paSophia,  COACHING_MENTORSHIP, [ROLE_COACH, ROLE_DISCIPLE], 'church-planter mentoring digital responder')
  if (paMarcus && paPriya)   await createEdge(paMarcus, paPriya,   COACHING_MENTORSHIP, [ROLE_COACH, ROLE_DISCIPLE], 'urban-strategy coach for coffee-shop discipler')

  // ─── Cross-network alliances ──────────────────────────────────────
  // Sister networks ally with each other and with Catalyst NoCo so the
  // Discover surface has visible cross-network bridges. We compute the
  // catalyst-noco + catalyst-hub addresses by re-running deploy() with
  // the same salts the catalyst seed uses (200001 / 290001) — CREATE2
  // makes this deterministic and idempotent: returns the existing
  // address rather than redeploying.
  console.log('[disciple-networks-seed] Creating sister-network alliances...')
  const catalystNoco = await deploy(200001)
  await createEdge(catalystNoco, frontRange,  ALLIANCE, [ROLE_STRATEGIC_PARTNER], 'cross-network discipleship learning exchange')
  await createEdge(catalystNoco, plains,      ALLIANCE, [ROLE_STRATEGIC_PARTNER], 'cross-network discipleship learning exchange')
  await createEdge(catalystNoco, denverMetro, ALLIANCE, [ROLE_STRATEGIC_PARTNER], 'cross-network discipleship learning exchange')
  await createEdge(frontRange, plains,      ALLIANCE, [ROLE_STRATEGIC_PARTNER], 'NoCo movement-multiplication peers')
  await createEdge(plains,     denverMetro, ALLIANCE, [ROLE_STRATEGIC_PARTNER], 'NoCo movement-multiplication peers')
  await createEdge(frontRange, denverMetro, ALLIANCE, [ROLE_STRATEGIC_PARTNER], 'NoCo movement-multiplication peers')

  // ─── Hub membership (Catalyst hub agent → these orgs) ──────────────
  // Hub agent salt = 290001 (matches seed-catalyst-onchain.ts line 433).
  // HAS_MEMBER edges so the new networks surface in hub member rolls.
  console.log('[disciple-networks-seed] Linking sister networks under Catalyst Hub...')
  const hubCatalyst = await deploy(290001)
  await createEdge(hubCatalyst, frontRange,  HAS_MEMBER as `0x${string}`, [ROLE_MEMBER])
  await createEdge(hubCatalyst, plains,      HAS_MEMBER as `0x${string}`, [ROLE_MEMBER])
  await createEdge(hubCatalyst, denverMetro, HAS_MEMBER as `0x${string}`, [ROLE_MEMBER])

  console.log(
    `[disciple-networks-seed] Sister networks deployed — ` +
    `Front Range (5 agents), Plains (4 agents), Denver Metro (3 agents); ` +
    `12 person agents, 3 orgs, 9 alliances, 3 coaching edges.`,
  )
}
