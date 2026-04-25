'use client'

import { useState, useEffect, useRef } from 'react'
import { useAuth } from '@/hooks/use-auth'
import { useRouter } from 'next/navigation'

export function UserDropdown() {
  const { authenticated, ready, user, login, logout } = useAuth()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [smartAccount, setSmartAccount] = useState<string | null>(null)
  const [userName, setUserName] = useState<string | null>(null)
  const [primaryName, setPrimaryName] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!authenticated) return
    fetch('/api/auth/profile')
      .then((r) => r.json())
      .then((d) => {
        setSmartAccount(d.smartAccountAddress ?? null)
        setUserName(d.name ?? null)
        setPrimaryName(d.primaryName ?? null)
        setEditName(d.name ?? '')
      })
      .catch(() => {})
  }, [authenticated])

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { setOpen(false); setEditing(false) }
    }
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setEditing(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKeyDown)
    return () => { document.removeEventListener('mousedown', handleClick); document.removeEventListener('keydown', handleKeyDown) }
  }, [])

  async function handleDisconnect() {
    setDisconnecting(true)
    setOpen(false)
    // logout() now handles wallet_revokePermissions for SIWE sessions — see
    // useAuth in @/hooks/use-auth.ts.
    try {
      await logout()
    } catch { /* ignore */ }
    router.push('/')
  }

  async function handleSaveName() {
    if (!editName.trim()) return
    setSaving(true)
    const res = await fetch('/api/auth/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: editName.trim() }),
    })
    const data = await res.json()
    setSaving(false)
    if (data.success) {
      setUserName(data.name)
      setEditing(false)
      router.refresh()
    }
  }

  if (!ready) {
    return <div data-component="user-dropdown-trigger" data-state="loading">...</div>
  }

  if (!authenticated) {
    return (
      <button onClick={login} data-component="user-dropdown-trigger" data-state="disconnected">
        Connect Wallet
      </button>
    )
  }

  const walletAddress = user?.walletAddress ?? ''
  const shortWallet = walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : ''
  // Prefer the .agent primary name, then the human display name, then the
  // shortened wallet address. The .agent name is the canonical handle once
  // a user has registered one, so it surfaces wherever we show "the user".
  const displayName = primaryName || userName || shortWallet

  return (
    <div ref={ref} data-component="user-dropdown">
      <button
        onClick={() => setOpen(!open)}
        data-component="user-dropdown-trigger"
        data-state="connected"
      >
        <span data-component="user-avatar">{displayName[0].toUpperCase()}</span>
        <span data-component="user-display-name">{displayName}</span>
        <span data-component="dropdown-arrow">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div data-component="user-dropdown-menu">
          {/* Profile Name */}
          <div data-component="dropdown-section">
            <label>Name</label>
            {editing ? (
              <div data-component="edit-name-row">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  data-component="edit-name-input"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSaveName() }}
                />
                <button data-component="save-btn" onClick={handleSaveName} disabled={saving}>
                  {saving ? '...' : 'Save'}
                </button>
                <button data-component="cancel-btn" onClick={() => { setEditing(false); setEditName(userName ?? '') }}>
                  Cancel
                </button>
              </div>
            ) : (
              <div data-component="name-display-row">
                <strong>{userName ?? 'Not set'}</strong>
                <button data-component="edit-btn" onClick={() => setEditing(true)}>Edit</button>
              </div>
            )}
          </div>

          {/* EOA */}
          <div data-component="dropdown-section">
            <label>EOA Wallet</label>
            <code data-component="dropdown-address">{walletAddress}</code>
            <button data-component="copy-btn" onClick={() => navigator.clipboard.writeText(walletAddress)}>Copy</button>
          </div>

          {/* Smart Account */}
          {smartAccount && (
            <div data-component="dropdown-section">
              <label>Smart Account (4337)</label>
              <code data-component="dropdown-address">{smartAccount}</code>
              <button data-component="copy-btn" onClick={() => navigator.clipboard.writeText(smartAccount)}>Copy</button>
            </div>
          )}

          <div data-component="dropdown-divider" />

          <button data-component="dropdown-disconnect" onClick={handleDisconnect} disabled={disconnecting}>
            {disconnecting ? 'Disconnecting...' : 'Disconnect'}
          </button>
        </div>
      )}
    </div>
  )
}
