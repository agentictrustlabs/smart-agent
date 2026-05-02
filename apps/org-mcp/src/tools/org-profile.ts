import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { orgProfilesPrivate } from '../db/schema.js'
import { requireOrgPrincipal } from '../auth/principal-context.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

export const orgProfileTools = {
  get_org_profile_private: {
    name: 'get_org_profile_private',
    description: 'Get private org profile fields. Public profile fields live on-chain as agent metadata.',
    inputSchema: {
      type: 'object' as const,
      properties: { token: { type: 'string' } },
      required: ['token'],
    },
    handler: async (args: { token: string }) => {
      const orgPrincipal = await requireOrgPrincipal(args.token, 'get_org_profile_private')
      const rows = db.select().from(orgProfilesPrivate).where(eq(orgProfilesPrivate.orgPrincipal, orgPrincipal)).all()
      return mcpText({ profile: rows[0] ?? null })
    },
  },

  update_org_profile_private: {
    name: 'update_org_profile_private',
    description: 'Update private org profile fields (internal contacts, notes). Public fields update via on-chain agent metadata.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        internalContactEmail: { type: 'string' },
        internalContactPhone: { type: 'string' },
        financialContacts: { type: 'string' },
        internalNotes: { type: 'string' },
      },
      required: ['token'],
    },
    handler: async (args: {
      token: string
      internalContactEmail?: string
      internalContactPhone?: string
      financialContacts?: string
      internalNotes?: string
    }) => {
      const orgPrincipal = await requireOrgPrincipal(args.token, 'update_org_profile_private')
      const now = new Date().toISOString()
      const existing = db.select().from(orgProfilesPrivate).where(eq(orgProfilesPrivate.orgPrincipal, orgPrincipal)).all()
      if (existing.length === 0) {
        const row = {
          orgPrincipal,
          internalContactEmail: args.internalContactEmail ?? null,
          internalContactPhone: args.internalContactPhone ?? null,
          financialContacts: args.financialContacts ?? null,
          internalNotes: args.internalNotes ?? null,
          updatedAt: now,
        }
        db.insert(orgProfilesPrivate).values(row).run()
        return mcpText({ profile: row })
      }
      const updates: Record<string, string | null> = { updatedAt: now }
      if (args.internalContactEmail !== undefined) updates.internalContactEmail = args.internalContactEmail
      if (args.internalContactPhone !== undefined) updates.internalContactPhone = args.internalContactPhone
      if (args.financialContacts !== undefined) updates.financialContacts = args.financialContacts
      if (args.internalNotes !== undefined) updates.internalNotes = args.internalNotes
      db.update(orgProfilesPrivate).set(updates).where(eq(orgProfilesPrivate.orgPrincipal, orgPrincipal)).run()
      const updated = db.select().from(orgProfilesPrivate).where(eq(orgProfilesPrivate.orgPrincipal, orgPrincipal)).all()
      return mcpText({ profile: updated[0] })
    },
  },
}
