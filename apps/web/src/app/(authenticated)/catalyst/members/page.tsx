import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getUserOrgs } from '@/lib/get-user-orgs'
import { getOrgMembers } from '@/lib/get-org-members'
import { getTrackedMembers } from '@/lib/agent-resolver'
import { MemberManager } from '@/components/catalyst/MemberManager'

export default async function CatalystMembersPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  const userOrgs = await getUserOrgs(currentUser.id)
  if (userOrgs.length === 0) return <p>No organizations found.</p>

  // Aggregate members across orgs
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
    } catch { /* ignored */ }
  }

  // Group options for assignment dropdown
  const { getConnectedOrgs } = await import('@/lib/get-org-members')
  const groupOptions: Array<{ id: string; name: string }> = []
  for (const org of userOrgs) {
    groupOptions.push({ id: org.address, name: org.name })
    try {
      const connected = await getConnectedOrgs(org.address)
      for (const c of connected) groupOptions.push({ id: c.address, name: c.name })
    } catch { /* ignored */ }
  }

  return (
    <div>
      <div style={{ marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.25rem', margin: '0 0 0.25rem' }}>Members</h1>
        <p style={{ fontSize: '0.85rem', color: '#616161', margin: 0 }}>
          Team members with accounts and tracked contacts without accounts.
        </p>
      </div>

      <MemberManager
        members={allMembers}
        detached={allDetached}
        groups={groupOptions}
        orgAddress={userOrgs[0].address}
      />
    </div>
  )
}
