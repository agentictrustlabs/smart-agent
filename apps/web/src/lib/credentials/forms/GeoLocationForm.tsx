'use client'

import { useEffect, useState } from 'react'
import { listFeaturesAction, type FeatureRow } from '@/lib/actions/geo-claim.action'
import type { GeoRelation } from '@smart-agent/sdk'
import type { CredentialFormPropsWithHandle } from './types'

const RELATIONS: GeoRelation[] = [
  'residentOf', 'operatesIn', 'servesWithin', 'licensedIn',
  'completedTaskIn', 'validatedPresenceIn', 'stewardOf', 'originIn',
]

const VALID_RELATIONS = new Set<string>(RELATIONS)

/**
 * Geo location form — picks a `.geo` feature, relation kind, and
 * confidence. Output attributes match `GeoLocationCredential`:
 *
 *   { featureId, featureName, city, region, country,
 *     relation, confidence, validFrom: '0', validUntil: '0',
 *     attestedAt: <now> }
 *
 * featureName / city / region / country are derived from the feature's
 * public `metadataURI` — same shape `AddGeoClaimPanel` uses for the
 * mint flow. No on-chain GeoClaim is read or written.
 */
export function GeoLocationForm({
  busy, onSubmit, onValidationError, expose,
}: CredentialFormPropsWithHandle) {
  const [features, setFeatures] = useState<FeatureRow[] | null>(null)
  const [featureId, setFeatureId] = useState('')
  const [featureVersion, setFeatureVersion] = useState('1')
  const [relation, setRelation] = useState<GeoRelation>('residentOf')
  const [confidence, setConfidence] = useState(80)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const list = await listFeaturesAction().catch(() => [] as FeatureRow[])
      if (cancelled) return
      setFeatures(list)
      if (list.length > 0) {
        setFeatureId(list[0].featureId)
        setFeatureVersion(list[0].version)
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    expose({
      ready: Boolean(featureId) && (features?.length ?? 0) > 0,
      trigger: () => {
        onValidationError(null)
        const picked = features?.find(f => f.featureId === featureId)
        if (!picked) { onValidationError('Pick a feature'); return }
        if (!VALID_RELATIONS.has(relation)) { onValidationError('Invalid relation'); return }
        const conf = Math.max(0, Math.min(100, Math.floor(confidence)))
        onSubmit({
          attributes: {
            featureId: picked.featureId,
            featureName: picked.label,
            city:    picked.label.split('.')[0] ?? '',
            region:  picked.label.split('.')[1] ?? '',
            country: picked.label.split('.')[2] ?? '',
            relation,
            confidence: String(conf),
            validFrom: '0',
            validUntil: '0',
            attestedAt: Math.floor(Date.now() / 1000).toString(),
          },
        })
      },
    })
  }, [featureId, featureVersion, features, relation, confidence, expose, onSubmit, onValidationError])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }}>
          Feature
        </label>
        {features === null ? (
          <div style={{ fontSize: 12, color: '#94a3b8', padding: '0.4rem 0' }}>Loading…</div>
        ) : features.length === 0 ? (
          <div style={{ fontSize: 12, color: '#b91c1c', padding: '0.4rem 0' }}>
            No <code>.geo</code> features published yet.
          </div>
        ) : (
          <select
            value={featureId}
            onChange={(e) => {
              setFeatureId(e.target.value)
              const row = features.find(f => f.featureId === e.target.value)
              if (row) setFeatureVersion(row.version)
            }}
            disabled={busy}
            style={{
              width: '100%', padding: '0.55rem 0.7rem',
              border: '1px solid #cbd5e1', borderRadius: 8,
              fontSize: 13, background: '#fff',
            }}
            data-testid="geo-cred-feature"
          >
            {features.map(f => (
              <option key={f.featureId} value={f.featureId}>
                {f.label}  ({f.centroidLat.toFixed(2)}, {f.centroidLon.toFixed(2)})
              </option>
            ))}
          </select>
        )}
      </div>

      <div>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }}>
          Relation
        </label>
        <select
          value={relation}
          onChange={(e) => setRelation(e.target.value as GeoRelation)}
          disabled={busy}
          style={{
            width: '100%', padding: '0.55rem 0.7rem',
            border: '1px solid #cbd5e1', borderRadius: 8,
            fontSize: 13, background: '#fff',
          }}
          data-testid="geo-cred-relation"
        >
          {RELATIONS.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      <div>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#475569', marginBottom: 6 }}>
          Confidence (0..100)
        </label>
        <input
          type="number"
          value={confidence}
          onChange={(e) => setConfidence(parseInt(e.target.value || '0', 10))}
          min={0}
          max={100}
          disabled={busy}
          style={{
            width: '100%', padding: '0.55rem 0.7rem',
            border: '1px solid #cbd5e1', borderRadius: 8,
            fontSize: 13,
          }}
          data-testid="geo-cred-confidence"
        />
      </div>
    </div>
  )
}
