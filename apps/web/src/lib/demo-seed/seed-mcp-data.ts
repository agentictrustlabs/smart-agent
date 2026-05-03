/**
 * Demo seeder for MCP-private data.
 *
 * After the data-store consolidation, oikos / prayers / training / preferences
 * / coaching notes / personal intents live in person-mcp; revenue reports /
 * proposals / org members / org intents live in org-mcp. The activity log
 * lives on-chain (agent-resolver JSON property).
 *
 * EVERY write goes through the proper delegation flow — there is no direct
 * SQLite access from the seeder. For each demo user the seeder:
 *   1. Mints an A2A session signed by the user's private key (ERC-1271)
 *   2. Calls A2A `/mcp/person/<tool>` with `Authorization: Bearer <sessionId>`
 *   3. A2A re-mints a person-mcp delegation token, calls the MCP tool
 *   4. The MCP validates the delegation chain and writes the row
 *
 * For org-mcp seeding the session is bootstrapped against the ORG smart
 * account, signed by the admin user's key (ERC-1271 validates the signer
 * against the org's owner set).
 *
 * Idempotent — every tool call checks for existence first.
 */

import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { bootstrapA2ASessionForUser } from '@/lib/actions/a2a-session.action'
import { getOrgCrossDelegation } from './seed-org-delegations'

const A2A_AGENT_URL = process.env.A2A_AGENT_URL ?? 'http://localhost:3100'

interface OrgSession {
  sessionId: string
  crossDelegation: unknown
}

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

// ─── Session cache (one A2A session per delegator address) ────────────────

const sessionCache = new Map<string, string>()

async function sessionForUser(userId: string): Promise<string | null> {
  const u = db.select().from(schema.users).where(eq(schema.users.id, userId)).get()
  if (!u?.smartAccountAddress) return null
  const cached = sessionCache.get(u.smartAccountAddress.toLowerCase())
  if (cached) return cached
  const r = await bootstrapA2ASessionForUser({
    smartAccountAddress: u.smartAccountAddress,
    privateKey: u.privateKey,
  })
  if (!r.success || !r.sessionId) {
    console.warn(`[seed-mcp] session bootstrap failed for ${userId}: ${r.error}`)
    return null
  }
  sessionCache.set(u.smartAccountAddress.toLowerCase(), r.sessionId)
  return r.sessionId
}

// Bridged-delegation cache for org sessions.
// Key = `${orgAddress}|${adminUserId}` because the cross-delegation is
// per (org, admin-user) pair — each owner has their own signed token.
const orgSessionCache = new Map<string, OrgSession>()

async function sessionForOrg(adminUserId: string, orgAddress: string): Promise<OrgSession | null> {
  const cacheKey = `${orgAddress.toLowerCase()}|${adminUserId}`
  const cached = orgSessionCache.get(cacheKey)
  if (cached) return cached

  // Bridged chain: User EOA → User Smart Account (signs session) →
  // Org→User cross-delegation (read off-chain DATA_ACCESS_DELEGATION edge,
  // signed by deployer as ERC-1271 owner of org). No DEPLOYER_PRIVATE_KEY
  // shortcut — every write is gated by a real, on-chain-anchored signed
  // delegation chain that traces back to the user.

  const u = db.select().from(schema.users).where(eq(schema.users.id, adminUserId)).get()
  if (!u?.smartAccountAddress || !u?.privateKey) {
    console.warn(`[seed-mcp] admin ${adminUserId} missing smart account or key`)
    return null
  }

  // 1. Bootstrap admin's own A2A session against THEIR smart account.
  const r = await bootstrapA2ASessionForUser({
    smartAccountAddress: u.smartAccountAddress,
    privateKey: u.privateKey,
  })
  if (!r.success || !r.sessionId) {
    console.warn(`[seed-mcp] admin session bootstrap failed for ${adminUserId}: ${r.error}`)
    return null
  }

  // 2. Read the seeded Org→User cross-delegation from the on-chain edge.
  const cross = await getOrgCrossDelegation(orgAddress, adminUserId)
  if (!cross) {
    console.warn(`[seed-mcp] no Org→User cross-delegation on-chain yet for org=${orgAddress} user=${adminUserId} — run org-onchain seed first`)
    return null
  }

  const session: OrgSession = { sessionId: r.sessionId, crossDelegation: cross.delegation }
  orgSessionCache.set(cacheKey, session)
  return session
}

