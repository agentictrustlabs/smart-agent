import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getOnboardingStatus } from '@/lib/actions/onboarding/setup-agent.action'
import { listHubsForOnboarding } from '@/lib/actions/onboarding/setup-agent.action'
import { OnboardingClient } from './OnboardingClient'

export default async function OnboardingPage() {
  const currentUser = await getCurrentUser()
  const status = await getOnboardingStatus()

  // Demo users keep the old short flow — they're always fully provisioned.
  if (status.via === 'demo') {
    if (currentUser?.name && currentUser.name !== 'Agent User' && currentUser.email) {
      redirect('/dashboard')
    }
  } else if (status.onboardedAt) {
    // Wizard already finished end-to-end — trust the DB flag.
    redirect('/dashboard')
  }

  // Pre-fetch hubs server-side so the name step can render without a flash.
  const hubs = (status.profileComplete && status.agentRegistered && !status.hasAgentName)
    ? await listHubsForOnboarding()
    : []

  return (
    <div className="max-w-lg mx-auto py-12 px-6">
      <div className="text-center mb-8">
        <div className="w-14 h-14 rounded-full bg-primary-container flex items-center justify-center mx-auto mb-4">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-primary">
            <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" fill="currentColor"/>
          </svg>
        </div>
        <h1 className="text-headline-md font-bold text-on-surface mb-2">Welcome to Smart Agent</h1>
        <p className="text-body-lg text-on-surface-variant">A few quick steps to get your agent set up.</p>
      </div>
      <OnboardingClient
        initialStatus={status}
        currentName={currentUser?.name ?? ''}
        currentEmail={currentUser?.email ?? ''}
        hubs={hubs}
      />
    </div>
  )
}
