/**
 * New Round wizard.
 *
 * Unified governance rule: a round is operated by the pool itself. The
 * pool's AgentAccount owners (= the anchoring org's members, set by the
 * pool-create flow) are the round's operators. No separate "fund agent"
 * concept; round.fundAgent = round.poolAgent.
 *
 * Auth: viewer must be able to manage at least one pool's AgentAccount.
 * `canManageAgent` walks on-chain isOwner (direct owner OR co-owner via
 * an org that owns the pool).
 */

import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { HUB_SLUG_MAP } from '@/lib/hub-routes'
import { getHubProfile } from '@/lib/hub-profiles'
import { getPersonAgentForUser, canManageAgent } from '@/lib/agent-registry'
import { listPoolsForViewer } from '@/lib/actions/pools.action'
import { RoundCreateForm, type EligiblePool } from './RoundCreateForm'

export const dynamic = 'force-dynamic'

const C = { text: '#5c4a3a', textMuted: '#9a8c7e', accent: '#8b5e3c', card: '#ffffff', border: '#ece6db' }

export default async function NewRoundPage({ params }: { params: Promise<{ hubId: string }> }) {
  const { hubId: slug } = await params
  const internalHubId = HUB_SLUG_MAP[slug]
  if (!internalHubId) notFound()
  const user = await getCurrentUser()
  if (!user) redirect('/')
  const myAgent = await getPersonAgentForUser(user.id)
  if (!myAgent) redirect(`/h/${slug}/home`)
  const profile = getHubProfile(internalHubId)

  // Eligible = pools whose AgentAccount the viewer can manage.
  const allPools = await listPoolsForViewer({ hubId: internalHubId, viewerAgentId: myAgent })
  const eligiblePools: EligiblePool[] = []
  for (const p of allPools) {
    if (!p.treasuryAddress) continue
    let canMng = false
    try { canMng = await canManageAgent(myAgent, p.treasuryAddress) } catch { canMng = false }
    if (!canMng) continue
    eligiblePools.push({
      poolAgentId: p.id,
      poolAgentAddress: p.treasuryAddress,
      name: p.name || p.id.split(':').pop() || 'Pool',
      acceptedKinds: p.acceptedRestrictions?.kinds ?? [],
      acceptedGeo: p.acceptedRestrictions?.geoRoots ?? [],
    })
  }

  return (
    <div style={{ paddingBottom: '2rem' }}>
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {profile.name} · New round
        </div>
        <h1 style={{ fontSize: '1.45rem', fontWeight: 700, color: C.text, margin: '0.1rem 0' }}>
          Open a grant round
        </h1>
        <p style={{ fontSize: '0.85rem', color: C.textMuted, margin: '0.2rem 0 0' }}>
          Pick the pool this round draws from. The pool&rsquo;s owners (you, plus the
          org that anchors the pool) become this round&rsquo;s operators.
        </p>
      </div>

      {eligiblePools.length === 0 ? (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '1.4rem 1.5rem', maxWidth: '36rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, color: C.text, margin: 0 }}>No pool to run this round</h2>
          <p style={{ fontSize: '0.85rem', color: C.textMuted, marginTop: '0.4rem' }}>
            You don&rsquo;t govern any pool in this hub. Create one first under an organisation
            you manage, then come back to open a round on it.
          </p>
          <div style={{ marginTop: '0.9rem' }}>
            <Link
              href={`/h/${slug}/pools/new`}
              style={{ padding: '0.45rem 0.95rem', background: C.accent, color: '#fff', borderRadius: 8, fontSize: '0.85rem', fontWeight: 700, textDecoration: 'none' }}
            >
              + New pool
            </Link>
          </div>
        </div>
      ) : (
        <RoundCreateForm hubSlug={slug} pools={eligiblePools} />
      )}
    </div>
  )
}
