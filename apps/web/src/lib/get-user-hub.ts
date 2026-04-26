import { getUserOrgs } from '@/lib/get-user-orgs'
import { getAgentTemplateId } from '@/lib/agent-resolver'
import { getHubIdForTemplate, type HubId } from '@/lib/hub-profiles'
import { getPersonAgentForUser, getHubsForAgent } from '@/lib/agent-registry'
import { getAgentMetadata } from '@/lib/agent-metadata'

/**
 * Determine the hub ID for a user from on-chain data.
 * Checks: hub membership (by name), then org templates, then falls back to generic.
 */
function hubIdFromName(name: string): HubId | null {
  const n = name.toLowerCase()
  if (n.includes('catalyst')) return 'catalyst'
  if (n.includes('global') && n.includes('church')) return 'global-church'
  if (n.includes('collective') || n.includes('cil') || n.includes('mission')) return 'cil'
  return null
}

export async function getUserHubId(userId: string): Promise<HubId> {
  // 1. Direct person-agent → hub membership. A user can be a member of a hub
  //    without going through an org (HAS_MEMBER edge with subject=hub,
  //    object=personAgent). Created by joinHubAsPerson at onboarding time.
  try {
    const personAddr = await getPersonAgentForUser(userId)
    if (personAddr) {
      const directHubs = await getHubsForAgent(personAddr)
      for (const hubAddr of directHubs) {
        const meta = await getAgentMetadata(hubAddr)
        const id = hubIdFromName(meta.displayName) || hubIdFromName(meta.primaryName || '')
        if (id) return id
      }
    }
  } catch { /* ignored */ }

  // 2. Fall back to org-derived hub: any of the user's orgs that's itself a
  //    member of a hub (HAS_MEMBER edge with subject=hub, object=org).
  const orgs = await getUserOrgs(userId)
  for (const org of orgs) {
    try {
      const hubAddrs = await getHubsForAgent(org.address)
      for (const hubAddr of hubAddrs) {
        const meta = await getAgentMetadata(hubAddr)
        const id = hubIdFromName(meta.displayName) || hubIdFromName(meta.primaryName || '')
        if (id) return id
      }
    } catch { /* ignored */ }
  }

  // 3. Org template matching (fallback for orgs whose hub edge isn't set yet).
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
