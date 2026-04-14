import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getUserOrgs } from '@/lib/get-user-orgs'
import { getEdgesBySubject, getEdge, getPublicClient } from '@/lib/contracts'
import { getAgentMetadata } from '@/lib/agent-metadata'
import { GroupHierarchy, type GroupNode } from '@/components/catalyst/GroupHierarchy'
import { agentAccountResolverAbi } from '@smart-agent/sdk'
import { keccak256, toBytes } from 'viem'

const ATL_HEALTH_DATA = keccak256(toBytes('atl:healthData'))

export default async function CatalystGroupsPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  const userOrgs = await getUserOrgs(currentUser.id)
  if (userOrgs.length === 0) return <p>No organizations found.</p>

  const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
  const client = getPublicClient()

  // Read health data directly from on-chain resolver
  async function readHealthData(addr: string): Promise<Record<string, unknown>> {
    if (!resolverAddr) return {}
    try {
      const json = await client.readContract({
        address: resolverAddr, abi: agentAccountResolverAbi,
        functionName: 'getStringProperty',
        args: [addr as `0x${string}`, ATL_HEALTH_DATA],
      }) as string
      if (json) return JSON.parse(json)
    } catch { /* no health data */ }
    return {}
  }

  // Build hierarchy from on-chain ALLIANCE edges
  const groups: GroupNode[] = []
  const seen = new Set<string>()

  async function addOrg(addr: string, depth: number, parentAddr: string | null) {
    const key = addr.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)

    const meta = await getAgentMetadata(addr)
    const health = await readHealthData(addr)

    groups.push({
      id: `org-${key.slice(2, 10)}`,
      address: addr,
      name: meta.displayName,
      description: meta.description,
      parentAddress: parentAddr, depth,
      leaderName: typeof health.leaderName === 'string' ? health.leaderName : null,
      location: typeof health.location === 'string' ? health.location : null,
      isEstablished: Boolean(health.isChurch),
      healthData: Object.keys(health).length > 0 ? JSON.stringify(health) : null,
      status: typeof health.circleStatus === 'string' ? health.circleStatus : 'active',
      metadata: health,
    })

    // Walk children via outgoing edges
    try {
      const edgeIds = await getEdgesBySubject(addr as `0x${string}`)
      for (const edgeId of edgeIds) {
        const edge = await getEdge(edgeId)
        if (edge.status < 2) continue
        if (seen.has(edge.object_.toLowerCase())) continue
        await addOrg(edge.object_, depth + 1, key)
      }
    } catch { /* ignored */ }
  }

  for (const org of userOrgs) {
    await addOrg(org.address, 0, null)
  }

  groups.sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name))

  return (
    <div>
      <div style={{ marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.25rem', margin: '0 0 0.25rem' }}>Groups</h1>
        <p style={{ fontSize: '0.85rem', color: '#616161', margin: 0 }}>
          Hierarchy of groups and gatherings. Click a group to edit health metrics and practices.
        </p>
      </div>
      <GroupHierarchy groups={groups} orgAddress={userOrgs[0].address} />
    </div>
  )
}
