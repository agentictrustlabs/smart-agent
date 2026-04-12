import { getPersonAgentForUser, getOrgsForPersonAgent } from '@/lib/agent-registry'
import { getAgentMetadata } from '@/lib/agent-metadata'
import { db, schema } from '@/db'

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
  const orgRows = await db.select().from(schema.orgAgents)
  const templateByAddress = new Map(
    orgRows.map(org => [org.smartAccountAddress.toLowerCase(), (org as Record<string, unknown>).templateId as string | null ?? null])
  )

  for (const org of orgs) {
    const meta = await getAgentMetadata(org.address)
    orgList.push({
      smartAccountAddress: org.address,
      name: meta.displayName,
      description: meta.description,
      templateId: templateByAddress.get(org.address.toLowerCase()) ?? null,
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
