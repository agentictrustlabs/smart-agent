'use client'

import { useState, useRef } from 'react'

interface Props {
  parentNode: string
  parentAgentName: string
  parentDisplayName: string
  onClose: () => void
  onCreated: () => void
}

const AGENT_TYPES = [
  { value: 'org', label: 'Organization', desc: 'Church, ministry, agency, or group', color: '#1565c0' },
  { value: 'person', label: 'Person', desc: 'Individual agent identity', color: '#2e7d32' },
  { value: 'ai', label: 'AI Agent', desc: 'Autonomous agent or service', color: '#7b1fa2' },
  { value: 'hub', label: 'Hub', desc: 'Network hub or aggregator', color: '#e65100' },
]

export function CreateAgentDialog({ parentNode, parentAgentName, parentDisplayName, onClose, onCreated }: Props) {
  const [nameLabel, setNameLabel] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [agentType, setAgentType] = useState('org')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const [nameChecking, setNameChecking] = useState(false)
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fullName = nameLabel ? `${nameLabel}.${parentAgentName}` : ''

  function handleNameChange(val: string) {
    const cleaned = val.toLowerCase().replace(/[^a-z0-9-]/g, '')
    setNameLabel(cleaned)
    setNameError(null)

    if (!cleaned) return
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(cleaned)) {
      setNameError('Alphanumeric + hyphens only, no leading/trailing hyphens')
      return
    }

    // Debounced availability check
    if (checkTimer.current) clearTimeout(checkTimer.current)
    setNameChecking(true)
    checkTimer.current = setTimeout(async () => {
      try {
        const checkName = `${cleaned}.${parentAgentName}`
        const res = await fetch(`/api/naming/check?name=${encodeURIComponent(checkName)}`)
        const data = await res.json()
        if (data.exists) setNameError(`"${checkName}" is already registered`)
      } catch { /* */ }
      setNameChecking(false)
    }, 400)
  }

  async function handleCreate() {
    if (!nameLabel || !displayName || nameError) return
    setSaving(true)
    setError(null)
    try {
      const { createAgentFromExplorer } = await import('@/lib/actions/create-agent-from-explorer.action')
      const result = await createAgentFromExplorer({
        nameLabel, parentNode, parentAgentName, displayName, description, agentType,
      })
      if (!result.success) {
        setError(result.error ?? 'Creation failed')
      } else {
        onCreated()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Creation failed')
    }
    setSaving(false)
  }

  const selectedType = AGENT_TYPES.find(t => t.value === agentType)!

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.4)',
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#fff', borderRadius: 16, width: 480, maxHeight: '85vh',
        overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.2)', padding: '1.5rem',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '1.1rem', color: '#5c4a3a' }}>Create Agent</h2>
            <div style={{ fontSize: '0.78rem', color: '#9a8c7e', marginTop: '0.15rem' }}>
              Under <strong style={{ fontFamily: 'monospace', color: '#8b5e3c' }}>{parentAgentName}</strong> ({parentDisplayName})
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: '#9a8c7e' }}>✕</button>
        </div>

        {/* Agent Type Selector */}
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#5c4a3a', display: 'block', marginBottom: '0.35rem' }}>Type</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
            {AGENT_TYPES.map(t => (
              <button key={t.value} onClick={() => setAgentType(t.value)} style={{
                padding: '0.5rem 0.65rem', borderRadius: 8, cursor: 'pointer',
                border: agentType === t.value ? `2px solid ${t.color}` : '2px solid #ece6db',
                background: agentType === t.value ? `${t.color}08` : '#fff',
                textAlign: 'left',
              }}>
                <div style={{ fontWeight: 600, fontSize: '0.82rem', color: agentType === t.value ? t.color : '#5c4a3a' }}>{t.label}</div>
                <div style={{ fontSize: '0.68rem', color: '#9a8c7e' }}>{t.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* .agent Name */}
        <div style={{ marginBottom: '1rem', padding: '0.65rem', background: '#faf8f3', borderRadius: 8, border: '1px solid #ece6db' }}>
          <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#8b5e3c', display: 'block', marginBottom: '0.35rem' }}>.agent Name *</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
            <input
              value={nameLabel}
              onChange={e => handleNameChange(e.target.value)}
              placeholder="label"
              style={{
                padding: '0.45rem 0.5rem', border: '1px solid #e2e4e8',
                borderTopLeftRadius: 6, borderBottomLeftRadius: 6, borderRight: 'none',
                fontFamily: 'monospace', width: 140, fontSize: '0.85rem',
              }}
            />
            <span style={{
              padding: '0.45rem 0.5rem', background: '#f0ebe3', border: '1px solid #e2e4e8',
              borderTopRightRadius: 6, borderBottomRightRadius: 6,
              fontSize: '0.82rem', color: '#9a8c7e', fontFamily: 'monospace', whiteSpace: 'nowrap',
            }}>
              .{parentAgentName}
            </span>
          </div>
          {fullName && !nameError && (
            <div style={{ fontSize: '0.72rem', color: '#8b5e3c', fontFamily: 'monospace', marginTop: '0.25rem' }}>
              {nameChecking ? 'Checking availability...' : `✓ ${fullName}`}
            </div>
          )}
          {nameError && <div style={{ fontSize: '0.72rem', color: '#c62828', marginTop: '0.25rem' }}>{nameError}</div>}
        </div>

        {/* Display Name */}
        <div style={{ marginBottom: '0.75rem' }}>
          <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#5c4a3a', display: 'block', marginBottom: '0.25rem' }}>Display Name *</label>
          <input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="e.g., Grace Community Church" style={{
            width: '100%', padding: '0.45rem 0.5rem', border: '1px solid #e2e4e8', borderRadius: 6, fontSize: '0.85rem',
          }} />
        </div>

        {/* Description */}
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ fontSize: '0.78rem', fontWeight: 600, color: '#5c4a3a', display: 'block', marginBottom: '0.25rem' }}>Description</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Brief description of this agent..." rows={3} style={{
            width: '100%', padding: '0.45rem 0.5rem', border: '1px solid #e2e4e8', borderRadius: 6, fontSize: '0.85rem', resize: 'vertical',
          }} />
        </div>

        {/* Error */}
        {error && (
          <div style={{ padding: '0.5rem 0.75rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#991b1b', fontSize: '0.82rem', marginBottom: '0.75rem' }}>
            {error}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={handleCreate} disabled={saving || !nameLabel || !displayName || !!nameError}
            style={{
              flex: 1, padding: '0.6rem', background: saving || !nameLabel || !displayName || nameError ? '#ccc' : '#8b5e3c',
              color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: '0.88rem',
              cursor: saving || !nameLabel || !displayName || nameError ? 'not-allowed' : 'pointer',
            }}>
            {saving ? 'Deploying...' : 'Create Agent'}
          </button>
          <button onClick={onClose} style={{
            padding: '0.6rem 1.25rem', background: '#f0ebe3', color: '#5c4a3a',
            border: 'none', borderRadius: 8, fontWeight: 500, cursor: 'pointer',
          }}>
            Cancel
          </button>
        </div>

        {/* Info */}
        <div style={{ marginTop: '0.75rem', fontSize: '0.72rem', color: '#9a8c7e', lineHeight: 1.5 }}>
          This will deploy a new ERC-4337 smart account, register it in the on-chain resolver with the metadata above,
          and register <strong style={{ fontFamily: 'monospace' }}>{fullName || '...'}</strong> in the .agent namespace.
        </div>
      </div>
    </div>
  )
}
