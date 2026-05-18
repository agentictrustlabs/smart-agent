import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { crossDelegationGrants } from '../db/schema.js'
import { requirePrincipal } from '../auth/principal-context.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

export const crossDelegationsTools = {
  /**
   * @sa-tool delegation-verified
   * @sa-auth delegation-token
   * @sa-rate-limit none
   * @sa-prod-gate always
   * @sa-risk-tier low
   * @sa-owner developer
   */
  list_cross_delegation_grants: {
    name: 'list_cross_delegation_grants',
    description: 'List active cross-delegation grants issued by the authenticated principal.',
    inputSchema: {
      type: 'object' as const,
      properties: { token: { type: 'string' }, includeRevoked: { type: 'boolean' } },
      required: ['token'],
    },
    handler: async (args: { token: string; includeRevoked?: boolean }) => {
      const principal = await requirePrincipal(args.token, 'list_cross_delegation_grants')
      const rows = db.select().from(crossDelegationGrants).where(eq(crossDelegationGrants.principal, principal)).all()
      const filtered = args.includeRevoked ? rows : rows.filter(r => !r.revokedAt)
      return mcpText({ grants: filtered })
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
  grant_cross_delegation: {
    name: 'grant_cross_delegation',
    description: 'Record a cross-principal delegation grant issued by the authenticated principal.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        granteeAgent: { type: 'string' },
        scope: { type: 'string', description: 'JSON array of {resources, fields}' },
        validFrom: { type: 'string' },
        validUntil: { type: 'string' },
        caveatTerms: { type: 'string' },
      },
      required: ['token', 'granteeAgent', 'scope'],
    },
    handler: async (args: {
      token: string
      granteeAgent: string
      scope: string
      validFrom?: string
      validUntil?: string
      caveatTerms?: string
    }) => {
      const principal = await requirePrincipal(args.token, 'grant_cross_delegation')
      const row = {
        id: randomUUID(),
        principal,
        granteeAgent: args.granteeAgent.toLowerCase(),
        scope: args.scope,
        validFrom: args.validFrom ?? null,
        validUntil: args.validUntil ?? null,
        caveatTerms: args.caveatTerms ?? null,
        createdAt: new Date().toISOString(),
        revokedAt: null,
      }
      db.insert(crossDelegationGrants).values(row).run()
      return mcpText({ grant: row })
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
  revoke_cross_delegation: {
    name: 'revoke_cross_delegation',
    description: 'Revoke a cross-delegation grant by id.',
    inputSchema: {
      type: 'object' as const,
      properties: { token: { type: 'string' }, id: { type: 'string' } },
      required: ['token', 'id'],
    },
    handler: async (args: { token: string; id: string }) => {
      const principal = await requirePrincipal(args.token, 'revoke_cross_delegation')
      const r = db.update(crossDelegationGrants)
        .set({ revokedAt: new Date().toISOString() })
        .where(and(eq(crossDelegationGrants.id, args.id), eq(crossDelegationGrants.principal, principal)))
        .run()
      return mcpText({ revoked: r.changes > 0 })
    },
  },
}
