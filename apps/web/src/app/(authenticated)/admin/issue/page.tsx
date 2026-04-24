import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { AdminIssueClient } from './AdminIssueClient'

export const dynamic = 'force-dynamic'

export default async function AdminIssuePage() {
  const user = await getCurrentUser()
  if (!user) redirect('/')

  return (
    <div style={{ maxWidth: 780, margin: '0 auto', padding: '1.5rem', minHeight: '100vh', background: '#f8fafc' }}>
      <div style={{ marginBottom: 12 }}>
        <Link href="/wallet" style={{ color: '#3f6ee8', fontSize: 13 }}>← Back to wallet</Link>
      </div>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>Issuer admin (demo)</h1>
      <p style={{ color: '#64748b', margin: '0.25rem 0 1.25rem' }}>
        Issue credentials via org-mcp (Catalyst) and family-mcp (Family Hub) with custom attributes. The direct-issue buttons mint to <strong>your own</strong> wallet — for multi-user demos use the OID4VCI offer URI.
      </p>
      <AdminIssueClient />
    </div>
  )
}
