/**
 * Reachedness assessments — multi-source disagreement supported.
 * Status values reference SKOS C-Box concepts (sapg:StatusUnreached etc.),
 * not free text.
 */

import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { reachednessAssessments, populationSegments } from '../db/schema.js'
import { requirePrincipalAny, AuthError } from '../auth/principal-context.js'
import { reachednessIri } from '../util/iri.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

export const reachednessTools = {
  list_reachedness_for_segment: {
    name: 'list_reachedness_for_segment',
    description: 'List all reachedness assessments for a segment.',
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
          requiredResource: 'reachedness',
          toolName: 'list_reachedness_for_segment',
          argsForAudit: args,
        })
        principal = ctx.principal
      } catch (err) {
        if (err instanceof AuthError) return mcpText({ error: err.message })
        throw err
      }
      const rows = db.select().from(reachednessAssessments).where(and(
        eq(reachednessAssessments.principal, principal),
        eq(reachednessAssessments.segmentId, args.segmentId),
      )).all()
      rows.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
      return mcpText({ assessments: rows })
    },
  },

  add_reachedness_assessment: {
    name: 'add_reachedness_assessment',
    description: 'Record a reachedness assessment for a segment. Status IRIs must reference the sapg:ReachednessStatusScheme + sapg:EngagementStatusScheme C-Box.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        segmentId: { type: 'string' },
        reachednessStatusIri: { type: 'string' },
        engagementStatusIri: { type: 'string' },
        percentEvangelical: { type: 'number' },
        criteriaIri: { type: 'string' },
        confidenceScore: { type: 'number' },
        sourceRecordIri: { type: 'string' },
        generatedByActivityIri: { type: 'string' },
        recordedAt: { type: 'string' },
      },
      required: ['token', 'segmentId', 'sourceRecordIri'],
    },
    handler: async (args: {
      token: string
      segmentId: string
      reachednessStatusIri?: string
      engagementStatusIri?: string
      percentEvangelical?: number
      criteriaIri?: string
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
          requiredResource: 'reachedness',
          toolName: 'add_reachedness_assessment', argsForAudit: args,
        })
        principal = ctx.principal
      } catch (err) {
        if (err instanceof AuthError) return mcpText({ error: err.message })
        throw err
      }
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
      const atlIri = reachednessIri({ segmentId: args.segmentId, recordedAt, sourceFragment })

      const row = {
        id: randomUUID(),
        atlIri,
        principal,
        segmentId: args.segmentId,
        reachednessStatusIri: args.reachednessStatusIri ?? null,
        engagementStatusIri: args.engagementStatusIri ?? null,
        percentEvangelical: args.percentEvangelical ?? null,
        criteriaIri: args.criteriaIri ?? null,
        confidenceScore: args.confidenceScore ?? null,
        sourceRecordIri: args.sourceRecordIri,
        generatedByActivityIri: args.generatedByActivityIri ?? null,
        recordedAt,
      }
      db.insert(reachednessAssessments).values(row).run()
      return mcpText({ assessment: row })
    },
  },
}
