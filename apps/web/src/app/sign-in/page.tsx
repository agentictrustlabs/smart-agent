import Link from 'next/link'
import { SignInClient } from './SignInClient'
import { DemoLoginPicker } from '@/components/auth/DemoLoginPicker'

export const dynamic = 'force-dynamic'

export default function SignInPage() {
  return (
    <div style={{ maxWidth: 720, margin: '3rem auto', padding: '2rem' }}>
      <h1 style={{ fontSize: '1.6rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.4rem' }}>
        Sign in
      </h1>
      <p style={{ color: '#64748b', marginBottom: '1.5rem', fontSize: 14 }}>
        Use your passkey, your existing wallet, or pick a demo user below.
      </p>

      <section style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '1.25rem', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 12 }}>Passkey</h2>
        <SignInClient />
        <div style={{ marginTop: 12, fontSize: 13 }}>
          New here? <Link href="/sign-up" style={{ color: '#3f6ee8' }}>Create an account</Link>
        </div>
      </section>

      <section id="demo-login-picker" style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '1.25rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 12 }}>Demo users</h2>
        <DemoLoginPicker />
      </section>
    </div>
  )
}
