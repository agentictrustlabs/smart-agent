/**
 * Pre-seed the demo catalog (schemes, external records, Wolof concept,
 * worldwide collective) at MCP boot. INSERT-IGNORE pattern, idempotent.
 *
 * Why boot-seed instead of curator tool: in v1 the curator allowlist is
 * hard-coded in `config.ts` and the demo doesn't have a clean way to
 * bootstrap a curator session against an empty allowlist. Treating the
 * Wolof demo concept as part of the controlled vocabulary side-steps the
 * issue. Real curator-driven additions still flow through the admin tools.
 */

import { randomUUID } from 'node:crypto'
import { sqlite } from '../db/index.js'

const SAPG = 'https://smartagent.io/ontology/people-groups#'

interface SeedCounts {
  schemes: number
  records: number
  concepts: number
  collectives: number
}

export function seedWolofCatalog(): SeedCounts {
  const counts: SeedCounts = { schemes: 0, records: 0, concepts: 0, collectives: 0 }
  const now = new Date().toISOString()

  const schemeStmt = sqlite.prepare(`
    INSERT INTO classification_schemes (id, atl_iri, label, description, source_dataset_iri, version, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(atl_iri) DO NOTHING
  `)
  const recStmt = sqlite.prepare(`
    INSERT INTO external_records (iri, label, kind, notes)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(iri) DO NOTHING
  `)
  const conceptStmt = sqlite.prepare(`
    INSERT INTO people_group_concepts (
      id, atl_iri, scheme_id, joshua_project_id, pref_label, alt_labels_json,
      primary_language_iri, religious_affinity_iri, affinity_group_iri, people_cluster_iri,
      parent_concept_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(atl_iri) DO NOTHING
  `)
  const collStmt = sqlite.prepare(`
    INSERT INTO people_group_collectives (id, atl_iri, concept_id, temporal_scope, label, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(atl_iri) DO NOTHING
  `)

  const tx = sqlite.transaction(() => {
    // Schemes
    const schemes = [
      { id: 'scheme-jp-2026',
        atlIri: `${SAPG}JoshuaProjectPeopleGroupScheme2026`,
        label: 'Joshua Project People Group Scheme, 2026 edition',
        description: 'Reference scheme from Joshua Project; used by IMB / WCD ecosystems.',
        sourceDataset: `${SAPG}JoshuaProjectDataset2026`, version: '2026' },
      { id: 'scheme-local-dakar-2026',
        atlIri: `${SAPG}LocalDakarFieldResearchScheme2026`,
        label: 'Local Dakar Field Research People Group Scheme, 2026',
        description: 'Local field-research scheme used by Senegal Wolof Outreach.',
        sourceDataset: `${SAPG}DakarFieldResearchReport2026`, version: '2026' },
    ]
    for (const s of schemes) {
      const r = schemeStmt.run(s.id, s.atlIri, s.label, s.description, s.sourceDataset, s.version, now)
      if (r.changes > 0) counts.schemes++
    }

    // External records
    const records = [
      { iri: `${SAPG}JoshuaProjectDataset2026`,             label: 'Joshua Project people-group dataset, 2026', kind: 'Dataset' },
      { iri: `${SAPG}DakarFieldResearchReport2026`,         label: 'Dakar field research report, 2026',          kind: 'Report' },
      { iri: `${SAPG}DakarFieldInterviewSet2026`,           label: 'Dakar Wolof field interview set, 2026',      kind: 'InterviewSet' },
      { iri: `${SAPG}JoshuaProjectMapLayer2026`,            label: 'Joshua Project Senegal map layer, 2026',     kind: 'MapLayer' },
      { iri: `${SAPG}JoshuaProjectReachednessCriteria2026`, label: 'Joshua Project reachedness criteria, 2026',  kind: 'Report' },
    ]
    for (const r of records) {
      const x = recStmt.run(r.iri, r.label, r.kind, null)
      if (x.changes > 0) counts.records++
    }

    // Wolof concept
    const wolofId = 'concept-wolof'
    const wolofIri = `did:sapg:concept:jp-wolof`
    const cr = conceptStmt.run(
      wolofId, wolofIri, 'scheme-jp-2026', 'jp-wolof', 'Wolof',
      JSON.stringify(['Ouolof']),
      `${SAPG}WolofLanguage`, `${SAPG}Islam`,
      `${SAPG}SubSaharanAfricanPeoples`, `${SAPG}SenegambianPeoplesCluster`,
      null, now, now,
    )
    if (cr.changes > 0) counts.concepts++

    // Worldwide collective
    const cid = randomUUID()
    const lr = collStmt.run(
      cid, `${SAPG}collective-${wolofId}-2026`, wolofId, '2026', 'Wolof people worldwide, 2026', now,
    )
    if (lr.changes > 0) counts.collectives++
  })
  tx()
  return counts
}
