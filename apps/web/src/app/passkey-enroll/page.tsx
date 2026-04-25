import { PasskeyEnrollClient } from './PasskeyEnrollClient'

export const metadata = { title: 'Add a passkey · Smart Agent' }

export default function PasskeyEnrollPage() {
  return (
    <main style={{ maxWidth: 480, margin: '4rem auto', padding: '0 1rem' }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: 8 }}>Secure your account</h1>
      <p style={{ color: '#475569', fontSize: 14, lineHeight: 1.5, marginBottom: 24 }}>
        Add a passkey on this device. After enrollment, the bootstrap server is removed
        from your smart account&apos;s owner set — your account becomes passkey-only and
        the server can no longer sign on your behalf.
      </p>
      <PasskeyEnrollClient />
    </main>
  )
}
