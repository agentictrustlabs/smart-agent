import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getSelectedOrg } from '@/lib/get-selected-org'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getOrgMembers } from '@/lib/get-org-members'
import { MembersClient } from './MembersClient'

export default async function MembersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')
  const params = await searchParams
  const selectedOrg = await getSelectedOrg(currentUser.id, params)

  if (!selectedOrg) {
    return (
      <div data-page="members">
        <div data-component="page-header"><h1>Members</h1><p>Select an organization to manage members.</p></div>
      </div>
    )
  }

  // Real members (with accounts)
  const { members } = await getOrgMembers(selectedOrg.smartAccountAddress)

  // Detached members (tracked without accounts)
  let detachedMembers: Array<{ id: string; name: string; role: string | null; assignedNodeId: string | null; notes: string | null }> = []
  try {
    detachedMembers = await db.select().from(schema.detachedMembers)
      .where(eq(schema.detachedMembers.orgAddress, selectedOrg.smartAccountAddress.toLowerCase()))
  } catch { /* table may not exist */ }

  // Gen map nodes for assignment dropdown
  let genNodes: Array<{ id: string; name: string }> = []
  try {
    const allNodes = await db.select().from(schema.genMapNodes)
    genNodes = allNodes
      .filter(n => n.networkAddress === selectedOrg.smartAccountAddress.toLowerCase())
      .map(n => ({ id: n.id, name: n.name }))
    // Also include nodes from child orgs for network-level view
    if (genNodes.length === 0) {
      genNodes = allNodes.map(n => ({ id: n.id, name: n.name }))
    }
  } catch { /* ignored */ }

  return (
    <div data-page="members">
      <div data-component="page-header">
        <h1>Members{selectedOrg ? ` — ${selectedOrg.name}` : ''}</h1>
        <p>Manage team members with accounts and tracked contacts without accounts.</p>
      </div>

      <MembersClient
        members={members}
        detachedMembers={detachedMembers}
        genNodes={genNodes}
        orgAddress={selectedOrg.smartAccountAddress}
        orgName={selectedOrg.name}
      />
    </div>
  )
}
