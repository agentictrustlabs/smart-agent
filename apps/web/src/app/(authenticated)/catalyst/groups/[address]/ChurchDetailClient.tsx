'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChurchCircle, type HealthData, parseHealth } from '@/components/catalyst/ChurchCircle'
import { updateGroupHealth } from '@/lib/actions/update-group.action'
import { createDetachedMember } from '@/lib/actions/members.action'
import type { AgentMetadata } from '@/lib/agent-metadata'
import type { OrgMember } from '@/lib/get-org-members'
import type { TrackedMember } from '@/lib/agent-resolver'

/* ── Props ──────────────────────────────────────────────────────────── */

interface Props {
  address: string
  metadata: AgentMetadata
  healthData: Record<string, unknown>
  members: OrgMember[]
  partners: OrgMember[]
  trackedMembers: TrackedMember[]
}

/* ── Constants ──────────────────────────────────────────────────────── */

const TEAM_ROLES = ['Administrator', 'Team Network Viewer', 'Team Viewer'] as const

const FREQUENCY_LABELS: Record<string, string> = {
  'less-weekly': 'Less than once a week',
  'weekly': 'Once a week',
  'multiple': 'More than once a week',
}

const FREQUENCY_OPTIONS = [
  { label: 'Less than once a week', value: 'less-weekly' },
  { label: 'Once a week', value: 'weekly' },
  { label: 'More than once a week', value: 'multiple' },
]

const HEALTH_INDICATORS: Array<{
  key: keyof HealthData; label: string
  subKey?: keyof HealthData; subLabel?: string
}> = [
  { key: 'appointedLeaders', label: 'Appointed Leaders' },
  { key: 'practicesBaptism', label: 'Practices Baptism', subKey: 'doingOwnBaptism', subLabel: 'Doing own Baptism' },
  { key: 'lordsSupper', label: "Lord's Supper", subKey: 'servesLordsSupper', subLabel: "Serves Lord's Supper" },
  { key: 'makingDisciples', label: 'Making Disciples' },
  { key: 'practicesGiving', label: 'Practices Giving' },
  { key: 'regularTeaching', label: 'Regular Teaching', subKey: 'givesOwnTeaching', subLabel: 'Gives own Teaching' },
  { key: 'practicesService', label: 'Practices Service' },
  { key: 'accountability', label: 'Accountability' },
  { key: 'practicesPrayer', label: 'Practices Prayer' },
  { key: 'practicesPraising', label: 'Practices Praising' },
]

/* ── Shared Styles ──────────────────────────────────────────────────── */

const lbl: React.CSSProperties = { fontSize: '0.8rem', color: '#616161', display: 'block', marginBottom: '0.15rem' }
const inp: React.CSSProperties = { width: '100%', padding: '0.45rem', border: '1px solid #e2e4e8', borderRadius: 6, fontSize: '0.85rem' }
const sectionBox: React.CSSProperties = { padding: '0.75rem', background: '#fafafa', borderRadius: 8, border: '1px solid #e2e4e8', marginBottom: '0.75rem' }
const sectionTitle: React.CSSProperties = { fontSize: '0.85rem', fontWeight: 700, display: 'block', marginBottom: '0.5rem', color: '#334155' }

const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '0.45rem 0.6rem', fontSize: '0.72rem',
  fontWeight: 600, color: '#616161', textTransform: 'uppercase', letterSpacing: '0.04em',
  borderBottom: '2px solid #e2e4e8', background: '#fafafa',
}
const tdStyle: React.CSSProperties = {
  padding: '0.5rem 0.6rem', fontSize: '0.85rem', borderBottom: '1px solid #f0f1f3',
}
const btnPrimary: React.CSSProperties = {
  padding: '0.4rem 1rem', background: '#0d9488', color: '#fff',
  border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem',
}
const btnSecondary: React.CSSProperties = {
  padding: '0.4rem 0.85rem', background: '#f5f5f5', color: '#333',
  border: '1px solid #e2e4e8', borderRadius: 6, cursor: 'pointer', fontSize: '0.85rem',
}
const btnDanger: React.CSSProperties = {
  padding: '0.4rem 0.85rem', background: '#dc2626', color: '#fff',
  border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer', fontSize: '0.85rem',
}

/* ── Toast ───────────────────────────────────────────────────────────── */

