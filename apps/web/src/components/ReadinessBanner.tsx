'use client'

import { useEffect, useState } from 'react'

interface Check { label: string; ok: boolean; detail?: string }
interface Readiness {
  infra: Check[]
  services: Check[]
  community: Check[]
  user: Check[]
  infraReady: boolean
  servicesReady: boolean
  communityReady: boolean
  userReady: boolean
  allReady: boolean
  bootPhase: string
}

export function ReadinessBanner() {
  const [s, setS] = useState<Readiness | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [wasReady, setWasReady] = useState(false)
  const [show, setShow] = useState(true)

  useEffect(() => {
    let cancelled = false
    let lastReady = false
    const poll = async () => {
      try {
        const r = await fetch('/api/system-readiness', { cache: 'no-store' })
        if (!r.ok) return
        const data = (await r.json()) as Readiness
        if (cancelled) return
        setS(data)
        if (data.allReady && !lastReady && !wasReady) {
          lastReady = true
          setWasReady(true)
          // We deliberately do NOT call router.refresh() on transition to
          // ready. Doing so re-fetched the current page's RSC payload, and
          // for routes that have client effects depending on the resulting
          // re-render (e.g. /onboarding's layout + polling banner combo),
          // it triggered repeated /onboarding GETs. The banner already
          // updates via its own poll; the underlying page can re-fetch on
          // demand from its own logic if it needs to.
          setTimeout(() => setShow(false), 5000)
        }
      } catch { /* transient */ }
    }
    poll()
    const id = setInterval(poll, 3000)
    return () => { cancelled = true; clearInterval(id) }
  }, [wasReady])

  if (!s || dismissed || !show) return null

  const pct = computePct(s)
  const allGood = s.allReady
  const bg = allGood ? 'linear-gradient(90deg, #e6f4ea 0%, #dff3e3 100%)'
                     : 'linear-gradient(90deg, #fff8e1 0%, #fff3d0 100%)'
  const fg = allGood ? '#1e6b2d' : '#7a5a10'

  return (
    <div data-testid="readiness-banner" data-ready={allGood ? 'true' : 'false'} style={{
      position: 'sticky', top: 0, zIndex: 40,
      background: bg, color: fg, borderBottom: '1px solid rgba(0,0,0,0.06)',
      padding: '8px 16px', fontSize: 13,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ fontWeight: 700, minWidth: 180 }}>
          {allGood ? '✓ System ready' : `Setting up… ${pct}%`}
        </div>
        <div style={{ flex: 1, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Group label="Infra"     checks={s.infra} />
          <Group label="Services"  checks={s.services} />
          <Group label="Community" checks={s.community} />
          <Group label="You"       checks={s.user} />
        </div>
        <button onClick={() => setDismissed(true)} style={{
          background: 'transparent', border: 0, cursor: 'pointer',
          color: fg, fontSize: 18, padding: '0 4px', opacity: 0.6,
        }} aria-label="Dismiss">✕</button>
      </div>
      {!allGood && <Detail s={s} />}
    </div>
  )
}

function Group({ label, checks }: { label: string; checks: Check[] }) {
  const done = checks.filter(c => c.ok).length
  const total = checks.length
  const ok = done === total
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600,
      background: ok ? 'rgba(30,107,45,0.15)' : 'rgba(122,90,16,0.15)',
      color: ok ? '#1e6b2d' : '#7a5a10',
    }}>
      {label}: {done}/{total} {ok && '✓'}
    </span>
  )
}

function Detail({ s }: { s: Readiness }) {
  const pending = [...s.infra, ...s.services, ...s.community, ...s.user].filter(c => !c.ok)
  if (pending.length === 0) return null
  return (
    <div style={{ marginTop: 4, fontSize: 11, opacity: 0.8, maxWidth: 1100, margin: '4px auto 0' }}>
      {s.bootPhase && s.bootPhase !== 'ready' && s.bootPhase !== 'idle'
        ? <span style={{ marginRight: 10 }}>⚙︎ {s.bootPhase}</span>
        : null}
      waiting: {pending.map(c => c.label).join(' · ')}
    </div>
  )
}

function computePct(s: Readiness): number {
  const all = [...s.infra, ...s.services, ...s.community, ...s.user]
  const done = all.filter(c => c.ok).length
  return Math.floor((done / all.length) * 100)
}
