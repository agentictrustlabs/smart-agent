import Link from 'next/link'
import { SignUpClient } from './SignUpClient'

export const dynamic = 'force-dynamic'

export default function SignUpPage() {
  return (
    <div style={{ maxWidth: 480, margin: '4rem auto', padding: '2rem', minHeight: '100vh' }}>
      <h1 style={{ fontSize: '1.6rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.4rem' }}>
        Create your Smart Agent
      </h1>
      <p style={{ color: '#64748b', marginBottom: '1.5rem', fontSize: 14 }}>
        Sign up with a passkey on this device. Your private key never leaves your hardware.
      </p>

      <SignUpClient />

      <div style={{ marginTop: 24, fontSize: 13 }}>
        Already have an account? <Link href="/sign-in" style={{ color: '#3f6ee8' }}>Sign in</Link>
      </div>
    </div>
  )
}
