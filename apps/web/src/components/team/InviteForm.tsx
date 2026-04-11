'use client'

import { useState } from 'react'

interface RoleOption {
  key: string
  label: string
  description: string
}

export function InviteForm({ agentAddress, agentName, roles }: {
  agentAddress: string; agentName: string; roles: RoleOption[]
}) {
  const [selectedRole, setSelectedRole] = useState(roles[0]?.key ?? 'member')
  const [creating, setCreating] = useState(false)
  const [inviteCode, setInviteCode] = useState('')
  const [error, setError] = useState('')

  async function handleCreate() {
    setCreating(true)
    setError('')
    setInviteCode('')

    try {
      const res = await fetch('/api/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentAddress,
          agentName,
          role: selectedRole,
        }),
      })

      const data = await res.json()
      if (res.ok && data.code) {
        setInviteCode(data.code)
      } else {
        setError(data.error ?? 'Failed to create invitation')
      }
    } catch {
      setError('Failed to create invitation')
    }
    setCreating(false)
  }

  const selectedRoleInfo = roles.find(r => r.key === selectedRole)

  return (
    <div data-component="protocol-info">
      <h3>Invite a New Member</h3>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap', marginTop: '0.5rem' }}>
        <div style={{ flex: '1 1 200px' }}>
          <label style={{ display: 'block', fontSize: '0.8rem', color: '#616161', marginBottom: '0.25rem' }}>Role</label>
          <select
            value={selectedRole}
            onChange={e => setSelectedRole(e.target.value)}
            style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid #e2e4e8', background: '#fff', color: '#1a1a2e', fontSize: '0.9rem' }}
          >
            {roles.map(r => (
              <option key={r.key} value={r.key}>{r.label}</option>
            ))}
          </select>
          {selectedRoleInfo && (
            <p style={{ fontSize: '0.75rem', color: '#616161', marginTop: '0.2rem' }}>{selectedRoleInfo.description}</p>
          )}
        </div>
        <button onClick={handleCreate} disabled={creating} style={{ whiteSpace: 'nowrap' }}>
          {creating ? 'Creating...' : 'Create Invitation'}
        </button>
      </div>

      {error && <p data-component="error-message" style={{ marginTop: '0.5rem' }}>{error}</p>}

      {inviteCode && (
        <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6 }}>
          <p style={{ fontSize: '0.85rem', color: '#2e7d32', fontWeight: 600, marginBottom: '0.25rem' }}>Invitation created</p>
          <p style={{ fontSize: '0.8rem', color: '#616161', marginBottom: '0.5rem' }}>
            Share this link with the person you want to invite as <strong>{selectedRole}</strong>:
          </p>
          <code style={{
            display: 'block', padding: '0.5rem', background: '#fff', border: '1px solid #e2e4e8',
            borderRadius: 4, fontSize: '0.85rem', wordBreak: 'break-all',
          }}>
            {typeof window !== 'undefined' ? window.location.origin : ''}/invite/{inviteCode}
          </code>
        </div>
      )}
    </div>
  )
}
