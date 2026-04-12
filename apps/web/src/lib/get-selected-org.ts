import { getPersonAgentForUser, getOrgsForPersonAgent } from '@/lib/agent-registry'
import { getAgentMetadata } from '@/lib/agent-metadata'

/**
 * Get the selected org for a user.
 * Fully on-chain: person agent from resolver → org edges → resolver metadata.
 * Only DB access: users table (for auth).
 */
export async function getSelectedOrg(
  userId: string,
  searchParams?: Record<string, string | string[] | undefined>,
) {
  // Find user's person agent from on-chain registry
  const personAddr = await getPersonAgentForUser(userId)
  if (!personAddr) return null

  // Find all orgs this person has edges to
  const orgs = await getOrgsForPersonAgent(personAddr)
  if (orgs.length === 0) return null

  // Build org list with on-chain metadata
  type OrgView = { smartAccountAddress: string; name: string; description: string; templateId: string | null }
  const orgList: OrgView[] = []

  for (const org of orgs) {
    const meta = await getAgentMetadata(org.address)
    orgList.push({
      smartAccountAddress: org.address,
      name: meta.displayName,
      description: meta.description,
      templateId: null, // No longer used for capabilities — derived from on-chain data
    })
  }

  // Match ?org= param
  const orgParam = searchParams?.org as string | undefined
  if (orgParam) {
    const match = orgList.find(o => o.smartAccountAddress.toLowerCase() === orgParam.toLowerCase())
    if (match) return match
  }

  return orgList[0] ?? null
}
