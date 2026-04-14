'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
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

/* ── Toast Component ─────────────────────────────────────────────── */
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

/* ── Modal Overlay ───────────────────────────────────────────────── */
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

/* ── Team Role Constants ─────────────────────────────────────────── */
const TEAM_ROLES = ['Administrator', 'Team Network Viewer', 'Team Viewer'] as const
const CONTACT_ROLES = ['Seeker', 'Believer', 'Baptized Believer', 'Leader'] as const

/* ── Workspace role helpers ──────────────────────────────────────── */
function isWorkspaceRole(r: string) {
  const lower = r.toLowerCase()
  return lower.includes('workspace') || lower.includes('org') || lower.includes('owner')
}

/* ── Main Component ──────────────────────────────────────────────── */
export function MemberManager({ members, detached, groups, orgAddress }: Props) {
  const [tab, setTab] = useState<'team' | 'contacts'>('team')

  // Team state
  const [teamSearch, setTeamSearch] = useState('')
  const [showFrozen, setShowFrozen] = useState(false)
  const [kebabOpen, setKebabOpen] = useState(false)
  const [createMemberOpen, setCreateMemberOpen] = useState(false)
  const [createMemberName, setCreateMemberName] = useState('')
  const [creatingSaving, setCreatingSaving] = useState(false)
  const [editMember, setEditMember] = useState<Member | null>(null)
  const [editRoles, setEditRoles] = useState<string[]>([])
  const [removeMemberConfirm, setRemoveMemberConfirm] = useState<Member | null>(null)

  // Contacts state
  const [contactSearch, setContactSearch] = useState('')
  const [showAddContact, setShowAddContact] = useState(false)
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [assignedGroup, setAssignedGroup] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [editContact, setEditContact] = useState<DetachedMember | null>(null)
  const [editContactRole, setEditContactRole] = useState('')
  const [editContactNotes, setEditContactNotes] = useState('')
  const [editContactGroup, setEditContactGroup] = useState('')
  const [removeContactConfirm, setRemoveContactConfirm] = useState<DetachedMember | null>(null)

  // Toast
  const [toast, setToast] = useState<string | null>(null)
  const showToast = useCallback((msg: string) => setToast(msg), [])
  const dismissToast = useCallback(() => setToast(null), [])

  // Kebab menu ref for click-outside
  const kebabRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!kebabOpen) return
    function handleClick(e: MouseEvent) {
      if (kebabRef.current && !kebabRef.current.contains(e.target as Node)) setKebabOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [kebabOpen])

  /* ── Team filters ──────────────────────────────────────────────── */
  const filteredMembers = members.filter(m => {
    if (!showFrozen && m.status === 'Frozen') return false
    if (teamSearch.trim()) {
      const q = teamSearch.toLowerCase()
      return m.name.toLowerCase().includes(q) || m.roles.some(r => r.toLowerCase().includes(q))
    }
    return true
  })

  /* ── Contact filters ───────────────────────────────────────────── */
  const filteredContacts = detached.filter(d => {
    if (!contactSearch.trim()) return true
    const q = contactSearch.toLowerCase()
    return d.name.toLowerCase().includes(q) || (d.role ?? '').toLowerCase().includes(q)
  })

  /* ── Handlers ──────────────────────────────────────────────────── */
  async function handleCreateDetachedTeamMember() {
    if (!createMemberName.trim()) return
    setCreatingSaving(true)
    try {
      await createDetachedMember({ orgAddress, name: createMemberName.trim() })
      setCreateMemberOpen(false)
      setCreateMemberName('')
      showToast('Member Created')
      window.location.reload()
    } catch { showToast('Failed to create member') }
    setCreatingSaving(false)
  }

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
      setShowAddContact(false); setName(''); setRole(''); setAssignedGroup(''); setNotes('')
      showToast('Contact added')
      window.location.reload()
    } catch { showToast('Failed to add contact') }
    setSaving(false)
  }

  async function handleDeleteContact(id: string) {
    try {
      await deleteDetachedMember(id, orgAddress)
      showToast('Contact removed')
      window.location.reload()
    } catch { showToast('Failed to remove contact') }
  }

  function openEditMember(m: Member) {
    setEditMember(m)
    setEditRoles([...m.roles.filter(r => TEAM_ROLES.includes(r as typeof TEAM_ROLES[number]))])
  }

  function openEditContact(d: DetachedMember) {
    setEditContact(d)
    setEditContactRole(d.role ?? '')
    setEditContactNotes(d.notes ?? '')
    setEditContactGroup(d.assignedNodeId ?? '')
  }

  /* ── Shared styles ─────────────────────────────────────────────── */
  const searchStyle: React.CSSProperties = {
    width: '100%', padding: '0.45rem 0.5rem 0.45rem 2rem',
    border: '1px solid #e2e4e8', borderRadius: 6, fontSize: '0.85rem',
    outline: 'none', background: '#fff',
  }

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

  return (
    <div>
      {/* ── Tab bar ──────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1rem' }}>
        <button onClick={() => setTab('team')} style={{
          padding: '0.4rem 1rem', borderRadius: 6, border: '1px solid #e2e4e8', cursor: 'pointer',
          background: tab === 'team' ? '#0d9488' : '#fff',
          color: tab === 'team' ? '#fff' : '#616161', fontWeight: 600, fontSize: '0.85rem',
        }}>
          Team ({members.length})
        </button>
        <button onClick={() => setTab('contacts')} style={{
          padding: '0.4rem 1rem', borderRadius: 6, border: '1px solid #e2e4e8', cursor: 'pointer',
          background: tab === 'contacts' ? '#0d9488' : '#fff',
          color: tab === 'contacts' ? '#fff' : '#616161', fontWeight: 600, fontSize: '0.85rem',
        }}>
          Tracked Contacts ({detached.length})
        </button>
      </div>

      {/* ═══════════════════════════════════════════════════════
          TEAM TAB
          ═══════════════════════════════════════════════════════ */}
      {tab === 'team' && (
        <div>
          {/* Search + kebab row */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'center' }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', fontSize: '0.85rem', color: '#9e9e9e', pointerEvents: 'none' }}>Q</span>
              <input
                value={teamSearch} onChange={e => setTeamSearch(e.target.value)}
                placeholder="Search members..." style={searchStyle}
              />
            </div>

            {/* Kebab menu */}
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
                  <Link href="/team" onClick={() => setKebabOpen(false)} style={{
                    display: 'block', padding: '0.55rem 0.85rem', fontSize: '0.85rem',
                    color: '#333', textDecoration: 'none', borderBottom: '1px solid #f0f1f3',
                  }}>
                    + Add Members
                  </Link>
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

          {/* Show Frozen checkbox */}
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
                <button onClick={handleCreateDetachedTeamMember} disabled={creatingSaving || !createMemberName.trim()} style={btnPrimary}>
                  {creatingSaving ? 'Creating...' : 'Create'}
                </button>
                <button onClick={() => { setCreateMemberOpen(false); setCreateMemberName('') }} style={btnSecondary}>Cancel</button>
              </div>
            </div>
          )}

          {/* Members table */}
          {filteredMembers.length === 0 ? (
            <p style={{ color: '#616161', textAlign: 'center', padding: '2rem' }}>
              {members.length === 0
                ? 'No team members yet. Invite people using the Team page.'
                : 'No members match your search.'}
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 8, overflow: 'hidden' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Name</th>
                    <th style={thStyle}>Role</th>
                    <th style={{ ...thStyle, textAlign: 'center', width: 100 }}>Has Account</th>
                    <th style={{ ...thStyle, textAlign: 'center', width: 80 }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMembers.map(m => {
                    const isFrozen = m.status === 'Frozen'
                    const opacity = isFrozen ? 0.5 : 1
                    const workspaceRoles = m.roles.filter(isWorkspaceRole)
                    const teamRoles = m.roles.filter(r => !isWorkspaceRole(r))

                    return (
                      <tr
                        key={m.address}
                        onClick={() => openEditMember(m)}
                        style={{ cursor: 'pointer', opacity, transition: 'background 0.15s' }}
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
                          {workspaceRoles.map(r => (
                            <span key={r} style={{ fontSize: '0.75rem', color: '#0d9488', fontStyle: 'italic', marginRight: '0.35rem' }}>{r}</span>
                          ))}
                          {teamRoles.map(r => (
                            <span key={r} style={{ fontSize: '0.75rem', color: '#616161', marginRight: '0.35rem' }}>{r}</span>
                          ))}
                          {m.roles.length === 0 && <span style={{ fontSize: '0.75rem', color: '#9e9e9e' }}>--</span>}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          {m.isPerson ? (
                            <span style={{ color: '#16a34a', fontWeight: 700, fontSize: '1rem' }}>&#10003;</span>
                          ) : (
                            <span style={{ color: '#dc2626', fontWeight: 700, fontSize: '1rem' }}>&#10007;</span>
                          )}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          <span style={{
                            fontSize: '0.7rem', padding: '0.15rem 0.4rem', borderRadius: 4, fontWeight: 600,
                            background: m.status === 'Active' ? '#2e7d3210' : m.status === 'Frozen' ? '#9e9e9e15' : '#f59e0b10',
                            color: m.status === 'Active' ? '#2e7d32' : m.status === 'Frozen' ? '#9e9e9e' : '#f59e0b',
                          }}>
                            {m.status}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
          CONTACTS TAB
          ═══════════════════════════════════════════════════════ */}
      {tab === 'contacts' && (
        <div>
          {/* Search + Add button */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.6rem', alignItems: 'center' }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', fontSize: '0.85rem', color: '#9e9e9e', pointerEvents: 'none' }}>Q</span>
              <input
                value={contactSearch} onChange={e => setContactSearch(e.target.value)}
                placeholder="Search contacts..." style={searchStyle}
              />
            </div>
            <button onClick={() => setShowAddContact(true)} style={btnPrimary}>+ Add Contact</button>
          </div>

          {/* Add contact form */}
          {showAddContact && (
            <div style={{
              padding: '0.85rem', background: '#fafafa', borderRadius: 8,
              border: '1px solid #0d948830', marginBottom: '0.75rem',
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Name *"
                  style={{ padding: '0.4rem', border: '1px solid #e2e4e8', borderRadius: 6, fontSize: '0.85rem' }} />
                <select value={role} onChange={e => setRole(e.target.value)}
                  style={{ padding: '0.4rem', border: '1px solid #e2e4e8', borderRadius: 6, fontSize: '0.85rem' }}>
                  <option value="">Role...</option>
                  {CONTACT_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <select value={assignedGroup} onChange={e => setAssignedGroup(e.target.value)}
                  style={{ padding: '0.4rem', border: '1px solid #e2e4e8', borderRadius: 6, fontSize: '0.85rem' }}>
                  <option value="">Assign to group...</option>
                  {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
                <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Notes"
                  style={{ padding: '0.4rem', border: '1px solid #e2e4e8', borderRadius: 6, fontSize: '0.85rem' }} />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button onClick={handleAddContact} disabled={saving || !name.trim()} style={btnPrimary}>
                  {saving ? 'Saving...' : 'Add'}
                </button>
                <button onClick={() => setShowAddContact(false)} style={btnSecondary}>Cancel</button>
              </div>
            </div>
          )}

          {/* Contacts table */}
          {filteredContacts.length === 0 && !showAddContact ? (
            <p style={{ color: '#616161', textAlign: 'center', padding: '2rem' }}>
              {detached.length === 0
                ? 'No tracked contacts. Add people you are connecting with.'
                : 'No contacts match your search.'}
            </p>
          ) : filteredContacts.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 8, overflow: 'hidden' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Name</th>
                    <th style={thStyle}>Role</th>
                    <th style={thStyle}>Group</th>
                    <th style={thStyle}>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredContacts.map(d => (
                    <tr
                      key={d.id}
                      onClick={() => openEditContact(d)}
                      style={{ cursor: 'pointer', transition: 'background 0.15s' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#f8fffe')}
                      onMouseLeave={e => (e.currentTarget.style.background = '')}
                    >
                      <td style={tdStyle}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <div style={{
                            width: 28, height: 28, borderRadius: '50%',
                            background: '#ea580c10', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: '#ea580c', fontWeight: 700, fontSize: '0.7rem', flexShrink: 0,
                          }}>
                            {d.name.charAt(0)}
                          </div>
                          <span style={{ fontWeight: 600, color: '#333', fontSize: '0.85rem' }}>{d.name}</span>
                        </div>
                      </td>
                      <td style={{ ...tdStyle, fontSize: '0.8rem', color: '#616161' }}>{d.role ?? '--'}</td>
                      <td style={{ ...tdStyle, fontSize: '0.8rem', color: '#0d9488' }}>
                        {d.assignedNodeId ? (groups.find(g => g.id === d.assignedNodeId)?.name ?? 'Assigned') : '--'}
                      </td>
                      <td style={{ ...tdStyle, fontSize: '0.78rem', color: '#9e9e9e', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {d.notes ?? '--'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
          EDIT MEMBER DIALOG
          ═══════════════════════════════════════════════════════ */}
      {editMember && (
        <ModalOverlay onClose={() => setEditMember(null)}>
          <h3 style={{ margin: '0 0 0.25rem', fontSize: '1rem', color: '#333' }}>
            Edit Church Member
          </h3>
          <p style={{ margin: '0 0 0.75rem', fontSize: '0.78rem', color: '#9e9e9e' }}>
            {editMember.name} &middot; {editMember.address.slice(0, 8)}...
          </p>

          {/* Detached warning */}
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

          {/* Role checkboxes */}
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

          {/* Buttons */}
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

      {/* ═══════════════════════════════════════════════════════
          REMOVE MEMBER CONFIRMATION
          ═══════════════════════════════════════════════════════ */}
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

      {/* ═══════════════════════════════════════════════════════
          EDIT CONTACT DIALOG
          ═══════════════════════════════════════════════════════ */}
      {editContact && (
        <ModalOverlay onClose={() => setEditContact(null)}>
          <h3 style={{ margin: '0 0 0.25rem', fontSize: '1rem', color: '#333' }}>
            Edit Contact
          </h3>
          <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem', color: '#616161' }}>
            {editContact.name}
          </p>

          <div style={{ marginBottom: '0.5rem' }}>
            <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#616161', display: 'block', marginBottom: '0.25rem' }}>Role</label>
            <select value={editContactRole} onChange={e => setEditContactRole(e.target.value)}
              style={{ width: '100%', padding: '0.4rem', border: '1px solid #e2e4e8', borderRadius: 6, fontSize: '0.85rem' }}>
              <option value="">None</option>
              {CONTACT_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          <div style={{ marginBottom: '0.5rem' }}>
            <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#616161', display: 'block', marginBottom: '0.25rem' }}>Group</label>
            <select value={editContactGroup} onChange={e => setEditContactGroup(e.target.value)}
              style={{ width: '100%', padding: '0.4rem', border: '1px solid #e2e4e8', borderRadius: 6, fontSize: '0.85rem' }}>
              <option value="">None</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#616161', display: 'block', marginBottom: '0.25rem' }}>Notes</label>
            <input value={editContactNotes} onChange={e => setEditContactNotes(e.target.value)}
              style={{ width: '100%', padding: '0.4rem', border: '1px solid #e2e4e8', borderRadius: 6, fontSize: '0.85rem' }} />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button onClick={() => { setEditContact(null); setRemoveContactConfirm(editContact) }} style={btnDanger}>
              Remove
            </button>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button onClick={() => setEditContact(null)} style={btnSecondary}>Close</button>
              <button onClick={() => { setEditContact(null); showToast('Contact updated') }} style={btnPrimary}>Save</button>
            </div>
          </div>
        </ModalOverlay>
      )}

      {/* ═══════════════════════════════════════════════════════
          REMOVE CONTACT CONFIRMATION
          ═══════════════════════════════════════════════════════ */}
      {removeContactConfirm && (
        <ModalOverlay onClose={() => setRemoveContactConfirm(null)}>
          <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem', color: '#333' }}>
            Remove Contact
          </h3>
          <p style={{ fontSize: '0.85rem', color: '#616161', lineHeight: 1.5, margin: '0 0 1.25rem' }}>
            Are you sure you want to remove <strong>{removeContactConfirm.name}</strong>?
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
            <button onClick={() => setRemoveContactConfirm(null)} style={btnSecondary}>Cancel</button>
            <button onClick={() => {
              handleDeleteContact(removeContactConfirm.id)
              setRemoveContactConfirm(null)
            }} style={btnDanger}>Remove Contact</button>
          </div>
        </ModalOverlay>
      )}

      {/* ── Toast ─────────────────────────────────────────────── */}
      {toast && <Toast message={toast} onDismiss={dismissToast} />}
    </div>
  )
}
