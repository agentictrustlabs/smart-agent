import type { HubId } from '@/lib/hub-profiles'
import { DEMO_USER_META } from '@/lib/auth/session'

/**
 * Maps URL-friendly hub slugs to internal hub IDs.
 * /h/catalyst → hubId: 'catalyst'
 * /h/mission  → hubId: 'cil'
 * /h/globalchurch → hubId: 'global-church'
 */
export const HUB_SLUG_MAP: Record<string, HubId> = {
  catalyst: 'catalyst',
  mission: 'cil',
  globalchurch: 'global-church',
}

export const HUB_SLUG_REVERSE: Record<string, string> = {
  catalyst: 'catalyst',
  cil: 'mission',
  'global-church': 'globalchurch',
  generic: 'globalchurch',
}

export interface HubLandingConfig {
  slug: string
  hubId: HubId
  name: string
  description: string
  color: string
  demoUsers: Array<{ key: string; name: string; org: string; role: string }>
}

export const HUB_LANDING_CONFIGS: HubLandingConfig[] = [
  {
    slug: 'catalyst',
    hubId: 'catalyst',
    name: 'Catalyst NoCo Network',
    description: 'Northern Colorado Hispanic outreach — church planting, ESL ministry, farm worker advocacy north of Fort Collins',
    color: '#8b5e3c',
    demoUsers: Object.entries(DEMO_USER_META)
      .filter(([, m]) => m.hubId === 'catalyst')
      .map(([key, m]) => ({ key, name: m.name, org: m.org, role: m.role })),
  },
  {
    slug: 'mission',
    hubId: 'cil',
    name: 'Mission Collective',
    description: 'Revenue-sharing capital deployment in Togo — ILAD operations, Ravah model, business health monitoring',
    color: '#2563EB',
    demoUsers: Object.entries(DEMO_USER_META)
      .filter(([, m]) => m.hubId === 'cil')
      .map(([key, m]) => ({ key, name: m.name, org: m.org, role: m.role })),
  },
  {
    slug: 'globalchurch',
    hubId: 'global-church',
    name: 'Global.Church',
    description: 'Trust and stewardship portal — churches, denominations, mission agencies, and endorsers working together',
    color: '#8b5e3c',
    demoUsers: Object.entries(DEMO_USER_META)
      .filter(([, m]) => m.hubId === 'global-church')
      .map(([key, m]) => ({ key, name: m.name, org: m.org, role: m.role })),
  },
]

export function getHubLandingConfig(slug: string): HubLandingConfig | undefined {
  return HUB_LANDING_CONFIGS.find(h => h.slug === slug)
}

export function getHubSlugForId(hubId: string): string {
  return HUB_SLUG_REVERSE[hubId] ?? 'globalchurch'
}
