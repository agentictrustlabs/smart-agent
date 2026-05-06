/**
 * Spec 001 — Intent Marketplace (Direct Lane). MatchInitiation MCP tools.
 *
 * org-mcp side: org initiators (an org member proposing a match between
 * two org-tenanted intents, or one org intent + one external). The
 * person-mcp twin is at `apps/person-mcp/src/tools/matchInitiations.ts`.
 *
 * Tools registered (each tool name === scope name):
 *   - match_initiation:create     — write row, cascade ack-count, dispatch
 *                                   connector notifications, conditionally
 *                                   anchor on chain (deferred to action layer).
 *   - match_initiation:read       — list the caller's own initiations.
 *   - match_initiation:supersede  — STUB.
 *   - match_initiation:consume    — STUB.
 *
 * Persistence: `match_initiations` table (org-mcp twin per IA § 2.1).
 *
 * Cross-MCP federation: v1 same-DB shortcut. // TODO(cross-mcp).
 */
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  matchInitiations,
  orgIntents,
  orgNotifications,
} from '../db/schema.js'
import { requireOrgPrincipalAny as requireOrgPrincipal } from '../auth/principal-context.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

function nowIso(): string {
  return new Date().toISOString()
}

interface RankBasis {
  proximityHops: number
  proximityScore: number
  priorOutcomes: { fulfilled: number; abandoned: number }
  outcomeScore: number
  composite: number
  isColdStart: boolean
}

type MatchInitiationVisibility = 'public' | 'public-coarse' | 'private' | 'off-chain'
type MatchInitiationKind = 'self' | 'connector'

interface CreateArgs {
  token: string
  viewedIntentId: string
  candidateIntentId: string
  basis: RankBasis
  visibility?: MatchInitiationVisibility
}

type CreateErrorKind =
  | { kind: 'stale-candidate'; reason: 'withdrawn' | 'fulfilled' | 'abandoned' }
  | { kind: 'duplicate-pending'; existingInitiationId: string }
  | { kind: 'self-match-excluded' }
  | { kind: 'visibility-blocked'; reason: 'private-non-credentialed' }
  | { kind: 'validation'; messages: string[] }

function err(error: CreateErrorKind) {
  return mcpText({ ok: false as const, error })
}

interface OrgIntentRow {
  id: string
  orgPrincipal: string
  direction: string
  kind: string
  status: string
  visibility: string
  liveAcknowledgementCount: number | null
}

function findIntentRow(intentId: string): OrgIntentRow | null {
  const rows = db.select().from(orgIntents).where(eq(orgIntents.id, intentId)).all()
  return rows[0] ?? null
}

function bumpAckCountLocal(intentId: string, delta: 1 | -1): { bumped: boolean } {
  const row = db.select().from(orgIntents).where(eq(orgIntents.id, intentId)).all()[0]
  if (!row) {
    console.warn(
      `[org-mcp/matchInitiations] ack-count bump skipped — intent ${intentId} not local. // TODO(cross-mcp)`,
    )
    return { bumped: false }
  }
  const cur = row.liveAcknowledgementCount ?? 0
  const next = Math.max(0, cur + delta)
  let nextStatus = row.status
  if (cur === 0 && next === 1 && nextStatus === 'expressed') nextStatus = 'acknowledged'
  else if (cur === 1 && next === 0 && nextStatus === 'acknowledged') nextStatus = 'expressed'
  db.update(orgIntents)
    .set({ liveAcknowledgementCount: next, status: nextStatus, updatedAt: nowIso() })
    .where(eq(orgIntents.id, intentId))
    .run()
  return { bumped: true }
}

function dispatchConnectorNotification(opts: {
  toOrgPrincipal: string
  initiatorAgentId: string
  viewedIntentId: string
  candidateIntentId: string
  initiationId: string
}): void {
  // Org notifications are inserted whenever the target principal is local
  // to this org-mcp instance (same-DB shortcut). // TODO(cross-mcp).
  db.insert(orgNotifications).values({
    id: randomUUID(),
    orgPrincipal: opts.toOrgPrincipal,
    kind: 'match-initiation-connector',
    payload: JSON.stringify({
      initiationId: opts.initiationId,
      initiatorAgentId: opts.initiatorAgentId,
      viewedIntentId: opts.viewedIntentId,
      candidateIntentId: opts.candidateIntentId,
    }),
    readAt: null,
    createdAt: nowIso(),
  }).run()
}

