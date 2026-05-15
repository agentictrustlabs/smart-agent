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
import { hubGetRoundDetail } from '@/lib/clients/hub-client'
import type { Round } from '@smart-agent/discovery'
import { RoundAdminClient } from './RoundAdminClient'
import { roundLifecycle, lifecyclePalette } from '@/lib/rounds/lifecycle'

export const dynamic = 'force-dynamic'

const C = { text: '#5c4a3a', textMuted: '#9a8c7e', accent: '#8b5e3c', card: '#ffffff', border: '#ece6db' }

const AGENT_IRI_PREFIX = 'https://smartagent.io/ontology/core#agent/'

interface RoundRow {
  id: string
  displayName: string | null
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
  // R8 — round body lives on chain. Body fields (fundAgent, deadline,
  // decisionDate) come from hub-mcp's cached GraphDB read; voting config
  // comes from FundRegistry.getRoundVotingConfig. The org-mcp `rounds` SQL
  // mirror is dropped — there is no per-round SQL row to read from anymore.
  const slug = fullRoundId.startsWith('urn:smart-agent:round:')
    ? fullRoundId.slice('urn:smart-agent:round:'.length)
    : fullRoundId
  let body: Round | null = null
  try {
    body = await hubGetRoundDetail(slug, null)
  } catch { body = null }
  if (!body) return null
  const fundAgentId = body.fundAgentId.startsWith(AGENT_IRI_PREFIX)
    ? body.fundAgentId.slice(AGENT_IRI_PREFIX.length)
    : body.fundAgentId

  let votingStrategy = 'steward-quorum'
  let votingThreshold = 2
  let votingWindowStartsAt: string | null = null
  let votingWindowEndsAt: string | null = null
  try {
    const { createPublicClient, http, keccak256, toHex } = await import('viem')
    const { foundry } = await import('viem/chains')
    const { fundRegistryAbi } = await import('@smart-agent/sdk')
    const fundRegistry = process.env.FUND_REGISTRY_ADDRESS as `0x${string}` | undefined
    if (fundRegistry) {
      const client = createPublicClient({
        chain: foundry,
        transport: http(process.env.RPC_URL ?? 'http://127.0.0.1:8545'),
      })
      const roundSubject = keccak256(toHex(`sa:round:${slug}`))
      const cfg = await client.readContract({
        address: fundRegistry,
        abi: fundRegistryAbi,
        functionName: 'getRoundVotingConfig',
        args: [roundSubject],
      }) as readonly [`0x${string}`, bigint, bigint, bigint]
      const [strategyHash, threshold, startsAt, endsAt] = cfg
      // Reverse-map common voting strategy concept hashes.
      const STRATEGIES: Record<string, string> = {
        [keccak256(toHex('sa:VotingStrategyStewardQuorum')).toLowerCase()]: 'steward-quorum',
        [keccak256(toHex('sa:VotingStrategyFlatMember')).toLowerCase()]:    'flat-member',
        [keccak256(toHex('sa:VotingStrategyRoleWeighted')).toLowerCase()]:  'role-weighted',
      }
      votingStrategy = STRATEGIES[strategyHash.toLowerCase()] ?? votingStrategy
      votingThreshold = Number(threshold) || votingThreshold
      votingWindowStartsAt = startsAt > 0n ? new Date(Number(startsAt) * 1000).toISOString() : null
      votingWindowEndsAt = endsAt > 0n ? new Date(Number(endsAt) * 1000).toISOString() : null
    }
  } catch (e) {
    console.warn('[round-admin] voting config read failed (using defaults):', (e as Error).message)
  }

  // Read the round's lifecycle status from FundRegistry. The status is
  // a bytes32 concept hash; reverse-map the common ones back to lowercase
  // labels that the lifecycle UI keys off (open/review/decided/closed/canceled).
  let status = 'open'
  try {
    const { createPublicClient, http, keccak256, toHex } = await import('viem')
    const { foundry } = await import('viem/chains')
    const { fundRegistryAbi } = await import('@smart-agent/sdk')
    const fundRegistry = process.env.FUND_REGISTRY_ADDRESS as `0x${string}` | undefined
    if (fundRegistry) {
      const client = createPublicClient({
        chain: foundry,
        transport: http(process.env.RPC_URL ?? 'http://127.0.0.1:8545'),
      })
      const roundSubject = keccak256(toHex(`sa:round:${slug}`))
      const statusHash = (await client.readContract({
        address: fundRegistry,
        abi: fundRegistryAbi,
        functionName: 'getRoundStatus',
        args: [roundSubject],
      })) as `0x${string}`
      const STATUS_MAP: Record<string, string> = {
        [keccak256(toHex('sa:RoundOpen')).toLowerCase()]:     'open',
        [keccak256(toHex('sa:RoundReview')).toLowerCase()]:   'review',
        [keccak256(toHex('sa:RoundDecided')).toLowerCase()]:  'decided',
        [keccak256(toHex('sa:RoundClosed')).toLowerCase()]:   'closed',
        [keccak256(toHex('sa:RoundCanceled')).toLowerCase()]: 'canceled',
      }
      status = STATUS_MAP[statusHash.toLowerCase()] ?? 'open'
    }
  } catch (e) {
    console.warn('[round-admin] status read failed (defaulting to open):', (e as Error).message)
  }

  return {
    id: fullRoundId,
    displayName: body.displayName ?? null,
    fundAgentId,
    status,
    deadline: body.deadline,
    decisionDate: body.decisionDate,
    votingStrategy,
    votingThreshold,
    votingWindowStartsAt,
    votingWindowEndsAt,
    eligibleVoters: '{"kind":"stewards"}',
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
          Only the round&apos;s operator (this round&apos;s registered AgentAccount owner) can administer it.
        </p>
      </div>
    )
  }

  const lifecycle = roundLifecycle({
    status: round.status,
    deadline: round.deadline,
    votingWindowStartsAt: round.votingWindowStartsAt,
    votingWindowEndsAt: round.votingWindowEndsAt,
  })
  const palette = lifecyclePalette(lifecycle.phase)
  const roundTitle = round.displayName?.trim() || roundId

  return (
    <div style={{ paddingBottom: '2rem' }}>
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {profile.name} · Administer round
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', margin: '0.1rem 0' }}>
          <h1 style={{ fontSize: '1.45rem', fontWeight: 700, color: C.text, margin: 0 }}>
            {roundTitle}
          </h1>
          <span style={{
            padding: '0.2rem 0.55rem',
            background: palette.bg, color: palette.fg, border: `1px solid ${palette.border}`,
            borderRadius: 999, fontSize: '0.7rem', fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            {lifecycle.label}
          </span>
        </div>
        <p style={{ fontSize: '0.78rem', color: C.textMuted, margin: '0.2rem 0 0' }}>
          {lifecycle.caption}
        </p>
        <p style={{ fontSize: '0.85rem', color: C.textMuted, margin: '0.35rem 0 0' }}>
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
