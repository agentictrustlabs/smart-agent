'use client'

import { useState } from 'react'
import Link from 'next/link'
import { createDetachedMember, deleteDetachedMember } from '@/lib/actions/members.action'

interface Member {
  address: string; name: string; roles: string[]; status: string; isPerson: boolean
}

interface DetachedMember {
  id: string; name: string; role: string | null; assignedNodeId: string | null; notes: string | null
}

interface GenNode {
  id: string; name: string
}

interface Props {
  members: Member[]
  detachedMembers: DetachedMember[]
  genNodes: GenNode[]
  orgAddress: string
  orgName: string
}

const PERMISSION_ROLES = [
  { value: 'admin', label: 'Administrator', desc: 'Can view and edit everything in the workspace' },
  { value: 'member', label: 'Team Member', desc: 'Default role — may have limited visibility of downstream data' },
  { value: 'viewer', label: 'Network Viewer', desc: 'Can see all downstream groups and activities but cannot edit' },
]

export function MembersClient({ members, detachedMembers, genNodes, orgAddress, orgName: _orgName }: Props) {
  const [showAddForm, setShowAddForm] = useState(false)
  const [dmName, setDmName] = useState('')
  const [dmRole, setDmRole] = useState('')
  const [dmNode, setDmNode] = useState('')
  const [dmNotes, setDmNotes] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleCreateDetached(e: React.FormEvent) {
    e.preventDefault(); setLoading(true)
    try {
      await createDetachedMember({
        orgAddress, name: dmName,
        assignedNodeId: dmNode || undefined,
        role: dmRole || undefined, notes: dmNotes || undefined,
      })
      window.location.reload()
    } catch { alert('Failed to create member') }
    finally { setLoading(false) }
  }

  async function handleDeleteDetached(id: string) {
    if (!confirm('Remove this tracked contact?')) return
    try { await deleteDetachedMember(id, orgAddress); window.location.reload() } catch { alert('Failed') }
  }

  return (
    <div>
      {/* Active Members (with accounts) */}
      <section data-component="graph-section">
        <h2>Team Members ({members.length})</h2>
        <p style={{ fontSize: '0.85rem', color: '#616161', marginBottom: '1rem' }}>
          People with accounts who have joined this organization. Manage invites on the <Link href="/team" style={{ color: '#1565c0' }}>Organization page</Link>.
        </p>
        {members.length === 0 ? (
          <p data-component="text-muted">No team members yet.</p>
        ) : (
          <table data-component="graph-table">
            <thead>
              <tr><th>Name</th><th>Roles</th><th>Permission Level</th><th>Status</th></tr>
            </thead>
            <tbody>
              {members.map(m => (
                <tr key={m.address}>
                  <td><Link href={`/agents/${m.address}`} style={{ color: '#1565c0', fontWeight: 600 }}>{m.name}</Link></td>
                  <td>{m.roles.map(r => <span key={r} data-component="role-badge" style={{ marginRight: 4 }}>{r}</span>)}</td>
                  <td>
                    <span data-component="role-badge" data-status="active" style={{ fontSize: '0.65rem' }}>
                      {m.roles.includes('owner') ? 'Administrator' : m.roles.includes('operator') ? 'Team Member' : 'Network Viewer'}
                    </span>
                  </td>
                  <td><span data-component="role-badge" data-status={m.status === 'Active' ? 'active' : 'proposed'}>{m.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Detached Members (tracked contacts) */}
      <section data-component="graph-section">
        <div data-component="section-header">
          <h2>Tracked Contacts ({detachedMembers.length})</h2>
          <button onClick={() => setShowAddForm(!showAddForm)} data-component="section-action">
            {showAddForm ? 'Cancel' : '+ Add Contact'}
          </button>
        </div>
        <p style={{ fontSize: '0.85rem', color: '#616161', marginBottom: '1rem' }}>
          People you are working with who don&apos;t have accounts yet. Track their involvement and progress.
          If they later join, their data can be transferred.
        </p>

        {/* Add form */}
        {showAddForm && (
          <form onSubmit={handleCreateDetached} data-component="protocol-info" style={{ marginBottom: '1rem', border: '2px solid #1565c0' }}>
            <h3>Add Tracked Contact</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
              <label>
                <span style={lblStyle}>Name</span>
                <input value={dmName} onChange={e => setDmName(e.target.value)} placeholder="Contact name" required style={inpStyle} />
              </label>
              <label>
                <span style={lblStyle}>Role / Description</span>
                <input value={dmRole} onChange={e => setDmRole(e.target.value)} placeholder="e.g. New believer, Seeker" style={inpStyle} />
              </label>
              <label>
                <span style={lblStyle}>Assigned Group</span>
                <select value={dmNode} onChange={e => setDmNode(e.target.value)} style={inpStyle}>
                  <option value="">Not assigned</option>
                  {genNodes.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                </select>
              </label>
            </div>
            <label style={{ display: 'block', marginTop: '0.75rem' }}>
              <span style={lblStyle}>Notes</span>
              <textarea value={dmNotes} onChange={e => setDmNotes(e.target.value)} rows={2} placeholder="Progress notes, contact info, next steps..."
                style={{ ...inpStyle, resize: 'vertical' }} />
            </label>
            <button type="submit" disabled={loading || !dmName} style={{ marginTop: '0.75rem' }}>
              {loading ? 'Creating...' : 'Add Contact'}
            </button>
          </form>
        )}

        {detachedMembers.length === 0 && !showAddForm ? (
          <p data-component="text-muted">No tracked contacts. Click &quot;+ Add Contact&quot; to start tracking people you&apos;re working with.</p>
        ) : (
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            {detachedMembers.map(dm => (
              <div key={dm.id} data-component="protocol-info" style={{ padding: '0.6rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#e3f2fd', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: '#1565c0', fontSize: '0.85rem', flexShrink: 0 }}>
                  {dm.name.charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{dm.name}</div>
                  <div style={{ fontSize: '0.75rem', color: '#616161', display: 'flex', gap: '0.75rem' }}>
                    {dm.role && <span>{dm.role}</span>}
                    {dm.assignedNodeId && <span>Group: {genNodes.find(n => n.id === dm.assignedNodeId)?.name ?? dm.assignedNodeId}</span>}
                  </div>
                  {dm.notes && <p style={{ fontSize: '0.8rem', color: '#424242', margin: '0.15rem 0 0' }}>{dm.notes}</p>}
                </div>
                <span data-component="role-badge" data-status="proposed" style={{ fontSize: '0.6rem' }}>no account</span>
                <button onClick={() => handleDeleteDetached(dm.id)} style={{ fontSize: '0.65rem', padding: '0.15rem 0.35rem', background: '#f5f5f5', border: '1px solid #e0e0e0', borderRadius: 4, cursor: 'pointer', color: '#b91c1c' }}>Remove</button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Permission Levels Reference */}
      <section data-component="graph-section">
        <h2>Permission Levels</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
          {PERMISSION_ROLES.map(r => (
            <div key={r.value} data-component="protocol-info" style={{ padding: '0.75rem 1rem' }}>
              <strong style={{ display: 'block', fontSize: '0.9rem', marginBottom: '0.25rem' }}>{r.label}</strong>
              <p style={{ fontSize: '0.8rem', color: '#616161', margin: 0 }}>{r.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

const lblStyle: React.CSSProperties = { fontSize: '0.8rem', color: '#616161', display: 'block', marginBottom: '0.15rem' }
const inpStyle: React.CSSProperties = { width: '100%', padding: '0.5rem', border: '1px solid #e2e4e8', borderRadius: 6, fontSize: '0.85rem' }
