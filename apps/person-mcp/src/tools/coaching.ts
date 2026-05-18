import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { coachingNotes } from '../db/schema.js'
import { requirePrincipal } from '../auth/principal-context.js'
import { verifyCrossDelegation } from '../auth/verify-delegation.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

export const coachingTools = {
  /**
   * @sa-tool delegation-verified
   * @sa-auth delegation-token
   * @sa-rate-limit none
   * @sa-prod-gate always
   * @sa-risk-tier low
   * @sa-owner developer
   */
  list_coaching_notes: {
    name: 'list_coaching_notes',
    description: 'List coaching notes authored by the authenticated principal (the coach).',
    inputSchema: {
      type: 'object' as const,
      properties: { token: { type: 'string' }, subjectAgent: { type: 'string' } },
      required: ['token'],
    },
    handler: async (args: { token: string; subjectAgent?: string }) => {
      const principal = await requirePrincipal(args.token, 'list_coaching_notes')
      const rows = args.subjectAgent
        ? db.select().from(coachingNotes)
            .where(and(eq(coachingNotes.principal, principal), eq(coachingNotes.subjectAgent, args.subjectAgent.toLowerCase())))
            .all()
        : db.select().from(coachingNotes).where(eq(coachingNotes.principal, principal)).all()
      return mcpText({ notes: rows })
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
  upsert_coaching_note: {
    name: 'upsert_coaching_note',
    description: 'Create or update a coaching note owned by the authenticated principal.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        id: { type: 'string' },
        subjectAgent: { type: 'string' },
        content: { type: 'string' },
        sharedWithSubject: { type: 'boolean' },
      },
      required: ['token', 'subjectAgent', 'content'],
    },
    handler: async (args: {
      token: string
      id?: string
      subjectAgent: string
      content: string
      sharedWithSubject?: boolean
    }) => {
      const principal = await requirePrincipal(args.token, 'upsert_coaching_note')
      const now = new Date().toISOString()
      if (args.id) {
        const r = db.update(coachingNotes)
          .set({
            content: args.content,
            sharedWithSubject: args.sharedWithSubject ? 1 : 0,
            updatedAt: now,
          })
          .where(and(eq(coachingNotes.id, args.id), eq(coachingNotes.principal, principal)))
          .run()
        return mcpText({ updated: r.changes > 0, id: args.id })
      }
      const row = {
        id: randomUUID(),
        principal,
        subjectAgent: args.subjectAgent.toLowerCase(),
        content: args.content,
        sharedWithSubject: args.sharedWithSubject ? 1 : 0,
        createdAt: now,
        updatedAt: now,
      }
      db.insert(coachingNotes).values(row).run()
      return mcpText({ note: row })
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
  delete_coaching_note: {
    name: 'delete_coaching_note',
    description: 'Delete a coaching note owned by the authenticated principal.',
    inputSchema: {
      type: 'object' as const,
      properties: { token: { type: 'string' }, id: { type: 'string' } },
      required: ['token', 'id'],
    },
    handler: async (args: { token: string; id: string }) => {
      const principal = await requirePrincipal(args.token, 'delete_coaching_note')
      const r = db.delete(coachingNotes)
        .where(and(eq(coachingNotes.id, args.id), eq(coachingNotes.principal, principal)))
        .run()
      return mcpText({ deleted: r.changes > 0 })
    },
  },

  // Disciple-side: read coaching notes shared with me. The disciple presents a
  // cross-delegation from the coach granting `coaching_notes` resource read.
  /**
   * @sa-tool delegation-verified
   * @sa-auth delegation-token
   * @sa-rate-limit none
   * @sa-prod-gate always
   * @sa-risk-tier medium
   * @sa-owner security
   */
  get_shared_coaching_notes: {
    name: 'get_shared_coaching_notes',
    description: 'Read coaching notes the coach has shared with the authenticated subject (cross-delegation).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        coachPrincipal: { type: 'string' },
        crossDelegation: { type: 'object' },
      },
      required: ['token', 'coachPrincipal', 'crossDelegation'],
    },
    handler: async (args: {
      token: string
      coachPrincipal: string
      crossDelegation: {
        delegator: `0x${string}`
        delegate: `0x${string}`
        authority: `0x${string}`
        caveats: Array<{ enforcer: `0x${string}`; terms: `0x${string}` }>
        salt: string
        signature: `0x${string}`
      }
    }) => {
      const callerPrincipal = await requirePrincipal(args.token, 'get_shared_coaching_notes')
      const crossResult = await verifyCrossDelegation(args.crossDelegation, callerPrincipal, 'urn:mcp:server:person')
      if ('error' in crossResult) return mcpText({ error: crossResult.error })
      if (args.coachPrincipal.toLowerCase() !== crossResult.dataPrincipal) {
        return mcpText({ error: 'coachPrincipal does not match delegation grantor' })
      }
      const grant = crossResult.grants.find(g => g.resources.includes('coaching_notes'))
      if (!grant) return mcpText({ error: 'no coaching_notes grant in delegation' })
      const rows = db.select().from(coachingNotes)
        .where(and(
          eq(coachingNotes.principal, crossResult.dataPrincipal),
          eq(coachingNotes.subjectAgent, callerPrincipal.toLowerCase()),
          eq(coachingNotes.sharedWithSubject, 1),
        ))
        .all()
      return mcpText({ notes: rows })
    },
  },
}
