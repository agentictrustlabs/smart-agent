'use client'

import { useEffect, useState, useTransition } from 'react'
import {
  listFeaturesAction,
  mintPublicGeoClaimAction,
  listMyGeoClaimsAction,
  type FeatureRow,
  type MyGeoClaimRow,
} from '@/lib/actions/geo-claim.action'
import type { GeoRelation } from '@smart-agent/sdk'

/**
 * Mint a Public-visibility geo claim against a feature. The relation
 * + confidence land directly in stage B of geo-overlap.v1, so as soon
 * as the tx confirms the next Discover Agents rerun reflects it.
 *
 * Private (PrivateZk) claims will land here too once the snarkjs
 * verifier is deployed in Phase 6 — same UI, additional "Generate
 * proof" step before the mint.
 */
const RELATIONS: GeoRelation[] = [
  'residentOf', 'operatesIn', 'servesWithin', 'licensedIn',
  'completedTaskIn', 'validatedPresenceIn', 'stewardOf', 'originIn',
]

export function AddGeoClaimPanel() {
  const [open, setOpen] = useState(false)
  const [features, setFeatures] = useState<FeatureRow[] | null>(null)
  const [myClaims, setMyClaims] = useState<MyGeoClaimRow[] | null>(null)
  const [featureId, setFeatureId] = useState('')
  const [featureVersion, setFeatureVersion] = useState('1')
  const [relation, setRelation] = useState<GeoRelation>('residentOf')
  const [confidence, setConfidence] = useState(80)
  const [pending, start] = useTransition()
  const [info, setInfo] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // Initial load: features for the dropdown + the caller's existing claims.
  useEffect(() => {
    if (!open) return
    if (features && myClaims) return
    start(async () => {
      const [rows, mine] = await Promise.all([
        features ? Promise.resolve(features) : listFeaturesAction(),
        listMyGeoClaimsAction(),
      ])
      setFeatures(rows)
      setMyClaims(mine)
      if (!featureId && rows.length > 0) {
        setFeatureId(rows[0].featureId)
        setFeatureVersion(rows[0].version)
      }
    })
  }, [open, features, myClaims, featureId])

  function mint() {
    setInfo(null); setErr(null)
    if (!featureId) { setErr('Pick a feature'); return }
    start(async () => {
      const r = await mintPublicGeoClaimAction({
        featureId: featureId as `0x${string}`,
        featureVersion,
        relation,
        confidence,
      })
      if (r.success) {
        setInfo(`Claim minted (${r.claimId?.slice(0, 10)}…). Rerun Discover Agents to see geo stage-B kick in.`)
        // Refresh the visible list — the chain just confirmed a new claim.
        const mine = await listMyGeoClaimsAction()
        setMyClaims(mine)
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
        }}>My Geo Claims</h2>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          style={{
            background: 'transparent', border: 'none',
            color: '#3f6ee8', fontSize: 12, fontWeight: 600,
            cursor: 'pointer', padding: '0.25rem 0',
          }}
        >
          {open ? '▾ Hide' : '▸ Add geo claim'}
        </button>
      </div>

      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, color: '#64748b' }}>
            Mint a public claim binding your person agent to a <code>.geo</code> feature
            with a relation kind (residentOf, operatesIn, …). Public claims feed
            <code> stage&nbsp;B</code> of <code>smart-agent.geo-overlap.v1</code> immediately.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 80px', gap: 8 }}>
            <select
              value={featureId}
              onChange={e => {
                setFeatureId(e.target.value)
                const row = features?.find(f => f.featureId === e.target.value)
                if (row) setFeatureVersion(row.version)
              }}
              style={{ padding: '0.4rem 0.6rem', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12 }}
              data-testid="geo-claim-feature"
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
              data-testid="geo-claim-relation"
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
              data-testid="geo-claim-confidence"
              title="Confidence 0..100"
            />
            <button
              type="button"
              onClick={mint}
              disabled={pending || !featureId}
              style={{
                padding: '0.4rem 0.8rem',
                background: '#3f6ee8', color: '#fff',
                border: 'none', borderRadius: 6,
                fontSize: 12, fontWeight: 600,
                cursor: pending ? 'wait' : 'pointer', opacity: pending ? 0.5 : 1,
              }}
              data-testid="geo-claim-mint"
            >
              {pending ? '…' : 'Mint'}
            </button>
          </div>
          {info && <span style={{ fontSize: 11, color: '#15803d' }}>{info}</span>}
          {err && <span style={{ fontSize: 11, color: '#b91c1c' }}>{err}</span>}

          {/* ─── Existing claims for this user ────────────────────── */}
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed #e5e7eb' }}>
            <div style={{
              fontSize: 11, fontWeight: 700, color: '#9a8c7e',
              textTransform: 'uppercase', letterSpacing: '0.05em',
              marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span>My geo claims</span>
              <span style={{ fontWeight: 500, color: '#94a3b8', textTransform: 'none', letterSpacing: 0 }}>
                {myClaims === null ? 'loading…' : `${myClaims.length}`}
              </span>
            </div>
            {myClaims !== null && myClaims.length === 0 && (
              <div style={{ fontSize: 11, color: '#64748b' }}>
                No claims yet. Pick a feature + relation above and click Mint to add one.
              </div>
            )}
            {myClaims !== null && myClaims.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {myClaims.map(c => (
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
      )}
    </div>
  )
}
