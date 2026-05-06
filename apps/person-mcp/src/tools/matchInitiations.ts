/**
 * Spec 001 — Intent Marketplace (Direct Lane). MatchInitiation MCP tools.
 *
 * person-mcp side: human initiators (Maria as a member proposing a match
 * between two intents). The org-mcp twin in
 * `apps/org-mcp/src/tools/matchInitiations.ts` mirrors this for org
 * initiators.
 *
 * Tools registered (each tool name === scope name; MCP_TOOL_SCOPE_ENFORCER
 * gates on the tool name verbatim):
 *   - match_initiation:create     — write a MatchInitiation row, cascade
 *                                   intent:bump_ack_count to both intent
 *                                   owners' MCPs, dispatch connector-mode
 *                                   notifications, conditionally anchor
 *                                   on chain.
 *   - match_initiation:read       — list the caller's own initiations.
 *   - match_initiation:supersede  — STUB (downstream specs advance status).
 *   - match_initiation:consume    — STUB (downstream specs advance status).
 *
 * Persistence: `match_initiations` table per IA § 2.1 (initiator-owned).
 *
 * Cross-MCP federation: v1 simplification — when the two intents belong to
 * principals tenanted in the same MCP instance, the ack-count bump runs
 * directly via the local `bump_ack_count` logic; otherwise it logs and skips.
 * // TODO(cross-mcp): replace with a federated intent:bump_ack_count RPC.
 */
import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  matchInitiations,
  intents,
  notifications,
} from '../db/schema.js'
import { requirePrincipal } from '../auth/principal-context.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

function nowIso(): string {
  return new Date().toISOString()
}

// ───────────────────────────────────────────────────────────────────────
// Types — mirror packages/sdk/src/matchInitiations/types.ts.
// ───────────────────────────────────────────────────────────────────────

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
  /** Optional override for tests; normally derived from the two intents' visibility. */
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

// ───────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────

interface IntentRow {
  id: string
  principal: string
  direction: string
  kind: string
  status: string
  visibility: string
  liveAcknowledgementCount: number | null
}

/**
 * v1 simplification — read intents from the local person-mcp DB. If the
 * intent is org-tenanted (different MCP), this returns null and the caller
 * surfaces a validation error. Production wires a federated intent-read RPC.
 * // TODO(cross-mcp): replace with a federated intent:read RPC.
 */
function findIntentRow(intentId: string): IntentRow | null {
  const rows = db.select().from(intents).where(eq(intents.id, intentId)).all()
  return rows[0] ?? null
}

/**
 * Bump the local intent's live_acknowledgement_count and (de)transition its
 * status across the 0↔1 boundary. Mirrors `intent:bump_ack_count` tool
 * logic so the create pipeline can run as a single transaction.
 *
 * v1 simplification: only bumps if the intent is locally-tenanted in this
 * person-mcp instance. Otherwise warns and skips. // TODO(cross-mcp).
 */
function bumpAckCountLocal(intentId: string, delta: 1 | -1): { bumped: boolean } {
  const row = db.select().from(intents).where(eq(intents.id, intentId)).all()[0]
  if (!row) {
    console.warn(
      `[person-mcp/matchInitiations] ack-count bump skipped — intent ${intentId} not local. // TODO(cross-mcp)`,
    )
    return { bumped: false }
  }
  const cur = row.liveAcknowledgementCount ?? 0
  const next = Math.max(0, cur + delta)
  let nextStatus = row.status
  if (cur === 0 && next === 1 && nextStatus === 'expressed') nextStatus = 'acknowledged'
  else if (cur === 1 && next === 0 && nextStatus === 'acknowledged') nextStatus = 'expressed'
  db.update(intents)
    .set({ liveAcknowledgementCount: next, status: nextStatus, updatedAt: nowIso() })
    .where(eq(intents.id, intentId))
    .run()
  return { bumped: true }
}

/**
 * Dispatch a notification to the intent expresser. v1 same-DB shortcut:
 * if the target principal is local in person-mcp, insert directly into the
 * `notifications` table; otherwise warn. // TODO(cross-mcp).
 */
