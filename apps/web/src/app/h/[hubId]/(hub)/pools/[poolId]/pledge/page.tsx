/**
 * Spec 002 — Intent Marketplace (Pool Lane). Pledge composer page (US3).
 *
 * Server component that loads the pool body and renders the
 * <PledgeComposer /> client form. The composer POSTs to the sibling
 * `submit/route.ts`, which calls into `submitPledge(...)` and on success
 * redirects to the pledge management page.
 */

import { redirect, notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { HUB_SLUG_MAP } from '@/lib/hub-routes'
import { getPoolForViewer } from '@/lib/actions/pools.action'
import { PledgeComposer } from './PledgeComposer'

export const dynamic = 'force-dynamic'

export default async function PoolPledgePage({
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
  if (!myAgent) {
    return (
      <div style={{ padding: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: '#5c4a3a' }}>
          Sign-in required
        </h2>
        <p style={{ color: '#9a8c7e' }}>You need a person agent to pledge to a pool.</p>
      </div>
    )
  }

  const poolId = decodeURIComponent(rawPoolId)
  const { pool } = await getPoolForViewer(poolId, myAgent)
  if (!pool) {
    notFound()
  }

  // Block pledging when the pool's ceiling-block policy has fired.
  const ratio = pool.capacityCeiling && pool.capacityCeiling > 0
    ? pool.pledgedTotal / pool.capacityCeiling
    : 0
  if (ratio >= 1 && pool.ceilingPolicy === 'block') {
    return (
      <div style={{ padding: 24 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: '#5c4a3a' }}>
          Pool is closed to new pledges
        </h2>
        <p style={{ color: '#9a8c7e' }}>
          {pool.name} has reached its capacity ceiling and the pool&rsquo;s policy blocks
          additional pledges. Try a different pool.
        </p>
      </div>
    )
  }

  return (
    <PledgeComposer
      hubSlug={slug}
      poolId={poolId}
      pool={{
        name: pool.name,
        domain: pool.domain,
        visibility: pool.visibility,
        acceptedUnits: pool.acceptedUnits,
        acceptedRestrictions: pool.acceptedRestrictions,
        ceilingPolicy: pool.ceilingPolicy,
        capacityCeiling: pool.capacityCeiling,
        pledgedTotal: pool.pledgedTotal,
      }}
    />
  )
}
