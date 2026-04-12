export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { db, schema } from '@/db'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { SimulateTeeClient } from './SimulateTeeClient'

export default async function SimulateTeeValidationPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  const verifierAddress = process.env.MOCK_TEE_VERIFIER_ADDRESS ?? '0x0'

  const allOrgs = await db.select().from(schema.orgAgents)
  const allAI = await db.select().from(schema.aiAgents)

  const agents: Array<{ address: string; name: string }> = []
  for (const org of allOrgs) agents.push({ address: org.smartAccountAddress, name: org.name })
  for (const ai of allAI) agents.push({ address: ai.smartAccountAddress, name: `${ai.name} (AI)` })

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
