'use client'

import { useState, useTransition, useEffect } from 'react'
import { saveProfileViaDelegation, loadProfileViaDelegation } from '@/lib/actions/profile.action'

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

// ─── Colors ─────────────────────────────────────────────────────────

const C = {
  bg: '#faf8f3',
  card: '#ffffff',
  accent: '#8b5e3c',
  accentLight: 'rgba(139,94,60,0.10)',
  accentBorder: 'rgba(139,94,60,0.20)',
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  border: '#ece6db',
}

function SectionHeader({ label }: { label: string }) {
  return (
    <h3 style={{
      fontSize: '0.68rem', fontWeight: 700, color: C.accent,
      textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 0.5rem',
    }}>
      {label}
    </h3>
  )
}

function Field({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string
}) {
  return (
    <div style={{ marginBottom: '0.6rem' }}>
      <label style={{ fontSize: '0.72rem', fontWeight: 600, color: C.textMuted, display: 'block', marginBottom: '0.2rem' }}>
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%', padding: '0.45rem 0.6rem',
          border: `1px solid ${C.border}`, borderRadius: 6,
          fontSize: '0.85rem', color: C.text, background: C.bg,
          outline: 'none', boxSizing: 'border-box',
        }}
      />
    </div>
  )
}

function SelectField({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <div style={{ marginBottom: '0.6rem' }}>
      <label style={{ fontSize: '0.72rem', fontWeight: 600, color: C.textMuted, display: 'block', marginBottom: '0.2rem' }}>
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '100%', padding: '0.45rem 0.6rem',
          border: `1px solid ${C.border}`, borderRadius: 6,
          fontSize: '0.85rem', color: C.text, background: C.bg,
          outline: 'none', boxSizing: 'border-box',
        }}
      >
        <option value="">Select...</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

// ─── Main Component ─────────────────────────────────────────────────

