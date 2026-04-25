'use client'

import { useRouter } from 'next/navigation'

type PathOption = {
  id: 'passkey-other-device' | 'google' | 'wallet'
  title: string
  blurb: string
  detail: string
  cta: string
  onClick: () => void
}

/**
 * Recovery triage wizard.
 *
 * Three paths corresponding to the three login methods Smart Agent supports:
 *
 *   1. Passkey-on-another-device      — uses WebAuthn hybrid (cross-device QR
 *                                        sign-in). Just points the user at
 *                                        the regular passkey sign-in; modern
 *                                        OSes offer a hybrid prompt when no
 *                                        local credential is available.
 *
 *   2. Google account                 — kicks off Google OAuth with an
 *                                        intent=recover hint. After the
 *                                        callback, the user is sent to the
 *                                        timelocked /recover-device flow
 *                                        regardless of whether the account
 *                                        already has passkeys (the new device
 *                                        won't have one synced).
 *
 *   3. Wallet (MetaMask, …)           — drops the user at SIWE. If the wallet
 *                                        EOA is still an owner of the smart
 *                                        account, they can sign UserOps
 *                                        directly — no further recovery
 *                                        ceremony is needed.
 */
export function RecoverWizardClient() {
  const router = useRouter()

  const paths: PathOption[] = [
    {
      id: 'passkey-other-device',
      title: 'I have a passkey on another device',
      blurb: 'Use cross-device sign-in via QR code.',
      detail:
        'On the sign-in screen, click "Sign in with passkey". When your browser asks for a credential, choose your other device — your phone or laptop will scan a QR code and complete the sign-in remotely. No new ceremony needed.',
      cta: 'Continue to sign-in',
      onClick: () => router.push('/sign-in'),
    },
    {
      id: 'google',
      title: 'I signed up with Google',
      blurb: 'Re-authenticate with Google, then activate this device after a short timelock.',
      detail:
        'We\'ll send you to Google to confirm your email, then to a timelocked recovery page where you can register a fresh passkey on this device. The timelock (configurable, 24h in production) gives you a window to cancel a hostile recovery before it lands.',
      cta: 'Continue with Google',
      onClick: () => { window.location.href = '/api/auth/google-start?intent=recover' },
    },
    {
      id: 'wallet',
      title: 'I have my wallet',
      blurb: 'MetaMask / Rabby / Coinbase Wallet — sign with your connected EOA.',
      detail:
        'On the sign-in screen, click "Sign in with Ethereum". If your wallet\'s EOA is still listed as an owner of your smart account, you\'re back in immediately and can register a fresh passkey from your account settings.',
      cta: 'Continue to sign-in',
      onClick: () => router.push('/sign-in'),
    },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {paths.map((p) => (
        <div
          key={p.id}
          style={{
            border: '1px solid #e2e8f0',
            background: '#fff',
            borderRadius: 12,
            padding: '1rem 1.1rem',
          }}
          data-testid={`recover-path-${p.id}`}
        >
          <h3 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: 4, color: '#0f172a' }}>{p.title}</h3>
          <p style={{ fontSize: 13, color: '#334155', marginBottom: 8 }}>{p.blurb}</p>
          <p style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5, marginBottom: 12 }}>{p.detail}</p>
          <button
            onClick={p.onClick}
            style={{
              padding: '0.55rem 1rem',
              background: '#3f6ee8',
              color: '#fff',
              border: 0,
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {p.cta} →
          </button>
        </div>
      ))}

      <div style={{ marginTop: 16, fontSize: 12, color: '#64748b', textAlign: 'center' }}>
        Need a different path? <a href="/sign-in" style={{ color: '#3f6ee8' }}>Back to sign-in</a>
      </div>
    </div>
  )
}
