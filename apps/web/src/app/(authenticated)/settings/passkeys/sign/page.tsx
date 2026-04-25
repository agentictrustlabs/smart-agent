import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { listPasskeysAction } from '@/lib/actions/passkey/list.action'
import { SignDemoClient } from './SignDemoClient'

export const dynamic = 'force-dynamic'

export default async function PasskeySignPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/')
  const status = await listPasskeysAction()

  return (
    <div style={{ maxWidth: 780, margin: '0 auto', padding: '1.5rem', minHeight: '100vh', background: '#f8fafc' }}>
      <div style={{ marginBottom: 12 }}>
        <Link href="/settings/passkeys" style={{ color: '#3f6ee8', fontSize: 13 }}>← Back to passkeys</Link>
      </div>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>Sign a UserOp with your passkey</h1>
      <p style={{ color: '#64748b', margin: '0.25rem 0 1.25rem' }}>
        This button builds a no-op UserOperation (calls <code>execute(self, 0, 0x)</code>
        on your smart account), asks your passkey to sign the <code>userOpHash</code>,
        packs the signature with the <code>0x01</code> WebAuthn type byte, and submits
        via the EntryPoint. If <code>validateUserOp</code> accepts the P-256 signature,
        the tx lands — proving the full native multi-signer path end-to-end.
      </p>
      <section style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '1rem 1.25rem' }}>
        <SignDemoClient
          accountAddress={status.accountAddress}
          accountDeployed={status.accountDeployed}
          passkeys={status.passkeys.map(p => p.credentialIdDigest)}
        />
      </section>
    </div>
  )
}
