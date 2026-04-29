/**
 * Mentees / coaches query — surfaces COACHING_MENTORSHIP edges from the
 * caller's POV.
 *
 * Convention (matches the demo seed and SDK taxonomy):
 *   subject = coach (the guiding agent)
 *   object  = disciple (the agent being coached)
 *
 * The caller may sit on either side. We return both directions in one
 * list, tagged with `relation: 'mentee' | 'coach'`. Surfaces (Multiplier
 * dashboard, Coach dashboard) decide which to show.
 */

import { COACHING_MENTORSHIP, EdgeStatus } from '@smart-agent/sdk'
import { getEdgesBySubject, getEdgesByObject, getEdge } from '@/lib/contracts'
import { getAgentMetadata } from '@/lib/agent-metadata'

export interface MentoringRow {
  /** counterparty's on-chain address */
  address: `0x${string}`
  displayName: string
  primaryName: string | null
  /** From the caller's perspective: 'mentee' = the caller coaches them,
   *  'coach' = the caller is being coached. */
  relation: 'mentee' | 'coach'
  edgeId: `0x${string}`
}

function isActive(status: number): boolean {
  return status === EdgeStatus.ACTIVE || status === EdgeStatus.CONFIRMED
}

/**
 * List the caller's coaching relationships in both directions.
 * Best-effort: edges with stale metadata are silently skipped.
 */
export async function getMyMentoringRelationships(
  caller: `0x${string}`,
): Promise<MentoringRow[]> {
  const callerLc = caller.toLowerCase()
  const subjectIds = await getEdgesBySubject(caller)
  const objectIds = await getEdgesByObject(caller)
  const all = Array.from(new Set([...subjectIds, ...objectIds]))

  const rows: MentoringRow[] = []
  for (const edgeId of all) {
    let e: Awaited<ReturnType<typeof getEdge>>
    try {
      e = await getEdge(edgeId)
    } catch {
      continue
    }
    if (e.relationshipType !== COACHING_MENTORSHIP) continue
    if (!isActive(e.status)) continue

    const callerIsSubject = e.subject.toLowerCase() === callerLc
    const counterparty = (callerIsSubject ? e.object_ : e.subject) as `0x${string}`
    const relation: 'mentee' | 'coach' = callerIsSubject ? 'mentee' : 'coach'

    let displayName = counterparty as string
    let primaryName: string | null = null
    try {
      const meta = await getAgentMetadata(counterparty)
      if (meta.displayName) displayName = meta.displayName
      if (meta.primaryName) primaryName = meta.primaryName
    } catch {
      // metadata unavailable — keep address fallback
    }

    rows.push({
      address: counterparty,
      displayName,
      primaryName,
      relation,
      edgeId,
    })
  }
  return rows
}
