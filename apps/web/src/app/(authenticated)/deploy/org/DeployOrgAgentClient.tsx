'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { deployOrgAgent } from '@/lib/actions/deploy-org-agent.action'

export function DeployOrgAgentClient() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [minOwners, setMinOwners] = useState('1')
  const [quorum, setQuorum] = useState('1')
  const [deploying, setDeploying] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{
    agentId: string
    smartAccountAddress: string
  } | null>(null)

  async function handleDeploy(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Organization name is required'); return }

    setDeploying(true)
    setError('')

    const res = await deployOrgAgent({
      name,
      description,
      minOwners: Number(minOwners),
      quorum: Number(quorum),
      coOwners: [], // no hardcoded co-owners — use invite flow after creation
    })

    setDeploying(false)

    if (res.success && res.agentId && res.smartAccountAddress) {
      setResult({ agentId: res.agentId, smartAccountAddress: res.smartAccountAddress })
    } else {
      setError(res.error ?? 'Deployment failed')
    }
  }

  if (result) {
    return (
      <div data-component="deploy-success">
        <h2>Organization Agent Deployed</h2>
        <dl>
          <dt>Organization</dt>
          <dd><strong>{name}</strong></dd>
          <dt>Smart Account</dt>
          <dd data-component="address"><code>{result.smartAccountAddress}</code></dd>
          <dt>Governance</dt>
          <dd>Min owners: {minOwners}, Quorum: {quorum}</dd>
        </dl>
        <p style={{ color: '#616161', fontSize: '0.85rem', margin: '1rem 0' }}>
          {Number(minOwners) > 1
            ? `This agent is in bootstrap mode — invite ${Number(minOwners) - 1} more co-owner(s) to activate governance.`
            : 'Governance is active. You can invite co-owners from the settings page.'}
        </p>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={() => router.push(`/agents/${result.smartAccountAddress}`)}>
            Invite Co-Owners
          </button>
          <button onClick={() => router.push('/dashboard')} style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
            Dashboard
          </button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleDeploy} data-component="deploy-form">
      <h3>Organization Details</h3>
      <div data-component="form-field">
        <label htmlFor="org-name">Organization Name</label>
        <input id="org-name" type="text" value={name} onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Agentic Trust Labs" required />
      </div>
      <div data-component="form-field">
        <label htmlFor="org-desc">Description (optional)</label>
        <textarea id="org-desc" value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="What does this organization do?" rows={2} />
      </div>

      <h3 style={{ marginTop: '1.5rem' }}>Multi-Sig Governance</h3>
      <p style={{ fontSize: '0.85rem', color: '#616161', marginBottom: '1rem' }}>
        Configure how many owners are required and what quorum is needed.
        You are the first owner. Invite co-owners after creation from the agent settings page.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <div data-component="form-field">
          <label htmlFor="min-owners">Minimum Owners</label>
          <input id="min-owners" type="number" min="1" max="10" value={minOwners}
            onChange={(e) => setMinOwners(e.target.value)} />
          <p style={{ fontSize: '0.7rem', color: '#616161' }}>
            Agent stays in bootstrap until this many owners accept invites
          </p>
        </div>
        <div data-component="form-field">
          <label htmlFor="quorum">Quorum</label>
          <input id="quorum" type="number" min="1" max="10" value={quorum}
            onChange={(e) => setQuorum(e.target.value)} />
          <p style={{ fontSize: '0.7rem', color: '#616161' }}>
            Votes needed to approve proposals
          </p>
        </div>
      </div>

      {error && <p role="alert" data-component="error-message">{error}</p>}

      <button type="submit" disabled={deploying}>
        {deploying ? 'Deploying + setting up governance...' : 'Deploy Organization Agent'}
      </button>
    </form>
  )
}
