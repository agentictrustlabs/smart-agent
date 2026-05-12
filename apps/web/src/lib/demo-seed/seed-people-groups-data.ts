/**
 * Demo seed for people-group-mcp.
 *
 * Two phases:
 *   1. T0 catalog (curator session): schemes, external records, concept,
 *      collective. This requires the deployer's smart account to be in
 *      PEOPLE_GROUP_CURATOR_ALLOWLIST.
 *   2. Sponsor data (Sione's session via cross-delegation): segments,
 *      community, estimates (multi-source), reachedness, geometry.
 *
 * Idempotent: every tool checks for existence before insert.
 */

import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { bootstrapA2ASessionForUser } from '@/lib/actions/a2a-session.action'
import { getOrgCrossDelegation } from './seed-org-delegations'

const A2A_AGENT_URL = process.env.A2A_AGENT_URL ?? 'http://localhost:3100'
const PG_AUDIENCE = 'urn:mcp:server:people-groups'

const SAPG = 'https://smartagent.io/ontology/people-groups#'

interface SignedDelegation {
  delegator: `0x${string}`
  delegate: `0x${string}`
  authority: `0x${string}`
  caveats: Array<{ enforcer: `0x${string}`; terms: `0x${string}` }>
  salt: string
  signature: `0x${string}`
}

