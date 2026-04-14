import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getAgentMetadata } from '@/lib/agent-metadata'
import { getPublicClient } from '@/lib/contracts'
import { agentAccountResolverAbi, ATL_GENMAP_DATA } from '@smart-agent/sdk'
import { getOrgMembers } from '@/lib/get-org-members'
import { getTrackedMembers } from '@/lib/agent-resolver'
import { ChurchDetailClient } from './ChurchDetailClient'

interface Props {
  params: Promise<{ address: string }>
}

export default async function ChurchDetailPage({ params }: Props) {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  const { address } = await params

  // Load agent metadata
  const metadata = await getAgentMetadata(address)

  // Read health data from on-chain resolver
  const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
  const client = getPublicClient()
  let healthData: Record<string, unknown> = {}
  if (resolverAddr) {
    try {
      const json = await client.readContract({
        address: resolverAddr,
        abi: agentAccountResolverAbi,
        functionName: 'getStringProperty',
        args: [address as `0x${string}`, ATL_GENMAP_DATA as `0x${string}`],
      }) as string
      if (json) healthData = JSON.parse(json)
    } catch { /* no health data */ }
  }

  // Load members
  const { members, partners } = await getOrgMembers(address)

  // Load tracked members
  const trackedMembers = await getTrackedMembers(address)

  return (
    <ChurchDetailClient
      address={address}
      metadata={metadata}
      healthData={healthData}
      members={members}
      partners={partners}
      trackedMembers={trackedMembers}
    />
  )
}
