import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { beliefs } from '../db/schema.js'
import { requirePrincipal } from '../auth/principal-context.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

export const beliefsTools = {
  /**
   * @sa-tool delegation-verified
   * @sa-auth delegation-token
   * @sa-rate-limit none
   * @sa-prod-gate always
   * @sa-risk-tier low
   * @sa-owner developer
   */
  list_beliefs: {
    name: 'list_beliefs',
    description: 'List beliefs held by the authenticated principal.',
    inputSchema: {
      type: 'object' as const,
      properties: { token: { type: 'string' } },
      required: ['token'],
    },
    handler: async (args: { token: string }) => {
      const principal = await requirePrincipal(args.token, 'list_beliefs')
      const rows = db.select().from(beliefs).where(eq(beliefs.principal, principal)).all()
      return mcpText({ beliefs: rows })
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
  upsert_belief: {
    name: 'upsert_belief',
    description: 'Create or update a belief held by the authenticated principal.',
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
      const principal = await requirePrincipal(args.token, 'upsert_belief')
      const now = new Date().toISOString()
      if (args.id) {
        const updates: Record<string, string | null> = { updatedAt: now, statement: args.statement }
        if (args.tags !== undefined) updates.tags = args.tags
        if (args.informsIntentId !== undefined) updates.informsIntentId = args.informsIntentId
        if (args.visibility !== undefined) updates.visibility = args.visibility
        const r = db.update(beliefs).set(updates)
          .where(and(eq(beliefs.id, args.id), eq(beliefs.principal, principal)))
          .run()
        return mcpText({ updated: r.changes > 0, id: args.id })
      }
      const row = {
        id: randomUUID(),
        principal,
        statement: args.statement,
        tags: args.tags ?? null,
        informsIntentId: args.informsIntentId ?? null,
        visibility: args.visibility ?? 'private',
        createdAt: now,
        updatedAt: now,
      }
      db.insert(beliefs).values(row).run()
      return mcpText({ belief: row })
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
  delete_belief: {
    name: 'delete_belief',
    description: 'Delete a belief owned by the authenticated principal.',
    inputSchema: {
      type: 'object' as const,
      properties: { token: { type: 'string' }, id: { type: 'string' } },
      required: ['token', 'id'],
    },
    handler: async (args: { token: string; id: string }) => {
      const principal = await requirePrincipal(args.token, 'delete_belief')
      const r = db.delete(beliefs)
        .where(and(eq(beliefs.id, args.id), eq(beliefs.principal, principal)))
        .run()
      return mcpText({ deleted: r.changes > 0 })
    },
  },
}