function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 3000)
    return () => clearTimeout(t)
  }, [onDismiss])

  return (
    <div style={{
      position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
      background: '#1e293b', color: '#fff', padding: '0.6rem 1.2rem',
      borderRadius: 8, fontSize: '0.85rem', fontWeight: 600,
      display: 'flex', alignItems: 'center', gap: '0.75rem',
      boxShadow: '0 4px 12px rgba(0,0,0,0.25)', zIndex: 9999,
    }}>
      <span>{message}</span>
      <button onClick={onDismiss} style={{
        background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff',
        borderRadius: 4, padding: '0.2rem 0.6rem', cursor: 'pointer', fontSize: '0.75rem',
      }}>Ok</button>
    </div>
  )
}

/* ── Modal Overlay ───────────────────────────────────────────────────── */

function ModalOverlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9000,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 12, padding: '1.5rem',
        width: '100%', maxWidth: 440, boxShadow: '0 8px 30px rgba(0,0,0,0.18)',
      }}>
        {children}
      </div>
    </div>
  )
}

/* ── YesNo Toggle ────────────────────────────────────────────────────── */

function YesNo({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const base: React.CSSProperties = {
    padding: '0.3rem 0.75rem', borderRadius: 999, fontSize: '0.78rem', fontWeight: 600,
    border: 'none', cursor: 'pointer', transition: 'all 0.15s',
  }
  return (
    <span style={{ display: 'inline-flex', gap: 4 }}>
      <button type="button" style={{ ...base, background: value ? '#475569' : '#e2e4e8', color: value ? '#fff' : '#616161' }}
        onClick={() => onChange(true)}>Yes</button>
      <button type="button" style={{ ...base, background: !value ? '#475569' : '#e2e4e8', color: !value ? '#fff' : '#616161' }}
        onClick={() => onChange(false)}>No</button>
    </span>
  )
}

/* ── Main Component ──────────────────────────────────────────────────── */

export function ChurchDetailClient({ address, metadata, healthData, members, partners, trackedMembers }: Props) {
  const [activeTab, setActiveTab] = useState<'details' | 'members' | 'settings'>('details')
  const health = parseHealth(Object.keys(healthData).length > 0 ? JSON.stringify(healthData) : null)

  // Toast
  const [toast, setToast] = useState<string | null>(null)
  const showToast = useCallback((msg: string) => setToast(msg), [])
  const dismissToast = useCallback(() => setToast(null), [])

  // ── Tab pill style helper ──
  function tabStyle(tab: string) {
    const isActive = activeTab === tab
    return {
      padding: '0.4rem 1rem', borderRadius: 999, border: 'none', cursor: 'pointer',
      fontWeight: 600 as const, fontSize: '0.85rem', transition: 'all 0.15s',
      background: isActive ? '#0d9488' : '#f0f1f3',
      color: isActive ? '#fff' : '#616161',
    }
  }

  return (
    <div>
      {/* ── Back link ── */}
      <Link href="/catalyst/groups" style={{
        fontSize: '0.85rem', color: '#0d9488', textDecoration: 'none',
        fontWeight: 600, display: 'inline-block', marginBottom: '0.75rem',
      }}>
        &larr; Circles
      </Link>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.25rem', margin: 0, color: '#1a1a2e' }}>{metadata.displayName}</h1>
        {health.isChurch && (
          <span style={{
            fontSize: '0.7rem', fontWeight: 600, padding: '0.15rem 0.5rem',
            borderRadius: 999, background: '#2e7d3215', color: '#2e7d32', border: '1px solid #2e7d3230',
          }}>
            Established
          </span>
        )}
        {!health.isChurch && (
          <span style={{
            fontSize: '0.7rem', fontWeight: 600, padding: '0.15rem 0.5rem',
            borderRadius: 999, background: '#9e9e9e15', color: '#9e9e9e', border: '1px solid #9e9e9e30',
          }}>
            Gathering
          </span>
        )}
      </div>

      {/* ── Tab pills ── */}
      <div style={{ display: 'flex', gap: '0.35rem', marginBottom: '1.25rem' }}>
        <button onClick={() => setActiveTab('details')} style={tabStyle('details')}>Details</button>
        <button onClick={() => setActiveTab('members')} style={tabStyle('members')}>Members</button>
        <button onClick={() => setActiveTab('settings')} style={tabStyle('settings')}>Settings</button>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          DETAILS TAB
          ═══════════════════════════════════════════════════════════════ */}
      {activeTab === 'details' && (
        <DetailsTab
          address={address}
          health={health}
          healthData={healthData}
        />
      )}

      {/* ═══════════════════════════════════════════════════════════════
          MEMBERS TAB
          ═══════════════════════════════════════════════════════════════ */}
      {activeTab === 'members' && (
        <MembersTab
          address={address}
          members={members}
          partners={partners}
          trackedMembers={trackedMembers}
          showToast={showToast}
        />
      )}

      {/* ═══════════════════════════════════════════════════════════════
          SETTINGS TAB
          ═══════════════════════════════════════════════════════════════ */}
      {activeTab === 'settings' && (
        <SettingsTab
          address={address}
          metadata={metadata}
          health={health}
          healthData={healthData}
          showToast={showToast}
        />
      )}

      {toast && <Toast message={toast} onDismiss={dismissToast} />}
    </div>
  )
}

