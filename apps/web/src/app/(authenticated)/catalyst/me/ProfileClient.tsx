'use client'

import { useState, useTransition } from 'react'
import { updateUserPreferences } from '@/lib/actions/grow.action'

// ─── Types ──────────────────────────────────────────────────────────

interface CoachInfo {
  coachName: string
  sharePermissions: string
}

interface ProfileClientProps {
  userId: string
  userName: string
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

// ─── Section Header ─────────────────────────────────────────────────

function SectionHeader({ label }: { label: string }) {
  return (
    <h3 style={{
      fontSize: '0.68rem',
      fontWeight: 700,
      color: C.accent,
      textTransform: 'uppercase',
      letterSpacing: '0.06em',
      margin: '0 0 0.5rem',
    }}>
      {label}
    </h3>
  )
}

// ─── Main Component ─────────────────────────────────────────────────

export function ProfileClient({
  userId,
  userName,
  location: initialLocation,
  homeChurch: initialHomeChurch,
  language: initialLanguage,
  coach,
}: ProfileClientProps) {
  const [name, setName] = useState(userName)
  const [location, setLocation] = useState(initialLocation ?? '')
  const [homeChurch, setHomeChurch] = useState(initialHomeChurch ?? '')
  const [language, setLanguage] = useState(initialLanguage)
  const [pending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)

  function handleSave() {
    startTransition(async () => {
      await updateUserPreferences(userId, {
        language,
        homeChurch: homeChurch || undefined,
        location: location || undefined,
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    })
  }

  function handleLanguageChange(lang: string) {
    setLanguage(lang)
    startTransition(async () => {
      await updateUserPreferences(userId, { language: lang })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    })
  }

  const shareCount = coach?.sharePermissions
    ? coach.sharePermissions.split(',').filter(Boolean).length
    : 0

  return (
    <div style={{ maxWidth: 480 }}>
      {/* PROFILE section */}
      <div style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: '1rem',
        marginBottom: '0.75rem',
      }}>
        <SectionHeader label="Profile" />
        <div style={{ marginBottom: '0.75rem' }}>
          <label style={{ fontSize: '0.75rem', fontWeight: 600, color: C.textMuted, display: 'block', marginBottom: '0.25rem' }}>
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{
              width: '100%',
              padding: '0.5rem 0.65rem',
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              fontSize: '0.9rem',
              color: C.text,
              background: C.bg,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
        <div>
          <label style={{ fontSize: '0.75rem', fontWeight: 600, color: C.textMuted, display: 'block', marginBottom: '0.25rem' }}>
            Location
          </label>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Your location"
            style={{
              width: '100%',
              padding: '0.5rem 0.65rem',
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              fontSize: '0.9rem',
              color: C.text,
              background: C.bg,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
      </div>

      {/* HOME CHURCH section */}
      <div style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: '1rem',
        marginBottom: '0.75rem',
      }}>
        <SectionHeader label="Home Church" />
        <input
          type="text"
          value={homeChurch}
          onChange={(e) => setHomeChurch(e.target.value)}
          placeholder="No home church set"
          style={{
            width: '100%',
            padding: '0.5rem 0.65rem',
            border: `1px solid ${C.border}`,
            borderRadius: 6,
            fontSize: '0.9rem',
            color: C.text,
            background: C.bg,
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* SHARING section */}
      <div style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: '1rem',
        marginBottom: '0.75rem',
      }}>
        <SectionHeader label="Sharing" />
        <p style={{ fontSize: '0.78rem', fontWeight: 600, color: C.textMuted, margin: '0 0 0.35rem' }}>
          Coach grants
        </p>
        {coach ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.5rem 0.65rem',
            background: C.bg,
            borderRadius: 6,
            border: `1px solid ${C.border}`,
          }}>
            <span style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: C.accent,
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: '0.75rem',
              flexShrink: 0,
            }}>
              {coach.coachName.charAt(0).toUpperCase()}
            </span>
            <span style={{ fontSize: '0.85rem', color: C.text }}>
              Coach {coach.coachName} &middot; {shareCount} item{shareCount !== 1 ? 's' : ''} shared
            </span>
          </div>
        ) : (
          <p style={{ fontSize: '0.85rem', color: C.textMuted, margin: 0 }}>No Coach set yet</p>
        )}
      </div>

      {/* LANGUAGE section */}
      <div style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: '1rem',
        marginBottom: '0.75rem',
      }}>
        <SectionHeader label="Language" />
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          {[
            { value: 'en', label: 'English' },
            { value: 'es', label: 'Espa\u00f1ol' },
          ].map((lang) => (
            <button
              key={lang.value}
              onClick={() => handleLanguageChange(lang.value)}
              style={{
                padding: '0.4rem 1.2rem',
                borderRadius: 20,
                border: `1px solid ${language === lang.value ? C.accent : C.border}`,
                background: language === lang.value ? C.accent : 'transparent',
                color: language === lang.value ? '#fff' : C.text,
                fontWeight: 600,
                fontSize: '0.82rem',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              {lang.label}
            </button>
          ))}
        </div>
      </div>

      {/* Save button */}
      <button
        onClick={handleSave}
        disabled={pending}
        style={{
          width: '100%',
          padding: '0.65rem',
          background: C.accent,
          color: '#fff',
          border: 'none',
          borderRadius: 8,
          fontWeight: 700,
          fontSize: '0.9rem',
          cursor: pending ? 'wait' : 'pointer',
          opacity: pending ? 0.7 : 1,
          transition: 'opacity 0.15s',
        }}
      >
        {saved ? 'Saved!' : pending ? 'Saving...' : 'Save Profile'}
      </button>
    </div>
  )
}
