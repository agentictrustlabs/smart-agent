import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getUserOrgs } from '@/lib/get-user-orgs'
import { getEdgesBySubject, getEdge } from '@/lib/contracts'
import { getAgentMetadata } from '@/lib/agent-metadata'
import { getConnectedOrgs } from '@/lib/get-org-members'
import { GroupHierarchy, type GroupNode } from '@/components/catalyst/GroupHierarchy'

export default async function CatalystGroupsPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  const userOrgs = await getUserOrgs(currentUser.id)
  if (userOrgs.length === 0) return <p>No organizations found.</p>

  // Build hierarchy from on-chain ALLIANCE edges
  const groups: GroupNode[] = []
  const seen = new Set<string>()

  async function addOrg(addr: string, name: string, desc: string, depth: number, parentAddr: string | null) {
    const key = addr.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)

    await getAgentMetadata(addr).catch(() => ({}))
    const connected = await getConnectedOrgs(addr).catch(() => [])
    const orgMeta = connected.find(c => c.address.toLowerCase() === key)?.metadata ?? {}

    groups.push({
      id: `org-${key.slice(2, 10)}`,
      address: addr, name, description: desc,
      parentAddress: parentAddr, depth,
      leaderName: typeof orgMeta.leaderName === 'string' ? orgMeta.leaderName : null,
      location: typeof orgMeta.location === 'string' ? orgMeta.location : null,
      isEstablished: Boolean(orgMeta.isChurch),
      healthData: Object.keys(orgMeta).length > 0 ? JSON.stringify(orgMeta) : null,
      status: typeof orgMeta.circleStatus === 'string' ? orgMeta.circleStatus : 'active',
      metadata: orgMeta,
    })

    // Walk children
    try {
      const edgeIds = await getEdgesBySubject(addr as `0x${string}`)
      for (const edgeId of edgeIds) {
        const edge = await getEdge(edgeId)
        if (edge.status < 2) continue
        if (seen.has(edge.object_.toLowerCase())) continue
        const childMeta = await getAgentMetadata(edge.object_)
        await addOrg(edge.object_, childMeta.displayName, childMeta.description, depth + 1, key)
      }
    } catch { /* ignored */ }
  }

  for (const org of userOrgs) {
    await addOrg(org.address, org.name, org.description, 0, null)
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
