'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface DemoUser { key: string; name: string; org: string; role: string }

interface DemoCommunity {
  id: string
  name: string
  description: string
  color: string
  users: DemoUser[]
}

const COMMUNITIES: DemoCommunity[] = [
  {
    id: 'default',
    name: 'Agentic Trust Labs',
    description: 'Agent trust, identity, and reputation research platform',
    color: '#1565c0',
    users: [
      { key: 'test-user-001', name: 'Alice', org: 'Agentic Trust Labs', role: 'Owner' },
    ],
  },
  {
    id: 'global-church',
    name: 'Global.Church',
    description: 'Trust fabric for churches, denominations, mission agencies, and giving intermediaries',
    color: '#7c3aed',
    users: [
      { key: 'gc-user-001', name: 'Pastor James', org: 'Grace Community Church', role: 'Senior Pastor' },
      { key: 'gc-user-002', name: 'Dr. Sarah Mitchell', org: 'Southern Baptist Convention', role: 'Executive Director' },
      { key: 'gc-user-003', name: 'Dan Busby', org: 'ECFA', role: 'Executive Director' },
      { key: 'gc-user-004', name: 'John Chesnut', org: 'Wycliffe Bible Translators', role: 'Director' },
      { key: 'gc-user-005', name: 'David Wills', org: 'Natl Christian Foundation', role: 'President' },
    ],
  },
  {
    id: 'ilad-mc',
    name: 'ILAD Mission Collective',
    description: 'Revenue-sharing capital deployment — CIL investment, ILAD training, OOC governance',
    color: '#0d9488',
    users: [
      { key: 'mc-user-001', name: 'John', org: 'Collective Impact Labs', role: 'Managing Director' },
      { key: 'mc-user-002', name: 'Cameron Henrion', org: 'ILAD Togo', role: 'Operations Lead' },
      { key: 'mc-user-003', name: 'Nick Courchesne', org: 'ILAD Togo', role: 'Operations' },
      { key: 'mc-user-004', name: 'Joseph', org: 'ILAD Togo', role: 'Local Manager (Lomé)' },
      { key: 'mc-user-005', name: 'Paul Martel', org: 'Collective Impact Labs', role: 'Funder / Advisor' },
      { key: 'mc-user-006', name: 'Adama Mensah', org: 'TogoKafe', role: 'Business Owner' },
      { key: 'mc-user-007', name: 'Fatou Amegah', org: 'SavonAfriq', role: 'Business Owner' },
    ],
  },
  {
    id: 'togo-pilot',
    name: 'Togo Pilot — Wave 1 Businesses',
    description: '5 BDC graduate businesses in Lomé with field staff, trainers, and assessors',
    color: '#ea580c',
    users: [
      { key: 'tg-user-001', name: 'Kofi Adenu', org: 'Café Lomé', role: 'Business Owner' },
      { key: 'tg-user-002', name: 'Ama Lawson', org: 'Mama Afi Restaurant', role: 'Business Owner' },
      { key: 'tg-user-003', name: 'Edem Togbi', org: 'TechFix Lomé', role: 'Business Owner' },
      { key: 'tg-user-004', name: 'Akosua Mensah', org: "Couture d'Or", role: 'Business Owner' },
      { key: 'tg-user-005', name: 'Yao Agbeko', org: 'AgriPlus Togo', role: 'Business Owner' },
      { key: 'tg-user-006', name: 'Essi Amegah', org: 'ILAD Togo', role: 'Local Coordinator' },
      { key: 'tg-user-007', name: 'Kokou Abalo', org: 'ILAD Togo', role: 'BDC Trainer' },
      { key: 'tg-user-008', name: 'Lawrence', org: 'ILAD Togo', role: 'Training Assessor' },
    ],
  },
]

export function DemoLoginPicker() {
  const router = useRouter()
  const [selectedCommunity, setSelectedCommunity] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function selectUser(key: string) {
    setLoading(true)
    await fetch('/api/demo-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: key }),
    })
    router.push('/dashboard')
  }

  const community = COMMUNITIES.find(c => c.id === selectedCommunity)

  // Community selection view
  if (!community) {
    return (
      <div style={{ marginTop: '2.5rem', width: '100%', maxWidth: 700 }}>
        <p style={{ textAlign: 'center', fontSize: '0.9rem', color: '#616161', marginBottom: '1.5rem' }}>
          Select a demo community to explore
        </p>
        <div style={{ display: 'grid', gap: '0.75rem' }}>
          {COMMUNITIES.map(c => (
            <button
              key={c.id}
              onClick={() => setSelectedCommunity(c.id)}
              style={{
                textAlign: 'left', padding: '1.25rem 1.5rem', background: '#ffffff',
                border: `1px solid #e0e0e0`, borderRadius: 8, cursor: 'pointer',
                color: '#212121', transition: 'all 0.15s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
              }}
              onMouseOver={e => { (e.currentTarget as HTMLElement).style.borderColor = c.color; (e.currentTarget as HTMLElement).style.boxShadow = `0 2px 8px rgba(0,0,0,0.08)` }}
              onMouseOut={e => { (e.currentTarget as HTMLElement).style.borderColor = '#e0e0e0'; (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 3px rgba(0,0,0,0.06)' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem' }}>
                <strong style={{ fontSize: '1.1rem', color: c.color }}>{c.name}</strong>
                <span style={{ fontSize: '0.75rem', padding: '0.1rem 0.4rem', background: '#f5f5f5', borderRadius: 4, color: '#616161' }}>
                  {c.users.length} users
                </span>
              </div>
              <p style={{ fontSize: '0.85rem', color: '#616161', margin: 0 }}>{c.description}</p>
            </button>
          ))}
        </div>
      </div>
    )
  }

  // User selection view
  return (
    <div style={{ marginTop: '2rem', width: '100%', maxWidth: 600 }}>
      <button
        onClick={() => setSelectedCommunity(null)}
        style={{ background: 'transparent', border: 'none', color: '#616161', cursor: 'pointer', fontSize: '0.85rem', padding: 0, marginBottom: '1rem' }}
      >
        ← Back to communities
      </button>

      <h3 style={{ textAlign: 'center', color: community.color, marginBottom: '0.25rem' }}>{community.name}</h3>
      <p style={{ textAlign: 'center', fontSize: '0.85rem', color: '#616161', marginBottom: '1.25rem' }}>{community.description}</p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
        {community.users.map(u => (
          <button
            key={u.key}
            onClick={() => selectUser(u.key)}
            disabled={loading}
            style={{
              textAlign: 'left', padding: '1rem 1.25rem', background: '#ffffff',
              border: '1px solid #e0e0e0', borderRadius: 8, cursor: loading ? 'wait' : 'pointer',
              color: '#212121', boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
            }}
          >
            <strong style={{ display: 'block', marginBottom: '0.2rem' }}>{u.name}</strong>
            <span style={{ fontSize: '0.8125rem', color: '#616161' }}>{u.role}</span>
            <span style={{ display: 'block', fontSize: '0.75rem', color: '#9e9e9e', marginTop: '0.15rem' }}>{u.org}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
