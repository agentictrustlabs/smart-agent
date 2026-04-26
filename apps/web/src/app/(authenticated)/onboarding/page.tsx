import { redirect } from 'next/navigation'

/**
 * The /onboarding wizard route is gone. All onboarding now happens on
 * /h/{slug} via HubOnboardClient, so any landing here (stale link, old
 * bookmark) gets sent to the root hub picker.
 */
export default function LegacyOnboardingRedirect() {
  redirect('/')
}
