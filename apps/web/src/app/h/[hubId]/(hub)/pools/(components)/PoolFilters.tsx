'use client'

/**
 * Spec 002 — Intent Marketplace (Pool Lane). Pool filters (US1).
 *
 * Client component. Renders the filter form for the pools index:
 *   - domain (funding / coaching / prayer / skills / hospitality)
 *   - governance model (DAF / giving-circle / mission-cooperative / mutual-aid / fund)
 *   - geo (free-text)
 *   - free-text search (name / mandate)
 *
 * State lives in URL search params so filters are bookmarkable. Mirrors
 * the rounds filter pattern.
 */

import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'

const C = {
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  accent: '#8b5e3c',
  card: '#ffffff',
  border: '#ece6db',
}

const DOMAIN_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All domains' },
  { value: 'funding', label: 'Funding' },
  { value: 'coaching', label: 'Coaching' },
  { value: 'prayer', label: 'Prayer' },
  { value: 'skills', label: 'Skills' },
  { value: 'hospitality', label: 'Hospitality' },
]

const GOVERNANCE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Any governance' },
  { value: 'fund', label: 'Fund' },
  { value: 'DAF', label: 'DAF' },
  { value: 'giving-circle', label: 'Giving circle' },
  { value: 'mission-cooperative', label: 'Mission cooperative' },
  { value: 'mutual-aid', label: 'Mutual aid' },
  { value: 'faith-promise', label: 'Faith promise' },
]

export function PoolFilters({ hubSlug }: { hubSlug: string }) {
  const router = useRouter()
  const sp = useSearchParams()

  const [domain, setDomain] = useState(sp.get('domain') ?? '')
  const [governance, setGovernance] = useState(sp.get('governance') ?? '')
  const [geo, setGeo] = useState(sp.get('geo') ?? '')
  const [search, setSearch] = useState(sp.get('search') ?? '')

  function apply(e?: React.FormEvent) {
    if (e) e.preventDefault()
    const params = new URLSearchParams()
    if (domain) params.set('domain', domain)
    if (governance) params.set('governance', governance)
    if (geo) params.set('geo', geo)
    if (search) params.set('search', search)
    const qs = params.toString()
    router.push(`/h/${hubSlug}/pools${qs ? `?${qs}` : ''}`)
  }

  function reset() {
    setDomain('')
    setGovernance('')
    setGeo('')
    setSearch('')
    router.push(`/h/${hubSlug}/pools`)
  }

  const hasFilters = !!(domain || governance || geo || search)

  return (
    <form
      onSubmit={apply}
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 12,
        padding: '0.85rem 0.95rem',
        marginBottom: '1rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.65rem',
      }}
    >
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name or mandate"
          style={{
            flex: 1,
            minWidth: 200,
            padding: '0.45rem 0.65rem',
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            fontSize: '0.85rem',
            color: C.text,
          }}
        />
        <select
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          style={{
            padding: '0.45rem 0.65rem',
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            fontSize: '0.85rem',
            color: C.text,
            background: '#fff',
          }}
        >
          {DOMAIN_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          value={governance}
          onChange={(e) => setGovernance(e.target.value)}
          style={{
            padding: '0.45rem 0.65rem',
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            fontSize: '0.85rem',
            color: C.text,
            background: '#fff',
          }}
        >
          {GOVERNANCE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <input
          type="text"
          value={geo}
          onChange={(e) => setGeo(e.target.value)}
          placeholder="Geo (e.g. us/colorado)"
          style={{
            width: 200,
            padding: '0.45rem 0.65rem',
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            fontSize: '0.85rem',
            color: C.text,
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
        {hasFilters && (
          <button
            type="button"
            onClick={reset}
            style={{
              padding: '0.4rem 0.85rem',
              background: '#fff',
              color: C.textMuted,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              fontSize: '0.8rem',
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Reset
          </button>
        )}
        <button
          type="submit"
          style={{
            padding: '0.4rem 1rem',
            background: C.accent,
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: '0.85rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Apply
        </button>
      </div>
    </form>
  )
}
