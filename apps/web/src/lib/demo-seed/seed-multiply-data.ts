import { db, schema } from '@/db'
import { eq, and } from 'drizzle-orm'
import { randomUUID } from 'crypto'

// ─── Helpers ──────────────────────────────────────────────────────────

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

function today(): string {
  return new Date().toISOString()
}

function hasOikosContacts(userId: string): boolean {
  const row = db.select().from(schema.circles).where(eq(schema.circles.userId, userId)).get()
  return !!row
}

function userExists(userId: string): boolean {
  const row = db.select().from(schema.users).where(eq(schema.users.id, userId)).get()
  return !!row
}

function shouldSeed(userId: string): boolean {
  return userExists(userId) && !hasOikosContacts(userId)
}

// ─── Oikos helper ─────────────────────────────────────────────────────

interface OikosEntry {
  personName: string
  proximity: number
  response: 'not-interested' | 'curious' | 'interested' | 'seeking' | 'decided' | 'baptized'
  plannedConversation?: boolean
  notes?: string
}

function insertOikosContacts(userId: string, entries: OikosEntry[]) {
  for (const e of entries) {
    db.insert(schema.circles).values({
      id: randomUUID(),
      userId,
      personName: e.personName,
      proximity: e.proximity,
      response: e.response,
      plannedConversation: e.plannedConversation ? 1 : 0,
      notes: e.notes ?? null,
    }).run()
  }
}

// ─── Prayer helper ────────────────────────────────────────────────────

interface PrayerEntry {
  title: string
  schedule: string
  lastPrayed?: string
  answered?: boolean
  notes?: string
}

function insertPrayers(userId: string, entries: PrayerEntry[]) {
  for (const e of entries) {
    db.insert(schema.prayers).values({
      id: randomUUID(),
      userId,
      title: e.title,
      schedule: e.schedule,
      lastPrayed: e.lastPrayed ?? null,
      answered: e.answered ? 1 : 0,
      answeredAt: e.answered ? daysAgo(7) : null,
      notes: e.notes ?? null,
    }).run()
  }
}

// Idempotent at the row level — inserts (userId, title) only if missing.
// Used by `boostMyWorkItems` so re-runs add new prayer rows without
// nuking what's already there.
function upsertPrayersByTitle(userId: string, entries: PrayerEntry[]) {
  for (const e of entries) {
    const dup = db.select().from(schema.prayers)
      .where(and(eq(schema.prayers.userId, userId), eq(schema.prayers.title, e.title)))
      .get()
    if (dup) continue
    db.insert(schema.prayers).values({
      id: randomUUID(),
      userId,
      title: e.title,
      schedule: e.schedule,
      lastPrayed: e.lastPrayed ?? null,
      answered: e.answered ? 1 : 0,
      answeredAt: e.answered ? daysAgo(7) : null,
      notes: e.notes ?? null,
    }).run()
  }
}

// Idempotent — inserts (userId, personName) only if missing.
function upsertOikosByName(userId: string, entries: OikosEntry[]) {
  for (const e of entries) {
    const dup = db.select().from(schema.circles)
      .where(and(eq(schema.circles.userId, userId), eq(schema.circles.personName, e.personName)))
      .get()
    if (dup) continue
    db.insert(schema.circles).values({
      id: randomUUID(),
      userId,
      personName: e.personName,
      proximity: e.proximity,
      response: e.response,
      plannedConversation: e.plannedConversation ? 1 : 0,
      notes: e.notes ?? null,
    }).run()
  }
}

// ─── Training helper ──────────────────────────────────────────────────

const FOUR_ONE_ONE_KEYS = ['411-1', '411-2', '411-3', '411-4', '411-5', '411-6']
const COC_KEYS = ['coc-love', 'coc-pray', 'coc-go', 'coc-baptize', 'coc-supper', 'coc-give', 'coc-anxiety', 'coc-judge', 'coc-abide', 'coc-unity']

function insert411(userId: string, completedCount: number) {
  for (let i = 0; i < FOUR_ONE_ONE_KEYS.length; i++) {
    const done = i < completedCount
    db.insert(schema.trainingProgress).values({
      id: randomUUID(),
      userId,
      moduleKey: FOUR_ONE_ONE_KEYS[i],
      program: '411',
      track: null,
      completed: done ? 1 : 0,
      completedAt: done ? daysAgo(30 - i) : null,
    }).run()
  }
}

function insertCOC(userId: string, obeyingCount: number, teachingCount?: number) {
  for (let i = 0; i < COC_KEYS.length; i++) {
    const done = i < obeyingCount
    db.insert(schema.trainingProgress).values({
      id: randomUUID(),
      userId,
      moduleKey: COC_KEYS[i],
      program: 'commands',
      track: 'obeying',
      completed: done ? 1 : 0,
      completedAt: done ? daysAgo(20 - i) : null,
    }).run()
  }
  if (teachingCount !== undefined) {
    for (let i = 0; i < COC_KEYS.length; i++) {
      const done = i < teachingCount
      db.insert(schema.trainingProgress).values({
        id: randomUUID(),
        userId,
        moduleKey: COC_KEYS[i],
        program: 'commands',
        track: 'teaching',
        completed: done ? 1 : 0,
        completedAt: done ? daysAgo(15 - i) : null,
      }).run()
    }
  }
}

// ─── Coach relationship helper ────────────────────────────────────────

function insertCoachRelationship(discipleId: string, coachId: string) {
  db.insert(schema.coachRelationships).values({
    id: randomUUID(),
    discipleId,
    coachId,
    sharePermissions: 'circles,prayers,training',
    status: 'active',
  }).run()
}

// ─── Preferences helper ──────────────────────────────────────────────

function insertPreferences(userId: string, language: string, homeChurch: string, location: string) {
  db.insert(schema.userPreferences).values({
    id: randomUUID(),
    userId,
    language,
    homeChurch,
    location,
  }).run()
}

// ═══════════════════════════════════════════════════════════════════════
// Seed functions per environment
// ═══════════════════════════════════════════════════════════════════════

function seedGlobalChurch() {
  // ─── gc-user-001: Pastor James (Coach) ────────────────────────────
  const u1 = 'gc-user-001'
  if (shouldSeed(u1)) {
    insertOikosContacts(u1, [
      { personName: 'Maria Chen', proximity: 1, response: 'decided' },
      { personName: 'Tom & Lisa', proximity: 2, response: 'interested' },
      { personName: 'Youth Group', proximity: 2, response: 'seeking' },
      { personName: 'New Visitor - Ahmed', proximity: 3, response: 'curious' },
      { personName: 'Neighborhood Watch', proximity: 4, response: 'not-interested' },
    ])
    insertPrayers(u1, [
      { title: 'Church growth', schedule: 'daily', lastPrayed: daysAgo(1) },
      { title: 'Youth ministry revival', schedule: 'mon,wed,fri' },
      { title: "Ahmed's salvation", schedule: 'daily', lastPrayed: daysAgo(2) },
      { title: 'Mission trip funding', schedule: 'sun', answered: true },
    ])
    insert411(u1, 6) // all complete
    insertCOC(u1, 10, 7) // all obeying, 7/10 teaching
    insertCoachRelationship('gc-user-002', u1)
    insertPreferences(u1, 'en', 'Grace Community Church', 'Sun Valley, CA')
  }

  // ─── gc-user-002: Dr. Sarah Mitchell (Disciple + Coach) ──────────
  const u2 = 'gc-user-002'
  if (shouldSeed(u2)) {
    insertOikosContacts(u2, [
      { personName: 'Board members', proximity: 1, response: 'decided' },
      { personName: 'Seminary students', proximity: 2, response: 'interested' },
      { personName: 'Interfaith council', proximity: 3, response: 'curious' },
    ])
    insertPrayers(u2, [
      { title: 'Convention unity', schedule: 'daily' },
      { title: 'Seminary graduates', schedule: 'tue,thu' },
    ])
    insert411(u2, 4) // 4/6
    insertCOC(u2, 5) // 5/10 obeying
    insertPreferences(u2, 'en', 'SBC', 'Nashville, TN')
  }
}

