/**
 * Relational distance — how close, in the on-chain trust graph, is a
 * candidate person to the caller? Used to rank Discover results so the
 * surface always shows people *the caller can actually reach* before
 * showing the open registry.
 *
 *   degree 1 — direct edge (coaching, personal influence, any active
 *              relationship between caller and candidate)
 *   degree 2 — co-org member (we both belong to the same org via
 *              HAS_MEMBER / ORGANIZATION_MEMBERSHIP / GOVERNANCE)
 *   degree 3 — sister-network member (our orgs are bridged by an
 *              ALLIANCE edge; e.g. Catalyst NoCo ↔ Front Range)
 *   degree 4 — open registry (no path found in this scorer's reach)
 *
 * The scorer is cheap-but-bounded: it does at most one outward hop from
 * the caller's orgs into allied orgs. No transitive closure beyond
 * three hops, no role-graph traversal — Phase 5 will add weighting.
 */

import {
  HAS_MEMBER,
  ORGANIZATION_MEMBERSHIP,
  ORGANIZATION_GOVERNANCE,
  ALLIANCE,
  COACHING_MENTORSHIP,
  PERSONAL_INFLUENCE,
  EdgeStatus,
} from '@smart-agent/sdk'
import { getEdgesBySubject, getEdgesByObject, getEdge } from '@/lib/contracts'

const ORG_AFFILIATION = new Set<`0x${string}`>([
  HAS_MEMBER as `0x${string}`,
  ORGANIZATION_MEMBERSHIP as `0x${string}`,
  ORGANIZATION_GOVERNANCE as `0x${string}`,
])

const PERSON_TO_PERSON = new Set<`0x${string}`>([
  COACHING_MENTORSHIP as `0x${string}`,
  PERSONAL_INFLUENCE as `0x${string}`,
])

function isActive(status: number): boolean {
  return status === EdgeStatus.ACTIVE || status === EdgeStatus.CONFIRMED
}

function lc(addr: `0x${string}`): string {
  return addr.toLowerCase()
}

export interface DistanceMap {
  caller: `0x${string}`
  /** addr → reason (1st degree: direct edges, including coaching) */
  ring1: Map<string, string>
  /** addr → reason (2nd degree: shares an org with caller) */
  ring2: Map<string, string>
  /** addr → reason (3rd degree: in an allied org / sister network) */
  ring3: Map<string, string>
  /** Orgs the caller belongs to (lower-case addresses). */
  callerOrgs: Set<string>
}

export interface Classification {
  /** 1 = direct, 2 = co-org, 3 = sister, 4 = open */
  degree: 1 | 2 | 3 | 4
  /** Short, human-readable rationale (e.g. "Coach", "Catalyst NoCo member"). */
  reason: string
}

/**
 * Walk the caller's edge neighborhood and bucket every reachable agent
 * into ring 1, 2, or 3. Candidates not in any ring are degree 4 (open).
 */
