/**
 * New Round wizard. Lets a steward of one of the hub's pools open a
 * formal grant round backed by that pool's treasury. Calls openRound()
 * server action via the sibling submit/route.ts on form submit.
 *
 * Auth: viewer must have a person agent. The list of eligible operating
 * pools is filtered server-side to those the viewer can manage
 * (canManageAgent against pool.id). If none, the wizard renders an
 * empty-state pointing at /pools/new.
 */

import { redirect, notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { HUB_SLUG_MAP } from '@/lib/hub-routes'
import { getHubProfile } from '@/lib/hub-profiles'
import { getPersonAgentForUser, canManageAgent } from '@/lib/agent-registry'
import { listPoolsForViewer } from '@/lib/actions/pools.action'
import { RoundCreateForm, type EligiblePool } from './RoundCreateForm'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const C = { text: '#5c4a3a', textMuted: '#9a8c7e', accent: '#8b5e3c', card: '#ffffff', border: '#ece6db' }

const AGENT_IRI_PREFIX = 'https://smartagent.io/ontology/core#agent/'

function poolAddressFromIri(poolAgentId: string): string {
  // Pool IDs in the index are URNs (urn:smart-agent:pool:<slug>). To
  // canManage them we need the on-chain agent address — discovery
  // surfaces it on the pool's `id` (URN form) so we use that as-is for
  // the fund linkage but we can't directly canManage on a URN. Treasury
  // address lives in the on-chain assertion payload; until we surface
  // that here, we fall back to checking that viewer is a steward of the
  // hub network (manages the catalyst NoCo Network agent).
  return poolAgentId
}

export default async function NewRoundPage({ params }: { params: Promise<{ hubId: string }> }) {
  const { hubId: slug } = await params
  const internalHubId = HUB_SLUG_MAP[slug]
  if (!internalHubId) notFound()
  const user = await getCurrentUser()
  if (!user) redirect('/')
  const myAgent = await getPersonAgentForUser(user.id)
  if (!myAgent) redirect(`/h/${slug}/home`)
  const profile = getHubProfile(internalHubId)

  // Fetch all hub pools then narrow to those the viewer can administer.
  // For Phase 2.5 demo: any pool whose `stewards` list contains the
  // viewer's person agent OR whose underlying fund the viewer can
  // manage qualifies. The catalyst seed has Maria as governance owner
  // of the network (the fund), so all pools operated by the network
  // are eligible for her.
  const allPools = await listPoolsForViewer({ hubId: internalHubId, viewerAgentId: myAgent })
  const eligiblePools: EligiblePool[] = []
  for (const p of allPools) {
    // The pool's "fund" address is the treasury — for our seeded pools that's
    // the catalyst NoCo Network. Use canManageAgent against the network so
    // the gate matches the close-round / cancel-round gate elsewhere.
    const fundIri = p.stewardshipAgent || ''
    const fundAddr = fundIri.startsWith(AGENT_IRI_PREFIX)
      ? fundIri.slice(AGENT_IRI_PREFIX.length)
      : fundIri
    let canMng = false
    if (fundAddr) {
      try { canMng = await canManageAgent(myAgent, fundAddr) } catch { canMng = false }
    }
    if (canMng) {
      eligiblePools.push({
        poolAgentId: p.id,
        poolAgentAddress: p.treasuryAddress || '',
        fundAgentId: fundAddr,
        name: p.name || p.id.split(':').pop() || 'Pool',
        acceptedKinds: p.acceptedRestrictions?.kinds ?? [],
        acceptedGeo: p.acceptedRestrictions?.geoRoots ?? [],
      })
    }
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
          Pick the pool that operates the round, set the mandate + deadlines, and open. Stewards
          can review proposals on the round and finalize awards before the dispute window closes.
        </p>
      </div>

      {eligiblePools.length === 0 ? (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '1.4rem 1.5rem', maxWidth: '36rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, color: C.text, margin: 0 }}>No eligible pool</h2>
          <p style={{ fontSize: '0.85rem', color: C.textMuted, marginTop: '0.4rem' }}>
            You don&rsquo;t manage any pool in this hub. Create one first, then come back here
            to open a round backed by it.
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