function seedCatalystNetwork() {
  // ─── cat-user-001: Maria Gonzalez (Coach — NoCo Hispanic outreach) ─
  const u1 = 'cat-user-001'
  if (shouldSeed(u1)) {
    insertOikosContacts(u1, [
      { personName: 'Pastor David', proximity: 1, response: 'decided' },
      { personName: 'Rosa Martinez', proximity: 1, response: 'decided' },
      { personName: 'Familia Lopez (Wellington)', proximity: 2, response: 'seeking' },
      { personName: 'County social services contact', proximity: 3, response: 'interested' },
      { personName: 'Tienda La Favorita owners', proximity: 3, response: 'curious' },
      { personName: 'Poudre School District liaison', proximity: 4, response: 'interested' },
    ])
    insertPrayers(u1, [
      // No `lastPrayed` on most → all daily ones surface as Pray-now items.
      { title: 'NoCo network growth and unity', schedule: 'daily', lastPrayed: daysAgo(1) },
      { title: "Pastor David's bridge-building vision", schedule: 'mon,wed,fri' },
      { title: 'Hispanic families facing housing insecurity', schedule: 'daily' },
      { title: 'Wisdom for immigration support ministry', schedule: 'tue,thu' },
      { title: 'Front Range pastors network', schedule: 'daily' },
      { title: 'Children of detained parents', schedule: 'daily' },
    ])
    insert411(u1, 6)  // all complete
    insertCOC(u1, 10) // all complete
    insertCoachRelationship('cat-user-002', u1)
    insertCoachRelationship('cat-user-003', u1)
    insertPreferences(u1, 'es', 'Catalyst NoCo Network', 'Fort Collins, CO')
  }

  // ─── cat-user-002: Pastor David Chen (Hub Lead — Disciple) ────────
  const u2 = 'cat-user-002'
  if (shouldSeed(u2)) {
    insertOikosContacts(u2, [
      { personName: 'Ana Reyes (Wellington)', proximity: 1, response: 'decided', plannedConversation: true, notes: 'Quarterly check-in due' },
      { personName: 'Miguel Santos (Laporte)', proximity: 1, response: 'decided', plannedConversation: true, notes: 'Coaching cadence' },
      { personName: 'Rosa Martinez', proximity: 1, response: 'seeking' },
      { personName: 'Local pastors coalition', proximity: 2, response: 'interested', plannedConversation: true },
      { personName: 'CSU campus ministry contact', proximity: 3, response: 'curious' },
    ])
    insertPrayers(u2, [
      { title: 'Fort Collins Network growth', schedule: 'daily', lastPrayed: daysAgo(2) },
      { title: 'Wellington Circle — Ana and new families', schedule: 'mon,wed,fri,sat' },
      { title: 'Bilingual worship team development', schedule: 'sun' },
      { title: 'Carlos in his community-partner role', schedule: 'daily' },
      { title: 'Healing for families fractured by deportation', schedule: 'daily' },
    ])
    insert411(u2, 5)      // 5/6
    insertCOC(u2, 8, 4)   // 8/10 obeying, 4/10 teaching
    insertPreferences(u2, 'en', 'Fort Collins Network', 'Fort Collins, CO')
  }

  // ─── cat-user-003: Rosa Martinez (Hispanic Outreach Coordinator) ──
  const u3 = 'cat-user-003'
  if (shouldSeed(u3)) {
    insertOikosContacts(u3, [
      { personName: 'Familia Herrera', proximity: 1, response: 'decided' },
      { personName: 'ESL students (Tue/Thu class)', proximity: 2, response: 'seeking', plannedConversation: true },
      { personName: 'Meat packing plant workers', proximity: 3, response: 'curious' },
      { personName: 'Neighbor Gloria', proximity: 1, response: 'interested', plannedConversation: true },
      { personName: 'Catholic parish contact', proximity: 3, response: 'interested' },
    ])
    insertPrayers(u3, [
      { title: 'Courage for ESL gospel conversations', schedule: 'tue,thu' },
      { title: 'Gloria and her children', schedule: 'daily', lastPrayed: daysAgo(2) },
      { title: 'Protection for undocumented families', schedule: 'daily' },
      { title: 'Wisdom for trauma-informed care', schedule: 'daily' },
      { title: 'Farm-worker outreach in Berthoud', schedule: 'mon,wed,fri' },
    ])
    insert411(u3, 4) // 4/6
    insertCOC(u3, 6, 2) // 6/10 obeying, 2/10 teaching
    insertPreferences(u3, 'es', 'Fort Collins Network', 'Fort Collins, CO')
  }

  // ─── cat-user-006: Ana Reyes (Circle Leader — Wellington) ─────────
  const u6 = 'cat-user-006'
  if (shouldSeed(u6)) {
    insertOikosContacts(u6, [
      { personName: 'Familia Morales', proximity: 1, response: 'seeking', plannedConversation: true, notes: 'Husband is open to coffee meeting' },
      { personName: 'Youth group teens (5)', proximity: 2, response: 'interested' },
      { personName: 'Wellington Elementary parents', proximity: 3, response: 'curious' },
      { personName: 'Señora Campos', proximity: 1, response: 'decided', plannedConversation: true },
      { personName: 'Familia Vega', proximity: 2, response: 'interested', plannedConversation: true },
    ])
    insertPrayers(u6, [
      { title: 'Wellington Circle health and growth', schedule: 'daily' },
      { title: 'Youth caught between two cultures', schedule: 'mon,wed,fri' },
      { title: 'Familia Morales — husband seeking work', schedule: 'daily', lastPrayed: daysAgo(2) },
      { title: 'Wisdom on next-step training for new disciples', schedule: 'daily' },
      { title: 'Señora Campos — discipleship next steps', schedule: 'tue,thu,sat' },
    ])
    insert411(u6, 3) // 3/6
    insertCOC(u6, 4) // 4/10 obeying
    insertPreferences(u6, 'es', 'Wellington Circle', 'Wellington, CO')
  }

  // ─── cat-user-007: Miguel Santos (Circle Leader — Laporte) ────────
  const u7 = 'cat-user-007'
  if (shouldSeed(u7)) {
    insertOikosContacts(u7, [
      { personName: 'Farm crew (8 men)', proximity: 1, response: 'interested' },
      { personName: 'Foreman Ricardo', proximity: 1, response: 'seeking', plannedConversation: true },
      { personName: 'Familia Santos extended', proximity: 2, response: 'decided' },
      { personName: 'Iglesia La Cosecha pastor', proximity: 3, response: 'interested', plannedConversation: true },
    ])
    insertPrayers(u7, [
      { title: 'Laporte farm workers — safety and hope', schedule: 'daily', lastPrayed: daysAgo(2) },
      { title: 'Ricardo — open door for gospel', schedule: 'mon,wed,fri' },
      { title: 'Housing for seasonal workers', schedule: 'tue,sat' },
      { title: 'Wisdom for Sunday gathering', schedule: 'sat,sun' },
      { title: 'Familia Santos — multi-generational unity', schedule: 'daily' },
    ])
    insert411(u7, 2) // 2/6
    insertCOC(u7, 3) // 3/10 obeying
    insertPreferences(u7, 'es', 'Laporte Circle', 'Laporte, CO')
  }

  // ─── cat-user-004: Carlos Herrera (Community Partner) ─────────────
  const u4 = 'cat-user-004'
  if (shouldSeed(u4)) {
    insertOikosContacts(u4, [
      { personName: 'Tienda La Favorita owners', proximity: 2, response: 'curious', plannedConversation: true },
      { personName: 'Wellington bus-stop families', proximity: 3, response: 'interested' },
      { personName: 'Vecina Lupe (next-door)', proximity: 1, response: 'seeking', plannedConversation: true },
      { personName: 'School-bus driver Marco', proximity: 2, response: 'interested' },
    ])
    insertPrayers(u4, [
      { title: 'Vecina Lupe — ongoing health concerns', schedule: 'daily', lastPrayed: daysAgo(3) },
      { title: 'Tienda relationship — open door', schedule: 'mon,thu' },
      { title: 'Community-partner role wisdom', schedule: 'daily' },
      { title: 'Discipleship under David', schedule: 'sun,wed' },
    ])
    insert411(u4, 1) // 1/6
    insertPreferences(u4, 'es', 'Fort Collins Network', 'Fort Collins, CO')
  }

  // ─── cat-user-005: Sarah Thompson (Regional Lead) ─────────────────
  const u5 = 'cat-user-005'
  if (shouldSeed(u5)) {
    insertOikosContacts(u5, [
      { personName: 'Front Range pastors network', proximity: 2, response: 'interested', plannedConversation: true },
      { personName: 'Loveland mayor liaison', proximity: 3, response: 'curious' },
      { personName: 'Regional church planters cohort', proximity: 2, response: 'decided' },
      { personName: 'Compassion International contact', proximity: 4, response: 'interested', plannedConversation: true },
    ])
    insertPrayers(u5, [
      { title: 'Loveland Circle launch', schedule: 'daily', lastPrayed: daysAgo(2) },
      { title: 'Cross-network unity (Catalyst + sister hubs)', schedule: 'daily' },
      { title: 'Pastors coalition — bilingual partnerships', schedule: 'mon,wed,fri' },
      { title: 'Wise stewardship of regional resources', schedule: 'tue,thu' },
    ])
    insert411(u5, 6)
    insertCOC(u5, 9, 5)
    insertPreferences(u5, 'en', 'Catalyst NoCo Network', 'Loveland, CO')
  }

  // ─── cat-user-008: Elena (Timnath Circle Leader) ──────────────────
  const u8 = 'cat-user-008'
  if (shouldSeed(u8)) {
    insertOikosContacts(u8, [
      { personName: 'Timnath young families', proximity: 2, response: 'curious' },
      { personName: 'Vecina Patricia', proximity: 1, response: 'seeking', plannedConversation: true },
      { personName: 'School-counselor referral', proximity: 3, response: 'interested', plannedConversation: true },
    ])
    insertPrayers(u8, [
      { title: 'Timnath gathering rhythm', schedule: 'daily' },
      { title: 'Patricia — next conversation', schedule: 'daily', lastPrayed: daysAgo(2) },
      { title: 'Trauma-care wisdom', schedule: 'mon,wed,fri' },
      { title: 'Counselor — open door', schedule: 'tue,thu' },
    ])
    insert411(u8, 4)
    insertPreferences(u8, 'es', 'Timnath Circle', 'Timnath, CO')
  }

  // ─── cat-user-009: Luis (Loveland Circle Leader) ──────────────────
  const u9 = 'cat-user-009'
  if (shouldSeed(u9)) {
    insertOikosContacts(u9, [
      { personName: 'Loveland new-arrival families', proximity: 2, response: 'interested' },
      { personName: 'Hermano Joaquín', proximity: 1, response: 'decided', plannedConversation: true },
      { personName: 'Grant-funded ESL students (12)', proximity: 3, response: 'curious' },
    ])
    insertPrayers(u9, [
      { title: 'Loveland circle multiplication', schedule: 'daily', lastPrayed: daysAgo(1) },
      { title: 'Joaquín — ready to lead', schedule: 'daily' },
      { title: 'ESL grant impact', schedule: 'tue,thu' },
      { title: 'Engagement-overlap with Berthoud — shalom', schedule: 'daily' },
    ])
    insert411(u9, 5)
    insertCOC(u9, 7, 3)
    insertPreferences(u9, 'es', 'Loveland Circle', 'Loveland, CO')
  }

  // ─── cat-user-010: Sofia (Berthoud Circle Leader) ─────────────────
  const u10 = 'cat-user-010'
  if (shouldSeed(u10)) {
    insertOikosContacts(u10, [
      { personName: 'Berthoud farm-worker families', proximity: 1, response: 'seeking' },
      { personName: 'Iglesia Pentecostal pastor', proximity: 3, response: 'interested', plannedConversation: true },
      { personName: 'Vecina Esperanza', proximity: 1, response: 'decided', plannedConversation: true },
    ])
    insertPrayers(u10, [
      { title: 'Berthoud — first baptisms', schedule: 'daily' },
      { title: 'Esperanza — multiplication', schedule: 'daily', lastPrayed: daysAgo(3) },
      { title: 'Engagement clarity with Loveland', schedule: 'daily' },
      { title: 'Farm-worker safety in harvest', schedule: 'mon,wed,fri' },
    ])
    insert411(u10, 3)
    insertPreferences(u10, 'es', 'Berthoud Circle', 'Berthoud, CO')
  }

  // ─── cat-user-011: Diego (Johnstown Circle Leader) ────────────────
  const u11 = 'cat-user-011'
  if (shouldSeed(u11)) {
    insertOikosContacts(u11, [
      { personName: 'Johnstown high-school athletes', proximity: 2, response: 'curious' },
      { personName: 'Coach Esteban', proximity: 1, response: 'seeking', plannedConversation: true },
      { personName: 'Familia Vargas', proximity: 1, response: 'decided' },
    ])
    insertPrayers(u11, [
      { title: 'Johnstown G3 sustainability', schedule: 'daily', lastPrayed: daysAgo(2) },
      { title: 'Coach Esteban — clear gospel call', schedule: 'mon,wed,fri' },
      { title: 'Athletes who follow Coach', schedule: 'daily' },
    ])
    insert411(u11, 4)
    insertCOC(u11, 5)
    insertPreferences(u11, 'es', 'Johnstown Circle', 'Johnstown, CO')
  }

  // ─── cat-user-012: Isabel (Red Feather Circle Leader) ─────────────
  const u12 = 'cat-user-012'
  if (shouldSeed(u12)) {
    insertOikosContacts(u12, [
      { personName: 'Mountain neighbors', proximity: 2, response: 'curious', plannedConversation: true },
      { personName: 'Hermana Julia', proximity: 1, response: 'decided' },
      { personName: 'Lake-area pastors', proximity: 3, response: 'interested' },
    ])
    insertPrayers(u12, [
      { title: 'Rural mountain ministry', schedule: 'daily', lastPrayed: daysAgo(4) },
      { title: 'Julia — discipleship rhythm', schedule: 'daily' },
      { title: 'Winter-weather travel safety', schedule: 'mon,wed,fri' },
    ])
    insert411(u12, 2)
    insertPreferences(u12, 'es', 'Red Feather Circle', 'Red Feather Lakes, CO')
  }

  // ─── Boost: extra prayer / oikos rows for existing catalyst users ───
  // The shouldSeed() gate above only inserts on the very first seed pass.
  // These upsert-by-title/name helpers add new rows on every run so users
  // who already had their initial seed get the additional work-items
  // without us nuking their state.
  const boostUsers: Array<{ id: string; oikos: OikosEntry[]; prayers: PrayerEntry[] }> = [
    {
      id: 'cat-user-001',
      oikos: [
        { personName: 'Front Range pastors coalition', proximity: 2, response: 'interested', plannedConversation: true },
        { personName: 'Sarah Thompson (regional)', proximity: 1, response: 'decided', plannedConversation: true },
      ],
      prayers: [
        { title: 'Front Range pastors network', schedule: 'daily' },
        { title: 'Children of detained parents', schedule: 'daily' },
      ],
    },
    {
      id: 'cat-user-002',
      oikos: [
        { personName: 'Pastors coalition co-host', proximity: 2, response: 'interested', plannedConversation: true },
      ],
      prayers: [
        { title: 'Carlos in his community-partner role', schedule: 'daily' },
        { title: 'Healing for families fractured by deportation', schedule: 'daily' },
      ],
    },
    {
      id: 'cat-user-003',
      oikos: [
        { personName: 'Berthoud farm-worker outreach', proximity: 3, response: 'curious', plannedConversation: true },
      ],
      prayers: [
        { title: 'Wisdom for trauma-informed care', schedule: 'daily' },
        { title: 'Farm-worker outreach in Berthoud', schedule: 'mon,wed,fri' },
      ],
    },
    {
      id: 'cat-user-006',
      oikos: [
        { personName: 'Familia Vega', proximity: 2, response: 'interested', plannedConversation: true },
      ],
      prayers: [
        { title: 'Wisdom on next-step training for new disciples', schedule: 'daily' },
        { title: 'Señora Campos — discipleship next steps', schedule: 'tue,thu,sat' },
      ],
    },
    {
      id: 'cat-user-007',
      oikos: [
        { personName: 'Iglesia La Cosecha pastor', proximity: 3, response: 'interested', plannedConversation: true },
      ],
      prayers: [
        { title: 'Wisdom for Sunday gathering', schedule: 'sat,sun' },
        { title: 'Familia Santos — multi-generational unity', schedule: 'daily' },
      ],
    },
  ]
  for (const b of boostUsers) {
    if (!userExists(b.id)) continue
    upsertOikosByName(b.id, b.oikos)
    upsertPrayersByTitle(b.id, b.prayers)
  }

  // Bump stale-bucket: any prayer whose lastPrayed is "today" or null but
  // schedule is daily reads as "due today" already. For prayers that show
  // lastPrayed=today (which the OLD seed planted), shift them to 2 days ago
  // so they surface as work items. Idempotent — only updates if the field
  // matches the OLD seed's "today()" stamp from a recent run.
  // We treat anything within the last 18 hours as "looks like today's stamp".
  const eighteenHoursAgo = new Date(Date.now() - 18 * 3600_000).toISOString()
  const fortyEightHoursAgo = new Date(Date.now() - 48 * 3600_000).toISOString()
  const allCatPrayers = db.select().from(schema.prayers).all()
  for (const p of allCatPrayers) {
    if (!p.userId.startsWith('cat-user-')) continue
    if (!p.lastPrayed) continue
    if (p.lastPrayed >= eighteenHoursAgo) {
      // Shift back so it's due today.
      db.update(schema.prayers)
        .set({ lastPrayed: fortyEightHoursAgo })
        .where(eq(schema.prayers.id, p.id))
        .run()
    }
  }

  // ─── Catalyst hub-lead inboxes (unread actionable messages) ──────
  // These surface as "message-pending" work items in MyWorkPanel.
  // Idempotent: keyed by (userId, type, title) so re-runs don't dupe.
  const existingHubMsg = db.select().from(schema.messages)
    .where(eq(schema.messages.type, 'review_received')).get()
  if (!existingHubMsg) {
    const inbox: Array<{ userId: string; type: 'review_received' | 'invite_sent' | 'relationship_proposed' | 'proposal_created' | 'dispute_filed'; title: string; body: string; link: string }> = [
      { userId: 'cat-user-002', type: 'review_received', title: 'Review received: Wellington Circle health', body: 'A peer left a review on Wellington Circle. Open the review to read or respond.', link: '/reviews' },
      { userId: 'cat-user-002', type: 'dispute_filed', title: 'Dispute flagged: Berthoud engagement overlap', body: 'Fort Collins Hub flagged Berthoud Circle\'s stewardOf claim as overlapping with Loveland.', link: '/reviews' },
      { userId: 'cat-user-002', type: 'invite_sent', title: 'Invite to Carlos pending', body: 'Carlos has not yet completed his community-partner onboarding.', link: '/people' },
      { userId: 'cat-user-001', type: 'review_received', title: 'Review received: NoCo Network annual', body: 'Sarah Thompson left a review on the network this quarter.', link: '/reviews' },
      { userId: 'cat-user-001', type: 'relationship_proposed', title: 'Coach proposal: from Sarah Thompson', body: 'Sarah proposed a regional coaching cadence with you. Confirm or decline.', link: '/relationships' },
      { userId: 'cat-user-005', type: 'invite_sent', title: 'Three invites awaiting response', body: 'Three regional pastors have not yet replied to your alliance invites.', link: '/people' },
    ]
    for (const m of inbox) {
      const dup = db.select().from(schema.messages)
        .where(and(eq(schema.messages.userId, m.userId), eq(schema.messages.type, m.type), eq(schema.messages.title, m.title))).get()
      if (dup) continue
      db.insert(schema.messages).values({
        id: randomUUID(),
        userId: m.userId,
        type: m.type,
        title: m.title,
        body: m.body,
        link: m.link,
        read: 0,
      }).run()
    }
  }

  // ─── Data sharing notification for Maria ─────────────────────────
  const existingMsg = db.select().from(schema.messages)
    .where(eq(schema.messages.type, 'data_access_granted')).get()
  if (!existingMsg) {
    db.insert(schema.messages).values({
      id: randomUUID(),
      userId: 'cat-user-001',
      type: 'data_access_granted',
      title: 'Ana Reyes shared personal data with you',
      body: 'Ana Reyes has shared her contact information (email, phone, location) with you. View it in your Data Sharing page.',
      link: '/catalyst/me/sharing',
    }).run()
  }

  // ─── Seed Ana's profile in person-mcp ────────────────────────────
  try {
    const Database = require('better-sqlite3')
    const mcpDbPath = process.env.PERSON_MCP_DB_PATH ?? '../person-mcp/person-mcp.db'
    const mcpDb = new Database(mcpDbPath)
    const anaUser = db.select().from(schema.users).where(eq(schema.users.id, 'cat-user-006')).get()
    if (anaUser?.personAgentAddress) {
      const principal = anaUser.personAgentAddress.toLowerCase()
      const existing = mcpDb.prepare('SELECT id FROM profiles WHERE principal = ?').get(principal)
      if (!existing) {
        const now = new Date().toISOString()
        mcpDb.prepare(`INSERT INTO profiles (id, principal, display_name, email, phone, city, state_province, country, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          randomUUID(), principal, 'Ana Reyes', 'ana@wellington-circle.org', '+1-970-555-0198',
          'Wellington', 'Colorado', 'US', now, now,
        )
        console.log('[multiply-seed] Seeded Ana\'s profile in person-mcp')
      }
    }
    mcpDb.close()
  } catch (err) {
    console.warn('[multiply-seed] MCP profile seed failed:', err)
  }

  // ─── Catalyst activity feed — mission-org-anchored use-cases ─────
  // Each catalyst user gets 10–18 activities drawn from real-world
  // mission organizations we've used elsewhere in the demo:
  // Lausanne, IMB, GACX, Joshua Project, Wycliffe, Progress.Bible,
  // NewThing, Movement Leaders Collective, GMCN, Indigitous,
  // 24-7 Prayer, Operation World, ECFA, NCF, Frontier Ventures,
  // Compassion, World Relief, Open Doors, Real Life Ministries,
  // BibleProject, Catalyst Leadership Network.
  //
  // Idempotent: keyed on (userId, title, activityDate prefix). Re-runs
  // are no-ops; new entries get added if we add new lines below.
  seedCatalystActivities()
}

interface ActivityEntry {
  type: 'meeting' | 'visit' | 'training' | 'outreach' | 'follow-up' | 'coaching' | 'prayer' | 'service' | 'assessment' | 'other'
  title: string
  description?: string
  participants?: number
  location?: string
  durationMinutes?: number
  /** Days ago (positive integer). */
  daysBack: number
}

function seedCatalystActivities() {
  // Find each catalyst user's primary org address (their person agent).
  // Activity feed filters by orgAddress OR userId, so even when person
  // agent is missing we still surface activities via the userId match.
  const userOrgs = new Map<string, string>()
  for (let i = 1; i <= 12; i++) {
    const id = `cat-user-${i.toString().padStart(3, '0')}`
    const u = db.select().from(schema.users).where(eq(schema.users.id, id)).get()
    if (!u) continue
    userOrgs.set(id, u.personAgentAddress ?? '0x0000000000000000000000000000000000000000')
  }

  // Per-persona activity catalog. Volume tuned by role density:
  // Hub Lead / Program Director get more activity (cross-circle work).
  const CATALOG: Record<string, ActivityEntry[]> = {
    // ── Maria Gonzalez — Program Director (Catalyst NoCo Network) ──
    'cat-user-001': [
      { type: 'meeting', title: 'Lausanne SOGC reading group — NoCo regional implications', description: 'Reviewed the State of the Great Commission section on Hispanic diaspora response rates with the regional staff.', participants: 6, location: 'Fort Collins, CO', durationMinutes: 75, daysBack: 2 },
      { type: 'meeting', title: 'GACX engagement-overlap working group', description: 'Walked through the Berthoud/Loveland stewardOf overlap; agreed on the alliance arbitration pattern.', participants: 8, location: 'Online', durationMinutes: 60, daysBack: 5 },
      { type: 'meeting', title: 'IMB Frontier Strategy intake — NoCo UPG list', description: 'IMB regional researcher walked us through five Frontier People Group tags relevant to Hispanic diaspora in NoCo.', participants: 4, location: 'Online', durationMinutes: 90, daysBack: 9 },
      { type: 'training', title: 'Movement Leaders Collective — readiness rubric calibration', description: 'Cross-org calibration call: how each network scores group-leader readiness on a 0–10000 rubric.', participants: 12, location: 'Online', durationMinutes: 120, daysBack: 14 },
      { type: 'coaching', title: 'Coaching Ana Reyes — Wellington multiplication path', description: 'Worked through Ana\'s next-G plan; G2 candidate identified in Familia Morales household.', participants: 1, location: 'Fort Collins, CO', durationMinutes: 45, daysBack: 3 },
      { type: 'coaching', title: 'Coaching Rosa Martinez — ESL outreach pipeline', description: 'Reviewed Rosa\'s ESL → discipleship handoff metric; tied it to the GACX engagement-claim schema.', participants: 1, location: 'Fort Collins, CO', durationMinutes: 45, daysBack: 7 },
      { type: 'meeting', title: 'NewThing multiplication review (quarterly)', description: 'Reviewed Wellington → Laporte → Johnstown chain; G3 health markers all green.', participants: 6, location: 'Online', durationMinutes: 60, daysBack: 18 },
      { type: 'meeting', title: 'ECFA compliance check-in', description: 'Annual review of donor-protection norms; flagged dual-funding risk on Red Feather Circle.', participants: 3, location: 'Online', durationMinutes: 45, daysBack: 22 },
      { type: 'training', title: 'Catalyst Leadership Network — coach-of-coaches credential', description: 'Day 2 of the certifiedIn coach-of-coaches track; reviewed the Movement Leaders Collective rubric.', participants: 18, location: 'Denver, CO', durationMinutes: 360, daysBack: 26 },
      { type: 'meeting', title: 'NCF restricted-grant review — Red Feather Circle', description: 'Donor-advised fund holder asked for an outcome-bound disbursement plan tied to baptisms.', participants: 4, location: 'Online', durationMinutes: 60, daysBack: 30 },
      { type: 'outreach', title: 'Frontier Ventures — Spanish-speaking Frontier strategy briefing', description: 'Joined the FV cohort call on diaspora-of-UPG strategy; tagged 3 NoCo zips.', participants: 22, location: 'Online', durationMinutes: 90, daysBack: 35 },
      { type: 'service', title: 'Compassion International quarterly child-sponsorship event', description: 'Hosted a sponsor-meet-child story night; 14 new sponsors signed up across the network.', participants: 60, location: 'Fort Collins, CO', durationMinutes: 150, daysBack: 40 },
      { type: 'assessment', title: 'Lausanne Issue Network — Disciple-Making Movements', description: 'Submitted NoCo case study to the DMM issue network; awaiting peer feedback.', participants: 1, location: 'Online', durationMinutes: 120, daysBack: 45 },
    ],

    // ── Pastor David Chen — Hub Lead (Fort Collins Hub) ──
    'cat-user-002': [
      { type: 'meeting', title: 'Wellington pastors\' coalition — bilingual liturgy', description: 'Hosted four neighborhood pastors to align Sunday-evening liturgy across circles.', participants: 5, location: 'Fort Collins, CO', durationMinutes: 90, daysBack: 1 },
      { type: 'training', title: 'IMB T4T (Training for Trainers) intensive — day 1', description: 'Three-day T4T intensive; Wellington and Laporte leaders attended.', participants: 14, location: 'Fort Collins, CO', durationMinutes: 360, daysBack: 4 },
      { type: 'training', title: 'IMB T4T intensive — day 2: 4 Fields markers', description: 'Walked through Entry → Gospel → Discipleship → Church multiplication health markers.', participants: 14, location: 'Fort Collins, CO', durationMinutes: 360, daysBack: 3 },
      { type: 'meeting', title: 'NewThing multiplication review — Wellington G3', description: 'Confirmed Johnstown as a G3 plant; tagged Wellington → Laporte → Johnstown chain.', participants: 4, location: 'Online', durationMinutes: 60, daysBack: 8 },
      { type: 'visit', title: 'Wellington Circle — Familia Morales home visit', description: 'Pastoral visit; husband received gospel, ready for next-step Bible study.', participants: 6, location: 'Wellington, CO', durationMinutes: 120, daysBack: 6 },
      { type: 'coaching', title: 'Coaching Ana — handling the G2 split conversation', description: 'Discussed how to plant Familia Morales as a G2 group without fragmenting Wellington.', participants: 1, location: 'Fort Collins, CO', durationMinutes: 60, daysBack: 11 },
      { type: 'coaching', title: 'Coaching Carlos — community-partner role expectations', description: 'Walked Carlos through the Real Life Ministries discipleship-relationship pattern.', participants: 1, location: 'Fort Collins, CO', durationMinutes: 45, daysBack: 13 },
      { type: 'meeting', title: 'GMCN — trauma-informed care peer cohort', description: 'Monthly cohort call with member-care practitioners; brought the Berthoud/Loveland farm-worker case.', participants: 9, location: 'Online', durationMinutes: 90, daysBack: 16 },
      { type: 'training', title: 'BibleProject curriculum tagging session', description: 'Tagged eight BibleProject videos against the formation-pathway milestones.', participants: 4, location: 'Fort Collins, CO', durationMinutes: 90, daysBack: 19 },
      { type: 'assessment', title: 'GACX engagement-overlap dispute — Berthoud/Loveland', description: 'Filed FLAG dispute against Berthoud Circle\'s stewardOf claim duplicating Loveland.', participants: 3, location: 'Online', durationMinutes: 30, daysBack: 5 },
      { type: 'meeting', title: 'Wycliffe regional contact — Spanish heart-language resources', description: 'Discussed scripture-engagement gaps for two indigenous-language families in Wellington.', participants: 3, location: 'Online', durationMinutes: 45, daysBack: 21 },
      { type: 'outreach', title: 'Indigitous handoff training', description: 'Trained Carlos on the seeker-handoff pattern from digital evangelism platforms.', participants: 2, location: 'Fort Collins, CO', durationMinutes: 60, daysBack: 24 },
      { type: 'meeting', title: 'Catalyst Leadership Network — annual gathering', description: 'Two-day regional gathering; David presented Wellington G3 case study.', participants: 80, location: 'Denver, CO', durationMinutes: 600, daysBack: 28 },
      { type: 'service', title: 'NoCo immigration legal-aid clinic', description: 'Hosted a free legal-aid clinic with World Relief; served 22 families.', participants: 30, location: 'Fort Collins, CO', durationMinutes: 240, daysBack: 33 },
    ],

    // ── Rosa Martinez — Outreach Coordinator ──
    'cat-user-003': [
      { type: 'outreach', title: 'ESL Tuesday class — Tienda La Favorita follow-up', description: 'After-class conversations led to two Bible-study invites for next week.', participants: 14, location: 'Fort Collins, CO', durationMinutes: 90, daysBack: 1 },
      { type: 'outreach', title: 'ESL Thursday class — meatpacking plant workers', description: 'New cohort; six workers signed up for the next 6-week ESL → discipleship pipeline.', participants: 12, location: 'Fort Collins, CO', durationMinutes: 90, daysBack: 3 },
      { type: 'visit', title: 'Vecina Gloria home visit', description: 'Brought groceries; prayed with her and her three kids.', participants: 5, location: 'Fort Collins, CO', durationMinutes: 60, daysBack: 2 },
      { type: 'training', title: 'Lausanne integral-mission workshop — Tearfund framework', description: 'Workshop on integrating gospel proclamation with social action without dichotomy.', participants: 18, location: 'Online', durationMinutes: 120, daysBack: 7 },
      { type: 'prayer', title: 'Operation World prayer hour — undocumented families', description: 'Hour-long intercession for the seven NoCo families directly affected this month.', participants: 11, location: 'Fort Collins, CO', durationMinutes: 60, daysBack: 4 },
      { type: 'follow-up', title: 'Familia Herrera — post-baptism check-in', description: 'Planning next-step formation pathway with Maria.', participants: 4, location: 'Fort Collins, CO', durationMinutes: 90, daysBack: 9 },
      { type: 'meeting', title: 'Indigitous training — social-media seeker handoff', description: 'Got the gist of the Indigitous referral protocol; ready to pilot in Spanish.', participants: 1, location: 'Online', durationMinutes: 60, daysBack: 12 },
      { type: 'coaching', title: 'Coached by Maria — outreach pipeline review', description: 'Reviewed Q1 ESL → discipleship conversion rate; agreed on three new tags.', participants: 1, location: 'Fort Collins, CO', durationMinutes: 45, daysBack: 7 },
      { type: 'service', title: 'World Relief immigration clinic — interpreter shift', description: 'Six hours interpreting for new-arrival families; two referrals into Wellington Circle.', participants: 30, location: 'Fort Collins, CO', durationMinutes: 360, daysBack: 33 },
      { type: 'training', title: 'GMCN — trauma-informed care basics', description: 'First module of the trauma-care track; relevant to current case load.', participants: 22, location: 'Online', durationMinutes: 90, daysBack: 16 },
    ],

    // ── Carlos Herrera — Community Partner ──
    'cat-user-004': [
      { type: 'visit', title: 'Vecina Lupe — medical run + prayer', description: 'Drove Lupe to the doctor; prayed before the appointment.', participants: 2, location: 'Fort Collins, CO', durationMinutes: 180, daysBack: 1 },
      { type: 'outreach', title: 'School-bus families canvass', description: 'Walked the route with Marco; six family conversations, two Bible interest cards.', participants: 12, location: 'Fort Collins, CO', durationMinutes: 90, daysBack: 4 },
      { type: 'training', title: 'Indigitous handoff training (Pastor David)', description: 'Learned the seeker-handoff protocol; pilot rolling out next month.', participants: 2, location: 'Fort Collins, CO', durationMinutes: 60, daysBack: 24 },
      { type: 'meeting', title: 'Tienda La Favorita owners — relationship coffee', description: 'Honest conversation about faith; door is open for a future Bible study at the tienda.', participants: 3, location: 'Fort Collins, CO', durationMinutes: 75, daysBack: 8 },
      { type: 'coaching', title: 'Coaching session with Pastor David', description: 'Walked through the discipleship-relationship pattern from Real Life Ministries.', participants: 1, location: 'Fort Collins, CO', durationMinutes: 45, daysBack: 13 },
      { type: 'prayer', title: 'Joshua Project Unreached of the Day — neighborhood prayer walk', description: 'Walked the school-bus route praying through that day\'s UPG card.', participants: 3, location: 'Fort Collins, CO', durationMinutes: 60, daysBack: 6 },
      { type: 'follow-up', title: 'School-counselor follow-up — Vecina Lupe\'s kids', description: 'Met with school counselor about the kids; agreed on weekly check-ins.', participants: 3, location: 'Fort Collins, CO', durationMinutes: 60, daysBack: 11 },
      { type: 'service', title: 'World Relief food-distribution shift', description: 'Three-hour shift at the food bank; built relationships with two new families.', participants: 25, location: 'Fort Collins, CO', durationMinutes: 180, daysBack: 19 },
    ],

    // ── Sarah Thompson — Regional Lead ──
    'cat-user-005': [
      { type: 'meeting', title: 'Front Range pastors\' alliance — quarterly', description: 'Bi-monthly cross-network sync; brought the GACX overlap-resolution playbook.', participants: 16, location: 'Loveland, CO', durationMinutes: 120, daysBack: 2 },
      { type: 'meeting', title: 'Lausanne 25 issue network — Mission Mobilization', description: 'Submitted NoCo regional case to the issue network; co-chair role accepted.', participants: 28, location: 'Online', durationMinutes: 120, daysBack: 8 },
      { type: 'meeting', title: 'Loveland Circle launch consult with Luis', description: 'Reviewed launch metrics; G1 health markers green; first multiplication candidate identified.', participants: 2, location: 'Loveland, CO', durationMinutes: 90, daysBack: 5 },
      { type: 'assessment', title: 'NoCo Growth Analytics — quarterly health roll-up', description: 'Reviewed the weekly assertion chain; flagged Berthoud as needing a coach.', participants: 4, location: 'Online', durationMinutes: 60, daysBack: 11 },
      { type: 'meeting', title: 'Frontier Ventures — diaspora-of-UPG cohort', description: 'Monthly FV cohort; presented NoCo Vietnamese-diaspora pilot.', participants: 22, location: 'Online', durationMinutes: 90, daysBack: 14 },
      { type: 'coaching', title: 'Coaching new circle leader — Loveland', description: 'Mentor session with Luis on next-G readiness rubric.', participants: 1, location: 'Loveland, CO', durationMinutes: 60, daysBack: 17 },
      { type: 'meeting', title: 'Compassion International — regional partnership', description: 'Discussed integrating Compassion sponsorship into NoCo families pipeline.', participants: 5, location: 'Online', durationMinutes: 60, daysBack: 22 },
      { type: 'training', title: 'Movement Leaders Collective — peer-coaching cohort', description: 'Quarterly peer-coaching cohort with regional leads from four states.', participants: 12, location: 'Online', durationMinutes: 180, daysBack: 27 },
      { type: 'meeting', title: 'NCF donor-impact dashboard review', description: 'Walked NCF donor through Q1 outcomes; agreed on Q2 funding line for Berthoud Circle.', participants: 3, location: 'Online', durationMinutes: 75, daysBack: 31 },
    ],

    // ── Ana Reyes — Wellington Circle Leader ──
    'cat-user-006': [
      { type: 'meeting', title: 'Wellington Circle gathering — Sunday evening', description: '12 attendees; baptism scheduled for next week.', participants: 12, location: 'Wellington, CO', durationMinutes: 120, daysBack: 0 },
      { type: 'meeting', title: 'Wellington Circle gathering — last week', description: '11 attendees; first Familia Morales formal attendance.', participants: 11, location: 'Wellington, CO', durationMinutes: 120, daysBack: 7 },
      { type: 'visit', title: 'Familia Morales home visit', description: 'Family meal; husband shared his testimony; Familia Morales is the next-G candidate.', participants: 6, location: 'Wellington, CO', durationMinutes: 150, daysBack: 2 },
      { type: 'visit', title: 'Señora Campos — discipleship session 4', description: 'Walked through the IMB 4 Fields markers; she identified two seekers in her own oikos.', participants: 2, location: 'Wellington, CO', durationMinutes: 90, daysBack: 4 },
      { type: 'training', title: 'IMB T4T intensive — day 1 (with David)', description: 'Two-day T4T intensive; foundation for next-G multiplication.', participants: 14, location: 'Fort Collins, CO', durationMinutes: 360, daysBack: 4 },
      { type: 'training', title: 'IMB T4T intensive — day 2', description: '4 Fields markers and the obedience-based discipleship loop.', participants: 14, location: 'Fort Collins, CO', durationMinutes: 360, daysBack: 3 },
      { type: 'coaching', title: 'Coached by Maria — multiplication path conversation', description: 'Worked through the G2 split conversation with Familia Morales.', participants: 1, location: 'Fort Collins, CO', durationMinutes: 45, daysBack: 3 },
      { type: 'coaching', title: 'Coached by Pastor David — handling tension in the circle', description: 'Two members had a conflict; David walked Ana through the Real Life Ministries pattern.', participants: 1, location: 'Wellington, CO', durationMinutes: 60, daysBack: 11 },
      { type: 'outreach', title: 'Wellington Elementary parents night', description: '8 new families met; 3 said yes to a follow-up coffee.', participants: 30, location: 'Wellington, CO', durationMinutes: 120, daysBack: 10 },
      { type: 'prayer', title: '24-7 Prayer hour — Wellington families', description: 'One-hour adoption-prayer slot for adopted-zip Wellington commitments.', participants: 4, location: 'Wellington, CO', durationMinutes: 60, daysBack: 5 },
      { type: 'follow-up', title: 'Youth-group teens — post-retreat check-ins', description: 'Reached out to all 5 teens after the retreat; all five stayed engaged.', participants: 5, location: 'Wellington, CO', durationMinutes: 90, daysBack: 16 },
      { type: 'service', title: 'Familia Vega move-in help', description: 'Helped Familia Vega move into their new apartment; built first relationships.', participants: 8, location: 'Wellington, CO', durationMinutes: 240, daysBack: 25 },
    ],

    // ── Miguel Santos — Laporte Circle Leader ──
    'cat-user-007': [
      { type: 'meeting', title: 'Laporte Circle gathering — Sunday', description: '8 farm workers + Ricardo; first communion practice.', participants: 9, location: 'Laporte, CO', durationMinutes: 90, daysBack: 0 },
      { type: 'meeting', title: 'Laporte Circle gathering — last week', description: '8 attendees; Ricardo opened in prayer for the first time.', participants: 8, location: 'Laporte, CO', durationMinutes: 90, daysBack: 7 },
      { type: 'visit', title: 'Foreman Ricardo — coffee meeting', description: 'Long honest conversation about life and faith; Ricardo asked about baptism.', participants: 2, location: 'Laporte, CO', durationMinutes: 90, daysBack: 3 },
      { type: 'training', title: 'IMB T4T intensive — both days (with David & Ana)', description: 'Two-day T4T intensive; foundation for the harvest-season multiplication push.', participants: 14, location: 'Fort Collins, CO', durationMinutes: 720, daysBack: 4 },
      { type: 'outreach', title: 'Farm crew lunch outreach — north fields', description: 'Brought lunch to the crew; six gospel conversations, two interest cards.', participants: 8, location: 'Laporte, CO', durationMinutes: 90, daysBack: 5 },
      { type: 'outreach', title: 'Farm crew lunch outreach — south fields', description: 'Same pattern at the south fields; one returning seeker.', participants: 8, location: 'Laporte, CO', durationMinutes: 90, daysBack: 12 },
      { type: 'coaching', title: 'Coached by Rosa — handling cultural tensions', description: 'How to navigate the gap between the foreman crew and the seasonal hires.', participants: 1, location: 'Laporte, CO', durationMinutes: 45, daysBack: 9 },
      { type: 'service', title: 'World Relief — seasonal-worker housing intake', description: 'Helped 4 new arrivals fill out housing-aid forms.', participants: 7, location: 'Laporte, CO', durationMinutes: 180, daysBack: 18 },
      { type: 'prayer', title: 'Laporte harvest-season prayer night', description: 'Hour of prayer for harvest safety, hope, and gospel openness.', participants: 11, location: 'Laporte, CO', durationMinutes: 60, daysBack: 14 },
      { type: 'follow-up', title: 'Familia Santos extended — three-generation gathering', description: 'Hosted three generations of Familia Santos for dinner; first multi-gen baptism scheduled.', participants: 14, location: 'Laporte, CO', durationMinutes: 180, daysBack: 21 },
    ],

    // ── Elena — Timnath Circle Leader ──
    'cat-user-008': [
      { type: 'meeting', title: 'Timnath Circle gathering', description: '6 attendees; first time hosting communion.', participants: 6, location: 'Timnath, CO', durationMinutes: 90, daysBack: 0 },
      { type: 'visit', title: 'Vecina Patricia — counseling session', description: 'Listened to grief from her separation; prayed and shared scripture.', participants: 2, location: 'Timnath, CO', durationMinutes: 75, daysBack: 3 },
      { type: 'training', title: 'GMCN trauma-informed care course — module 3', description: 'Critical for current case load; module 3 covers grief.', participants: 22, location: 'Online', durationMinutes: 90, daysBack: 8 },
      { type: 'training', title: 'GMCN trauma-informed care course — module 2', description: 'Covered narrative-listening basics.', participants: 22, location: 'Online', durationMinutes: 90, daysBack: 15 },
      { type: 'meeting', title: 'School-counselor referral conversation', description: 'Connected with the elementary-school counselor about three at-risk families.', participants: 2, location: 'Timnath, CO', durationMinutes: 60, daysBack: 5 },
      { type: 'follow-up', title: 'Timnath young families — coffee follow-up', description: 'Three families joined the next gathering after this conversation.', participants: 8, location: 'Timnath, CO', durationMinutes: 120, daysBack: 11 },
      { type: 'coaching', title: 'Coached by Maria — trauma intersect with discipleship', description: 'How to walk a seeker through formation when trauma is unhealed.', participants: 1, location: 'Online', durationMinutes: 45, daysBack: 13 },
      { type: 'prayer', title: 'Operation World prayer — adopted region', description: 'Bi-weekly prayer for the adopted-region Joshua-Project diaspora tag.', participants: 5, location: 'Timnath, CO', durationMinutes: 60, daysBack: 17 },
    ],

    // ── Luis — Loveland Circle Leader ──
    'cat-user-009': [
      { type: 'meeting', title: 'Loveland Circle gathering — Sunday', description: '7 attendees; Hermano Joaquín led worship for the first time.', participants: 7, location: 'Loveland, CO', durationMinutes: 90, daysBack: 0 },
      { type: 'visit', title: 'Hermano Joaquín — leadership prep', description: 'Walked Joaquín through the Movement Leaders Collective readiness rubric.', participants: 2, location: 'Loveland, CO', durationMinutes: 75, daysBack: 4 },
      { type: 'meeting', title: 'GACX overlap-resolution call — Berthoud/Loveland', description: 'Worked through the engagement-overlap dispute with Sofia and the alliance.', participants: 4, location: 'Online', durationMinutes: 60, daysBack: 6 },
      { type: 'outreach', title: 'ESL Loveland — class 5 of 6', description: 'Twelve students; three have asked about scripture in heart language.', participants: 14, location: 'Loveland, CO', durationMinutes: 90, daysBack: 2 },
      { type: 'coaching', title: 'Coached by Sarah — multiplication readiness', description: 'Reviewed the next-G plan; Joaquín is the candidate.', participants: 1, location: 'Loveland, CO', durationMinutes: 60, daysBack: 17 },
      { type: 'service', title: 'Loveland new-arrival families food drop', description: 'Delivered groceries to four families; ESL class invitations went out.', participants: 8, location: 'Loveland, CO', durationMinutes: 180, daysBack: 12 },
      { type: 'meeting', title: 'Wycliffe consult — heart-language scripture access', description: 'Three families need access to scripture in indigenous-Mexican heart languages.', participants: 3, location: 'Online', durationMinutes: 45, daysBack: 19 },
      { type: 'prayer', title: '24-7 Prayer Loveland adoption hour', description: 'Adopted-zip prayer; Loveland prayer count up to 51 intercessors.', participants: 4, location: 'Loveland, CO', durationMinutes: 60, daysBack: 8 },
    ],

    // ── Sofia — Berthoud Circle Leader ──
    'cat-user-010': [
      { type: 'meeting', title: 'Berthoud Circle gathering — Sunday', description: '5 attendees; first communion celebration with Vecina Esperanza.', participants: 5, location: 'Berthoud, CO', durationMinutes: 90, daysBack: 0 },
      { type: 'meeting', title: 'GACX engagement-overlap mediation — with Luis', description: 'Worked through the stewardOf overlap with Loveland; agreed on a comp plan.', participants: 4, location: 'Online', durationMinutes: 60, daysBack: 6 },
      { type: 'outreach', title: 'Berthoud farm-worker families canvass', description: 'Visited four farm-worker households; one new gathering attendee.', participants: 8, location: 'Berthoud, CO', durationMinutes: 120, daysBack: 5 },
      { type: 'visit', title: 'Vecina Esperanza — discipleship session 6', description: 'Walked through the obedience-based discipleship loop; she\'s ready to disciple her sister.', participants: 2, location: 'Berthoud, CO', durationMinutes: 75, daysBack: 9 },
      { type: 'training', title: 'IMB 4 Fields refresher (online)', description: 'Refreshed the 4 Fields markers ahead of the next gathering plan.', participants: 18, location: 'Online', durationMinutes: 90, daysBack: 14 },
      { type: 'coaching', title: 'Coached by David — engagement-claim semantics', description: 'Walked through what stewardOf vs operatesIn means; updated her claim.', participants: 1, location: 'Online', durationMinutes: 45, daysBack: 16 },
      { type: 'service', title: 'Iglesia Pentecostal partnership lunch', description: 'Hosted the Pentecostal pastor; agreed on a joint Easter outreach.', participants: 6, location: 'Berthoud, CO', durationMinutes: 120, daysBack: 22 },
    ],

    // ── Diego — Johnstown Circle Leader (G3) ──
    'cat-user-011': [
      { type: 'meeting', title: 'Johnstown Circle gathering — G3 milestone', description: '6 attendees; first official G3 multiplication event with Coach Esteban.', participants: 6, location: 'Johnstown, CO', durationMinutes: 90, daysBack: 0 },
      { type: 'visit', title: 'Coach Esteban — gospel conversation', description: 'Long conversation; Esteban asked deep questions about discipleship.', participants: 2, location: 'Johnstown, CO', durationMinutes: 90, daysBack: 4 },
      { type: 'meeting', title: 'NewThing G3 case-study panel', description: 'Joined a NewThing panel as a G3 leader; shared Wellington → Laporte → Johnstown chain.', participants: 22, location: 'Online', durationMinutes: 75, daysBack: 11 },
      { type: 'outreach', title: 'Johnstown high-school athletes outreach', description: 'After-school session with 12 athletes; two said yes to next gathering.', participants: 13, location: 'Johnstown, CO', durationMinutes: 60, daysBack: 6 },
      { type: 'coaching', title: 'Coached by Miguel — G3 sustainability', description: 'How to keep G3 healthy without burnout.', participants: 1, location: 'Online', durationMinutes: 45, daysBack: 13 },
      { type: 'prayer', title: 'Prayer night — Coach Esteban', description: 'Prayer focused on Coach Esteban\'s gospel decision.', participants: 5, location: 'Johnstown, CO', durationMinutes: 60, daysBack: 9 },
    ],

    // ── Isabel — Red Feather Circle Leader (rural) ──
    'cat-user-012': [
      { type: 'meeting', title: 'Red Feather gathering — small but faithful', description: '4 attendees; rural mountain community.', participants: 4, location: 'Red Feather Lakes, CO', durationMinutes: 75, daysBack: 0 },
      { type: 'visit', title: 'Hermana Julia — discipleship session', description: 'Walked through the IMB obedience-based loop; she\'s mentoring two of her own.', participants: 2, location: 'Red Feather Lakes, CO', durationMinutes: 90, daysBack: 6 },
      { type: 'training', title: 'Operation World prayer cohort — rural focus', description: 'Joined a small rural-mission prayer cohort; six rural pastors.', participants: 7, location: 'Online', durationMinutes: 75, daysBack: 12 },
      { type: 'meeting', title: 'Lake-area pastors lunch', description: 'Quarterly lunch with three other lake-area pastors; talked alliance.', participants: 4, location: 'Red Feather Lakes, CO', durationMinutes: 120, daysBack: 18 },
      { type: 'service', title: 'Mountain neighbor snow-clearing service', description: 'Helped four neighbors clear driveways after the storm; gospel conversations.', participants: 6, location: 'Red Feather Lakes, CO', durationMinutes: 240, daysBack: 25 },
      { type: 'coaching', title: 'Coached by Rosa — rural ministry rhythms', description: 'How to keep rhythm in a small remote community.', participants: 1, location: 'Online', durationMinutes: 45, daysBack: 22 },
    ],
  }

  let inserted = 0
  let skipped = 0
  for (const [userId, entries] of Object.entries(CATALOG)) {
    const orgAddr = userOrgs.get(userId)
    if (!orgAddr) continue
    for (const e of entries) {
      const activityDate = daysAgo(e.daysBack)
      // Idempotent: keyed on (userId, title, activityDate prefix). Re-runs
      // against the same dataset are no-ops; new entries land naturally.
      const dup = db.select().from(schema.activityLogs)
        .where(and(eq(schema.activityLogs.userId, userId), eq(schema.activityLogs.title, e.title)))
        .get()
      if (dup) { skipped++; continue }
      db.insert(schema.activityLogs).values({
        id: randomUUID(),
        orgAddress: orgAddr,
        userId,
        activityType: e.type,
        title: e.title,
        description: e.description ?? null,
        participants: e.participants ?? 0,
        location: e.location ?? null,
        durationMinutes: e.durationMinutes ?? null,
        activityDate,
      }).run()
      inserted++
    }
  }
  if (inserted > 0 || skipped > 0) {
    console.log(`[multiply-seed] catalyst activities: inserted ${inserted}, skipped ${skipped} (already present)`)
  }
}

function seedCIL() {
  // ─── cil-user-001: Cameron Henrion (Coach) ────────────────────────
  const u1 = 'cil-user-001'
  if (shouldSeed(u1)) {
    insertOikosContacts(u1, [
      { personName: 'Afia', proximity: 1, response: 'decided' },
      { personName: 'Kossi', proximity: 1, response: 'seeking' },
      { personName: 'Local government', proximity: 3, response: 'interested' },
      { personName: 'Togo NGO network', proximity: 4, response: 'curious' },
    ])
    insertPrayers(u1, [
      { title: 'Business success for cohort', schedule: 'daily', lastPrayed: today() },
      { title: "Afia's market growth", schedule: 'mon,wed,fri' },
      { title: 'Togo stability', schedule: 'sun' },
    ])
    insert411(u1, 6)  // all complete
    insertCOC(u1, 6)  // 6/10 obeying
    insertCoachRelationship('cil-user-003', u1)
    insertCoachRelationship('cil-user-004', u1)
    insertPreferences(u1, 'en', 'ILAD', 'Lom\u00e9, Togo')
  }

  // ─── cil-user-003: Afia Mensah (Disciple) ────────────────────────
  const u3 = 'cil-user-003'
  if (shouldSeed(u3)) {
    insertOikosContacts(u3, [
      { personName: 'Market neighbors', proximity: 1, response: 'interested' },
      { personName: 'Supplier Kokou', proximity: 2, response: 'curious' },
      { personName: 'Church friends', proximity: 2, response: 'decided' },
    ])
    insertPrayers(u3, [
      { title: 'Business growth', schedule: 'daily', lastPrayed: daysAgo(1) },
      { title: "Children's education", schedule: 'daily' },
      { title: 'Market peace', schedule: 'fri', answered: true },
    ])
    insert411(u3, 2) // 2/6
    insertCOC(u3, 3) // 3/10 obeying
    insertPreferences(u3, 'en', "Afia's Market", 'Lom\u00e9, Togo')
  }

  // ─── cil-user-004: Kossi Agbeko (Disciple) ───────────────────────
  const u4 = 'cil-user-004'
  if (shouldSeed(u4)) {
    insertOikosContacts(u4, [
      { personName: 'Customers', proximity: 2, response: 'curious' },
      { personName: 'Apprentice Yao', proximity: 1, response: 'seeking' },
      { personName: 'Family', proximity: 1, response: 'decided' },
    ])
    insertPrayers(u4, [
      { title: 'Repair skills', schedule: 'daily' },
      { title: 'Apprentice growth', schedule: 'mon,wed,fri' },
    ])
    insert411(u4, 1) // 1/6
    insertCOC(u4, 2) // 2/10 obeying
    insertPreferences(u4, 'en', 'Kossi Mobile Repairs', 'Lom\u00e9, Togo')
  }

  // ─── Mission Collective data (revenue, BDC training, proposals) ────
  seedMCData()
}

// ─── MC (Mission Collective) seed data ────────────────────────────────

const BDC_MODULES = [
  { key: 'bdc-1', name: 'Business Basics', hours: 2, sortOrder: 1 },
  { key: 'bdc-2', name: 'Financial Record Keeping', hours: 3, sortOrder: 2 },
  { key: 'bdc-3', name: 'Market Analysis', hours: 2, sortOrder: 3 },
  { key: 'bdc-4', name: 'Pricing Strategy', hours: 2, sortOrder: 4 },
  { key: 'bdc-5', name: 'Customer Relations', hours: 2, sortOrder: 5 },
  { key: 'bdc-6', name: 'Growth Planning', hours: 3, sortOrder: 6 },
]

function hasMCData(): boolean {
  try {
    const row = db.select().from(schema.revenueReports)
      .where(eq(schema.revenueReports.orgAddress, '0x00000000000000000000000000000000000c0003'))
      .get()
    return !!row
  } catch { return false }
}

function seedMCData() {
  if (hasMCData()) return

  // ─── Revenue reports ───────────────────────────────────────────────
  const afiaAddr = '0x00000000000000000000000000000000000c0003'
  const kossiAddr = '0x00000000000000000000000000000000000c0004'

  const revenueRows: Array<{
    orgAddress: string; submittedBy: string; period: string
    grossRevenue: number; expenses: number; netRevenue: number
    sharePayment: number; status: 'draft' | 'submitted' | 'verified' | 'disputed'
    verifiedBy?: string; verifiedAt?: string
  }> = [
    { orgAddress: afiaAddr, submittedBy: 'cil-user-003', period: '2026-01', grossRevenue: 450000, expenses: 280000, netRevenue: 170000, sharePayment: 25500, status: 'verified', verifiedBy: 'cil-user-001', verifiedAt: daysAgo(60) },
    { orgAddress: afiaAddr, submittedBy: 'cil-user-003', period: '2026-02', grossRevenue: 520000, expenses: 310000, netRevenue: 210000, sharePayment: 31500, status: 'verified', verifiedBy: 'cil-user-001', verifiedAt: daysAgo(30) },
    { orgAddress: afiaAddr, submittedBy: 'cil-user-003', period: '2026-03', grossRevenue: 480000, expenses: 295000, netRevenue: 185000, sharePayment: 27750, status: 'submitted' },
    { orgAddress: kossiAddr, submittedBy: 'cil-user-004', period: '2026-01', grossRevenue: 180000, expenses: 95000, netRevenue: 85000, sharePayment: 12750, status: 'verified', verifiedBy: 'cil-user-001', verifiedAt: daysAgo(60) },
    { orgAddress: kossiAddr, submittedBy: 'cil-user-004', period: '2026-02', grossRevenue: 210000, expenses: 110000, netRevenue: 100000, sharePayment: 15000, status: 'verified', verifiedBy: 'cil-user-001', verifiedAt: daysAgo(30) },
    { orgAddress: kossiAddr, submittedBy: 'cil-user-004', period: '2026-03', grossRevenue: 150000, expenses: 120000, netRevenue: 30000, sharePayment: 4500, status: 'draft' },
  ]

  for (const r of revenueRows) {
    db.insert(schema.revenueReports).values({
      id: randomUUID(),
      orgAddress: r.orgAddress,
      submittedBy: r.submittedBy,
      period: r.period,
      grossRevenue: r.grossRevenue,
      expenses: r.expenses,
      netRevenue: r.netRevenue,
      sharePayment: r.sharePayment,
      currency: 'XOF',
      notes: null,
      verifiedBy: r.verifiedBy ?? null,
      verifiedAt: r.verifiedAt ?? null,
      status: r.status,
    }).run()
  }

  // ─── BDC Training modules ─────────────────────────────────────────
  for (const m of BDC_MODULES) {
    try {
      db.insert(schema.trainingModules).values({
        id: randomUUID(),
        name: m.name,
        description: null,
        program: 'bdc',
        hours: m.hours,
        sortOrder: m.sortOrder,
      }).run()
    } catch { /* already exists */ }
  }

  // ─── BDC Training progress ────────────────────────────────────────
  // Afia: bdc-1 thru bdc-4 completed, bdc-5 and bdc-6 not started
  for (let i = 0; i < BDC_MODULES.length; i++) {
    const done = i < 4
    db.insert(schema.trainingProgress).values({
      id: randomUUID(),
      userId: 'cil-user-003',
      moduleKey: BDC_MODULES[i].key,
      program: 'bdc',
      track: null,
      completed: done ? 1 : 0,
      completedAt: done ? daysAgo(60 - i * 7) : null,
    }).run()
  }

  // Kossi: bdc-1 and bdc-2 completed, rest not started
  for (let i = 0; i < BDC_MODULES.length; i++) {
    const done = i < 2
    db.insert(schema.trainingProgress).values({
      id: randomUUID(),
      userId: 'cil-user-004',
      moduleKey: BDC_MODULES[i].key,
      program: 'bdc',
      track: null,
      completed: done ? 1 : 0,
      completedAt: done ? daysAgo(45 - i * 7) : null,
    }).run()
  }

  // ─── Governance proposals ─────────────────────────────────────────
  const cilOrgAddr = '0x00000000000000000000000000000000000c0006'

  db.insert(schema.proposals).values({
    id: randomUUID(),
    orgAddress: cilOrgAddr,
    proposer: 'cil-user-001',
    title: 'Graduate Wave 1 to Phase 2',
    description: 'Promote Wave 1 businesses that have completed BDC training and submitted 3 monthly revenue reports to Phase 2 capital access.',
    actionType: 'graduate-wave',
    targetAddress: null,
    quorumRequired: 2,
    votesFor: 1,
    votesAgainst: 0,
    status: 'open',
    executedAt: null,
  }).run()

  db.insert(schema.proposals).values({
    id: randomUUID(),
    orgAddress: cilOrgAddr,
    proposer: 'cil-user-001',
    title: "Approve Afia's Market capital increase",
    description: "Increase capital allocation for Afia's Market based on consistent revenue growth and verified monthly reports.",
    actionType: 'general',
    targetAddress: afiaAddr,
    quorumRequired: 2,
    votesFor: 2,
    votesAgainst: 0,
    status: 'passed',
    executedAt: daysAgo(14),
  }).run()

  console.log('[mc-seed] Mission Collective data seeded')
}

// ═══════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════

/**
 * Seed personal Multiply-style data (circles, prayers, training, coach
 * relationships, preferences) for all three demo environments.
 * Idempotent — checks if circles already exist for each user before inserting.
 */
export function seedMultiplyData() {
  console.log('[multiply-seed] Seeding personal Multiply data...')
  const runSafe = (label: string, fn: () => void) => {
    try { fn() } catch (err) {
      console.warn(`[multiply-seed] ${label} failed:`, err)
    }
  }
  runSafe('Global.Church', seedGlobalChurch)
  runSafe('Catalyst',      seedCatalystNetwork)
  runSafe('CIL',           seedCIL)
  console.log('[multiply-seed] Multiply data seeding done')
}
