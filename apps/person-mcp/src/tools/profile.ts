import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { profiles } from '../db/schema.js'
import { requirePrincipal } from '../auth/principal-context.js'

/**
 * Profile fields that can be read/written via MCP tools.
 * ALL access requires a valid delegation token — the principal
 * is extracted from the verified delegation chain, never from input.
 */
interface ProfileUpdate {
  displayName?: string
  bio?: string
  avatarUrl?: string
  email?: string
  phone?: string
  dateOfBirth?: string
  gender?: string
  language?: string
  addressLine1?: string
  addressLine2?: string
  city?: string
  stateProvince?: string
  postalCode?: string
  country?: string
  location?: string
  preferences?: string
}

export const profileTools = {
  get_profile: {
    name: 'get_profile',
    description: 'Get the full profile (including PII) for the authenticated principal. Requires a valid delegation token.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string', description: 'Delegation token from A2A agent' },
      },
      required: ['token'],
    },
    handler: async (args: { token: string }) => {
      const principal = await requirePrincipal(args.token, 'update_profile')

      const rows = db
        .select()
        .from(profiles)
        .where(eq(profiles.principal, principal))
        .all()

      if (rows.length === 0) {
        return { content: [{ type: 'text' as const, text: JSON.stringify({ profile: null }) }] }
      }

      return { content: [{ type: 'text' as const, text: JSON.stringify({ profile: rows[0] }) }] }
    },
  },

  update_profile: {
    name: 'update_profile',
    description: 'Create or update the profile for the authenticated principal. Only fields provided will be updated. Requires a valid delegation token.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string', description: 'Delegation token from A2A agent' },
        displayName: { type: 'string', description: 'Display name' },
        bio: { type: 'string', description: 'Short biography' },
        avatarUrl: { type: 'string', description: 'Avatar image URL' },
        email: { type: 'string', description: 'Email address' },
        phone: { type: 'string', description: 'Phone number' },
        dateOfBirth: { type: 'string', description: 'Date of birth (YYYY-MM-DD)' },
        gender: { type: 'string', description: 'Gender (male, female, non-binary, prefer-not-to-say)' },
        language: { type: 'string', description: 'Preferred language (ISO 639-1: en, es, fr, etc.)' },
        addressLine1: { type: 'string', description: 'Street address line 1' },
        addressLine2: { type: 'string', description: 'Street address line 2' },
        city: { type: 'string', description: 'City' },
        stateProvince: { type: 'string', description: 'State or province' },
        postalCode: { type: 'string', description: 'Postal/ZIP code' },
        country: { type: 'string', description: 'Country (ISO 3166-1 alpha-2: US, GB, TG, etc.)' },
        location: { type: 'string', description: 'Freeform location description' },
        preferences: { type: 'string', description: 'JSON string of app preferences' },
      },
      required: ['token'],
    },
    handler: async (args: { token: string } & ProfileUpdate) => {
      const principal = await requirePrincipal(args.token, 'update_profile')
      const now = new Date().toISOString()

      const existing = db
        .select()
        .from(profiles)
        .where(eq(profiles.principal, principal))
        .all()

      if (existing.length === 0) {
        const newProfile = {
          id: randomUUID(),
          principal,
          displayName: args.displayName ?? null,
          bio: args.bio ?? null,
          avatarUrl: args.avatarUrl ?? null,
          email: args.email ?? null,
          phone: args.phone ?? null,
          dateOfBirth: args.dateOfBirth ?? null,
          gender: args.gender ?? null,
          language: args.language ?? null,
          addressLine1: args.addressLine1 ?? null,
          addressLine2: args.addressLine2 ?? null,
          city: args.city ?? null,
          stateProvince: args.stateProvince ?? null,
          postalCode: args.postalCode ?? null,
          country: args.country ?? null,
          location: args.location ?? null,
          preferences: args.preferences ?? null,
          createdAt: now,
          updatedAt: now,
        }
        db.insert(profiles).values(newProfile).run()
        return { content: [{ type: 'text' as const, text: JSON.stringify({ profile: newProfile }) }] }
      }

      const updates: Record<string, string | null> = { updatedAt: now }
      if (args.displayName !== undefined) updates.displayName = args.displayName
      if (args.bio !== undefined) updates.bio = args.bio
      if (args.avatarUrl !== undefined) updates.avatarUrl = args.avatarUrl
      if (args.email !== undefined) updates.email = args.email
      if (args.phone !== undefined) updates.phone = args.phone
      if (args.dateOfBirth !== undefined) updates.dateOfBirth = args.dateOfBirth
      if (args.gender !== undefined) updates.gender = args.gender
      if (args.language !== undefined) updates.language = args.language
      if (args.addressLine1 !== undefined) updates.addressLine1 = args.addressLine1
      if (args.addressLine2 !== undefined) updates.addressLine2 = args.addressLine2
      if (args.city !== undefined) updates.city = args.city
      if (args.stateProvince !== undefined) updates.stateProvince = args.stateProvince
      if (args.postalCode !== undefined) updates.postalCode = args.postalCode
      if (args.country !== undefined) updates.country = args.country
      if (args.location !== undefined) updates.location = args.location
      if (args.preferences !== undefined) updates.preferences = args.preferences

      db.update(profiles)
        .set(updates)
        .where(eq(profiles.principal, principal))
        .run()

      const updated = db
        .select()
        .from(profiles)
        .where(eq(profiles.principal, principal))
        .all()

      return { content: [{ type: 'text' as const, text: JSON.stringify({ profile: updated[0] }) }] }
    },
  },
}
