/**
 * Segments — registration row for a scoped people-group population.
 *
 *   list_segments  — public read (T1 fields only) + owner/delegated full read
 *   get_segment    — public T1; T2 fields stripped if no auth
 *   upsert_segment — owner-only write
 *
 * upsert_segment runs validateSegment + validateT1DisplayName before write
 * and (when visibility='public') is the place that mints the on-chain
 * `sapg:StewardsPeopleGroupInPlace` assertion.
 *
 * Cross-MCP referential integrity: spatial_feature_id is verified against
 * geo-mcp's get_feature unless { deferGeoVerification: true } is set.
 */

import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../db/index.js'
import { populationSegments, pgCommunities, scopeTypes } from '../db/schema.js'
import { requirePrincipalAny, AuthError } from '../auth/principal-context.js'
import { validateSegment, validateT1DisplayName } from '../util/shacl-conditions.js'
import { segmentIri } from '../util/iri.js'
import { config } from '../config.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

interface SegmentRow {
  id: string; atlIri: string; principal: string
  conceptId: string; collectiveId: string | null
  scopeTypeId: string; spatialFeatureId: string | null
  parentSegmentId: string | null; displayName: string | null
  isDiaspora: number; homelandFeatureId: string | null; hostFeatureId: string | null
  religiousIdentityIri: string | null; primaryLanguageIri: string | null
  casteClanTribeIdentityIri: string | null
  withinChurchPrincipal: string | null; withinNetworkPrincipal: string | null
  withinDenominationIri: string | null; withinEngagementId: string | null
  visibility: string; onChainAssertionId: string | null
  geoVerifiedAt: string | null
  temporalScope: string | null
  createdAt: string; updatedAt: string
}

const T1_FIELDS = [
  'id', 'atlIri', 'principal', 'conceptId', 'collectiveId',
  'scopeTypeId', 'spatialFeatureId', 'parentSegmentId',
  'displayName', 'visibility', 'temporalScope', 'createdAt', 'updatedAt',
] as const

function stripToT1(row: SegmentRow): Pick<SegmentRow, typeof T1_FIELDS[number]> {
  const out = {} as Partial<SegmentRow>
  const src = row as unknown as Record<string, unknown>
  for (const k of T1_FIELDS) (out as Record<string, unknown>)[k] = src[k]
  return out as Pick<SegmentRow, typeof T1_FIELDS[number]>
}

async function verifyGeoFeature(featureIri: string): Promise<boolean> {
  // Best-effort cross-MCP check. Treat 4xx/5xx/network errors uniformly: caller
  // can opt into deferred mode if geo-mcp is offline.
  try {
    const res = await fetch(`${config.geoMcpUrl}/tools/get_feature`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ args: { iri: featureIri } }),
    })
    if (!res.ok) return false
    const data = await res.json() as { feature?: unknown; error?: string }
    return Boolean(data.feature)
  } catch {
    return false
  }
}

