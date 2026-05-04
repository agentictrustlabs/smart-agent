/**
 * Data-scope field registry — v1 published list.
 *
 * Per SEC-18 / ADR-PG-4 forward-compat: when a `DataScopeGrant.fields` array
 * contains the wildcard `'*'`, the verifier resolves it against this registry
 * to get the v1-published field list for the requested `(server, resource)`
 * pair. Phase-2 will support explicit subsets (e.g. `populationCount` without
 * `householdContact`) as the registry grows.
 *
 * Adding a field here is a public-API change — bump the registry version and
 * record in `02-data-ownership-map.md` when shipped.
 */

export const DATA_SCOPE_FIELDS_V1 = {
  'urn:mcp:server:person': {
    profile: [
      'displayName', 'email', 'phone', 'language',
      'city', 'stateProvince', 'country',
      'bio', 'avatarUrl', 'dateOfBirth', 'gender',
      'addressLine1', 'addressLine2', 'postalCode', 'location',
    ],
  },
  'urn:mcp:server:org': {
    revenue: ['*'],
    proposals: ['*'],
    intents: ['*'],
    members: ['*'],
    engagements: ['*'],
    entitlements: ['*'],
  },
  'urn:mcp:server:people-groups': {
    segments: [
      'displayName', 'scopeType', 'spatialFeatureId',
      'parentSegment', 'visibility', 'temporalScope',
      'isDiaspora', 'homelandFeature', 'hostFeature',
      'religiousIdentity', 'primaryLanguage', 'casteClanTribeIdentity',
      'withinChurch', 'withinNetwork', 'withinDenomination',
    ],
    estimates: [
      'populationCount', 'percentChristian', 'percentEvangelical',
      'primaryLanguage', 'householdCount', 'leadersIdentified',
      'estimateMethod', 'confidenceScore',
      'sourceRecord', 'generatedByActivity', 'recordedAt',
    ],
    reachedness: [
      'reachednessStatus', 'engagementStatus',
      'percentEvangelical', 'criteria', 'confidenceScore',
      'sourceRecord', 'generatedByActivity', 'recordedAt',
    ],
    // SEC-5: split — 'communities' grants display_name + cohesion_basis only.
    communities: ['displayName', 'cohesionBasis', 'isAgentive'],
    // SEC-5: 'community-locations' grants location_hint separately. Default
    // delegation should NOT include this resource — geographic detail is opt-in.
    'community-locations': ['locationHint'],
    geometries: ['wktGeometry', 'geometryMethod', 'confidenceScore'],
    classifications: [
      'scheme', 'concept', 'classifiedEntity', 'method',
      'confidenceScore', 'validDuring', 'sourceRecord',
    ],
  },
} as const

export type AudienceKey = keyof typeof DATA_SCOPE_FIELDS_V1

/**
 * Resolve a fields array against the v1 registry.
 * - `['*']` → all v1-published fields for `(server, resource)`
 * - explicit list → returned as-is (caller validates membership)
 * - unknown server/resource → empty array (delegation grants nothing)
 */
export function resolveDataScopeFields(
  server: string,
  resource: string,
  fields: string[],
): string[] {
  if (!fields.includes('*')) return [...fields]
  const audienceTable = (DATA_SCOPE_FIELDS_V1 as Record<string, Record<string, readonly string[]>>)[server]
  if (!audienceTable) return []
  const resourceFields = audienceTable[resource]
  if (!resourceFields) return []
  // Drill through nested '*' (org-mcp resources use ['*'] meaning "all fields, opaque").
  if (resourceFields.length === 1 && resourceFields[0] === '*') return ['*']
  return [...resourceFields]
}
