'use server'

import { randomUUID } from 'crypto'
import { requireSession } from '@/lib/auth/session'
import { db, schema } from '@/db'
import { eq, and, desc } from 'drizzle-orm'

// ─── Training Progress ─────────────────────────────────────────────

export async function getTrainingProgress(userId: string) {
  return db.select().from(schema.trainingProgress).where(eq(schema.trainingProgress.userId, userId))
}

export async function toggleModule(moduleKey: string, program: string, track?: string) {
  const session = await requireSession()
  const user = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.walletAddress, session.walletAddress ?? ''))
    .limit(1)
  if (!user[0]) throw new Error('User not found')

  const userId = user[0].id

  // Find existing record
  const conditions = [
    eq(schema.trainingProgress.userId, userId),
    eq(schema.trainingProgress.moduleKey, moduleKey),
    eq(schema.trainingProgress.program, program),
  ]
  if (track) {
    conditions.push(eq(schema.trainingProgress.track, track))
  }

  const existing = await db
    .select()
    .from(schema.trainingProgress)
    .where(and(...conditions))
    .limit(1)

  if (existing[0]) {
    const nowCompleted = existing[0].completed === 0 ? 1 : 0
    await db
      .update(schema.trainingProgress)
      .set({
        completed: nowCompleted,
        completedAt: nowCompleted ? new Date().toISOString() : null,
      })
      .where(eq(schema.trainingProgress.id, existing[0].id))
    return { completed: nowCompleted === 1 }
  }

  // Create new record as completed
  await db.insert(schema.trainingProgress).values({
    id: randomUUID(),
    userId,
    moduleKey,
    program,
    track: track ?? null,
    completed: 1,
    completedAt: new Date().toISOString(),
  })
  return { completed: true }
}

// ─── Coach Relationships ────────────────────────────────────────────

export async function getCoachRelationship(userId: string) {
  const rows = await db
    .select()
    .from(schema.coachRelationships)
    .where(and(eq(schema.coachRelationships.discipleId, userId), eq(schema.coachRelationships.status, 'active')))
    .limit(1)
  if (!rows[0]) return null

  // Get coach name
  const coach = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, rows[0].coachId))
    .limit(1)

  return {
    id: rows[0].id,
    coachId: rows[0].coachId,
    coachName: coach[0]?.name ?? 'Unknown',
    sharePermissions: rows[0].sharePermissions,
    status: rows[0].status,
  }
}

export async function getDisciples(userId: string) {
  const rows = await db
    .select()
    .from(schema.coachRelationships)
    .where(and(eq(schema.coachRelationships.coachId, userId), eq(schema.coachRelationships.status, 'active')))

  const disciples = []
  for (const row of rows) {
    const user = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, row.discipleId))
      .limit(1)
    disciples.push({
      id: row.id,
      discipleId: row.discipleId,
      discipleName: user[0]?.name ?? 'Unknown',
      sharePermissions: row.sharePermissions,
    })
  }
  return disciples
}

// ─── Day-since helper ───────────────────────────────────────────────

function daysSince(dateStr: string): number {
  const then = new Date(dateStr)
  const now = new Date()
  return Math.floor((now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24))
}

// ─── Disciple Details (Coach Dashboard) ─────────────────────────────

export async function getDiscipleDetails(discipleId: string) {
  // Get recent activities (last 5)
  const activities = await db.select().from(schema.activityLogs)
    .where(eq(schema.activityLogs.userId, discipleId))
    .orderBy(desc(schema.activityLogs.activityDate))
    .limit(5)

  // Get prayer count (unanswered)
  const prayers = await db.select().from(schema.prayers)
    .where(and(eq(schema.prayers.userId, discipleId), eq(schema.prayers.answered, 0)))

  // Get training progress
  const progress = await db.select().from(schema.trainingProgress)
    .where(eq(schema.trainingProgress.userId, discipleId))
  const completed = progress.filter(p => p.completed === 1).length
  const total = 28 // 6 + 20 + 2

  // Last activity date
  const lastActivity = activities[0]?.activityDate ?? null

  return {
    recentActivities: activities,
    prayerCount: prayers.length,
    trainingPct: total > 0 ? Math.round((completed / total) * 100) : 0,
    lastActivityDate: lastActivity,
    needsAttention: !lastActivity || daysSince(lastActivity) > 7,
  }
}

// ─── User Preferences ───────────────────────────────────────────────

export async function getUserPreferences(userId: string) {
  const rows = await db
    .select()
    .from(schema.userPreferences)
    .where(eq(schema.userPreferences.userId, userId))
    .limit(1)
  return rows[0] ?? null
}

export async function updateUserPreferences(
  userId: string,
  data: { language?: string; homeChurch?: string; location?: string }
) {
  await requireSession()

  const existing = await db
    .select()
    .from(schema.userPreferences)
    .where(eq(schema.userPreferences.userId, userId))
    .limit(1)

  if (existing[0]) {
    await db
      .update(schema.userPreferences)
      .set(data)
      .where(eq(schema.userPreferences.id, existing[0].id))
  } else {
    await db.insert(schema.userPreferences).values({
      id: randomUUID(),
      userId,
      language: data.language ?? 'en',
      homeChurch: data.homeChurch ?? null,
      location: data.location ?? null,
    })
  }

  return { success: true }
}
