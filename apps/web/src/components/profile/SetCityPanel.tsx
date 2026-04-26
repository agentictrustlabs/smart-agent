'use client'

import { useEffect, useState, useTransition } from 'react'
import { setMyCityAction, getMyCityAction } from '@/lib/actions/set-city.action'

/**
 * Coarse geo tag editor for the caller's person agent.
 *
 *   geo-overlap.v1 reads ATL_CITY / ATL_REGION / ATL_COUNTRY off the
 *   agent and adds a same-city / same-region / same-country bonus to
 *   the Discover Agents score. Setting these three fields is the
 *   fastest way to surface a non-zero geo score for cohorts that
 *   already share a city.
 *
 * The form is intentionally minimal — three inputs + a save button,
 * collapsed by default. Heavier identity flows (lat/long via reverse-
 * geocode, GeoFeatureRegistry residency claims, ZK match) live in
 * dedicated screens that build on top of this baseline.
 */
export function SetCityPanel() {
  const [open, setOpen] = useState(false)
  const [city, setCity] = useState('')
  const [region, setRegion] = useState('')
  const [country, setCountry] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [pending, start] = useTransition()
  const [info, setInfo] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!open || loaded) return
    start(async () => {
      const cur = await getMyCityAction()
      if (cur) {
        setCity(cur.city); setRegion(cur.region); setCountry(cur.country)
      }
      setLoaded(true)
    })
  }, [open, loaded])

  function save() {
    setInfo(null); setErr(null)
    start(async () => {
      const r = await setMyCityAction({ city, region, country })
      if (r.success) setInfo('Saved. Re-run Discover Agents to see the geo bonus.')
      else setErr(r.error ?? 'failed')
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
        }}>My Geo Tag</h2>
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          style={{
            background: 'transparent', border: 'none',
            color: '#3f6ee8', fontSize: 12, fontWeight: 600,
            cursor: 'pointer', padding: '0.25rem 0',
          }}
        >
          {open ? '▾ Hide' : '▸ Set city'}
        </button>
      </div>

      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, color: '#64748b' }}>
            Adds a coarse same-city / same-region / same-country bonus to your trust-overlap
            score on Discover Agents. Stored on chain as <code>atl:city / atl:region / atl:country</code>.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 80px', gap: 8 }}>
            <input
              value={city}
              onChange={e => setCity(e.target.value)}
              placeholder="City (e.g. Fort Collins)"
              style={{ padding: '0.4rem 0.6rem', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12 }}
              data-testid="set-city-city"
            />
            <input
              value={region}
              onChange={e => setRegion(e.target.value)}
              placeholder="Region (state/province)"
              style={{ padding: '0.4rem 0.6rem', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12 }}
              data-testid="set-city-region"
            />
            <input
              value={country}
              onChange={e => setCountry(e.target.value)}
              placeholder="ISO-2"
              maxLength={2}
              style={{ padding: '0.4rem 0.6rem', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 12, textTransform: 'uppercase' }}
              data-testid="set-city-country"
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              onClick={save}
              disabled={pending || !city.trim()}
              style={{
                padding: '0.4rem 0.8rem',
                background: '#3f6ee8', color: '#fff',
                border: 'none', borderRadius: 6,
                fontSize: 12, fontWeight: 600,
                cursor: pending ? 'wait' : 'pointer', opacity: pending ? 0.5 : 1,
              }}
              data-testid="set-city-save"
            >
              {pending ? 'Saving…' : 'Save'}
            </button>
            {info && <span style={{ fontSize: 11, color: '#15803d' }}>{info}</span>}
            {err && <span style={{ fontSize: 11, color: '#b91c1c' }}>{err}</span>}
          </div>
        </div>
      )}
    </div>
  )
}
