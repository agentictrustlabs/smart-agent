import { getUserOrgs } from '@/lib/get-user-orgs'
import { getAgentTemplateId } from '@/lib/agent-resolver'
import { getHubIdForTemplate, type HubId } from '@/lib/hub-profiles'
import { getPersonAgentForUser, getHubsForAgent } from '@/lib/agent-registry'
import { getAgentMetadata } from '@/lib/agent-metadata'

/**
 * Determine the hub ID for a user from on-chain data.
 * Checks: hub membership (by name), then org templates, then falls back to generic.
 */
export async function getUserHubId(userId: string): Promise<HubId> {
  // 1. Check hub membership via on-chain edges (matches user-context approach)
  const orgs = await getUserOrgs(userId)
  for (const org of orgs) {
    try {
      const hubAddrs = await getHubsForAgent(org.address)
      for (const hubAddr of hubAddrs) {
        const meta = await getAgentMetadata(hubAddr)
        const name = meta.displayName.toLowerCase()
        if (name.includes('catalyst')) return 'catalyst'
        if (name.includes('global') && name.includes('church')) return 'global-church'
        if (name.includes('collective') || name.includes('cil') || name.includes('mission')) return 'cil'
      }
    } catch { /* ignored */ }
  }

  // 2. Fall back to org template matching
  for (const org of orgs) {
    try {
      const templateId = await getAgentTemplateId(org.address)
      if (templateId) {
        return getHubIdForTemplate(templateId)
      }
    } catch { /* ignored */ }
  }

  return 'generic'
}
