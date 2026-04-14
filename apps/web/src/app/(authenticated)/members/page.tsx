import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getUserOrgs } from '@/lib/get-user-orgs'
import { getOrgMembers } from '@/lib/get-org-members'
import { getConnectedOrgs } from '@/lib/get-org-members'
import { getTrackedMembers } from '@/lib/agent-resolver'
import { MembersClient } from './MembersClient'

export default async function MembersPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  const userOrgs = await getUserOrgs(currentUser.id)

  if (userOrgs.length === 0) {
    return (
      <div data-page="members">
        <div data-component="page-header"><h1>Members</h1><p>No organizations found.</p></div>
      </div>
    )
  }

  // Aggregate members across all orgs
  const allMembers: Array<{ address: string; name: string; roles: string[]; status: string; isPerson: boolean }> = []
  const seenMembers = new Set<string>()
  const allDetached: Array<{ id: string; name: string; role: string | null; assignedNodeId: string | null; notes: string | null }> = []

  for (const org of userOrgs) {
    const { members } = await getOrgMembers(org.address)
    for (const m of members) {
      if (!seenMembers.has(m.address.toLowerCase())) {
        seenMembers.add(m.address.toLowerCase())
        allMembers.push(m)
      }
    }

    try {
      const tracked = await getTrackedMembers(org.address)
      allDetached.push(...tracked.map(m => ({
        id: m.id,
        name: m.name,
        role: m.role ?? null,
        assignedNodeId: m.assignedNode ?? null,
        notes: m.notes ?? null,
      })))
    } catch { /* resolver may not be available */ }
  }

  // Gen map nodes for assignment dropdown
  const genNodes: Array<{ id: string; name: string }> = []
  const seenNodes = new Set<string>()
  for (const org of userOrgs) {
    const connected = await getConnectedOrgs(org.address)
    for (const node of connected) {
      const key = node.address.toLowerCase()
      if (seenNodes.has(key)) continue
      seenNodes.add(key)
      genNodes.push({ id: key, name: node.name })
    }
  }

  return (
    <div data-page="members">
      <div data-component="page-header">
        <h1>Members</h1>
        <p>Manage team members with accounts and tracked contacts.</p>
      </div>

      <MembersClient
        members={allMembers}
        detachedMembers={allDetached}
        genNodes={genNodes}
        orgAddress={userOrgs[0].address}
        orgName={userOrgs[0].name}
      />
    </div>
  )
}
