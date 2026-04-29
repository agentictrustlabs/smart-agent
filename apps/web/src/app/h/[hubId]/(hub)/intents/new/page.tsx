import { redirect, notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { HUB_SLUG_MAP } from '@/lib/hub-routes'
import { getHubProfile } from '@/lib/hub-profiles'
import { getPersonAgentForUser, getOrgsForPersonAgent } from '@/lib/agent-registry'
import { ExpressIntentForm } from '@/components/intents/ExpressIntentForm'

export const dynamic = 'force-dynamic'

const C = { text: '#5c4a3a', textMuted: '#9a8c7e', accent: '#8b5e3c' }

export default async function NewIntentPage({ params }: { params: Promise<{ hubId: string }> }) {
  const { hubId: slug } = await params
  const internalHubId = HUB_SLUG_MAP[slug]
  if (!internalHubId) notFound()
  const user = await getCurrentUser()
  if (!user) redirect('/')

  const profile = getHubProfile(internalHubId)
  const personAgent = await getPersonAgentForUser(user.id)
  if (!personAgent) {
    return (
      <div style={{ padding: '2rem' }}>
        <p style={{ color: C.textMuted }}>You need a person agent to express intents.</p>
      </div>
    )
  }
  const orgs = await getOrgsForPersonAgent(personAgent).catch(() => []) as Array<{ address: string }>
  // Resolve org names via the agent metadata cache so the chooser shows
  // human labels instead of addresses.
  const { getAgentMetadata } = await import('@/lib/agent-metadata')
  const orgsWithNames = await Promise.all(orgs.map(async (o) => ({
    address: o.address,
    label: `On behalf of ${(await getAgentMetadata(o.address as `0x${string}`).catch(() => null))?.displayName ?? o.address.slice(0, 10)}`,
  })))
  const eligibleAgents = [
    { address: personAgent, label: 'Me (personal intent)' },
    ...orgsWithNames,
  ]

  return (
    <div style={{ paddingBottom: '2rem' }}>
      <div style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: C.accent, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {profile.name} · Express an intent
        </div>
        <h1 style={{ fontSize: '1.45rem', fontWeight: 700, color: C.text, margin: '0.1rem 0 0.3rem' }}>
          What do you want to express?
        </h1>
        <p style={{ fontSize: '0.85rem', color: C.textMuted, marginTop: 0 }}>
          Pick a direction first — receiving (a need) or giving (an offer). The system matches across the hub on what value flows and the topic, not on the words you use.
        </p>
      </div>
      <ExpressIntentForm hubId={internalHubId} hubSlug={slug} eligibleAgents={eligibleAgents} />
    </div>
  )
}
