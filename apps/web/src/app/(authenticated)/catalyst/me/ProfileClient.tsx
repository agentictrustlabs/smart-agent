'use client'

import { useState, useTransition, useEffect } from 'react'
import Link from 'next/link'
import { saveProfileViaDelegation, loadProfileViaDelegation } from '@/lib/actions/profile.action'
import { useA2ASession } from '@/hooks/use-a2a-session'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

// ─── Types ──────────────────────────────────────────────────────────

interface CoachInfo {
  coachName: string
  sharePermissions: string
}

interface ProfileClientProps {
  userId: string
  userName: string
  email: string | null
  location: string | null
  homeChurch: string | null
  language: string
  coach: CoachInfo | null
}

// ─── Main Component ─────────────────────────────────────────────────

export function ProfileClient({
  userId, userName, email: initialEmail, location: initialLocation,
  homeChurch: initialHomeChurch, language: initialLanguage, coach,
}: ProfileClientProps) {
  const [name, setName] = useState(userName)
  const [email, setEmail] = useState(initialEmail ?? '')
  const [phone, setPhone] = useState('')
  const [language, setLanguage] = useState(initialLanguage)
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [gender, setGender] = useState('')
  const [addressLine1, setAddressLine1] = useState('')
  const [addressLine2, setAddressLine2] = useState('')
  const [city, setCity] = useState('')
  const [stateProvince, setStateProvince] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [country, setCountry] = useState('')
  const [location, setLocation] = useState(initialLocation ?? '')
  const [homeChurch, setHomeChurch] = useState(initialHomeChurch ?? '')

  const [pending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingProfile, setLoadingProfile] = useState(false)
  const a2a = useA2ASession()
  const [sessionValid, setSessionValid] = useState<boolean | null>(null)

  async function loadProfile(token: string | null): Promise<boolean> {
    setLoadingProfile(true)
    try {
      const result = await loadProfileViaDelegation(token)
      if (result.success) {
        if (result.profile) {
          const p = result.profile as Record<string, string | null>
          if (p.displayName) setName(p.displayName)
          if (p.email) setEmail(p.email)
          if (p.phone) setPhone(p.phone)
          if (p.dateOfBirth) setDateOfBirth(p.dateOfBirth)
          if (p.gender) setGender(p.gender)
          if (p.language) setLanguage(p.language)
          if (p.addressLine1) setAddressLine1(p.addressLine1)
          if (p.addressLine2) setAddressLine2(p.addressLine2)
          if (p.city) setCity(p.city)
          if (p.stateProvince) setStateProvince(p.stateProvince)
          if (p.postalCode) setPostalCode(p.postalCode)
          if (p.country) setCountry(p.country)
          if (p.location) setLocation(p.location)
        }
        setSessionValid(true)
        setLoadingProfile(false)
        return true
      }
    } catch { /* load failed */ }
    setSessionValid(false)
    setLoadingProfile(false)
    return false
  }

  useEffect(() => {
    async function init() {
      const token = a2a.sessionToken
      const ok = await loadProfile(token ?? null)
      if (ok) return
      try {
        const res = await fetch('/api/a2a/bootstrap', { method: 'POST' })
        const data = await res.json()
        if (data.success && data.sessionToken) {
          const ok = await loadProfile(data.sessionToken)
          if (ok) return
        }
      } catch { /* server bootstrap not available */ }
      setSessionValid(false)
    }
    init()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleBootstrapSession() {
    setError(null)
    try {
      const res = await fetch('/api/a2a/bootstrap', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        await loadProfile(data.sessionToken ?? null)
        return
      }
    } catch { /* not available */ }
    const token = await a2a.bootstrap()
    if (token) { await loadProfile(token) }
    else if (a2a.error) { setError(a2a.error) }
  }

  function handleSave() {
    setError(null)
    const token = a2a.sessionToken
    startTransition(async () => {
      const result = await saveProfileViaDelegation(token, {
        displayName: name || undefined, email: email || undefined, phone: phone || undefined,
        dateOfBirth: dateOfBirth || undefined, gender: gender || undefined, language: language || undefined,
        addressLine1: addressLine1 || undefined, addressLine2: addressLine2 || undefined,
        city: city || undefined, stateProvince: stateProvince || undefined,
        postalCode: postalCode || undefined, country: country || undefined,
        location: location || undefined, homeChurch: homeChurch || undefined,
      })
      if (!result.success) {
        setError(result.error ?? 'Failed to save')
        return
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    })
  }

  const shareCount = coach?.sharePermissions ? coach.sharePermissions.split(',').filter(Boolean).length : 0

  return (
    <div className="max-w-lg space-y-4">
      {loadingProfile && (
        <div className="bg-secondary-container rounded-sm p-3 text-body-md text-secondary animate-pulse">
          Loading profile from agent...
        </div>
      )}

      {/* Personal Information */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-label-lg text-primary uppercase tracking-wider">Personal Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input label="Full Name" value={name} onChange={e => setName(e.target.value)} />
          <Input label="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com" />
          <Input label="Phone" type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+1 (555) 000-0000" />
          <Input label="Date of Birth" type="date" value={dateOfBirth} onChange={e => setDateOfBirth(e.target.value)} />
          <div className="flex flex-col gap-1">
            <label className="text-label-md text-on-surface-variant">Gender</label>
            <select value={gender} onChange={e => setGender(e.target.value)}
              className="h-10 w-full rounded-xs border border-outline-variant bg-transparent px-3 text-body-md text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-primary transition-all">
              <option value="">Select...</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="non-binary">Non-binary</option>
              <option value="prefer-not-to-say">Prefer not to say</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* Address */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-label-lg text-primary uppercase tracking-wider">Address</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input label="Street Address" value={addressLine1} onChange={e => setAddressLine1(e.target.value)} placeholder="123 Main St" />
          <Input label="Apt / Suite" value={addressLine2} onChange={e => setAddressLine2(e.target.value)} placeholder="Apt 4B" />
          <div className="grid grid-cols-2 gap-3">
            <Input label="City" value={city} onChange={e => setCity(e.target.value)} />
            <Input label="State / Province" value={stateProvince} onChange={e => setStateProvince(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Postal Code" value={postalCode} onChange={e => setPostalCode(e.target.value)} />
            <div className="flex flex-col gap-1">
              <label className="text-label-md text-on-surface-variant">Country</label>
              <select value={country} onChange={e => setCountry(e.target.value)}
                className="h-10 w-full rounded-xs border border-outline-variant bg-transparent px-3 text-body-md text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:border-primary transition-all">
                <option value="">Select...</option>
                {[['US','United States'],['CA','Canada'],['GB','United Kingdom'],['MX','Mexico'],['TG','Togo'],['GH','Ghana'],['NG','Nigeria'],['KE','Kenya'],['BR','Brazil'],['CO','Colombia'],['GT','Guatemala'],['HN','Honduras']].map(([v,l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
          </div>
          <Input label="Location (freeform)" value={location} onChange={e => setLocation(e.target.value)} placeholder="e.g., Northern Colorado" />
        </CardContent>
      </Card>

      {/* Language */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-label-lg text-primary uppercase tracking-wider">Language</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 flex-wrap">
            {[{ value: 'en', label: 'English' }, { value: 'es', label: 'Español' }, { value: 'fr', label: 'Français' }, { value: 'pt', label: 'Português' }].map(lang => (
              <button key={lang.value} onClick={() => setLanguage(lang.value)}
                className={`px-4 py-1.5 rounded-full text-label-lg font-semibold transition-all duration-200 ${
                  language === lang.value
                    ? 'bg-primary text-on-primary'
                    : 'border border-outline-variant text-on-surface-variant hover:bg-surface-variant'
                }`}>
                {lang.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Home Church */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-label-lg text-primary uppercase tracking-wider">Home Church</CardTitle>
        </CardHeader>
        <CardContent>
          <Input value={homeChurch} onChange={e => setHomeChurch(e.target.value)} placeholder="No home church set" />
        </CardContent>
      </Card>

      {/* Coach */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-label-lg text-primary uppercase tracking-wider">Coach</CardTitle>
        </CardHeader>
        <CardContent>
          {coach ? (
            <div className="flex items-center gap-3 p-3 bg-surface rounded-sm border border-outline-variant">
              <div className="w-8 h-8 rounded-full bg-primary text-on-primary flex items-center justify-center font-bold text-label-md flex-shrink-0">
                {coach.coachName.charAt(0).toUpperCase()}
              </div>
              <span className="text-body-md text-on-surface">
                {coach.coachName} &middot; {shareCount} item{shareCount !== 1 ? 's' : ''} shared
              </span>
            </div>
          ) : (
            <p className="text-body-md text-on-surface-variant">No coach assigned</p>
          )}
        </CardContent>
      </Card>

      {/* Session status */}
      {sessionValid === false && (
        <div className="bg-secondary-container/50 border border-secondary/20 rounded-sm p-4">
          <p className="text-label-lg text-secondary font-semibold mb-1">Agent session required</p>
          <p className="text-body-sm text-on-surface-variant mb-3">Your personal data is stored securely through an authenticated delegation chain.</p>
          <Button onClick={handleBootstrapSession} disabled={a2a.bootstrapping} variant="filled" size="sm">
            {a2a.bootstrapping ? 'Connecting...' : 'Connect Agent Session'}
          </Button>
        </div>
      )}

      {sessionValid === true && (
        <div className="bg-[#e8f5e9] border border-[#a5d6a7] rounded-sm p-3 text-body-sm text-[#2e7d32]">
          Agent session active — data saved securely via delegation chain.
        </div>
      )}

      {/* Error */}
      {(error || a2a.error) && (
        <div className="bg-error-container border border-error/20 rounded-sm p-3 text-body-md text-error">
          <strong>{error ? 'Save failed:' : 'Session error:'}</strong> {error || a2a.error}
        </div>
      )}

      {/* Save */}
      <Button onClick={handleSave} disabled={pending} size="lg" className="w-full">
        {saved ? (
          <span className="flex items-center gap-2">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" fill="currentColor"/></svg>
            Saved!
          </span>
        ) : pending ? (
          <span className="flex items-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
            Saving...
          </span>
        ) : 'Save Profile'}
      </Button>

      <Link href="/catalyst/me/sharing" className="block text-center text-label-lg text-primary font-semibold no-underline hover:text-primary/80 transition-colors">
        Manage Data Sharing →
      </Link>
    </div>
  )
}
