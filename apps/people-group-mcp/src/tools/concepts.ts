/**
 * T0 read tools — public registry. No auth required.
 *
 * Anyone can read the people-group classification taxonomy: concepts,
 * schemes, scope types, worldwide collectives, external records. These
 * are reference data — the catalog of "what exists" — never PII.
 */

import { eq, and, like, or, isNotNull } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  classificationSchemes,
  peopleGroupConcepts,
  scopeTypes,
  peopleGroupCollectives,
  externalRecords,
} from '../db/schema.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

export const conceptReadTools = {
  list_pg_concepts: {
    name: 'list_pg_concepts',
    description: 'List people-group concepts in the public registry. Optional filter by scheme, label substring, or affinity group.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        schemeId: { type: 'string' },
        labelLike: { type: 'string', description: 'Case-insensitive substring of pref_label' },
        affinityGroupIri: { type: 'string' },
        peopleClusterIri: { type: 'string' },
      },
    },
    handler: async (args: {
      schemeId?: string
      labelLike?: string
      affinityGroupIri?: string
      peopleClusterIri?: string
    }) => {
      let rows = db.select().from(peopleGroupConcepts).all()
      if (args.schemeId) rows = rows.filter(r => r.schemeId === args.schemeId)
      if (args.affinityGroupIri) rows = rows.filter(r => r.affinityGroupIri === args.affinityGroupIri)
      if (args.peopleClusterIri) rows = rows.filter(r => r.peopleClusterIri === args.peopleClusterIri)
      if (args.labelLike) {
        const needle = args.labelLike.toLowerCase()
        rows = rows.filter(r => r.prefLabel.toLowerCase().includes(needle))
      }
      return mcpText({ concepts: rows })
    },
  },

  get_pg_concept: {
    name: 'get_pg_concept',
    description: 'Get a single people-group concept by id or atl_iri.',
    inputSchema: {
      type: 'object' as const,
      properties: { id: { type: 'string' }, atlIri: { type: 'string' } },
    },
    handler: async (args: { id?: string; atlIri?: string }) => {
      let where
      if (args.id) where = eq(peopleGroupConcepts.id, args.id)
      else if (args.atlIri) where = eq(peopleGroupConcepts.atlIri, args.atlIri)
      else return mcpText({ error: 'Must provide id or atlIri' })
      const row = db.select().from(peopleGroupConcepts).where(where).get()
      return mcpText({ concept: row ?? null })
    },
  },

  list_classification_schemes: {
    name: 'list_classification_schemes',
    description: 'List all people-group classification schemes (Joshua Project, IMB, WCD, ...).',
    inputSchema: { type: 'object' as const, properties: {} },
    handler: async () => {
      const rows = db.select().from(classificationSchemes).all()
      return mcpText({ schemes: rows })
    },
  },

  list_scope_types: {
    name: 'list_scope_types',
    description: 'List the 18 controlled-vocabulary scope types (PGAC, PGIC, InCity, InChurch, ...).',
    inputSchema: { type: 'object' as const, properties: {} },
    handler: async () => {
      const rows = db.select().from(scopeTypes).all()
      return mcpText({ scopeTypes: rows })
    },
  },

  list_pg_collectives: {
    name: 'list_pg_collectives',
    description: 'List worldwide PeopleGroupCollective rows. Optional filter by concept_id.',
    inputSchema: {
      type: 'object' as const,
      properties: { conceptId: { type: 'string' } },
    },
    handler: async (args: { conceptId?: string }) => {
      let rows = db.select().from(peopleGroupCollectives).all()
      if (args.conceptId) rows = rows.filter(r => r.conceptId === args.conceptId)
      return mcpText({ collectives: rows })
    },
  },

  list_external_records: {
    name: 'list_external_records',
    description: 'List external provenance records (datasets, reports, interview-sets, map-layers) used as wasDerivedFrom targets.',
    inputSchema: {
      type: 'object' as const,
      properties: { kind: { type: 'string', description: 'Filter by Dataset | Report | InterviewSet | MapLayer' } },
    },
    handler: async (args: { kind?: string }) => {
      let rows = db.select().from(externalRecords).all()
      if (args.kind) rows = rows.filter(r => r.kind === args.kind)
      return mcpText({ records: rows })
    },
  },
}

// Suppress unused-import warnings; these helpers stay available for future filters.
void and; void like; void or; void isNotNull