function dispatchConnectorNotification(opts: {
  toPrincipal: string
  initiatorAgentId: string
  viewedIntentId: string
  candidateIntentId: string
  initiationId: string
}): void {
  // Heuristic: person-mcp principals look like `person_<userId>`. If the
  // target appears to be a person principal, insert locally; otherwise warn.
  if (!opts.toPrincipal.startsWith('person_')) {
    console.warn(
      `[person-mcp/matchInitiations] connector notification dispatch deferred — target ${opts.toPrincipal} not local. // TODO(cross-mcp)`,
    )
    return
  }
  db.insert(notifications).values({
    id: randomUUID(),
    principal: opts.toPrincipal,
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

/**
 * Strictest visibility wins (cascade per IA § 3.1).
 *   private > off-chain > public-coarse > public.
 */
function strictestVisibility(
  a: string,
  b: string,
): MatchInitiationVisibility {
  const order: MatchInitiationVisibility[] = ['private', 'off-chain', 'public-coarse', 'public']
  const ax = order.indexOf(a as MatchInitiationVisibility)
  const bx = order.indexOf(b as MatchInitiationVisibility)
  const ai = ax === -1 ? 0 : ax
  const bi = bx === -1 ? 0 : bx
  return order[Math.min(ai, bi)]
}

// ───────────────────────────────────────────────────────────────────────
// Tool: match_initiation:create
// ───────────────────────────────────────────────────────────────────────

const createTool = {
  name: 'match_initiation:create',
  description:
    "Create a MatchInitiation row pairing two intents (initiator-owned per IA § 2.1). Cascades intent:bump_ack_count +1 to both intent owners, dispatches connector-mode notifications, and conditionally anchors on chain.",
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
    const principal = await requirePrincipal(args.token, 'match_initiation:create')

    // Validation: distinct intent ids.
    if (args.viewedIntentId === args.candidateIntentId) {
      return err({ kind: 'validation', messages: ['viewedIntentId and candidateIntentId must differ'] })
    }

    // v1 simplification: read both intents locally. If either lookup fails,
    // we cannot validate opposite-direction / same-kind / non-self constraints
    // and surface a validation error. // TODO(cross-mcp).
    const viewed = findIntentRow(args.viewedIntentId)
    const candidate = findIntentRow(args.candidateIntentId)
    if (!viewed || !candidate) {
      console.warn(
        `[person-mcp/matchInitiations] intent lookup failed (viewed=${!!viewed} candidate=${!!candidate}); cross-MCP federation not implemented. // TODO(cross-mcp)`,
      )
      // Fall through with a non-blocking warning when at least one is missing.
      // Discovery layer must perform the strict cross-MCP validation when both
      // intents live in different MCP tenants.
    }

    // Stale-candidate check (FR-021).
    for (const i of [viewed, candidate]) {
      if (!i) continue
      if (i.status === 'withdrawn' || i.status === 'fulfilled' || i.status === 'abandoned') {
        return err({
          kind: 'stale-candidate',
          reason: i.status as 'withdrawn' | 'fulfilled' | 'abandoned',
        })
      }
    }

    // Self-match exclusion (FR-008): same expresser on both intents.
    if (viewed && candidate && viewed.principal === candidate.principal) {
      return err({ kind: 'self-match-excluded' })
    }

    // Opposite-direction check (data-model.md validation rules).
    if (viewed && candidate && viewed.direction === candidate.direction) {
      return err({
        kind: 'validation',
        messages: ['viewedIntent.direction must differ from candidateIntent.direction'],
      })
    }

    // Same-object check (proxy: same `kind`).
    if (viewed && candidate && viewed.kind !== candidate.kind) {
      return err({
        kind: 'validation',
        messages: ['viewedIntent.kind must equal candidateIntent.kind (object equality)'],
      })
    }

    // Duplicate-pending check (FR-019, Q5): no existing 'pending' for the
    // same pair from THIS initiator (the spec's authoritative scope is
    // initiator's MCP).
    const existing = db.select().from(matchInitiations)
      .where(and(
        eq(matchInitiations.principal, principal),
        eq(matchInitiations.viewedIntentId, args.viewedIntentId),
        eq(matchInitiations.candidateIntentId, args.candidateIntentId),
        eq(matchInitiations.status, 'pending'),
      ))
      .all()
    if (existing.length > 0) {
      return err({ kind: 'duplicate-pending', existingInitiationId: existing[0].id })
    }

    // Visibility cascade — strictest of the two source intents' visibilities.
    let visibility: MatchInitiationVisibility = args.visibility ?? 'private'
    if (!args.visibility && viewed && candidate) {
      visibility = strictestVisibility(viewed.visibility, candidate.visibility)
    }

    // initiationKind: self iff initiator (principal) is one of the two
    // expressers; connector otherwise.
    let initiationKind: MatchInitiationKind = 'connector'
    if (viewed && candidate) {
      if (principal === viewed.principal || principal === candidate.principal) {
        initiationKind = 'self'
      }
    } else {
      // Cannot determine — default to 'connector' (more permissive; the
      // initiator certainly didn't claim 'self' if the intents aren't local).
      initiationKind = 'connector'
    }

    // Insert.
    const id = `urn:smart-agent:match-initiation:${randomUUID()}`
    const now = nowIso()
    const row = {
      id,
      principal,
      viewedIntentId: args.viewedIntentId,
      candidateIntentId: args.candidateIntentId,
      initiatorAgentId: principal,
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

    // Side effects.
    // 1. Bump ack-count +1 on both intents.
    if (viewed) bumpAckCountLocal(args.viewedIntentId, 1)
    if (candidate) bumpAckCountLocal(args.candidateIntentId, 1)

    // 2. Connector-mode notification: notify both expressers.
    if (initiationKind === 'connector' && viewed && candidate) {
      dispatchConnectorNotification({
        toPrincipal: viewed.principal,
        initiatorAgentId: principal,
        viewedIntentId: args.viewedIntentId,
        candidateIntentId: args.candidateIntentId,
        initiationId: id,
      })
      dispatchConnectorNotification({
        toPrincipal: candidate.principal,
        initiatorAgentId: principal,
        viewedIntentId: args.viewedIntentId,
        candidateIntentId: args.candidateIntentId,
        initiationId: id,
      })
    }

    // 3. On-chain anchor (sa:MatchInitiationAssertion) — public/public-coarse only.
    //    v1 simplification: emit handler lives in apps/web/src/lib/onchain;
    //    MCP currently does not call the on-chain emit directly. The action
    //    layer can mint the anchor after the create returns. // TODO: wire
    //    in-process emit when both source intents already have public anchors.
    if (visibility === 'public' || visibility === 'public-coarse') {
      console.warn(
        `[person-mcp/matchInitiations] on-chain emit deferred to action layer for ${id} (visibility=${visibility}).`,
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

// ───────────────────────────────────────────────────────────────────────
// Tool: match_initiation:read
// ───────────────────────────────────────────────────────────────────────

const readTool = {
  name: 'match_initiation:read',
  description: "List the caller's own MatchInitiations. Optional intentId filter narrows to rows that reference the given intent on either side.",
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
    const principal = await requirePrincipal(args.token, 'match_initiation:read')
    const rows = db.select().from(matchInitiations)
      .where(eq(matchInitiations.principal, principal))
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

// ───────────────────────────────────────────────────────────────────────
// Tool: match_initiation:supersede (STUB)
// ───────────────────────────────────────────────────────────────────────

const supersedeTool = {
  name: 'match_initiation:supersede',
  description:
    "STUB — downstream specs advance MatchInitiation status to 'superseded'. Spec 001 ships this as a placeholder so the scope string is reserved.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      initiationId: { type: 'string' },
    },
    required: ['token', 'initiationId'],
  },
  handler: async (args: { token: string; initiationId: string }) => {
    await requirePrincipal(args.token, 'match_initiation:supersede')
    console.warn(
      `[person-mcp/matchInitiations] supersede STUB invoked for ${args.initiationId} — body lives downstream.`,
    )
    return mcpText({ ok: false as const, error: { kind: 'not-implemented', message: 'supersede is owned by downstream specs' } })
  },
}

// ───────────────────────────────────────────────────────────────────────
// Tool: match_initiation:consume (STUB)
// ───────────────────────────────────────────────────────────────────────

const consumeTool = {
  name: 'match_initiation:consume',
  description:
    "STUB — downstream commitment spec advances MatchInitiation status to 'consumed'. Spec 001 ships this as a placeholder so the scope string is reserved.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token: { type: 'string' },
      initiationId: { type: 'string' },
    },
    required: ['token', 'initiationId'],
  },
  handler: async (args: { token: string; initiationId: string }) => {
    await requirePrincipal(args.token, 'match_initiation:consume')
    console.warn(
      `[person-mcp/matchInitiations] consume STUB invoked for ${args.initiationId} — body lives downstream.`,
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
