'use client'

/**
 * Pool Create wizard client form. Posts JSON to the sibling submit/route.ts
 * which calls the createPool() server action.
 *
 * Fields kept minimal for the demo:
 *   - name + slug + domain
 *   - mandate.acceptedKinds (metadata-driven tags + custom entries)
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
import { FUNDING_KIND_OPTIONS, normalizeFundingKindId } from '@/lib/funding-kinds'

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
const FUNDING_KIND_LABELS = new Map(FUNDING_KIND_OPTIONS.map((kind) => [kind.id, kind.label]))

function normalizeSlug(value: string): string {
  return value
    .trimStart()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
}

export interface EligibleOrg {
  orgAddress: `0x${string}`
  orgName: string
}

interface Props {
  hubSlug: string
  orgs: EligibleOrg[]
}

export function PoolCreateForm({ hubSlug, orgs }: Props) {
  const router = useRouter()
  const [pickedOrg, setPickedOrg] = useState<`0x${string}`>(orgs[0]?.orgAddress ?? ('0x' as `0x${string}`))
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [domain, setDomain] = useState('funding')
  const [governanceModel, setGovernanceModel] = useState<typeof GOV_OPTIONS[number]>('fund')
  const [ceilingPolicy, setCeilingPolicy] = useState<typeof CEILING_OPTIONS[number]>('accept')
  const [visibility, setVisibility] = useState<'public' | 'private'>('public')
  const [acceptedKinds, setAcceptedKinds] = useState<string[]>([])
  const [customKind, setCustomKind] = useState('')
  const [kindError, setKindError] = useState<string | null>(null)
  const [acceptedGeo, setAcceptedGeo] = useState('us/colorado')
  const [acceptedUnits, setAcceptedUnits] = useState('USD')
  const [error, setError] = useState<string | null>(null)
  const [onboardCta, setOnboardCta] = useState<string | null>(null)
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
    const kindsList = acceptedKinds
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
            // The operating org becomes the pool's stewardship anchor.
            // Management checks use governance owners, not membership roles.
            operatingOrg: pickedOrg,
            stewards: [pickedOrg],
          }),
        })
        if (!res.ok) {
          const j = await res.json().catch(() => ({})) as { error?: string; redirectTo?: string }
          // 401 + redirectTo = user hasn't bootstrapped their A2A
          // session. Surface a CTA banner with a link to the wizard
          // instead of silently navigating away (which is jarring when
          // the user just filled out a form).
          if (res.status === 401 && j.redirectTo) {
            setOnboardCta(j.redirectTo)
            setError(j.error ?? 'Your agent session isn\'t set up yet.')
            return
          }
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

  function toggleKind(kindId: string) {
    setKindError(null)
    setAcceptedKinds((current) =>
      current.includes(kindId)
        ? current.filter((id) => id !== kindId)
        : [...current, kindId],
    )
  }

  function removeKind(kindId: string) {
    setKindError(null)
    setAcceptedKinds((current) => current.filter((id) => id !== kindId))
  }

  function addCustomKind() {
    setKindError(null)
    const normalized = normalizeFundingKindId(customKind)
    if (!normalized) return
    if (normalized.length > 40) {
      setKindError('Kind names must be 40 characters or fewer.')
      return
    }
    if (acceptedKinds.includes(normalized)) {
      setKindError('Already selected.')
      return
    }
    setAcceptedKinds((current) => [...current, normalized])
    setCustomKind('')
  }

  function kindLabel(kindId: string): string {
    return FUNDING_KIND_LABELS.get(kindId) ?? kindId
  }

  function updateName(value: string) {
    setName(value)
    setSlug(normalizeSlug(value))
  }

  function updateSlug(value: string) {
    setSlug(normalizeSlug(value))
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
      {field('Operating organisation', (
        <>
          <select value={pickedOrg} onChange={e => setPickedOrg(e.target.value as `0x${string}`)} style={inputStyle}>
            {orgs.map(o => <option key={o.orgAddress} value={o.orgAddress}>{o.orgName}</option>)}
          </select>
          <div style={{ fontSize: '0.7rem', color: C.textMuted, marginTop: '0.25rem' }}>
            The selected organisation controls this pool. Governance owners of that organisation can
            manage the pool and administer rounds backed by it.
          </div>
        </>
      ))}
      {field('Display name', <input type="text" value={name} onChange={e => updateName(e.target.value)} placeholder="Trauma-Care + Migrant Family Pool" style={inputStyle} required />)}
      {field('Slug (lowercase, dash-separated)', <input type="text" value={slug} onChange={e => updateSlug(e.target.value)} placeholder="trauma-care-migrant-family-pool" style={inputStyle} required />)}
      {field('Domain', <input type="text" value={domain} onChange={e => setDomain(e.target.value)} style={inputStyle} />)}
      {field('Governance model', (
        <select value={governanceModel} onChange={e => setGovernanceModel(e.target.value as typeof GOV_OPTIONS[number])} style={inputStyle}>
          {GOV_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ))}
      <div style={{ marginBottom: '0.7rem' }}>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontSize: '0.78rem', fontWeight: 600, color: C.text, marginBottom: '0.25rem', padding: 0 }}>
            Accepted funding kinds
          </legend>
          <div style={{ fontSize: '0.7rem', color: C.textMuted, marginBottom: '0.45rem' }}>
            Optional. Leave empty to accept any proposal kind.
          </div>
          <div
            style={{
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              padding: '0.55rem',
              maxHeight: 170,
              overflowY: 'auto',
              background: '#fff',
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))', gap: '0.35rem 0.7rem' }}>
              {FUNDING_KIND_OPTIONS.map((kind) => (
                <label key={kind.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '0.45rem', fontSize: '0.8rem', color: C.text }}>
                  <input
                    type="checkbox"
                    checked={acceptedKinds.includes(kind.id)}
                    onChange={() => toggleKind(kind.id)}
                    style={{ marginTop: '0.12rem' }}
                  />
                  <span>
                    <span style={{ fontWeight: 600 }}>{kind.label}</span>
                    {kind.description && (
                      <span style={{ display: 'block', fontSize: '0.68rem', color: C.textMuted }}>{kind.description}</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </fieldset>

        {acceptedKinds.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.55rem' }}>
            {acceptedKinds.map((kindId) => {
              const custom = !FUNDING_KIND_LABELS.has(kindId)
              return (
                <span
                  key={kindId}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.3rem',
                    padding: '0.18rem 0.45rem',
                    borderRadius: 999,
                    border: `1px solid ${C.border}`,
                    background: '#faf8f3',
                    color: C.text,
                    fontSize: '0.72rem',
                  }}
                >
                  {kindLabel(kindId)}
                  {custom && <span style={{ color: C.textMuted, fontStyle: 'italic' }}>custom</span>}
                  <button
                    type="button"
                    onClick={() => removeKind(kindId)}
                    aria-label={`Remove ${kindLabel(kindId)}`}
                    style={{ border: 0, background: 'transparent', color: C.textMuted, cursor: 'pointer', padding: 0, fontSize: '0.9rem', lineHeight: 1 }}
                  >
                    ×
                  </button>
                </span>
              )
            })}
          </div>
        ) : (
          <div style={{ fontSize: '0.72rem', color: C.textMuted, marginTop: '0.45rem' }}>
            No kinds selected. This pool will accept any proposal kind.
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.45rem', marginTop: '0.55rem' }}>
          <input
            type="text"
            value={customKind}
            onChange={e => {
              setCustomKind(e.target.value)
              setKindError(null)
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addCustomKind()
              }
            }}
            placeholder="Enter a custom kind..."
            style={inputStyle}
          />
          <button
            type="button"
            onClick={addCustomKind}
            aria-label="Add custom kind"
            style={{ minWidth: 64, padding: '0.45rem 0.7rem', borderRadius: 6, border: `1px solid ${C.border}`, background: '#faf8f3', color: C.text, fontWeight: 700, cursor: 'pointer' }}
          >
            Add
          </button>
        </div>
        {kindError && (
          <div style={{ fontSize: '0.72rem', color: C.errorFg, marginTop: '0.35rem' }}>{kindError}</div>
        )}
      </div>
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
          {onboardCta && (
            <div style={{ marginTop: '0.5rem' }}>
              <a
                href={onboardCta}
                style={{
                  display: 'inline-block',
                  padding: '0.4rem 0.85rem',
                  background: '#8b5e3c',
                  color: '#fff',
                  borderRadius: 6,
                  fontWeight: 600,
                  fontSize: '0.82rem',
                  textDecoration: 'none',
                }}
              >
                Complete agent onboarding →
              </a>
              <div style={{ marginTop: '0.4rem', color: C.text, fontSize: '0.72rem' }}>
                After onboarding, come back to this page and submit again.
              </div>
            </div>
          )}
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
