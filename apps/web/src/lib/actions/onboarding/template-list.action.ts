'use server'

import { getTemplatesForHub } from '@/lib/org-templates'

export interface OrgTemplateOption {
  id: string
  name: string
  description: string
  color: string
  /** True when this template is marked as featured for the given hub. */
  featured: boolean
}

/**
 * Server action wrapper around getTemplatesForHub. Returns just the
 * fields the picker needs (id/name/description/color/featured) so we
 * don't ship the full role + AI-agent definitions to the client.
 */
export async function fetchTemplatesForHub(hubId: string): Promise<OrgTemplateOption[]> {
  const { HUB_PROFILES } = await import('@/lib/hub-profiles')
  const profile = HUB_PROFILES.find(p => p.id === hubId)
  const featured = new Set(profile?.templateIds ?? [])
  const templates = await getTemplatesForHub(hubId)
  return templates.map(t => ({
    id: t.id,
    name: t.name,
    description: t.description,
    color: t.color,
    featured: featured.has(t.id),
  }))
}