export const segmentTools = {
  list_segments: {
    name: 'list_segments',
    description:
      'List population segments. Without auth, only T1 fields of public-visibility segments are returned. '
      + 'Owner session or matching cross-delegation gets full T2 detail. '
      + 'Pass `publicOnly: true` to force the T1-public path even when a session token is present '
      + '(used by web callers that always carry a session but want the public read shape).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string', description: 'Optional — required for full T2 fields' },
        sponsorPrincipal: { type: 'string', description: 'Filter by sponsoring org address' },
        conceptId: { type: 'string' },
        scopeTypeId: { type: 'string' },
        crossDelegation: { type: 'object', description: 'Optional cross-delegation for delegated read' },
        publicOnly: { type: 'boolean', description: 'Force T1-public path even with a session token' },
      },
    },
    handler: async (args: {
      token?: string
      sponsorPrincipal?: string
      conceptId?: string
      scopeTypeId?: string
      crossDelegation?: unknown
      publicOnly?: boolean
    }) => {
      // Multi-tenancy isolation rule (SEC-10): every query must filter by principal
      // when reading T2 fields. Public-only listing is OK without principal.
      let dataPrincipal: string | null = null
      let isAuthenticated = false
      // `publicOnly` short-circuits the auth path so callers that always
      // carry a session token (web app post-consolidation) can still ask
      // for the unauthenticated T1-public shape.
      if (args.token && !args.publicOnly) {
        try {
          const ctx = await requirePrincipalAny({
            token: args.token,
            args: args as Record<string, unknown>,
            requiredResource: 'segments',
            toolName: 'list_segments',
            argsForAudit: args,
          })
          dataPrincipal = ctx.principal
          isAuthenticated = true
        } catch (err) {
          if (err instanceof AuthError) return mcpText({ error: err.message })
          throw err
        }
      }

      let rows = db.select().from(populationSegments).all() as SegmentRow[]
      if (args.sponsorPrincipal) {
        const sp = args.sponsorPrincipal.toLowerCase()
        rows = rows.filter(r => r.principal.toLowerCase() === sp)
      }
      if (args.conceptId) rows = rows.filter(r => r.conceptId === args.conceptId)
      if (args.scopeTypeId) rows = rows.filter(r => r.scopeTypeId === args.scopeTypeId)

      // T1 visibility filter for unauthenticated readers.
      if (!isAuthenticated) {
        rows = rows.filter(r => r.visibility === 'public').map(stripToT1) as SegmentRow[]
        return mcpText({ segments: rows })
      }
      // Authenticated readers see only their own (sponsor) or sponsor-delegated segments.
      rows = rows.filter(r => r.principal.toLowerCase() === dataPrincipal!.toLowerCase())
      return mcpText({ segments: rows })
    },
  },

  get_segment: {
    name: 'get_segment',
    description: 'Get one segment by id. Returns T1 fields only without auth; full row when caller is the sponsor or a delegated reader.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        id: { type: 'string' },
        crossDelegation: { type: 'object' },
      },
      required: ['id'],
    },
    handler: async (args: { token?: string; id: string; crossDelegation?: unknown }) => {
      const row = db.select().from(populationSegments).where(eq(populationSegments.id, args.id)).get() as SegmentRow | undefined
      if (!row) return mcpText({ segment: null })

      // Public T1 path — no token, public visibility.
      if (!args.token) {
        if (row.visibility !== 'public') return mcpText({ error: 'Segment is sponsor-private; auth required' })
        return mcpText({ segment: stripToT1(row) })
      }

      try {
        const ctx = await requirePrincipalAny({
          token: args.token,
          args: args as Record<string, unknown>,
          requiredResource: 'segments',
          toolName: 'get_segment',
          argsForAudit: args,
        })
        if (ctx.principal.toLowerCase() !== row.principal.toLowerCase()) {
          return mcpText({ error: 'Segment principal does not match auth context' })
        }
      } catch (err) {
        if (err instanceof AuthError) return mcpText({ error: err.message })
        throw err
      }
      return mcpText({ segment: row })
    },
  },

  upsert_segment: {
    name: 'upsert_segment',
    description:
      'Create or update a population segment for the caller (sponsor). '
      + 'Runs the per-scope-type SHACL conditional check and the T1 displayName '
      + 'deny-list check before writing. When visibility=public, mints an '
      + 'on-chain sapg:StewardsPeopleGroupInPlace assertion (caller must own '
      + 'the org via direct or cross-delegation auth).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        crossDelegation: { type: 'object' },
        deferGeoVerification: { type: 'boolean' },

        // segment fields
        atlIri: { type: 'string' },
        segmentSlug: { type: 'string', description: 'Used to derive atl_iri when not given' },
        conceptId: { type: 'string' },
        collectiveId: { type: 'string' },
        scopeTypeIri: { type: 'string' },
        spatialFeatureId: { type: 'string' },
        parentSegmentId: { type: 'string' },
        displayName: { type: 'string' },
        visibility: { type: 'string', description: "'public' or 'sponsor-private' (no default)" },

        // sociocultural / scope-specific
        isDiaspora: { type: 'boolean' },
        homelandFeatureId: { type: 'string' },
        hostFeatureId: { type: 'string' },
        religiousIdentityIri: { type: 'string' },
        primaryLanguageIri: { type: 'string' },
        casteClanTribeIdentityIri: { type: 'string' },
        withinChurchPrincipal: { type: 'string' },
        withinNetworkPrincipal: { type: 'string' },
        withinDenominationIri: { type: 'string' },
        withinEngagementId: { type: 'string' },

        temporalScope: { type: 'string' },
      },
      required: ['token', 'conceptId', 'scopeTypeIri', 'visibility'],
    },
    handler: async (args: {
      token: string; crossDelegation?: unknown; deferGeoVerification?: boolean
      atlIri?: string; segmentSlug?: string
      conceptId: string; collectiveId?: string
      scopeTypeIri: string
      spatialFeatureId?: string; parentSegmentId?: string
      displayName?: string; visibility: 'public' | 'sponsor-private'
      isDiaspora?: boolean; homelandFeatureId?: string; hostFeatureId?: string
      religiousIdentityIri?: string; primaryLanguageIri?: string; casteClanTribeIdentityIri?: string
      withinChurchPrincipal?: string; withinNetworkPrincipal?: string
      withinDenominationIri?: string; withinEngagementId?: string
      temporalScope?: string
    }) => {
      let principal: string
      try {
        const ctx = await requirePrincipalAny({
          token: args.token,
          args: args as Record<string, unknown>,
          requiredResource: 'segments',
          toolName: 'upsert_segment', argsForAudit: args,
        })
        principal = ctx.principal
      } catch (err) {
        if (err instanceof AuthError) return mcpText({ error: err.message })
        throw err
      }

      // Application-layer SHACL.
      const failures = validateSegment({
        scopeTypeIri: args.scopeTypeIri,
        conceptId: args.conceptId,
        spatialFeatureId: args.spatialFeatureId,
        primaryLanguageIri: args.primaryLanguageIri,
        religiousIdentityIri: args.religiousIdentityIri,
        casteClanTribeIdentityIri: args.casteClanTribeIdentityIri,
        withinChurchPrincipal: args.withinChurchPrincipal,
        withinNetworkPrincipal: args.withinNetworkPrincipal,
        withinDenominationIri: args.withinDenominationIri,
        withinEngagementId: args.withinEngagementId,
        isDiaspora: args.isDiaspora,
        homelandFeatureId: args.homelandFeatureId,
        hostFeatureId: args.hostFeatureId,
        visibility: args.visibility,
      })
      if (failures.length > 0) {
        return mcpText({ error: 'SHACL conditional check failed', failures })
      }

      // T1 displayName safety (deny-list / length / community-IRI block).
      const ownCommunityIris = db.select().from(pgCommunities)
        .where(eq(pgCommunities.principal, principal)).all().map(c => c.atlIri)
      const denyMsg = validateT1DisplayName({
        displayName: args.displayName,
        visibility: args.visibility,
        denyList: config.t1DisplayNameDenyList,
        maxLength: config.t1DisplayNameMaxLength,
        knownCommunityIris: ownCommunityIris,
      })
      if (denyMsg) return mcpText({ error: denyMsg })

      // Cross-MCP referential integrity (deferable).
      let geoVerifiedAt: string | null = null
      if (args.spatialFeatureId && !args.deferGeoVerification) {
        const ok = await verifyGeoFeature(args.spatialFeatureId)
        if (!ok) return mcpText({ error: `geo-mcp could not resolve feature ${args.spatialFeatureId}; pass deferGeoVerification=true to bypass` })
        geoVerifiedAt = new Date().toISOString()
      }

      const slug = args.segmentSlug ?? (args.displayName?.toLowerCase().replace(/[^a-z0-9]+/g, '-') ?? randomUUID())
      const atlIri = args.atlIri ?? segmentIri({ principal, segmentSlug: slug })

      const existing = db.select().from(populationSegments)
        .where(and(eq(populationSegments.principal, principal), eq(populationSegments.atlIri, atlIri))).get() as SegmentRow | undefined

      const now = new Date().toISOString()
      if (existing) {
        // UPDATE — preserve immutable id + atlIri; refresh updatedAt.
        db.update(populationSegments).set({
          conceptId: args.conceptId,
          collectiveId: args.collectiveId ?? null,
          scopeTypeId: scopeIdFromIri(args.scopeTypeIri),
          spatialFeatureId: args.spatialFeatureId ?? null,
          parentSegmentId: args.parentSegmentId ?? null,
          displayName: args.displayName ?? null,
          isDiaspora: args.isDiaspora ? 1 : 0,
          homelandFeatureId: args.homelandFeatureId ?? null,
          hostFeatureId: args.hostFeatureId ?? null,
          religiousIdentityIri: args.religiousIdentityIri ?? null,
          primaryLanguageIri: args.primaryLanguageIri ?? null,
          casteClanTribeIdentityIri: args.casteClanTribeIdentityIri ?? null,
          withinChurchPrincipal: args.withinChurchPrincipal?.toLowerCase() ?? null,
          withinNetworkPrincipal: args.withinNetworkPrincipal?.toLowerCase() ?? null,
          withinDenominationIri: args.withinDenominationIri ?? null,
          withinEngagementId: args.withinEngagementId ?? null,
          visibility: args.visibility,
          geoVerifiedAt: geoVerifiedAt ?? existing.geoVerifiedAt,
          temporalScope: args.temporalScope ?? null,
          updatedAt: now,
        }).where(eq(populationSegments.id, existing.id)).run()
        const fresh = db.select().from(populationSegments).where(eq(populationSegments.id, existing.id)).get()
        return mcpText({ segment: fresh, updated: true })
      }

      const row = {
        id: randomUUID(),
        atlIri,
        principal,
        conceptId: args.conceptId,
        collectiveId: args.collectiveId ?? null,
        scopeTypeId: scopeIdFromIri(args.scopeTypeIri),
        spatialFeatureId: args.spatialFeatureId ?? null,
        parentSegmentId: args.parentSegmentId ?? null,
        displayName: args.displayName ?? null,
        isDiaspora: args.isDiaspora ? 1 : 0,
        homelandFeatureId: args.homelandFeatureId ?? null,
        hostFeatureId: args.hostFeatureId ?? null,
        religiousIdentityIri: args.religiousIdentityIri ?? null,
        primaryLanguageIri: args.primaryLanguageIri ?? null,
        casteClanTribeIdentityIri: args.casteClanTribeIdentityIri ?? null,
        withinChurchPrincipal: args.withinChurchPrincipal?.toLowerCase() ?? null,
        withinNetworkPrincipal: args.withinNetworkPrincipal?.toLowerCase() ?? null,
        withinDenominationIri: args.withinDenominationIri ?? null,
        withinEngagementId: args.withinEngagementId ?? null,
        visibility: args.visibility,
        onChainAssertionId: null,
        geoVerifiedAt,
        temporalScope: args.temporalScope ?? null,
        createdAt: now,
        updatedAt: now,
      }
      db.insert(populationSegments).values(row).run()

      // Public T1 segments warrant a discovery handle on-chain. The actual
      // assertion mint is done by the web-side seeder/UI which holds the
      // wallet; here we return a `mintHint` so the caller knows what to do.
      const mintHint = args.visibility === 'public'
        ? {
            kind: 'sapg:StewardsPeopleGroupInPlace',
            fields: {
              orgPrincipal: principal,
              conceptIRI: args.conceptId,
              scopeTypeIRI: args.scopeTypeIri,
              spatialFeatureIRI: args.spatialFeatureId,
              atlIri: atlIri,
              // displayName is OPTIONAL on-chain (ADR-PG-3). Only included
              // if it passed the deny-list earlier and caller wants it.
              displayName: args.displayName,
            },
            displayWarning:
              'displayName, if included in the assertion, mints permanently on-chain. '
              + 'Re-confirm before minting. The mint must happen from a session that holds the org\'s smart account wallet.',
          }
        : null

      return mcpText({ segment: row, mintHint })
    },
  },
}

function scopeIdFromIri(iri: string): string {
  const row = db.select().from(scopeTypes).where(eq(scopeTypes.atlIri, iri)).get()
  if (!row) throw new Error(`Unknown scope type IRI: ${iri}`)
  return row.id
}

void inArray
