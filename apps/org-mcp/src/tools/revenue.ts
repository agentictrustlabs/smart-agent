import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { revenueReports } from '../db/schema.js'
import { requireOrgPrincipal } from '../auth/principal-context.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

export const revenueTools = {
  list_revenue_reports: {
    name: 'list_revenue_reports',
    description: 'List revenue reports for the authenticated org.',
    inputSchema: {
      type: 'object' as const,
      properties: { token: { type: 'string' }, status: { type: 'string' } },
      required: ['token'],
    },
    handler: async (args: { token: string; status?: string }) => {
      const orgPrincipal = await requireOrgPrincipal(args.token, 'list_revenue_reports')
      let rows = db.select().from(revenueReports).where(eq(revenueReports.orgPrincipal, orgPrincipal)).all()
      if (args.status) rows = rows.filter(r => r.status === args.status)
      return mcpText({ reports: rows })
    },
  },

  submit_revenue_report: {
    name: 'submit_revenue_report',
    description: 'Submit a revenue report for the authenticated org.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        period: { type: 'string', description: 'YYYY-MM' },
        grossRevenue: { type: 'integer' },
        expenses: { type: 'integer' },
        netRevenue: { type: 'integer' },
        sharePayment: { type: 'integer' },
        currency: { type: 'string' },
        notes: { type: 'string' },
        evidenceUri: { type: 'string' },
        submittedBy: { type: 'string' },
      },
      required: ['token', 'period'],
    },
    handler: async (args: {
      token: string
      period: string
      grossRevenue?: number
      expenses?: number
      netRevenue?: number
      sharePayment?: number
      currency?: string
      notes?: string
      evidenceUri?: string
      submittedBy?: string
    }) => {
      const orgPrincipal = await requireOrgPrincipal(args.token, 'submit_revenue_report')
      const gross = args.grossRevenue ?? 0
      const exp = args.expenses ?? 0
      const net = args.netRevenue ?? Math.max(0, gross - exp)
      const share = args.sharePayment ?? Math.round(net * 0.15)
      const row = {
        id: randomUUID(),
        orgPrincipal,
        period: args.period,
        grossRevenue: gross,
        expenses: exp,
        netRevenue: net,
        sharePayment: share,
        currency: args.currency ?? 'XOF',
        notes: args.notes ?? null,
        evidenceUri: args.evidenceUri ?? null,
        status: 'submitted',
        submittedBy: args.submittedBy ?? null,
        submittedAt: new Date().toISOString(),
        verifiedBy: null,
        verifiedAt: null,
      }
      db.insert(revenueReports).values(row).run()
      return mcpText({ report: row })
    },
  },

  approve_revenue_report: {
    name: 'approve_revenue_report',
    description: 'Mark a revenue report as verified.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        id: { type: 'string' },
        verifiedBy: { type: 'string' },
      },
      required: ['token', 'id'],
    },
    handler: async (args: { token: string; id: string; verifiedBy?: string }) => {
      const orgPrincipal = await requireOrgPrincipal(args.token, 'approve_revenue_report')
      const r = db.update(revenueReports)
        .set({
          status: 'verified',
          verifiedBy: args.verifiedBy ?? null,
          verifiedAt: new Date().toISOString(),
        })
        .where(and(eq(revenueReports.id, args.id), eq(revenueReports.orgPrincipal, orgPrincipal)))
        .run()
      return mcpText({ approved: r.changes > 0 })
    },
  },

  reject_revenue_report: {
    name: 'reject_revenue_report',
    description: 'Mark a revenue report as disputed.',
    inputSchema: {
      type: 'object' as const,
      properties: { token: { type: 'string' }, id: { type: 'string' } },
      required: ['token', 'id'],
    },
    handler: async (args: { token: string; id: string }) => {
      const orgPrincipal = await requireOrgPrincipal(args.token, 'reject_revenue_report')
      const r = db.update(revenueReports)
        .set({ status: 'disputed' })
        .where(and(eq(revenueReports.id, args.id), eq(revenueReports.orgPrincipal, orgPrincipal)))
        .run()
      return mcpText({ rejected: r.changes > 0 })
    },
  },
}