/* ═════════════════════════════════════════════════════════════════════
   DETAILS TAB
   ═════════════════════════════════════════════════════════════════════ */

function DetailsTab({ address, health, healthData }: {
  address: string
  health: HealthData
  healthData: Record<string, unknown>
}) {
  const leaderName = typeof healthData.leaderName === 'string' ? healthData.leaderName : ''
  const location = typeof healthData.location === 'string' ? healthData.location : ''
  const startDate = typeof healthData.startDate === 'string' ? healthData.startDate : ''
  const peoplGroup = health.peoplGroup ?? ''
  const meetingFrequency = health.meetingFrequency ?? 'weekly'

  return (
    <div>
      {/* ── Church Circle Preview ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', marginBottom: '1.25rem', padding: '1rem', background: '#fafafa', borderRadius: 10, border: '1px solid #e2e4e8' }}>
        <ChurchCircle health={health} size={120} />
        <div style={{ fontSize: '0.78rem', color: '#616161' }}>
          <div style={{ fontWeight: 600, color: '#334155', marginBottom: '0.35rem' }}>
            {health.isChurch ? 'Solid circle = Established Church' : 'Dashed circle = Gathering'}
          </div>
          <div>TL: Attenders ({health.attenders || health.seekers || 0}) | TR: Baptized ({health.baptized || 0})</div>
          <div>BL: Believers ({health.believers || 0}) | BR: Leaders ({health.leaders || 0})</div>
          {health.groupsStarted > 0 && <div style={{ marginTop: '0.2rem' }}>Circles Started: {health.groupsStarted}</div>}
          <div style={{ marginTop: '0.2rem', color: '#9e9e9e' }}>Perimeter dots = active practices</div>
        </div>
      </div>

      {/* ── Key Info ── */}
      <div style={sectionBox}>
        <span style={sectionTitle}>Key Information</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
          <div>
            <span style={lbl}>Leader</span>
            <span style={{ fontSize: '0.85rem', color: '#333', fontWeight: 500 }}>{leaderName || '--'}</span>
          </div>
          <div>
            <span style={lbl}>Location</span>
            <span style={{ fontSize: '0.85rem', color: '#333', fontWeight: 500 }}>{location || '--'}</span>
          </div>
          <div>
            <span style={lbl}>Start Date</span>
            <span style={{ fontSize: '0.85rem', color: '#333', fontWeight: 500 }}>{startDate || '--'}</span>
          </div>
          <div>
            <span style={lbl}>Meeting Frequency</span>
            <span style={{ fontSize: '0.85rem', color: '#333', fontWeight: 500 }}>
              {FREQUENCY_LABELS[meetingFrequency] ?? meetingFrequency}
            </span>
          </div>
          <div>
            <span style={lbl}>People Group</span>
            <span style={{ fontSize: '0.85rem', color: '#333', fontWeight: 500 }}>{peoplGroup || '--'}</span>
          </div>
          <div>
            <span style={lbl}>Address</span>
            <span style={{ fontSize: '0.78rem', color: '#9e9e9e', fontFamily: 'monospace' }}>
              {address.slice(0, 10)}...{address.slice(-6)}
            </span>
          </div>
        </div>
      </div>

      {/* ── Health Indicators ── */}
      <div style={sectionBox}>
        <span style={sectionTitle}>Health Indicators</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.35rem' }}>
          {HEALTH_INDICATORS.map(ind => {
            const active = !!health[ind.key]
            return (
              <div key={ind.key} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.82rem' }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 18, height: 18, borderRadius: 4, fontSize: '0.7rem', fontWeight: 700,
                  background: active ? '#0d948820' : '#f0f1f3',
                  color: active ? '#0d9488' : '#9e9e9e',
                  border: `1px solid ${active ? '#0d948840' : '#e2e4e8'}`,
                }}>
                  {active ? '\u2713' : ''}
                </span>
                <span style={{ color: active ? '#333' : '#9e9e9e' }}>{ind.label}</span>
                {active && ind.subKey && !!health[ind.subKey] && (
                  <span style={{ fontSize: '0.72rem', color: '#0d9488', fontStyle: 'italic' }}>
                    ({ind.subLabel})
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── People Circles Attending ── */}
      {health.peopleGroups && health.peopleGroups.length > 0 && (
        <div style={sectionBox}>
          <span style={sectionTitle}>People Circles Attending</span>
          {health.peopleGroups.map((pg, i) => (
            <div key={i} style={{
              padding: '0.5rem 0.65rem', background: '#fff', borderRadius: 6,
              border: '1px solid #e2e4e8', marginBottom: i < health.peopleGroups!.length - 1 ? '0.4rem' : 0,
            }}>
              <div style={{ fontWeight: 600, fontSize: '0.82rem', color: '#333', marginBottom: '0.2rem' }}>
                {pg.name}
              </div>
              <div style={{ fontSize: '0.78rem', color: '#616161', display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                <span>Language: {pg.language}</span>
                <span>Religion: {pg.religiousBackground}</span>
                <span>Attending: {pg.numberAttending}</span>
                <span>Believers: {pg.numberOfBelievers}</span>
                <span>Baptized: {pg.numberOfBaptizedBelievers}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Global Segments ── */}
      {health.globalSegments && health.globalSegments.length > 0 && (
        <div style={sectionBox}>
          <span style={sectionTitle}>Global Segments</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {health.globalSegments.map(seg => (
              <span key={seg} style={{
                padding: '0.2rem 0.55rem', borderRadius: 999, fontSize: '0.75rem', fontWeight: 500,
                background: '#0d948815', color: '#0d9488', border: '1px solid #0d948830',
              }}>
                {seg}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Comments ── */}
      {health.comments && (
        <div style={sectionBox}>
          <span style={sectionTitle}>Comments</span>
          <p style={{ fontSize: '0.85rem', color: '#333', margin: 0, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
            {health.comments}
          </p>
        </div>
      )}

      {/* ── Edit Details link ── */}
      <div style={{ marginTop: '0.5rem' }}>
        <Link href="/catalyst/groups" style={{
          display: 'inline-block', padding: '0.45rem 1rem',
          background: '#0d9488', color: '#fff', borderRadius: 6,
          fontWeight: 600, fontSize: '0.85rem', textDecoration: 'none',
        }}>
          Edit Details
        </Link>
      </div>
    </div>
  )
}

/* ═════════════════════════════════════════════════════════════════════
   MEMBERS TAB
   ═════════════════════════════════════════════════════════════════════ */

function MembersTab({ address, members, partners, trackedMembers, showToast }: {
  address: string
  members: OrgMember[]
  partners: OrgMember[]
  trackedMembers: TrackedMember[]
  showToast: (msg: string) => void
}) {
  const allMembers = [...members, ...partners]
  const [search, setSearch] = useState('')
  const [showFrozen, setShowFrozen] = useState(false)
  const [kebabOpen, setKebabOpen] = useState(false)
  const [createMemberOpen, setCreateMemberOpen] = useState(false)
  const [createMemberName, setCreateMemberName] = useState('')
  const [creatingSaving, setCreatingSaving] = useState(false)
  const [addMembersOpen, setAddMembersOpen] = useState(false)
  const [addSearch, setAddSearch] = useState('')
  const [selectedToAdd, setSelectedToAdd] = useState<string[]>([])
  const [addRoles, setAddRoles] = useState<string[]>([])
  const [editMember, setEditMember] = useState<OrgMember | null>(null)
  const [editRoles, setEditRoles] = useState<string[]>([])
  const [removeMemberConfirm, setRemoveMemberConfirm] = useState<OrgMember | null>(null)

  const kebabRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!kebabOpen) return
    function handleClick(e: MouseEvent) {
      if (kebabRef.current && !kebabRef.current.contains(e.target as Node)) setKebabOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [kebabOpen])

  const filteredMembers = allMembers.filter(m => {
    if (!showFrozen && m.status === 'Frozen') return false
    if (search.trim()) {
      const q = search.toLowerCase()
      return m.name.toLowerCase().includes(q) || m.roles.some(r => r.toLowerCase().includes(q))
    }
    return true
  })

  // For "Add Members" dialog — filter team members not already in this group
  const existingAddrs = new Set(allMembers.map(m => m.address.toLowerCase()))
  const availableToAdd = trackedMembers.filter(tm => {
    if (existingAddrs.has(tm.id.toLowerCase())) return false
    if (addSearch.trim()) return tm.name.toLowerCase().includes(addSearch.toLowerCase())
    return true
  })

  function toggleAddMember(id: string) {
    setSelectedToAdd(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  function openEditMember(m: OrgMember) {
    setEditMember(m)
    setEditRoles([...m.roles.filter(r => (TEAM_ROLES as readonly string[]).includes(r))])
  }

  async function handleCreateMember() {
    if (!createMemberName.trim()) return
    setCreatingSaving(true)
    try {
      await createDetachedMember({ orgAddress: address, name: createMemberName.trim() })
      setCreateMemberOpen(false)
      setCreateMemberName('')
      showToast('Member created')
      window.location.reload()
    } catch { showToast('Failed to create member') }
    setCreatingSaving(false)
  }

  const searchStyle: React.CSSProperties = {
    width: '100%', padding: '0.45rem 0.5rem 0.45rem 2rem',
    border: '1px solid #e2e4e8', borderRadius: 6, fontSize: '0.85rem',
    outline: 'none', background: '#fff',
  }

  return (
    <div>
      {/* Search + kebab */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'center' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', fontSize: '0.85rem', color: '#9e9e9e', pointerEvents: 'none' }}>Q</span>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search members..." style={searchStyle}
          />
        </div>

        <div ref={kebabRef} style={{ position: 'relative' }}>
          <button onClick={() => setKebabOpen(o => !o)} style={{
            background: '#fff', border: '1px solid #e2e4e8', borderRadius: 6,
            width: 36, height: 36, cursor: 'pointer', fontSize: '1.1rem', color: '#616161',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            &#8942;
          </button>
          {kebabOpen && (
            <div style={{
              position: 'absolute', right: 0, top: '100%', marginTop: 4,
              background: '#fff', border: '1px solid #e2e4e8', borderRadius: 8,
              boxShadow: '0 4px 16px rgba(0,0,0,0.12)', minWidth: 200, zIndex: 100,
              overflow: 'hidden',
            }}>
              <button onClick={() => { setKebabOpen(false); setAddMembersOpen(true) }} style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '0.55rem 0.85rem', fontSize: '0.85rem', color: '#333',
                background: 'none', border: 'none', borderBottom: '1px solid #f0f1f3', cursor: 'pointer',
              }}>
                + Add Members
              </button>
              <button onClick={() => { setKebabOpen(false); setCreateMemberOpen(true) }} style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '0.55rem 0.85rem', fontSize: '0.85rem', color: '#333',
                background: 'none', border: 'none', borderBottom: '1px solid #f0f1f3', cursor: 'pointer',
              }}>
                Create Member
              </button>
              <Link href="/team" onClick={() => setKebabOpen(false)} style={{
                display: 'block', padding: '0.55rem 0.85rem', fontSize: '0.85rem',
                color: '#333', textDecoration: 'none',
              }}>
                Invite Members
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Show Frozen */}
      <label style={{
        display: 'flex', alignItems: 'center', gap: '0.35rem',
        fontSize: '0.78rem', color: '#616161', marginBottom: '0.6rem', cursor: 'pointer',
      }}>
        <input type="checkbox" checked={showFrozen} onChange={e => setShowFrozen(e.target.checked)} />
        Show Frozen
      </label>

      {/* Create Member inline form */}
      {createMemberOpen && (
        <div style={{
          padding: '0.85rem', background: '#fafafa', borderRadius: 8,
          border: '1px solid #0d948830', marginBottom: '0.75rem',
        }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.5rem', color: '#333' }}>
            Create Member
          </div>
          <input
            value={createMemberName} onChange={e => setCreateMemberName(e.target.value)}
            placeholder="Name *" autoFocus
            style={{ width: '100%', padding: '0.45rem', border: '1px solid #e2e4e8', borderRadius: 6, fontSize: '0.85rem', marginBottom: '0.5rem' }}
          />
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={handleCreateMember} disabled={creatingSaving || !createMemberName.trim()} style={btnPrimary}>
              {creatingSaving ? 'Creating...' : 'Create'}
            </button>
            <button onClick={() => { setCreateMemberOpen(false); setCreateMemberName('') }} style={btnSecondary}>Cancel</button>
          </div>
        </div>
      )}

      {/* Members table */}
      {filteredMembers.length === 0 ? (
        <p style={{ color: '#616161', textAlign: 'center', padding: '2rem' }}>
          {allMembers.length === 0
            ? 'No members yet. Add members using the menu above.'
            : 'No members match your search.'}
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 8, overflow: 'hidden' }}>
            <thead>
              <tr>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Role</th>
                <th style={{ ...thStyle, textAlign: 'center', width: 80 }}>Frozen</th>
              </tr>
            </thead>
            <tbody>
              {filteredMembers.map(m => {
                const isFrozen = m.status === 'Frozen'
                return (
                  <tr
                    key={m.address}
                    onClick={() => openEditMember(m)}
                    style={{ cursor: 'pointer', opacity: isFrozen ? 0.5 : 1, transition: 'background 0.15s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#f8fffe')}
                    onMouseLeave={e => (e.currentTarget.style.background = '')}
                  >
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <div style={{
                          width: 30, height: 30, borderRadius: '50%',
                          background: '#1565c015', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: '#1565c0', fontWeight: 700, fontSize: '0.75rem', flexShrink: 0,
                        }}>
                          {m.name.charAt(0)}
                        </div>
                        <span style={{ fontWeight: 600, color: '#333' }}>{m.name}</span>
                      </div>
                    </td>
                    <td style={tdStyle}>
                      {m.roles.length > 0 ? m.roles.map(r => (
                        <span key={r} style={{ fontSize: '0.75rem', color: '#616161', marginRight: '0.35rem' }}>{r}</span>
                      )) : (
                        <span style={{ fontSize: '0.75rem', color: '#9e9e9e' }}>--</span>
                      )}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      {isFrozen ? (
                        <span style={{ color: '#dc2626', fontWeight: 700, fontSize: '0.85rem' }}>Yes</span>
                      ) : (
                        <span style={{ color: '#9e9e9e', fontSize: '0.85rem' }}>No</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Add Members Dialog ── */}
      {addMembersOpen && (
        <ModalOverlay onClose={() => { setAddMembersOpen(false); setSelectedToAdd([]); setAddRoles([]) }}>
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem', color: '#333' }}>Add Members</h3>

          <input
            value={addSearch} onChange={e => setAddSearch(e.target.value)}
            placeholder="Search team members..."
            style={{ ...inp, marginBottom: '0.6rem' }}
          />

          {/* Selected chips */}
          {selectedToAdd.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: '0.6rem' }}>
              {selectedToAdd.map(id => {
                const tm = trackedMembers.find(t => t.id === id)
                return (
                  <span key={id} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '0.2rem 0.5rem', borderRadius: 999, fontSize: '0.75rem', fontWeight: 500,
                    background: '#0d948815', color: '#0d9488', border: '1px solid #0d948830',
                  }}>
                    {tm?.name ?? id.slice(0, 8)}
                    <button onClick={() => toggleAddMember(id)} style={{
                      background: 'none', border: 'none', cursor: 'pointer', color: '#0d9488',
                      fontSize: '0.85rem', padding: 0, lineHeight: 1,
                    }}>&times;</button>
                  </span>
                )
              })}
            </div>
          )}

          {/* Available members list */}
          <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #e2e4e8', borderRadius: 6, marginBottom: '0.75rem' }}>
            {availableToAdd.length === 0 ? (
              <p style={{ fontSize: '0.82rem', color: '#9e9e9e', textAlign: 'center', padding: '1rem' }}>
                No available team members to add.
              </p>
            ) : (
              availableToAdd.map(tm => (
                <label key={tm.id} style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                  padding: '0.45rem 0.6rem', cursor: 'pointer', fontSize: '0.85rem',
                  borderBottom: '1px solid #f0f1f3',
                  background: selectedToAdd.includes(tm.id) ? '#f0fdfa' : 'transparent',
                }}>
                  <input
                    type="checkbox"
                    checked={selectedToAdd.includes(tm.id)}
                    onChange={() => toggleAddMember(tm.id)}
                  />
                  <span style={{ fontWeight: 500, color: '#333' }}>{tm.name}</span>
                  {tm.role && <span style={{ fontSize: '0.72rem', color: '#9e9e9e' }}>({tm.role})</span>}
                </label>
              ))
            )}
          </div>

          {/* Role checkboxes */}
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#616161', marginBottom: '0.4rem' }}>Assign Role</div>
            {TEAM_ROLES.map(r => (
              <label key={r} style={{
                display: 'flex', alignItems: 'center', gap: '0.4rem',
                fontSize: '0.85rem', color: '#333', marginBottom: '0.3rem', cursor: 'pointer',
              }}>
                <input
                  type="checkbox"
                  checked={addRoles.includes(r)}
                  onChange={e => {
                    if (e.target.checked) setAddRoles(prev => [...prev, r])
                    else setAddRoles(prev => prev.filter(x => x !== r))
                  }}
                />
                {r}
              </label>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
            <button onClick={() => { setAddMembersOpen(false); setSelectedToAdd([]); setAddRoles([]) }} style={btnSecondary}>Cancel</button>
            <button
              onClick={() => {
                setAddMembersOpen(false); setSelectedToAdd([]); setAddRoles([])
                showToast(`${selectedToAdd.length} member(s) added`)
              }}
              disabled={selectedToAdd.length === 0}
              style={{ ...btnPrimary, opacity: selectedToAdd.length === 0 ? 0.5 : 1 }}
            >
              Add Members
            </button>
          </div>
        </ModalOverlay>
      )}

      {/* ── Edit Church Member Dialog ── */}
      {editMember && (
        <ModalOverlay onClose={() => setEditMember(null)}>
          <h3 style={{ margin: '0 0 0.25rem', fontSize: '1rem', color: '#333' }}>
            Edit Church Member
          </h3>
          <p style={{ margin: '0 0 0.75rem', fontSize: '0.78rem', color: '#9e9e9e' }}>
            {editMember.name} &middot; {editMember.address.slice(0, 8)}...
          </p>

          {!editMember.isPerson && (
            <div style={{
              background: '#fff7ed', border: '1px solid #fb923c', borderRadius: 6,
              padding: '0.5rem 0.65rem', marginBottom: '0.75rem', fontSize: '0.8rem', color: '#c2410c',
            }}>
              This member is detached and does not belong to a user.
            </div>
          )}

          <Link href={`/agents/${editMember.address}`} style={{
            fontSize: '0.8rem', color: '#0d9488', display: 'inline-block', marginBottom: '0.85rem',
          }}>
            Edit Member Details
          </Link>

          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#616161', marginBottom: '0.4rem' }}>Role</div>
            {TEAM_ROLES.map(r => (
              <label key={r} style={{
                display: 'flex', alignItems: 'center', gap: '0.4rem',
                fontSize: '0.85rem', color: '#333', marginBottom: '0.3rem', cursor: 'pointer',
              }}>
                <input
                  type="checkbox"
                  checked={editRoles.includes(r)}
                  onChange={e => {
                    if (e.target.checked) setEditRoles(prev => [...prev, r])
                    else setEditRoles(prev => prev.filter(x => x !== r))
                  }}
                />
                {r}
              </label>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button onClick={() => { setEditMember(null); setRemoveMemberConfirm(editMember) }} style={btnDanger}>
              Remove
            </button>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button onClick={() => setEditMember(null)} style={btnSecondary}>Close</button>
              <button onClick={() => { setEditMember(null); showToast('Member updated') }} style={btnPrimary}>Save</button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* ── Remove Member Confirmation ── */}
      {removeMemberConfirm && (
        <ModalOverlay onClose={() => setRemoveMemberConfirm(null)}>
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem', color: '#333' }}>
            Remove Church Member
          </h3>
          <p style={{ fontSize: '0.85rem', color: '#616161', lineHeight: 1.5, margin: '0 0 1.25rem' }}>
            Are you sure? Removing <strong>{removeMemberConfirm.name}</strong> will prevent access but they can still see activity entered on this team.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
            <button onClick={() => setRemoveMemberConfirm(null)} style={btnSecondary}>Cancel</button>
            <button onClick={() => {
              setRemoveMemberConfirm(null)
              showToast('Member removed')
            }} style={btnDanger}>Remove Member</button>
          </div>
        </ModalOverlay>
      )}
    </div>
  )
}

/* ═════════════════════════════════════════════════════════════════════
   SETTINGS TAB
   ═════════════════════════════════════════════════════════════════════ */

function SettingsTab({ address, metadata, health, healthData, showToast }: {
  address: string
  metadata: AgentMetadata
  health: HealthData
  healthData: Record<string, unknown>
  showToast: (msg: string) => void
}) {
  const [name, setName] = useState(metadata.displayName)
  const [isActive, setIsActive] = useState(
    typeof healthData.circleStatus === 'string' ? healthData.circleStatus === 'active' : true
  )
  const [isChurch, setIsChurch] = useState(health.isChurch)
  const [meetingFrequency, setMeetingFrequency] = useState(health.meetingFrequency ?? 'weekly')
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const router = useRouter()

  async function handleSave() {
    if (!name.trim()) return
    setSaving(true)
    try {
      await updateGroupHealth({
        address,
        name: name.trim(),
        leaderName: typeof healthData.leaderName === 'string' ? healthData.leaderName : undefined,
        location: typeof healthData.location === 'string' ? healthData.location : undefined,
        healthData: {
          ...healthData,
          isChurch,
          meetingFrequency,
        },
        status: isActive ? 'active' : 'inactive',
      })
      showToast('Settings saved')
      router.refresh()
    } catch {
      showToast('Failed to save settings')
    }
    setSaving(false)
  }

  return (
    <div style={{ maxWidth: 520 }}>
      {/* Church Name */}
      <div style={{ marginBottom: '0.75rem' }}>
        <label>
          <span style={lbl}>Church / Circle Name</span>
          <input value={name} onChange={e => setName(e.target.value)} style={inp} />
        </label>
      </div>

      {/* Is Active */}
      <div style={sectionBox}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155' }}>Is Active</span>
          <YesNo value={isActive} onChange={setIsActive} />
        </div>
      </div>

      {/* Is Church / Established */}
      <div style={sectionBox}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155' }}>Is Church / Established</span>
          <YesNo value={isChurch} onChange={setIsChurch} />
        </div>
      </div>

      {/* Meeting Frequency */}
      <div style={sectionBox}>
        <span style={sectionTitle}>Meeting Frequency</span>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {FREQUENCY_OPTIONS.map(f => {
            const active = meetingFrequency === f.value
            return (
              <button key={f.value} type="button" onClick={() => setMeetingFrequency(f.value)}
                style={{
                  padding: '0.3rem 0.65rem', borderRadius: 999, fontSize: '0.73rem', fontWeight: 500,
                  border: '1.5px solid', cursor: 'pointer', transition: 'all 0.15s',
                  background: active ? '#0d9488' : '#fff',
                  color: active ? '#fff' : '#64748b',
                  borderColor: active ? '#0d9488' : '#cbd5e1',
                }}>{f.label}</button>
            )
          })}
        </div>
      </div>

      {/* Save Button */}
      <button onClick={handleSave} disabled={saving || !name.trim()}
        style={{
          ...btnPrimary,
          width: '100%', padding: '0.55rem',
          opacity: saving || !name.trim() ? 0.5 : 1,
          marginBottom: '2rem',
        }}>
        {saving ? 'Saving...' : 'Save Settings'}
      </button>

      {/* Danger Zone */}
      <div style={{
        padding: '1rem', borderRadius: 8, border: '1px solid #fca5a5', background: '#fef2f2',
      }}>
        <span style={{ ...sectionTitle, color: '#dc2626' }}>Danger Zone</span>
        <p style={{ fontSize: '0.82rem', color: '#616161', margin: '0 0 0.75rem', lineHeight: 1.5 }}>
          Permanently delete this circle and all associated data. This action cannot be undone.
        </p>
        <button onClick={() => setDeleteConfirm(true)} style={btnDanger}>
          Delete Circle
        </button>
      </div>

      {/* Delete Confirmation */}
      {deleteConfirm && (
        <ModalOverlay onClose={() => setDeleteConfirm(false)}>
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem', color: '#333' }}>
            Delete Circle
          </h3>
          <p style={{ fontSize: '0.85rem', color: '#616161', lineHeight: 1.5, margin: '0 0 1.25rem' }}>
            Are you sure you want to permanently delete <strong>{metadata.displayName}</strong>?
            This action cannot be undone and all data associated with this circle will be lost.
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
            <button onClick={() => setDeleteConfirm(false)} style={btnSecondary}>Cancel</button>
            <button onClick={() => {
              setDeleteConfirm(false)
              showToast('Group deleted')
              router.push('/catalyst/groups')
            }} style={btnDanger}>Delete Circle</button>
          </div>
        </ModalOverlay>
      )}
    </div>
  )
}