export async function buildDistanceMap(caller: `0x${string}`): Promise<DistanceMap> {
  const ring1 = new Map<string, string>()
  const ring2 = new Map<string, string>()
  const ring3 = new Map<string, string>()
  const callerOrgs = new Set<string>()

  // 1) Caller's own edges → ring 1 (peer-to-peer) or callerOrgs (org-membership).
  const ownEdgeIds = [
    ...(await getEdgesBySubject(caller)),
    ...(await getEdgesByObject(caller)),
  ]
  const seen = new Set<string>()
  for (const id of ownEdgeIds) {
    if (seen.has(id)) continue
    seen.add(id)
    const e = await getEdge(id)
    if (!isActive(e.status)) continue

    const counterparty: `0x${string}` =
      lc(e.subject) === lc(caller) ? e.object_ : e.subject

    if (ORG_AFFILIATION.has(e.relationshipType)) {
      callerOrgs.add(lc(counterparty))
      continue
    }
    if (PERSON_TO_PERSON.has(e.relationshipType)) {
      const role = e.relationshipType === COACHING_MENTORSHIP
        ? (lc(e.subject) === lc(caller) ? 'Coach' : 'Disciple')
        : 'Personal contact'
      ring1.set(lc(counterparty), role)
      continue
    }
    // Generic direct edge: still degree 1, less specific reason.
    ring1.set(lc(counterparty), 'Direct relationship')
  }

  // 2) For each caller org, fan out to its members → ring 2;
  //    and to allied orgs → harvest their members → ring 3.
  const alliedOrgs = new Set<string>()
  for (const orgAddrLc of callerOrgs) {
    const orgAddr = orgAddrLc as `0x${string}`
    const orgEdgeIds = [
      ...(await getEdgesBySubject(orgAddr)),
      ...(await getEdgesByObject(orgAddr)),
    ]
    for (const id of orgEdgeIds) {
      const e = await getEdge(id)
      if (!isActive(e.status)) continue

      // Members of the same org → ring 2.
      if (ORG_AFFILIATION.has(e.relationshipType)) {
        const member: `0x${string}` =
          lc(e.subject) === orgAddrLc ? e.object_ : e.subject
        const memberLc = lc(member)
        if (memberLc === lc(caller)) continue
        if (callerOrgs.has(memberLc)) continue            // it's an org, not a person
        if (!ring1.has(memberLc) && !ring2.has(memberLc)) {
          ring2.set(memberLc, 'Member of an org you steward')
        }
        continue
      }

      // Allied org → record for the second hop.
      if (e.relationshipType === ALLIANCE) {
        const ally: `0x${string}` =
          lc(e.subject) === orgAddrLc ? e.object_ : e.subject
        if (!callerOrgs.has(lc(ally))) alliedOrgs.add(lc(ally))
      }
    }
  }

  // 3) For each allied org, harvest its members into ring 3.
  for (const allyLc of alliedOrgs) {
    const ally = allyLc as `0x${string}`
    const allyEdgeIds = [
      ...(await getEdgesBySubject(ally)),
      ...(await getEdgesByObject(ally)),
    ]
    for (const id of allyEdgeIds) {
      const e = await getEdge(id)
      if (!isActive(e.status)) continue
      if (!ORG_AFFILIATION.has(e.relationshipType)) continue
      const member: `0x${string}` = lc(e.subject) === allyLc ? e.object_ : e.subject
      const memberLc = lc(member)
      if (memberLc === lc(caller)) continue
      if (ring1.has(memberLc) || ring2.has(memberLc)) continue
      if (callerOrgs.has(memberLc) || alliedOrgs.has(memberLc)) continue
      ring3.set(memberLc, 'Sister-network member')
    }
  }

  return { caller, ring1, ring2, ring3, callerOrgs }
}

/**
 * Classify a single candidate against a pre-built map. Cheap O(1).
 * Defaults to degree 4 (open registry) when no path is found.
 */
export function classifyDistance(
  map: DistanceMap,
  candidate: `0x${string}`,
): Classification {
  const k = lc(candidate)
  const r1 = map.ring1.get(k); if (r1) return { degree: 1, reason: r1 }
  const r2 = map.ring2.get(k); if (r2) return { degree: 2, reason: r2 }
  const r3 = map.ring3.get(k); if (r3) return { degree: 3, reason: r3 }
  return { degree: 4, reason: 'Open registry' }
}

/** Convenience for surfaces that show one badge per result. */
export function distanceBadge(c: Classification): { label: string; tone: 'near' | 'mid' | 'far' | 'open' } {
  switch (c.degree) {
    case 1: return { label: '1st · ' + c.reason, tone: 'near' }
    case 2: return { label: '2nd · ' + c.reason, tone: 'mid' }
    case 3: return { label: '3rd · ' + c.reason, tone: 'far' }
    case 4: return { label: '4th · ' + c.reason, tone: 'open' }
  }
}
