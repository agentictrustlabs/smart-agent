'use server'

import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { requireSession } from '@/lib/auth/session'

export async function submitRevenueReport(data: {
  orgAddress: string
  period: string
  grossRevenue: number
  expenses: number
  netRevenue: number
  sharePayment: number
  currency: string
  notes: string
}) {
  const session = await requireSession()
  const user = await db.select().from(schema.users)
    .where(eq(schema.users.walletAddress, session.walletAddress ?? '')).limit(1)
  if (!user[0]) throw new Error('User not found')

  const id = randomUUID()
  await db.insert(schema.revenueReports).values({
    id,
    orgAddress: data.orgAddress.toLowerCase(),
    submittedBy: user[0].id,
    period: data.period,
    grossRevenue: data.grossRevenue,
    expenses: data.expenses,
    netRevenue: data.netRevenue,
    sharePayment: data.sharePayment,
    currency: data.currency || 'XOF',
    notes: data.notes || null,
    status: 'submitted',
  })
  return { id }
}

export async function verifyRevenueReport(reportId: string) {
  const session = await requireSession()
  const user = await db.select().from(schema.users)
    .where(eq(schema.users.walletAddress, session.walletAddress ?? '')).limit(1)
  if (!user[0]) throw new Error('User not found')

  await db.update(schema.revenueReports)
    .set({ status: 'verified', verifiedBy: user[0].id, verifiedAt: new Date().toISOString() })
    .where(eq(schema.revenueReports.id, reportId))
}

export async function getRevenueReports(orgAddress: string) {
  return db.select().from(schema.revenueReports)
    .where(eq(schema.revenueReports.orgAddress, orgAddress.toLowerCase()))
}
