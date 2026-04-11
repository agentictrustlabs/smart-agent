import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { JoinOrgClient } from './JoinOrgClient'

export default async function JoinOrgPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  return (
    <div data-page="join-org">
      <JoinOrgClient />
    </div>
  )
}
