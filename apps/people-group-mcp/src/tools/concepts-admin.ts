/**
 * T0 curator-write tools — public registry maintenance.
 *
 * Curator-only (ADR-PG-2). Every call audits — registry edit history is a
 * security artifact even though the row itself is public.
 */

import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  classificationSchemes,
  peopleGroupConcepts,
  peopleGroupCollectives,
  externalRecords,
} from '../db/schema.js'
import { requireCurator, AuthError } from '../auth/principal-context.js'
import { conceptIri, collectiveIri } from '../util/iri.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

export const conceptAdminTools = {
  register_classification_scheme: {
    name: 'register_classification_scheme',
    description: 'Curator: register a new people-group classification scheme (e.g. Joshua Project 2026).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        atlIri: { type: 'string' },
        label: { type: 'string' },
        description: { type: 'string' },
        sourceDatasetIri: { type: 'string' },
        version: { type: 'string' },
      },
      required: ['token', 'atlIri', 'label'],
    },
    handler: async (args: {
      token: string; atlIri: string; label: string
      description?: string; sourceDatasetIri?: string; version?: string
    }) => {
      try {
        await requireCurator({
          token: args.token, toolName: 'register_classification_scheme', argsForAudit: args,
        })
      } catch (err) {
        if (err instanceof AuthError) return mcpText({ error: err.message })
        throw err
      }

      const existing = db.select().from(classificationSchemes)
        .where(eq(classificationSchemes.atlIri, args.atlIri)).get()
      if (existing) return mcpText({ scheme: existing, alreadyRegistered: true })

      const row = {
        id: randomUUID(),
        atlIri: args.atlIri,
        label: args.label,
        description: args.description ?? null,
        sourceDatasetIri: args.sourceDatasetIri ?? null,
        version: args.version ?? null,
        createdAt: new Date().toISOString(),
      }
      db.insert(classificationSchemes).values(row).run()
      return mcpText({ scheme: row })
    },
  },

  register_pg_concept: {
    name: 'register_pg_concept',
    description: 'Curator: register a new people-group concept. Required: prefLabel. Optional: joshuaProjectId, scheme, language/religion/affinity/cluster IRIs, parent.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        prefLabel: { type: 'string' },
        joshuaProjectId: { type: 'string' },
        slug: { type: 'string', description: 'Used in atl_iri when no joshuaProjectId' },
        schemeId: { type: 'string' },
        altLabels: { type: 'array', items: { type: 'string' } },
        primaryLanguageIri: { type: 'string' },
        religiousAffinityIri: { type: 'string' },
        affinityGroupIri: { type: 'string' },
        peopleClusterIri: { type: 'string' },
        parentConceptId: { type: 'string' },
      },
      required: ['token', 'prefLabel'],
    },
    handler: async (args: {
      token: string; prefLabel: string
      joshuaProjectId?: string; slug?: string
      schemeId?: string
      altLabels?: string[]
      primaryLanguageIri?: string; religiousAffinityIri?: string
      affinityGroupIri?: string; peopleClusterIri?: string
      parentConceptId?: string
    }) => {
      try {
        await requireCurator({
          token: args.token, toolName: 'register_pg_concept', argsForAudit: args,
        })
      } catch (err) {
        if (err instanceof AuthError) return mcpText({ error: err.message })
        throw err
      }

      const slug = args.slug ?? args.prefLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      const atlIri = conceptIri({ joshuaProjectId: args.joshuaProjectId, slug })
      const existing = db.select().from(peopleGroupConcepts)
        .where(eq(peopleGroupConcepts.atlIri, atlIri)).get()
      if (existing) return mcpText({ concept: existing, alreadyRegistered: true })

      const now = new Date().toISOString()
      const row = {
        id: randomUUID(),
        atlIri,
        schemeId: args.schemeId ?? null,
        joshuaProjectId: args.joshuaProjectId ?? null,
        prefLabel: args.prefLabel,
        altLabelsJson: args.altLabels ? JSON.stringify(args.altLabels) : null,
        primaryLanguageIri: args.primaryLanguageIri ?? null,
        religiousAffinityIri: args.religiousAffinityIri ?? null,
        affinityGroupIri: args.affinityGroupIri ?? null,
        peopleClusterIri: args.peopleClusterIri ?? null,
        parentConceptId: args.parentConceptId ?? null,
        createdAt: now,
        updatedAt: now,
      }
      db.insert(peopleGroupConcepts).values(row).run()
      return mcpText({ concept: row })
    },
  },

  register_pg_collective: {
    name: 'register_pg_collective',
    description: 'Curator: register a worldwide PeopleGroupCollective for a concept (e.g. "Wolof people worldwide, 2026").',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        conceptId: { type: 'string' },
        temporalScope: { type: 'string', description: 'e.g. "2026"' },
        label: { type: 'string' },
      },
      required: ['token', 'conceptId', 'temporalScope'],
    },
    handler: async (args: {
      token: string; conceptId: string; temporalScope: string; label?: string
    }) => {
      try {
        await requireCurator({
          token: args.token, toolName: 'register_pg_collective', argsForAudit: args,
        })
      } catch (err) {
        if (err instanceof AuthError) return mcpText({ error: err.message })
        throw err
      }

      const atlIri = collectiveIri(args.conceptId, args.temporalScope)
      const existing = db.select().from(peopleGroupCollectives)
        .where(eq(peopleGroupCollectives.atlIri, atlIri)).get()
      if (existing) return mcpText({ collective: existing, alreadyRegistered: true })

      const row = {
        id: randomUUID(),
        atlIri,
        conceptId: args.conceptId,
        temporalScope: args.temporalScope,
        label: args.label ?? null,
        createdAt: new Date().toISOString(),
      }
      db.insert(peopleGroupCollectives).values(row).run()
      return mcpText({ collective: row })
    },
  },

  register_external_record: {
    name: 'register_external_record',
    description: 'Curator: register an external provenance pointer (Dataset, Report, InterviewSet, MapLayer) used as wasDerivedFrom target.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        iri: { type: 'string' },
        label: { type: 'string' },
        kind: { type: 'string', description: 'Dataset | Report | InterviewSet | MapLayer' },
        notes: { type: 'string' },
      },
      required: ['token', 'iri', 'label', 'kind'],
    },
    handler: async (args: {
      token: string; iri: string; label: string; kind: string; notes?: string
    }) => {
      try {
        await requireCurator({
          token: args.token, toolName: 'register_external_record', argsForAudit: args,
        })
      } catch (err) {
        if (err instanceof AuthError) return mcpText({ error: err.message })
        throw err
      }

      const validKinds = ['Dataset', 'Report', 'InterviewSet', 'MapLayer']
      if (!validKinds.includes(args.kind)) {
        return mcpText({ error: `kind must be one of ${validKinds.join('|')}` })
      }

      const existing = db.select().from(externalRecords)
        .where(eq(externalRecords.iri, args.iri)).get()
      if (existing) return mcpText({ record: existing, alreadyRegistered: true })

      const row = {
        iri: args.iri,
        label: args.label,
        kind: args.kind,
        notes: args.notes ?? null,
      }
      db.insert(externalRecords).values(row).run()
      return mcpText({ record: row })
    },
  },
}
