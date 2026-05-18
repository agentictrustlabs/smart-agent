import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { workItems } from '../db/schema.js'
import { requirePrincipal } from '../auth/principal-context.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

export const workItemsTools = {
  /**
   * @sa-tool delegation-verified
   * @sa-auth delegation-token
   * @sa-rate-limit none
   * @sa-prod-gate always
   * @sa-risk-tier low
   * @sa-owner developer
   */
  list_work_items: {
    name: 'list_work_items',
    description: 'List work items assigned to the authenticated principal.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        status: { type: 'string' },
        entitlementId: { type: 'string' },
      },
      required: ['token'],
    },
    handler: async (args: { token: string; status?: string; entitlementId?: string }) => {
      const principal = await requirePrincipal(args.token, 'list_work_items')
      let rows = db.select().from(workItems).where(eq(workItems.principal, principal)).all()
      if (args.status) rows = rows.filter(r => r.status === args.status)
      if (args.entitlementId) rows = rows.filter(r => r.entitlementId === args.entitlementId)
      return mcpText({ workItems: rows })
    },
  },

  // System-callable: create a work item against a person assignee. Must be
  // gated by a system delegation scope; for now uses the same gate.
  /**
   * @sa-tool delegation-verified
   * @sa-auth delegation-token
   * @sa-rate-limit none
   * @sa-prod-gate always
   * @sa-validation json-schema
   * @sa-risk-tier medium
   * @sa-owner security
   */
  create_work_item: {
    name: 'create_work_item',
    description: 'Create a work item assigned to the authenticated principal (system-callable via delegation).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        entitlementId: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        dueAt: { type: 'string' },
      },
      required: ['token', 'entitlementId', 'title'],
    },
    handler: async (args: {
      token: string
      entitlementId: string
      title: string
      description?: string
      dueAt?: string
    }) => {
      const principal = await requirePrincipal(args.token, 'create_work_item')
      const row = {
        id: randomUUID(),
        principal,
        entitlementId: args.entitlementId,
        title: args.title,
        description: args.description ?? null,
        dueAt: args.dueAt ?? null,
        status: 'open',
        resolvedAt: null,
        resolvedByActivityId: null,
        createdAt: new Date().toISOString(),
      }
      db.insert(workItems).values(row).run()
      return mcpText({ workItem: row })
    },
  },

  /**
   * @sa-tool delegation-verified
   * @sa-auth delegation-token
   * @sa-rate-limit none
   * @sa-prod-gate always
   * @sa-validation json-schema
   * @sa-risk-tier medium
   * @sa-owner developer
   */
  resolve_work_item: {
    name: 'resolve_work_item',
    description: 'Mark a work item resolved (optionally linked to an activity log entry).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        id: { type: 'string' },
        resolvedByActivityId: { type: 'string' },
      },
      required: ['token', 'id'],
    },
    handler: async (args: { token: string; id: string; resolvedByActivityId?: string }) => {
      const principal = await requirePrincipal(args.token, 'resolve_work_item')
      const now = new Date().toISOString()
      const r = db.update(workItems)
        .set({
          status: 'resolved',
          resolvedAt: now,
          resolvedByActivityId: args.resolvedByActivityId ?? null,
        })
        .where(and(eq(workItems.id, args.id), eq(workItems.principal, principal)))
        .run()
      return mcpText({ resolved: r.changes > 0 })
    },
  },
}
