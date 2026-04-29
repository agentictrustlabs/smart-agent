/**
 * Catalyst Needs / Offerings demo seed.
 *
 * Inserts:
 *   - ~9 open needs across catalyst circles + Network + Hub
 *   - ~22 resource offerings across the 12 catalyst persona agents
 *   - Auto-runs runDiscoverMatch for each open need
 *
 * Idempotent: every insert is keyed on a stable lookup (title +
 * neededByAgent for needs; offeredByAgent + title for offerings) so
 * re-running boot-seed is a no-op.
 *
 * Runs after seed-demo-skill-claims to ensure person agents exist on-
 * chain and skill IDs resolve.
 */

import { db, schema } from '@/db'
import { and, eq } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { runDiscoverMatch } from '@/lib/actions/discover.action'

const HUB_ID = 'catalyst'

interface NeedSeed {
  needType: string
  needTypeLabel: string
  /** Lookup key — userId of the seeded user owning the need-bearing org. */
  ownerUserId: string
  /** Resolved at seed-time from the user's first owned org (or person agent). */
  title: string
  detail: string
  priority: 'critical' | 'high' | 'normal' | 'low'
  requirements: {
    role?: string
    skill?: string
    geo?: string
    timeWindow?: { recurrence?: string }
    capacity?: { unit: string; amount: number }
    credential?: string
  }
}

const CATALYST_NEEDS: NeedSeed[] = [
  // Berthoud circle — needs a coach (the dispute resolution context).
  {
    needType: 'needType:CircleCoachNeeded',
    needTypeLabel: 'Circle needs a coach',
    ownerUserId: 'cat-user-010',  // Sofia → Berthoud Circle
    title: 'Berthoud Circle needs an assigned coach',
    detail: 'The engagement-overlap dispute with Loveland flagged that Berthoud lacks a regional coach. The right coach can help mediate stewardOf scope and develop next-G leaders.',
    priority: 'high',
    requirements: {
      role: 'atl:CoachRole',
      skill: 'custom:church-planting',
      geo: 'us/colorado/berthoud',
      timeWindow: { recurrence: 'bi-weekly' },
    },
  },
  // Fort Collins Network — needs a treasurer.
  {
    needType: 'needType:Treasurer',
    needTypeLabel: 'Treasurer / financial steward',
    ownerUserId: 'cat-user-001',  // Maria → Catalyst NoCo Network
    title: 'Catalyst NoCo Network needs a treasurer',
    detail: 'After ECFA review, the network needs a vetted treasurer who can sign disbursements and chair the monthly stewardship review. Bookkeeping skill required; ECFA familiarity a plus.',
    priority: 'high',
    requirements: {
      role: 'atl:TreasurerRole',
      skill: 'custom:bookkeeping',
      credential: 'credential:ecfa-aware',
    },
  },
  // Wellington — connector to a funder.
  {
    needType: 'needType:ConnectorToFunder',
    needTypeLabel: 'Introduction to a funder',
    ownerUserId: 'cat-user-006',  // Ana → Wellington
    title: 'Wellington Circle needs a connector to a NoCo funder',
    detail: 'Wellington is multiplying faster than its Q4 budget can support. Looking for someone who can introduce the circle to NCF / NoCo-area donor-advised-fund holders.',
    priority: 'normal',
    requirements: {
      role: 'connector',
      geo: 'us/colorado/fortcollins',
    },
  },
  // Loveland — heart-language scripture access.
  {
    needType: 'needType:HeartLanguageScripture',
    needTypeLabel: 'Heart-language scripture access',
    ownerUserId: 'cat-user-009',  // Luis → Loveland
    title: 'Loveland Circle: heart-language scripture for indigenous-Mexican families',
    detail: 'Three families in Loveland speak indigenous-Mexican languages where Spanish-language scripture is a second language. Looking for Wycliffe / Progress.Bible referral or oral-Bible curriculum.',
    priority: 'normal',
    requirements: {
      skill: 'custom:translation-spanish-english',
      geo: 'us/colorado/loveland',
    },
  },
  // Catalyst NoCo Network — prayer partners adopted (low-priority, every circle benefits).
  {
    needType: 'needType:PrayerPartner',
    needTypeLabel: 'Prayer partner / intercessor',
    ownerUserId: 'cat-user-005',  // Sarah → Network
    title: 'Adopted intercessors for the seven NoCo circles',
    detail: 'Pairing each circle with 2–3 weekly intercessors via the 24-7 Prayer adoption pattern. Open to anyone who can commit to a weekly prayer slot.',
    priority: 'low',
    requirements: {
      timeWindow: { recurrence: 'weekly' },
    },
  },
  // Timnath — trauma-informed care provider.
  {
    needType: 'needType:TraumaInformedCare',
    needTypeLabel: 'Trauma-informed care provider',
    ownerUserId: 'cat-user-008',  // Elena → Timnath
    title: 'Timnath Circle: trauma-informed care for grief and separation',
    detail: 'Three case-load referrals this month. Looking for a GMCN-trained provider available for a weekly 60-minute consult.',
    priority: 'high',
    requirements: {
      skill: 'custom:trauma-informed-care',
      geo: 'us/colorado/timnath',
      timeWindow: { recurrence: 'weekly' },
      credential: 'credential:gmcn-trauma-care',
    },
  },
  // Fort Collins Hub — T4T trainer.
  {
    needType: 'needType:TrainerForT4T',
    needTypeLabel: 'T4T trainer',
    ownerUserId: 'cat-user-002',  // David → Hub
    title: 'Fort Collins Hub: T4T trainer for next intensive',
    detail: 'Two more circles ready for the IMB T4T 4 Fields intensive. Looking for someone certified to run the full two-day curriculum.',
    priority: 'normal',
    requirements: {
      role: 'atl:CoachRole',
      skill: 'custom:church-planting',
      credential: 'credential:t4t-trainer',
    },
  },
  // Red Feather — venue for gathering.
  {
    needType: 'needType:VenueForGathering',
    needTypeLabel: 'Venue for gathering',
    ownerUserId: 'cat-user-012',  // Isabel → Red Feather
    title: 'Red Feather Lakes: rotating venue for monthly potluck',
    detail: 'The mountain community gathers monthly; current host can\'t accommodate growth. Need a rotating venue around the lakes.',
    priority: 'low',
    requirements: {
      geo: 'us/colorado/redfeather',
      timeWindow: { recurrence: 'monthly' },
    },
  },
  // Laporte — group-leader apprentice.
  {
    needType: 'needType:GroupLeaderApprentice',
    needTypeLabel: 'Group-leader apprentice',
    ownerUserId: 'cat-user-007',  // Miguel → Laporte
    title: 'Laporte Circle: G2 apprentice from harvest crew',
    detail: 'Foreman Ricardo is the prepared candidate but needs paired apprenticeship before formal handoff. Looking for a coach willing to walk alongside for 3 months.',
    priority: 'normal',
    requirements: {
      role: 'atl:CoachRole',
      geo: 'us/colorado/laporte',
      skill: 'custom:youth-mentorship',
    },
  },
]

