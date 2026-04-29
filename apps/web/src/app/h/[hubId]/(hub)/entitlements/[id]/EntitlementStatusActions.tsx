'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  pauseEntitlement,
  resumeEntitlement,
  revokeEntitlement,
  markEntitlementFulfilled,
} from '@/lib/actions/entitlements.action'

const C = { card: '#ffffff', border: '#ece6db', text: '#5c4a3a', textMuted: '#9a8c7e', accent: '#8b5e3c' }

export function EntitlementStatusActions({ entitlementId, status }: {
  entitlementId: string
  status: 'granted' | 'active' | 'paused' | 'suspended' | 'fulfilled' | 'revoked' | 'expired'
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  function run(label: string, fn: () => Promise<{ ok: true } | { error: string }>) {
    setErr(null)
    start(async () => {
      const r = await fn()
      if ('error' in r) setErr(`${label}: ${r.error}`)
      else router.refresh()
    })
  }

  // Status → which buttons.
  const canPause      = status === 'granted' || status === 'active'
  const canResume     = status === 'paused' || status === 'suspended'
  const canFulfill    = status === 'granted' || status === 'active'
  const canRevoke     = status === 'granted' || status === 'active' || status === 'paused' || status === 'suspended'

  // No actions for already-terminal states.
  if (status === 'fulfilled' || status === 'revoked' || status === 'expired') {
    return null
  }

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '0.85rem 1rem', marginTop: '1rem' }}>
      <div style={{ fontSize: '0.7rem', fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.55rem' }}>
        Manage engagement
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {canPause && (
          <button type="button" onClick={() => run('pause', () => pauseEntitlement(entitlementId))} disabled={pending}
            style={btn('#fff', '#92400e', '#fef3c7')}>
            Pause
          </button>
        )}
        {canResume && (
          <button type="button" onClick={() => run('resume', () => resumeEntitlement(entitlementId))} disabled={pending}
            style={btn('#fff', '#166534', '#dcfce7')}>
            Resume
          </button>
        )}
        {canFulfill && (
          <button type="button" onClick={() => run('fulfill', () => markEntitlementFulfilled(entitlementId))} disabled={pending}
            style={btn(C.accent, '#fff')}>
            Mark fulfilled
          </button>
        )}
        {canRevoke && (
          <button type="button" onClick={() => run('revoke', () => revokeEntitlement(entitlementId))} disabled={pending}
            style={btn('#fff', '#991b1b', '#fee2e2')}>
            Revoke
          </button>
        )}
      </div>
      {err && (
        <div style={{ marginTop: '0.5rem', fontSize: '0.78rem', color: '#991b1b' }}>{err}</div>
      )}
      <div style={{ marginTop: '0.5rem', fontSize: '0.7rem', color: C.textMuted }}>
        Marking fulfilled cascades up the chain: outcome → achieved, source match → fulfilled, parent intent → fulfilled (only once ALL accepted engagements for that intent are fulfilled).
      </div>
    </div>
  )
}

function btn(bg: string, fg: string, border: string = bg): React.CSSProperties {
  return {
    padding: '0.45rem 0.85rem',
    background: bg,
    color: fg,
    border: bg === '#fff' ? `1px solid ${border}` : 'none',
    borderRadius: 8,
    fontSize: '0.8rem',
    fontWeight: 600,
    cursor: 'pointer',
  }
}
