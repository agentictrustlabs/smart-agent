import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getUserOrgs } from '@/lib/get-user-orgs'
import { TrustGraphView } from '@/components/graph/TrustGraphView'

export default async function GraphPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')
  const userOrgs = await getUserOrgs(currentUser.id)

  return (
    <div data-page="graph">
      <div data-component="page-header">
        <h1>Trust Graph</h1>
        <p>Interactive view of on-chain agent relationships. Hover nodes to highlight connections.</p>
      </div>
      <TrustGraphView orgAddress={userOrgs[0]?.address} />
    </div>
  )
}
