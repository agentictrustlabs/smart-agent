'use client'

/**
 * Spec 003 — Intent Marketplace (Proposal Lane). Round filters (T029).
 *
 * Client component. Renders the filter form for the rounds index:
 *   - domain (free-text — matched against round mandate JSON substring)
 *   - deadline horizon (this-week / this-month / this-quarter / all)
 *   - budget range (min, max)
 *   - free-text search (mandate / fund name)
 *   - includeClosed toggle
 *
 * State lives in the URL search params so filters are bookmarkable +
 * server-rendered round list re-fetches on submit. Submitting (button
 * or Enter) pushes the new query string.
 */

import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'

const C = {
  text: '#5c4a3a',
  textMuted: '#9a8c7e',
  accent: '#8b5e3c',
  card: '#ffffff',
  border: '#ece6db',
  pill: '#fafaf6',
}

const DEADLINE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All open' },
  { value: 'this-week', label: 'Closing this week' },
  { value: 'this-month', label: 'Closing this month' },
  { value: 'this-quarter', label: 'Closing this quarter' },
]

export function RoundFilters({ hubSlug }: { hubSlug: string }) {
  const router = useRouter()
  const sp = useSearchParams()

  const [domain, setDomain] = useState(sp.get('domain') ?? '')
  const [deadlineHorizon, setDeadlineHorizon] = useState(sp.get('deadline') ?? 'all')
  const [budgetMin, setBudgetMin] = useState(sp.get('budgetMin') ?? '')
  const [budgetMax, setBudgetMax] = useState(sp.get('budgetMax') ?? '')
  const [search, setSearch] = useState(sp.get('search') ?? '')
  const [includeClosed, setIncludeClosed] = useState(sp.get('includeClosed') === '1')

  function applyFilters(e?: React.FormEvent) {
    if (e) e.preventDefault()
    const params = new URLSearchParams()
    if (domain) params.set('domain', domain)
    if (deadlineHorizon && deadlineHorizon !== 'all') params.set('deadline', deadlineHorizon)
    if (budgetMin) params.set('budgetMin', budgetMin)
    if (budgetMax) params.set('budgetMax', budgetMax)
    if (search) params.set('search', search)
    if (includeClosed) params.set('includeClosed', '1')
    const qs = params.toString()
    router.push(`/h/${hubSlug}/rounds${qs ? `?${qs}` : ''}`)
  }

  function reset() {
    setDomain('')
    setDeadlineHorizon('all')
    setBudgetMin('')
    setBudgetMax('')
    setSearch('')
    setIncludeClosed(false)
    router.push(`/h/${hubSlug}/rounds`)
  }

  const hasFilters = !!(domain || (deadlineHorizon && deadlineHorizon !== 'all') || budgetMin || budgetMax || search || includeClosed)

  return (
    <form
      onSubmit={applyFilters}
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
          placeholder="Search mandate or fund name…"
          style={{
            flex: '1 1 280px',
            minWidth: 0,
            padding: '0.45rem 0.6rem',
            fontSize: '0.85rem',
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            color: C.text,
          }}
        />
        <input
          type="text"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="Domain (e.g. trauma-care)"
          style={{
            flex: '0 1 200px',
            minWidth: 0,
            padding: '0.45rem 0.6rem',
            fontSize: '0.85rem',
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            color: C.text,
          }}
        />
      </div>

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          value={deadlineHorizon}
          onChange={(e) => setDeadlineHorizon(e.target.value)}
          style={{
            padding: '0.4rem 0.55rem',
            fontSize: '0.8rem',
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            color: C.text,
            background: '#fff',
          }}
        >
          {DEADLINE_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <input
          type="number"
          inputMode="numeric"
          value={budgetMin}
          onChange={(e) => setBudgetMin(e.target.value)}
          placeholder="Budget min"
          style={{
            width: 120,
            padding: '0.4rem 0.55rem',
            fontSize: '0.8rem',
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            color: C.text,
          }}
        />
        <input
          type="number"
          inputMode="numeric"
          value={budgetMax}
          onChange={(e) => setBudgetMax(e.target.value)}
          placeholder="Budget max"
          style={{
            width: 120,
            padding: '0.4rem 0.55rem',
            fontSize: '0.8rem',
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            color: C.text,
          }}
        />

        <label style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.3rem',
          fontSize: '0.78rem',
          color: C.text,
          padding: '0.35rem 0.55rem',
          background: C.pill,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          cursor: 'pointer',
        }}>
          <input
            type="checkbox"
            checked={includeClosed}
            onChange={(e) => setIncludeClosed(e.target.checked)}
            style={{ margin: 0 }}
          />
          Include closed
        </label>

        <div style={{ flex: 1 }} />

        {hasFilters && (
          <button
            type="button"
            onClick={reset}
            style={{
              padding: '0.4rem 0.7rem',
              fontSize: '0.78rem',
              border: `1px solid ${C.border}`,
              background: '#fff',
              color: C.textMuted,
              borderRadius: 8,
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Reset
          </button>
        )}
        <button
          type="submit"
          style={{
            padding: '0.4rem 0.85rem',
            fontSize: '0.8rem',
            border: 'none',
            background: C.accent,
            color: '#fff',
            borderRadius: 8,
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Apply
        </button>
      </div>
    </form>
  )
}
