'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface OnboardingClientProps {
  currentName: string
  currentEmail: string
}

export function OnboardingClient({ currentName, currentEmail }: OnboardingClientProps) {
  const router = useRouter()
  const [step, setStep] = useState<'profile' | 'choose'>('profile')
  const [name, setName] = useState(currentName === 'Agent User' ? '' : currentName)
  const [email, setEmail] = useState(currentEmail)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required'); return }
    if (!email.trim() || !email.includes('@')) { setError('Valid email is required'); return }

    setSaving(true)
    setError('')

    const res = await fetch('/api/auth/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), email: email.trim() }),
    })

    if (res.ok) {
      setStep('choose')
    } else {
      setError('Failed to save profile')
      setSaving(false)
    }
  }

  if (step === 'choose') {
    return (
      <div data-component="onboarding-form" style={{ textAlign: 'center' }}>
        <h2 style={{ marginBottom: '0.5rem' }}>Welcome, {name}!</h2>
        <p style={{ color: '#6b7280', marginBottom: '2rem' }}>What would you like to do?</p>
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => router.push('/setup')} style={{ padding: '1.5rem 2rem', minWidth: 200 }}>
            <strong style={{ display: 'block', marginBottom: '0.25rem' }}>New Organization</strong>
            <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>Set up your organization with AI assistants</span>
          </button>
          <button onClick={() => router.push('/setup/join')} style={{ background: '#e5e7eb', color: '#1a1a2e', padding: '1.5rem 2rem', minWidth: 200 }}>
            <strong style={{ display: 'block', marginBottom: '0.25rem' }}>Join an Organization</strong>
            <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>I have an invitation</span>
          </button>
          <button onClick={() => router.push('/dashboard')} style={{ background: 'transparent', border: '1px solid #e2e4e8', color: '#1a1a2e', padding: '1.5rem 2rem', minWidth: 200 }}>
            <strong style={{ display: 'block', marginBottom: '0.25rem' }}>Explore</strong>
            <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>Browse the platform first</span>
          </button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} data-component="onboarding-form">
      <div data-component="form-field">
        <label htmlFor="name">Display Name</label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Alice Smith"
          required
        />
      </div>

      <div data-component="form-field">
        <label htmlFor="email">Email Address</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="alice@example.com"
          required
        />
      </div>

      {error && <p role="alert" data-component="error-message">{error}</p>}

      <button type="submit" disabled={saving}>
        {saving ? 'Saving...' : 'Continue'}
      </button>
    </form>
  )
}