async function callPgMcp<T = Record<string, unknown>>(
  sessionId: string,
  tool: string,
  args: Record<string, unknown>,
  crossDelegation?: SignedDelegation,
): Promise<T | { error: string }> {
  const body: Record<string, unknown> = { ...args }
  if (crossDelegation) body.crossDelegation = crossDelegation
  const res = await fetch(`${A2A_AGENT_URL}/mcp/people-group/${tool}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${sessionId}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    return { error: err.error ?? `MCP people-group.${tool} ${res.status}` }
  }
  return res.json() as Promise<T>
}

// ─── Sione session bootstrap with people-groups cross-delegation ──────

async function sponsorSession(orgAddress: string, ownerUserId: string): Promise<{
  sessionId: string
  crossDelegation: SignedDelegation
} | null> {
  const u = db.select().from(schema.localUserAccounts).where(eq(schema.localUserAccounts.id, ownerUserId)).get()
  if (!u?.smartAccountAddress || !u?.privateKey) return null

  const r = await bootstrapA2ASessionForUser({
    smartAccountAddress: u.smartAccountAddress,
    privateKey: u.privateKey,
  })
  if (!r.success || !r.sessionId) return null

  const cross = await getOrgCrossDelegation(orgAddress, ownerUserId, PG_AUDIENCE)
  if (!cross) return null

  return { sessionId: r.sessionId, crossDelegation: cross.delegation as SignedDelegation }
}

// ─── Sponsor T1+T2 seed (Sione) ───────────────────────────────────────

interface SegmentSpec {
  slug: string
  conceptId: string
  scopeTypeIri: string
  spatialFeatureId?: string
  parentSegmentSlug?: string
  displayName: string
  visibility: 'public' | 'sponsor-private'
  isDiaspora?: boolean
  homelandFeatureId?: string
  hostFeatureId?: string
  primaryLanguageIri?: string
  religiousIdentityIri?: string
  temporalScope?: string
}

async function seedSponsorData(args: {
  sessionId: string
  crossDelegation: SignedDelegation
  conceptId: string
}): Promise<Record<string, number>> {
  const counts: Record<string, number> = { segments: 0, communities: 0, estimates: 0, reachedness: 0, geometries: 0 }

  // Segments.
  const segSpecs: SegmentSpec[] = [
    {
      slug: 'wolof-in-senegal-2026',
      conceptId: args.conceptId,
      scopeTypeIri: `${SAPG}PeopleGroupInCountry`,
      spatialFeatureId: `${SAPG}Senegal`,
      displayName: 'Wolof in Senegal, 2026',
      visibility: 'public',
      temporalScope: '2026',
    },
    {
      slug: 'wolof-in-dakar-metro-2026',
      conceptId: args.conceptId,
      scopeTypeIri: `${SAPG}PeopleGroupInCity`,
      spatialFeatureId: `${SAPG}DakarMetro`,
      parentSegmentSlug: 'wolof-in-senegal-2026',
      displayName: 'Wolof in Dakar metro, 2026',
      visibility: 'public',
      temporalScope: '2026',
    },
    {
      slug: 'wolof-in-plateau',
      conceptId: args.conceptId,
      scopeTypeIri: `${SAPG}PeopleGroupInPlace`,
      spatialFeatureId: `${SAPG}PlateauNeighborhood`,
      parentSegmentSlug: 'wolof-in-dakar-metro-2026',
      displayName: 'Wolof in Plateau',
      visibility: 'sponsor-private',
    },
    {
      slug: 'wolof-in-medina',
      conceptId: args.conceptId,
      scopeTypeIri: `${SAPG}PeopleGroupInPlace`,
      spatialFeatureId: `${SAPG}MedinaNeighborhood`,
      parentSegmentSlug: 'wolof-in-dakar-metro-2026',
      displayName: 'Wolof in Médina',
      visibility: 'sponsor-private',
    },
    {
      slug: 'wolof-in-pikine',
      conceptId: args.conceptId,
      scopeTypeIri: `${SAPG}PeopleGroupInPlace`,
      spatialFeatureId: `${SAPG}PikineNeighborhood`,
      parentSegmentSlug: 'wolof-in-dakar-metro-2026',
      displayName: 'Wolof in Pikine',
      visibility: 'sponsor-private',
    },
  ]

  const segIdsBySlug = new Map<string, string>()

  for (const s of segSpecs) {
    const parentSegmentId = s.parentSegmentSlug ? segIdsBySlug.get(s.parentSegmentSlug) : undefined
    const r = await callPgMcp<{ segment?: { id: string; atlIri: string }; updated?: boolean; error?: string }>(
      args.sessionId, 'upsert_segment',
      {
        segmentSlug: s.slug,
        conceptId: s.conceptId,
        scopeTypeIri: s.scopeTypeIri,
        spatialFeatureId: s.spatialFeatureId,
        parentSegmentId,
        displayName: s.displayName,
        visibility: s.visibility,
        temporalScope: s.temporalScope,
        isDiaspora: s.isDiaspora ?? false,
        homelandFeatureId: s.homelandFeatureId,
        hostFeatureId: s.hostFeatureId,
        primaryLanguageIri: s.primaryLanguageIri,
        religiousIdentityIri: s.religiousIdentityIri,
        deferGeoVerification: true, // geo-mcp may not have these features registered yet
      },
      args.crossDelegation,
    )
    if (!('error' in r) && r.segment) {
      segIdsBySlug.set(s.slug, r.segment.id)
      counts.segments++
    }
  }

  const countrySegId = segIdsBySlug.get('wolof-in-senegal-2026')
  const citySegId = segIdsBySlug.get('wolof-in-dakar-metro-2026')

  // Community (Tier-2-Sensitive — encrypted server-side).
  if (citySegId) {
    const c = await callPgMcp(args.sessionId, 'upsert_community', {
      communitySlug: 'wolof-community-dakar-2026',
      conceptId: args.conceptId,
      segmentId: citySegId,
      displayName: 'Wolof Community Dakar 2026',
      cohesionBasis: 'Shared Wolof language use, kinship networks, neighborhood associations, and locally recognized Wolof identity.',
      locationHint: 'Greater Dakar metropolitan area, with concentrations in Plateau, Médina, and Pikine.',
      isAgentive: false,
    }, args.crossDelegation)
    if (!('error' in c)) counts.communities++
  }

  // Estimates — multi-source disagreement on the country segment.
  if (countrySegId) {
    const e1 = await callPgMcp(args.sessionId, 'add_estimate', {
      segmentId: countrySegId,
      populationCount: 6_800_000,
      percentChristian: 0.0060,
      percentEvangelical: 0.0010,
      confidenceScore: 0.76,
      estimateMethod: 'Source-derived country-level estimate.',
      sourceRecordIri: `${SAPG}JoshuaProjectDataset2026`,
      generatedByActivityIri: `${SAPG}WolofSenegalEstimationActivityJP2026`,
    }, args.crossDelegation)
    if (!('error' in e1)) counts.estimates++

    const e2 = await callPgMcp(args.sessionId, 'add_estimate', {
      segmentId: countrySegId,
      populationCount: 6_550_000,
      percentChristian: 0.0080,
      percentEvangelical: 0.0014,
      confidenceScore: 0.63,
      estimateMethod: 'Local field review reconciliation.',
      sourceRecordIri: `${SAPG}DakarFieldResearchReport2026`,
      generatedByActivityIri: `${SAPG}WolofSenegalEstimationActivityLocal2026`,
    }, args.crossDelegation)
    if (!('error' in e2)) counts.estimates++
  }

  // City + place segments — single estimate each.
  for (const slug of ['wolof-in-dakar-metro-2026', 'wolof-in-plateau', 'wolof-in-medina', 'wolof-in-pikine']) {
    const id = segIdsBySlug.get(slug)
    if (!id) continue
    const sample = slug === 'wolof-in-dakar-metro-2026' ? 3_300_000 : 250_000
    const r = await callPgMcp(args.sessionId, 'add_estimate', {
      segmentId: id,
      populationCount: sample,
      percentEvangelical: 0.0009,
      confidenceScore: 0.65,
      estimateMethod: 'Derived from Dakar metro share of country estimate.',
      sourceRecordIri: `${SAPG}DakarFieldResearchReport2026`,
    }, args.crossDelegation)
    if (!('error' in r)) counts.estimates++
  }

  // Reachedness on the country segment.
  if (countrySegId) {
    const r = await callPgMcp(args.sessionId, 'add_reachedness_assessment', {
      segmentId: countrySegId,
      reachednessStatusIri: `${SAPG}StatusUnreached`,
      engagementStatusIri: `${SAPG}StatusEngaged`,
      percentEvangelical: 0.0010,
      criteriaIri: `${SAPG}JoshuaProjectReachednessCriteria2026`,
      confidenceScore: 0.72,
      sourceRecordIri: `${SAPG}JoshuaProjectDataset2026`,
    }, args.crossDelegation)
    if (!('error' in r)) counts.reachedness++
  }

  // Geometry on the city segment.
  if (citySegId) {
    const r = await callPgMcp(args.sessionId, 'add_geometry', {
      segmentId: citySegId,
      // Placeholder rectangle around Dakar metro — replace with real WKT in Phase 2.
      wktGeometry: 'POLYGON((-17.55 14.65, -17.30 14.65, -17.30 14.85, -17.55 14.85, -17.55 14.65))',
      geometryMethod: 'MappingActivity2026 — placeholder bounding box.',
      confidenceScore: 0.50,
      sourceRecordIri: `${SAPG}JoshuaProjectMapLayer2026`,
      generatedByActivityIri: `${SAPG}WolofSenegalMappingActivity2026`,
      visibility: 'sponsor-private',
    }, args.crossDelegation)
    if (!('error' in r)) counts.geometries++
  }

  return counts
}

// ─── Public entry ─────────────────────────────────────────────────────

export async function seedPeopleGroupsDemoData(args: {
  /** Senegal Wolof Outreach smart-account address from catalyst on-chain seed. */
  orgAddress: string
}): Promise<void> {
  console.log('[seed-pg] starting people-group MCP seed...')

  // Bootstrap Sione's session against his own smart account, with the PG
  // cross-delegation in hand. T0 catalog (Wolof concept, schemes, external
  // records) is pre-seeded at MCP boot — see apps/people-group-mcp/src/boot/.
  const session = await sponsorSession(args.orgAddress, 'cat-user-014')
  if (!session) {
    console.warn('[seed-pg] could not bootstrap Sione session + cross-delegation; skipping sponsor seed')
    return
  }

  // Resolve the Wolof concept id from the pre-seeded catalog.
  const conceptsRes = await fetch(`${A2A_AGENT_URL}/mcp/people-group/list_pg_concepts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.sessionId}` },
    body: JSON.stringify({}),
  })
  const conceptsData = await conceptsRes.json() as { concepts?: Array<{ id: string; prefLabel: string }> }
  const wolof = conceptsData.concepts?.find(c => c.prefLabel === 'Wolof')
  if (!wolof) {
    console.warn('[seed-pg] Wolof concept not in registry; sponsor seed skipped')
    return
  }

  const sponsorCounts = await seedSponsorData({
    sessionId: session.sessionId,
    crossDelegation: session.crossDelegation,
    conceptId: wolof.id,
  })
  console.log('[seed-pg] sponsor data:', sponsorCounts)
  console.log('[seed-pg] done')
}
