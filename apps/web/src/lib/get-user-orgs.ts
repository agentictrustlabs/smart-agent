import { getPersonAgentForUser, getOrgsForPersonAgent } from '@/lib/agent-registry'
import { getAgentMetadata } from '@/lib/agent-metadata'

export interface UserOrgView {
  address: string
  name: string
  description: string
  roles: string[]
}

/**
 * Get all organizations the user is associated with (server-side).
 * Returns orgs with roles from on-chain edges + resolver metadata.
 */
export async function getUserOrgs(userId: string): Promise<UserOrgView[]> {
  const personAddr = await getPersonAgentForUser(userId)
  if (!personAddr) return []

  const orgEdges = await getOrgsForPersonAgent(personAddr)
  const orgs: UserOrgView[] = []

  for (const edge of orgEdges) {
    const meta = await getAgentMetadata(edge.address)
    orgs.push({
      address: edge.address,
      name: meta.displayName,
      description: meta.description,
      roles: edge.roles,
    })
  }

  return orgs
}

/**
 * Get a specific org by address if user has a relationship with it.
 */
export async function getUserOrg(userId: string, orgAddress: string): Promise<UserOrgView | null> {
  const orgs = await getUserOrgs(userId)
  return orgs.find(o => o.address.toLowerCase() === orgAddress.toLowerCase()) ?? null
}
