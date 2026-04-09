import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { OnboardingClient } from './OnboardingClient'

export default async function OnboardingPage() {
  const currentUser = await getCurrentUser()

  // If user has name and email, skip onboarding
  if (currentUser?.name && currentUser.name !== 'Agent User' && currentUser.email) {
    redirect('/dashboard')
  }

  return (
    <div data-page="onboarding">
      <div data-component="page-header">
        <h1>Complete Your Profile</h1>
        <p>Tell us about yourself to get started with Smart Agent</p>
      </div>
      <OnboardingClient
        currentName={currentUser?.name ?? ''}
        currentEmail={currentUser?.email ?? ''}
      />
    </div>
  )
}
