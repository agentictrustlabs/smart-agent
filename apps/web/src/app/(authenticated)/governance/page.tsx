import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getSelectedOrg } from '@/lib/get-selected-org'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { buildAgentNameMap, getNameFromMap } from '@/lib/agent-metadata'
import { GovernanceClient } from './GovernanceClient'

export default async function GovernancePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')
  const params = await searchParams
  const selectedOrg = await getSelectedOrg(currentUser.id, params)

  if (!selectedOrg) {
    return (
      <div data-page="governance">
        <div data-component="page-header"><h1>Governance</h1><p>Select an organization to view proposals.</p></div>
      </div>
    )
  }

  const templateId = (selectedOrg as Record<string, unknown>).templateId as string | null
  const nameMap = await buildAgentNameMap()
  const getName = (a: string) => getNameFromMap(nameMap, a)

  // Load proposals for this org
  const allProposals = await db.select().from(schema.proposals)
    .where(eq(schema.proposals.orgAddress, selectedOrg.smartAccountAddress.toLowerCase()))
  const allVotes = await db.select().from(schema.votes)
  const allUsers = await db.select().from(schema.users)
  const userNames: Record<string, string> = {}
  for (const u of allUsers) userNames[u.id] = u.name

  // Get portfolio businesses for target selector
  const allOrgs = await db.select().from(schema.orgAgents)
  const portfolioBiz = allOrgs.filter(o => (o as Record<string, unknown>).templateId === 'portfolio-business')

  const proposalsWithVotes = allProposals.map(p => ({
    ...p,
    proposerName: userNames[p.proposer] ?? 'Unknown',
    targetName: p.targetAddress ? getName(p.targetAddress) : null,
    votes: allVotes.filter(v => v.proposalId === p.id).map(v => ({
      ...v,
      voterName: userNames[v.voter] ?? 'Unknown',
    })),
  }))

  const canPropose = ['oversight-committee'].includes(templateId ?? '')
  const canVote = ['oversight-committee'].includes(templateId ?? '')

  return (
    <div data-page="governance">
      <div data-component="page-header">
        <h1>Governance{selectedOrg ? ` — ${selectedOrg.name}` : ''}</h1>
        <p>
          {templateId === 'oversight-committee'
            ? 'Quarterly review proposals, voting, and escalation management.'
            : 'Governance proposals and decisions for this organization.'}
        </p>
      </div>

      <GovernanceClient
        proposals={proposalsWithVotes}
        orgAddress={selectedOrg.smartAccountAddress}
        orgName={selectedOrg.name}
        canPropose={canPropose}
        canVote={canVote}
        currentUserId={currentUser.id}
        businesses={portfolioBiz.map(b => ({ address: b.smartAccountAddress, name: b.name }))}
      />
    </div>
  )
}