interface OfferingSeed {
  ownerUserId: string
  resourceType: string
  resourceTypeLabel: string
  title: string
  detail: string
  geo?: string
  capacity?: { unit: string; amount: number }
  timeWindow?: { recurrence?: string; days?: string }
  capabilities?: { skill?: string; role?: string; level?: string; evidence?: string }[]
}

const CATALYST_OFFERINGS: OfferingSeed[] = [
  // Maria — coach + connector + treasurer experience
  { ownerUserId: 'cat-user-001', resourceType: 'resourceType:Worker',    resourceTypeLabel: 'Missional Worker', title: 'Available as regional coach (15 hrs/wk)',         detail: 'Coach-of-coaches certified by Catalyst Leadership Network.',  geo: 'us/colorado/fortcollins', capacity: { unit: 'hours-per-week', amount: 15 }, timeWindow: { recurrence: 'weekly' }, capabilities: [{ role: 'atl:CoachRole', level: 'expert', skill: 'custom:church-planting' }] },
  { ownerUserId: 'cat-user-001', resourceType: 'resourceType:Connector', resourceTypeLabel: 'Connector / Introducer', title: 'Front Range pastors + NCF donor introductions',  detail: 'Active relationships with NCF, Front Range pastors coalition, and ECFA-vetted treasurers.', geo: 'us/colorado/fortcollins', capabilities: [{ role: 'connector', evidence: 'NCF, pastors coalition, ECFA' }] },
  { ownerUserId: 'cat-user-001', resourceType: 'resourceType:Skill',     resourceTypeLabel: 'Skill', title: 'Grant-writing capability',                                  detail: 'practicesSkill grant-writing claim on chain.',  geo: 'us/colorado/fortcollins', capabilities: [{ skill: 'custom:grant-writing', level: 'expert' }] },

  // David — coach + trainer + church-planting capacity
  { ownerUserId: 'cat-user-002', resourceType: 'resourceType:Worker',    resourceTypeLabel: 'Missional Worker', title: 'T4T trainer (next intensive available)',           detail: 'Certified T4T trainer; available for the next 2-day intensive.', geo: 'us/colorado/fortcollins', capacity: { unit: 'trips-per-year', amount: 4 }, capabilities: [{ role: 'atl:CoachRole', level: 'expert', evidence: 'credential:t4t-trainer', skill: 'custom:church-planting' }] },
  { ownerUserId: 'cat-user-002', resourceType: 'resourceType:Skill',     resourceTypeLabel: 'Skill', title: 'Pastoral care + church planting',                            detail: 'Pastoral care + church-planting skills (catalyst seed).', geo: 'us/colorado/fortcollins', capabilities: [{ skill: 'custom:pastoral-care', level: 'expert' }, { skill: 'custom:church-planting', level: 'experienced' }] },

  // Rosa — outreach skill + ESL + trauma awareness
  { ownerUserId: 'cat-user-003', resourceType: 'resourceType:Skill',     resourceTypeLabel: 'Skill', title: 'Spanish ESL + community organizing',                          detail: 'practicesSkill esl-instruction + community-organizing.', geo: 'us/colorado/fortcollins', capabilities: [{ skill: 'custom:esl-instruction', level: 'experienced' }] },
  { ownerUserId: 'cat-user-003', resourceType: 'resourceType:Worker',    resourceTypeLabel: 'Missional Worker', title: 'GMCN-trained trauma-informed care (10 hrs/wk)',     detail: 'Module 3 of the GMCN trauma-care course — available weekly.', geo: 'us/colorado/fortcollins', capacity: { unit: 'hours-per-week', amount: 10 }, timeWindow: { recurrence: 'weekly' }, capabilities: [{ skill: 'custom:trauma-informed-care', level: 'intermediate', evidence: 'credential:gmcn-trauma-care' }] },

  // Carlos — community partner; connector to school families
  { ownerUserId: 'cat-user-004', resourceType: 'resourceType:Connector', resourceTypeLabel: 'Connector / Introducer', title: 'Connector to school-bus families + tienda owners', detail: 'Established trust with three Spanish-speaking neighborhoods.', geo: 'us/colorado/fortcollins', capabilities: [{ role: 'connector', evidence: 'school-bus families, Tienda La Favorita, Vecina Lupe' }] },

  // Sarah — regional connector + coaching
  { ownerUserId: 'cat-user-005', resourceType: 'resourceType:Connector', resourceTypeLabel: 'Connector / Introducer', title: 'Front Range pastors + Frontier Ventures cohort',     detail: 'Co-chair of Lausanne Mission Mobilization issue network.', geo: 'us/colorado/loveland',    capabilities: [{ role: 'connector', evidence: 'Lausanne, Frontier Ventures, Front Range pastors' }] },
  { ownerUserId: 'cat-user-005', resourceType: 'resourceType:Worker',    resourceTypeLabel: 'Missional Worker', title: 'Regional coach (5 hrs/wk + travel)',                detail: 'Available for circle-launch consults across NoCo.', geo: 'us/colorado/loveland', capacity: { unit: 'hours-per-week', amount: 5 }, timeWindow: { recurrence: 'bi-weekly' }, capabilities: [{ role: 'atl:CoachRole', level: 'expert' }] },

  // Ana — circle-leader skill + prayer
  { ownerUserId: 'cat-user-006', resourceType: 'resourceType:Skill',     resourceTypeLabel: 'Skill', title: 'Wellington circle leadership',                                detail: 'practicesSkill youth-mentorship + community-organizing.', geo: 'us/colorado/wellington', capabilities: [{ skill: 'custom:youth-mentorship', level: 'experienced' }] },
  { ownerUserId: 'cat-user-006', resourceType: 'resourceType:Prayer',    resourceTypeLabel: 'Prayer / Intercession', title: 'Wellington families weekly prayer (Mon/Wed/Fri)', detail: 'Adopted Wellington families into 24-7 Prayer cadence.', geo: 'us/colorado/wellington', timeWindow: { recurrence: 'weekly', days: 'mon,wed,fri' }, capabilities: [{ skill: 'intercession', evidence: 'wellington.colorado.us.geo' }] },

  // Miguel — farm-worker outreach + Spanish-speaking coach
  { ownerUserId: 'cat-user-007', resourceType: 'resourceType:Skill',     resourceTypeLabel: 'Skill', title: 'Case management + Spanish farm-worker outreach',              detail: 'practicesSkill case-management + community-organizing.', geo: 'us/colorado/laporte', capabilities: [{ skill: 'custom:case-management', level: 'experienced' }] },
  { ownerUserId: 'cat-user-007', resourceType: 'resourceType:Worker',    resourceTypeLabel: 'Missional Worker', title: 'Spanish-speaking apprenticeship coach',              detail: 'Available to apprentice harvest-crew leaders into G2 roles.', geo: 'us/colorado/laporte', capacity: { unit: 'hours-per-week', amount: 8 }, timeWindow: { recurrence: 'weekly' }, capabilities: [{ role: 'atl:CoachRole', level: 'experienced' }] },

  // Elena — counselling / trauma-informed care
  { ownerUserId: 'cat-user-008', resourceType: 'resourceType:Worker',    resourceTypeLabel: 'Missional Worker', title: 'Trauma-informed care (Timnath; weekly slot)',          detail: 'GMCN module 3 complete; available for weekly 60-minute consults.', geo: 'us/colorado/timnath', capacity: { unit: 'hours-per-week', amount: 4 }, timeWindow: { recurrence: 'weekly' }, capabilities: [{ skill: 'custom:trauma-informed-care', level: 'experienced', evidence: 'credential:gmcn-trauma-care' }] },

  // Luis — bilingual + scripture engagement
  { ownerUserId: 'cat-user-009', resourceType: 'resourceType:Skill',     resourceTypeLabel: 'Skill', title: 'Spanish-English translation + circle leadership',           detail: 'practicesSkill translation-spanish-english + church-planting.', geo: 'us/colorado/loveland', capabilities: [{ skill: 'custom:translation-spanish-english', level: 'experienced' }] },
  { ownerUserId: 'cat-user-009', resourceType: 'resourceType:Scripture', resourceTypeLabel: 'Scripture / Translation', title: 'Wycliffe heart-language referral', detail: 'Active conversation with Wycliffe regional contact for indigenous-Mexican languages.', geo: 'us/colorado/loveland', capabilities: [{ skill: 'custom:translation-spanish-english', level: 'experienced' }] },

  // Sofia — circle leadership + farm-worker
  { ownerUserId: 'cat-user-010', resourceType: 'resourceType:Skill',     resourceTypeLabel: 'Skill', title: 'Berthoud farm-worker outreach',                              detail: 'Spanish + farm-worker community work.', geo: 'us/colorado/berthoud', capabilities: [{ skill: 'custom:community-organizing', level: 'intermediate' }] },

  // Diego — youth athletics outreach
  { ownerUserId: 'cat-user-011', resourceType: 'resourceType:Worker',    resourceTypeLabel: 'Missional Worker', title: 'Athletics-mentor outreach (Johnstown G3)',           detail: 'Coaching Coach Esteban + 12 athletes; available for partnership.', geo: 'us/colorado/johnstown', capacity: { unit: 'hours-per-week', amount: 6 }, capabilities: [{ skill: 'custom:youth-mentorship', level: 'intermediate' }] },

  // Isabel — rural mountain ministry venue + prayer
  { ownerUserId: 'cat-user-012', resourceType: 'resourceType:Venue',     resourceTypeLabel: 'Place / Venue', title: 'Lake-area cabin (monthly potluck capacity)',                   detail: 'Cabin sleeps 12 + outdoor space for 30. Available monthly.', geo: 'us/colorado/redfeather', capacity: { unit: 'people', amount: 30 }, timeWindow: { recurrence: 'monthly' } },
  { ownerUserId: 'cat-user-012', resourceType: 'resourceType:Prayer',    resourceTypeLabel: 'Prayer / Intercession', title: 'Rural mountain prayer cohort',                detail: 'Weekly intercession with Operation World rural cohort.', geo: 'us/colorado/redfeather', timeWindow: { recurrence: 'weekly', days: 'tue' }, capabilities: [{ skill: 'intercession', evidence: 'redfeather.colorado.us.geo' }] },
]

