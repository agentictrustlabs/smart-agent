export const dynamic = 'force-dynamic'

import { UserContextProvider } from '@/components/user/UserContext'
import { HubLayout } from '@/components/hub/HubLayout'

export default function HubAuthenticatedLayout({ children }: { children: React.ReactNode }) {
  return (
    <UserContextProvider>
      <HubLayout>{children}</HubLayout>
    </UserContextProvider>
  )
}
