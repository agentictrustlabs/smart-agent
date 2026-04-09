'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { deployOrgAgent } from '@/lib/actions/deploy-org-agent.action'

export function DeployOrgAgentClient() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [deploying, setDeploying] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{
    agentId: string
    smartAccountAddress: string
  } | null>(null)

  async function handleDeploy(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setError('Organization name is required')
      return
    }

    setDeploying(true)
    setError('')

    const res = await deployOrgAgent({ name, description })

    setDeploying(false)

    if (res.success && res.agentId && res.smartAccountAddress) {
      setResult({
        agentId: res.agentId,
        smartAccountAddress: res.smartAccountAddress,
      })
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
          <dt>Agent ID</dt>
          <dd><code>{result.agentId}</code></dd>
          <dt>Smart Account Address</dt>
          <dd data-component="address"><code>{result.smartAccountAddress}</code></dd>
        </dl>
        <button onClick={() => router.push('/dashboard')}>Go to Dashboard</button>
      </div>
    )
  }

  return (
    <form onSubmit={handleDeploy} data-component="deploy-form">
      <div data-component="form-field">
        <label htmlFor="org-name">Organization Name</label>
        <input
          id="org-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Agentic Trust Labs"
          required
        />
      </div>

      <div data-component="form-field">
        <label htmlFor="org-desc">Description (optional)</label>
        <textarea
          id="org-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What does this organization do?"
          rows={3}
        />
      </div>

      {error && (
        <p role="alert" data-component="error-message">{error}</p>
      )}

      <button type="submit" disabled={deploying}>
        {deploying ? 'Deploying...' : 'Deploy Organization Agent'}
      </button>
    </form>
  )
}
