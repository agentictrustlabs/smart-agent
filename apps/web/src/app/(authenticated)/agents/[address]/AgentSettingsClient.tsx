'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface Person { userId: string; name: string; walletAddress: string; smartAccountAddress: string }

interface AgentSettingsClientProps {
  agentAddress: string
  agentName: string
  controlAddress: string
  governanceInitialized: boolean
  governanceConfig: { minOwners: number; quorum: number; isBootstrap: boolean }
  governanceOwners: string[]
}

export function AgentSettingsClient({
  agentAddress, agentName, controlAddress: _controlAddress,
  governanceInitialized, governanceConfig, governanceOwners,
}: AgentSettingsClientProps) {
  const router = useRouter()
  const [minOwners, setMinOwners] = useState('1')
  const [quorum, setQuorum] = useState('1')
  const [acting, setActing] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  // Person selector
  const [people, setPeople] = useState<Person[]>([])
  const [selectedPerson, setSelectedPerson] = useState('')
  const [newOwnerAddr, setNewOwnerAddr] = useState('')
  const [addMode, setAddMode] = useState<'select' | 'address' | 'invite'>('select')

  // Invite
  const [inviteLink, setInviteLink] = useState('')

  useEffect(() => {
    fetch('/api/agents/people').then((r) => r.json()).then((d) => setPeople(d.people ?? [])).catch(() => {})
  }, [])

  async function handleInitialize(e: React.FormEvent) {
    e.preventDefault()
    setActing(true); setError(''); setMessage('')
    const res = await fetch('/api/agents/governance', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'initialize', agentAddress, minOwners: Number(minOwners), quorum: Number(quorum) }),
    })
    const data = await res.json()
    setActing(false)
    if (data.success) { setMessage('Governance initialized'); router.refresh() }
    else setError(data.error ?? 'Failed')
  }

  async function handleInvitePerson(walletAddress: string, personName?: string) {
    if (!walletAddress.trim()) return
    setActing(true); setError(''); setMessage('')

    // Create a pending invite — person must accept before becoming co-owner
    const res = await fetch('/api/invites', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentAddress, agentName, role: 'owner' }),
    })
    const data = await res.json()

    if (!data.success) { setActing(false); setError(data.error ?? 'Failed'); return }

    // Send notification to the person to accept
    const person = people.find((p) => p.walletAddress.toLowerCase() === walletAddress.toLowerCase())
    if (person) {
      await fetch('/api/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: person.userId,
          type: 'ownership_offered',
          title: `Invitation: Co-owner of ${agentName}`,
          body: `You've been invited to become a co-owner of ${agentName}. Click to review and accept.`,
          link: `/invite/${data.code}`,
        }),
      })
    }

    setActing(false)
    setMessage(`Invite sent to ${personName ?? walletAddress.slice(0, 10)}... — they must accept before becoming co-owner`)
    setSelectedPerson('')
    setInviteLink(data.link)
    router.refresh()
  }

  async function handleAddOwnerByAddress(address: string) {
    if (!address.trim()) return
    setActing(true); setError(''); setMessage('')

    // For raw address: generate invite link (no direct add)
    const res = await fetch('/api/invites', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentAddress, agentName, role: 'owner' }),
    })
    const data = await res.json()
    setActing(false)

    if (data.success) {
      setMessage(`Invite created. Share the link — they must accept to become co-owner.`)
      setInviteLink(data.link)
      setNewOwnerAddr('')
    } else setError(data.error ?? 'Failed')
  }

  async function handleGenerateInvite() {
    setActing(true); setError(''); setInviteLink('')
    const res = await fetch('/api/invites', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentAddress, agentName, role: 'owner' }),
    })
    const data = await res.json()
    setActing(false)
    if (data.success) { setInviteLink(data.link); setMessage(`Invite created (expires ${new Date(data.expiresAt).toLocaleDateString()})`) }
    else setError(data.error ?? 'Failed')
  }

  // Filter out people who are already owners
  const ownerSet = new Set(governanceOwners.map((a) => a.toLowerCase()))
  const availablePeople = people.filter((p) => !ownerSet.has(p.walletAddress.toLowerCase()))

  return (
    <div>
      <section data-component="graph-section">
        <h2>Governance</h2>
        {governanceInitialized ? (
          <div>
            <dl style={{ fontSize: '0.9rem' }}>
              <dt>Status</dt>
              <dd>
                <span data-component="role-badge" data-status={governanceConfig.isBootstrap ? 'proposed' : 'active'}>
                  {governanceConfig.isBootstrap ? 'Bootstrap (needs more owners)' : 'Active'}
                </span>
              </dd>
              <dt>Min Owners</dt><dd>{governanceConfig.minOwners}</dd>
              <dt>Quorum</dt><dd>{governanceConfig.quorum} of {governanceOwners.length}</dd>
              <dt>Owners ({governanceOwners.length})</dt>
              <dd>
                {governanceOwners.map((addr, i) => (
                  <div key={i} data-component="address" style={{ marginBottom: '0.25rem' }}>{addr}</div>
                ))}
              </dd>
            </dl>

            {/* Add Co-Owner */}
            <div style={{ marginTop: '1.5rem', padding: '1rem', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
              <h3 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Add Co-Owner</h3>

              <div data-component="graph-filter" style={{ marginBottom: '1rem' }}>
                <button type="button" onClick={() => setAddMode('select')} data-component="filter-btn" data-active={addMode === 'select' ? 'true' : 'false'}>
                  Select Person ({availablePeople.length})
                </button>
                <button type="button" onClick={() => setAddMode('address')} data-component="filter-btn" data-active={addMode === 'address' ? 'true' : 'false'}>
                  By Address
                </button>
                <button type="button" onClick={() => setAddMode('invite')} data-component="filter-btn" data-active={addMode === 'invite' ? 'true' : 'false'}>
                  Invite Link
                </button>
              </div>

              {addMode === 'select' && (
                <div>
                  {availablePeople.length === 0 ? (
                    <p style={{ color: '#616161', fontSize: '0.85rem' }}>No available people to add. Use "By Address" or "Invite Link".</p>
                  ) : (
                    <div data-component="form-field">
                      <label>Select a person</label>
                      <select value={selectedPerson} onChange={(e) => setSelectedPerson(e.target.value)} data-component="org-select">
                        <option value="">Choose...</option>
                        {availablePeople.map((p) => (
                          <option key={p.userId} value={p.walletAddress}>{p.name} ({p.walletAddress.slice(0, 6)}...{p.walletAddress.slice(-4)})</option>
                        ))}
                      </select>
                      <button type="button" disabled={!selectedPerson || acting} onClick={() => {
                        const p = availablePeople.find((x) => x.walletAddress === selectedPerson)
                        handleInvitePerson(selectedPerson, p?.name)
                      }} style={{ marginTop: '0.5rem' }}>
                        {acting ? 'Sending invite...' : 'Invite as Co-Owner'}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {addMode === 'address' && (
                <div data-component="form-field">
                  <label>EOA Address</label>
                  <input type="text" value={newOwnerAddr} onChange={(e) => setNewOwnerAddr(e.target.value)} placeholder="0x..." />
                  <p style={{ fontSize: '0.75rem', color: '#616161', margin: '0.25rem 0' }}>
                    An invite link will be generated — the person must accept to become co-owner.
                  </p>
                  <button type="button" disabled={!newOwnerAddr.trim() || acting} onClick={() => handleAddOwnerByAddress(newOwnerAddr)}
                    style={{ marginTop: '0.5rem' }}>
                    {acting ? 'Creating invite...' : 'Generate Invite'}
                  </button>
                </div>
              )}

              {addMode === 'invite' && (
                <div>
                  <p style={{ color: '#616161', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                    Generate an invite link to share. When someone opens it, connects their wallet, and accepts,
                    they'll be added as a co-owner of this agent.
                  </p>
                  <button type="button" onClick={handleGenerateInvite} disabled={acting}>
                    {acting ? 'Generating...' : 'Generate Invite Link'}
                  </button>
                  {inviteLink && (
                    <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: 'var(--bg-card)', border: '1px solid var(--accent)', borderRadius: '8px' }}>
                      <label style={{ fontSize: '0.75rem', color: '#616161' }}>Share this link (expires in 7 days)</label>
                      <input type="text" readOnly value={inviteLink} onClick={(e) => (e.target as HTMLInputElement).select()} style={{ marginTop: '0.25rem' }} />
                      <button type="button" onClick={() => navigator.clipboard.writeText(inviteLink)} data-component="copy-btn" style={{ marginTop: '0.25rem' }}>Copy</button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {error && <p role="alert" data-component="error-message" style={{ marginTop: '0.5rem' }}>{error}</p>}
            {message && <p data-component="success-message" style={{ marginTop: '0.5rem' }}>{message}</p>}
          </div>
        ) : (
          <form onSubmit={handleInitialize} data-component="deploy-form">
            <p style={{ color: '#616161', marginBottom: '1rem' }}>
              Set up multi-sig governance for this agent.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div data-component="form-field">
                <label htmlFor="min-owners">Minimum Owners</label>
                <input id="min-owners" type="number" min="1" max="10" value={minOwners} onChange={(e) => setMinOwners(e.target.value)} />
              </div>
              <div data-component="form-field">
                <label htmlFor="quorum">Quorum</label>
                <input id="quorum" type="number" min="1" max="10" value={quorum} onChange={(e) => setQuorum(e.target.value)} />
              </div>
            </div>
            <button type="submit" disabled={acting}>{acting ? 'Initializing...' : 'Initialize Governance'}</button>
            {error && <p role="alert" data-component="error-message">{error}</p>}
          </form>
        )}
      </section>
    </div>
  )
}
