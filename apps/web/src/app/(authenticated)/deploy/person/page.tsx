import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { DeployPersonAgentClient } from './DeployPersonAgentClient'
import Link from 'next/link'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { getAgentMetadata } from '@/lib/agent-metadata'

export default async function DeployPersonAgentPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  // Check if already deployed
  const existingAddress = await getPersonAgentForUser(currentUser.id)

  if (existingAddress) {
    const existingMeta = await getAgentMetadata(existingAddress)
    return (
      <div data-page="deploy-person">
        <div data-component="page-header">
          <h1>Person Agent Already Deployed</h1>
          <p>You already have a person agent.</p>
        </div>
        <div data-component="agent-card" data-status="deployed">
          <h3>{existingMeta.displayName || 'Person Agent'}</h3>
          <dl>
            <dt>Smart Account</dt>
            <dd data-component="address">{existingAddress}</dd>
            <dt>Status</dt>
            <dd data-status="deployed">deployed</dd>
          </dl>
        </div>
        <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
          <Link href="/dashboard">Dashboard</Link>
          <Link href={`/agents/${existingAddress}`}>Settings</Link>
        </div>
      </div>
    )
  }

  return (
    <div data-page="deploy-person">
      <div data-component="page-header">
        <h1>Deploy Person Agent</h1>
        <p>Create your personal ERC-4337 smart account. This is your on-chain agent identity.</p>
      </div>

      <div data-component="deploy-info">
        <h2>What you get</h2>
        <ul>
          <li>ERC-4337 smart account (AgentAccount)</li>
          <li>ERC-1271 signature validation</li>
          <li>Programmable delegation with caveats</li>
          <li>Session key support for agent runtime</li>
        </ul>
      </div>

      <DeployPersonAgentClient walletAddress={currentUser.walletAddress} userName={currentUser.name} />
    </div>
  )
}
