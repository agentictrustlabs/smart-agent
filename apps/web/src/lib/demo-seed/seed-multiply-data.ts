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
      plannedConversation: 0,
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
  // ─── cat-user-001: Elena Vasquez (Coach) ──────────────────────────
  const u1 = 'cat-user-001'
  if (!hasCircles(u1)) {
    insertCircles(u1, [
      { personName: 'Linh', proximity: 1, response: 'decided' },
      { personName: 'Community leaders', proximity: 2, response: 'seeking' },
      { personName: 'Government contact', proximity: 3, response: 'interested' },
      { personName: 'Market vendors', proximity: 4, response: 'curious' },
    ])
    insertPrayers(u1, [
      { title: 'Mekong network growth', schedule: 'daily', lastPrayed: today() },
      { title: "Linh's leadership", schedule: 'mon,wed,fri' },
      { title: 'Community health', schedule: 'daily' },
    ])
    insert411(u1, 6)  // all complete
    insertCOC(u1, 10) // all complete
    insertCoachRelationship('cat-user-002', u1)
    insertPreferences(u1, 'en', 'Mekong Catalyst Network', 'Da Nang, Vietnam')
  }

  // ─── cat-user-002: Linh Nguyen (Disciple) ────────────────────────
  const u2 = 'cat-user-002'
  if (!hasCircles(u2)) {
    insertCircles(u2, [
      { personName: 'Hoa', proximity: 1, response: 'decided' },
      { personName: 'Duc', proximity: 1, response: 'decided' },
      { personName: 'Tran', proximity: 1, response: 'seeking' },
      { personName: 'Market women', proximity: 3, response: 'curious' },
    ])
    insertPrayers(u2, [
      { title: 'Da Nang Hub growth', schedule: 'daily', lastPrayed: daysAgo(1) },
      { title: 'Son Tra community', schedule: 'mon,wed,fri,sat' },
    ])
    insert411(u2, 5)      // 5/6
    insertCOC(u2, 8, 4)   // 8/10 obeying, 4/10 teaching
    insertPreferences(u2, 'en', 'Da Nang Hub', 'Da Nang, Vietnam')
  }

  // ─── cat-user-006: Hoa Tran (Disciple) ───────────────────────────
  const u6 = 'cat-user-006'
  if (!hasCircles(u6)) {
    insertCircles(u6, [
      { personName: 'Mrs. Nguyen', proximity: 1, response: 'seeking' },
      { personName: 'Fishermen group', proximity: 2, response: 'interested' },
      { personName: 'Temple visitors', proximity: 3, response: 'curious' },
    ])
    insertPrayers(u6, [
      { title: 'Son Tra Group health', schedule: 'daily' },
      { title: "Fishermen's families", schedule: 'tue,thu,sat' },
    ])
    insert411(u6, 3) // 3/6
    insertCOC(u6, 4) // 4/10 obeying
    insertPreferences(u6, 'en', 'Son Tra Group', 'Son Tra, Da Nang')
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