function strictestVisibility(a: string, b: string): MatchInitiationVisibility {
  const order: MatchInitiationVisibility[] = ['private', 'off-chain', 'public-coarse', 'public']
  const ax = order.indexOf(a as MatchInitiationVisibility)
  const bx = order.indexOf(b as MatchInitiationVisibility)
  const ai = ax === -1 ? 0 : ax
  const bi = bx === -1 ? 0 : bx
  return order[Math.min(ai, bi)]
}

const createTool = {
  name: 'match_initiation:create',
  description:
    "Create a MatchInitiation row pairing two intents (org-mcp initiator-owned per IA § 2.1). Cascades intent:bump_ack_count +1 to both intent owners, dispatches connector-mode notifications, and conditionally anchors on chain.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      viewedIntentId: { type: 'string' },
      candidateIntentId: { type: 'string' },
      basis: { type: 'object' },
      visibility: { type: 'string' },
    },
    required: ['token', 'viewedIntentId', 'candidateIntentId', 'basis'],
  },
  handler: async (args: CreateArgs) => {
    const orgPrincipal = await requireOrgPrincipal(args.token, args, 'match_initiation:create')

    if (args.viewedIntentId === args.candidateIntentId) {
      return err({ kind: 'validation', messages: ['viewedIntentId and candidateIntentId must differ'] })
    }

    const viewed = findIntentRow(args.viewedIntentId)
    const candidate = findIntentRow(args.candidateIntentId)
    if (!viewed || !candidate) {
      console.warn(
        `[org-mcp/matchInitiations] intent lookup failed (viewed=${!!viewed} candidate=${!!candidate}); cross-MCP federation not implemented. // TODO(cross-mcp)`,
      )
    }

    for (const i of [viewed, candidate]) {
      if (!i) continue
      if (i.status === 'withdrawn' || i.status === 'fulfilled' || i.status === 'abandoned') {
        return err({
          kind: 'stale-candidate',
          reason: i.status as 'withdrawn' | 'fulfilled' | 'abandoned',
        })
      }
    }

    if (viewed && candidate && viewed.orgPrincipal === candidate.orgPrincipal) {
      return err({ kind: 'self-match-excluded' })
    }
    if (viewed && candidate && viewed.direction === candidate.direction) {
      return err({
        kind: 'validation',
        messages: ['viewedIntent.direction must differ from candidateIntent.direction'],
      })
    }
    if (viewed && candidate && viewed.kind !== candidate.kind) {
      return err({
        kind: 'validation',
        messages: ['viewedIntent.kind must equal candidateIntent.kind (object equality)'],
      })
    }

    const existing = db.select().from(matchInitiations)
      .where(and(
        eq(matchInitiations.principal, orgPrincipal),
        eq(matchInitiations.viewedIntentId, args.viewedIntentId),
        eq(matchInitiations.candidateIntentId, args.candidateIntentId),
        eq(matchInitiations.status, 'pending'),
      ))
      .all()
    if (existing.length > 0) {
      return err({ kind: 'duplicate-pending', existingInitiationId: existing[0].id })
    }

    let visibility: MatchInitiationVisibility = args.visibility ?? 'private'
    if (!args.visibility && viewed && candidate) {
      visibility = strictestVisibility(viewed.visibility, candidate.visibility)
    }

    let initiationKind: MatchInitiationKind = 'connector'
    if (viewed && candidate) {
      if (orgPrincipal === viewed.orgPrincipal || orgPrincipal === candidate.orgPrincipal) {
        initiationKind = 'self'
      }
    }

    const id = `urn:smart-agent:match-initiation:${randomUUID()}`
    const now = nowIso()
    const row = {
      id,
      principal: orgPrincipal,
      viewedIntentId: args.viewedIntentId,
      candidateIntentId: args.candidateIntentId,
      initiatorAgentId: orgPrincipal,
      initiationKind,
      proposedAt: now,
      basis: JSON.stringify(args.basis),
      status: 'pending' as const,
      visibility,
      onChainAssertionId: null as string | null,
      createdAt: now,
      updatedAt: now,
    }
    db.insert(matchInitiations).values(row).run()

    if (viewed) bumpAckCountLocal(args.viewedIntentId, 1)
    if (candidate) bumpAckCountLocal(args.candidateIntentId, 1)

    if (initiationKind === 'connector' && viewed && candidate) {
      try {
        dispatchConnectorNotification({
          toOrgPrincipal: viewed.orgPrincipal,
          initiatorAgentId: orgPrincipal,
          viewedIntentId: args.viewedIntentId,
          candidateIntentId: args.candidateIntentId,
          initiationId: id,
        })
      } catch (e) {
        console.warn(`[org-mcp/matchInitiations] viewed-side notif dispatch failed: ${(e as Error).message}`)
      }
      try {
        dispatchConnectorNotification({
          toOrgPrincipal: candidate.orgPrincipal,
          initiatorAgentId: orgPrincipal,
          viewedIntentId: args.viewedIntentId,
          candidateIntentId: args.candidateIntentId,
          initiationId: id,
        })
      } catch (e) {
        console.warn(`[org-mcp/matchInitiations] candidate-side notif dispatch failed: ${(e as Error).message}`)
      }
    }

    if (visibility === 'public' || visibility === 'public-coarse') {
      console.warn(
        `[org-mcp/matchInitiations] on-chain emit deferred to action layer for ${id} (visibility=${visibility}).`,
      )
    }

    return mcpText({
      ok: true as const,
      initiation: {
        id,
        viewedIntentId: row.viewedIntentId,
        candidateIntentId: row.candidateIntentId,
        initiatorAgentId: row.initiatorAgentId,
        initiationKind: row.initiationKind,
        proposedAt: row.proposedAt,
        basis: args.basis,
        status: row.status,
        visibility: row.visibility,
        onChainAssertionId: row.onChainAssertionId ?? undefined,
      },
    })
  },
}

