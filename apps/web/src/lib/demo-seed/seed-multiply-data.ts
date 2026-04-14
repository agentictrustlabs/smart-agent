import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
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

function hasCircles(userId: string): boolean {
  const row = db.select().from(schema.circles).where(eq(schema.circles.userId, userId)).get()
  return !!row
}

// ─── Circle helper ────────────────────────────────────────────────────

interface CircleEntry {
  personName: string
  proximity: number
  response: 'not-interested' | 'curious' | 'interested' | 'seeking' | 'decided' | 'baptized'
  plannedConversation?: boolean
  notes?: string
}

function insertCircles(userId: string, entries: CircleEntry[]) {
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
  if (!hasCircles(u1)) {
    insertCircles(u1, [
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
  if (!hasCircles(u2)) {
    insertCircles(u2, [
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
  if (!hasCircles(u1)) {
    insertCircles(u1, [
      { personName: 'Pastor David', proximity: 1, response: 'decided' },
      { personName: 'Rosa Martinez', proximity: 1, response: 'decided' },
      { personName: 'Familia Lopez (Wellington)', proximity: 2, response: 'seeking' },
      { personName: 'County social services contact', proximity: 3, response: 'interested' },
      { personName: 'Tienda La Favorita owners', proximity: 3, response: 'curious' },
      { personName: 'Poudre School District liaison', proximity: 4, response: 'interested' },
    ])
    insertPrayers(u1, [
      { title: 'NoCo network growth and unity', schedule: 'daily', lastPrayed: today() },
      { title: "Pastor David's bridge-building vision", schedule: 'mon,wed,fri' },
      { title: 'Hispanic families facing housing insecurity', schedule: 'daily' },
      { title: 'Wisdom for immigration support ministry', schedule: 'tue,thu' },
    ])
    insert411(u1, 6)  // all complete
    insertCOC(u1, 10) // all complete
    insertCoachRelationship('cat-user-002', u1)
    insertCoachRelationship('cat-user-003', u1)
    insertPreferences(u1, 'es', 'Catalyst NoCo Network', 'Fort Collins, CO')
  }

  // ─── cat-user-002: Pastor David Chen (Hub Lead — Disciple) ────────
  const u2 = 'cat-user-002'
  if (!hasCircles(u2)) {
    insertCircles(u2, [
      { personName: 'Ana Reyes (Wellington)', proximity: 1, response: 'decided' },
      { personName: 'Miguel Santos (Laporte)', proximity: 1, response: 'decided' },
      { personName: 'Rosa Martinez', proximity: 1, response: 'seeking' },
      { personName: 'Local pastors coalition', proximity: 2, response: 'interested' },
      { personName: 'CSU campus ministry contact', proximity: 3, response: 'curious' },
    ])
    insertPrayers(u2, [
      { title: 'Fort Collins Hub growth', schedule: 'daily', lastPrayed: daysAgo(1) },
      { title: 'Wellington Circle — Ana and new families', schedule: 'mon,wed,fri,sat' },
      { title: 'Bilingual worship team development', schedule: 'sun' },
    ])
    insert411(u2, 5)      // 5/6
    insertCOC(u2, 8, 4)   // 8/10 obeying, 4/10 teaching
    insertPreferences(u2, 'en', 'Fort Collins Hub', 'Fort Collins, CO')
  }

  // ─── cat-user-003: Rosa Martinez (Hispanic Outreach Coordinator) ──
  const u3 = 'cat-user-003'
  if (!hasCircles(u3)) {
    insertCircles(u3, [
      { personName: 'Familia Herrera', proximity: 1, response: 'decided' },
      { personName: 'ESL students (Tue/Thu class)', proximity: 2, response: 'seeking', plannedConversation: true },
      { personName: 'Meat packing plant workers', proximity: 3, response: 'curious' },
      { personName: 'Neighbor Gloria', proximity: 1, response: 'interested', plannedConversation: true },
      { personName: 'Catholic parish contact', proximity: 3, response: 'interested' },
    ])
    insertPrayers(u3, [
      { title: 'Courage for ESL gospel conversations', schedule: 'tue,thu' },
      { title: 'Gloria and her children', schedule: 'daily', lastPrayed: daysAgo(1) },
      { title: 'Protection for undocumented families', schedule: 'daily' },
    ])
    insert411(u3, 4) // 4/6
    insertCOC(u3, 6, 2) // 6/10 obeying, 2/10 teaching
    insertPreferences(u3, 'es', 'Fort Collins Hub', 'Fort Collins, CO')
  }

  // ─── cat-user-006: Ana Reyes (Circle Leader — Wellington) ─────────
  const u6 = 'cat-user-006'
  if (!hasCircles(u6)) {
    insertCircles(u6, [
      { personName: 'Familia Morales', proximity: 1, response: 'seeking' },
      { personName: 'Youth group teens (5)', proximity: 2, response: 'interested' },
      { personName: 'Wellington Elementary parents', proximity: 3, response: 'curious' },
      { personName: 'Señora Campos', proximity: 1, response: 'decided', plannedConversation: true },
    ])
    insertPrayers(u6, [
      { title: 'Wellington Circle health and growth', schedule: 'daily' },
      { title: 'Youth caught between two cultures', schedule: 'mon,wed,fri' },
      { title: 'Familia Morales — husband seeking work', schedule: 'daily', lastPrayed: daysAgo(2) },
    ])
    insert411(u6, 3) // 3/6
    insertCOC(u6, 4) // 4/10 obeying
    insertPreferences(u6, 'es', 'Wellington Circle', 'Wellington, CO')
  }

  // ─── cat-user-007: Miguel Santos (Circle Leader — Laporte) ────────
  const u7 = 'cat-user-007'
  if (!hasCircles(u7)) {
    insertCircles(u7, [
      { personName: 'Farm crew (8 men)', proximity: 1, response: 'interested' },
      { personName: 'Foreman Ricardo', proximity: 1, response: 'seeking', plannedConversation: true },
      { personName: 'Familia Santos extended', proximity: 2, response: 'decided' },
    ])
    insertPrayers(u7, [
      { title: 'Laporte farm workers — safety and hope', schedule: 'daily', lastPrayed: today() },
      { title: 'Ricardo — open door for gospel', schedule: 'mon,wed,fri' },
      { title: 'Housing for seasonal workers', schedule: 'tue,sat' },
    ])
    insert411(u7, 2) // 2/6
    insertCOC(u7, 3) // 3/10 obeying
    insertPreferences(u7, 'es', 'Laporte Circle', 'Laporte, CO')
  }
}

function seedCIL() {
  // ─── cil-user-001: Cameron Henrion (Coach) ────────────────────────
  const u1 = 'cil-user-001'
  if (!hasCircles(u1)) {
    insertCircles(u1, [
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
  if (!hasCircles(u3)) {
    insertCircles(u3, [
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
  if (!hasCircles(u4)) {
    insertCircles(u4, [
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
  try {
    seedGlobalChurch()
    seedCatalystNetwork()
    seedCIL()
    console.log('[multiply-seed] Multiply data seeded successfully')
  } catch (err) {
    console.warn('[multiply-seed] Error seeding Multiply data:', err)
  }
}
