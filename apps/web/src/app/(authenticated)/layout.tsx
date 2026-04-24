export const dynamic = 'force-dynamic'

import { UserContextProvider } from '@/components/user/UserContext'
import { HubLayout } from '@/components/hub/HubLayout'
import { ReadinessBanner } from '@/components/ReadinessBanner'

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  return (
    <UserContextProvider>
      <ReadinessBanner />
      <HubLayout>{children}</HubLayout>
    </UserContextProvider>
  )
}
