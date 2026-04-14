import Link from 'next/link'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { redirect } from 'next/navigation'
import { getUserOrgs } from '@/lib/get-user-orgs'
import { getOrgMembers } from '@/lib/get-org-members'
import { InviteForm } from '@/components/team/InviteForm'
import { getEdgesBySubject, getEdge, getEdgeRoles } from '@/lib/contracts'
import { REVIEW_RELATIONSHIP, ROLE_REVIEWER } from '@smart-agent/sdk'

export default async function TeamPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  const userOrgs = await getUserOrgs(currentUser.id)

  if (userOrgs.length === 0) {
    return (
      <div data-page="team">
        <div data-component="page-header">
          <h1>Team</h1>
          <p>Create an organization to manage team members.</p>
        </div>
        <div data-component="empty-state">
          <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
            <Link href="/setup"><button>Create Organization</button></Link>
            <Link href="/setup/join"><button style={{ background: '#e0e0e0', color: '#1a1a2e' }}>Join Organization</button></Link>
          </div>
        </div>
      </div>
    )
  }

  // Build per-org team data
  type OrgTeam = {
    address: string
    name: string
    roles: string[]
    members: Array<{
      address: string; name: string; roles: string[]; status: string
      delegations: Array<{ status: string; expiresAt: string; caveats: string[] }>
    }>
    partners: Array<{ address: string; name: string; roles: string[]; status: string }>
    invites: Array<{ id: string; code: string; role: string; status: string; expiresAt: string }>
  }
  const orgTeams: OrgTeam[] = []

  for (const org of userOrgs) {
    const { members, partners } = await getOrgMembers(org.address)

    const membersWithDelegations = members.map(m => {
      const personDelegations: Array<{ status: string; expiresAt: string; caveats: string[] }> = []
      return { ...m, delegations: personDelegations }
    })

    for (const member of membersWithDelegations) {
      try {
        const edgeIds = await getEdgesBySubject(member.address as `0x${string}`)
        for (const edgeId of edgeIds) {
          const edge = await getEdge(edgeId)
          if (edge.object_.toLowerCase() !== org.address.toLowerCase()) continue
          if (edge.relationshipType !== REVIEW_RELATIONSHIP) continue
          if (edge.status < 2) continue
          const roles = await getEdgeRoles(edgeId)
          if (!roles.some(role => role === ROLE_REVIEWER)) continue
          member.delegations.push({
            status: 'available',
            expiresAt: 'On demand',
            caveats: ['Issued on demand'],
          })
        }
      } catch { /* ignored */ }
    }

    // Invites for this org
    const allInvites = await db.select().from(schema.invites)
      .where(eq(schema.invites.createdBy, currentUser.id))
    const orgInvites = allInvites
      .filter(i => i.agentAddress.toLowerCase() === org.address.toLowerCase())
      .map(i => ({ id: i.id, code: i.code, role: i.role, status: i.status, expiresAt: new Date(i.expiresAt).toLocaleDateString() }))

    orgTeams.push({
      address: org.address,
      name: org.name,
      roles: org.roles,
      members: membersWithDelegations,
      partners,
      invites: orgInvites,
    })
  }

  return (
    <div data-page="team">
      <div data-component="page-header">
        <h1>Team</h1>
        <p>Members, roles, delegated authority, and partnerships across your organizations.</p>
      </div>

      {orgTeams.map(org => (
        <div key={org.address} style={{ marginBottom: '2rem' }}>
          <div data-component="section-header" style={{ marginBottom: '1rem' }}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Link href={`/agents/${org.address}`} style={{ color: '#1565c0' }}>{org.name}</Link>
              {org.roles.map(r => <span key={r} data-component="role-badge" style={{ fontSize: '0.6rem' }}>{r}</span>)}
            </h2>
          </div>

          {/* Members & Roles */}
          <section data-component="graph-section">
            <h3>Members ({org.members.length})</h3>
            {org.members.length === 0 ? (
              <p data-component="text-muted">No members yet.</p>
            ) : (
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                {org.members.map(m => (
                  <div key={m.address} data-component="protocol-info">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                      <Link href={`/agents/${m.address}`} style={{ color: '#1565c0', fontWeight: 600, fontSize: '0.95rem' }}>{m.name}</Link>
                      <span data-component="role-badge" data-status={m.status === 'Active' ? 'active' : 'proposed'}>{m.status}</span>
                    </div>
                    <div style={{ marginBottom: '0.5rem' }}>
                      <span style={{ fontSize: '0.75rem', color: '#616161' }}>Roles: </span>
                      {m.roles.map(r => <span key={r} data-component="role-badge" style={{ marginRight: 4 }}>{r}</span>)}
                    </div>
                    {m.delegations.length > 0 ? (
                      <div style={{ borderTop: '1px solid #f0f1f3', paddingTop: '0.5rem' }}>
                        <span style={{ fontSize: '0.75rem', color: '#616161', fontWeight: 600 }}>Delegated Authority:</span>
                        {m.delegations.map((d, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem', fontSize: '0.8rem' }}>
                            <span data-component="role-badge" data-status={d.status === 'active' ? 'active' : 'revoked'}>{d.status}</span>
                            <span style={{ color: '#616161' }}>expires {d.expiresAt}</span>
                            {d.caveats.map((c, j) => (
                              <span key={j} style={{ fontSize: '0.7rem', padding: '0.1rem 0.35rem', background: '#f5f5f5', borderRadius: 4, color: '#616161' }}>{c}</span>
                            ))}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div style={{ borderTop: '1px solid #f0f1f3', paddingTop: '0.5rem' }}>
                        <span style={{ fontSize: '0.75rem', color: '#616161' }}>No active delegations</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Related Organizations */}
          {org.partners.length > 0 && (
            <section data-component="graph-section">
              <h3>Related Organizations ({org.partners.length})</h3>
              <table data-component="graph-table">
                <thead><tr><th>Organization</th><th>Relationship</th><th>Status</th></tr></thead>
                <tbody>
                  {org.partners.map(p => (
                    <tr key={p.address}>
                      <td><Link href={`/agents/${p.address}`} style={{ color: '#1565c0' }}>{p.name}</Link></td>
                      <td>{p.roles.map(r => <span key={r} data-component="role-badge" style={{ marginRight: 4 }}>{r}</span>)}</td>
                      <td><span data-component="role-badge" data-status={p.status === 'Active' ? 'active' : 'proposed'}>{p.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {/* Invites */}
          {org.roles.some(r => ['owner', 'admin', 'ceo'].includes(r.toLowerCase())) && (
            <section data-component="graph-section">
              <h3>Invites ({org.invites.filter(i => i.status === 'pending').length} pending)</h3>
              {org.invites.length > 0 && (
                <table data-component="graph-table" style={{ marginBottom: '1rem' }}>
                  <thead><tr><th>Code</th><th>Role</th><th>Status</th><th>Expires</th></tr></thead>
                  <tbody>
                    {org.invites.map(inv => (
                      <tr key={inv.id}>
                        <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{inv.code}</td>
                        <td><span data-component="role-badge">{inv.role}</span></td>
                        <td><span data-component="role-badge" data-status={inv.status === 'pending' ? 'proposed' : inv.status === 'accepted' ? 'active' : 'revoked'}>{inv.status}</span></td>
                        <td style={{ fontSize: '0.8rem', color: '#616161' }}>{inv.expiresAt}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <InviteForm
                agentAddress={org.address}
                agentName={org.name}
                roles={[
                  { key: 'owner', label: 'Owner', description: 'Full authority' },
                  { key: 'admin', label: 'Admin', description: 'Administrative access' },
                  { key: 'member', label: 'Member', description: 'General membership' },
                ]}
              />
            </section>
          )}
        </div>
      ))}
    </div>
  )
}
