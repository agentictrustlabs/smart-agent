import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { pinnedItems } from '../db/schema.js'
import { requirePrincipal } from '../auth/principal-context.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

export const pinnedTools = {
  list_pinned_items: {
    name: 'list_pinned_items',
    description: 'List the authenticated principal\'s pinned items.',
    inputSchema: {
      type: 'object' as const,
      properties: { token: { type: 'string' } },
      required: ['token'],
    },
    handler: async (args: { token: string }) => {
      const principal = await requirePrincipal(args.token, 'list_pinned_items')
      const rows = db.select().from(pinnedItems).where(eq(pinnedItems.principal, principal)).all()
      return mcpText({ items: rows })
    },
  },

  pin_item: {
    name: 'pin_item',
    description: 'Pin an item (node, org, agent reference) for quick access.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        itemType: { type: 'string' },
        itemRef: { type: 'string' },
        displayOrder: { type: 'integer' },
      },
      required: ['token', 'itemType', 'itemRef'],
    },
    handler: async (args: { token: string; itemType: string; itemRef: string; displayOrder?: number }) => {
      const principal = await requirePrincipal(args.token, 'pin_item')
      const existing = db.select().from(pinnedItems)
        .where(and(eq(pinnedItems.principal, principal), eq(pinnedItems.itemRef, args.itemRef)))
        .all()
      if (existing.length > 0) return mcpText({ item: existing[0], existed: true })
      const row = {
        id: randomUUID(),
        principal,
        itemType: args.itemType,
        itemRef: args.itemRef,
        displayOrder: args.displayOrder ?? 0,
        createdAt: new Date().toISOString(),
      }
      db.insert(pinnedItems).values(row).run()
      return mcpText({ item: row })
    },
  },

  unpin_item: {
    name: 'unpin_item',
    description: 'Unpin an item by ref.',
    inputSchema: {
      type: 'object' as const,
      properties: { token: { type: 'string' }, itemRef: { type: 'string' } },
      required: ['token', 'itemRef'],
    },
    handler: async (args: { token: string; itemRef: string }) => {
      const principal = await requirePrincipal(args.token, 'unpin_item')
      const result = db.delete(pinnedItems)
        .where(and(eq(pinnedItems.principal, principal), eq(pinnedItems.itemRef, args.itemRef)))
        .run()
      return mcpText({ deleted: result.changes > 0 })
    },
  },
}
