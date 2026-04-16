import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { db, schema } from '@/db'
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { eq } from 'drizzle-orm'
import { getMCRole } from '@/lib/mc-roles'
import GovernancePageClient from '@/components/mc/GovernancePageClient'
import type { Proposal } from '@/components/mc/GovernancePageClient'
import { getUserHubId } from '@/lib/get-user-hub'

export default async function StewardPage() {
  const currentUser = await getCurrentUser()
  if (!currentUser) redirect('/')

  const isCIL = (await getUserHubId(currentUser.id)) === 'cil'

  if (isCIL) {
    // ── CIL Governance View ──────────────────────────────────────────
    const role = getMCRole(currentUser.id)

    let allProposals: Proposal[] = []
    try {
      const rows = await db.select().from(schema.proposals)
      // Get proposer names
      const _userIds = [...new Set(rows.map((r) => r.proposer))] // eslint-disable-line @typescript-eslint/no-unused-vars
      const users = await db.select().from(schema.users)
      const nameMap = new Map(users.map((u) => [u.id, u.name]))

      allProposals = rows.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        actionType: r.actionType,
        proposerName: nameMap.get(r.proposer) ?? 'Unknown',
        votesFor: r.votesFor,
        votesAgainst: r.votesAgainst,
        quorumRequired: r.quorumRequired,
        status: r.status,
        executedAt: r.executedAt ?? null,
        createdAt: r.createdAt,
      }))
    } catch { /* table may not exist */ }

    const openProposals = allProposals.filter((p) => p.status === 'open')
    const completedProposals = allProposals.filter((p) => p.status !== 'open')

    // Use the first CIL org address as the governance org
    const orgAddress = '0x00000000000000000000000000000000000c0001'

    return (
      <GovernancePageClient
        openProposals={openProposals}
        completedProposals={completedProposals}
        role={role}
        orgAddress={orgAddress}
      />
    )
  }

  return (
    <div>
      <div style={{ marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.25rem', margin: '0 0 0.25rem' }}>Steward</h1>
        <p style={{ fontSize: '0.85rem', color: '#616161', margin: 0 }}>
          Governance, treasury, reviews, and network oversight.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: '0.75rem' }}>
        <Link href="/treasury" style={{
          padding: '1.25rem', background: '#fff', borderRadius: 10,
          border: '1px solid #ece6db', textDecoration: 'none', color: '#5c4a3a',
          display: 'block',
        }}>
          <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>💰</div>
          <strong style={{ fontSize: '0.95rem' }}>Treasury</strong>
          <p style={{ fontSize: '0.8rem', color: '#9a8c7e', margin: '0.25rem 0 0' }}>
            Financial oversight, revenue reports, and fund management.
          </p>
        </Link>

        <Link href="/reviews" style={{
          padding: '1.25rem', background: '#fff', borderRadius: 10,
          border: '1px solid #ece6db', textDecoration: 'none', color: '#5c4a3a',
          display: 'block',
        }}>
          <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>✅</div>
          <strong style={{ fontSize: '0.95rem' }}>Reviews & Endorsements</strong>
          <p style={{ fontSize: '0.8rem', color: '#9a8c7e', margin: '0.25rem 0 0' }}>
            Submit and manage reviews, endorsements, and assertions.
          </p>
        </Link>

        <Link href="/network" style={{
          padding: '1.25rem', background: '#fff', borderRadius: 10,
          border: '1px solid #ece6db', textDecoration: 'none', color: '#5c4a3a',
          display: 'block',
        }}>
          <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>🌐</div>
          <strong style={{ fontSize: '0.95rem' }}>Network</strong>
          <p style={{ fontSize: '0.8rem', color: '#9a8c7e', margin: '0.25rem 0 0' }}>
            Trust graph, relationships, and network oversight.
          </p>
        </Link>

        <Link href="/settings" style={{
          padding: '1.25rem', background: '#fff', borderRadius: 10,
          border: '1px solid #ece6db', textDecoration: 'none', color: '#5c4a3a',
          display: 'block',
        }}>
          <div style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>⚙️</div>
          <strong style={{ fontSize: '0.95rem' }}>Governance & Settings</strong>
          <p style={{ fontSize: '0.8rem', color: '#9a8c7e', margin: '0.25rem 0 0' }}>
            Proposals, voting, team settings, and administration.
          </p>
        </Link>
      </div>
    </div>
  )
}
