'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface Check { label: string; ok: boolean; detail?: string }
interface Readiness {
  infra: Check[]
  services: Check[]
  user: Check[]
  infraReady: boolean
  servicesReady: boolean
  userReady: boolean
  allReady: boolean
}

export function ReadinessBanner() {
  const router = useRouter()
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
          // Refresh the page once so the freshly-seeded org + hub show up.
          router.refresh()
          // Auto-hide after a few seconds.
          setTimeout(() => setShow(false), 5000)
        }
      } catch { /* ignore transient errors */ }
    }
    poll()
    const id = setInterval(poll, 3000)
    return () => { cancelled = true; clearInterval(id) }
  }, [router, wasReady])

  if (!s || dismissed || !show) return null

  const pct = computePct(s)
  const allGood = s.allReady
  const bg = allGood ? 'linear-gradient(90deg, #e6f4ea 0%, #dff3e3 100%)'
                     : 'linear-gradient(90deg, #fff8e1 0%, #fff3d0 100%)'
  const fg = allGood ? '#1e6b2d' : '#7a5a10'

  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 40,
      background: bg, color: fg, borderBottom: '1px solid rgba(0,0,0,0.06)',
      padding: '8px 16px', fontSize: 13,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ fontWeight: 700, minWidth: 150 }}>
          {allGood ? '✓ System ready' : `Setting up… ${pct}%`}
        </div>
        <div style={{ flex: 1, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Group label="Infra" checks={s.infra} />
          <Group label="Services" checks={s.services} />
          <Group label="You" checks={s.user} />
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
  const pending = [...s.infra, ...s.services, ...s.user].filter(c => !c.ok)
  if (pending.length === 0) return null
  return (
    <div style={{ marginTop: 4, fontSize: 11, opacity: 0.8, maxWidth: 1100, margin: '4px auto 0' }}>
      waiting: {pending.map(c => c.label).join(' · ')}
    </div>
  )
}

function computePct(s: Readiness): number {
  const all = [...s.infra, ...s.services, ...s.user]
  const done = all.filter(c => c.ok).length
  return Math.floor((done / all.length) * 100)
}
