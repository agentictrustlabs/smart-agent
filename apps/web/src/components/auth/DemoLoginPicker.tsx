'use client'

import { useRouter } from 'next/navigation'

const DEMO_USERS = [
  { key: 'test-user-001', name: 'Alice', org: 'Agentic Trust Labs', role: 'Owner' },
  { key: 'gc-user-001', name: 'Pastor James', org: 'Grace Community Church', role: 'Senior Pastor' },
  { key: 'gc-user-002', name: 'Dr. Sarah Mitchell', org: 'Southern Baptist Convention', role: 'Executive Director' },
  { key: 'gc-user-003', name: 'Dan Busby', org: 'ECFA', role: 'Executive Director' },
  { key: 'gc-user-004', name: 'John Chesnut', org: 'Wycliffe Bible Translators', role: 'Director' },
  { key: 'gc-user-005', name: 'David Wills', org: 'National Christian Foundation', role: 'President' },
]

export function DemoLoginPicker() {
  const router = useRouter()

  async function selectUser(key: string) {
    await fetch('/api/demo-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: key }),
    })
    router.push('/dashboard')
  }

  return (
    <div style={{ marginTop: '2rem', width: '100%', maxWidth: 600 }}>
      <p style={{ textAlign: 'center', fontSize: '0.85rem', color: '#6b7280', marginBottom: '1rem' }}>
        Select a persona to explore
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
        {DEMO_USERS.map(u => (
          <button
            key={u.key}
            onClick={() => selectUser(u.key)}
            style={{
              textAlign: 'left', padding: '0.75rem', background: '#ffffff',
              border: '1px solid #e2e4e8', borderRadius: 8, cursor: 'pointer',
              color: '#1a1a2e',
            }}
          >
            <strong style={{ display: 'block' }}>{u.name}</strong>
            <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>{u.role} — {u.org}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
