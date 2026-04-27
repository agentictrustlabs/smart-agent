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

  // Dedupe edge IDs across out/in (a self-edge would appear in both).
  const seen = new Set<string>()
  const pending: Array<{ edgeId: `0x${string}`; direction: RelationshipDirection }> = []
  for (const id of outIds) { if (!seen.has(id)) { seen.add(id); pending.push({ edgeId: id, direction: 'outgoing' }) } }
  for (const id of inIds)  { if (!seen.has(id)) { seen.add(id); pending.push({ edgeId: id, direction: 'incoming' }) } }

  // Hydrate every edge in parallel — getEdge + getEdgeRoles + getAgentMetadata
  // overlap. Sequential awaits used to dominate dashboard render time.
  const rows = (await Promise.all(pending.map(async ({ edgeId, direction }): Promise<MyRelationshipRow | null> => {
    let edge: Awaited<ReturnType<typeof getEdge>>
    try { edge = await getEdge(edgeId) } catch { return null }
    if (edge.status === 5 || edge.status === 6) return null

    const counterparty = direction === 'outgoing' ? edge.object_ : edge.subject
    const [roles, meta] = await Promise.all([
      getEdgeRoles(edgeId).catch(() => [] as `0x${string}`[]),
      getAgentMetadata(counterparty).catch(() => null),
    ])

    const displayName = meta?.displayName || `${counterparty.slice(0, 6)}…${counterparty.slice(-4)}`
    const primaryName = meta?.primaryName || null

    return {
      edgeId,
      direction,
      counterpartyAddress: counterparty,
      counterpartyDisplayName: displayName,
      counterpartyPrimaryName: primaryName,
      relationshipTypeLabel: relationshipTypeName(edge.relationshipType) || 'Relationship',
      roleLabels: roles.map(r => roleName(r) || 'Role'),
      status: edge.status,
      statusLabel: STATUS_LABELS[edge.status] ?? `Status ${edge.status}`,
    }
  }))).filter((r): r is MyRelationshipRow => r !== null)

  // Sort: pending first (so the user notices), then confirmed/active.
  rows.sort((a, b) => {
    const pa = a.status === 1 ? 0 : 1
    const pb = b.status === 1 ? 0 : 1
    if (pa !== pb) return pa - pb
    return a.counterpartyDisplayName.localeCompare(b.counterpartyDisplayName)
  })

  return rows
}
