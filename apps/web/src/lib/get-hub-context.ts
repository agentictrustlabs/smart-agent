import { getSelectedOrg } from '@/lib/get-selected-org'
import { getHubIdForTemplate, getHubProfile, buildDefaultAgentContexts, type AgentContextView, type HubProfile } from '@/lib/hub-profiles'
import { getConnectedOrgs } from '@/lib/get-org-members'
import { getAiAgentsForOrg } from '@/lib/agent-registry'

/**
 * Server-side hub context resolution.
 * Reads hub, org, and context from search params.
 * Returns the active hub profile, anchor org, and active context.
 */
export async function getHubContext(
  userId: string,
  searchParams?: Record<string, string | string[] | undefined>,
): Promise<{
  hubProfile: HubProfile
  anchorOrg: Awaited<ReturnType<typeof getSelectedOrg>>
  activeContext: AgentContextView | null
  contexts: AgentContextView[]
  connectedOrgs: Awaited<ReturnType<typeof getConnectedOrgs>>
}> {
  const anchorOrg = await getSelectedOrg(userId, searchParams)

  const templateId = (anchorOrg as Record<string, unknown> | null)?.templateId as string | null ?? null
  const hubId = getHubIdForTemplate(templateId)
  const hubProfile = getHubProfile(hubId)

  // Get connected orgs for capability detection
  let connectedOrgs: Awaited<ReturnType<typeof getConnectedOrgs>> = []
  if (anchorOrg) {
    try { connectedOrgs = await getConnectedOrgs(anchorOrg.smartAccountAddress) } catch { /* ignored */ }
  }

  // Get AI agents for capability detection
  let aiCount = 0
  if (anchorOrg) {
    try { aiCount = (await getAiAgentsForOrg(anchorOrg.smartAccountAddress)).length } catch { /* ignored */ }
  }

  // Build capabilities from on-chain data
  const capabilities = ['network', 'agents', 'reviews']
  if (connectedOrgs.length > 0) capabilities.push('genmap', 'activities', 'members')
  if (aiCount > 0) capabilities.push('treasury')

  // Build contexts
  const contexts = anchorOrg ? buildDefaultAgentContexts({
    orgAddress: anchorOrg.smartAccountAddress,
    orgName: anchorOrg.name,
    orgDescription: anchorOrg.description,
    hubId,
    capabilities,
    aiAgentCount: aiCount,
  }) : []

  // Resolve active context from URL param
  const contextParam = searchParams?.context as string | undefined
  const activeContext = contexts.find(c => c.id === contextParam)
    ?? contexts.find(c => c.isDefault)
    ?? contexts[0]
    ?? null

  return { hubProfile, anchorOrg, activeContext, contexts, connectedOrgs }
}
