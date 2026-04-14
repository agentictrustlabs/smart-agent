import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { DeployAIAgentClient } from './DeployAIAgentClient'
import { getOrgsCreatedByUser } from '@/lib/agent-registry'
import { getAgentMetadata } from '@/lib/agent-metadata'

export default async function DeployAIAgentPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  // Get user's org agents (to select which org operates the AI agent)
  const orgAddresses = await getOrgsCreatedByUser(currentUser.id)
  const orgAgents = await Promise.all(
    orgAddresses.map(async (address) => {
      const meta = await getAgentMetadata(address)
      return { address, name: meta.displayName }
    })
  )

  return (
    <div data-page="deploy-ai">
      <div data-component="page-header">
        <h1>Deploy AI Agent</h1>
        <p>Create an autonomous AI agent with its own ERC-4337 smart account.
           The AI agent can be operated by an organization and have its own trust relationships.</p>
      </div>

      <div data-component="deploy-info">
        <h2>What you get</h2>
        <ul>
          <li>Autonomous AI agent with ERC-4337 smart account</li>
          <li>Multi-sig governance (configurable owners + quorum)</li>
          <li>Organizational control relationship (operated-by)</li>
          <li>Trust graph integration (validators, reviewers, TEE attestation)</li>
          <li>Delegation-based permissions via templates</li>
        </ul>
      </div>

      <DeployAIAgentClient
        orgAgents={orgAgents}
      />
    </div>
  )
}
