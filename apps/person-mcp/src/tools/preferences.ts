import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { userPreferences } from '../db/schema.js'
import { requirePrincipal } from '../auth/principal-context.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

export const preferencesTools = {
  /**
   * @sa-tool delegation-verified
   * @sa-auth delegation-token
   * @sa-rate-limit none
   * @sa-prod-gate always
   * @sa-risk-tier low
   * @sa-owner developer
   */
  get_user_preferences: {
    name: 'get_user_preferences',
    description: 'Get the authenticated principal\'s preferences (language, home church, location, theme, notifications).',
    inputSchema: {
      type: 'object' as const,
      properties: { token: { type: 'string' } },
      required: ['token'],
    },
    handler: async (args: { token: string }) => {
      const principal = await requirePrincipal(args.token, 'get_user_preferences')
      const rows = db.select().from(userPreferences).where(eq(userPreferences.principal, principal)).all()
      return mcpText({ preferences: rows[0] ?? null })
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
  update_user_preferences: {
    name: 'update_user_preferences',
    description: 'Create or update the authenticated principal\'s preferences.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        language: { type: 'string' },
        homeChurch: { type: 'string' },
        location: { type: 'string' },
        theme: { type: 'string' },
        notifications: { type: 'string' },
        extras: { type: 'string' },
      },
      required: ['token'],
    },
    handler: async (args: {
      token: string
      language?: string
      homeChurch?: string
      location?: string
      theme?: string
      notifications?: string
      extras?: string
    }) => {
      const principal = await requirePrincipal(args.token, 'update_user_preferences')
      const now = new Date().toISOString()
      const existing = db.select().from(userPreferences).where(eq(userPreferences.principal, principal)).all()

      if (existing.length === 0) {
        const row = {
          principal,
          language: args.language ?? null,
          homeChurch: args.homeChurch ?? null,
          location: args.location ?? null,
          theme: args.theme ?? null,
          notifications: args.notifications ?? null,
          extras: args.extras ?? null,
          updatedAt: now,
        }
        db.insert(userPreferences).values(row).run()
        return mcpText({ preferences: row })
      }

      const updates: Record<string, string | null> = { updatedAt: now }
      if (args.language !== undefined) updates.language = args.language
      if (args.homeChurch !== undefined) updates.homeChurch = args.homeChurch
      if (args.location !== undefined) updates.location = args.location
      if (args.theme !== undefined) updates.theme = args.theme
      if (args.notifications !== undefined) updates.notifications = args.notifications
      if (args.extras !== undefined) updates.extras = args.extras

      db.update(userPreferences).set(updates).where(eq(userPreferences.principal, principal)).run()
      const updated = db.select().from(userPreferences).where(eq(userPreferences.principal, principal)).all()
      return mcpText({ preferences: updated[0] })
    },
  },
}
