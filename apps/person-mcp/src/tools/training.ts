import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { trainingProgress } from '../db/schema.js'
import { requirePrincipal } from '../auth/principal-context.js'
import { verifyCrossDelegation } from '../auth/verify-delegation.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

export const trainingTools = {
  /**
   * @sa-tool delegation-verified
   * @sa-auth delegation-token
   * @sa-rate-limit none
   * @sa-prod-gate always
   * @sa-risk-tier low
   * @sa-owner developer
   */
  list_training_progress: {
    name: 'list_training_progress',
    description: 'List training-progress rows for the authenticated principal.',
    inputSchema: {
      type: 'object' as const,
      properties: { token: { type: 'string' } },
      required: ['token'],
    },
    handler: async (args: { token: string }) => {
      const principal = await requirePrincipal(args.token, 'list_training_progress')
      const rows = db.select().from(trainingProgress).where(eq(trainingProgress.principal, principal)).all()
      return mcpText({ progress: rows })
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
  toggle_training_module: {
    name: 'toggle_training_module',
    description: 'Toggle a training module\'s completion state for the authenticated principal.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        moduleKey: { type: 'string' },
        programKey: { type: 'string' },
        track: { type: 'string' },
        hoursLogged: { type: 'integer' },
      },
      required: ['token', 'moduleKey'],
    },
    handler: async (args: {
      token: string
      moduleKey: string
      programKey?: string
      track?: string
      hoursLogged?: number
    }) => {
      const principal = await requirePrincipal(args.token, 'toggle_training_module')
      const now = new Date().toISOString()
      const existing = db.select().from(trainingProgress)
        .where(and(eq(trainingProgress.principal, principal), eq(trainingProgress.moduleKey, args.moduleKey)))
        .all()

      if (existing.length === 0) {
        const row = {
          id: randomUUID(),
          principal,
          moduleKey: args.moduleKey,
          programKey: args.programKey ?? null,
          track: args.track ?? null,
          status: 'completed' as const,
          completedAt: now,
          hoursLogged: args.hoursLogged ?? 0,
          updatedAt: now,
        }
        db.insert(trainingProgress).values(row).run()
        return mcpText({ progress: row, toggled: 'completed' })
      }

      const isCompleted = existing[0].status === 'completed'
      const next = isCompleted ? 'not-started' : 'completed'
      db.update(trainingProgress)
        .set({
          status: next,
          completedAt: next === 'completed' ? now : null,
          hoursLogged: args.hoursLogged ?? existing[0].hoursLogged,
          updatedAt: now,
        })
        .where(and(eq(trainingProgress.principal, principal), eq(trainingProgress.moduleKey, args.moduleKey)))
        .run()
      return mcpText({ toggled: next })
    },
  },

  /**
   * @sa-tool delegation-verified
   * @sa-auth delegation-token
   * @sa-rate-limit none
   * @sa-prod-gate always
   * @sa-risk-tier low
   * @sa-owner developer
   */
  get_delegated_training_progress: {
    name: 'get_delegated_training_progress',
    description: 'Read another principal\'s training progress via a cross-principal delegation (e.g., coach reads disciple).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        targetPrincipal: { type: 'string' },
        crossDelegation: {
          type: 'object',
          properties: {
            delegator: { type: 'string' },
            delegate: { type: 'string' },
            authority: { type: 'string' },
            caveats: { type: 'array' },
            salt: { type: 'string' },
            signature: { type: 'string' },
          },
        },
      },
      required: ['token', 'targetPrincipal', 'crossDelegation'],
    },
    handler: async (args: {
      token: string
      targetPrincipal: string
      crossDelegation: {
        delegator: `0x${string}`
        delegate: `0x${string}`
        authority: `0x${string}`
        caveats: Array<{ enforcer: `0x${string}`; terms: `0x${string}` }>
        salt: string
        signature: `0x${string}`
      }
    }) => {
      const callerPrincipal = await requirePrincipal(args.token, 'get_delegated_training_progress')
      const crossResult = await verifyCrossDelegation(args.crossDelegation, callerPrincipal, 'urn:mcp:server:person')
      if ('error' in crossResult) return mcpText({ error: crossResult.error })
      if (args.targetPrincipal.toLowerCase() !== crossResult.dataPrincipal) {
        return mcpText({ error: 'targetPrincipal does not match delegation grantor' })
      }
      const grant = crossResult.grants.find(g => g.resources.includes('training_progress'))
      if (!grant) return mcpText({ error: 'no training_progress grant in delegation' })
      const rows = db.select().from(trainingProgress).where(eq(trainingProgress.principal, crossResult.dataPrincipal)).all()
      return mcpText({ progress: rows, allowedFields: grant.fields })
    },
  },
}