const readTool = {
  name: 'match_initiation:read',
  description: "List the caller's own MatchInitiations (org-mcp). Optional intentId narrows to rows referencing the given intent on either side.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      intentId: { type: 'string' },
      status: { type: 'string' },
    },
    required: ['token'],
  },
  handler: async (args: { token: string; intentId?: string; status?: string }) => {
    const orgPrincipal = await requireOrgPrincipal(args.token, args, 'match_initiation:read')
    const rows = db.select().from(matchInitiations)
      .where(eq(matchInitiations.principal, orgPrincipal))
      .all()
    const filtered = rows.filter((r) => {
      if (args.status && r.status !== args.status) return false
      if (args.intentId && r.viewedIntentId !== args.intentId && r.candidateIntentId !== args.intentId) return false
      return true
    })
    const initiations = filtered.map((r) => ({
      id: r.id,
      viewedIntentId: r.viewedIntentId,
      candidateIntentId: r.candidateIntentId,
      initiatorAgentId: r.initiatorAgentId,
      initiationKind: r.initiationKind as MatchInitiationKind,
      proposedAt: r.proposedAt,
      basis: (() => { try { return JSON.parse(r.basis) as RankBasis } catch { return null as unknown as RankBasis } })(),
      status: r.status as 'pending' | 'superseded' | 'consumed',
      visibility: r.visibility as MatchInitiationVisibility,
      onChainAssertionId: r.onChainAssertionId ?? undefined,
    }))
    return mcpText({ initiations })
  },
}

const supersedeTool = {
  name: 'match_initiation:supersede',
  description: "STUB — downstream specs advance MatchInitiation.status to 'superseded'.",
  inputSchema: {
    type: 'object' as const,
    properties: { token: { type: 'string' }, initiationId: { type: 'string' } },
    required: ['token', 'initiationId'],
  },
  handler: async (args: { token: string; initiationId: string }) => {
    await requireOrgPrincipal(args.token, args, 'match_initiation:supersede')
    console.warn(
      `[org-mcp/matchInitiations] supersede STUB invoked for ${args.initiationId} — body lives downstream.`,
    )
    return mcpText({ ok: false as const, error: { kind: 'not-implemented', message: 'supersede is owned by downstream specs' } })
  },
}

const consumeTool = {
  name: 'match_initiation:consume',
  description: "STUB — downstream commitment spec advances MatchInitiation.status to 'consumed'.",
  inputSchema: {
    type: 'object' as const,
    properties: { token: { type: 'string' }, initiationId: { type: 'string' } },
    required: ['token', 'initiationId'],
  },
  handler: async (args: { token: string; initiationId: string }) => {
    await requireOrgPrincipal(args.token, args, 'match_initiation:consume')
    console.warn(
      `[org-mcp/matchInitiations] consume STUB invoked for ${args.initiationId} — body lives downstream.`,
    )
    return mcpText({ ok: false as const, error: { kind: 'not-implemented', message: 'consume is owned by downstream commitment spec' } })
  },
}

export const matchInitiationsTools = {
  'match_initiation:create': createTool,
  'match_initiation:read': readTool,
  'match_initiation:supersede': supersedeTool,
  'match_initiation:consume': consumeTool,
}
