'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { deployAIAgent } from '@/lib/actions/deploy-ai-agent.action'

const AI_TYPES = [
  { value: 'discovery', label: 'Discovery Agent', desc: 'Discovers and indexes information' },
  { value: 'assistant', label: 'Assistant Agent', desc: 'Helps users accomplish tasks' },
  { value: 'executor', label: 'Executor Agent', desc: 'Executes transactions and operations' },
  { value: 'validator', label: 'Validator Agent', desc: 'Validates data and attestations' },
  { value: 'oracle', label: 'Oracle Agent', desc: 'Provides external data feeds' },
  { value: 'custom', label: 'Custom Agent', desc: 'Custom agent type' },
]

interface OrgAgent { address: string; name: string }

export function DeployAIAgentClient({ orgAgents }: { orgAgents: OrgAgent[] }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [agentType, setAgentType] = useState('discovery')
  const [operatedBy, setOperatedBy] = useState(orgAgents[0]?.address ?? '')
  const [minOwners, setMinOwners] = useState('1')
  const [quorum, setQuorum] = useState('1')
  const [deploying, setDeploying] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ agentId: string; smartAccountAddress: string } | null>(null)

  async function handleDeploy(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('Agent name is required'); return }

    setDeploying(true)
    setError('')

    const res = await deployAIAgent({
      name, description, agentType,
      operatedByOrg: operatedBy,
      minOwners: Number(minOwners),
      quorum: Number(quorum),
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
        <h2>AI Agent Deployed</h2>
        <dl>
          <dt>Agent</dt><dd><strong>{name}</strong></dd>
          <dt>Type</dt><dd>{AI_TYPES.find((t) => t.value === agentType)?.label}</dd>
          <dt>Smart Account</dt><dd data-component="address"><code>{result.smartAccountAddress}</code></dd>
          {operatedBy && <><dt>Operated By</dt><dd>{orgAgents.find((o) => o.address === operatedBy)?.name}</dd></>}
        </dl>
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
          <button onClick={() => router.push(`/agents/${result.smartAccountAddress}`)}>Manage Agent</button>
          <button onClick={() => router.push('/dashboard')} style={{ background: 'var(--bg)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>Dashboard</button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleDeploy} data-component="deploy-form">
      <h3>Agent Details</h3>
      <div data-component="form-field">
        <label htmlFor="name">Agent Name</label>
        <input id="name" type="text" value={name} onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Agentic Trust Discovery Agent" required />
      </div>
      <div data-component="form-field">
        <label htmlFor="desc">Description</label>
        <textarea id="desc" value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="What does this AI agent do?" rows={2} />
      </div>

      <h3 style={{ marginTop: '1.5rem' }}>Agent Type</h3>
      <div data-component="graph-filter" style={{ flexWrap: 'wrap', marginBottom: '1rem' }}>
        {AI_TYPES.map((t) => (
          <button key={t.value} type="button" onClick={() => setAgentType(t.value)}
            data-component="filter-btn" data-active={agentType === t.value ? 'true' : 'false'}>
            {t.label}
          </button>
        ))}
      </div>
      <p style={{ fontSize: '0.8rem', color: '#8888a0' }}>
        {AI_TYPES.find((t) => t.value === agentType)?.desc}
      </p>

      {orgAgents.length > 0 && (
        <>
          <h3 style={{ marginTop: '1.5rem' }}>Operating Organization</h3>
          <p style={{ fontSize: '0.85rem', color: '#8888a0', marginBottom: '0.5rem' }}>
            Which organization operates this AI agent? An OrganizationalControl relationship will be created.
          </p>
          <div data-component="form-field">
            <select value={operatedBy} onChange={(e) => setOperatedBy(e.target.value)} data-component="org-select">
              <option value="">None (independent agent)</option>
              {orgAgents.map((o) => (
                <option key={o.address} value={o.address}>{o.name}</option>
              ))}
            </select>
          </div>
        </>
      )}

      <h3 style={{ marginTop: '1.5rem' }}>Governance</h3>
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

      {error && <p role="alert" data-component="error-message">{error}</p>}

      <button type="submit" disabled={deploying}>
        {deploying ? 'Deploying AI Agent...' : 'Deploy AI Agent'}
      </button>
    </form>
  )
}
