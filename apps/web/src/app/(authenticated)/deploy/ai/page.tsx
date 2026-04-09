import { redirect } from 'next/navigation'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { DeployAIAgentClient } from './DeployAIAgentClient'

export default async function DeployAIAgentPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  // Get user's org agents (to select which org operates the AI agent)
  const orgAgents = await db.select().from(schema.orgAgents)
    .where(eq(schema.orgAgents.createdBy, currentUser.id))

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
        orgAgents={orgAgents.map((o) => ({ address: o.smartAccountAddress, name: o.name }))}
      />
    </div>
  )
}
