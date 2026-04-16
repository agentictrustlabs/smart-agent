import { randomUUID } from 'node:crypto'
import { eq, and } from 'drizzle-orm'
import { db } from '../db/index.js'
import { externalIdentities } from '../db/schema.js'
import { requirePrincipal } from '../auth/principal-context.js'

export const identityTools = {
  add_external_identity: {
    name: 'add_external_identity',
    description: 'Add an external identity (e.g. email, social account) for the authenticated principal.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string', description: 'Delegation token' },
        provider: { type: 'string', description: 'Identity provider (e.g. email, github, twitter)' },
        identifier: { type: 'string', description: 'Identifier at the provider (e.g. email address, username)' },
      },
      required: ['token', 'provider', 'identifier'],
    },
    handler: async (args: { token: string; provider: string; identifier: string }) => {
      const principal = await requirePrincipal(args.token, 'add_external_identity')
      const now = new Date().toISOString()

      const newIdentity = {
        id: randomUUID(),
        principal,
        provider: args.provider,
        identifier: args.identifier,
        verified: 0,
        metadata: null,
        createdAt: now,
      }

      db.insert(externalIdentities).values(newIdentity).run()

      return { content: [{ type: 'text' as const, text: JSON.stringify({ identity: newIdentity }) }] }
    },
  },

  list_external_identities: {
    name: 'list_external_identities',
    description: 'List all external identities for the authenticated principal.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string', description: 'Delegation token' },
      },
      required: ['token'],
    },
    handler: async (args: { token: string }) => {
      const principal = await requirePrincipal(args.token, 'list_external_identities')

      const rows = db
        .select()
        .from(externalIdentities)
        .where(eq(externalIdentities.principal, principal))
        .all()

      return { content: [{ type: 'text' as const, text: JSON.stringify({ identities: rows }) }] }
    },
  },

  remove_external_identity: {
    name: 'remove_external_identity',
    description: 'Remove an external identity by ID (only if owned by the authenticated principal).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string', description: 'Delegation token' },
        id: { type: 'string', description: 'Identity ID to remove' },
      },
      required: ['token', 'id'],
    },
    handler: async (args: { token: string; id: string }) => {
      const principal = await requirePrincipal(args.token, 'remove_external_identity')

      const result = db
        .delete(externalIdentities)
        .where(
          and(
            eq(externalIdentities.id, args.id),
            eq(externalIdentities.principal, principal),
          ),
        )
        .run()

      const deleted = result.changes > 0

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              deleted,
              message: deleted ? 'Identity removed' : 'Identity not found or not owned by principal',
            }),
          },
        ],
      }
    },
  },
}
