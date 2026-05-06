'use client'

/**
 * Spec 001 — Intent Marketplace (Direct Lane). IntentFilters.
 *
 * Client component owning URL-driven filter state for the intents index.
 * URL params: direction, scope (hub | network), intentType, priority, geo, q
 * (free-text). Each filter writes to the URL via router.replace + refresh,
 * keeping the index a server component.
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

// SKOS leaf intent types — keep in sync with the cbox vocabulary. Curated
// list of the highest-volume types so the UI stays compact; the underlying
// schema stores any IRI.
const INTENT_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All types' },
  { value: 'intentType:NeedCoaching', label: 'Need: Coaching' },
  { value: 'intentType:NeedFunding', label: 'Need: Funding' },
  { value: 'intentType:NeedInformation', label: 'Need: Information' },
  { value: 'intentType:NeedSafePlace', label: 'Need: Safe place' },
  { value: 'intentType:OfferSkill', label: 'Offer: Skill' },
  { value: 'intentType:OfferFunding', label: 'Offer: Funding' },
  { value: 'intentType:OfferTeaching', label: 'Offer: Teaching' },
  { value: 'intentType:OfferPrayer', label: 'Offer: Prayer' },
  { value: 'intentType:OfferIntroduction', label: 'Offer: Introduction' },
  { value: 'intentType:OfferVenue', label: 'Offer: Venue' },
  { value: 'intentType:WantToContribute', label: 'Want to contribute' },
]

const PRIORITY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Any priority' },
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
]

interface IntentFiltersProps {
  hubSlug: string
  receiveCount: number
  giveCount: number
}

export function IntentFilters({ hubSlug, receiveCount, giveCount }: IntentFiltersProps) {
  const router = useRouter()
  const sp = useSearchParams()
  const direction = sp.get('direction') ?? ''
  const scope = sp.get('scope') ?? 'hub'
  const intentType = sp.get('intentType') ?? ''
  const priority = sp.get('priority') ?? ''
  const geo = sp.get('geo') ?? ''
  const q = sp.get('q') ?? ''

  const [searchDraft, setSearchDraft] = useState(q)
  const [geoDraft, setGeoDraft] = useState(geo)

  const buildHref = (patch: Record<string, string | undefined>): string => {
    const next = new URLSearchParams(sp.toString())
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === '') next.delete(key)
      else next.set(key, value)
    }
    const qs = next.toString()
    return qs ? `/h/${hubSlug}/intents?${qs}` : `/h/${hubSlug}/intents`
  }

  const navigate = (patch: Record<string, string | undefined>): void => {
    router.replace(buildHref(patch))
    router.refresh()
  }

  const onSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    navigate({ q: searchDraft.trim() || undefined })
  }
  const onGeoSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    navigate({ geo: geoDraft.trim() || undefined })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '0.85rem' }}>
      {/* Direction with counts (FR-005) */}
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
        <Pill onClick={() => navigate({ direction: undefined })} active={!direction}>
          All directions
        </Pill>
        <Pill
          onClick={() => navigate({ direction: 'receive' })}
          active={direction === 'receive'}
          count={receiveCount}
        >
          📥 Receive
        </Pill>
        <Pill
          onClick={() => navigate({ direction: 'give' })}
          active={direction === 'give'}
          count={giveCount}
        >
          📤 Give
        </Pill>
      </div>

      {/* Scope toggle (FR-022/FR-023) */}
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: '0.7rem', color: C.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginRight: '0.4rem' }}>
          Scope
        </span>
        <Pill onClick={() => navigate({ scope: undefined })} active={scope === 'hub'}>
          Hub only
        </Pill>
        <Pill onClick={() => navigate({ scope: 'network' })} active={scope === 'network'}>
          Hub + network
        </Pill>
      </div>

      {/* Type / priority selects */}
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
        <select
          value={intentType}
          onChange={(e) => navigate({ intentType: e.target.value || undefined })}
          style={selectStyle}
        >
          {INTENT_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          value={priority}
          onChange={(e) => navigate({ priority: e.target.value || undefined })}
          style={selectStyle}
        >
          {PRIORITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Geo + free-text search (FR-002 / FR-003) */}
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
        <form onSubmit={onGeoSubmit} style={{ display: 'flex', gap: '0.3rem' }}>
          <input
            type="text"
            placeholder="Filter geo (e.g. Berthoud)"
            value={geoDraft}
            onChange={(e) => setGeoDraft(e.target.value)}
            style={inputStyle}
          />
          <button type="submit" style={searchButtonStyle}>Geo</button>
        </form>
        <form onSubmit={onSearchSubmit} style={{ display: 'flex', gap: '0.3rem', flex: 1, minWidth: 220 }}>
          <input
            type="search"
            placeholder="Search title / topic / detail"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            style={{ ...inputStyle, flex: 1 }}
          />
          <button type="submit" style={searchButtonStyle}>Search</button>
        </form>
      </div>
    </div>
  )
}

const selectStyle: React.CSSProperties = {
  padding: '0.35rem 0.55rem',
  fontSize: '0.78rem',
  fontWeight: 600,
  borderRadius: 8,
  background: C.card,
  color: C.text,
  border: `1px solid ${C.border}`,
}

const inputStyle: React.CSSProperties = {
  padding: '0.35rem 0.6rem',
  fontSize: '0.78rem',
  borderRadius: 8,
  background: C.card,
  color: C.text,
  border: `1px solid ${C.border}`,
  minWidth: 160,
}

const searchButtonStyle: React.CSSProperties = {
  padding: '0.35rem 0.7rem',
  fontSize: '0.75rem',
  fontWeight: 600,
  borderRadius: 8,
  background: C.accent,
  color: '#fff',
  border: 'none',
  cursor: 'pointer',
}

interface PillProps {
  onClick: () => void
  active: boolean
  count?: number
  children: React.ReactNode
}

function Pill({ onClick, active, count, children }: PillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '0.3rem 0.7rem',
        fontSize: '0.72rem',
        fontWeight: 600,
        borderRadius: 999,
        background: active ? C.accent : C.card,
        color: active ? '#fff' : C.text,
        border: `1px solid ${active ? C.accent : C.border}`,
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.3rem',
        cursor: 'pointer',
      }}
    >
      {children}
      {count !== undefined && <span style={{ fontSize: '0.65rem', opacity: 0.75 }}>{count}</span>}
    </button>
  )
}
