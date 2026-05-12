/**
 * Pool create wizard.
 *
 * Governance rule (unified): every pool is owned by an organisation. The
 * organisation's AgentAccount becomes an owner of the pool's AgentAccount,
 * so the pool's stewards = the org's owners. Rounds opened on this pool
 * inherit those owners as their operators (round.operator === poolAgent;
 * pool.isOwner(caller) gates every round-admin write).
 *
 * Auth: viewer must own at least one organisation. No "personal pool"
 * option here — personal flows can use a personal AgentAccount directly
 * in a future spec; for the demo we keep the model uniform.
 */

import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { HUB_SLUG_MAP } from '@/lib/hub-routes'
import { getHubProfile } from '@/lib/hub-profiles'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { getUserOrgs } from '@/lib/get-user-orgs'
import { getAgentMetadata } from '@/lib/agent-metadata'
import { PoolCreateForm, type EligibleOrg } from './PoolCreateForm'

export const dynamic = 'force-dynamic'

const C = { text: '#5c4a3a', textMuted: '#9a8c7e', accent: '#8b5e3c', card: '#ffffff', border: '#ece6db' }

export default async function NewPoolPage({ params }: { params: Promise<{ hubId: string }> }) {
  const { hubId: slug } = await params
  const internalHubId = HUB_SLUG_MAP[slug]
  if (!internalHubId) notFound()
  const user = await getCurrentUser()
  if (!user) redirect('/')
  const myAgent = await getPersonAgentForUser(user.id)
  if (!myAgent) redirect(`/h/${slug}/home`)

  const profile = getHubProfile(internalHubId)

  // Resolve eligible operating orgs (orgs the user has Governance/owner
  // role on). The chosen org's AgentAccount becomes a co-owner of the
  // pool — that's the unified stewardship rule.
  const userOrgs = await getUserOrgs(user.id)
  const eligibleOrgs: EligibleOrg[] = []
  for (const org of userOrgs) {
    let displayName = org.name
    try {
      const meta = await getAgentMetadata(org.address as `0x${string}`)
      displayName = meta.primaryName || meta.displayName || org.name
    } catch { /* keep fallback */ }
    eligibleOrgs.push({ orgAddress: org.address as `0x${string}`, orgName: displayName })
  }

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
          Deploys an ERC-4337 AgentAccount as the pool&rsquo;s treasury. The chosen organisation
          becomes a co-owner of the pool&rsquo;s account, so its members govern the pool and
          inherit operator rights on any round backed by it.
        </p>
      </div>
      {eligibleOrgs.length === 0 ? (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '1.4rem 1.5rem', maxWidth: '36rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, color: C.text, margin: 0 }}>No organisation to anchor this pool</h2>
          <p style={{ fontSize: '0.85rem', color: C.textMuted, marginTop: '0.4rem' }}>
            Pools are governed by an organisation. Create or join one first, then come back
            here to create the pool under that org.
          </p>
          <div style={{ marginTop: '0.9rem' }}>
            <Link
              href={`/agents`}
              style={{ padding: '0.45rem 0.95rem', background: C.accent, color: '#fff', borderRadius: 8, fontSize: '0.85rem', fontWeight: 700, textDecoration: 'none' }}
            >
              Manage organisations
            </Link>
          </div>
        </div>
      ) : (
        <PoolCreateForm hubSlug={slug} orgs={eligibleOrgs} />
      )}
    </div>
  )
}
