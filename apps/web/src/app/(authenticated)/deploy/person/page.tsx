import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { DeployPersonAgentClient } from './DeployPersonAgentClient'

export default async function DeployPersonAgentPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  return (
    <div data-page="deploy-person">
      <div data-component="page-header">
        <h1>Deploy Person Agent</h1>
        <p>
          Create your personal ERC-4337 smart account (AgentRootAccount).
          This account will serve as your on-chain agent identity.
        </p>
      </div>

      <div data-component="deploy-info">
        <h2>What you get</h2>
        <ul>
          <li>ERC-4337 smart account (AgentRootAccount)</li>
          <li>ERC-1271 signature validation</li>
          <li>Programmable delegation with caveats</li>
          <li>Session key support for agent runtime</li>
          <li>Deterministic CREATE2 deployment</li>
        </ul>
      </div>

      <DeployPersonAgentClient walletAddress={currentUser.walletAddress} />
    </div>
  )
}