async function callMcp<T = unknown>(
  session: string | OrgSession,
  server: 'person' | 'org',
  tool: string,
  args: Record<string, unknown>,
): Promise<T | { error: string }> {
  const sessionId = typeof session === 'string' ? session : session.sessionId
  const body: Record<string, unknown> = { ...args }
  if (typeof session !== 'string' && session.crossDelegation) {
    body.crossDelegation = session.crossDelegation
  }
  const res = await fetch(`${A2A_AGENT_URL}/mcp/${server}/${tool}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${sessionId}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    return { error: err.error ?? `MCP ${server}.${tool} ${res.status}` }
  }
  return res.json() as Promise<T>
}

// ─── Person-private seeders (per-user, via delegation) ────────────────────

interface OikosEntry {
  personName: string
  proximity: string
  spiritualResponseState: string
  plannedConversation?: boolean
  notes?: string
}

interface PrayerEntry {
  title: string
  content?: string
  schedule: string
  responseState?: 'open' | 'answered'
  lastPrayedAt?: string
}

const FOUR_ONE_ONE_KEYS = ['411-1', '411-2', '411-3', '411-4', '411-5', '411-6']
const COC_KEYS = ['coc-love', 'coc-pray', 'coc-go', 'coc-baptize', 'coc-supper', 'coc-give', 'coc-anxiety', 'coc-judge', 'coc-abide', 'coc-unity']
const BDC_KEYS = ['bdc-1', 'bdc-2', 'bdc-3', 'bdc-4', 'bdc-5', 'bdc-6']

interface UserSpec {
  userId: string
  oikos?: OikosEntry[]
  prayers?: PrayerEntry[]
  training411?: number
  cocObeying?: number
  cocTeaching?: number
  bdcCompleted?: number
  preferences?: { language: string; homeChurch: string; location: string }
  notifications?: Array<{ kind: string; payload: string }>
}

const CATALYST_USERS: UserSpec[] = [
  {
    userId: 'cat-user-001',
    oikos: [
      { personName: 'Pastor David', proximity: 'ring1', spiritualResponseState: 'decided', plannedConversation: true, notes: 'Quarterly hub-lead 1:1' },
      { personName: 'Rosa Martinez', proximity: 'ring1', spiritualResponseState: 'decided', plannedConversation: true, notes: 'ESL pipeline review due' },
      { personName: 'Familia Lopez (Wellington)', proximity: 'ring2', spiritualResponseState: 'seeking' },
      { personName: 'County social services contact', proximity: 'ring3', spiritualResponseState: 'interested', plannedConversation: true, notes: 'Housing-aid intake protocol' },
      { personName: 'Tienda La Favorita owners', proximity: 'ring3', spiritualResponseState: 'curious' },
      { personName: 'Poudre School District liaison', proximity: 'ring4', spiritualResponseState: 'interested' },
    ],
    prayers: [
      { title: 'NoCo network growth and unity', schedule: 'daily', lastPrayedAt: daysAgo(1) },
      { title: "Pastor David's bridge-building vision", schedule: 'mon,wed,fri' },
      { title: 'Hispanic families facing housing insecurity', schedule: 'daily' },
      { title: 'Wisdom for immigration support ministry', schedule: 'tue,thu' },
      { title: 'Front Range pastors network', schedule: 'daily' },
      { title: 'Children of detained parents', schedule: 'daily' },
    ],
    training411: 6, cocObeying: 10, cocTeaching: 0,
    preferences: { language: 'es', homeChurch: 'Catalyst NoCo Network', location: 'Fort Collins, CO' },
    notifications: [
      { kind: 'review_received', payload: JSON.stringify({ title: 'Review received: NoCo Network annual', body: 'Sarah Thompson left a review on the network this quarter.', link: '/reviews' }) },
      { kind: 'relationship_proposed', payload: JSON.stringify({ title: 'Coach proposal: from Sarah Thompson', body: 'Sarah proposed a regional coaching cadence with you. Confirm or decline.', link: '/relationships' }) },
      { kind: 'data_access_granted', payload: JSON.stringify({ title: 'Ana Reyes shared personal data with you', body: 'Ana Reyes has shared her contact information with you.', link: '/catalyst/me/sharing' }) },
    ],
  },
  {
    userId: 'cat-user-002',
    oikos: [
      { personName: 'Ana Reyes (Wellington)', proximity: 'ring1', spiritualResponseState: 'decided', plannedConversation: true, notes: 'Quarterly check-in due' },
      { personName: 'Miguel Santos (Laporte)', proximity: 'ring1', spiritualResponseState: 'decided', plannedConversation: true, notes: 'Coaching cadence' },
      { personName: 'Rosa Martinez', proximity: 'ring1', spiritualResponseState: 'seeking' },
      { personName: 'Local pastors coalition', proximity: 'ring2', spiritualResponseState: 'interested', plannedConversation: true },
      { personName: 'CSU campus ministry contact', proximity: 'ring3', spiritualResponseState: 'curious' },
    ],
    prayers: [
      { title: 'Fort Collins Network growth', schedule: 'daily', lastPrayedAt: daysAgo(2) },
      { title: 'Wellington Circle — Ana and new families', schedule: 'mon,wed,fri,sat' },
      { title: 'Bilingual worship team development', schedule: 'sun' },
      { title: 'Carlos in his community-partner role', schedule: 'daily' },
      { title: 'Healing for families fractured by deportation', schedule: 'daily' },
    ],
    training411: 5, cocObeying: 8, cocTeaching: 4,
    preferences: { language: 'en', homeChurch: 'Fort Collins Network', location: 'Fort Collins, CO' },
    notifications: [
      { kind: 'review_received', payload: JSON.stringify({ title: 'Review received: Wellington Circle health', body: 'A peer left a review on Wellington Circle.', link: '/reviews' }) },
      { kind: 'dispute_filed', payload: JSON.stringify({ title: 'Dispute flagged: Berthoud engagement overlap', body: 'Fort Collins Hub flagged a stewardOf claim overlap.', link: '/reviews' }) },
      { kind: 'invite_sent', payload: JSON.stringify({ title: 'Invite to Carlos pending', body: 'Carlos has not yet completed onboarding.', link: '/people' }) },
    ],
  },
  {
    userId: 'cat-user-003',
    oikos: [
      { personName: 'Familia Herrera', proximity: 'ring1', spiritualResponseState: 'decided' },
      { personName: 'ESL students (Tue/Thu class)', proximity: 'ring2', spiritualResponseState: 'seeking', plannedConversation: true },
      { personName: 'Meat packing plant workers', proximity: 'ring3', spiritualResponseState: 'curious' },
      { personName: 'Neighbor Gloria', proximity: 'ring1', spiritualResponseState: 'interested', plannedConversation: true },
    ],
    prayers: [
      { title: 'Courage for ESL gospel conversations', schedule: 'tue,thu' },
      { title: 'Gloria and her children', schedule: 'daily', lastPrayedAt: daysAgo(2) },
      { title: 'Protection for undocumented families', schedule: 'daily' },
      { title: 'Wisdom for trauma-informed care', schedule: 'daily' },
    ],
    training411: 6, cocObeying: 6,
    preferences: { language: 'es', homeChurch: 'Catalyst NoCo Network', location: 'Fort Collins, CO' },
  },
  {
    userId: 'cat-user-006',
    oikos: [
      { personName: 'Familia Morales', proximity: 'ring1', spiritualResponseState: 'seeking', plannedConversation: true, notes: 'Husband is open to coffee meeting' },
      { personName: 'Youth group teens (5)', proximity: 'ring2', spiritualResponseState: 'interested' },
      { personName: 'Wellington Elementary parents', proximity: 'ring3', spiritualResponseState: 'curious' },
      { personName: 'Señora Campos', proximity: 'ring1', spiritualResponseState: 'decided', plannedConversation: true },
      { personName: 'Familia Vega', proximity: 'ring2', spiritualResponseState: 'interested', plannedConversation: true },
    ],
    prayers: [
      { title: 'Wellington Circle health and growth', schedule: 'daily' },
      { title: 'Youth caught between two cultures', schedule: 'mon,wed,fri' },
      { title: 'Familia Morales — husband seeking work', schedule: 'daily', lastPrayedAt: daysAgo(2) },
      { title: 'Wisdom on next-step training for new disciples', schedule: 'daily' },
      { title: 'Señora Campos — discipleship next steps', schedule: 'tue,thu,sat' },
    ],
    training411: 3, cocObeying: 4,
    preferences: { language: 'es', homeChurch: 'Wellington Circle', location: 'Wellington, CO' },
  },
  {
    userId: 'cat-user-007',
    oikos: [
      { personName: 'Farm crew (8 men)', proximity: 'ring1', spiritualResponseState: 'interested' },
      { personName: 'Foreman Ricardo', proximity: 'ring1', spiritualResponseState: 'seeking', plannedConversation: true },
      { personName: 'Familia Santos extended', proximity: 'ring2', spiritualResponseState: 'decided' },
      { personName: 'Iglesia La Cosecha pastor', proximity: 'ring3', spiritualResponseState: 'interested', plannedConversation: true },
    ],
    prayers: [
      { title: 'Laporte farm workers — safety and hope', schedule: 'daily', lastPrayedAt: daysAgo(2) },
      { title: 'Ricardo — open door for gospel', schedule: 'mon,wed,fri' },
      { title: 'Harvest-season multiplication', schedule: 'daily' },
    ],
    training411: 4, cocObeying: 5,
    preferences: { language: 'es', homeChurch: 'Laporte Circle', location: 'Laporte, CO' },
  },
]

const CIL_USERS: UserSpec[] = [
  {
    userId: 'cil-user-001',
    oikos: [
      { personName: 'Afia', proximity: 'ring1', spiritualResponseState: 'decided' },
      { personName: 'Kossi', proximity: 'ring1', spiritualResponseState: 'seeking' },
      { personName: 'Local government', proximity: 'ring3', spiritualResponseState: 'interested' },
      { personName: 'Togo NGO network', proximity: 'ring4', spiritualResponseState: 'curious' },
    ],
    prayers: [
      { title: 'Business success for cohort', schedule: 'daily', lastPrayedAt: daysAgo(1) },
      { title: "Afia's market growth", schedule: 'mon,wed,fri' },
      { title: 'Togo stability', schedule: 'sun' },
    ],
    training411: 6, cocObeying: 6,
    preferences: { language: 'en', homeChurch: 'ILAD', location: 'Lomé, Togo' },
  },
  {
    userId: 'cil-user-003',
    oikos: [
      { personName: 'Market neighbors', proximity: 'ring1', spiritualResponseState: 'interested' },
      { personName: 'Supplier Kokou', proximity: 'ring2', spiritualResponseState: 'curious' },
      { personName: 'Church friends', proximity: 'ring2', spiritualResponseState: 'decided' },
    ],
    prayers: [
      { title: 'Business growth', schedule: 'daily', lastPrayedAt: daysAgo(1) },
      { title: "Children's education", schedule: 'daily' },
      { title: 'Market peace', schedule: 'fri', responseState: 'answered' },
    ],
    training411: 2, cocObeying: 3, bdcCompleted: 4,
    preferences: { language: 'en', homeChurch: "Afia's Market", location: 'Lomé, Togo' },
  },
  {
    userId: 'cil-user-004',
    oikos: [
      { personName: 'Customers', proximity: 'ring2', spiritualResponseState: 'curious' },
      { personName: 'Apprentice Yao', proximity: 'ring1', spiritualResponseState: 'seeking' },
      { personName: 'Family', proximity: 'ring1', spiritualResponseState: 'decided' },
    ],
    prayers: [
      { title: 'Repair skills', schedule: 'daily' },
      { title: 'Apprentice growth', schedule: 'mon,wed,fri' },
    ],
    training411: 1, cocObeying: 2, bdcCompleted: 2,
    preferences: { language: 'en', homeChurch: 'Kossi Mobile Repairs', location: 'Lomé, Togo' },
  },
]

async function seedUserPersonal(spec: UserSpec): Promise<Record<string, number>> {
  const sessionId = await sessionForUser(spec.userId)
  if (!sessionId) return {}

  const counts: Record<string, number> = {}

  if (spec.oikos) {
    counts.oikos = 0
    // Read existing to make idempotent.
    const list = await callMcp<{ contacts: Array<{ id: string; personName: string; plannedConversation: number }> }>(
      sessionId, 'person', 'list_oikos_contacts', {})
    if ('error' in list) console.warn(`[seed-mcp] list_oikos_contacts: ${list.error}`)
    const existing = new Map<string, { id: string; plannedConversation: number }>(
      'error' in list ? [] : list.contacts.map(c => [c.personName, c]),
    )
    for (const e of spec.oikos) {
      const dup = existing.get(e.personName)
      if (dup) {
        // Only update if plannedConversation flag differs (idempotent re-run).
        const want = e.plannedConversation ? 1 : 0
        if (dup.plannedConversation !== want) {
          await callMcp<Record<string, unknown>>(sessionId, 'person', 'update_oikos_contact', {
            id: dup.id,
            plannedConversation: !!e.plannedConversation,
            notes: e.notes,
          })
        }
        continue
      }
      const r = await callMcp<Record<string, unknown>>(sessionId, 'person', 'add_oikos_contact', {
        personName: e.personName,
        proximity: e.proximity,
        spiritualResponseState: e.spiritualResponseState,
        plannedConversation: e.plannedConversation,
        notes: e.notes,
      })
      if (!('error' in r)) counts.oikos++
    }
  }

  if (spec.prayers) {
    counts.prayers = 0
    const list = await callMcp<{ prayers: Array<{ id: string; title: string }> }>(
      sessionId, 'person', 'list_prayers', {})
    const existing = new Set('error' in list ? [] : list.prayers.map(p => p.title))
    for (const e of spec.prayers) {
      if (existing.has(e.title)) continue
      const r = await callMcp<Record<string, unknown>>(sessionId, 'person', 'upsert_prayer', {
        title: e.title,
        content: e.content,
        schedule: e.schedule,
        // upsert_prayer doesn't set lastPrayedAt — call mark_prayer_response if needed
      })
      if (!('error' in r)) counts.prayers++
      if (e.lastPrayedAt) {
        // The mark_prayer_response tool sets lastPrayedAt to NOW; for the
        // demo seed we accept "today" rather than the original daysAgo
        // value. Acceptable trade-off: the public API doesn't expose the
        // back-date hook.
      }
    }
  }

  if (spec.training411 !== undefined) {
    counts.training411 = 0
    for (let i = 0; i < spec.training411; i++) {
      const r = await callMcp<Record<string, unknown>>(sessionId, 'person', 'toggle_training_module', {
        moduleKey: FOUR_ONE_ONE_KEYS[i], programKey: '411',
      })
      if (!('error' in r)) counts.training411++
    }
  }

  if (spec.cocObeying !== undefined) {
    counts.cocObeying = 0
    for (let i = 0; i < spec.cocObeying; i++) {
      const r = await callMcp<Record<string, unknown>>(sessionId, 'person', 'toggle_training_module', {
        moduleKey: COC_KEYS[i], programKey: 'commands', track: 'obeying',
      })
      if (!('error' in r)) counts.cocObeying++
    }
  }

  if (spec.cocTeaching !== undefined && spec.cocTeaching > 0) {
    counts.cocTeaching = 0
    for (let i = 0; i < spec.cocTeaching; i++) {
      const r = await callMcp<Record<string, unknown>>(sessionId, 'person', 'toggle_training_module', {
        moduleKey: COC_KEYS[i], programKey: 'commands', track: 'teaching',
      })
      if (!('error' in r)) counts.cocTeaching++
    }
  }

  if (spec.bdcCompleted !== undefined) {
    counts.bdc = 0
    for (let i = 0; i < spec.bdcCompleted; i++) {
      const r = await callMcp<Record<string, unknown>>(sessionId, 'person', 'toggle_training_module', {
        moduleKey: BDC_KEYS[i], programKey: 'bdc',
      })
      if (!('error' in r)) counts.bdc++
    }
  }

  if (spec.preferences) {
    const r = await callMcp<Record<string, unknown>>(sessionId, 'person', 'update_user_preferences', {
      language: spec.preferences.language,
      homeChurch: spec.preferences.homeChurch,
      location: spec.preferences.location,
    })
    counts.preferences = ('error' in r) ? 0 : 1
  }

  if (spec.notifications) {
    counts.notifications = 0
    const list = await callMcp<{ notifications: Array<{ id: string; kind: string; payload: string | null }> }>(
      sessionId, 'person', 'list_notifications', { includeRead: true })
    const existing = new Set(
      'error' in list ? [] : list.notifications.map(n => `${n.kind}:${n.payload}`),
    )
    for (const n of spec.notifications) {
      if (existing.has(`${n.kind}:${n.payload}`)) continue
      const r = await callMcp<Record<string, unknown>>(sessionId, 'person', 'create_notification', {
        kind: n.kind, payload: n.payload,
      })
      if (!('error' in r)) counts.notifications++
    }
  }

  return counts
}

// ─── Personal intents in person-mcp (via delegation) ─────────────────────

interface IntentSpec {
  userId: string
  direction: 'receive' | 'give'
  visibility: 'private' | 'public' | 'public-coarse' | 'off-chain'
  kind: string
  summary: string
  priority?: string
  requirements?: string
  capabilities?: string
  capacity?: number
  geo?: string
}

const PERSONAL_INTENTS: IntentSpec[] = [
  {
    userId: 'cat-user-001', direction: 'give', visibility: 'public',
    kind: 'sa:CoachingOfferType',
    summary: 'Available for coaching mentorship — Hispanic outreach + church planting',
    capabilities: JSON.stringify(['coach', 'church-planting', 'spanish']),
    capacity: 3, geo: 'us/colorado/larimer-county', priority: 'normal',
  },
  {
    userId: 'cat-user-001', direction: 'receive', visibility: 'private',
    kind: 'sa:GuidanceNeedType',
    summary: 'Need: trauma-informed care training for the network',
    priority: 'high',
  },
  {
    userId: 'cat-user-002', direction: 'receive', visibility: 'public',
    kind: 'sa:LeaderApprenticeNeedType',
    summary: 'Looking for a G2 apprentice for the Wellington Circle',
    requirements: JSON.stringify(['Spanish-speaking', 'church planting interest']),
    geo: 'us/colorado/wellington', priority: 'high',
  },
  {
    userId: 'cat-user-006', direction: 'receive', visibility: 'public-coarse',
    kind: 'sa:CircleCoachNeededType',
    summary: 'Wellington Circle: coach for new G2 apprentice',
    geo: 'us/colorado/wellington', priority: 'high',
  },
  {
    userId: 'cil-user-003', direction: 'receive', visibility: 'public',
    kind: 'sa:CapitalNeedType',
    summary: "Capital expansion for Afia's Market — additional inventory",
    capacity: 250000, geo: 'tg/lome', priority: 'high',
  },
  {
    userId: 'cil-user-001', direction: 'give', visibility: 'public',
    kind: 'sa:BusinessCoachingOfferType',
    summary: 'BDC business-development coaching available — Togo cohort',
    capabilities: JSON.stringify(['business-development', 'french', 'ewe']),
    capacity: 5, geo: 'tg', priority: 'normal',
  },
]

async function seedPersonalIntents(): Promise<number> {
  let inserted = 0
  for (const i of PERSONAL_INTENTS) {
    const sessionId = await sessionForUser(i.userId)
    if (!sessionId) continue
    const list = await callMcp<{ intents: Array<{ id: string; summary: string }> }>(
      sessionId, 'person', 'list_intents', {})
    const existing = new Set('error' in list ? [] : list.intents.map(x => x.summary))
    if (existing.has(i.summary)) continue
    const r = await callMcp<Record<string, unknown>>(sessionId, 'person', 'express_intent', {
      direction: i.direction,
      visibility: i.visibility,
      kind: i.kind,
      summary: i.summary,
      priority: i.priority,
      requirements: i.requirements,
      capabilities: i.capabilities,
      capacity: i.capacity,
      geo: i.geo,
    })
    if (!('error' in r)) inserted++
  }
  return inserted
}

// ─── Coaching notes (coach owns; via coach's session) ────────────────────

interface CoachingNoteSpec {
  coachUserId: string
  subjectUserId: string
  content: string
  sharedWithSubject?: boolean
}

const COACHING_NOTES: CoachingNoteSpec[] = [
  {
    coachUserId: 'cat-user-001', subjectUserId: 'cat-user-006',
    content: 'Wellington multiplication path: G2 candidate identified in Familia Morales household. Watch the burnout markers — Ana is carrying a lot.',
    sharedWithSubject: true,
  },
  {
    coachUserId: 'cat-user-001', subjectUserId: 'cat-user-007',
    content: 'Laporte harvest-season multiplication push: Ricardo (foreman) ready to disciple two crew members.',
    sharedWithSubject: true,
  },
  {
    coachUserId: 'cat-user-002', subjectUserId: 'cat-user-006',
    content: 'Reviewed the G2 split conversation pattern with Ana. She handled the Familia Morales tension well.',
    sharedWithSubject: false,
  },
  {
    coachUserId: 'cil-user-001', subjectUserId: 'cil-user-003',
    content: 'Afia is performing strongly on the BDC track — recommend graduation to Phase 2 capital access.',
    sharedWithSubject: true,
  },
]

// ─── Profile seeding for coaching subjects ────────────────────────────
// These rows live in person-mcp keyed by each user's smart-account
// principal. The DATA_ACCESS_DELEGATION cross-delegation seeded in
// seed-coaching-delegations.ts grants coaches read access to a subset
// of these fields.

interface ProfileSpec {
  userId: string
  displayName: string
  email: string
  phone: string
  language: string
  city: string
  stateProvince: string
  country: string
  bio?: string
  dateOfBirth?: string
  gender?: string
}

const PROFILE_SPECS: ProfileSpec[] = [
  // Catalyst — coaching subjects (Maria coaches Ana; David coaches Ana + Carlos)
  {
    userId: 'cat-user-004',
    displayName: 'Carlos Mendoza',
    email: 'carlos.mendoza@example.com',
    phone: '+1-970-555-0142',
    language: 'es',
    city: 'Fort Collins', stateProvince: 'CO', country: 'US',
    bio: 'Community partner — county social services liaison',
  },
  {
    userId: 'cat-user-006',
    displayName: 'Ana Reyes',
    email: 'ana.reyes@example.com',
    phone: '+1-970-555-0167',
    language: 'es',
    city: 'Wellington', stateProvince: 'CO', country: 'US',
    bio: 'Wellington Circle leader; bilingual disciple-maker',
    dateOfBirth: '1989-06-14',
  },
  // Private coachee — relationship lives off-chain via received_delegations.
  {
    userId: 'cat-user-013',
    displayName: 'Hannah Reyes',
    email: 'hannah@berthoud-circle.org',
    phone: '+1-970-555-0184',
    language: 'en',
    city: 'Berthoud', stateProvince: 'CO', country: 'US',
    bio: 'G2 apprentice in Berthoud Circle; emerging leader in bilingual outreach',
    dateOfBirth: '1998-11-22',
  },
]

async function seedProfiles(): Promise<number> {
  let inserted = 0
  for (const p of PROFILE_SPECS) {
    const sessionId = await sessionForUser(p.userId)
    if (!sessionId) continue

    const existing = await callMcp<{ profile: { displayName?: string } | null }>(
      sessionId, 'person', 'get_profile', {})
    if (!('error' in existing) && existing.profile?.displayName) {
      // Already seeded.
      continue
    }

    const r = await callMcp<{ profile: Record<string, unknown> }>(
      sessionId, 'person', 'update_profile', {
        displayName: p.displayName,
        email: p.email,
        phone: p.phone,
        language: p.language,
        city: p.city,
        stateProvince: p.stateProvince,
        country: p.country,
        bio: p.bio,
        dateOfBirth: p.dateOfBirth,
        gender: p.gender,
      },
    )
    if (!('error' in r)) inserted++
  }
  return inserted
}

async function seedCoachingNotes(): Promise<number> {
  let inserted = 0
  for (const n of COACHING_NOTES) {
    const sessionId = await sessionForUser(n.coachUserId)
    if (!sessionId) continue
    const subjectUser = db.select().from(schema.users).where(eq(schema.users.id, n.subjectUserId)).get()
    if (!subjectUser?.personAgentAddress) continue

    const list = await callMcp<{ notes: Array<{ id: string; content: string }> }>(
      sessionId, 'person', 'list_coaching_notes', { subjectAgent: subjectUser.personAgentAddress },
    )
    const existing = new Set('error' in list ? [] : list.notes.map(x => x.content))
    if (existing.has(n.content)) continue

    const r = await callMcp<Record<string, unknown>>(sessionId, 'person', 'upsert_coaching_note', {
      subjectAgent: subjectUser.personAgentAddress,
      content: n.content,
      sharedWithSubject: n.sharedWithSubject,
    })
    if (!('error' in r)) inserted++
  }
  return inserted
}

// ─── Private (off-chain) coaching delegations ─────────────────────────────
// For each (disciple, coach) pair, the disciple's EOA signs a delegation
// `delegator=disciple_smart_account, delegate=coach_smart_account` with
// scope grants for profile fields. We bootstrap the coach's session and
// push the signed blob to person-mcp's `received_delegations` via
// `register_received_delegation` — no on-chain edge is created.

interface PrivateCoachingPair {
  /** disciple owns the data; signs the delegation with their EOA */
  discipleUserId: string
  /** coach receives the delegation into their holder store */
  coachUserId: string
}

const PRIVATE_COACHING_PAIRS: PrivateCoachingPair[] = [
  // Maria privately coaches Hannah (G2 apprentice, Berthoud Circle).
  { discipleUserId: 'cat-user-013', coachUserId: 'cat-user-001' },
]

const PRIVATE_PROFILE_FIELDS = [
  'displayName', 'email', 'phone', 'language',
  'city', 'stateProvince', 'country',
]

async function seedPrivateCoaching(): Promise<number> {
  const {
    hashDelegation, encodeTimestampTerms, buildCaveat, buildDataScopeCaveat,
    ROOT_AUTHORITY,
  } = await import('@smart-agent/sdk')
  const { privateKeyToAccount } = await import('viem/accounts')
  const { keccak256, encodePacked } = await import('viem')

  const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')
  const delegationManagerAddr = process.env.DELEGATION_MANAGER_ADDRESS as `0x${string}` | undefined
  const timestampEnforcerAddr = process.env.TIMESTAMP_ENFORCER_ADDRESS as `0x${string}` | undefined
  if (!delegationManagerAddr || !timestampEnforcerAddr) {
    console.warn('[seed-mcp] missing DELEGATION_MANAGER_ADDRESS / TIMESTAMP_ENFORCER_ADDRESS — skipping private coaching')
    return 0
  }

  let registered = 0
  for (const { discipleUserId, coachUserId } of PRIVATE_COACHING_PAIRS) {
    const disciple = db.select().from(schema.users).where(eq(schema.users.id, discipleUserId)).get()
    const coach = db.select().from(schema.users).where(eq(schema.users.id, coachUserId)).get()
    if (!disciple?.smartAccountAddress || !disciple?.privateKey || !disciple?.name) {
      console.warn(`[seed-mcp] private-coach: disciple ${discipleUserId} not provisioned`)
      continue
    }
    if (!coach?.smartAccountAddress) {
      console.warn(`[seed-mcp] private-coach: coach ${coachUserId} not provisioned`)
      continue
    }

    const discipleSA = disciple.smartAccountAddress.toLowerCase() as `0x${string}`
    const coachSA = coach.smartAccountAddress.toLowerCase() as `0x${string}`

    const now = Math.floor(Date.now() / 1000)
    const expiresAt = now + 365 * 24 * 60 * 60
    const salt = BigInt(keccak256(encodePacked(
      ['address', 'address', 'string'],
      [discipleSA, coachSA, 'private-coaching:profile:v1'],
    )))

    const grants = [{
      server: 'urn:mcp:server:person',
      resources: ['profile'],
      fields: PRIVATE_PROFILE_FIELDS,
    }]

    const caveats = [
      buildCaveat(timestampEnforcerAddr, encodeTimestampTerms(now, expiresAt)),
      buildDataScopeCaveat(grants),
    ]

    const delegation = {
      delegator: discipleSA,
      delegate: coachSA,
      authority: ROOT_AUTHORITY as `0x${string}`,
      caveats,
      salt,
    }
    const delHash = hashDelegation(
      { ...delegation, salt: salt.toString() },
      CHAIN_ID,
      delegationManagerAddr,
    )

    const signer = privateKeyToAccount(disciple.privateKey as `0x${string}`)
    const signature = await signer.signMessage({ message: { raw: delHash } })

    const signedDelegation = {
      ...delegation,
      salt: salt.toString(),
      signature,
      caveats: caveats.map(c => ({ enforcer: c.enforcer, terms: c.terms })),
    }

    // Hand off to the coach's session — only the recipient can register a
    // received delegation (the MCP tool enforces holder-binding).
    const coachSession = await sessionForUser(coach.id)
    if (!coachSession) {
      console.warn(`[seed-mcp] private-coach: failed to bootstrap coach ${coach.id} session`)
      continue
    }

    const result = await callMcp<{ ok?: boolean; alreadyRegistered?: boolean; error?: string }>(
      coachSession, 'person', 'register_received_delegation',
      {
        delegation: signedDelegation,
        delegationHash: delHash,
        kind: 'coaching',
        subjectLabel: disciple.name,
        audience: 'urn:mcp:server:person',
      },
    )
    if ('error' in result && result.error) {
      console.warn(`[seed-mcp] private-coach: register failed for ${coach.id} ← ${disciple.id}: ${result.error}`)
      continue
    }
    registered++
  }
  return registered
}

// ─── Org-private seeders (revenue, proposals — via org delegation) ───────

interface RevenueRow {
  orgPrincipal: string
  adminUserId: string
  period: string
  grossRevenue: number
  expenses: number
  netRevenue: number
  sharePayment: number
  status: 'submitted' | 'verified' | 'disputed'
  submittedBy: string
  verifiedBy?: string
  verifiedAt?: string
}

// Resolve real on-chain agent addresses by name (deployed by seedCILOnChain).
async function resolveOrgAddress(name: string): Promise<string | null> {
  const { listRegisteredAgents } = await import('@/lib/agent-resolver')
  const agents = await listRegisteredAgents()
  const lower = name.toLowerCase()
  const match = agents.find(a => a.name.toLowerCase() === lower)
  return match?.address.toLowerCase() ?? null
}

interface RevenueRowSpec {
  orgName: string                    // looked up via agent registry
  adminUserId: string
  period: string
  grossRevenue: number
  expenses: number
  netRevenue: number
  sharePayment: number
  status: 'submitted' | 'verified' | 'disputed'
  submittedBy: string
  verifiedBy?: string
  verifiedAt?: string
}

const REVENUE_ROWS_SPEC: RevenueRowSpec[] = [
  { orgName: "Afia's Market", adminUserId: 'cil-user-003', period: '2026-01', grossRevenue: 450000, expenses: 280000, netRevenue: 170000, sharePayment: 25500, status: 'verified', submittedBy: 'cil-user-003', verifiedBy: 'cil-user-001', verifiedAt: daysAgo(60) },
  { orgName: "Afia's Market", adminUserId: 'cil-user-003', period: '2026-02', grossRevenue: 520000, expenses: 310000, netRevenue: 210000, sharePayment: 31500, status: 'verified', submittedBy: 'cil-user-003', verifiedBy: 'cil-user-001', verifiedAt: daysAgo(30) },
  { orgName: "Afia's Market", adminUserId: 'cil-user-003', period: '2026-03', grossRevenue: 480000, expenses: 295000, netRevenue: 185000, sharePayment: 27750, status: 'submitted', submittedBy: 'cil-user-003' },
  { orgName: 'Kossi Mobile Repairs', adminUserId: 'cil-user-004', period: '2026-01', grossRevenue: 180000, expenses: 95000, netRevenue: 85000, sharePayment: 12750, status: 'verified', submittedBy: 'cil-user-004', verifiedBy: 'cil-user-001', verifiedAt: daysAgo(60) },
  { orgName: 'Kossi Mobile Repairs', adminUserId: 'cil-user-004', period: '2026-02', grossRevenue: 210000, expenses: 110000, netRevenue: 100000, sharePayment: 15000, status: 'verified', submittedBy: 'cil-user-004', verifiedBy: 'cil-user-001', verifiedAt: daysAgo(30) },
  { orgName: 'Kossi Mobile Repairs', adminUserId: 'cil-user-004', period: '2026-03', grossRevenue: 150000, expenses: 120000, netRevenue: 30000, sharePayment: 4500, status: 'submitted', submittedBy: 'cil-user-004' },
]

async function seedRevenueReports(): Promise<number> {
  let inserted = 0
  const orgAddrCache = new Map<string, string | null>()
  async function getOrgAddr(name: string): Promise<string | null> {
    if (orgAddrCache.has(name)) return orgAddrCache.get(name)!
    const a = await resolveOrgAddress(name)
    orgAddrCache.set(name, a)
    return a
  }

  for (const r of REVENUE_ROWS_SPEC) {
    const orgAddr = await getOrgAddr(r.orgName)
    if (!orgAddr) {
      console.warn(`[seed-mcp] org not registered on-chain yet: ${r.orgName}`)
      continue
    }
    const sessionId = await sessionForOrg(r.adminUserId, orgAddr)
    if (!sessionId) continue

    const list = await callMcp<{ reports: Array<{ id: string; period: string }> }>(
      sessionId, 'org', 'list_revenue_reports', {})
    const existing = new Set('error' in list ? [] : list.reports.map(x => x.period))
    if (existing.has(r.period)) continue

    const sub = await callMcp<{ report: { id: string } }>(
      sessionId, 'org', 'submit_revenue_report', {
        period: r.period,
        grossRevenue: r.grossRevenue,
        expenses: r.expenses,
        netRevenue: r.netRevenue,
        sharePayment: r.sharePayment,
        submittedBy: r.submittedBy,
      },
    )
    if ('error' in sub) continue
    inserted++

    if (r.status === 'verified') {
      await callMcp<Record<string, unknown>>(sessionId, 'org', 'approve_revenue_report', {
        id: sub.report.id, verifiedBy: r.verifiedBy,
      })
    }
  }
  return inserted
}

interface ProposalSpec {
  orgName: string
  adminUserId: string
  kind: string
  title: string
  description: string
  proposerAgent: string
  targetOrgName?: string
}

const PROPOSAL_ROWS: ProposalSpec[] = [
  {
    orgName: 'Mission Collective Hub', adminUserId: 'cil-user-001',
    kind: 'graduate-wave',
    title: 'Graduate Wave 1 to Phase 2',
    description: 'Promote Wave 1 businesses that have completed BDC training and submitted 3 monthly revenue reports to Phase 2 capital access.',
    proposerAgent: 'cil-user-001',
  },
  {
    orgName: 'Mission Collective Hub', adminUserId: 'cil-user-001',
    kind: 'general',
    title: "Approve Afia's Market capital increase",
    description: "Increase capital allocation for Afia's Market based on consistent revenue growth.",
    proposerAgent: 'cil-user-001', targetOrgName: "Afia's Market",
  },
]

async function seedProposals(): Promise<number> {
  let inserted = 0
  for (const p of PROPOSAL_ROWS) {
    const orgAddr = await resolveOrgAddress(p.orgName)
    if (!orgAddr) {
      console.warn(`[seed-mcp] proposal-org not registered: ${p.orgName}`)
      continue
    }
    const targetAddr = p.targetOrgName ? await resolveOrgAddress(p.targetOrgName) : null
    const sessionId = await sessionForOrg(p.adminUserId, orgAddr)
    if (!sessionId) continue

    const list = await callMcp<{ proposals: Array<{ id: string; title: string }> }>(
      sessionId, 'org', 'list_proposals', {})
    const existing = new Set('error' in list ? [] : list.proposals.map(x => x.title))
    if (existing.has(p.title)) continue

    const r = await callMcp<Record<string, unknown>>(sessionId, 'org', 'create_proposal', {
      kind: p.kind, title: p.title, description: p.description,
      proposerAgent: p.proposerAgent, targetAddress: targetAddr ?? undefined,
    })
    if (!('error' in r)) inserted++
  }
  return inserted
}

// ─── On-chain activity log seeder ────────────────────────────────────────
// Activities live on-chain (agent-resolver JSON property) — not in any MCP.
// `setActivityLog` writes via the deployer key (system bootstrap; same as
// the on-chain agent/edge seeders use). No delegation required.

interface ActivitySpec {
  type: 'meeting' | 'visit' | 'training' | 'outreach' | 'follow-up' | 'coaching' | 'prayer' | 'service' | 'assessment' | 'other'
  title: string
  description: string
  participants: number
  location: string
  durationMinutes: number
  daysBack: number
}

const ACTIVITY_CATALOG: Record<string, ActivitySpec[]> = {
  'cat-user-001': [
    { type: 'meeting', title: 'Lausanne SOGC reading group — NoCo regional implications', description: 'Reviewed State of the Great Commission section on Hispanic diaspora response rates with regional staff.', participants: 6, location: 'Fort Collins, CO', durationMinutes: 75, daysBack: 2 },
    { type: 'meeting', title: 'GACX engagement-overlap working group', description: 'Walked through Berthoud/Loveland stewardOf overlap; agreed on alliance arbitration pattern.', participants: 8, location: 'Online', durationMinutes: 60, daysBack: 5 },
    { type: 'coaching', title: 'Coaching Ana Reyes — Wellington multiplication path', description: "Worked through Ana's next-G plan; G2 candidate identified in Familia Morales household.", participants: 1, location: 'Fort Collins, CO', durationMinutes: 45, daysBack: 3 },
    { type: 'coaching', title: 'Coaching Rosa Martinez — ESL outreach pipeline', description: 'Reviewed ESL → discipleship handoff metric; tied to GACX engagement-claim schema.', participants: 1, location: 'Fort Collins, CO', durationMinutes: 45, daysBack: 7 },
    { type: 'training', title: 'Movement Leaders Collective — readiness rubric calibration', description: 'Cross-org calibration call: how each network scores group-leader readiness.', participants: 12, location: 'Online', durationMinutes: 120, daysBack: 14 },
    { type: 'meeting', title: 'NewThing multiplication review (quarterly)', description: 'Wellington → Laporte → Johnstown chain; G3 health markers all green.', participants: 6, location: 'Online', durationMinutes: 60, daysBack: 18 },
    { type: 'service', title: 'Compassion International quarterly child-sponsorship event', description: 'Hosted sponsor-meet-child story night; 14 new sponsors signed up.', participants: 60, location: 'Fort Collins, CO', durationMinutes: 150, daysBack: 40 },
  ],
  'cat-user-002': [
    { type: 'meeting', title: "Wellington pastors' coalition — bilingual liturgy", description: 'Hosted four neighborhood pastors to align Sunday-evening liturgy across circles.', participants: 5, location: 'Fort Collins, CO', durationMinutes: 90, daysBack: 1 },
    { type: 'training', title: 'IMB T4T intensive — day 1', description: 'Three-day T4T intensive; Wellington and Laporte leaders attended.', participants: 14, location: 'Fort Collins, CO', durationMinutes: 360, daysBack: 4 },
    { type: 'visit', title: 'Wellington Circle — Familia Morales home visit', description: 'Pastoral visit; husband received gospel, ready for next-step Bible study.', participants: 6, location: 'Wellington, CO', durationMinutes: 120, daysBack: 6 },
    { type: 'coaching', title: 'Coaching Ana — handling the G2 split conversation', description: 'Discussed how to plant Familia Morales as a G2 group without fragmenting Wellington.', participants: 1, location: 'Fort Collins, CO', durationMinutes: 60, daysBack: 11 },
    { type: 'service', title: 'NoCo immigration legal-aid clinic', description: 'Hosted free legal-aid clinic with World Relief; served 22 families.', participants: 30, location: 'Fort Collins, CO', durationMinutes: 240, daysBack: 33 },
  ],
  'cat-user-006': [
    { type: 'meeting', title: 'Wellington Circle gathering — Sunday evening', description: '12 attendees; baptism scheduled for next week.', participants: 12, location: 'Wellington, CO', durationMinutes: 120, daysBack: 0 },
    { type: 'visit', title: 'Familia Morales home visit', description: 'Family meal; husband shared his testimony; Familia Morales is the next-G candidate.', participants: 6, location: 'Wellington, CO', durationMinutes: 150, daysBack: 2 },
    { type: 'visit', title: 'Señora Campos — discipleship session 4', description: 'Walked through IMB 4 Fields markers; she identified two seekers in her own oikos.', participants: 2, location: 'Wellington, CO', durationMinutes: 90, daysBack: 4 },
    { type: 'outreach', title: 'Wellington Elementary parents night', description: '8 new families met; 3 said yes to a follow-up coffee.', participants: 30, location: 'Wellington, CO', durationMinutes: 120, daysBack: 10 },
    { type: 'prayer', title: '24-7 Prayer hour — Wellington families', description: 'Adoption-prayer slot for adopted-zip Wellington commitments.', participants: 4, location: 'Wellington, CO', durationMinutes: 60, daysBack: 5 },
  ],
  'cat-user-007': [
    { type: 'meeting', title: 'Laporte Circle gathering — Sunday', description: '8 farm workers + Ricardo; first communion practice.', participants: 9, location: 'Laporte, CO', durationMinutes: 90, daysBack: 0 },
    { type: 'visit', title: 'Foreman Ricardo — coffee meeting', description: 'Long honest conversation about life and faith; Ricardo asked about baptism.', participants: 2, location: 'Laporte, CO', durationMinutes: 90, daysBack: 3 },
    { type: 'outreach', title: 'Farm crew lunch outreach — north fields', description: 'Brought lunch to the crew; six gospel conversations, two interest cards.', participants: 8, location: 'Laporte, CO', durationMinutes: 90, daysBack: 5 },
    { type: 'prayer', title: 'Laporte harvest-season prayer night', description: 'Hour of prayer for harvest safety, hope, and gospel openness.', participants: 11, location: 'Laporte, CO', durationMinutes: 60, daysBack: 14 },
  ],
}

async function seedActivitiesOnChain(): Promise<number> {
  const { randomUUID } = await import('crypto')
  const { getActivityLog, setActivityLog } = await import('@/lib/agent-resolver')
  const { getOrgsForPersonAgent } = await import('@/lib/agent-registry')

  let total = 0
  for (const [userId, specs] of Object.entries(ACTIVITY_CATALOG)) {
    const u = db.select().from(schema.users).where(eq(schema.users.id, userId)).get()
    if (!u?.personAgentAddress) continue

    const targetAddrs = new Set<string>([u.personAgentAddress.toLowerCase()])
    try {
      const orgs = await getOrgsForPersonAgent(u.personAgentAddress as `0x${string}`)
      for (const org of orgs) targetAddrs.add(org.address.toLowerCase())
    } catch { /* on-chain unavailable */ }

    for (const orgAddr of targetAddrs) {
      let existing: any[] = []
      try { existing = (await getActivityLog(orgAddr)) as any[] } catch { existing = [] }
      const seenTitles = new Set(existing.map((e: any) => e.title))
      let added = 0
      for (const s of specs) {
        if (seenTitles.has(s.title)) continue
        const date = daysAgo(s.daysBack)
        existing.push({
          id: randomUUID(),
          type: s.type,
          title: s.title,
          description: s.description,
          notes: s.description,
          date,
          duration: s.durationMinutes,
          participants: s.participants,
          location: s.location,
          createdBy: userId,
          createdAt: date,
        })
        added++
      }
      if (added > 0) {
        try {
          await setActivityLog(orgAddr, existing as never)
          total += added
        } catch (err) {
          console.warn(`[seed-mcp] activity log write failed for ${orgAddr}:`, (err as Error).message)
        }
      }
    }
  }
  return total
}

// ─── Public API ───────────────────────────────────────────────────────────

export async function seedMcpDemoData(): Promise<void> {
  console.log('[seed-mcp] starting MCP demo seed (delegation-only)…')
  sessionCache.clear()

  const totals: Record<string, number> = {}
  for (const spec of [...CATALYST_USERS, ...CIL_USERS]) {
    const counts = await seedUserPersonal(spec)
    for (const [k, v] of Object.entries(counts)) {
      totals[k] = (totals[k] ?? 0) + v
    }
  }
  totals.profiles = await seedProfiles()
  totals.coaching = await seedCoachingNotes()
  totals.privateCoaching = await seedPrivateCoaching()
  totals.intents = await seedPersonalIntents()
  console.log('[seed-mcp] person-mcp totals:', totals)

  const rev = await seedRevenueReports()
  const prop = await seedProposals()
  console.log(`[seed-mcp] org-mcp: revenue=${rev} proposals=${prop}`)

  try {
    const a = await seedActivitiesOnChain()
    console.log(`[seed-mcp] on-chain activities: ${a}`)
  } catch (err) {
    console.warn('[seed-mcp] on-chain activity seed failed:', (err as Error).message)
  }

  console.log('[seed-mcp] done')
}
