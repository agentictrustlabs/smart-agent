'use client'

import { useEffect, useState, useTransition } from 'react'
import {
  listFeaturesAction,
  mintPublicGeoClaimAction,
  listMyGeoClaimsAction,
  listGeoLocationsForAgentAction,
  type FeatureRow,
  type MyGeoClaimRow,
} from '@/lib/actions/geo-claim.action'
import type { GeoRelation } from '@smart-agent/sdk'

/**
 * Public-on-chain location publisher. Pick a `.geo` feature, a relation
 * kind (`residentOf`, `operatesIn`, …), and a confidence score; the
 * "Publish location" button writes a public on-chain record visible to
 * anyone reading the geo registry.
 *
 * The vault-only path (`GeoLocationCredential`) lives in the dropdown
 * header menu — "+ Get geo credential" — and ends up in
 * `HeldCredentialsPanel`. Keeping the two flows on separate surfaces
 * mirrors the noun split: this panel is for **public locations**,
 * the wallet panel is for **credentials**.
 */
const RELATIONS: GeoRelation[] = [
  'residentOf', 'operatesIn', 'servesWithin', 'licensedIn',
  'completedTaskIn', 'validatedPresenceIn', 'stewardOf', 'originIn',
]

/**
 * Same shape as `AddSkillClaimPanel`: an optional `subjectAgent` swaps
 * the subject from the caller's person agent to an agent they manage.
 * The server enforces authority via `canManageAgent`.
 */
interface AddGeoClaimPanelProps {
  subjectAgent?: `0x${string}`
  subjectLabel?: string
}

