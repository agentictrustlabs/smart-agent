import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { orgActivityLogEntries, engagementProviderState } from '../db/schema.js'
import { requireOrgPrincipal } from '../auth/principal-context.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

export const activityTools = {
  list_activities: {
    name: 'list_org_activities',
    description: 'List org activity log entries.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        limit: { type: 'integer' },
        fulfillsEntitlementId: { type: 'string' },
      },
      required: ['token'],
    },
    handler: async (args: { token: string; limit?: number; fulfillsEntitlementId?: string }) => {
      const orgPrincipal = await requireOrgPrincipal(args.token, 'list_org_activities')
      let rows = db.select().from(orgActivityLogEntries).where(eq(orgActivityLogEntries.orgPrincipal, orgPrincipal)).all()
      if (args.fulfillsEntitlementId) {
        rows = rows.filter(r => r.fulfillsEntitlementId === args.fulfillsEntitlementId)
      }
      rows.sort((a, b) => (b.performedAt ?? '').localeCompare(a.performedAt ?? ''))
      if (args.limit) rows = rows.slice(0, args.limit)
      return mcpText({ activities: rows })
    },
  },

  log_activity: {
    name: 'log_org_activity',
    description: 'Log an org activity. If fulfillsEntitlementId is set, decrements engagement_provider_state.capacityRemaining.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        kind: { type: 'string' },
        performedAt: { type: 'string' },
        performedByAgent: { type: 'string' },
        durationMin: { type: 'integer' },
        geo: { type: 'string' },
        participants: { type: 'string' },
        fulfillsEntitlementId: { type: 'string' },
        fulfillsNeedId: { type: 'string' },
        fulfillsIntentId: { type: 'string' },
        payload: { type: 'string' },
        evidenceUri: { type: 'string' },
        capacityConsumed: { type: 'integer' },
      },
      required: ['token', 'kind', 'performedAt'],
    },
    handler: async (args: {
      token: string
      kind: string
      performedAt: string
      performedByAgent?: string
      durationMin?: number
      geo?: string
      participants?: string
      fulfillsEntitlementId?: string
      fulfillsNeedId?: string
      fulfillsIntentId?: string
      payload?: string
      evidenceUri?: string
      capacityConsumed?: number
    }) => {
      const orgPrincipal = await requireOrgPrincipal(args.token, 'log_org_activity')
      const now = new Date().toISOString()
      const row = {
        id: randomUUID(),
        orgPrincipal,
        kind: args.kind,
        performedAt: args.performedAt,
        performedByAgent: args.performedByAgent ?? null,
        durationMin: args.durationMin ?? null,
        geo: args.geo ?? null,
        participants: args.participants ?? null,
        fulfillsEntitlementId: args.fulfillsEntitlementId ?? null,
        fulfillsNeedId: args.fulfillsNeedId ?? null,
        fulfillsIntentId: args.fulfillsIntentId ?? null,
        payload: args.payload ?? null,
        evidenceUri: args.evidenceUri ?? null,
        createdAt: now,
      }
      db.insert(orgActivityLogEntries).values(row).run()

      if (args.fulfillsEntitlementId && args.capacityConsumed) {
        const existing = db.select().from(engagementProviderState)
          .where(eq(engagementProviderState.entitlementId, args.fulfillsEntitlementId))
          .all()
        if (existing.length > 0 && existing[0].capacityRemaining !== null) {
          const remaining = Math.max(0, (existing[0].capacityRemaining ?? 0) - args.capacityConsumed)
          db.update(engagementProviderState)
            .set({ capacityRemaining: remaining, updatedAt: now })
            .where(eq(engagementProviderState.entitlementId, args.fulfillsEntitlementId))
            .run()
        }
      }

      return mcpText({ activity: row })
    },
  },
}
