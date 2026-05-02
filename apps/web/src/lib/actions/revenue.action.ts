'use server'

import { requireSession } from '@/lib/auth/session'
import { revalidatePath } from 'next/cache'
import { callMcp } from '@/lib/clients/mcp-client'

// Revenue reports moved to org-mcp. The org-mcp tool key is the authenticated
// org_principal (extracted from the delegation token), so the orgAddress arg
// is no longer used as a key — kept only for caller compatibility.

export async function submitRevenueReport(data: {
  orgAddress: string
  period: string
  grossRevenue: number
  expenses: number
  netRevenue: number
  notes?: string
}) {
  await requireSession()
  await callMcp('org', 'submit_revenue_report', {
    period: data.period,
    grossRevenue: data.grossRevenue,
    expenses: data.expenses,
    netRevenue: data.netRevenue,
    sharePayment: Math.round(data.netRevenue * 0.15),
    notes: data.notes,
  })

  revalidatePath('/activity')
  revalidatePath('/dashboard')
  revalidatePath('/h/mission/home')
  revalidatePath('/h/catalyst/home')
}

export async function approveRevenueReport(reportId: string) {
  await requireSession()
  await callMcp('org', 'approve_revenue_report', { id: reportId })

  revalidatePath('/activity')
  revalidatePath('/dashboard')
  revalidatePath('/h/mission/home')
  revalidatePath('/h/catalyst/home')
}

export async function rejectRevenueReport(reportId: string) {
  await requireSession()
  await callMcp('org', 'reject_revenue_report', { id: reportId })
  revalidatePath('/activity')
}
