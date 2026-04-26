import { redirect, notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { HUB_SLUG_MAP } from '@/lib/hub-routes'
import { getUserHubId } from '@/lib/get-user-hub'
import { hubHomePath } from '@/lib/post-login-redirect'
import { listHubsForOnboarding } from '@/lib/actions/onboarding/setup-agent.action'
import { HubDashboard } from '@/components/dashboard/HubDashboard'

/**
 * /h/{slug}/home — canonical hub home.
 *
 * The URL slug is the source of truth for which hub view to render. We
 * verify the user is actually a member of this hub (via getUserHubId);
 * mismatches redirect to the user's own home. This means /h/catalyst/home
 * is reserved for catalyst members — no more catalyst-styled pages
 * leaking to users who belong to CIL or have no hub yet.
 */
export default async function HubHomePage({ params }: { params: Promise<{ hubId: string }> }) {
  const { hubId } = await params
  const internalHubId = HUB_SLUG_MAP[hubId]
  if (!internalHubId) notFound()

  const user = await getCurrentUser()
  if (!user) redirect('/')

  const userHubId = await getUserHubId(user.id)
  if (userHubId !== internalHubId) {
    redirect(hubHomePath(userHubId))
  }

  // Resolve the hub's on-chain address so the dashboard can scope hub-aware
  // surfaces (e.g. "Create organization in {hub}").
  const hubs = await listHubsForOnboarding().catch(() => [])
  const matchedHub = hubs.find(h => slugMatches(h, internalHubId))

  return (
    <HubDashboard
      hubId={internalHubId}
      currentUser={user}
      hubAddress={matchedHub?.address ?? null}
      hubName={matchedHub?.displayName ?? ''}
    />
  )
}

function slugMatches(
  hub: { displayName: string; primaryName: string },
  hubId: 'catalyst' | 'cil' | 'global-church' | 'generic',
): boolean {
  const hay = `${hub.displayName} ${hub.primaryName}`.toLowerCase()
  if (hubId === 'catalyst') return hay.includes('catalyst')
  if (hubId === 'global-church') return hay.includes('global') && hay.includes('church')
  if (hubId === 'cil') return hay.includes('mission') || hay.includes('collective') || hay.includes('cil')
  return false
}
