import { getUserOrgs } from '@/lib/get-user-orgs'
import { getAgentTemplateId } from '@/lib/agent-resolver'
import { getHubIdForTemplate, type HubId } from '@/lib/hub-profiles'

/**
 * Determine the hub ID for a user from their on-chain org template.
 * No user ID prefix checks — purely data-driven.
 */
export async function getUserHubId(userId: string): Promise<HubId> {
  const orgs = await getUserOrgs(userId)

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
