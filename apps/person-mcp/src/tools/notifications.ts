import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { notifications } from '../db/schema.js'
import { requirePrincipal } from '../auth/principal-context.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

export const notificationsTools = {
  list_notifications: {
    name: 'list_notifications',
    description: 'List notifications for the authenticated principal.',
    inputSchema: {
      type: 'object' as const,
      properties: { token: { type: 'string' }, includeRead: { type: 'boolean' } },
      required: ['token'],
    },
    handler: async (args: { token: string; includeRead?: boolean }) => {
      const principal = await requirePrincipal(args.token, 'list_notifications')
      const rows = db.select().from(notifications).where(eq(notifications.principal, principal)).all()
      const filtered = args.includeRead ? rows : rows.filter(r => !r.readAt)
      return mcpText({ notifications: filtered })
    },
  },

  mark_notification_read: {
    name: 'mark_notification_read',
    description: 'Mark a notification as read.',
    inputSchema: {
      type: 'object' as const,
      properties: { token: { type: 'string' }, id: { type: 'string' } },
      required: ['token', 'id'],
    },
    handler: async (args: { token: string; id: string }) => {
      const principal = await requirePrincipal(args.token, 'mark_notification_read')
      const result = db.update(notifications)
        .set({ readAt: new Date().toISOString() })
        .where(and(eq(notifications.id, args.id), eq(notifications.principal, principal)))
        .run()
      return mcpText({ updated: result.changes > 0 })
    },
  },

  // System-only — should be gated by Security to require system delegation
  // scope; for now this is just the same delegation gate as user-owned tools.
  // The org-mcp / a2a-agent / etc. call this via cross-delegation when they
  // need to drop a notification into a person's inbox.
  create_notification: {
    name: 'create_notification',
    description: 'Insert a notification for the authenticated principal (system-callable via cross-delegation).',
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
      const principal = await requirePrincipal(args.token, 'create_notification')
      const row = {
        id: randomUUID(),
        principal,
        kind: args.kind,
        payload: args.payload ?? null,
        readAt: null,
        createdAt: new Date().toISOString(),
      }
      db.insert(notifications).values(row).run()
      return mcpText({ notification: row })
    },
  },
}
