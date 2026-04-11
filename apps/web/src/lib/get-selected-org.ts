import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { getEdgesBySubject, getEdge } from '@/lib/contracts'

/**
 * Get the selected org from search params, falling back to the user's first org.
 * Finds orgs the user created AND orgs they joined via relationship edges.
 */
export async function getSelectedOrg(
  userId: string,
  searchParams?: Record<string, string | string[] | undefined>,
) {
  // Start with orgs the user created
  const createdOrgs = await db.select().from(schema.orgAgents)
    .where(eq(schema.orgAgents.createdBy, userId))

  // Also find orgs joined via edges
  const personAgents = await db.select().from(schema.personAgents)
    .where(eq(schema.personAgents.userId, userId)).limit(1)

  const allOrgs = [...createdOrgs]

  if (personAgents[0]) {
    try {
      const allOrgsInDb = await db.select().from(schema.orgAgents)
      const edgeIds = await getEdgesBySubject(personAgents[0].smartAccountAddress as `0x${string}`)
      for (const edgeId of edgeIds) {
        const edge = await getEdge(edgeId)
        if (edge.status < 2) continue
        const objAddr = edge.object_.toLowerCase()
        const matchedOrg = allOrgsInDb.find(o => o.smartAccountAddress.toLowerCase() === objAddr)
        if (matchedOrg && !allOrgs.some(o => o.id === matchedOrg.id)) {
          allOrgs.push(matchedOrg)
        }
      }
    } catch { /* contracts not deployed */ }
  }

  if (allOrgs.length === 0) return null

  const orgParam = searchParams?.org as string | undefined
  if (orgParam) {
    const match = allOrgs.find(o => o.smartAccountAddress.toLowerCase() === orgParam.toLowerCase())
    if (match) return match
  }

  return allOrgs[0]
}
