'use server'

import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { requireSession } from '@/lib/auth/session'
import { revalidatePath } from 'next/cache'

export async function submitRevenueReport(data: {
  orgAddress: string
  period: string          // YYYY-MM
  grossRevenue: number
  expenses: number
  netRevenue: number
  notes?: string
}) {
  const session = await requireSession()
  const user = await db.select().from(schema.users)
    .where(eq(schema.users.walletAddress, session.walletAddress ?? '')).limit(1)
  if (!user[0]) throw new Error('User not found')

  await db.insert(schema.revenueReports).values({
    id: randomUUID(),
    orgAddress: data.orgAddress,
    submittedBy: user[0].id,
    period: data.period,
    grossRevenue: data.grossRevenue,
    expenses: data.expenses,
    netRevenue: data.netRevenue,
    sharePayment: Math.round(data.netRevenue * 0.15), // 15% revenue share
    currency: 'XOF',
    notes: data.notes ?? null,
    status: 'submitted',
  }).run()

  revalidatePath('/activity')
  revalidatePath('/dashboard')
  revalidatePath('/h/mission/home')
  revalidatePath('/h/catalyst/home')
}

export async function approveRevenueReport(reportId: string) {
  const session = await requireSession()
  const user = await db.select().from(schema.users)
    .where(eq(schema.users.walletAddress, session.walletAddress ?? '')).limit(1)
  if (!user[0]) throw new Error('User not found')

  await db.update(schema.revenueReports)
    .set({ status: 'verified', verifiedBy: user[0].id, verifiedAt: new Date().toISOString() })
    .where(eq(schema.revenueReports.id, reportId))
    .run()

  revalidatePath('/activity')
  revalidatePath('/dashboard')
  revalidatePath('/h/mission/home')
  revalidatePath('/h/catalyst/home')
}

export async function rejectRevenueReport(reportId: string) {
  await requireSession()
  await db.update(schema.revenueReports)
    .set({ status: 'disputed' })
    .where(eq(schema.revenueReports.id, reportId))
    .run()

  revalidatePath('/activity')
}
