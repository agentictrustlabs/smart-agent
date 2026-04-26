import { getUserHubId } from '@/lib/get-user-hub'
import { HUB_SLUG_REVERSE } from '@/lib/hub-routes'
import type { HubId } from '@/lib/hub-profiles'

/**
 * Resolve the canonical home URL for a user.
 *
 * - User has a hub membership → /h/{slug}/home (e.g. /h/catalyst/home)
 * - User has no hub → /dashboard (generic landing with JoinHubBanner)
 *
 * This is the single source of truth for "where does this user go after
 * login / when /dashboard is hit / when they navigate Home." Hard-coding
 * `/catalyst` as a destination is a bug — that URL is reserved for users
 * actually in the Catalyst hub now.
 */
export async function resolveUserHomePath(userId: string): Promise<string> {
  const hubId = await getUserHubId(userId)
  return hubHomePath(hubId)
}

export function hubHomePath(hubId: HubId): string {
  if (hubId === 'generic') return '/dashboard'
  const slug = HUB_SLUG_REVERSE[hubId]
  if (!slug) return '/dashboard'
  return `/h/${slug}/home`
}
