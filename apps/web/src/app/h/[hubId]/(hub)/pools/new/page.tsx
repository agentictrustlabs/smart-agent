/**
 * Pool create wizard — calls createPool() server action via the sibling
 * submit/route.ts. Server component renders the form shell + steward gate;
 * the actual stateful form is the PoolCreateForm client component.
 *
 * Auth: any user with a person agent can reach the page. Production may
 * narrow to "users authorised on a parent org agent" — defer until we
 * have a multi-org pool model.
 */

import { redirect, notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { HUB_SLUG_MAP } from '@/lib/hub-routes'
import { getHubProfile } from '@/lib/hub-profiles'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { PoolCreateForm } from './PoolCreateForm'

export const dynamic = 'force-dynamic'

const C = { text: '#5c4a3a', textMuted: '#9a8c7e', accent: '#8b5e3c' }

export default async function NewPoolPage({ params }: { params: Promise<{ hubId: string }> }) {
  const { hubId: slug } = await params
  const internalHubId = HUB_SLUG_MAP[slug]
  if (!internalHubId) notFound()
  const user = await getCurrentUser()
  if (!user) redirect('/')
  const myAgent = await getPersonAgentForUser(user.id)
  if (!myAgent) redirect(`/h/${slug}/home`)

  const profile = getHubProfile(internalHubId)

  return (
    <div style={{ paddingBottom: '2rem' }}>
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {profile.name} · New pool
        </div>
        <h1 style={{ fontSize: '1.45rem', fontWeight: 700, color: C.text, margin: '0.1rem 0' }}>
          Create a funding pool
        </h1>
        <p style={{ fontSize: '0.85rem', color: C.textMuted, margin: '0.2rem 0 0' }}>
          Deploys an ERC-4337 AgentAccount as the pool&rsquo;s treasury, persists the body in
          org-mcp, and emits <code>sa:PoolOpenedAssertion</code> on chain. Mandate fields drive
          which intent kinds + geographies are eligible for disbursement.
        </p>
      </div>
      <PoolCreateForm hubSlug={slug} />
    </div>
  )
}
