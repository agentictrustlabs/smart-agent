'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { revokeRelationshipWithCascade, loadDelegatedProfile } from '@/lib/actions/data-delegation.action'

interface Props {
  edgeId: string
  coachPersonAgent: string
  disciplePersonAgent: string
  discipleName: string
  /** 'coach' = current user is coach, 'disciple' = current user is disciple */
  perspective: 'coach' | 'disciple'
}

const FIELD_LABELS: Record<string, string> = {
  email: 'Email', phone: 'Phone', displayName: 'Name', language: 'Language',
  city: 'City', stateProvince: 'State/Province', country: 'Country',
  dateOfBirth: 'Date of Birth', gender: 'Gender',
}

export function CoachActions({ edgeId, coachPersonAgent, disciplePersonAgent, discipleName, perspective }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [profileData, setProfileData] = useState<Record<string, unknown> | null>(null)
  const [profileFields, setProfileFields] = useState<string[]>([])

  async function handleViewProfile() {
    if (perspective !== 'coach') return
    setError(null)
    setLoading(true)
    try {
      const res = await fetch(`/api/a2a/delegated-profile?target=${encodeURIComponent(disciplePersonAgent)}&grantee=${encodeURIComponent(coachPersonAgent)}`)
      const result = await res.json()
      if (!result.success) {
        setError(result.error ?? 'Failed to load profile')
      } else if (result.profile) {
        setProfileData(result.profile)
        setProfileFields(result.allowedFields ?? Object.keys(result.profile))
      } else {
        setError('No profile data available')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleRevoke() {
    const who = perspective === 'coach' ? discipleName : 'your coach'
    if (!confirm(`Remove coaching relationship with ${who}? This will also revoke any shared data access.`)) return
    setError(null)
    setLoading(true)
    try {
      const result = await revokeRelationshipWithCascade(edgeId, coachPersonAgent, disciplePersonAgent)
      if (!result.success) {
        setError(result.error ?? 'Revocation failed')
      } else {
        router.refresh()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Revocation failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ marginTop: '0.5rem' }}>
      {error && (
        <div style={{ fontSize: '0.78rem', color: '#c62828', marginBottom: '0.4rem' }}>{error}</div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem' }}>
        {perspective === 'coach' && (
          <button
            onClick={handleViewProfile}
            disabled={loading}
            style={{
              padding: '0.3rem 0.75rem', borderRadius: 6, border: '1px solid #8b5e3c',
              background: '#fff', color: '#8b5e3c', fontWeight: 600, fontSize: '0.75rem',
              cursor: 'pointer',
            }}
          >
            {loading ? '...' : 'View Profile'}
          </button>
        )}
        <button
          onClick={handleRevoke}
          disabled={loading}
          style={{
            padding: '0.3rem 0.75rem', borderRadius: 6, border: '1px solid #c62828',
            background: '#fff', color: '#c62828', fontWeight: 600, fontSize: '0.75rem',
            cursor: 'pointer',
          }}
        >
          {loading ? '...' : 'Remove'}
        </button>
      </div>

      {profileData && (
        <div style={{
          marginTop: '0.5rem', padding: '0.75rem', background: '#f8f6f1',
          border: '1px solid #ece6db', borderRadius: 8,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#5c4a3a' }}>Shared Profile</span>
            <button onClick={() => setProfileData(null)} style={{ background: 'none', border: 'none', color: '#9a8c7e', cursor: 'pointer', fontSize: '0.75rem' }}>Close</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.3rem 1rem' }}>
            {profileFields.filter(f => f !== 'principal').map(field => (
              <div key={field}>
                <div style={{ fontSize: '0.65rem', color: '#9a8c7e', fontWeight: 600, textTransform: 'uppercase' }}>{FIELD_LABELS[field] ?? field}</div>
                <div style={{ fontSize: '0.82rem', color: '#3a3028' }}>{String(profileData[field] ?? '—')}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
