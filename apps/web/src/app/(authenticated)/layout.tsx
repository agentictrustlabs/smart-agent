export const dynamic = 'force-dynamic'

import { UserContextProvider } from '@/components/user/UserContext'
import { HubLayout } from '@/components/hub/HubLayout'
import { ReadinessBanner } from '@/components/ReadinessBanner'

/**
 * The onboarding redirect used to live here as a server-side guard, but it
 * caused recurring self-redirect loops: certain RSC requests landed without
 * the `x-pathname` request header (despite middleware injecting it), the
 * guard couldn't tell it was on /onboarding, and fired a redirect back to
 * /onboarding — which is harmless on plain navigation but devolves into a
 * tight loop the moment a downstream effect re-fetches the RSC payload.
 *
 * The redirect now lives on the page itself: /onboarding sends users to
 * /dashboard if they're already onboarded. New non-demo users still
 * arrive at /onboarding via the auth callbacks (Google / passkey-signup
 * etc.), so we don't lose the gate; we just stop fighting Next about
 * which request knows its own path.
 */
export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  return (
    <UserContextProvider>
      <ReadinessBanner />
      <HubLayout>{children}</HubLayout>
    </UserContextProvider>
  )
}
