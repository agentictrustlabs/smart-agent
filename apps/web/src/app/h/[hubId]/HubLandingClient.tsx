'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useAuth } from '@/hooks/use-auth'
import type { HubLandingConfig } from '@/lib/hub-routes'

interface Props {
  config: HubLandingConfig
  allHubs: Array<{ slug: string; name: string; color: string }>
}

const PRIVY_CONNECT_INTENT_KEY = 'smart-agent:privy-connect-intent'

export function HubLandingClient({ config, allHubs }: Props) {
  const { login, canLoginWithPrivy, authenticated, ready } = useAuth()
  const [loading, setLoading] = useState(false)
  const [selectedUser, setSelectedUser] = useState<string | null>(null)

  // When Privy auth completes (user connects wallet on this page), redirect to hub home
  // We track whether we initiated a wallet connect to avoid redirecting on page load
  // for users who are already authenticated from a previous session
  const [connectInitiated, setConnectInitiated] = useState(false)

  useEffect(() => {
    if (ready && authenticated && connectInitiated) {
      window.location.href = `/h/${config.slug}/home`
    }
  }, [ready, authenticated, connectInitiated, config.slug])

  function handleConnectWallet() {
    if (canLoginWithPrivy && typeof window !== 'undefined') {
      setConnectInitiated(true)
      window.sessionStorage.setItem(PRIVY_CONNECT_INTENT_KEY, 'true')
      login()
    }
  }

  async function handleSelectUser(key: string) {
    setLoading(true)
    setSelectedUser(key)

    // Clear any existing sessions
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})

    // Demo login
    const loginRes = await fetch('/api/demo-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: key }),
    })

    if (!loginRes.ok) {
      setLoading(false)
      setSelectedUser(null)
      return
    }

    // Bootstrap A2A session in background — don't block navigation
    fetch('/api/a2a/bootstrap', { method: 'POST' }).catch(() => {})

    // Navigate to hub dashboard immediately
    window.location.href = `/h/${config.slug}/home`
  }

  return (
    <div style={{ minHeight: '100vh', background: '#faf8f3', display: 'flex', flexDirection: 'column' }}>

      {/* Top bar: hub switcher */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1.5rem',
        borderBottom: '1px solid #ece6db', background: '#fff',
      }}>
        <Link href="/" style={{ fontSize: '0.82rem', color: '#9a8c7e', textDecoration: 'none', fontWeight: 600 }}>
          Smart Agent
        </Link>
        <span style={{ color: '#ece6db' }}>|</span>
        {allHubs.map(h => (
          <Link key={h.slug} href={`/h/${h.slug}`} style={{
            padding: '0.25rem 0.65rem', borderRadius: 8, fontSize: '0.78rem', fontWeight: 600,
            textDecoration: 'none',
            background: h.slug === config.slug ? `${h.color}12` : 'transparent',
            color: h.slug === config.slug ? h.color : '#9a8c7e',
            border: h.slug === config.slug ? `1px solid ${h.color}30` : '1px solid transparent',
          }}>
            {h.name}
          </Link>
        ))}
      </div>

      {/* Hero section */}
      <div style={{
        padding: '3rem 2rem 2rem', textAlign: 'center', maxWidth: 700, margin: '0 auto',
      }}>
        <div style={{
          display: 'inline-block', padding: '0.3rem 0.8rem', borderRadius: 20,
          background: `${config.color}12`, color: config.color, fontSize: '0.75rem',
          fontWeight: 700, letterSpacing: '0.04em', marginBottom: '1rem',
          border: `1px solid ${config.color}25`,
        }}>
          .agent namespace
        </div>

        <h1 style={{
          fontSize: '2rem', fontWeight: 800, color: '#3a3028', margin: '0 0 0.5rem',
          lineHeight: 1.2,
        }}>
          {config.name}
        </h1>

        <p style={{ fontSize: '1rem', color: '#9a8c7e', margin: '0 0 2rem', lineHeight: 1.6 }}>
          {config.description}
        </p>

        {/* Connect Wallet button */}
        <div style={{ marginBottom: '2rem' }}>
          <button onClick={handleConnectWallet} style={{
            padding: '0.75rem 2rem', background: config.color, color: '#fff',
            border: 'none', borderRadius: 10, fontWeight: 700, fontSize: '0.95rem',
            cursor: 'pointer', boxShadow: `0 2px 8px ${config.color}40`,
            opacity: canLoginWithPrivy ? 1 : 0.5,
          }}>
            {canLoginWithPrivy ? 'Connect Wallet' : 'Wallet Connect Not Configured'}
          </button>
          <div style={{ fontSize: '0.78rem', color: '#9a8c7e', marginTop: '0.5rem' }}>
            or select a demo user below
          </div>
        </div>
      </div>

      {/* Demo users grid */}
      <div style={{ maxWidth: 700, margin: '0 auto', padding: '0 2rem 3rem', width: '100%' }}>
        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#9a8c7e', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.75rem' }}>
          Demo Users ({config.demoUsers.length})
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.6rem' }}>
          {config.demoUsers.map(u => (
            <button
              key={u.key}
              onClick={() => handleSelectUser(u.key)}
              disabled={loading}
              style={{
                padding: '0.75rem', background: '#fff', border: `1px solid #ece6db`,
                borderRadius: 10, cursor: loading ? 'wait' : 'pointer', textAlign: 'left',
                transition: 'all 0.15s', opacity: loading && selectedUser !== u.key ? 0.5 : 1,
                borderLeft: `3px solid ${config.color}`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                <div style={{
                  width: 32, height: 32, borderRadius: '50%',
                  background: `${config.color}12`, color: config.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, fontSize: '0.82rem',
                }}>
                  {u.name.charAt(0)}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#3a3028' }}>{u.name}</div>
                  <div style={{ fontSize: '0.7rem', color: '#9a8c7e' }}>{u.role}</div>
                </div>
              </div>
              <div style={{ fontSize: '0.7rem', color: '#b5a898' }}>{u.org}</div>
              {loading && selectedUser === u.key && (
                <div style={{ fontSize: '0.72rem', color: config.color, fontWeight: 600, marginTop: '0.25rem' }}>
                  Connecting...
                </div>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