export async function seedCatalystNeedsAndOfferings(): Promise<void> {
  console.log('[needs-seed] Seeding catalyst needs + offerings…')

  // ── Needs: lookup the owner-user → first owned org address. ─────
  let needsInserted = 0
  let needsSkipped = 0
  const insertedNeedIds: string[] = []
  const ownedAgentByUser = await resolveOwnedAgents(CATALYST_NEEDS.map(n => n.ownerUserId))
  for (const seed of CATALYST_NEEDS) {
    const ownerAgent = ownedAgentByUser.get(seed.ownerUserId)
    if (!ownerAgent) { console.warn(`[needs-seed] no owned agent for ${seed.ownerUserId}; skip ${seed.title}`); continue }
    const dup = db.select().from(schema.needs)
      .where(and(eq(schema.needs.neededByAgent, ownerAgent), eq(schema.needs.title, seed.title)))
      .get()
    if (dup) {
      needsSkipped++
      insertedNeedIds.push(dup.id)
      continue
    }
    const id = randomUUID()
    const now = new Date().toISOString()
    db.insert(schema.needs).values({
      id,
      needType: seed.needType,
      needTypeLabel: seed.needTypeLabel,
      neededByAgent: ownerAgent,
      neededByUserId: seed.ownerUserId,
      hubId: HUB_ID,
      title: seed.title,
      detail: seed.detail,
      priority: seed.priority,
      status: 'open',
      requirements: JSON.stringify(seed.requirements),
      validUntil: null,
      createdBy: seed.ownerUserId,
      createdAt: now,
      updatedAt: now,
    }).run()
    needsInserted++
    insertedNeedIds.push(id)
  }

  // ── Offerings: lookup person agent for each user. ──────────────
  let offeringsInserted = 0
  let offeringsSkipped = 0
  const personAgentByUser = await resolvePersonAgents([...new Set(CATALYST_OFFERINGS.map(o => o.ownerUserId))])
  for (const seed of CATALYST_OFFERINGS) {
    const personAgent = personAgentByUser.get(seed.ownerUserId)
    if (!personAgent) { console.warn(`[needs-seed] no person agent for ${seed.ownerUserId}; skip ${seed.title}`); continue }
    const dup = db.select().from(schema.resourceOfferings)
      .where(and(eq(schema.resourceOfferings.offeredByAgent, personAgent), eq(schema.resourceOfferings.title, seed.title)))
      .get()
    if (dup) { offeringsSkipped++; continue }
    db.insert(schema.resourceOfferings).values({
      id: randomUUID(),
      offeredByAgent: personAgent,
      offeredByUserId: seed.ownerUserId,
      hubId: HUB_ID,
      resourceType: seed.resourceType,
      resourceTypeLabel: seed.resourceTypeLabel,
      title: seed.title,
      detail: seed.detail,
      status: 'available',
      capacity: seed.capacity ? JSON.stringify(seed.capacity) : null,
      geo: seed.geo ?? null,
      timeWindow: seed.timeWindow ? JSON.stringify(seed.timeWindow) : null,
      capabilities: seed.capabilities ? JSON.stringify(seed.capabilities) : null,
      validUntil: null,
    }).run()
    offeringsInserted++
  }

  console.log(`[needs-seed] needs: ${needsInserted} inserted, ${needsSkipped} skipped (already present)`)
  console.log(`[needs-seed] offerings: ${offeringsInserted} inserted, ${offeringsSkipped} skipped (already present)`)

  // ── Run match for every open catalyst need. ─────────────────────
  let totalMatches = 0
  for (const needId of insertedNeedIds) {
    try {
      const r = await runDiscoverMatch(needId)
      if ('matches' in r) totalMatches += r.matches.length
    } catch (err) {
      console.warn('[needs-seed] match run failed for', needId, err)
    }
  }
  console.log(`[needs-seed] generated ${totalMatches} matches across ${insertedNeedIds.length} needs`)
}

