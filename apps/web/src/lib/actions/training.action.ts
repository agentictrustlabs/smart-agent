'use server'

import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { requireSession } from '@/lib/auth/session'

export async function recordTrainingCompletion(data: {
  userId: string
  moduleId: string
  score?: number
  notes?: string
}) {
  const session = await requireSession()
  const assessor = await db.select().from(schema.users)
    .where(eq(schema.users.walletAddress, session.walletAddress ?? '')).limit(1)
  if (!assessor[0]) throw new Error('User not found')

  const id = randomUUID()
  await db.insert(schema.trainingCompletions).values({
    id,
    userId: data.userId,
    moduleId: data.moduleId,
    assessedBy: assessor[0].id,
    score: data.score ?? null,
    notes: data.notes ?? null,
    completedAt: new Date().toISOString(),
  })
  return { id }
}

export async function getTrainingProgress(userId: string) {
  const completions = await db.select().from(schema.trainingCompletions)
    .where(eq(schema.trainingCompletions.userId, userId))
  const modules = await db.select().from(schema.trainingModules)
  return { modules, completions }
}

export async function ensureBdcModulesExist() {
  const { BDC_MODULES } = await import('@/lib/togo/bdc-modules')
  const existing = await db.select().from(schema.trainingModules)
  for (const m of BDC_MODULES) {
    if (!existing.some(e => e.id === m.id)) {
      await db.insert(schema.trainingModules).values({
        id: m.id,
        name: m.name,
        description: m.description,
        program: 'bdc',
        hours: m.hours,
        sortOrder: m.sortOrder,
      })
    }
  }
}
