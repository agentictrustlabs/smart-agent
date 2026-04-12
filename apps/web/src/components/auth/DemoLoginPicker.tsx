'use client'

import { useState, type CSSProperties } from 'react'
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
      <div data-component="demo-picker">
        <p data-component="demo-picker-eyebrow">
          Select a community
        </p>
        <div data-component="demo-picker-grid">
          {COMMUNITIES.map(c => (
            <button
              key={c.id}
              onClick={() => setSelectedCommunity(c.id)}
              data-component="demo-community-card"
              style={{
                borderLeft: `3px solid ${c.color}`,
                '--demo-community-color': c.color,
              } as CSSProperties}
            >
              <div data-component="demo-community-head">
                <strong style={{ color: c.color }}>{c.name}</strong>
                <span
                  data-component="demo-community-count"
                  style={{ background: `${c.color}10`, color: c.color }}
                >
                  {c.users.length}
                </span>
              </div>
              <p data-component="demo-community-description">{c.description}</p>
            </button>
          ))}
        </div>
      </div>
    )
  }

  // User selection view
  return (
    <div data-component="demo-picker">
      <button
        onClick={() => setSelectedCommunity(null)}
        data-component="demo-picker-back"
      >
        ← Communities
      </button>

      <section data-component="demo-picker-panel">
        <div data-component="demo-picker-header">
          <div
            data-component="demo-picker-chip"
            style={{ background: `${community.color}10`, color: community.color }}
          >
            {community.name}
          </div>
          <p data-component="demo-picker-description">{community.description}</p>
        </div>

        <p data-component="demo-picker-eyebrow">
          Sign in as
        </p>

        <div data-component="demo-picker-grid">
          {community.users.map(u => (
            <button
              key={u.key}
              onClick={() => selectUser(u.key)}
              disabled={loading}
              data-component="demo-user-card"
              style={{
                '--demo-community-color': community.color,
              } as CSSProperties}
            >
              <div data-component="demo-user-head">
                <div
                  data-component="demo-user-avatar"
                  style={{ background: `${community.color}15`, color: community.color }}
                >
                  {u.name.charAt(0)}
                </div>
                <div data-component="demo-user-copy">
                  <strong>{u.name}</strong>
                  <span>{u.role}</span>
                </div>
              </div>
              <span data-component="demo-user-org">{u.org}</span>
            </button>
          ))}
        </div>

        {loading && (
          <div
            data-component="demo-picker-loading"
            style={{ color: community.color }}
          >
            Connecting...
          </div>
        )}
      </section>
    </div>
  )
}
