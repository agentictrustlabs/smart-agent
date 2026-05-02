import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { activityLogEntries, engagementHolderState } from '../db/schema.js'
import { requirePrincipal } from '../auth/principal-context.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

export const activitiesTools = {
  list_activities: {
    name: 'list_activities',
    description: 'List activity log entries for the authenticated principal.',
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
      const principal = await requirePrincipal(args.token, 'list_activities')
      let rows = db.select().from(activityLogEntries).where(eq(activityLogEntries.principal, principal)).all()
      if (args.fulfillsEntitlementId) {
        rows = rows.filter(r => r.fulfillsEntitlementId === args.fulfillsEntitlementId)
      }
      rows.sort((a, b) => (b.performedAt ?? '').localeCompare(a.performedAt ?? ''))
      if (args.limit) rows = rows.slice(0, args.limit)
      return mcpText({ activities: rows })
    },
  },

  log_activity: {
    name: 'log_activity',
    description: 'Log a personal activity. If fulfillsEntitlementId is set, increments engagement_holder_state.capacityConsumed.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        kind: { type: 'string' },
        performedAt: { type: 'string' },
        durationMin: { type: 'integer' },
        geo: { type: 'string' },
        witnesses: { type: 'string' },
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
      durationMin?: number
      geo?: string
      witnesses?: string
      fulfillsEntitlementId?: string
      fulfillsNeedId?: string
      fulfillsIntentId?: string
      payload?: string
      evidenceUri?: string
      capacityConsumed?: number
    }) => {
      const principal = await requirePrincipal(args.token, 'log_activity')
      const now = new Date().toISOString()
      const row = {
        id: randomUUID(),
        principal,
        kind: args.kind,
        performedAt: args.performedAt,
        durationMin: args.durationMin ?? null,
        geo: args.geo ?? null,
        witnesses: args.witnesses ?? null,
        fulfillsEntitlementId: args.fulfillsEntitlementId ?? null,
        fulfillsNeedId: args.fulfillsNeedId ?? null,
        fulfillsIntentId: args.fulfillsIntentId ?? null,
        payload: args.payload ?? null,
        evidenceUri: args.evidenceUri ?? null,
        createdAt: now,
      }
      db.insert(activityLogEntries).values(row).run()

      // Cascade: bump engagement_holder_state.capacityConsumed if applicable
      if (args.fulfillsEntitlementId) {
        const consumed = args.capacityConsumed ?? 1
        const existing = db.select().from(engagementHolderState)
          .where(eq(engagementHolderState.entitlementId, args.fulfillsEntitlementId))
          .all()
        if (existing.length === 0) {
          db.insert(engagementHolderState).values({
            entitlementId: args.fulfillsEntitlementId,
            principal,
            capacityConsumed: consumed,
            holderOutcomeNotes: null,
            lastActivityId: row.id,
            updatedAt: now,
          }).run()
        } else {
          db.update(engagementHolderState)
            .set({
              capacityConsumed: existing[0].capacityConsumed + consumed,
              lastActivityId: row.id,
              updatedAt: now,
            })
            .where(eq(engagementHolderState.entitlementId, args.fulfillsEntitlementId))
            .run()
        }
      }

      return mcpText({ activity: row })
    },
  },
}
