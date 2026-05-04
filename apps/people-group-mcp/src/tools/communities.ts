/**
 * Communities — Tier-2-Sensitive (ADR-PG-1).
 *
 * display_name, cohesion_basis, location_hint are stored encrypted-at-rest
 * (AES-GCM, per-row DEK wrapped under per-principal KEK). Reads decrypt
 * server-side and FILTER returned fields by the caller's grant resources:
 *
 *   - 'communities'         → display_name + cohesion_basis (and is_agentive)
 *   - 'community-locations' → location_hint
 *
 * Default cross-delegations grant 'communities' only; geographic detail is
 * opt-in (SEC-5). delete_community hard-deletes the row and writes a
 * tombstone for compliance.
 */

import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { pgCommunities, pgCommunityTombstones, populationSegments } from '../db/schema.js'
import { requirePrincipalAny, AuthError } from '../auth/principal-context.js'
import { encryptCommunity, decryptCommunity } from '../util/encryption.js'
import { communityIri } from '../util/iri.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

interface CommunityRow {
  id: string
  atlIri: string
  principal: string
  conceptId: string
  segmentId: string
  displayNameCt: Buffer
  cohesionBasisCt: Buffer | null
  locationHintCt: Buffer | null
  encDek: Buffer
  encIv: Buffer
  isAgentive: number
  createdAt: string
  updatedAt: string
}

function buf(v: unknown): Buffer | null {
  if (v == null) return null
  if (Buffer.isBuffer(v)) return v
  if (v instanceof Uint8Array) return Buffer.from(v)
  return null
}

