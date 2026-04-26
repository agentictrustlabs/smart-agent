import { redirect, notFound } from 'next/navigation'
import { getHubLandingConfig } from '@/lib/hub-routes'
import { listHubsForOnboarding } from '@/lib/actions/onboarding/setup-agent.action'
import { getHubOnboardingState } from '@/lib/actions/onboarding/hub-onboard.action'
import { HubOnboardClient } from './HubOnboardClient'

/**
 * /h/{slug} — single onboarding entry point.
 *
 *   - Already a member of this hub → redirect to /h/{slug}/home (no
 *     gate UI flicker).
 *   - Otherwise → render HubOnboardClient, which walks the user through
 *     connect → profile → register → name → join → done.
 *
 * The hub address is resolved on-chain (via listHubsForOnboarding's name
 * match) so the wizard knows which hub to auto-join. There is no demo
 * user picker here anymore — that lived in HubLandingClient and conflated
 * onboarding with demo-mode log-in. Demo accounts now sign in via /demo
 * (or directly through the hub's home page once the membership exists).
 */
export default async function HubLandingPage({ params }: { params: Promise<{ hubId: string }> }) {
  const { hubId: slug } = await params
  const config = getHubLandingConfig(slug)
  if (!config) notFound()

  // Resolve the hub's on-chain address by name match. The hub registry is
  // small (3 hubs in the demo), so listing them and finding the one whose
  // displayName/primaryName matches this slug is cheap.
  const hubs = await listHubsForOnboarding().catch(() => [])
  const hub = hubs.find(h => slugMatches(h, config.hubId))
  if (!hub) {
    // The on-chain registry doesn't have this hub yet (deploy step still
    // pending). Surface a clear empty state rather than the wizard.
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#f6f7fb' }}>
        <div style={{ maxWidth: 460, textAlign: 'center', color: '#475569' }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#171c28', marginBottom: 8 }}>{config.name}</h1>
          <p>This hub isn't on-chain yet. The deploy step needs to run before users can join.</p>
        </div>
      </main>
    )
  }

  // If already a member, get out of the way — they want the dashboard,
  // not the wizard.
  const initialState = await getHubOnboardingState(hub.address)
  if (initialState.step === 'done') {
    redirect(`/h/${slug}/home`)
  }

  return (
    <main
      style={{
        minHeight: '100vh',
        background: `linear-gradient(135deg, ${config.color}10 0%, transparent 50%), ${config.heroGradient}`,
      }}
    >
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '4rem 1.25rem 2rem' }}>
        <header style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: config.color, letterSpacing: '0.18em', textTransform: 'uppercase' }}>
            {config.eyebrow}
          </div>
          <h1 style={{ fontSize: 36, fontWeight: 700, color: '#171c28', margin: '6px 0', letterSpacing: '-0.03em' }}>
            {config.name}
          </h1>
          <p style={{ fontSize: 14, color: '#5d6478', maxWidth: 480, margin: '0 auto' }}>
            {config.description}
          </p>
        </header>
        <HubOnboardClient hubSlug={slug} hubId={config.hubId} initialState={initialState} accent={config.color} />
      </div>
    </main>
  )
}

function slugMatches(
  hub: { displayName: string; primaryName: string },
  hubId: 'catalyst' | 'cil' | 'global-church' | 'generic',
): boolean {
  const hay = `${hub.displayName} ${hub.primaryName}`.toLowerCase()
  if (hubId === 'catalyst') return hay.includes('catalyst')
  if (hubId === 'global-church') return hay.includes('global') && hay.includes('church')
  if (hubId === 'cil') return hay.includes('mission') || hay.includes('collective') || hay.includes('cil')
  return false
}