export function ProfileClient({
  userId,
  userName,
  email: initialEmail,
  location: initialLocation,
  homeChurch: initialHomeChurch,
  language: initialLanguage,
  coach,
}: ProfileClientProps) {
  // Basic info
  const [name, setName] = useState(userName)
  const [email, setEmail] = useState(initialEmail ?? '')
  const [phone, setPhone] = useState('')
  const [language, setLanguage] = useState(initialLanguage)

  // Personal
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [gender, setGender] = useState('')

  // Address
  const [addressLine1, setAddressLine1] = useState('')
  const [addressLine2, setAddressLine2] = useState('')
  const [city, setCity] = useState('')
  const [stateProvince, setStateProvince] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [country, setCountry] = useState('')
  const [location, setLocation] = useState(initialLocation ?? '')

  // Church
  const [homeChurch, setHomeChurch] = useState(initialHomeChurch ?? '')

  const [pending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [bootstrapping, setBootstrapping] = useState(false)
  const [loadingProfile, setLoadingProfile] = useState(false)

  // Load existing profile from MCP via delegation chain on mount
  useEffect(() => {
    const token = getA2AToken()
    if (!token) return

    setLoadingProfile(true)
    loadProfileViaDelegation(token).then((result) => {
      if (result.success && result.profile) {
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
      setLoadingProfile(false)
    }).catch(() => setLoadingProfile(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Read A2A session token from cookie
  function getA2AToken(): string | null {
    if (typeof document === 'undefined') return null
    const match = document.cookie.match(/(?:^|;\s*)a2a-session=([^;]*)/)
    return match ? decodeURIComponent(match[1]) : null
  }

  async function handleBootstrapSession() {
    setBootstrapping(true)
    setError(null)
    try {
      const res = await fetch('/api/a2a/bootstrap', { method: 'POST' })
      const data = await res.json()
      if (!data.success) {
        setError(`Agent session failed: ${data.error}`)
      }
    } catch (e) {
      setError('Failed to connect agent session')
    }
    setBootstrapping(false)
  }

  function handleSave() {
    setError(null)
    const token = getA2AToken()
    startTransition(async () => {
      const result = await saveProfileViaDelegation(token, {
        displayName: name || undefined,
        email: email || undefined,
        phone: phone || undefined,
        dateOfBirth: dateOfBirth || undefined,
        gender: gender || undefined,
        language: language || undefined,
        addressLine1: addressLine1 || undefined,
        addressLine2: addressLine2 || undefined,
        city: city || undefined,
        stateProvince: stateProvince || undefined,
        postalCode: postalCode || undefined,
        country: country || undefined,
        location: location || undefined,
        homeChurch: homeChurch || undefined,
      })

      if (!result.success) {
        setError(result.error ?? 'Failed to save profile through delegation chain')
        return
      }

      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    })
  }

  const shareCount = coach?.sharePermissions
    ? coach.sharePermissions.split(',').filter(Boolean).length
    : 0

  return (
    <div style={{ maxWidth: 480 }}>
      {loadingProfile && (
        <div style={{
          background: '#e3f2fd', border: '1px solid #90caf9', borderRadius: 8,
          padding: '0.5rem 0.8rem', marginBottom: '0.75rem',
          fontSize: '0.78rem', color: '#1565c0',
        }}>
          Loading profile from agent...
        </div>
      )}

      {/* PERSONAL INFORMATION */}
      <div style={{
        background: C.card, border: `1px solid ${C.border}`,
        borderRadius: 10, padding: '1rem', marginBottom: '0.75rem',
      }}>
        <SectionHeader label="Personal Information" />
        <Field label="Full Name" value={name} onChange={setName} />
        <Field label="Email" value={email} onChange={setEmail} type="email" placeholder="your@email.com" />
        <Field label="Phone" value={phone} onChange={setPhone} type="tel" placeholder="+1 (555) 000-0000" />
        <Field label="Date of Birth" value={dateOfBirth} onChange={setDateOfBirth} type="date" />
        <SelectField label="Gender" value={gender} onChange={setGender} options={[
          { value: 'male', label: 'Male' },
          { value: 'female', label: 'Female' },
          { value: 'non-binary', label: 'Non-binary' },
          { value: 'prefer-not-to-say', label: 'Prefer not to say' },
        ]} />
      </div>

      {/* ADDRESS */}
      <div style={{
        background: C.card, border: `1px solid ${C.border}`,
        borderRadius: 10, padding: '1rem', marginBottom: '0.75rem',
      }}>
        <SectionHeader label="Address" />
        <Field label="Street Address" value={addressLine1} onChange={setAddressLine1} placeholder="123 Main St" />
        <Field label="Apt / Suite / Unit" value={addressLine2} onChange={setAddressLine2} placeholder="Apt 4B" />
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
          <Field label="City" value={city} onChange={setCity} />
          <Field label="State / Province" value={stateProvince} onChange={setStateProvince} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
          <Field label="Postal Code" value={postalCode} onChange={setPostalCode} />
          <SelectField label="Country" value={country} onChange={setCountry} options={[
            { value: 'US', label: 'United States' },
            { value: 'CA', label: 'Canada' },
            { value: 'GB', label: 'United Kingdom' },
            { value: 'MX', label: 'Mexico' },
            { value: 'TG', label: 'Togo' },
            { value: 'GH', label: 'Ghana' },
            { value: 'NG', label: 'Nigeria' },
            { value: 'KE', label: 'Kenya' },
            { value: 'BR', label: 'Brazil' },
            { value: 'CO', label: 'Colombia' },
            { value: 'GT', label: 'Guatemala' },
            { value: 'HN', label: 'Honduras' },
          ]} />
        </div>
        <Field label="Location (freeform)" value={location} onChange={setLocation} placeholder="e.g., Northern Colorado" />
      </div>

      {/* LANGUAGE */}
      <div style={{
        background: C.card, border: `1px solid ${C.border}`,
        borderRadius: 10, padding: '1rem', marginBottom: '0.75rem',
      }}>
        <SectionHeader label="Language" />
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {[
            { value: 'en', label: 'English' },
            { value: 'es', label: 'Espa\u00f1ol' },
            { value: 'fr', label: 'Fran\u00e7ais' },
            { value: 'pt', label: 'Portugu\u00eas' },
          ].map((lang) => (
            <button
              key={lang.value}
              onClick={() => setLanguage(lang.value)}
              style={{
                padding: '0.4rem 1rem', borderRadius: 20,
                border: `1px solid ${language === lang.value ? C.accent : C.border}`,
                background: language === lang.value ? C.accent : 'transparent',
                color: language === lang.value ? '#fff' : C.text,
                fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {lang.label}
            </button>
          ))}
        </div>
      </div>

      {/* HOME CHURCH */}
      <div style={{
        background: C.card, border: `1px solid ${C.border}`,
        borderRadius: 10, padding: '1rem', marginBottom: '0.75rem',
      }}>
        <SectionHeader label="Home Church" />
        <Field label="" value={homeChurch} onChange={setHomeChurch} placeholder="No home church set" />
      </div>

      {/* COACH */}
      <div style={{
        background: C.card, border: `1px solid ${C.border}`,
        borderRadius: 10, padding: '1rem', marginBottom: '0.75rem',
      }}>
        <SectionHeader label="Coach" />
        {coach ? (
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.5rem',
            padding: '0.5rem 0.65rem', background: C.bg, borderRadius: 6,
            border: `1px solid ${C.border}`,
          }}>
            <span style={{
              width: 28, height: 28, borderRadius: '50%', background: C.accent,
              color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: '0.75rem', flexShrink: 0,
            }}>
              {coach.coachName.charAt(0).toUpperCase()}
            </span>
            <span style={{ fontSize: '0.85rem', color: C.text }}>
              {coach.coachName} &middot; {shareCount} item{shareCount !== 1 ? 's' : ''} shared
            </span>
          </div>
        ) : (
          <p style={{ fontSize: '0.85rem', color: C.textMuted, margin: 0 }}>No coach assigned</p>
        )}
      </div>

      {/* Agent session status + connect button */}
      {!getA2AToken() && (
        <div style={{
          background: '#e3f2fd', border: '1px solid #90caf9', borderRadius: 8,
          padding: '0.75rem', marginBottom: '0.75rem',
        }}>
          <p style={{ fontSize: '0.78rem', color: '#1565c0', margin: '0 0 0.5rem', fontWeight: 600 }}>
            Agent session required to save personal data
          </p>
          <p style={{ fontSize: '0.72rem', color: '#42a5f5', margin: '0 0 0.5rem', lineHeight: 1.4 }}>
            Your personal information is stored securely through an authenticated delegation chain. Connect your agent to enable saving.
          </p>
          <button
            onClick={handleBootstrapSession}
            disabled={bootstrapping}
            style={{
              padding: '0.45rem 1rem', background: '#1565c0', color: '#fff',
              border: 'none', borderRadius: 6, fontWeight: 600, fontSize: '0.82rem',
              cursor: bootstrapping ? 'wait' : 'pointer', opacity: bootstrapping ? 0.7 : 1,
            }}
          >
            {bootstrapping ? 'Connecting...' : 'Connect Agent Session'}
          </button>
        </div>
      )}

      {getA2AToken() && (
        <div style={{
          background: '#e8f5e9', border: '1px solid #a5d6a7', borderRadius: 8,
          padding: '0.6rem 0.8rem', marginBottom: '0.75rem',
          fontSize: '0.75rem', color: '#2e7d32', lineHeight: 1.4,
        }}>
          Agent session active. Personal data is saved securely through delegation chain (Web → A2A Agent → Person MCP).
        </div>
      )}

      {/* Error display */}
      {error && (
        <div style={{
          background: '#ffebee', border: '1px solid #ef9a9a', borderRadius: 8,
          padding: '0.6rem 0.8rem', marginBottom: '0.75rem',
          fontSize: '0.78rem', color: '#c62828', lineHeight: 1.4,
        }}>
          <strong>Save failed:</strong> {error}
        </div>
      )}

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={pending}
        style={{
          width: '100%', padding: '0.65rem',
          background: C.accent, color: '#fff', border: 'none',
          borderRadius: 8, fontWeight: 700, fontSize: '0.9rem',
          cursor: pending ? 'wait' : 'pointer',
          opacity: pending ? 0.7 : 1, transition: 'opacity 0.15s',
        }}
      >
        {saved ? 'Saved!' : pending ? 'Saving...' : 'Save Profile'}
      </button>
    </div>
  )
}
