'use client'

/**
 * `<CommandPalette>` — global Cmd/Ctrl+K command palette.
 *
 * Mounted once in the hub shell. Listens for ⌘K / Ctrl+K and Esc, opens
 * a centered modal with:
 *   • a search box that runs `searchPeople` on debounce, surfacing the
 *     top hits with their relational-distance badge,
 *   • the same intent shortcut chips that /people/discover offers —
 *     clicking one navigates to the Discover surface pre-filtered,
 *   • quick-nav links to top surfaces (Home, People, Groups, Activity).
 *
 * Keyboard:
 *   ⌘K / Ctrl+K — open
 *   Esc        — close
 *   ↵          — submit current query → /people/discover?q=…
 *
 * The palette never fetches on first open; it waits for the user to
 * type or pick a chip.
 */

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { searchPeople, type PeopleSearchHit } from '@/lib/actions/people-search.action'
import { INTENT_PRESETS } from './IntentPresets'

const QUICK_NAV: Array<{ label: string; href: string; hint: string }> = [
  { label: 'Home',     href: '/h/catalyst/home',  hint: 'Dashboard' },
  { label: 'People',   href: '/people',           hint: 'My People · Members · Discover' },
  { label: 'Discover', href: '/people/discover',  hint: 'Intent-driven search' },
  { label: 'Groups',   href: '/groups',           hint: 'Orgs and movements' },
  { label: 'Activity', href: '/activity',         hint: 'Recent on-chain activity' },
]

const RING_LABEL = ['', '1st', '2nd', '3rd', '4th'] as const

export function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<PeopleSearchHit[]>([])
  const [pending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Global keyboard binding.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isPaletteShortcut =
        (e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')
      if (isPaletteShortcut) {
        e.preventDefault()
        setOpen(prev => !prev)
        return
      }
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Focus on open.
  useEffect(() => {
    if (open) {
      // small delay so the input exists in the DOM
      setTimeout(() => inputRef.current?.focus(), 0)
    } else {
      setQuery('')
      setHits([])
    }
  }, [open])

  // Debounced search.
  useEffect(() => {
    if (!open) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = query.trim()
    if (!q) { setHits([]); return }
    debounceRef.current = setTimeout(() => {
      startTransition(async () => {
        const r = await searchPeople({ query: q, limit: 6 })
        setHits(r.hits)
      })
    }, 180)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, open])

  function navigate(href: string) {
    setOpen(false)
    router.push(href)
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    navigate(`/people/discover?q=${encodeURIComponent(q)}`)
  }

  if (!open) return null

  return (
    <div
      data-testid="command-palette"
      onClick={() => setOpen(false)}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(15, 23, 42, 0.45)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '12vh',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(640px, 92vw)',
          background: '#fff',
          border: '1px solid #ece6db',
          borderRadius: 14,
          boxShadow: '0 20px 60px rgba(15, 23, 42, 0.25)',
          overflow: 'hidden',
        }}
      >
        <form onSubmit={onSubmit}>
          <input
            ref={inputRef}
            data-testid="palette-input"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search people · navigate · run an intent…"
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '0.95rem 1.1rem',
              fontSize: '1rem', border: 'none', outline: 'none',
              borderBottom: '1px solid #ece6db', background: '#fff',
            }}
          />
        </form>

        <div style={{ padding: '0.75rem 0.95rem', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Intent chips */}
          <Section title="Intents">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {INTENT_PRESETS.map(p => (
                <button
                  key={p.id}
                  type="button"
                  data-testid={`palette-intent-${p.id}`}
                  onClick={() => navigate(`/people/discover?intent=${p.id}`)}
                  style={{
                    padding: '0.3rem 0.7rem', borderRadius: 999,
                    border: '1px solid #ece6db', background: '#fff',
                    color: '#475569', fontSize: 12, fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </Section>

          {/* People hits */}
          {(query.trim().length > 0 || hits.length > 0) && (
            <Section title="People">
              {pending && hits.length === 0 && (
                <span style={{ fontSize: 12, color: '#94a3b8' }}>Searching…</span>
              )}
              {!pending && hits.length === 0 && query.trim() && (
                <span style={{ fontSize: 12, color: '#94a3b8' }}>No matches.</span>
              )}
              {hits.map(h => (
                <button
                  key={h.address}
                  type="button"
                  data-testid={`palette-hit-${h.address.toLowerCase()}`}
                  onClick={() => navigate(`/agents/${h.address}`)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    width: '100%', textAlign: 'left',
                    padding: '0.5rem 0.65rem', borderRadius: 8,
                    background: '#fff', border: '1px solid transparent',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#fdf6ee')}
                  onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
                >
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '0.15rem 0.45rem',
                    borderRadius: 999, background: '#fdf6ee', color: '#5c4a3a',
                    border: '1px solid #ece6db',
                  }}>
                    {RING_LABEL[h.degree]}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 600, fontSize: 13 }}>
                      {h.displayName}
                    </span>
                    <span style={{ display: 'block', fontSize: 11, color: '#64748b' }}>
                      {h.reason}
                    </span>
                  </span>
                </button>
              ))}
            </Section>
          )}

          {/* Quick nav */}
          <Section title="Go to">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {QUICK_NAV.map(n => (
                <button
                  key={n.href}
                  type="button"
                  data-testid={`palette-nav-${n.label.toLowerCase()}`}
                  onClick={() => navigate(n.href)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '0.4rem 0.6rem', borderRadius: 6,
                    background: '#fff', border: 'none', textAlign: 'left',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f4f5f7')}
                  onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
                >
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{n.label}</span>
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>{n.hint}</span>
                </button>
              ))}
            </div>
          </Section>
        </div>

        <div style={{
          borderTop: '1px solid #ece6db',
          padding: '0.4rem 0.85rem',
          background: '#fdf6ee',
          fontSize: 11, color: '#8b5e3c',
          display: 'flex', justifyContent: 'space-between',
        }}>
          <span>↵ search · Esc close</span>
          <span>⌘K toggles</span>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{
        fontSize: 10, color: '#9a8c7e', textTransform: 'uppercase',
        letterSpacing: '0.08em', fontWeight: 700, marginBottom: 4,
      }}>{title}</div>
      {children}
    </div>
  )
}
