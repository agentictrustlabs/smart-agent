export const dynamic = 'force-dynamic'

import { UserContextProvider } from '@/components/user/UserContext'
import { HubLayout } from '@/components/hub/HubLayout'

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  return (
    <UserContextProvider>
      <HubLayout>{children}</HubLayout>
    </UserContextProvider>
  )
}
