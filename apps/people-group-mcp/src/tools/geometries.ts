/**
 * Geometries — sapg:Geometry attached to a segment. Default tier T2.
 */

import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { pgGeometries, populationSegments } from '../db/schema.js'
import { requirePrincipalAny, AuthError } from '../auth/principal-context.js'
import { geometryIri } from '../util/iri.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

export const geometryTools = {
  list_geometries: {
    name: 'list_geometries',
    description: 'List geometries for a segment. Caller must hold the geometries grant.',
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
          requiredResource: 'geometries',
          toolName: 'list_geometries',
          argsForAudit: args,
        })
        principal = ctx.principal
      } catch (err) {
        if (err instanceof AuthError) return mcpText({ error: err.message })
        throw err
      }
      const rows = db.select().from(pgGeometries).where(and(
        eq(pgGeometries.principal, principal),
        eq(pgGeometries.segmentId, args.segmentId),
      )).all()
      return mcpText({ geometries: rows })
    },
  },

  add_geometry: {
    name: 'add_geometry',
    description: 'Add a geometry record (WKT) for a segment. Default tier T2; sponsors flip per-row visibility to publish.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        segmentId: { type: 'string' },
        wktGeometry: { type: 'string' },
        geometryMethod: { type: 'string' },
        confidenceScore: { type: 'number' },
        sourceRecordIri: { type: 'string' },
        generatedByActivityIri: { type: 'string' },
        visibility: { type: 'string', description: "'public' | 'sponsor-private' (default sponsor-private)" },
      },
      required: ['token', 'segmentId', 'wktGeometry'],
    },
    handler: async (args: {
      token: string
      segmentId: string
      wktGeometry: string
      geometryMethod?: string
      confidenceScore?: number
      sourceRecordIri?: string
      generatedByActivityIri?: string
      visibility?: 'public' | 'sponsor-private'
    }) => {
      let principal: string
      try {
        const ctx = await requirePrincipalAny({
          token: args.token,
          args: args as Record<string, unknown>,
          requiredResource: 'geometries',
          toolName: 'add_geometry', argsForAudit: args,
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

      const createdAt = new Date().toISOString()
      const atlIri = geometryIri({ segmentId: args.segmentId, createdAt })
      const row = {
        id: randomUUID(),
        atlIri,
        principal,
        segmentId: args.segmentId,
        wktGeometry: args.wktGeometry,
        geometryMethod: args.geometryMethod ?? null,
        confidenceScore: args.confidenceScore ?? null,
        sourceRecordIri: args.sourceRecordIri ?? null,
        generatedByActivityIri: args.generatedByActivityIri ?? null,
        visibility: args.visibility ?? 'sponsor-private',
        createdAt,
      }
      db.insert(pgGeometries).values(row).run()
      return mcpText({ geometry: row })
    },
  },
}
