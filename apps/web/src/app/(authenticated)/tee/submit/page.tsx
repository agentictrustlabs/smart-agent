export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { SubmitTeeValidationClient } from './SubmitTeeValidationClient'
import { getControlledAgentsForUser } from '@/lib/agent-resolver'

export default async function SubmitTeeValidationPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  // Get all agents the user can validate (agents they own or operate)
  const controlledAgents = await getControlledAgentsForUser(currentUser.id)

  const agents: Array<{ address: string; name: string }> = []
  for (const agent of controlledAgents) {
    agents.push({
      address: agent.address,
      name: agent.kind === 'ai' ? `${agent.name} (AI)` : agent.name,
    })
  }

  if (agents.length === 0) {
    return (
      <div data-page="submit-tee-validation">
        <div data-component="page-header">
          <h1>Record TEE Validation</h1>
        </div>
        <div data-component="empty-state">
          <p>No agents available. Deploy an agent first.</p>
        </div>
      </div>
    )
  }

  return (
    <div data-page="submit-tee-validation">
      <div data-component="page-header">
        <h1>Record TEE Validation</h1>
        <p>Record a TEE attestation for an agent running in a Trusted Execution Environment.
          The attestation proves the agent&apos;s code integrity through hardware-backed measurements.</p>
      </div>

      <SubmitTeeValidationClient agents={agents} />
    </div>
  )
}