export const communityTools = {
  list_communities: {
    name: 'list_communities',
    description:
      'List communities for a segment. Decrypts server-side and returns only '
      + "fields permitted by the caller's grant: 'communities' resource grants "
      + "displayName + cohesionBasis; 'community-locations' grants locationHint.",
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
      // Two grants we care about — try 'communities' first (the standard
      // base read), then check 'community-locations' separately.
      let basePrincipal: string
      let allowLocations = false
      try {
        const ctx = await requirePrincipalAny({
          token: args.token,
          args: args as Record<string, unknown>,
          requiredResource: 'communities',
          toolName: 'list_communities',
          argsForAudit: args,
        })
        basePrincipal = ctx.principal
      } catch (err) {
        if (err instanceof AuthError) return mcpText({ error: err.message })
        throw err
      }
      // Re-check whether the same caller also has community-locations.
      try {
        await requirePrincipalAny({
          token: args.token,
          args: args as Record<string, unknown>,
          requiredResource: 'community-locations',
          toolName: 'list_communities',
          argsForAudit: { ...args, _resolveLocations: true },
        })
        allowLocations = true
      } catch {
        // No location grant — fall through with allowLocations=false.
      }

      const rows = db.select().from(pgCommunities).where(and(
        eq(pgCommunities.principal, basePrincipal),
        eq(pgCommunities.segmentId, args.segmentId),
      )).all() as CommunityRow[]

      const out = rows.map((r) => {
        const plain = decryptCommunity({
          principal: r.principal,
          enc: {
            displayNameCt: buf(r.displayNameCt)!,
            cohesionBasisCt: buf(r.cohesionBasisCt),
            locationHintCt: buf(r.locationHintCt),
            encDek: buf(r.encDek)!,
            encIv: buf(r.encIv)!,
          },
        })
        return {
          id: r.id,
          atlIri: r.atlIri,
          conceptId: r.conceptId,
          segmentId: r.segmentId,
          displayName: plain.displayName,
          cohesionBasis: plain.cohesionBasis,
          locationHint: allowLocations ? plain.locationHint : undefined,
          isAgentive: r.isAgentive === 1,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        }
      })

      return mcpText({ communities: out, includesLocations: allowLocations })
    },
  },

  upsert_community: {
    name: 'upsert_community',
    description:
      'Create or update a community owned by the calling sponsor. The community '
      + 'segment must be owned by the same principal (Tier-2-Sensitive isolation). '
      + 'displayName, cohesionBasis, locationHint are encrypted-at-rest.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        atlIri: { type: 'string' },
        communitySlug: { type: 'string' },
        conceptId: { type: 'string' },
        segmentId: { type: 'string' },
        displayName: { type: 'string' },
        cohesionBasis: { type: 'string' },
        locationHint: { type: 'string' },
        isAgentive: { type: 'boolean' },
      },
      required: ['token', 'conceptId', 'segmentId', 'displayName'],
    },
    handler: async (args: {
      token: string
      atlIri?: string; communitySlug?: string
      conceptId: string; segmentId: string
      displayName: string; cohesionBasis?: string; locationHint?: string
      isAgentive?: boolean
    }) => {
      let principal: string
      try {
        const ctx = await requirePrincipalAny({
          token: args.token,
          args: args as Record<string, unknown>,
          requiredResource: 'communities',
          toolName: 'upsert_community', argsForAudit: args,
        })
        principal = ctx.principal
      } catch (err) {
        if (err instanceof AuthError) return mcpText({ error: err.message })
        throw err
      }

      // Same-principal constraint with parent segment (IA-5 / SEC G3 carryover).
      const seg = db.select().from(populationSegments).where(eq(populationSegments.id, args.segmentId)).get()
      if (!seg) return mcpText({ error: `Segment ${args.segmentId} not found` })
      if (seg.principal.toLowerCase() !== principal.toLowerCase()) {
        return mcpText({ error: 'Segment is not owned by caller; cross-org community membership is Phase 2' })
      }

      const slug = args.communitySlug ?? args.displayName.toLowerCase().replace(/[^a-z0-9]+/g, '-')
      const atlIri = args.atlIri ?? communityIri({ principal, communitySlug: slug })

      const enc = encryptCommunity({
        principal,
        plaintext: {
          displayName: args.displayName,
          cohesionBasis: args.cohesionBasis ?? null,
          locationHint: args.locationHint ?? null,
        },
      })

      const existing = db.select().from(pgCommunities).where(and(
        eq(pgCommunities.principal, principal),
        eq(pgCommunities.atlIri, atlIri),
      )).get() as CommunityRow | undefined

      const now = new Date().toISOString()
      if (existing) {
        db.update(pgCommunities).set({
          conceptId: args.conceptId,
          segmentId: args.segmentId,
          displayNameCt: enc.displayNameCt,
          cohesionBasisCt: enc.cohesionBasisCt,
          locationHintCt: enc.locationHintCt,
          encDek: enc.encDek,
          encIv: enc.encIv,
          isAgentive: args.isAgentive ? 1 : 0,
          updatedAt: now,
        }).where(eq(pgCommunities.id, existing.id)).run()
        return mcpText({ id: existing.id, atlIri, updated: true })
      }

      const id = randomUUID()
      db.insert(pgCommunities).values({
        id, atlIri, principal,
        conceptId: args.conceptId,
        segmentId: args.segmentId,
        displayNameCt: enc.displayNameCt,
        cohesionBasisCt: enc.cohesionBasisCt,
        locationHintCt: enc.locationHintCt,
        encDek: enc.encDek,
        encIv: enc.encIv,
        isAgentive: args.isAgentive ? 1 : 0,
        createdAt: now,
        updatedAt: now,
      }).run()
      return mcpText({ id, atlIri, created: true })
    },
  },

  delete_community: {
    name: 'delete_community',
    description:
      'Hard-delete a community (right-to-be-forgotten). Writes a tombstone row '
      + 'to pg_community_tombstones for compliance; on-chain audit log entries '
      + 'referencing the community via args_hash are intentionally not redacted '
      + '(the hash is irreversible).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        token: { type: 'string' },
        id: { type: 'string' },
        deletionReason: { type: 'string' },
      },
      required: ['token', 'id'],
    },
    handler: async (args: { token: string; id: string; deletionReason?: string; crossDelegation?: unknown }) => {
      let principal: string
      try {
        const ctx = await requirePrincipalAny({
          token: args.token,
          args: args as Record<string, unknown>,
          requiredResource: 'communities',
          toolName: 'delete_community', argsForAudit: args,
        })
        principal = ctx.principal
      } catch (err) {
        if (err instanceof AuthError) return mcpText({ error: err.message })
        throw err
      }

      const row = db.select().from(pgCommunities).where(and(
        eq(pgCommunities.id, args.id),
        eq(pgCommunities.principal, principal),
      )).get() as CommunityRow | undefined
      if (!row) return mcpText({ error: 'Community not found or not owned by caller' })

      const now = new Date().toISOString()
      db.insert(pgCommunityTombstones).values({
        communityAtlIri: row.atlIri,
        principal,
        deletedAt: now,
        deletionReason: args.deletionReason ?? null,
      }).run()
      db.delete(pgCommunities).where(eq(pgCommunities.id, row.id)).run()
      return mcpText({ deleted: true, atlIri: row.atlIri })
    },
  },
}
