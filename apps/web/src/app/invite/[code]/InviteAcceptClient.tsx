'use client'

import { useState } from 'react'
import { useAuth } from '@/hooks/use-auth'
import { useRouter } from 'next/navigation'

interface InviteAcceptClientProps {
  code: string
  agentName: string
  role: string
}

export function InviteAcceptClient({ code, agentName, role }: InviteAcceptClientProps) {
  const { authenticated, ready, login, user } = useAuth()
  const router = useRouter()
  const [accepting, setAccepting] = useState(false)
  const [error, setError] = useState('')
  const [accepted, setAccepted] = useState(false)

  async function handleAccept() {
    if (!user?.walletAddress) return
    setAccepting(true)
    setError('')

    // Ensure user exists
    await fetch('/api/auth/ensure-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: user.walletAddress,
        email: user.email ?? null,
        name: user.name ?? 'Agent User',
      }),
    })

    // Accept invite
    const res = await fetch(`/api/invites/${code}/accept`, { method: 'POST' })
    const data = await res.json()
    setAccepting(false)

    if (data.success) {
      setAccepted(true)
      setTimeout(() => router.push('/dashboard'), 2000)
    } else {
      setError(data.error ?? 'Failed to accept invite')
    }
  }

  if (!ready) return <p style={{ marginTop: '1rem', color: '#616161' }}>Loading...</p>

  if (accepted) {
    return (
      <div style={{ marginTop: '1.5rem' }}>
        <p style={{ color: '#2e7d32', fontWeight: 600 }}>Accepted! You are now a {role} of {agentName}.</p>
        <p style={{ color: '#616161', fontSize: '0.85rem' }}>Redirecting to dashboard...</p>
      </div>
    )
  }

  if (!authenticated) {
    return (
      <div style={{ marginTop: '1.5rem' }}>
        <p style={{ color: '#616161', marginBottom: '1rem' }}>Connect your wallet to accept this invite.</p>
        <button onClick={login} data-component="connect-wallet-btn" data-state="disconnected">
          Connect Wallet
        </button>
      </div>
    )
  }

  return (
    <div style={{ marginTop: '1.5rem' }}>
      <p style={{ color: '#616161', marginBottom: '0.5rem' }}>
        Connected as {user?.walletAddress?.slice(0, 6)}...{user?.walletAddress?.slice(-4)}
      </p>
      {error && <p role="alert" data-component="error-message">{error}</p>}
      <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
        <button onClick={handleAccept} disabled={accepting} data-component="connect-wallet-btn" data-state="connected">
          {accepting ? 'Accepting...' : `Accept — Become ${role}`}
        </button>
        <button onClick={() => router.push('/')} disabled={accepting} data-component="connect-wallet-btn" data-state="loading"
          style={{ background: 'rgba(239,68,68,0.15)', borderColor: 'rgba(239,68,68,0.4)', color: '#fca5a5' }}>
          Decline
        </button>
      </div>
    </div>
  )
}
