/**
 * Sprint B — Pool admin page.
 *
 * Three tabs:
 *   - Mandate — display + update mandate hash + URI
 *   - Stewards — list + add/remove (PoolRegistry.rotateStewards)
 *   - Capacity — display-only for v1 (capacity ceiling + accepted units/kinds)
 *
 * Auth: viewer must canManageAgent(pool.stewardshipAgent).
 */

import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { HUB_SLUG_MAP } from '@/lib/hub-routes'
import { getHubProfile } from '@/lib/hub-profiles'
import { getPersonAgentForUser, canManageAgent } from '@/lib/agent-registry'
import { getPoolForViewer } from '@/lib/actions/pools.action'
import { PoolAdminClient } from './PoolAdminClient'

export const dynamic = 'force-dynamic'

const C = { text: '#5c4a3a', textMuted: '#9a8c7e', accent: '#8b5e3c', card: '#ffffff', border: '#ece6db' }

const AGENT_IRI_PREFIX = 'https://smartagent.io/ontology/core#agent/'

export default async function PoolAdminPage({
  params,
}: {
  params: Promise<{ hubId: string; poolId: string }>
}) {
  const { hubId: slug, poolId: rawPoolId } = await params
  const internalHubId = HUB_SLUG_MAP[slug]
  if (!internalHubId) notFound()
  const user = await getCurrentUser()
  if (!user) redirect('/')
  const myAgent = await getPersonAgentForUser(user.id)
  if (!myAgent) redirect(`/h/${slug}/home`)
  const profile = getHubProfile(internalHubId)

  const poolId = decodeURIComponent(rawPoolId)
  const { pool } = await getPoolForViewer(poolId, myAgent)
  if (!pool) notFound()

  const treasuryAddress = pool.treasuryAddress
  if (!treasuryAddress) notFound()

  // Auth gate — same canManageAgent check as the round-admin / cancel-round
  // pages. Stewardship agent points at the network/pool steward.
  const stewardshipAgentIri = pool.stewardshipAgent || ''
  const stewardshipAgentAddr = stewardshipAgentIri.startsWith(AGENT_IRI_PREFIX)
    ? stewardshipAgentIri.slice(AGENT_IRI_PREFIX.length)
    : stewardshipAgentIri
  let canManage = false
  try { canManage = await canManageAgent(myAgent, stewardshipAgentAddr) } catch { canManage = false }
  if (!canManage) {
    return (
      <div style={{ padding: '2rem', background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, maxWidth: '36rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 700, color: C.text, margin: 0 }}>Not authorized</h2>
        <p style={{ fontSize: '0.85rem', color: C.textMuted, marginTop: '0.4rem' }}>
          Only stewards of this pool&apos;s governing agent can administer it.
        </p>
      </div>
    )
  }

  return (
    <div style={{ paddingBottom: '2rem' }}>
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {profile.name} · Pool admin
        </div>
        <h1 style={{ fontSize: '1.45rem', fontWeight: 700, color: C.text, margin: '0.1rem 0' }}>
          {pool.name}
        </h1>
        <p style={{ fontSize: '0.85rem', color: C.textMuted, margin: '0.2rem 0 0' }}>
          <Link href={`/h/${slug}/pools/${rawPoolId}`} style={{ color: C.accent }}>← Back to pool detail</Link>
        </p>
      </div>
      <PoolAdminClient
        hubSlug={slug}
        pool={{
          id: pool.id,
          treasuryAddress: treasuryAddress as `0x${string}`,
          name: pool.name,
          acceptedRestrictions: (pool.acceptedRestrictions ?? {}) as Record<string, unknown>,
          acceptedUnits: pool.acceptedUnits ?? [],
          capacityCeiling: pool.capacityCeiling ?? null,
          ceilingPolicy: pool.ceilingPolicy,
          visibility: pool.visibility,
          stewards: pool.stewards ?? [],
        }}
      />
    </div>
  )
}
