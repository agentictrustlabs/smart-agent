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
  {
    id: 'cpm',
    name: 'Church Planting Movement',
    description: 'Activity logging, generational mapping, and group health for church planting teams',
    color: '#1e40af',
    users: [
      { key: 'cpm-user-001', name: 'Mark Thompson', org: 'South Asia Movement Network', role: 'Network Director' },
      { key: 'cpm-user-002', name: 'Priya Sharma', org: 'Kolkata Team', role: 'Team Leader' },
      { key: 'cpm-user-003', name: 'Raj Patel', org: 'Kolkata Team', role: 'Church Planter' },
      { key: 'cpm-user-004', name: 'Anita Das', org: 'Kolkata Team', role: 'National Partner' },
      { key: 'cpm-user-005', name: 'David Kim', org: 'South Asia Movement Network', role: 'Strategy Lead' },
      { key: 'cpm-user-006', name: 'Samuel Bose', org: 'Baranagar Group', role: 'Group Leader' },
      { key: 'cpm-user-007', name: 'Meera Ghosh', org: 'Salt Lake Group', role: 'Group Leader' },
    ],
  },
  {
    id: 'catalyst',
    name: 'Catalyst Network',
    description: 'Grassroots community development — activity tracking, team invites, and multiplication mapping',
    color: '#0369a1',
    users: [
      { key: 'cat-user-001', name: 'Elena Vasquez', org: 'Mekong Catalyst Network', role: 'Program Director' },
      { key: 'cat-user-002', name: 'Linh Nguyen', org: 'Da Nang Hub', role: 'Hub Lead' },
      { key: 'cat-user-003', name: 'Tran Minh', org: 'Da Nang Hub', role: 'Facilitator' },
      { key: 'cat-user-004', name: 'Mai Pham', org: 'Da Nang Hub', role: 'Community Partner' },
      { key: 'cat-user-005', name: 'James Okafor', org: 'Mekong Catalyst Network', role: 'Regional Lead' },
      { key: 'cat-user-006', name: 'Hoa Tran', org: 'Son Tra Group', role: 'Group Leader' },
      { key: 'cat-user-007', name: 'Duc Le', org: 'Han Hoa Group', role: 'Group Leader' },
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
      <div style={{ marginTop: '2rem', width: '100%', maxWidth: 720 }}>
        <p style={{ textAlign: 'center', fontSize: '0.85rem', color: '#9e9e9e', marginBottom: '1.25rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500 }}>
          Select a community
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
          {COMMUNITIES.map(c => (
            <button
              key={c.id}
              onClick={() => setSelectedCommunity(c.id)}
              style={{
                textAlign: 'left', padding: '1.1rem 1.25rem', background: '#ffffff',
                border: `1px solid #e8e8e8`, borderRadius: 10, cursor: 'pointer',
                color: '#212121', transition: 'all 0.2s ease',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                borderLeft: `3px solid ${c.color}`,
              }}
              onMouseOver={e => { (e.currentTarget as HTMLElement).style.borderColor = c.color; (e.currentTarget as HTMLElement).style.boxShadow = `0 4px 12px ${c.color}15`; (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)' }}
              onMouseOut={e => { (e.currentTarget as HTMLElement).style.borderColor = '#e8e8e8'; (e.currentTarget as HTMLElement).style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)'; (e.currentTarget as HTMLElement).style.transform = 'none'; (e.currentTarget as HTMLElement).style.borderLeftColor = c.color }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.3rem' }}>
                <strong style={{ fontSize: '0.95rem', color: c.color }}>{c.name}</strong>
                <span style={{ fontSize: '0.65rem', padding: '0.1rem 0.4rem', background: `${c.color}10`, borderRadius: 100, color: c.color, fontWeight: 600 }}>
                  {c.users.length}
                </span>
              </div>
              <p style={{ fontSize: '0.78rem', color: '#757575', margin: 0, lineHeight: 1.4 }}>{c.description}</p>
            </button>
          ))}
        </div>
      </div>
    )
  }

  // User selection view
  return (
    <div style={{ marginTop: '1.5rem', width: '100%', maxWidth: 640 }}>
      <button
        onClick={() => setSelectedCommunity(null)}
        style={{ background: 'transparent', border: 'none', color: '#9e9e9e', cursor: 'pointer', fontSize: '0.8rem', padding: 0, marginBottom: '1rem', fontWeight: 500 }}
      >
        ← Communities
      </button>

      <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
        <div style={{ display: 'inline-block', padding: '0.25rem 0.75rem', background: `${community.color}10`, borderRadius: 100, marginBottom: '0.4rem' }}>
          <span style={{ fontSize: '0.7rem', fontWeight: 600, color: community.color, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{community.name}</span>
        </div>
        <p style={{ fontSize: '0.82rem', color: '#757575' }}>{community.description}</p>
      </div>

      <p style={{ fontSize: '0.75rem', color: '#9e9e9e', marginBottom: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 500, textAlign: 'left' }}>
        Sign in as
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
        {community.users.map(u => (
          <button
            key={u.key}
            onClick={() => selectUser(u.key)}
            disabled={loading}
            style={{
              textAlign: 'left', padding: '0.85rem 1rem', background: '#ffffff',
              border: '1px solid #e8e8e8', borderRadius: 8, cursor: loading ? 'wait' : 'pointer',
              color: '#212121', transition: 'all 0.15s', boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
            }}
            onMouseOver={e => { if (!loading) { (e.currentTarget as HTMLElement).style.borderColor = community.color; (e.currentTarget as HTMLElement).style.background = `${community.color}05` } }}
            onMouseOut={e => { (e.currentTarget as HTMLElement).style.borderColor = '#e8e8e8'; (e.currentTarget as HTMLElement).style.background = '#ffffff' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: `${community.color}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.7rem', color: community.color, flexShrink: 0 }}>
                {u.name.charAt(0)}
              </div>
              <div>
                <strong style={{ display: 'block', fontSize: '0.85rem', lineHeight: 1.2 }}>{u.name}</strong>
                <span style={{ fontSize: '0.72rem', color: '#757575' }}>{u.role}</span>
              </div>
            </div>
            <span style={{ display: 'block', fontSize: '0.68rem', color: '#ababab', marginTop: '0.2rem', paddingLeft: '2.25rem' }}>{u.org}</span>
          </button>
        ))}
      </div>

      {loading && (
        <div style={{ textAlign: 'center', marginTop: '1rem', color: community.color, fontSize: '0.8rem', fontWeight: 500 }}>
          Connecting...
        </div>
      )}
    </div>
  )
}
