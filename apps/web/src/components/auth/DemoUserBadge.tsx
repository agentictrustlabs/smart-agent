'use client'

import { useState, useEffect, useRef } from 'react'

interface CurrentUser {
  name: string
  role: string
  org: string
  email: string
  walletAddress: string
  smartAccountAddress: string | null
}

export function DemoUserBadge() {
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/demo-login')
      .then(r => r.json())
      .then(data => { if (data.user) setUser(data.user) })
      .catch(() => {})
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  async function disconnect() {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    window.location.href = '/'
  }

  function truncate(addr: string) {
    return addr.length > 14 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr
  }

  if (!user) return null

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1d4ed8',
          padding: '0.3rem 0.6rem', borderRadius: 6, fontSize: '0.75rem', fontWeight: 600,
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.35rem',
        }}
      >
        {user.name}
        <svg width="10" height="10" viewBox="0 0 10 10" style={{ opacity: 0.6 }}>
          <path d="M2 4 L5 7 L8 4" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 4,
          background: '#ffffff', border: '1px solid #e2e4e8', borderRadius: 10,
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 50, width: 280,
          padding: '0.75rem',
        }}>
          {/* User info */}
          <div style={{ marginBottom: '0.75rem' }}>
            <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#1a1a2e' }}>{user.name}</div>
            <div style={{ fontSize: '0.8rem', color: '#616161', marginTop: '0.1rem' }}>{user.role} — {user.org}</div>
          </div>

          {/* Addresses */}
          <div style={{ background: '#f8f9fa', borderRadius: 6, padding: '0.5rem 0.6rem', marginBottom: '0.75rem' }}>
            <div style={{ marginBottom: '0.4rem' }}>
              <div style={{ fontSize: '0.65rem', color: '#9e9e9e', textTransform: 'uppercase', letterSpacing: '0.05em' }}>EOA Wallet</div>
              <div style={{ fontSize: '0.8rem', fontFamily: 'monospace', color: '#424242' }} title={user.walletAddress}>
                {truncate(user.walletAddress)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.65rem', color: '#9e9e9e', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Smart Account (4337)</div>
              {user.smartAccountAddress ? (
                <div style={{ fontSize: '0.8rem', fontFamily: 'monospace', color: '#424242' }} title={user.smartAccountAddress}>
                  {truncate(user.smartAccountAddress)}
                </div>
              ) : (
                <div style={{ fontSize: '0.8rem', color: '#bdbdbd', fontStyle: 'italic' }}>Not deployed</div>
              )}
            </div>
          </div>

          {/* Disconnect */}
          <button
            onClick={disconnect}
            style={{
              display: 'block', width: '100%', textAlign: 'center',
              padding: '0.45rem', border: '1px solid #e2e4e8', borderRadius: 6,
              background: '#fff', cursor: 'pointer',
              fontSize: '0.8rem', color: '#b91c1c', fontWeight: 600,
            }}
          >
            Disconnect
          </button>
        </div>
      )}
    </div>
  )
}
