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
  colorSoft: string
  surfaceTint: string
  heroGradient: string
  eyebrow: string
  demoUsers: Array<{ key: string; name: string; org: string; role: string }>
}

export const HUB_LANDING_CONFIGS: HubLandingConfig[] = [
  {
    slug: 'catalyst',
    hubId: 'catalyst',
    name: 'Catalyst NoCo Network',
    description: 'Northern Colorado Hispanic outreach — church planting, ESL ministry, farm worker advocacy north of Fort Collins',
    color: '#c65d4b',
    colorSoft: '#ffe2da',
    surfaceTint: '#fff6f3',
    heroGradient: 'linear-gradient(135deg, #fff8f5 0%, #fff0ea 46%, #f4f4ff 100%)',
    eyebrow: 'Neighborhood mission hub',
    demoUsers: Object.entries(DEMO_USER_META)
      .filter(([, m]) => m.hubId === 'catalyst')
      .map(([key, m]) => ({ key, name: m.name, org: m.org, role: m.role })),
  },
  {
    slug: 'mission',
    hubId: 'cil',
    name: 'Mission Collective',
    description: 'Revenue-sharing capital deployment in Togo — ILAD operations, Ravah model, business health monitoring',
    color: '#3f6ee8',
    colorSoft: '#dfe7ff',
    surfaceTint: '#f5f8ff',
    heroGradient: 'linear-gradient(135deg, #f7f8ff 0%, #edf2ff 48%, #eef8ff 100%)',
    eyebrow: 'Capital stewardship hub',
    demoUsers: Object.entries(DEMO_USER_META)
      .filter(([, m]) => m.hubId === 'cil')
      .map(([key, m]) => ({ key, name: m.name, org: m.org, role: m.role })),
  },
  {
    slug: 'globalchurch',
    hubId: 'global-church',
    name: 'Global.Church',
    description: 'Trust and stewardship portal — churches, denominations, mission agencies, and endorsers working together',
    color: '#7b58c7',
    colorSoft: '#ebdefe',
    surfaceTint: '#faf7ff',
    heroGradient: 'linear-gradient(135deg, #faf7ff 0%, #f2ecff 48%, #f5f5fb 100%)',
    eyebrow: 'Trust and governance hub',
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
