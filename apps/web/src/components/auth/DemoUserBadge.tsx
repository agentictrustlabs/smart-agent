'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface DemoUser { key: string; name: string; org: string; role: string }

export function DemoUserBadge() {
  const router = useRouter()
  const [current, setCurrent] = useState<DemoUser | null>(null)
  const [users, setUsers] = useState<DemoUser[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    fetch('/api/demo-login')
      .then(r => r.json())
      .then(data => {
        setCurrent(data.user ? { key: data.current, ...data.user } : null)
        setUsers(data.users ?? [])
      })
      .catch(() => {})
  }, [])

  async function switchUser(key: string) {
    await fetch('/api/demo-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: key }),
    })
    setOpen(false)
    window.location.href = '/dashboard' // full reload to reset all server component caches
  }

  if (!current) return null

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1d4ed8',
          padding: '0.3rem 0.6rem', borderRadius: 6, fontSize: '0.75rem', fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        {current.name}
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 4,
          background: '#ffffff', border: '1px solid #e2e4e8', borderRadius: 8,
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 50, minWidth: 220,
          padding: '0.5rem',
        }}>
          <div style={{ fontSize: '0.7rem', color: '#6b7280', padding: '0.25rem 0.5rem', borderBottom: '1px solid #f0f1f3', marginBottom: '0.25rem' }}>
            Switch Demo Account
          </div>
          {users.map(u => (
            <button
              key={u.key}
              onClick={() => switchUser(u.key)}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '0.4rem 0.5rem', border: 'none', borderRadius: 4,
                background: u.key === current.key ? '#eff6ff' : 'transparent',
                cursor: 'pointer', fontSize: '0.8rem', color: '#1a1a2e',
              }}
            >
              <strong>{u.name}</strong>
              <span style={{ display: 'block', fontSize: '0.7rem', color: '#6b7280' }}>
                {u.role} — {u.org}
              </span>
            </button>
          ))}
          <div style={{ borderTop: '1px solid #f0f1f3', marginTop: '0.25rem', paddingTop: '0.25rem' }}>
            <button
              onClick={() => { setOpen(false); window.location.href = '/' }}
              style={{
                display: 'block', width: '100%', textAlign: 'center',
                padding: '0.3rem', border: 'none', borderRadius: 4,
                background: 'transparent', cursor: 'pointer',
                fontSize: '0.75rem', color: '#6b7280',
              }}
            >
              Back to login
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
