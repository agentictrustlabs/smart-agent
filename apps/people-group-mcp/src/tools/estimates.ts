/**
 * Population estimates — multi-source disagreement is a feature, not a bug.
 * One row per (segment, source). Reads via owner or cross-delegation.
 */

import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { populationEstimates, populationSegments } from '../db/schema.js'
import { requirePrincipalAny, AuthError } from '../auth/principal-context.js'
import { estimateIri } from '../util/iri.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

export const estimateTools = {
  list_estimates_for_segment: {
    name: 'list_estimates_for_segment',
    description: 'List all population estimates for a segment, grouped chronologically. Caller must be the sponsor or hold a cross-delegation with the "estimates" resource.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        segmentId: { type: 'string' },
        crossDelegation: { type: 'object' },
      },
      required: ['token', 'segmentId'],
    },
    handler: async (args: { token: string; segmentId: string; crossDelegation?: unknown }) => {
      let principal: string
      try {
        const ctx = await requirePrincipalAny({
          token: args.token,
          args: args as Record<string, unknown>,
          requiredResource: 'estimates',
          toolName: 'list_estimates_for_segment',
          argsForAudit: args,
        })
        principal = ctx.principal
      } catch (err) {
        if (err instanceof AuthError) return mcpText({ error: err.message })
        throw err
      }
      const rows = db.select().from(populationEstimates).where(and(
        eq(populationEstimates.principal, principal),
        eq(populationEstimates.segmentId, args.segmentId),
      )).all()
      // Sort by recordedAt desc.
      rows.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
      return mcpText({ estimates: rows })
    },
  },

  add_estimate: {
    name: 'add_estimate',
    description: 'Add a population estimate for a segment. Multiple estimates per segment are supported (multi-source disagreement). prov:wasDerivedFrom (sourceRecordIri) is required.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        segmentId: { type: 'string' },
        populationCount: { type: 'integer' },
        percentChristian: { type: 'number' },
        percentEvangelical: { type: 'number' },
        primaryLanguageIri: { type: 'string' },
        householdCount: { type: 'integer' },
        leadersIdentified: { type: 'integer' },
        estimateMethod: { type: 'string' },
        confidenceScore: { type: 'number' },
        sourceRecordIri: { type: 'string' },
        generatedByActivityIri: { type: 'string' },
        recordedAt: { type: 'string', description: 'ISO timestamp; defaults to now' },
      },
      required: ['token', 'segmentId', 'sourceRecordIri'],
    },
    handler: async (args: {
      token: string
      segmentId: string
      populationCount?: number
      percentChristian?: number
      percentEvangelical?: number
      primaryLanguageIri?: string
      householdCount?: number
      leadersIdentified?: number
      estimateMethod?: string
      confidenceScore?: number
      sourceRecordIri: string
      generatedByActivityIri?: string
      recordedAt?: string
    }) => {
      let principal: string
      try {
        const ctx = await requirePrincipalAny({
          token: args.token,
          args: args as Record<string, unknown>,
          requiredResource: 'estimates',
          toolName: 'add_estimate', argsForAudit: args,
        })
        principal = ctx.principal
      } catch (err) {
        if (err instanceof AuthError) return mcpText({ error: err.message })
        throw err
      }

      // Confirm segment is owned by caller.
      const seg = db.select().from(populationSegments).where(eq(populationSegments.id, args.segmentId)).get()
      if (!seg) return mcpText({ error: `Segment ${args.segmentId} not found` })
      if (seg.principal.toLowerCase() !== principal.toLowerCase()) {
        return mcpText({ error: 'Segment is not owned by caller' })
      }
      if (args.confidenceScore != null && (args.confidenceScore < 0 || args.confidenceScore > 1)) {
        return mcpText({ error: 'confidenceScore must be in [0.0, 1.0]' })
      }

      const recordedAt = args.recordedAt ?? new Date().toISOString()
      const sourceFragment = args.sourceRecordIri.split(/[#/]/).pop() ?? args.sourceRecordIri
      const atlIri = estimateIri({ segmentId: args.segmentId, recordedAt, sourceFragment })

      const row = {
        id: randomUUID(),
        atlIri,
        principal,
        segmentId: args.segmentId,
        populationCount: args.populationCount ?? null,
        percentChristian: args.percentChristian ?? null,
        percentEvangelical: args.percentEvangelical ?? null,
        primaryLanguageIri: args.primaryLanguageIri ?? null,
        householdCount: args.householdCount ?? null,
        leadersIdentified: args.leadersIdentified ?? null,
        estimateMethod: args.estimateMethod ?? null,
        confidenceScore: args.confidenceScore ?? null,
        sourceRecordIri: args.sourceRecordIri,
        generatedByActivityIri: args.generatedByActivityIri ?? null,
        recordedAt,
      }
      db.insert(populationEstimates).values(row).run()
      return mcpText({ estimate: row })
    },
  },
}
