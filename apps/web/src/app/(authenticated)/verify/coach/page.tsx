import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { walletStatusAction } from '@/lib/actions/ssi/list.action'
import { CoachClient } from './CoachClient'

export const dynamic = 'force-dynamic'

export default async function CoachVerifyPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/')

  const status = await walletStatusAction()
  const guardianCreds = status.credentials
    .filter(c => c.credentialType === 'GuardianOfMinorCredential' && c.status === 'active')
    .map(c => ({
      id:            c.id,
      issuerId:      c.issuerId,
      receivedAt:    c.receivedAt,
      walletContext: c.walletContext,
    }))

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '1.5rem', minHeight: '100vh', background: '#f8fafc' }}>
      <div style={{ marginBottom: 12 }}>
        <Link href="/wallet" style={{ color: '#3f6ee8', fontSize: 13 }}>← Back to wallet</Link>
      </div>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>
        Coach verifier (demo)
      </h1>
      <p style={{ color: '#64748b', margin: '0.25rem 0 1.25rem' }}>
        The coach is asking: &ldquo;Are you the guardian of a minor?&rdquo; — without learning anything else about you.
      </p>

      <section style={{
        background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12,
        padding: '1rem 1.25rem',
      }}>
        <CoachClient guardianCreds={guardianCreds} />
      </section>
    </div>
  )
}
