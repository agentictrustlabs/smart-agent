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
    id: 'global-church',
    name: 'Global.Church',
    description: 'Trust and stewardship portal — churches, denominations, mission agencies, and endorsers working together',
    color: '#8b5e3c',
    users: [
      { key: 'gc-user-001', name: 'Pastor James', org: 'Grace Community Church', role: 'Senior Pastor' },
      { key: 'gc-user-002', name: 'Dr. Sarah Mitchell', org: 'Southern Baptist Convention', role: 'Executive Director' },
      { key: 'gc-user-003', name: 'Dan Busby', org: 'ECFA', role: 'Executive Director' },
      { key: 'gc-user-004', name: 'John Chesnut', org: 'Wycliffe Bible Translators', role: 'Director' },
      { key: 'gc-user-005', name: 'David Wills', org: 'Natl Christian Foundation', role: 'President' },
    ],
  },
  {
    id: 'catalyst',
    name: 'Catalyst NoCo Network',
    description: 'Northern Colorado Hispanic outreach — church planting, ESL ministry, farm worker advocacy north of Fort Collins',
    color: '#8b5e3c',
    users: [
      { key: 'cat-user-001', name: 'Maria Gonzalez', org: 'Catalyst NoCo Network', role: 'Program Director' },
      { key: 'cat-user-002', name: 'Pastor David Chen', org: 'Fort Collins Hub', role: 'Hub Lead' },
      { key: 'cat-user-003', name: 'Rosa Martinez', org: 'Fort Collins Hub', role: 'Hispanic Outreach Coordinator' },
      { key: 'cat-user-004', name: 'Carlos Herrera', org: 'Fort Collins Hub', role: 'Community Partner' },
      { key: 'cat-user-005', name: 'Sarah Thompson', org: 'Catalyst NoCo Network', role: 'Regional Lead' },
      { key: 'cat-user-006', name: 'Ana Reyes', org: 'Wellington Circle', role: 'Circle Leader' },
      { key: 'cat-user-007', name: 'Miguel Santos', org: 'Laporte Circle', role: 'Circle Leader' },
    ],
  },
  {
    id: 'cil',
    name: 'Mission Collective',
    description: 'Revenue-sharing capital deployment in Togo — ILAD operations, Ravah model, business health monitoring',
    color: '#2563EB',
    users: [
      { key: 'cil-user-001', name: 'Cameron Henrion', org: 'ILAD', role: 'Operations Lead' },
      { key: 'cil-user-002', name: 'Nick Courchesne', org: 'ILAD', role: 'Reviewer' },
      { key: 'cil-user-003', name: 'Afia Mensah', org: "Afia's Market", role: 'Business Owner' },
      { key: 'cil-user-004', name: 'Kossi Agbeko', org: 'Kossi Mobile Repairs', role: 'Business Owner' },
      { key: 'cil-user-005', name: 'Yaw', org: 'ILAD', role: 'Local Manager' },
      { key: 'cil-user-006', name: 'John F. Kim', org: 'Collective Impact Labs', role: 'Admin' },
      { key: 'cil-user-007', name: 'Paul Martel', org: 'Collective Impact Labs', role: 'Funder' },
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
      <div id="demo-login-picker" data-component="demo-picker">
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
    <div id="demo-login-picker" data-component="demo-picker">
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
