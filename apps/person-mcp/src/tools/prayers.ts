import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { prayers } from '../db/schema.js'
import { requirePrincipal } from '../auth/principal-context.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

export const prayersTools = {
  /**
   * @sa-tool delegation-verified
   * @sa-auth delegation-token
   * @sa-rate-limit none
   * @sa-prod-gate always
   * @sa-risk-tier low
   * @sa-owner developer
   */
  list_prayers: {
    name: 'list_prayers',
    description: 'List the authenticated principal\'s prayer entries.',
    inputSchema: {
      type: 'object' as const,
      properties: { token: { type: 'string' } },
      required: ['token'],
    },
    handler: async (args: { token: string }) => {
      const principal = await requirePrincipal(args.token, 'list_prayers')
      const rows = db.select().from(prayers).where(eq(prayers.principal, principal)).all()
      return mcpText({ prayers: rows })
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
  upsert_prayer: {
    name: 'upsert_prayer',
    description: 'Create or update a prayer entry for the authenticated principal. Pass id to update; omit to create.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        id: { type: 'string' },
        title: { type: 'string' },
        content: { type: 'string' },
        schedule: { type: 'string' },
        responseState: { type: 'string' },
        linkedOikosContactId: { type: 'string' },
        tags: { type: 'string' },
      },
      required: ['token', 'title'],
    },
    handler: async (args: {
      token: string
      id?: string
      title: string
      content?: string
      schedule?: string
      responseState?: string
      linkedOikosContactId?: string
      tags?: string
    }) => {
      const principal = await requirePrincipal(args.token, 'upsert_prayer')
      const now = new Date().toISOString()

      if (args.id) {
        const updates: Record<string, string | null> = { updatedAt: now, title: args.title }
        if (args.content !== undefined) updates.content = args.content
        if (args.schedule !== undefined) updates.schedule = args.schedule
        if (args.responseState !== undefined) updates.responseState = args.responseState
        if (args.linkedOikosContactId !== undefined) updates.linkedOikosContactId = args.linkedOikosContactId
        if (args.tags !== undefined) updates.tags = args.tags
        const result = db.update(prayers).set(updates)
          .where(and(eq(prayers.id, args.id), eq(prayers.principal, principal)))
          .run()
        return mcpText({ updated: result.changes > 0, id: args.id })
      }

      const row = {
        id: randomUUID(),
        principal,
        title: args.title,
        content: args.content ?? null,
        schedule: args.schedule ?? null,
        responseState: args.responseState ?? 'open',
        linkedOikosContactId: args.linkedOikosContactId ?? null,
        tags: args.tags ?? null,
        lastPrayedAt: null,
        createdAt: now,
        updatedAt: now,
      }
      db.insert(prayers).values(row).run()
      return mcpText({ prayer: row })
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
  delete_prayer: {
    name: 'delete_prayer',
    description: 'Delete a prayer entry owned by the authenticated principal.',
    inputSchema: {
      type: 'object' as const,
      properties: { token: { type: 'string' }, id: { type: 'string' } },
      required: ['token', 'id'],
    },
    handler: async (args: { token: string; id: string }) => {
      const principal = await requirePrincipal(args.token, 'delete_prayer')
      const result = db.delete(prayers)
        .where(and(eq(prayers.id, args.id), eq(prayers.principal, principal)))
        .run()
      return mcpText({ deleted: result.changes > 0 })
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
  mark_prayer_response: {
    name: 'mark_prayer_response',
    description: 'Update a prayer\'s response state and bump lastPrayedAt.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        id: { type: 'string' },
        responseState: { type: 'string' },
      },
      required: ['token', 'id', 'responseState'],
    },
    handler: async (args: { token: string; id: string; responseState: string }) => {
      const principal = await requirePrincipal(args.token, 'mark_prayer_response')
      const now = new Date().toISOString()
      const result = db.update(prayers)
        .set({ responseState: args.responseState, lastPrayedAt: now, updatedAt: now })
        .where(and(eq(prayers.id, args.id), eq(prayers.principal, principal)))
        .run()
      return mcpText({ updated: result.changes > 0 })
    },
  },
}
