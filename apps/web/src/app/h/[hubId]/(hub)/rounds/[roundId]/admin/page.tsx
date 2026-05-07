/**
 * Sprint B — Round admin page.
 *
 * Three tabs:
 *   - Config — voting strategy / threshold / window editor
 *   - Lifecycle — current status + advance/cancel buttons
 *   - Tally — live per-proposal vote tally
 *
 * Auth: viewer must canManageAgent(round.fundAgent). Same gate as the
 * existing close-round / cancel-round flows.
 */

import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { HUB_SLUG_MAP } from '@/lib/hub-routes'
import { getHubProfile } from '@/lib/hub-profiles'
import { getPersonAgentForUser, canManageAgent } from '@/lib/agent-registry'
import { RoundAdminClient } from './RoundAdminClient'

export const dynamic = 'force-dynamic'

const C = { text: '#5c4a3a', textMuted: '#9a8c7e', accent: '#8b5e3c', card: '#ffffff', border: '#ece6db' }

interface RoundRow {
  id: string
  fundAgentId: string
  status: string
  deadline: string
  decisionDate: string
  votingStrategy: string
  votingThreshold: number
  votingWindowStartsAt: string | null
  votingWindowEndsAt: string | null
  eligibleVoters: string
}

async function loadRound(fullRoundId: string): Promise<RoundRow | null> {
  const path = await import('path')
  const fs = await import('fs')
  const candidates = [
    path.resolve(process.cwd(), '../org-mcp/org-mcp.db'),
    path.resolve(process.cwd(), 'apps/org-mcp/org-mcp.db'),
  ]
  const dbPath = candidates.find((p) => fs.existsSync(p))
  if (!dbPath) return null
  const Database = (await import('better-sqlite3')).default
  const db = new Database(dbPath, { readonly: true })
  try {
    const r = db.prepare(`
      SELECT id, fund_agent_id, status, deadline, decision_date,
             voting_strategy, voting_threshold, voting_window_starts_at,
             voting_window_ends_at, eligible_voters
      FROM rounds WHERE id = ?
    `).get(fullRoundId) as
      | { id: string; fund_agent_id: string; status: string; deadline: string; decision_date: string;
          voting_strategy: string; voting_threshold: number;
          voting_window_starts_at: string | null; voting_window_ends_at: string | null;
          eligible_voters: string }
      | undefined
    if (!r) return null
    return {
      id: r.id,
      fundAgentId: r.fund_agent_id,
      status: r.status,
      deadline: r.deadline,
      decisionDate: r.decision_date,
      votingStrategy: r.voting_strategy,
      votingThreshold: r.voting_threshold,
      votingWindowStartsAt: r.voting_window_starts_at,
      votingWindowEndsAt: r.voting_window_ends_at,
      eligibleVoters: r.eligible_voters,
    }
  } finally { db.close() }
}

export default async function RoundAdminPage({
  params,
}: {
  params: Promise<{ hubId: string; roundId: string }>
}) {
  const { hubId: slug, roundId } = await params
  const internalHubId = HUB_SLUG_MAP[slug]
  if (!internalHubId) notFound()
  const profile = getHubProfile(internalHubId)
  const user = await getCurrentUser()
  if (!user) redirect('/')
  const myAgent = await getPersonAgentForUser(user.id)
  if (!myAgent) redirect(`/h/${slug}/home`)

  const fullRoundId = roundId.startsWith('urn:smart-agent:round:')
    ? roundId
    : `urn:smart-agent:round:${roundId}`
  const round = await loadRound(fullRoundId)
  if (!round) notFound()

  let canManage = false
  try { canManage = await canManageAgent(myAgent, round.fundAgentId) } catch { canManage = false }
  if (!canManage) {
    return (
      <div style={{ padding: '2rem', background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, maxWidth: '36rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 700, color: C.text, margin: 0 }}>Not authorized</h2>
        <p style={{ fontSize: '0.85rem', color: C.textMuted, marginTop: '0.4rem' }}>
          Only stewards of the operating fund can administer this round.
        </p>
      </div>
    )
  }

  return (
    <div style={{ paddingBottom: '2rem' }}>
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {profile.name} · Round admin
        </div>
        <h1 style={{ fontSize: '1.45rem', fontWeight: 700, color: C.text, margin: '0.1rem 0' }}>
          Administer round
        </h1>
        <p style={{ fontSize: '0.85rem', color: C.textMuted, margin: '0.2rem 0 0' }}>
          <Link href={`/h/${slug}/rounds/${roundId}`} style={{ color: C.accent }}>← Back to round</Link>
        </p>
      </div>
      <RoundAdminClient
        hubSlug={slug}
        round={{
          id: round.id,
          status: round.status,
          deadline: round.deadline,
          decisionDate: round.decisionDate,
          votingStrategy: round.votingStrategy,
          votingThreshold: round.votingThreshold,
          votingWindowStartsAt: round.votingWindowStartsAt,
          votingWindowEndsAt: round.votingWindowEndsAt,
        }}
      />
    </div>
  )
}
