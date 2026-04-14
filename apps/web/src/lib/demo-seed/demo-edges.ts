/**
 * Demo edge compatibility helpers.
 * Falls back to demo role fixtures when on-chain contracts are unavailable.
 */

import { db, schema } from '@/db'
import { listRegisteredAgents } from '@/lib/agent-resolver'
import { ORGANIZATION_MEMBERSHIP, relationshipTypeName } from '@smart-agent/sdk'

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
    const { getDemoUserOrgRoles } = await import('./demo-roles')
    const allUsers = await db.select().from(schema.users)
    const allPersonAgents = (await listRegisteredAgents()).filter(agent => agent.kind === 'person')

    for (const user of allUsers) {
      const demoRoles = getDemoUserOrgRoles(user.id)
      const match = demoRoles.find(dr => dr.orgAddress.toLowerCase() === addr)
      if (!match) continue
      const pa = allPersonAgents.find(agent =>
        agent.controllers.some(controller => controller.toLowerCase() === user.walletAddress.toLowerCase())
      )
      if (!pa) continue
      incoming.push({
        subjectAddress: pa.address.toLowerCase(),
        objectAddress: addr,
        roles: match.roles,
        relationshipType: relationshipTypeName(ORGANIZATION_MEMBERSHIP),
        status: 'active',
      })
    }
  } catch { /* ignored */ }

  return { incoming, outgoing }
}

/**
 * Get the user's roles on a specific org from demo edges.
 */
export async function getDemoUserRolesOnOrg(personAgentAddress: string, orgAddress: string): Promise<string[]> {
  if (!SKIP_AUTH) return []

  const { incoming } = await getDemoEdgesForOrg(orgAddress)
  const edge = incoming.find(entry => entry.subjectAddress === personAgentAddress.toLowerCase())
  return edge?.roles ?? []
}
