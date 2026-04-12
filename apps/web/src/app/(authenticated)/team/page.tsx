import Link from 'next/link'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { redirect } from 'next/navigation'
import { getSelectedOrg } from '@/lib/get-selected-org'
import { getOrgTemplate } from '@/lib/org-templates.data'
import { getOrgMembers } from '@/lib/get-org-members'
import { InviteForm } from '@/components/team/InviteForm'

export default async function TeamPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  const params = await searchParams
  const selectedOrg = await getSelectedOrg(currentUser.id, params)

  // Get pending invites for selected org
  const allInvites = await db.select().from(schema.invites)
    .where(eq(schema.invites.createdBy, currentUser.id))
  const orgInvites = selectedOrg
    ? allInvites.filter(i => i.agentAddress.toLowerCase() === selectedOrg.smartAccountAddress.toLowerCase())
    : []

  // Get members and partners
  const { members, partners: partnerOrgs } = selectedOrg
    ? await getOrgMembers(selectedOrg.smartAccountAddress)
    : { members: [], partners: [] }

  // Load delegations for this org
  const orgDelegations = selectedOrg
    ? await db.select().from(schema.reviewDelegations)
        .where(eq(schema.reviewDelegations.subjectAgentAddress, selectedOrg.smartAccountAddress.toLowerCase()))
    : []

  const enforcerNames: Record<string, string> = {
    [process.env.TIMESTAMP_ENFORCER_ADDRESS?.toLowerCase() ?? '']: 'Time Window',
    [process.env.ALLOWED_METHODS_ENFORCER_ADDRESS?.toLowerCase() ?? '']: 'Allowed Methods',
    [process.env.ALLOWED_TARGETS_ENFORCER_ADDRESS?.toLowerCase() ?? '']: 'Allowed Targets',
    [process.env.VALUE_ENFORCER_ADDRESS?.toLowerCase() ?? '']: 'Spending Limit',
  }

  // Enrich members with delegation info
  const membersWithDelegations = members.map(m => {
    const personDelegations = orgDelegations
      .filter(d => d.reviewerAgentAddress === m.address.toLowerCase())
      .map(d => {
        const isExpired = new Date(d.expiresAt) < new Date()
        let caveats: string[] = []
        try {
          const parsed = JSON.parse(d.delegationJson)
          caveats = (parsed.caveats ?? []).map((c: { enforcer: string }) =>
            enforcerNames[c.enforcer?.toLowerCase()] ?? 'Custom'
          )
        } catch { /* ignored */ }
        return { status: isExpired ? 'expired' : d.status, expiresAt: new Date(d.expiresAt).toLocaleDateString(), caveats }
      })
    return { ...m, delegations: personDelegations }
  })

  // Get AI agents operated by this org
  const aiAgents = selectedOrg
    ? await db.select().from(schema.aiAgents)
        .then(all => all.filter(a => a.operatedBy?.toLowerCase() === selectedOrg.smartAccountAddress.toLowerCase()))
    : []

  return (
    <div data-page="team">
      <div data-component="page-header">
        <div data-component="section-header">
          <h1>Organization{selectedOrg ? ` — ${selectedOrg.name}` : ''}</h1>
          {selectedOrg && (
            <Link href={`/agents/${selectedOrg.smartAccountAddress}`} data-component="section-action">Settings</Link>
          )}
        </div>
        {selectedOrg
          ? <p>Members, roles, delegated authority, and partnerships for {selectedOrg.name}.</p>
          : <p>Create an organization to manage team members</p>
        }
      </div>

      {!selectedOrg ? (
        <div data-component="empty-state">
          <h3>No Organization</h3>
          <p>Create an organization to start managing your team.</p>
          <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
            <Link href="/setup"><button>Create Organization</button></Link>
            <Link href="/setup/join"><button style={{ background: '#e0e0e0', color: '#1a1a2e' }}>Join Organization</button></Link>
          </div>
        </div>
      ) : (
        <>
          {/* Members & Roles */}
          <section data-component="graph-section">
            <div data-component="section-header">
              <h2>Members & Roles ({membersWithDelegations.length})</h2>
            </div>
            <p style={{ fontSize: '0.85rem', color: '#616161', marginBottom: '1rem' }}>
              Roles define what each person can do within the organization.
            </p>
            {membersWithDelegations.length === 0 ? (
              <p data-component="text-muted">No members yet. Invite people using the form below.</p>
            ) : (
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                {membersWithDelegations.map((m) => (
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
                        <span style={{ fontSize: '0.75rem', color: '#616161' }}>No active delegations — role assignment only</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Related Organizations */}
          {partnerOrgs.length > 0 && (
            <section data-component="graph-section">
              <h2>Related Organizations ({partnerOrgs.length})</h2>
              <table data-component="graph-table">
                <thead><tr><th>Organization</th><th>Relationship</th><th>Status</th></tr></thead>
                <tbody>
                  {partnerOrgs.map((p) => (
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

          {/* AI Agents */}
          <section data-component="graph-section">
            <div data-component="section-header">
              <h2>AI Agents ({aiAgents.length})</h2>
              <Link href="/deploy/ai" data-component="section-action">+ Deploy Agent</Link>
            </div>
            {aiAgents.length === 0 ? (
              <p data-component="text-muted">No AI agents deployed for this organization.</p>
            ) : (
              <table data-component="graph-table">
                <thead><tr><th>Agent</th><th>Type</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {aiAgents.map(a => (
                    <tr key={a.id}>
                      <td><Link href={`/agents/${a.smartAccountAddress}`} style={{ color: '#1565c0' }}>{a.name}</Link></td>
                      <td><span data-component="role-badge">{a.agentType}</span></td>
                      <td><span data-component="role-badge" data-status={a.status === 'deployed' ? 'active' : 'proposed'}>{a.status}</span></td>
                      <td style={{ fontSize: '0.8rem' }}>
                        <Link href={`/agents/${a.smartAccountAddress}/metadata`} style={{ color: '#1565c0' }}>Metadata</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* Pending Invites */}
          <section data-component="graph-section">
            <h2>Invites ({orgInvites.filter(i => i.status === 'pending').length} pending)</h2>
            {orgInvites.length === 0 ? (
              <p data-component="text-muted">No invites created for this organization.</p>
            ) : (
              <table data-component="graph-table">
                <thead><tr><th>Code</th><th>Role</th><th>Status</th><th>Expires</th></tr></thead>
                <tbody>
                  {orgInvites.map((inv) => (
                    <tr key={inv.id}>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>{inv.code}</td>
                      <td><span data-component="role-badge">{inv.role}</span></td>
                      <td><span data-component="role-badge" data-status={inv.status === 'pending' ? 'proposed' : inv.status === 'accepted' ? 'active' : 'revoked'}>{inv.status}</span></td>
                      <td style={{ fontSize: '0.8rem', color: '#616161' }}>{new Date(inv.expiresAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* Invite Form */}
          <section data-component="graph-section">
            <InviteForm
              agentAddress={selectedOrg.smartAccountAddress}
              agentName={selectedOrg.name}
              roles={(() => {
                const tpl = getOrgTemplate((selectedOrg as Record<string, unknown>).templateId as string ?? '')
                if (tpl) return tpl.roles.map(r => ({ key: r.roleKey, label: r.label, description: r.description }))
                return [
                  { key: 'owner', label: 'Owner', description: 'Full authority' },
                  { key: 'admin', label: 'Admin', description: 'Administrative access' },
                  { key: 'member', label: 'Member', description: 'General membership' },
                ]
              })()}
            />
          </section>
        </>
      )}
    </div>
  )
}
