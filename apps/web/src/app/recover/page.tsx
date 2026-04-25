import { RecoverWizardClient } from './RecoverWizardClient'

export const metadata = { title: 'Recover access · Smart Agent' }

export default function RecoverPage() {
  return (
    <main style={{ maxWidth: 560, margin: '4rem auto', padding: '0 1rem' }}>
      <h1 style={{ fontSize: '1.6rem', marginBottom: 8 }}>Recover access</h1>
      <p style={{ color: '#475569', fontSize: 14, lineHeight: 1.55, marginBottom: 24 }}>
        Pick the option that matches what you still have access to. Smart Agent never
        custodies your keys — every recovery path is gated either by an existing
        passkey or wallet, or by your verified social account plus a timelocked
        guardian delegation.
      </p>
      <RecoverWizardClient />
    </main>
  )
}
