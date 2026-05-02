import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { oikosContacts } from '../db/schema.js'
import { requirePrincipal } from '../auth/principal-context.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

export const oikosTools = {
  list_oikos_contacts: {
    name: 'list_oikos_contacts',
    description: 'List the authenticated principal\'s oikos contacts.',
    inputSchema: {
      type: 'object' as const,
      properties: { token: { type: 'string' } },
      required: ['token'],
    },
    handler: async (args: { token: string }) => {
      const principal = await requirePrincipal(args.token, 'list_oikos_contacts')
      const rows = db.select().from(oikosContacts).where(eq(oikosContacts.principal, principal)).all()
      return mcpText({ contacts: rows })
    },
  },

  add_oikos_contact: {
    name: 'add_oikos_contact',
    description: 'Add an oikos contact for the authenticated principal.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        personName: { type: 'string' },
        proximity: { type: 'string' },
        spiritualResponseState: { type: 'string' },
        plannedConversation: { type: 'boolean' },
        notes: { type: 'string' },
        tags: { type: 'string', description: 'JSON array string' },
      },
      required: ['token', 'personName'],
    },
    handler: async (args: {
      token: string
      personName: string
      proximity?: string
      spiritualResponseState?: string
      plannedConversation?: boolean
      notes?: string
      tags?: string
    }) => {
      const principal = await requirePrincipal(args.token, 'add_oikos_contact')
      const now = new Date().toISOString()
      const row = {
        id: randomUUID(),
        principal,
        personName: args.personName,
        proximity: args.proximity ?? null,
        spiritualResponseState: args.spiritualResponseState ?? null,
        lastContactAt: null,
        plannedConversation: args.plannedConversation ? 1 : 0,
        notes: args.notes ?? null,
        tags: args.tags ?? null,
        createdAt: now,
        updatedAt: now,
      }
      db.insert(oikosContacts).values(row).run()
      return mcpText({ contact: row })
    },
  },

  update_oikos_contact: {
    name: 'update_oikos_contact',
    description: 'Update an oikos contact owned by the authenticated principal.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        id: { type: 'string' },
        personName: { type: 'string' },
        proximity: { type: 'string' },
        spiritualResponseState: { type: 'string' },
        plannedConversation: { type: 'boolean' },
        notes: { type: 'string' },
        tags: { type: 'string' },
        lastContactAt: { type: 'string' },
      },
      required: ['token', 'id'],
    },
    handler: async (args: {
      token: string
      id: string
      personName?: string
      proximity?: string
      spiritualResponseState?: string
      plannedConversation?: boolean
      notes?: string
      tags?: string
      lastContactAt?: string
    }) => {
      const principal = await requirePrincipal(args.token, 'update_oikos_contact')
      const updates: Record<string, string | number | null> = { updatedAt: new Date().toISOString() }
      if (args.personName !== undefined) updates.personName = args.personName
      if (args.proximity !== undefined) updates.proximity = args.proximity
      if (args.spiritualResponseState !== undefined) updates.spiritualResponseState = args.spiritualResponseState
      if (args.plannedConversation !== undefined) updates.plannedConversation = args.plannedConversation ? 1 : 0
      if (args.notes !== undefined) updates.notes = args.notes
      if (args.tags !== undefined) updates.tags = args.tags
      if (args.lastContactAt !== undefined) updates.lastContactAt = args.lastContactAt

      const result = db.update(oikosContacts).set(updates)
        .where(and(eq(oikosContacts.id, args.id), eq(oikosContacts.principal, principal)))
        .run()
      return mcpText({ updated: result.changes > 0 })
    },
  },

  delete_oikos_contact: {
    name: 'delete_oikos_contact',
    description: 'Delete an oikos contact owned by the authenticated principal.',
    inputSchema: {
      type: 'object' as const,
      properties: { token: { type: 'string' }, id: { type: 'string' } },
      required: ['token', 'id'],
    },
    handler: async (args: { token: string; id: string }) => {
      const principal = await requirePrincipal(args.token, 'delete_oikos_contact')
      const result = db.delete(oikosContacts)
        .where(and(eq(oikosContacts.id, args.id), eq(oikosContacts.principal, principal)))
        .run()
      return mcpText({ deleted: result.changes > 0 })
    },
  },

  toggle_planned_conversation: {
    name: 'toggle_planned_conversation',
    description: 'Toggle the plannedConversation flag on an oikos contact.',
    inputSchema: {
      type: 'object' as const,
      properties: { token: { type: 'string' }, id: { type: 'string' } },
      required: ['token', 'id'],
    },
    handler: async (args: { token: string; id: string }) => {
      const principal = await requirePrincipal(args.token, 'toggle_planned_conversation')
      const rows = db.select().from(oikosContacts)
        .where(and(eq(oikosContacts.id, args.id), eq(oikosContacts.principal, principal)))
        .all()
      if (rows.length === 0) throw new Error('Contact not found or not owned by principal')
      const next = rows[0].plannedConversation === 1 ? 0 : 1
      db.update(oikosContacts)
        .set({ plannedConversation: next, updatedAt: new Date().toISOString() })
        .where(and(eq(oikosContacts.id, args.id), eq(oikosContacts.principal, principal)))
        .run()
      return mcpText({ plannedConversation: next === 1 })
    },
  },
}
