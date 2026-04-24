import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { walletStatusAction } from '@/lib/actions/ssi/list.action'
import { AdminIssueClient } from './AdminIssueClient'

export const dynamic = 'force-dynamic'

interface SearchParams { context?: string }

export default async function AdminIssuePage(props: {
  searchParams: Promise<SearchParams>
}) {
  const user = await getCurrentUser()
  if (!user) redirect('/')
  const sp = await props.searchParams

  // Pull the user's wallet contexts so the admin page can target the right one.
  const status = await walletStatusAction({ walletContext: sp.context })
  const activeContext = sp.context ?? status.activeContext
  const availableContexts = Array.from(new Set([
    ...status.wallets.map(w => w.walletContext),
    activeContext,
    'default',
  ]))

  return (
    <div style={{ maxWidth: 780, margin: '0 auto', padding: '1.5rem', minHeight: '100vh', background: '#f8fafc' }}>
      <div style={{ marginBottom: 12 }}>
        <Link href="/wallet" style={{ color: '#3f6ee8', fontSize: 13 }}>← Back to wallet</Link>
      </div>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>Issuer admin (demo)</h1>
      <p style={{ color: '#64748b', margin: '0.25rem 0 1.25rem' }}>
        Issue credentials via org-mcp (Catalyst) and family-mcp (Family Hub) with custom attributes.
        The direct-issue buttons mint to the <strong>selected context</strong> of <strong>your own</strong> wallet —
        for multi-user demos, use the OID4VCI offer URI below.
      </p>
      <AdminIssueClient
        availableContexts={availableContexts}
        activeContext={activeContext}
      />
    </div>
  )
}
