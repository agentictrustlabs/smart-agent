'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { deployPersonAgent } from '@/lib/actions/deploy-person-agent.action'

interface DeployPersonAgentClientProps {
  walletAddress: string
  userName: string
}

export function DeployPersonAgentClient({ walletAddress, userName }: DeployPersonAgentClientProps) {
  const router = useRouter()
  const [agentName, setAgentName] = useState(`${userName}'s Agent`)
  const [deploying, setDeploying] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{
    agentId: string
    smartAccountAddress: string
  } | null>(null)

  async function handleDeploy(e: React.FormEvent) {
    e.preventDefault()
    if (!agentName.trim()) { setError('Agent name is required'); return }

    setDeploying(true)
    setError('')

    const res = await deployPersonAgent(agentName.trim())

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
        <h2>Person Agent Deployed</h2>
        <dl>
          <dt>Agent Name</dt>
          <dd><strong>{agentName}</strong></dd>
          <dt>Smart Account</dt>
          <dd data-component="address"><code>{result.smartAccountAddress}</code></dd>
          <dt>Owner (Your EOA)</dt>
          <dd data-component="address"><code>{walletAddress}</code></dd>
        </dl>
        <button onClick={() => router.push('/dashboard')}>Go to Dashboard</button>
      </div>
    )
  }

  return (
    <form onSubmit={handleDeploy} data-component="deploy-form">
      <div data-component="form-field">
        <label htmlFor="agent-name">Agent Name</label>
        <input
          id="agent-name"
          type="text"
          value={agentName}
          onChange={(e) => setAgentName(e.target.value)}
          placeholder="e.g. Alice's Discovery Agent"
          required
        />
      </div>

      <div data-component="deploy-details">
        <dl>
          <dt>Owner Wallet</dt>
          <dd><code>{walletAddress}</code></dd>
          <dt>Account Type</dt>
          <dd>AgentRootAccount (ERC-4337)</dd>
        </dl>
      </div>

      {error && <p role="alert" data-component="error-message">{error}</p>}

      <button type="submit" disabled={deploying}>
        {deploying ? 'Deploying...' : 'Deploy Person Agent'}
      </button>
    </form>
  )
}