export function AddGeoClaimPanel({ subjectAgent, subjectLabel }: AddGeoClaimPanelProps = {}) {
  const [features, setFeatures] = useState<FeatureRow[] | null>(null)
  const [myLocations, setMyLocations] = useState<MyGeoClaimRow[] | null>(null)
  const [featureId, setFeatureId] = useState('')
  const [featureVersion, setFeatureVersion] = useState('1')
  const [relation, setRelation] = useState<GeoRelation>('residentOf')
  const [confidence, setConfidence] = useState(80)
  const [pending, start] = useTransition()
  const [info, setInfo] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const heading = subjectAgent
    ? (subjectLabel ? `${subjectLabel} — Public Locations` : 'Public Locations')
    : 'My Public Locations'

  useEffect(() => {
    if (features && myLocations) return
    start(async () => {
      const [rows, mine] = await Promise.all([
        features ? Promise.resolve(features) : listFeaturesAction(),
        subjectAgent ? listGeoLocationsForAgentAction(subjectAgent) : listMyGeoClaimsAction(),
      ])
      setFeatures(rows)
      setMyLocations(mine)
      if (!featureId && rows.length > 0) {
        setFeatureId(rows[0].featureId)
        setFeatureVersion(rows[0].version)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectAgent])

  function publishLocation() {
    setInfo(null); setErr(null)
    if (!featureId) { setErr('Pick a feature'); return }
    start(async () => {
      const r = await mintPublicGeoClaimAction({
        featureId: featureId as `0x${string}`,
        featureVersion,
        relation,
        confidence,
        ...(subjectAgent ? { subjectAgent } : {}),
      })
      if (r.success) {
        setInfo(`Public location added (${r.claimId?.slice(0, 10)}…). Anyone reading the public geo registry can now see this binding.`)
        const mine = subjectAgent
          ? await listGeoLocationsForAgentAction(subjectAgent)
          : await listMyGeoClaimsAction()
        setMyLocations(mine)
      } else {
        setErr(r.error ?? 'failed')
      }
    })
  }

  return (
    <div style={{
      background: '#fff', border: '1px solid #ece6db', borderRadius: 12,
      padding: '1rem 1.25rem', marginBottom: '1rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <h2 style={{
          fontSize: '0.7rem', fontWeight: 700, color: '#9a8c7e',
          textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0,
        }}>{heading}</h2>
        <span style={{ fontSize: 11, color: '#94a3b8' }}>
          {myLocations === null
            ? 'loading…'
            : `${myLocations.length} location${myLocations.length === 1 ? '' : 's'}`}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 11, color: '#64748b' }}>
          Pick a <code>.geo</code> feature, relation, and confidence — then
          <b> Add</b> to write a public on-chain location visible to anyone
          reading the geo registry. For a vault-only equivalent that stays
          private until you choose to present it, use the
          <b> + Get geo credential</b> entry in the dropdown menu.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 150px', gap: 8 }}>
          <select
            value={featureId}
            onChange={e => {
              setFeatureId(e.target.value)
              const row = features?.find(f => f.featureId === e.target.value)
              if (row) setFeatureVersion(row.version)
            }}
            style={{ padding: '0.4rem 0.6rem', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12 }}
            data-testid="geo-loc-feature"
          >
            {features === null && <option>Loading…</option>}
            {features?.length === 0 && <option>No features published</option>}
            {features?.map(f => (
              <option key={f.featureId} value={f.featureId}>{f.label}  ({f.centroidLat.toFixed(2)}, {f.centroidLon.toFixed(2)})</option>
            ))}
          </select>
          <select
            value={relation}
            onChange={e => setRelation(e.target.value as GeoRelation)}
            style={{ padding: '0.4rem 0.6rem', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12 }}
            data-testid="geo-loc-relation"
          >
            {RELATIONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <input
            type="number"
            value={confidence}
            onChange={e => setConfidence(parseInt(e.target.value || '0', 10))}
            min={0}
            max={100}
            style={{ padding: '0.4rem 0.6rem', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12 }}
            data-testid="geo-loc-confidence"
            title="Confidence 0..100"
          />
          <button
            type="button"
            onClick={publishLocation}
            disabled={pending || !featureId}
            style={{
              padding: '0.4rem 0.8rem',
              background: '#3f6ee8', color: '#fff',
              border: 'none', borderRadius: 6,
              fontSize: 12, fontWeight: 600,
              cursor: pending ? 'wait' : 'pointer', opacity: pending ? 0.5 : 1,
              whiteSpace: 'nowrap',
            }}
            data-testid="geo-loc-publish"
            title="Public on-chain location (visible to anyone reading the geo registry)"
          >
            {pending ? '…' : 'Add'}
          </button>
        </div>
        {info && <span style={{ fontSize: 11, color: '#15803d' }}>{info}</span>}
        {err && <span style={{ fontSize: 11, color: '#b91c1c' }}>{err}</span>}

        {/* ─── Existing public locations for this user ──────────────────── */}
        <div style={{ marginTop: 6, paddingTop: 10, borderTop: '1px dashed #e5e7eb' }}>
          {myLocations !== null && myLocations.length === 0 && (
            <div style={{ fontSize: 11, color: '#64748b' }}>
              No public locations yet. (Vault-only credentials are listed under
              <b> Show held credentials</b>.)
            </div>
          )}
          {myLocations !== null && myLocations.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {myLocations.map(c => (
                <div
                  key={c.claimId}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '2fr 1fr 1fr auto',
                    gap: 10,
                    alignItems: 'center',
                    fontSize: 11,
                    padding: '0.4rem 0.6rem',
                    border: '1px solid #e5e7eb',
                    borderRadius: 6,
                    background: c.revoked ? '#fef2f2' : '#fafbfc',
                  }}
                >
                  <code style={{ fontFamily: 'ui-monospace, monospace', color: '#171c28', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis' }} title={c.featureId}>
                    {c.featureLabel}
                  </code>
                  <span style={{ color: '#3f6ee8' }}>{String(c.relation).replace(/^geo:/, '')}</span>
                  <span style={{ color: '#64748b' }}>{c.visibility} · {c.confidence}%</span>
                  <span style={{ color: '#94a3b8', textAlign: 'right' }}>
                    {new Date(c.createdAt * 1000).toLocaleDateString()}
                    {c.revoked && <span style={{ color: '#b91c1c', marginLeft: 4 }}>·revoked</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
