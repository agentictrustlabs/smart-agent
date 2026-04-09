import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPublicClient } from '@/lib/contracts'
import { agentControlAbi, agentRootAccountAbi } from '@smart-agent/sdk'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { toDidEthr } from '@smart-agent/sdk'
import { AgentSettingsClient } from './AgentSettingsClient'

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')

export default async function AgentSettingsPage({
  params,
}: {
  params: Promise<{ address: string }>
}) {
  const { address } = await params
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  const agentAddress = address as `0x${string}`
  const client = getPublicClient()
  const controlAddr = process.env.AGENT_CONTROL_ADDRESS as `0x${string}`

  // Get agent name from DB
  let agentName = 'Unknown Agent'
  let agentType = 'unknown'
  const personAgent = await db.select().from(schema.personAgents)
    .where(eq(schema.personAgents.smartAccountAddress, agentAddress)).limit(1)
  if (personAgent[0]) {
    agentName = (personAgent[0] as Record<string, unknown>).name as string || 'Person Agent'
    agentType = 'person'
  }
  const orgAgent = await db.select().from(schema.orgAgents)
    .where(eq(schema.orgAgents.smartAccountAddress, agentAddress)).limit(1)
  if (orgAgent[0]) {
    agentName = orgAgent[0].name
    agentType = 'org'
  }

  // Get on-chain owner info from AgentRootAccount
  let onChainOwners: string[] = []
  let ownerCount = 0
  try {
    ownerCount = Number(await client.readContract({
      address: agentAddress,
      abi: agentRootAccountAbi,
      functionName: 'ownerCount',
    }))
  } catch { /* not deployed */ }

  // Check AgentControl governance
  let governanceInitialized = false
  let governanceConfig = { minOwners: 0, quorum: 0, isBootstrap: false }
  let governanceOwners: string[] = []

  if (controlAddr) {
    try {
      governanceInitialized = (await client.readContract({
        address: controlAddr,
        abi: agentControlAbi,
        functionName: 'isInitialized',
        args: [agentAddress],
      })) as boolean

      if (governanceInitialized) {
        const config = (await client.readContract({
          address: controlAddr,
          abi: agentControlAbi,
          functionName: 'getConfig',
          args: [agentAddress],
        })) as { minOwners: bigint; quorum: bigint; isBootstrap: boolean }
        governanceConfig = {
          minOwners: Number(config.minOwners),
          quorum: Number(config.quorum),
          isBootstrap: config.isBootstrap,
        }

        governanceOwners = (await client.readContract({
          address: controlAddr,
          abi: agentControlAbi,
          functionName: 'getOwners',
          args: [agentAddress],
        })) as string[]
      }
    } catch { /* not deployed */ }
  }

  return (
    <div data-page="agent-settings">
      <div data-component="page-header">
        <h1>{agentName}</h1>
        <p>Agent governance and ownership settings</p>
        <code data-component="did">{toDidEthr(CHAIN_ID, agentAddress)}</code>
      </div>

      <div data-component="agent-card" data-status="deployed">
        <dl>
          <dt>Address</dt>
          <dd data-component="address">{agentAddress}</dd>
          <dt>Type</dt>
          <dd>{agentType}</dd>
          <dt>On-Chain Owners</dt>
          <dd>{ownerCount}</dd>
        </dl>
      </div>

      <AgentSettingsClient
        agentAddress={agentAddress}
        agentName={agentName}
        controlAddress={controlAddr}
        governanceInitialized={governanceInitialized}
        governanceConfig={governanceConfig}
        governanceOwners={governanceOwners}
      />
    </div>
  )
}
