/**
 * Source-governed PeopleGroupClassification records.
 *
 * Tier is auto-derived from the classified entity:
 *   - public concept / collective / public segment → T0 (no principal)
 *   - sponsor-private community / private segment → T2 (caller's principal)
 *
 * The CHECK constraint on pg_classifications enforces the tier↔principal pairing.
 */

import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  pgClassifications, peopleGroupConcepts, populationSegments, pgCommunities,
} from '../db/schema.js'
import { requirePrincipalAny, AuthError } from '../auth/principal-context.js'
import { classificationIri } from '../util/iri.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

interface ClassifiedEntity {
  tier: 'T0' | 'T2'
  principal: string | null
}

function lookupClassifiedEntity(iri: string): ClassifiedEntity | null {
  // Public registry hits.
  const concept = db.select().from(peopleGroupConcepts)
    .where(eq(peopleGroupConcepts.atlIri, iri)).get()
  if (concept) return { tier: 'T0', principal: null }

  // Public segment (visibility='public') vs private.
  const seg = db.select().from(populationSegments)
    .where(eq(populationSegments.atlIri, iri)).get()
  if (seg) {
    return seg.visibility === 'public'
      ? { tier: 'T0', principal: null }
      : { tier: 'T2', principal: seg.principal }
  }

  // Communities are always T2.
  const community = db.select().from(pgCommunities)
    .where(eq(pgCommunities.atlIri, iri)).get()
  if (community) return { tier: 'T2', principal: community.principal }

  return null
}

export const classificationTools = {
  add_classification: {
    name: 'add_classification',
    description:
      "Record a source-governed PeopleGroupClassification of a registered entity. "
      + "Tier is auto-derived: T0 for public entities (no principal), T2 when the "
      + "target is a sponsor-private community or private segment (caller becomes principal).",
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        schemeId: { type: 'string' },
        conceptId: { type: 'string' },
        classifiedEntityIri: { type: 'string' },
        classificationMethod: { type: 'string' },
        confidenceScore: { type: 'number' },
        validDuring: { type: 'string' },
        sourceRecordIri: { type: 'string' },
        generatedByActivityIri: { type: 'string' },
      },
      required: ['token', 'schemeId', 'conceptId', 'classifiedEntityIri'],
    },
    handler: async (args: {
      token: string
      schemeId: string; conceptId: string; classifiedEntityIri: string
      classificationMethod?: string; confidenceScore?: number
      validDuring?: string
      sourceRecordIri?: string; generatedByActivityIri?: string
    }) => {
      let callerPrincipal: string
      try {
        const ctx = await requirePrincipalAny({
          token: args.token,
          args: args as Record<string, unknown>,
          requiredResource: 'classifications',
          toolName: 'add_classification', argsForAudit: args,
        })
        callerPrincipal = ctx.principal
      } catch (err) {
        if (err instanceof AuthError) return mcpText({ error: err.message })
        throw err
      }

      const target = lookupClassifiedEntity(args.classifiedEntityIri)
      if (!target) return mcpText({ error: `Classified entity ${args.classifiedEntityIri} not found in registry` })

      // For T2 targets, caller must own the target.
      if (target.tier === 'T2') {
        if (!target.principal || target.principal.toLowerCase() !== callerPrincipal.toLowerCase()) {
          return mcpText({ error: 'Cannot classify a private entity owned by another principal' })
        }
      }

      if (args.confidenceScore != null && (args.confidenceScore < 0 || args.confidenceScore > 1)) {
        return mcpText({ error: 'confidenceScore must be in [0.0, 1.0]' })
      }

      const atlIri = classificationIri({
        schemeId: args.schemeId,
        classifiedEntityIri: args.classifiedEntityIri,
        validDuring: args.validDuring,
      })
      const existing = db.select().from(pgClassifications)
        .where(eq(pgClassifications.atlIri, atlIri)).get()
      if (existing) return mcpText({ classification: existing, alreadyRegistered: true })

      const row = {
        id: randomUUID(),
        atlIri,
        tier: target.tier,
        principal: target.tier === 'T2' ? callerPrincipal : null,
        schemeId: args.schemeId,
        conceptId: args.conceptId,
        classifiedEntityIri: args.classifiedEntityIri,
        classifiedEntityTier: target.tier,
        classificationMethod: args.classificationMethod ?? null,
        confidenceScore: args.confidenceScore ?? null,
        validDuring: args.validDuring ?? null,
        sourceRecordIri: args.sourceRecordIri ?? null,
        generatedByActivityIri: args.generatedByActivityIri ?? null,
        recordedAt: new Date().toISOString(),
      }
      db.insert(pgClassifications).values(row).run()
      return mcpText({ classification: row })
    },
  },
}
