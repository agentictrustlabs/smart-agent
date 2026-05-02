import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { orgNotifications, orgBeliefs } from '../db/schema.js'
import { requireOrgPrincipal } from '../auth/principal-context.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

export const orgNotificationsTools = {
  list_org_notifications: {
    name: 'list_org_notifications',
    description: 'List org inbox notifications.',
    inputSchema: {
      type: 'object' as const,
      properties: { token: { type: 'string' }, includeRead: { type: 'boolean' } },
      required: ['token'],
    },
    handler: async (args: { token: string; includeRead?: boolean }) => {
      const orgPrincipal = await requireOrgPrincipal(args.token, 'list_org_notifications')
      const rows = db.select().from(orgNotifications).where(eq(orgNotifications.orgPrincipal, orgPrincipal)).all()
      const filtered = args.includeRead ? rows : rows.filter(r => !r.readAt)
      return mcpText({ notifications: filtered })
    },
  },

  mark_org_notification_read: {
    name: 'mark_org_notification_read',
    description: 'Mark an org notification as read.',
    inputSchema: {
      type: 'object' as const,
      properties: { token: { type: 'string' }, id: { type: 'string' } },
      required: ['token', 'id'],
    },
    handler: async (args: { token: string; id: string }) => {
      const orgPrincipal = await requireOrgPrincipal(args.token, 'mark_org_notification_read')
      const r = db.update(orgNotifications)
        .set({ readAt: new Date().toISOString() })
        .where(and(eq(orgNotifications.id, args.id), eq(orgNotifications.orgPrincipal, orgPrincipal)))
        .run()
      return mcpText({ updated: r.changes > 0 })
    },
  },

  create_org_notification: {
    name: 'create_org_notification',
    description: 'Insert a notification into the authenticated org\'s inbox.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        kind: { type: 'string' },
        payload: { type: 'string' },
      },
      required: ['token', 'kind'],
    },
    handler: async (args: { token: string; kind: string; payload?: string }) => {
      const orgPrincipal = await requireOrgPrincipal(args.token, 'create_org_notification')
      const row = {
        id: randomUUID(),
        orgPrincipal,
        kind: args.kind,
        payload: args.payload ?? null,
        readAt: null,
        createdAt: new Date().toISOString(),
      }
      db.insert(orgNotifications).values(row).run()
      return mcpText({ notification: row })
    },
  },
}

export const orgBeliefsTools = {
  list_org_beliefs: {
    name: 'list_org_beliefs',
    description: 'List beliefs held by the authenticated org.',
    inputSchema: {
      type: 'object' as const,
      properties: { token: { type: 'string' } },
      required: ['token'],
    },
    handler: async (args: { token: string }) => {
      const orgPrincipal = await requireOrgPrincipal(args.token, 'list_org_beliefs')
      const rows = db.select().from(orgBeliefs).where(eq(orgBeliefs.orgPrincipal, orgPrincipal)).all()
      return mcpText({ beliefs: rows })
    },
  },

  upsert_org_belief: {
    name: 'upsert_org_belief',
    description: 'Create or update a belief held by the authenticated org.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        id: { type: 'string' },
        statement: { type: 'string' },
        tags: { type: 'string' },
        informsIntentId: { type: 'string' },
        visibility: { type: 'string' },
      },
      required: ['token', 'statement'],
    },
    handler: async (args: {
      token: string
      id?: string
      statement: string
      tags?: string
      informsIntentId?: string
      visibility?: string
    }) => {
      const orgPrincipal = await requireOrgPrincipal(args.token, 'upsert_org_belief')
      const now = new Date().toISOString()
      if (args.id) {
        const updates: Record<string, string | null> = { updatedAt: now, statement: args.statement }
        if (args.tags !== undefined) updates.tags = args.tags
        if (args.informsIntentId !== undefined) updates.informsIntentId = args.informsIntentId
        if (args.visibility !== undefined) updates.visibility = args.visibility
        const r = db.update(orgBeliefs).set(updates)
          .where(and(eq(orgBeliefs.id, args.id), eq(orgBeliefs.orgPrincipal, orgPrincipal)))
          .run()
        return mcpText({ updated: r.changes > 0 })
      }
      const row = {
        id: randomUUID(),
        orgPrincipal,
        statement: args.statement,
        tags: args.tags ?? null,
        informsIntentId: args.informsIntentId ?? null,
        visibility: args.visibility ?? 'private',
        createdAt: now,
        updatedAt: now,
      }
      db.insert(orgBeliefs).values(row).run()
      return mcpText({ belief: row })
    },
  },
}
