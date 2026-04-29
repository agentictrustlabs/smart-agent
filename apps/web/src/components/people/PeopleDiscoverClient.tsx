'use client'

/**
 * `<PeopleDiscoverClient>` — the interactive shell for /people/discover.
 *
 * Layout:
 *   • search input (free-text intent) + "Search" button
 *   • intent shortcut chips (preset queries)
 *   • result list, sorted near→far, each row showing a relational-distance
 *     badge ("1st · Coach", "2nd · Member of an org you steward", …)
 *
 * The component reads `?q=`/`?intent=` from the URL on mount so deep
 * links from the Cmd+K palette (or Phase 4 dashboards) land directly
 * on a filtered Discover view. Typing into the input re-pushes the
 * URL so the search is bookmarkable / back-button friendly.
 */

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { searchPeople, type PeopleSearchHit } from '@/lib/actions/people-search.action'
import { INTENT_PRESETS, type IntentPreset } from './IntentPresets'

const TONE: Record<1 | 2 | 3 | 4, { bg: string; fg: string; border: string }> = {
  1: { bg: '#e8f5ee', fg: '#1f6b3a', border: '#bfe0cc' },   // near
  2: { bg: '#eaf1ff', fg: '#2b4dbe', border: '#c7d6f5' },   // mid
  3: { bg: '#fdf6ee', fg: '#8b5e3c', border: '#ece6db' },   // far
  4: { bg: '#f4f5f7', fg: '#64748b', border: '#e2e8f0' },   // open
}

function ringLabel(degree: 1 | 2 | 3 | 4): string {
  return degree === 1 ? '1st' : degree === 2 ? '2nd' : degree === 3 ? '3rd' : '4th'
}

export function PeopleDiscoverClient() {
  const router = useRouter()
  const params = useSearchParams()
  const initialQ = params.get('q') ?? ''
  const initialIntent = params.get('intent') ?? ''

  const [query, setQuery] = useState(initialQ)
  const [activeIntent, setActiveIntent] = useState<string>(initialIntent)
  const [hits, setHits] = useState<PeopleSearchHit[]>([])
  const [callerScored, setCallerScored] = useState(true)
  const [pending, startTransition] = useTransition()
  const lastSearch = useRef<string>('')

  const effectiveQuery = useMemo(() => {
    if (activeIntent) {
      const p = INTENT_PRESETS.find(p => p.id === activeIntent)
      if (p?.query) return p.query
    }
    return query.trim()
  }, [query, activeIntent])

  // Run search whenever the effective query changes.
  useEffect(() => {
    const key = `${activeIntent}::${effectiveQuery}`
    if (lastSearch.current === key) return
    lastSearch.current = key
    startTransition(async () => {
      const r = await searchPeople({ query: effectiveQuery })
      setHits(r.hits)
      setCallerScored(r.callerScored)
    })
  }, [effectiveQuery, activeIntent])

  function commitToUrl(q: string, intent: string) {
    const next = new URLSearchParams(params.toString())
    if (q) next.set('q', q); else next.delete('q')
    if (intent) next.set('intent', intent); else next.delete('intent')
    const qs = next.toString()
    router.replace(qs ? `?${qs}` : '?')
  }

  function pickIntent(p: IntentPreset) {
    if (activeIntent === p.id) {
      setActiveIntent('')
      commitToUrl(query, '')
    } else {
      setActiveIntent(p.id)
      setQuery('')
      commitToUrl('', p.id)
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setActiveIntent('')
    commitToUrl(query.trim(), '')
  }

  return (
    <div data-testid="people-discover" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Search input */}
      <form onSubmit={onSubmit} style={{ display: 'flex', gap: 8 }}>
        <input
          data-testid="discover-input"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Find a coach, a treasurer, a Spanish-speaking case manager near Loveland…"
          style={{
            flex: 1,
            padding: '0.65rem 0.85rem',
            border: '1px solid #ece6db',
            borderRadius: 10,
            fontSize: '0.95rem',
            background: '#fff',
          }}
        />
        <button
          type="submit"
          style={{
            padding: '0.65rem 1.1rem',
            background: '#3f6ee8',
            color: '#fff',
            fontWeight: 600,
            border: 'none',
            borderRadius: 10,
            cursor: 'pointer',
          }}
        >
          Search
        </button>
      </form>

      {/* Intent shortcut chips */}
      <div data-testid="discover-intents" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {INTENT_PRESETS.map(p => {
          const active = activeIntent === p.id
          return (
            <button
              key={p.id}
              data-testid={`intent-${p.id}`}
              onClick={() => pickIntent(p)}
              type="button"
              title={p.description}
              style={{
                padding: '0.35rem 0.75rem',
                borderRadius: 999,
                border: `1px solid ${active ? '#8b5e3c' : '#ece6db'}`,
                background: active ? '#fdf6ee' : '#fff',
                color: active ? '#5c4a3a' : '#475569',
                fontSize: 12,
                fontWeight: active ? 700 : 500,
                cursor: 'pointer',
              }}
            >
              {p.label}
            </button>
          )
        })}
      </div>

      {!callerScored && (
        <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>
          Showing the open registry — finish onboarding to see who&apos;s near you in the trust graph.
        </p>
      )}

      {/* Results */}
      <div data-testid="discover-results" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {pending && hits.length === 0 && (
          <p style={{ fontSize: 13, color: '#94a3b8' }}>Searching…</p>
        )}
        {!pending && hits.length === 0 && (
          <p style={{ fontSize: 13, color: '#94a3b8' }}>
            No matches for {effectiveQuery ? <strong>{effectiveQuery}</strong> : 'this view'}.
            Try another intent above.
          </p>
        )}
        {hits.map(h => {
          const tone = TONE[h.degree]
          return (
            <Link
              key={h.address}
              href={`/agents/${h.address}`}
              data-testid={`discover-hit-${h.address.toLowerCase()}`}
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <div
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 12,
                  background: '#fff', border: '1px solid #ece6db',
                  borderRadius: 12, padding: '0.75rem 0.95rem',
                }}
              >
                <span
                  data-testid={`discover-degree-${h.degree}`}
                  style={{
                    flexShrink: 0,
                    fontSize: 11, fontWeight: 700,
                    padding: '0.2rem 0.55rem', borderRadius: 999,
                    background: tone.bg, color: tone.fg,
                    border: `1px solid ${tone.border}`,
                  }}
                >
                  {ringLabel(h.degree)} · {h.reason}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.95rem', fontWeight: 700 }}>{h.displayName}</div>
                  {h.primaryName && (
                    <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#8b5e3c' }}>{h.primaryName}</div>
                  )}
                  {h.description && (
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{h.description}</div>
                  )}
                  {h.capabilities.length > 0 && (
                    <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {h.capabilities.slice(0, 6).map(cap => (
                        <span
                          key={cap}
                          style={{
                            fontSize: 10, padding: '0.1rem 0.45rem', borderRadius: 6,
                            background: '#f4f5f7', color: '#475569',
                          }}
                        >
                          {cap}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
