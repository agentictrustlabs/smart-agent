import { notFound } from 'next/navigation'
import { getHubLandingConfig, HUB_LANDING_CONFIGS } from '@/lib/hub-routes'
import { HubLandingClient } from './HubLandingClient'

export default async function HubLandingPage({ params }: { params: Promise<{ hubId: string }> }) {
  const { hubId } = await params
  const config = getHubLandingConfig(hubId)
  if (!config) notFound()

  return <HubLandingClient config={config} allHubs={HUB_LANDING_CONFIGS.map(h => ({ slug: h.slug, name: h.name, color: h.color }))} />
}
