'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function JoinOrgClient() {
  const router = useRouter()
  const [inviteCode, setInviteCode] = useState('')
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [error, setError] = useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!inviteCode.trim()) return
    // Navigate to the invite accept page
    router.push(`/invite/${inviteCode.trim()}`)
  }

  return (
    <div>
      <h1 style={{ fontSize: '1.8rem', marginBottom: '0.5rem' }}>Join an Organization</h1>
      <p style={{ color: '#616161', marginBottom: '2rem' }}>
        Enter the invite code shared by your organization administrator.
        You&apos;ll be able to select your role and join the team.
      </p>

      <form onSubmit={handleSubmit} data-component="deploy-form" style={{ maxWidth: 400 }}>
        <div data-component="form-field">
          <label htmlFor="code">Invite Code</label>
          <input id="code" value={inviteCode} onChange={e => setInviteCode(e.target.value)}
            placeholder="e.g., a1b2c3d4" required
            style={{ fontFamily: 'monospace', fontSize: '1.1rem', letterSpacing: '0.1em' }} />
        </div>

        {error && <p role="alert" data-component="error-message">{error}</p>}

        <button type="submit">Join Organization</button>
      </form>

      <div style={{ marginTop: '2rem', textAlign: 'center' }}>
        <p style={{ color: '#666', fontSize: '0.85rem' }}>
          Want to create your own organization instead?{' '}
          <a href="/setup" style={{ color: '#1565c0' }}>Create Organization</a>
        </p>
      </div>
    </div>
  )
}
