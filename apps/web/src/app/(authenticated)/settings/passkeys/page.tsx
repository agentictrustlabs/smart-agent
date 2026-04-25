import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { listPasskeysAction } from '@/lib/actions/passkey/list.action'
import { PasskeysClient } from './PasskeysClient'

export const dynamic = 'force-dynamic'

export default async function PasskeysPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/')
  const status = await listPasskeysAction()

  return (
    <div style={{ maxWidth: 780, margin: '0 auto', padding: '1.5rem', minHeight: '100vh', background: '#f8fafc' }}>
      <div style={{ marginBottom: 12 }}>
        <Link href="/settings" style={{ color: '#3f6ee8', fontSize: 13 }}>← Back to settings</Link>
      </div>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>Passkeys (WebAuthn)</h1>
      <p style={{ color: '#64748b', margin: '0.25rem 0 1.25rem' }}>
        Register a device passkey (Touch ID, Face ID, Windows Hello, security key) as a
        signer on your agent smart account. Your passkey signs ERC-4337 UserOps via
        RIP-7212 P-256 verification on-chain — your private key never leaves the device.
      </p>

      <section style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '1rem 1.25rem' }}>
        <div style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>
          Account:{' '}
          <code style={{ fontSize: 12 }}>{status.accountAddress ?? '—'}</code>
          {status.accountDeployed ? null : (
            <span style={{ color: '#b91c1c', marginLeft: 8 }}>(not deployed yet)</span>
          )}
        </div>
        <PasskeysClient initial={status} />
      </section>
    </div>
  )
}
