'use client'

/**
 * Pool Create wizard client form. Posts JSON to the sibling submit/route.ts
 * which calls the createPool() server action.
 *
 * Fields kept minimal for the demo:
 *   - name + slug + domain
 *   - mandate.acceptedKinds (comma-separated tags)
 *   - mandate.acceptedGeo (comma-separated)
 *   - acceptedUnits (default ['USD'])
 *   - governanceModel + ceilingPolicy
 *   - visibility
 *
 * Stewards default to a single-entry list = the deployer key (Phase 2.5
 * simplification — Phase 3 wires a real steward roster).
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

const C = {
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  accent: '#8b5e3c',
  card: '#ffffff',
  border: '#ece6db',
  errorBg: '#fef2f2',
  errorFg: '#991b1b',
}

const GOV_OPTIONS = ['fund', 'coaching-network', 'prayer-chain', 'skills-bench', 'hospitality-network'] as const
const CEILING_OPTIONS = ['accept', 'block', 'waitlist'] as const

interface Props {
  hubSlug: string
}

export function PoolCreateForm({ hubSlug }: Props) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [domain, setDomain] = useState('funding')
  const [governanceModel, setGovernanceModel] = useState<typeof GOV_OPTIONS[number]>('fund')
  const [ceilingPolicy, setCeilingPolicy] = useState<typeof CEILING_OPTIONS[number]>('accept')
  const [visibility, setVisibility] = useState<'public' | 'private'>('public')
  const [acceptedKinds, setAcceptedKinds] = useState('')
  const [acceptedGeo, setAcceptedGeo] = useState('us/colorado')
  const [acceptedUnits, setAcceptedUnits] = useState('USD')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name.trim() || !slug.trim()) {
      setError('Name and slug are required.')
      return
    }
    if (!/^[a-z0-9-]+$/.test(slug)) {
      setError('Slug must be lowercase letters, digits, and dashes only.')
      return
    }
    const kindsList = acceptedKinds.split(',').map(s => s.trim()).filter(Boolean)
    const geoList = acceptedGeo.split(',').map(s => s.trim()).filter(Boolean)
    const unitsList = acceptedUnits.split(',').map(s => s.trim()).filter(Boolean)

    startTransition(async () => {
      try {
        const res = await fetch(`/h/${hubSlug}/pools/new/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: slug,
            name,
            domain,
            mandate: {
              acceptedKinds: kindsList,
              acceptedGeo: geoList,
            },
            governanceModel,
            acceptedRestrictions: { kinds: kindsList, geoRoots: geoList },
            acceptedUnits: unitsList,
            ceilingPolicy,
            visibility,
            stewards: [],
          }),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({}))
          setError(j.error ?? `Create failed: ${res.status}`)
          return
        }
        router.push(`/h/${hubSlug}/pools/${encodeURIComponent(`urn:smart-agent:pool:${slug}`)}`)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })
  }

  function field(label: string, child: React.ReactNode) {
    return (
      <label style={{ display: 'block', marginBottom: '0.7rem' }}>
        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: C.text, marginBottom: '0.25rem' }}>
          {label}
        </div>
        {child}
      </label>
    )
  }

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '0.45rem 0.6rem',
    borderRadius: 6,
    border: `1px solid ${C.border}`,
    fontSize: '0.85rem',
    background: '#fff',
    color: C.text,
  }

  return (
    <form
      onSubmit={onSubmit}
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: '1.1rem 1.2rem',
        maxWidth: '36rem',
      }}
    >
      {field('Display name', <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Trauma-Care + Migrant Family Pool" style={inputStyle} required />)}
      {field('Slug (lowercase, dash-separated)', <input type="text" value={slug} onChange={e => setSlug(e.target.value)} placeholder="demo-trauma-care-pool" style={inputStyle} required />)}
      {field('Domain', <input type="text" value={domain} onChange={e => setDomain(e.target.value)} style={inputStyle} />)}
      {field('Governance model', (
        <select value={governanceModel} onChange={e => setGovernanceModel(e.target.value as typeof GOV_OPTIONS[number])} style={inputStyle}>
          {GOV_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ))}
      {field('Accepted kinds (comma-separated)', <input type="text" value={acceptedKinds} onChange={e => setAcceptedKinds(e.target.value)} placeholder="trauma-care, CompassionMinistry" style={inputStyle} required />)}
      {field('Accepted geo (comma-separated)', <input type="text" value={acceptedGeo} onChange={e => setAcceptedGeo(e.target.value)} placeholder="us/colorado" style={inputStyle} />)}
      {field('Accepted units', <input type="text" value={acceptedUnits} onChange={e => setAcceptedUnits(e.target.value)} placeholder="USD" style={inputStyle} />)}
      {field('Ceiling policy', (
        <select value={ceilingPolicy} onChange={e => setCeilingPolicy(e.target.value as typeof CEILING_OPTIONS[number])} style={inputStyle}>
          {CEILING_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ))}
      {field('Visibility', (
        <select value={visibility} onChange={e => setVisibility(e.target.value as 'public' | 'private')} style={inputStyle}>
          <option value="public">public</option>
          <option value="private">private</option>
        </select>
      ))}

      {error && (
        <div style={{ marginBottom: '0.7rem', padding: '0.5rem 0.7rem', background: C.errorBg, color: C.errorFg, borderRadius: 6, fontSize: '0.78rem' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="submit"
          disabled={isPending}
          style={{ padding: '0.55rem 1.1rem', background: C.accent, color: '#fff', border: 'none', borderRadius: 8, fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer' }}
        >
          {isPending ? 'Creating…' : 'Create pool'}
        </button>
      </div>
    </form>
  )
}
