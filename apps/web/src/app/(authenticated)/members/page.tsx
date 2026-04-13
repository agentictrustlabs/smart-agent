import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getUserOrgs } from '@/lib/get-user-orgs'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getOrgMembers } from '@/lib/get-org-members'
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
  const orgAddresses = userOrgs.map(o => o.address.toLowerCase())

  for (const org of userOrgs) {
    const { members } = await getOrgMembers(org.address)
    for (const m of members) {
      if (!seenMembers.has(m.address.toLowerCase())) {
        seenMembers.add(m.address.toLowerCase())
        allMembers.push(m)
      }
    }

    try {
      const detached = await db.select().from(schema.detachedMembers)
        .where(eq(schema.detachedMembers.orgAddress, org.address.toLowerCase()))
      allDetached.push(...detached)
    } catch { /* table may not exist */ }
  }

  // Gen map nodes for assignment dropdown
  let genNodes: Array<{ id: string; name: string }> = []
  try {
    const allNodes = await db.select().from(schema.genMapNodes)
    genNodes = allNodes
      .filter(n => orgAddresses.includes(n.networkAddress.toLowerCase()))
      .map(n => ({ id: n.id, name: n.name }))
    if (genNodes.length === 0) {
      genNodes = allNodes.map(n => ({ id: n.id, name: n.name }))
    }
  } catch { /* ignored */ }

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
