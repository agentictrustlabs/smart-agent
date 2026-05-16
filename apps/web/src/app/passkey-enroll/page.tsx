import { PasskeyEnrollClient } from './PasskeyEnrollClient'

export const metadata = { title: 'Add device sign-in · Smart Agent' }

export default function PasskeyEnrollPage() {
  return (
    <main style={{ maxWidth: 480, margin: '4rem auto', padding: '0 1rem' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: 8, color: '#1e293b' }}>
        Sign in with your device
      </h1>
      <p style={{ color: '#475569', fontSize: 14, lineHeight: 1.6, marginBottom: 8 }}>
        Add a passkey to this device. After you do, only your device can sign you in — no passwords needed.
      </p>
      <details style={{ marginBottom: 24 }}>
        <summary
          style={{
            fontSize: 13,
            color: '#64748b',
            cursor: 'pointer',
            userSelect: 'none',
            listStyle: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <span style={{ fontSize: 10, color: '#94a3b8' }}>{'▶'}</span>
          Behind the scenes
        </summary>
        <div
          style={{
            marginTop: 8,
            padding: '0.75rem 1rem',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            fontSize: 12,
            color: '#64748b',
            lineHeight: 1.6,
          }}
        >
          Your passkey creates a unique cryptographic key pair stored on your device. The public key is registered with your agent account (an ERC-4337 smart contract). Once this step completes, the temporary setup server is removed from your account — only your device can sign actions on your behalf.
        </div>
      </details>
      <PasskeyEnrollClient />
    </main>
  )
}
