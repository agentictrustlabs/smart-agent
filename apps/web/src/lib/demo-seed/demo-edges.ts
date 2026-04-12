/**
 * Read demo edges from the demo_edges DB table.
 * Returns simulated relationship edges for demo mode when on-chain contracts are unavailable.
 */

import { db, schema } from '@/db'
import { } from 'drizzle-orm'

const SKIP_AUTH = process.env.NEXT_PUBLIC_SKIP_AUTH === 'true'

export interface DemoEdge {
  subjectAddress: string
  objectAddress: string
  roles: string[]
  relationshipType: string
  status: string
}

/**
 * Get all demo edges where the given address is subject or object.
 * Returns both person→org and org→org edges.
 */
export async function getDemoEdgesForOrg(orgAddress: string): Promise<{ incoming: DemoEdge[]; outgoing: DemoEdge[] }> {
  if (!SKIP_AUTH) return { incoming: [], outgoing: [] }

  const addr = orgAddress.toLowerCase()
  const incoming: DemoEdge[] = []
  const outgoing: DemoEdge[] = []

  try {
    const allEdges = await db.select().from(schema.demoEdges).all()

    for (const edge of allEdges) {
      const parsed: DemoEdge = {
        subjectAddress: edge.subjectAddress,
        objectAddress: edge.objectAddress,
        roles: JSON.parse(edge.roles),
        relationshipType: edge.relationshipType,
        status: edge.status,
      }

      if (edge.objectAddress === addr) {
        incoming.push(parsed) // others → this org
      }
      if (edge.subjectAddress === addr) {
        outgoing.push(parsed) // this org → others
      }
    }
  } catch {
    // Table may not exist — fall back to demo-roles.ts
    try {
      const { getDemoUserOrgRoles } = await import('./demo-roles')
      const allUsers = await db.select().from(schema.users)
      const allPersonAgents = await db.select().from(schema.personAgents)

      for (const user of allUsers) {
        const demoRoles = getDemoUserOrgRoles(user.id)
        const match = demoRoles.find(dr => dr.orgAddress.toLowerCase() === addr)
        if (!match) continue
        const pa = allPersonAgents.find(p => p.userId === user.id)
        if (!pa) continue
        incoming.push({
          subjectAddress: pa.smartAccountAddress.toLowerCase(),
          objectAddress: addr,
          roles: match.roles,
          relationshipType: 'ORGANIZATION_MEMBERSHIP',
          status: 'active',
        })
      }
    } catch { /* ignored */ }
  }

  return { incoming, outgoing }
}

/**
 * Get the user's roles on a specific org from demo edges.
 */
export async function getDemoUserRolesOnOrg(personAgentAddress: string, orgAddress: string): Promise<string[]> {
  if (!SKIP_AUTH) return []

  try {
    const edges = await db.select().from(schema.demoEdges).all()
    const roles: string[] = []
    for (const edge of edges) {
      if (edge.subjectAddress === personAgentAddress.toLowerCase() && edge.objectAddress === orgAddress.toLowerCase()) {
        roles.push(...JSON.parse(edge.roles))
      }
    }
    return roles
  } catch {
    return []
  }
}
