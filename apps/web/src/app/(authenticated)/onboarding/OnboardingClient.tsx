'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface OnboardingClientProps {
  currentName: string
  currentEmail: string
}

export function OnboardingClient({ currentName, currentEmail }: OnboardingClientProps) {
  const router = useRouter()
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
      router.push('/dashboard')
    } else {
      setError('Failed to save profile')
      setSaving(false)
    }
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