// ─── Helpers ─────────────────────────────────────────────────────────

/**
 * Map userId → the address of the org that user owns (for owner-style
 * needs, e.g. Sofia owns Berthoud Circle so a Berthoud need is owned
 * by sofia.user). Falls back to the user's person agent when no org
 * is owned.
 */
async function resolveOwnedAgents(userIds: string[]): Promise<Map<string, string>> {
  const { getPersonAgentForUser, getOrgsForPersonAgent } = await import('@/lib/agent-registry')
  const out = new Map<string, string>()
  for (const uid of userIds) {
    const personAgent = await getPersonAgentForUser(uid) as `0x${string}` | null
    if (!personAgent) continue
    const orgs = await getOrgsForPersonAgent(personAgent).catch(() => [])
    if (orgs.length > 0) {
      out.set(uid, orgs[0].address.toLowerCase())
    } else {
      out.set(uid, personAgent.toLowerCase())
    }
  }
  return out
}

async function resolvePersonAgents(userIds: string[]): Promise<Map<string, string>> {
  const { getPersonAgentForUser } = await import('@/lib/agent-registry')
  const out = new Map<string, string>()
  for (const uid of userIds) {
    const a = await getPersonAgentForUser(uid) as `0x${string}` | null
    if (a) out.set(uid, a.toLowerCase())
  }
  return out
}
