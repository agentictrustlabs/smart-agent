export const dynamic = 'force-dynamic'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { UserContextProvider } from '@/components/user/UserContext'
import { HubLayout } from '@/components/hub/HubLayout'
import { ReadinessBanner } from '@/components/ReadinessBanner'
import { getOnboardingStatus } from '@/lib/actions/onboarding/setup-agent.action'

/**
 * Onboarding guard — every connected non-demo user must have:
 *   - a real display name (not the 'Agent User' placeholder)
 *   - their smart account in AgentAccountResolver
 *   - a .agent primary name
 *
 * If any of those is missing, send them through /onboarding. Demo users skip
 * the guard (their accounts are seeded). The guard explicitly opts /onboarding
 * out of the redirect, so the wizard itself is reachable.
 */
async function onboardingGuard() {
  const pathname = (await headers()).get('x-pathname') ?? ''
  if (pathname.startsWith('/onboarding')) return

  const status = await getOnboardingStatus()
  if (!status.authenticated) return // unauth flows handled by middleware
  if (status.via === 'demo') return // seeded users; nothing to do

  // Once the wizard sets onboarded_at, trust the DB flag. On-chain writes can
  // legitimately fail for accounts already past Phase 2; the wizard records
  // attempted-and-acknowledged in the DB so the guard doesn't loop.
  if (status.onboardedAt) return

  if (!status.profileComplete || !status.agentRegistered || !status.hasAgentName) {
    redirect('/onboarding')
  }
}

export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  await onboardingGuard()

  return (
    <UserContextProvider>
      <ReadinessBanner />
      <HubLayout>{children}</HubLayout>
    </UserContextProvider>
  )
}
