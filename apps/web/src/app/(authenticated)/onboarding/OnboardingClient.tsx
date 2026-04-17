'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'

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
      <div className="text-center animate-fade-in">
        <div className="w-12 h-12 rounded-full bg-[#e8f5e9] flex items-center justify-center mx-auto mb-4">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" fill="#2e7d32"/></svg>
        </div>
        <h2 className="text-headline-sm font-bold text-on-surface mb-1">Welcome, {name}!</h2>
        <p className="text-body-lg text-on-surface-variant mb-8">What would you like to do?</p>

        <div className="grid gap-3">
          <Card className="cursor-pointer hover:shadow-elevation-2 transition-all active:scale-[0.99]" onClick={() => router.push('/setup')}>
            <CardContent className="p-5">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-md bg-primary-container flex items-center justify-center flex-shrink-0">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" className="fill-primary"/></svg>
                </div>
                <div className="text-left">
                  <div className="text-title-md font-semibold text-on-surface">New Organization</div>
                  <div className="text-body-sm text-on-surface-variant">Set up your organization with AI assistants</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:shadow-elevation-2 transition-all active:scale-[0.99]" onClick={() => router.push('/setup/join')}>
            <CardContent className="p-5">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-md bg-secondary-container flex items-center justify-center flex-shrink-0">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" className="fill-secondary"/></svg>
                </div>
                <div className="text-left">
                  <div className="text-title-md font-semibold text-on-surface">Join an Organization</div>
                  <div className="text-body-sm text-on-surface-variant">I have an invitation</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:shadow-elevation-2 transition-all active:scale-[0.99]" onClick={() => router.push('/dashboard')}>
            <CardContent className="p-5">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-md bg-surface-variant flex items-center justify-center flex-shrink-0">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" className="fill-on-surface-variant"/></svg>
                </div>
                <div className="text-left">
                  <div className="text-title-md font-semibold text-on-surface">Explore</div>
                  <div className="text-body-sm text-on-surface-variant">Browse the platform first</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <Card className="animate-fade-in">
      <CardContent className="p-6">
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-full bg-primary text-on-primary flex items-center justify-center text-label-lg font-bold">1</div>
            <div className="h-0.5 flex-1 bg-outline-variant" />
            <div className="w-8 h-8 rounded-full bg-surface-variant text-on-surface-variant flex items-center justify-center text-label-lg">2</div>
          </div>

          <Input
            label="Display Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Alice Smith"
            required
            error={error && !name.trim() ? 'Name is required' : undefined}
          />

          <Input
            label="Email Address"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="alice@example.com"
            required
            error={error && (!email.trim() || !email.includes('@')) ? 'Valid email is required' : undefined}
          />

          {error && error !== 'Name is required' && error !== 'Valid email is required' && (
            <div className="rounded-sm bg-error-container p-3 text-body-md text-error" role="alert">
              {error}
            </div>
          )}

          <Button type="submit" disabled={saving} size="lg" className="w-full">
            {saving ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                Saving...
              </span>
            ) : 'Continue'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
