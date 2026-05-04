/**
 * Application-layer conditional checks mirroring the SHACL shapes in
 * `docs/ontology/cbox/people-group-shapes.shacl.ttl`.
 *
 * The MCP does NOT run a SHACL engine in the write path (per Ontologist
 * Revision 6 + Security §8). Instead, `upsert_segment` runs these checks
 * before writing and returns a structured 400 with the failing predicate
 * list. An offline SHACL validator runs against the GraphDB mirror
 * post-sync and is curator-only output (ADR-PG-7).
 */

const SAPG = 'https://smartagent.io/ontology/people-groups#'

export interface SegmentInput {
  scopeTypeIri: string
  conceptId?: string | null
  spatialFeatureId?: string | null
  primaryLanguageIri?: string | null
  religiousIdentityIri?: string | null
  casteClanTribeIdentityIri?: string | null
  withinChurchPrincipal?: string | null
  withinNetworkPrincipal?: string | null
  withinDenominationIri?: string | null
  withinEngagementId?: string | null
  isDiaspora?: boolean
  homelandFeatureId?: string | null
  hostFeatureId?: string | null
  visibility?: 'public' | 'sponsor-private' | null
  hasGeometry?: boolean
}

export interface ValidationFailure {
  predicate: string
  reason: string
}

const REQUIREMENTS: Record<string, ReadonlyArray<{ predicate: keyof SegmentInput; humanName: string }>> = {
  [`${SAPG}PeopleGroupInCountry`]:        [{ predicate: 'spatialFeatureId', humanName: 'sapg:locatedIn' }],
  [`${SAPG}PeopleGroupInRegion`]:         [{ predicate: 'spatialFeatureId', humanName: 'sapg:locatedIn' }],
  [`${SAPG}PeopleGroupInAdminArea`]:      [{ predicate: 'spatialFeatureId', humanName: 'sapg:locatedIn' }],
  [`${SAPG}PeopleGroupInCity`]:           [{ predicate: 'spatialFeatureId', humanName: 'sapg:locatedIn' }],
  [`${SAPG}PeopleGroupInPlace`]:          [{ predicate: 'spatialFeatureId', humanName: 'sapg:locatedIn' }],
  [`${SAPG}PeopleGroupInLanguage`]:       [{ predicate: 'primaryLanguageIri', humanName: 'sapg:primaryLanguage' }],
  [`${SAPG}PeopleGroupInReligion`]:       [{ predicate: 'religiousIdentityIri', humanName: 'sapg:religiousIdentity' }],
  [`${SAPG}PeopleGroupInCasteClanTribe`]: [{ predicate: 'casteClanTribeIdentityIri', humanName: 'sapg:casteClanTribeIdentity' }],
  [`${SAPG}PeopleGroupInChurch`]:         [{ predicate: 'withinChurchPrincipal', humanName: 'sapg:withinChurch' }],
  [`${SAPG}PeopleGroupInNetwork`]:        [{ predicate: 'withinNetworkPrincipal', humanName: 'sapg:withinNetwork' }],
  [`${SAPG}PeopleGroupInDenomination`]:   [{ predicate: 'withinDenominationIri', humanName: 'sapg:withinDenomination' }],
  [`${SAPG}PeopleGroupInMinistryEngagement`]: [{ predicate: 'withinEngagementId', humanName: 'sapg:withinMinistryEngagement' }],
}

export function validateSegment(seg: SegmentInput): ValidationFailure[] {
  const failures: ValidationFailure[] = []

  // visibility must be set explicitly.
  if (seg.visibility !== 'public' && seg.visibility !== 'sponsor-private') {
    failures.push({ predicate: 'visibility', reason: "Must be 'public' or 'sponsor-private' (no default)" })
  }

  // scopeType must be set.
  if (!seg.scopeTypeIri) {
    failures.push({ predicate: 'hasScopeType', reason: 'Required' })
    return failures
  }

  // concept must be set.
  if (!seg.conceptId) {
    failures.push({ predicate: 'ofPeopleGroup', reason: 'Required' })
  }

  // Per-scope-type required-predicate matrix.
  const required = REQUIREMENTS[seg.scopeTypeIri]
  if (required) {
    for (const req of required) {
      const v = seg[req.predicate]
      if (v === undefined || v === null || v === '') {
        failures.push({ predicate: req.humanName, reason: `Required when hasScopeType=${seg.scopeTypeIri}` })
      }
    }
  }

  // Diaspora conditional.
  if (seg.scopeTypeIri === `${SAPG}PeopleGroupInDiaspora` || seg.isDiaspora) {
    if (!seg.isDiaspora) failures.push({ predicate: 'isDiasporaPopulation', reason: 'Must be true for diaspora segment' })
    if (!seg.homelandFeatureId) failures.push({ predicate: 'homelandPlace', reason: 'Required for diaspora segment' })
    if (!seg.hostFeatureId) failures.push({ predicate: 'hostPlace', reason: 'Required for diaspora segment' })
  }

  // Polygon scope requires geometry.
  if (seg.scopeTypeIri === `${SAPG}PeopleGroupInPolygon` && !seg.hasGeometry) {
    failures.push({ predicate: 'hasGeometry', reason: 'Required for InPolygon scope' })
  }

  return failures
}

/**
 * SEC-1 / ADR-PG-3: T1 displayName safety check.
 * Returns null if OK, or a string explaining the violation.
 */
export function validateT1DisplayName(args: {
  displayName: string | null | undefined
  visibility: 'public' | 'sponsor-private'
  denyList: string[]
  maxLength: number
  knownCommunityIris?: string[]
}): string | null {
  if (args.visibility !== 'public') return null     // T2 names never leak to chain
  if (args.displayName == null || args.displayName === '') return null  // optional
  const lower = args.displayName.toLowerCase()
  if (args.displayName.length > args.maxLength) {
    return `displayName exceeds ${args.maxLength} chars; trim before publishing`
  }
  for (const term of args.denyList) {
    if (lower.includes(term)) {
      return `displayName contains forbidden substring '${term}' — public segments cannot mint security-context language to chain`
    }
  }
  if (args.knownCommunityIris) {
    for (const ci of args.knownCommunityIris) {
      if (args.displayName.includes(ci)) {
        return `displayName must not contain a community IRI; communities are sponsor-private`
      }
    }
  }
  return null
}
