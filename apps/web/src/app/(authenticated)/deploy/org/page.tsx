import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { DeployOrgAgentClient } from './DeployOrgAgentClient'

export default async function DeployOrgAgentPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  return (
    <div data-page="deploy-org">
      <div data-component="page-header">
        <h1>Deploy Organization Agent</h1>
        <p>
          Create an organization-level ERC-4337 smart account.
          This account can hold funds, execute transactions, and delegate
          authority to member agents via caveats.
        </p>
      </div>

      <div data-component="deploy-info">
        <h2>What you get</h2>
        <ul>
          <li>Organization ERC-4337 smart account (AgentRootAccount)</li>
          <li>Multi-owner support (add team members later)</li>
          <li>Delegation framework for scoped permissions</li>
          <li>Session keys for automated agent operations</li>
          <li>Deterministic CREATE2 deployment</li>
        </ul>
      </div>

      <DeployOrgAgentClient />
    </div>
  )
}
