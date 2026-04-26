'use client'

import { useState, useTransition } from 'react'
import { joinHubAsPerson } from '@/lib/actions/onboarding/setup-agent.action'

interface HubChoice {
  address: string
  primaryName: string
  displayName: string
}

interface JoinHubBannerProps {
  hubs: HubChoice[]
}

/**
 * Shown on /catalyst when the connected user's personal agent isn't a
 * member of any hub yet. Lets the user pick from on-chain hubs and write a
 * `HAS_MEMBER(subject=hub, object=personAgent)` edge directly. After the
 * edge lands, a hard reload swaps the generic dashboard for the
 * hub-specific view (catalyst / cil / global-church).
 */
export function JoinHubBanner({ hubs }: JoinHubBannerProps) {
  const [pending, start] = useTransition()
  const [joining, setJoining] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (hubs.length === 0) return null

  function handleJoin(addr: string) {
    setError(null)
    setJoining(addr)
    start(async () => {
      const r = await joinHubAsPerson(addr)
      if (!r.success) {
        setError(r.error ?? 'Failed to join hub')
        setJoining(null)
        return
      }
      // Hard reload so /catalyst re-runs getUserHubId and switches to the
      // hub-specific dashboard. (router.refresh would also work but plain
      // reload is more reliable here.)
      window.location.reload()
    })
  }

  return (
    <div
      data-testid="catalyst-join-hub-banner"
      style={{
        background: '#eff6ff',
        border: '1px solid #bfdbfe',
        borderRadius: 12,
        padding: '0.85rem 1rem',
        marginBottom: '1rem',
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 600, color: '#1e3a8a', marginBottom: 4 }}>
        Join a hub
      </div>
      <div style={{ fontSize: 12, color: '#1e3a8a', marginBottom: 10, opacity: 0.85 }}>
        Connect your personal agent to a hub for the tailored experience and shared context.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {hubs.map(h => (
          <button
            key={h.address}
            type="button"
            disabled={pending}
            onClick={() => handleJoin(h.address)}
            style={{
              textAlign: 'left',
              padding: '0.55rem 0.75rem',
              border: `1px solid ${joining === h.address ? '#3f6ee8' : '#bfdbfe'}`,
              borderRadius: 8,
              background: joining === h.address ? '#dbeafe' : '#fff',
              cursor: pending ? 'wait' : 'pointer',
              fontSize: 13,
            }}
          >
            <span style={{ fontWeight: 600, color: '#1e3a8a' }}>{h.displayName}</span>
            <code style={{ marginLeft: 8, color: '#475569', fontSize: 12 }}>{h.primaryName}</code>
            {joining === h.address && pending && (
              <span style={{ marginLeft: 8, fontSize: 11, color: '#3f6ee8' }}>joining…</span>
            )}
          </button>
        ))}
      </div>
      {error && (
        <div role="alert" style={{ marginTop: 8, fontSize: 12, color: '#c62828' }}>{error}</div>
      )}
    </div>
  )
}
