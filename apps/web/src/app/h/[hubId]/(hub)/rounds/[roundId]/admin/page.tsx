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
import { DiscoveryService } from '@smart-agent/discovery'
import { RoundAdminClient } from './RoundAdminClient'

export const dynamic = 'force-dynamic'

const C = { text: '#5c4a3a', textMuted: '#9a8c7e', accent: '#8b5e3c', card: '#ffffff', border: '#ece6db' }

const AGENT_IRI_PREFIX = 'https://smartagent.io/ontology/core#agent/'

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
  // Body fields (fundAgentId, deadline, decisionDate, status) live on chain;
  // read via DiscoveryService. Voting fields live in org-mcp's slim rounds
  // table.
  const slug = fullRoundId.startsWith('urn:smart-agent:round:')
    ? fullRoundId.slice('urn:smart-agent:round:'.length)
    : fullRoundId
  let body: Awaited<ReturnType<DiscoveryService['getRoundDetail']>> = null
  try {
    body = await DiscoveryService.fromEnv().getRoundDetail(slug, null)
  } catch { body = null }
  if (!body) return null
  const fundAgentId = body.fundAgentId.startsWith(AGENT_IRI_PREFIX)
    ? body.fundAgentId.slice(AGENT_IRI_PREFIX.length)
    : body.fundAgentId

  const path = await import('path')
  const fs = await import('fs')
  const candidates = [
    path.resolve(process.cwd(), '../org-mcp/org-mcp.db'),
    path.resolve(process.cwd(), 'apps/org-mcp/org-mcp.db'),
  ]
  const dbPath = candidates.find((p) => fs.existsSync(p))
  let voting: {
    voting_strategy: string
    voting_threshold: number
    voting_window_starts_at: string | null
    voting_window_ends_at: string | null
    eligible_voters: string
  } | undefined
  if (dbPath) {
    const Database = (await import('better-sqlite3')).default
    const db = new Database(dbPath, { readonly: true })
    try {
      voting = db.prepare(`
        SELECT voting_strategy, voting_threshold, voting_window_starts_at,
               voting_window_ends_at, eligible_voters
        FROM rounds WHERE id = ?
      `).get(fullRoundId) as typeof voting
    } finally { db.close() }
  }
  return {
    id: fullRoundId,
    fundAgentId,
    status: 'open', // round body status not exposed via DiscoveryService.Round; UI reads via FundRegistry getter when needed
    deadline: body.deadline,
    decisionDate: body.decisionDate,
    votingStrategy: voting?.voting_strategy ?? 'steward-quorum',
    votingThreshold: voting?.voting_threshold ?? 2,
    votingWindowStartsAt: voting?.voting_window_starts_at ?? null,
    votingWindowEndsAt: voting?.voting_window_ends_at ?? null,
    eligibleVoters: voting?.eligible_voters ?? '{"kind":"stewards"}',
  }
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
