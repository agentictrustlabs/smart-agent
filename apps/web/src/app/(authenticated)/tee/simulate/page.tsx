export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { SimulateTeeClient } from './SimulateTeeClient'
import { getControlledAgentsForUser } from '@/lib/agent-resolver'

export default async function SimulateTeeValidationPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  const verifierAddress = process.env.MOCK_TEE_VERIFIER_ADDRESS ?? '0x0'

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
      <div data-page="simulate-tee">
        <div data-component="page-header">
          <h1>TEE Attestation Simulator</h1>
        </div>
        <div data-component="empty-state">
          <p>No agents available. Deploy an agent first.</p>
        </div>
      </div>
    )
  }

  return (
    <div data-page="simulate-tee">
      <div data-component="page-header">
        <h1>TEE Attestation Simulator</h1>
        <p>Simulate a TEE attestation for development. Provide your agent&apos;s code, kernel, and config
          — the simulator computes PCR-like measurements, calls the MockTeeVerifier contract on-chain,
          and records the validation in AgentValidationProfile.</p>
      </div>

      <SimulateTeeClient agents={agents} verifierAddress={verifierAddress} />
    </div>
  )
}
