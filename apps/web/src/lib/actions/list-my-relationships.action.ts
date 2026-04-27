'use server'

/**
 * Lists every on-chain RelationshipEdge touching the caller's person
 * agent, in either subject or object position. Used by the home
 * dashboard's "Relationships & Data Delegations" pane so a freshly-
 * minted edge from AddRelationshipPanel becomes visible immediately
 * after `router.refresh()` — without waiting on the debounced KB
 * write-through to land in GraphDB.
 *
 * Read path is direct on-chain (AgentRelationship + AgentAccountResolver
 * + agent-metadata for display names). PROPOSED edges are included so
 * the user sees their pending request right away.
 */

import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { getEdgesBySubject, getEdgesByObject, getEdge, getEdgeRoles } from '@/lib/contracts'
import { getAgentMetadata } from '@/lib/agent-metadata'
import { relationshipTypeName, roleName } from '@smart-agent/sdk'

export type RelationshipDirection = 'outgoing' | 'incoming'

export interface MyRelationshipRow {
  edgeId: string
  direction: RelationshipDirection
  /** The other end of the edge (object if outgoing, subject if incoming). */
  counterpartyAddress: string
  counterpartyDisplayName: string
  counterpartyPrimaryName: string | null
  relationshipTypeLabel: string
  roleLabels: string[]
  status: number
  statusLabel: string
}

const STATUS_LABELS: Record<number, string> = {
  0: 'None',
  1: 'Proposed',
  2: 'Confirmed',
  3: 'Active',
  4: 'Suspended',
  5: 'Revoked',
  6: 'Rejected',
}

export async function listMyRelationshipsAction(): Promise<MyRelationshipRow[]> {
  const me = await getCurrentUser()
  if (!me) return []
  const person = (await getPersonAgentForUser(me.id)) as `0x${string}` | null
  if (!person) return []

  let outIds: `0x${string}`[] = []
  let inIds: `0x${string}`[] = []
  try { outIds = await getEdgesBySubject(person) } catch { /* */ }
  try { inIds = await getEdgesByObject(person) } catch { /* */ }

  const seen = new Set<string>()
  const rows: MyRelationshipRow[] = []
  const enrich = async (edgeId: `0x${string}`, direction: RelationshipDirection) => {
    if (seen.has(edgeId)) return
    seen.add(edgeId)
    let edge: Awaited<ReturnType<typeof getEdge>>
    try { edge = await getEdge(edgeId) } catch { return }
    if (edge.status === 5 || edge.status === 6) return // revoked/rejected — hide

    const counterparty = direction === 'outgoing' ? edge.object_ : edge.subject
    let roles: `0x${string}`[] = []
    try { roles = await getEdgeRoles(edgeId) } catch { /* */ }

    let displayName = `${counterparty.slice(0, 6)}…${counterparty.slice(-4)}`
    let primaryName: string | null = null
    try {
      const meta = await getAgentMetadata(counterparty)
      if (meta.displayName) displayName = meta.displayName
      primaryName = meta.primaryName || null
    } catch { /* */ }

    rows.push({
      edgeId,
      direction,
      counterpartyAddress: counterparty,
      counterpartyDisplayName: displayName,
      counterpartyPrimaryName: primaryName,
      relationshipTypeLabel: relationshipTypeName(edge.relationshipType) || 'Relationship',
      roleLabels: roles.map(r => roleName(r) || 'Role'),
      status: edge.status,
      statusLabel: STATUS_LABELS[edge.status] ?? `Status ${edge.status}`,
    })
  }

  for (const id of outIds) await enrich(id, 'outgoing')
  for (const id of inIds) await enrich(id, 'incoming')

  // Sort: pending first (so the user notices), then confirmed/active.
  rows.sort((a, b) => {
    const pa = a.status === 1 ? 0 : 1
    const pb = b.status === 1 ? 0 : 1
    if (pa !== pb) return pa - pb
    return a.counterpartyDisplayName.localeCompare(b.counterpartyDisplayName)
  })

  return rows
}
