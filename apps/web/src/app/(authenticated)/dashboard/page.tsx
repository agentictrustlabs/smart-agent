import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getUserHubId } from '@/lib/get-user-hub'
import { hubHomePath } from '@/lib/post-login-redirect'
import { HubDashboard } from '@/components/dashboard/HubDashboard'

/**
 * Universal post-login landing. If the user has a hub membership, we
 * forward them to that hub's URL (/h/{slug}/home) so the address bar
 * always reflects which hub they're in. Users without a hub render the
 * generic dashboard inline (with JoinHubBanner) so they can pick one.
 */
export default async function DashboardPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/')

  const hubId = await getUserHubId(user.id)
  if (hubId !== 'generic') {
    redirect(hubHomePath(hubId))
  }

  return <HubDashboard hubId="generic" currentUser={user} />
}
