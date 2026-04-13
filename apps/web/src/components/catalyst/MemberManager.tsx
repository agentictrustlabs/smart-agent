'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createDetachedMember, deleteDetachedMember } from '@/lib/actions/members.action'

interface Member { address: string; name: string; roles: string[]; status: string; isPerson: boolean }
interface DetachedMember { id: string; name: string; role: string | null; assignedNodeId: string | null; notes: string | null }
interface GroupOption { id: string; name: string }

interface Props {
  members: Member[]
  detached: DetachedMember[]
  groups: GroupOption[]
  orgAddress: string
}

export function MemberManager({ members, detached, groups, orgAddress }: Props) {
  const [tab, setTab] = useState<'team' | 'contacts'>('team')
  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [assignedGroup, setAssignedGroup] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleAddContact() {
    if (!name.trim()) return
    setSaving(true)
    try {
      await createDetachedMember({
        orgAddress,
        name: name.trim(),
        role: role || undefined,
        assignedNodeId: assignedGroup || undefined,
        notes: notes || undefined,
      })
      setShowAdd(false); setName(''); setRole(''); setAssignedGroup(''); setNotes('')
      window.location.reload()
    } catch { alert('Failed') }
    setSaving(false)
  }

  async function handleDeleteContact(id: string) {
    if (!confirm('Remove this contact?')) return
    await deleteDetachedMember(id)
    window.location.reload()
  }

  return (
    <div>
      {/* Tab bar */}
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1rem' }}>
        <button onClick={() => setTab('team')} style={{ padding: '0.4rem 1rem', borderRadius: 6, border: '1px solid #e2e4e8', cursor: 'pointer', background: tab === 'team' ? '#0d9488' : '#fff', color: tab === 'team' ? '#fff' : '#616161', fontWeight: 600, fontSize: '0.85rem' }}>
          Team ({members.length})
        </button>
        <button onClick={() => setTab('contacts')} style={{ padding: '0.4rem 1rem', borderRadius: 6, border: '1px solid #e2e4e8', cursor: 'pointer', background: tab === 'contacts' ? '#0d9488' : '#fff', color: tab === 'contacts' ? '#fff' : '#616161', fontWeight: 600, fontSize: '0.85rem' }}>
          Tracked Contacts ({detached.length})
        </button>
      </div>

      {/* Team members */}
      {tab === 'team' && (
        <div>
          {members.length === 0 ? (
            <p style={{ color: '#616161', textAlign: 'center', padding: '2rem' }}>No team members yet. Invite people using the Team page.</p>
          ) : (
            <div style={{ display: 'grid', gap: '0.5rem' }}>
              {members.map(m => (
                <div key={m.address} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.5rem 0.75rem', background: '#fff', borderRadius: 6, border: '1px solid #f0f1f3' }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#1565c015', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1565c0', fontWeight: 700, fontSize: '0.8rem', flexShrink: 0 }}>
                    {m.name.charAt(0)}
                  </div>
                  <div style={{ flex: 1 }}>
                    <Link href={`/agents/${m.address}`} style={{ fontWeight: 600, color: '#1565c0', fontSize: '0.9rem' }}>{m.name}</Link>
                    <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.15rem' }}>
                      {m.roles.map(r => <span key={r} style={{ fontSize: '0.6rem', padding: '0.1rem 0.3rem', background: '#f5f5f5', borderRadius: 3, color: '#616161' }}>{r}</span>)}
                    </div>
                  </div>
                  <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.4rem', borderRadius: 4, background: m.status === 'Active' ? '#2e7d3210' : '#f59e0b10', color: m.status === 'Active' ? '#2e7d32' : '#f59e0b', fontWeight: 600 }}>{m.status}</span>
                </div>
              ))}
            </div>
          )}
          <div style={{ marginTop: '1rem' }}>
            <Link href="/team" style={{ color: '#0d9488', fontWeight: 600, fontSize: '0.85rem' }}>Manage invitations on Team page →</Link>
          </div>
        </div>
      )}

      {/* Tracked contacts */}
      {tab === 'contacts' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <p style={{ fontSize: '0.8rem', color: '#616161', margin: 0 }}>People you're tracking who don't have accounts.</p>
            <button onClick={() => setShowAdd(true)}
              style={{ padding: '0.35rem 0.75rem', background: '#0d9488', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer' }}>
              + Add Contact
            </button>
          </div>

          {showAdd && (
            <div style={{ padding: '0.75rem', background: '#fafafa', borderRadius: 8, border: '1px solid #0d948830', marginBottom: '0.75rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Name *" style={{ padding: '0.4rem', border: '1px solid #e2e4e8', borderRadius: 6, fontSize: '0.85rem' }} />
                <input value={role} onChange={e => setRole(e.target.value)} placeholder="Role (seeker, believer...)" style={{ padding: '0.4rem', border: '1px solid #e2e4e8', borderRadius: 6, fontSize: '0.85rem' }} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <select value={assignedGroup} onChange={e => setAssignedGroup(e.target.value)} style={{ padding: '0.4rem', border: '1px solid #e2e4e8', borderRadius: 6, fontSize: '0.85rem' }}>
                  <option value="">Assign to group...</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
                <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes" style={{ padding: '0.4rem', border: '1px solid #e2e4e8', borderRadius: 6, fontSize: '0.85rem' }} />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button onClick={handleAddContact} disabled={saving || !name.trim()} style={{ padding: '0.4rem 1rem', background: '#0d9488', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer' }}>{saving ? 'Saving...' : 'Add'}</button>
                <button onClick={() => setShowAdd(false)} style={{ padding: '0.4rem 0.75rem', background: '#e0e0e0', border: 'none', borderRadius: 6, cursor: 'pointer' }}>Cancel</button>
              </div>
            </div>
          )}

          {detached.length === 0 && !showAdd ? (
            <p style={{ color: '#616161', textAlign: 'center', padding: '2rem' }}>No tracked contacts. Add people you're connecting with.</p>
          ) : (
            <div style={{ display: 'grid', gap: '0.35rem' }}>
              {detached.map(d => (
                <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.6rem', background: '#fff', borderRadius: 6, border: '1px solid #f0f1f3' }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#ea580c10', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ea580c', fontWeight: 700, fontSize: '0.75rem', flexShrink: 0 }}>
                    {d.name.charAt(0)}
                  </div>
                  <div style={{ flex: 1 }}>
                    <strong style={{ fontSize: '0.85rem' }}>{d.name}</strong>
                    {d.role && <span style={{ fontSize: '0.7rem', color: '#616161', marginLeft: '0.35rem' }}>{d.role}</span>}
                    {d.notes && <p style={{ fontSize: '0.7rem', color: '#9e9e9e', margin: '0.1rem 0 0' }}>{d.notes}</p>}
                  </div>
                  {d.assignedNodeId && (
                    <span style={{ fontSize: '0.6rem', color: '#0d9488', padding: '0.1rem 0.3rem', background: '#0d948810', borderRadius: 3 }}>
                      {groups.find(g => g.id === d.assignedNodeId)?.name ?? 'assigned'}
                    </span>
                  )}
                  <button onClick={() => handleDeleteContact(d.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.7rem', color: '#b91c1c' }}>✕</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
