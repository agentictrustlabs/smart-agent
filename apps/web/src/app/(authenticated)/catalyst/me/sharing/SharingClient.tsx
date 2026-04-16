'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { DataDelegationInfo } from '@/lib/actions/data-delegation.action'
import { revokeDataDelegation, loadDelegatedProfile } from '@/lib/actions/data-delegation.action'

const FIELD_LABELS: Record<string, string> = {
  email: 'Email',
  phone: 'Phone',
  dateOfBirth: 'Date of Birth',
  gender: 'Gender',
  language: 'Language',
  addressLine1: 'Address Line 1',
  addressLine2: 'Address Line 2',
  city: 'City',
  stateProvince: 'State/Province',
  postalCode: 'Postal Code',
  country: 'Country',
  location: 'Location',
  displayName: 'Display Name',
  bio: 'Bio',
}

interface Props {
  incoming: DataDelegationInfo[]
  outgoing: DataDelegationInfo[]
  userId: string
}

export function SharingClient({ incoming, outgoing, userId }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [viewingProfile, setViewingProfile] = useState<{ grantor: string; data: Record<string, unknown>; fields: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleRevoke(delegationHash: string, edgeId: string) {
    if (!confirm('Are you sure you want to revoke this data sharing?')) return
    setError(null)
    setLoading(true)
    try {
      const result = await revokeDataDelegation(delegationHash, edgeId)
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

  async function handleView(grantor: string) {
    setError(null)
    setLoading(true)
    try {
      // Call via API route instead of server action to avoid serialization issues
      const res = await fetch(`/api/a2a/delegated-profile?target=${encodeURIComponent(grantor)}`)
      const result = await res.json()
      console.log('[sharing] delegated profile result:', result)
      if (!result.success) {
        setError(result.error ?? 'Failed to load profile')
      } else if (result.profile) {
        setViewingProfile({ grantor, data: result.profile, fields: result.allowedFields ?? [] })
      } else {
        setError('No profile data returned')
      }
    } catch (e) {
      console.error('[sharing] handleView error:', e)
      setError(e instanceof Error ? e.message : 'Failed to load profile')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: '1.5rem 2rem', maxWidth: 900 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#3a3028', margin: 0 }}>Data Sharing</h1>
        <a href="/catalyst/me" style={{ fontSize: '0.85rem', color: '#8b5e3c', textDecoration: 'none' }}>
          ← Back to Profile
        </a>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1rem', color: '#991b1b', fontSize: '0.85rem' }}>
          {error}
        </div>
      )}

      {/* ─── Data Shared With Me ─────────────────────────────────── */}
      <section style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#5c4a3a', marginBottom: '0.75rem' }}>
          Data Shared With Me
        </h2>
        {incoming.length === 0 ? (
          <p style={{ color: '#9a8c7e', fontSize: '0.9rem' }}>No one has shared data with you yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {incoming.map((d) => (
              <div key={d.edgeId} style={{
                background: '#fff', border: '1px solid #ece6db', borderRadius: 10,
                padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <div>
                  <div style={{ fontWeight: 600, color: '#3a3028' }}>{d.grantorName}</div>
                  <div style={{ fontSize: '0.82rem', color: '#9a8c7e', marginTop: 2 }}>
                    Fields: {d.grants.flatMap(g => g.fields).map(f => FIELD_LABELS[f] ?? f).join(', ')}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#b5a898', marginTop: 2 }}>
                    Shared {new Date(d.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <button
                  onClick={() => handleView(d.grantor)}
                  disabled={loading}
                  style={{
                    padding: '0.4rem 1rem', borderRadius: 6, border: '1px solid #8b5e3c',
                    background: '#fff', color: '#8b5e3c', fontWeight: 600, fontSize: '0.82rem',
                    cursor: 'pointer',
                  }}
                >
                  {loading ? '...' : 'View'}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ─── Viewing Profile Modal ──────────────────────────────── */}
      {viewingProfile && (
        <section style={{
          background: '#f8f6f1', border: '1px solid #ece6db', borderRadius: 10,
          padding: '1.25rem', marginBottom: '2rem',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, color: '#3a3028', margin: 0 }}>
              Shared Profile Data
            </h3>
            <button
              onClick={() => setViewingProfile(null)}
              style={{ background: 'none', border: 'none', color: '#9a8c7e', cursor: 'pointer', fontSize: '0.85rem' }}
            >
              Close
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem 1.5rem' }}>
            {viewingProfile.fields.map((field) => (
              <div key={field}>
                <div style={{ fontSize: '0.75rem', color: '#9a8c7e', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {FIELD_LABELS[field] ?? field}
                </div>
                <div style={{ fontSize: '0.9rem', color: '#3a3028', marginBottom: '0.5rem' }}>
                  {String(viewingProfile.data[field] ?? '—')}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ─── Data I've Shared ───────────────────────────────────── */}
      <section>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, color: '#5c4a3a', marginBottom: '0.75rem' }}>
          Data I've Shared
        </h2>
        {outgoing.length === 0 ? (
          <p style={{ color: '#9a8c7e', fontSize: '0.9rem' }}>You haven't shared data with anyone yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {outgoing.map((d) => (
              <div key={d.edgeId} style={{
                background: '#fff', border: '1px solid #ece6db', borderRadius: 10,
                padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <div>
                  <div style={{ fontWeight: 600, color: '#3a3028' }}>{d.granteeName}</div>
                  <div style={{ fontSize: '0.82rem', color: '#9a8c7e', marginTop: 2 }}>
                    Fields: {d.grants.flatMap(g => g.fields).map(f => FIELD_LABELS[f] ?? f).join(', ')}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#b5a898', marginTop: 2 }}>
                    Shared {new Date(d.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <button
                  onClick={() => handleRevoke(d.delegationHash, d.edgeId)}
                  disabled={loading}
                  style={{
                    padding: '0.4rem 1rem', borderRadius: 6, border: '1px solid #c62828',
                    background: '#fff', color: '#c62828', fontWeight: 600, fontSize: '0.82rem',
                    cursor: 'pointer',
                  }}
                >
                  {loading ? '...' : 'Revoke'}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
