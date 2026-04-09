'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { deployPersonAgent } from '@/lib/actions/deploy-person-agent.action'

interface DeployPersonAgentClientProps {
  walletAddress: string
}

export function DeployPersonAgentClient({ walletAddress }: DeployPersonAgentClientProps) {
  const router = useRouter()
  const [deploying, setDeploying] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{
    agentId: string
    smartAccountAddress: string
  } | null>(null)

  async function handleDeploy() {
    setDeploying(true)
    setError('')

    const res = await deployPersonAgent()

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
        <h2>Person Agent Deployed</h2>
        <dl>
          <dt>Agent ID</dt>
          <dd><code>{result.agentId}</code></dd>
          <dt>Smart Account Address</dt>
          <dd data-component="address"><code>{result.smartAccountAddress}</code></dd>
          <dt>Owner (Your EOA)</dt>
          <dd data-component="address"><code>{walletAddress}</code></dd>
        </dl>
        <button onClick={() => router.push('/dashboard')}>Go to Dashboard</button>
      </div>
    )
  }

  return (
    <div data-component="deploy-form">
      <div data-component="deploy-details">
        <dl>
          <dt>Owner Wallet</dt>
          <dd><code>{walletAddress}</code></dd>
          <dt>Account Type</dt>
          <dd>AgentRootAccount (ERC-4337)</dd>
          <dt>Network</dt>
          <dd>Local Anvil (Chain 31337)</dd>
        </dl>
      </div>

      {error && (
        <p role="alert" data-component="error-message">{error}</p>
      )}

      <button onClick={handleDeploy} disabled={deploying}>
        {deploying ? 'Deploying...' : 'Deploy Person Agent'}
      </button>
    </div>
  )
}
