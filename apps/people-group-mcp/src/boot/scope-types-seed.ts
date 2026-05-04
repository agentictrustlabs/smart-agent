/**
 * Seed the scope_types table at boot.
 *
 * The 18 scope types are a controlled vocabulary defined in
 * `docs/ontology/cbox/people-group-scopes.ttl`. They aren't curator-editable
 * — they're built into the ontology — so we INSERT-IGNORE them at boot
 * rather than expose a `register_scope_type` tool.
 *
 * Idempotent: re-runs are no-ops thanks to the UNIQUE atl_iri constraint.
 */

import { sqlite } from '../db/index.js'

const SAPG = 'https://smartagent.io/ontology/people-groups#'

interface ScopeRow {
  id: string
  atlIri: string
  label: string
  description: string
}

const SCOPE_TYPES: ScopeRow[] = [
  // Identity
  { id: 'scope-pgac',   atlIri: `${SAPG}PeopleGroupAcrossCountries`,    label: 'People group across countries',
    description: 'A people group counted once globally, regardless of country. PGAC.' },
  { id: 'scope-pgic',   atlIri: `${SAPG}PeopleGroupInCountry`,          label: 'People group in country',
    description: 'Classic country-situated people group view. PGIC.' },
  // Geographic
  { id: 'scope-region', atlIri: `${SAPG}PeopleGroupInRegion`,           label: 'People group in region',
    description: 'Supra-national, continental, strategic, or regional place.' },
  { id: 'scope-admin',  atlIri: `${SAPG}PeopleGroupInAdminArea`,        label: 'People group in admin area',
    description: 'Province, state, district, county, or other administrative subdivision.' },
  { id: 'scope-city',   atlIri: `${SAPG}PeopleGroupInCity`,             label: 'People group in city or metro area',
    description: 'City or metropolitan area. Most actionable level for diaspora and urban ministry.' },
  { id: 'scope-place',  atlIri: `${SAPG}PeopleGroupInPlace`,            label: 'People group in place',
    description: 'Generic place superclass: neighborhood, village, refugee camp, campus, marketplace, digital gathering.' },
  { id: 'scope-poly',   atlIri: `${SAPG}PeopleGroupInPolygon`,          label: 'People group in polygon',
    description: 'Geospatial-evidence scope. Polygon is an estimated representation of presence.' },
  { id: 'scope-diasp',  atlIri: `${SAPG}PeopleGroupInDiaspora`,         label: 'People group in diaspora',
    description: 'Living outside the homeland. Use with isDiasporaPopulation, homelandPlace, hostPlace.' },
  // Sociocultural
  { id: 'scope-lang',   atlIri: `${SAPG}PeopleGroupInLanguage`,         label: 'People group in language',
    description: 'Segment associated with primary language, dialect, or language variety.' },
  { id: 'scope-relig',  atlIri: `${SAPG}PeopleGroupInReligion`,         label: 'People group in religion',
    description: 'Segment by primary religious identity. Religion may function as a social boundary.' },
  { id: 'scope-caste',  atlIri: `${SAPG}PeopleGroupInCasteClanTribe`,   label: 'People group in caste / clan / tribe',
    description: 'Segment by caste, clan, tribe, lineage, or socially recognized boundary.' },
  { id: 'scope-affin',  atlIri: `${SAPG}PeopleGroupInAffinityGroup`,    label: 'People group in affinity group',
    description: 'Membership in a strategic-cultural family of peoples.' },
  { id: 'scope-clust',  atlIri: `${SAPG}PeopleGroupInCluster`,          label: 'People group in cluster',
    description: 'Membership in a smaller ethno-cultural cluster.' },
  // Ministry / ekklesia
  { id: 'scope-church', atlIri: `${SAPG}PeopleGroupInChurch`,           label: 'People group in church',
    description: 'Presence inside, served by, or reachable through a specific church.' },
  { id: 'scope-net',    atlIri: `${SAPG}PeopleGroupInNetwork`,          label: 'People group in network',
    description: 'Focus of a coalition, advocacy network, partnership, or resource network.' },
  { id: 'scope-denom',  atlIri: `${SAPG}PeopleGroupInDenomination`,     label: 'People group in denomination',
    description: 'Represented within a denomination, communion, association, or Christian tradition.' },
  { id: 'scope-eng',    atlIri: `${SAPG}PeopleGroupInMinistryEngagement`, label: 'People group in ministry engagement',
    description: 'Target, focus, or beneficiary of a ministry activity, project, commitment, or strategy.' },
  { id: 'scope-rea',    atlIri: `${SAPG}PeopleGroupReachednessAssessmentScope`, label: 'People group reachedness assessment scope',
    description: 'Reachedness-as-segment. Reachedness is modeled as an assessment, never as a permanent subclass.' },
]

export function seedScopeTypes(): { inserted: number; total: number } {
  const stmt = sqlite.prepare(`
    INSERT INTO scope_types (id, atl_iri, label, description)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(atl_iri) DO NOTHING
  `)
  let inserted = 0
  const tx = sqlite.transaction((rows: ScopeRow[]) => {
    for (const r of rows) {
      const res = stmt.run(r.id, r.atlIri, r.label, r.description)
      if (res.changes > 0) inserted++
    }
  })
  tx(SCOPE_TYPES)
  return { inserted, total: SCOPE_TYPES.length }
}
