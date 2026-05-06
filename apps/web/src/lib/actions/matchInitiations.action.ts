'use server'

/**
 * Spec 001 — Intent Marketplace (Direct Lane). MatchInitiation action layer.
 *
 * Server-only entry points used by the candidates section + propose-match
 * route. Wraps the initiator's MCP `match_initiation:create` tool via the
 * standard `callMcp(...)` plumbing. Mirrors the style of
 * `grantProposals.action.ts`.
 *
 * v1 simplifications:
 *   - The MCP tool routing defaults to the person-mcp (Maria is the canonical
 *     test user). Org-tenant initiators route to org-mcp via `proposerKind`.
 *     // TODO(person-mcp routing): once the user has multiple agent contexts,
 *     surface the routing choice in the UI.
 *   - On-chain emit of `sa:MatchInitiationAssertion` happens here AFTER the
 *     MCP returns ok — only for public/public-coarse visibility (cascade per
 *     IA § 3.1). Private / off-chain rows stay MCP-only.
 *   - Cross-MCP federation for the `intent:bump_ack_count` fan-out is the
 *     same-DB shortcut inside the MCP tool; this action layer does not
 *     re-issue the bumps.
 */

import { DiscoveryService } from '@smart-agent/discovery'
import {
  MatchInitiationClient,
  computeBasis,
  rank,
  rankCue,
  type ProposeMatchRequest,
  type ProposeMatchResult,
  type MatchInitiation,
  type McpInvoker,
  type McpTarget,
  type RankBasis,
  type Rankable,
} from '@smart-agent/sdk'
import { db, schema } from '@/db'
import { and, desc, eq, ne, inArray } from 'drizzle-orm'
import { callMcp } from '@/lib/clients/mcp-client'
import { emitMatchInitiationAssertion } from '@/lib/onchain/matchInitiationAssertion'
import type { IntentRow } from './intents.action'

// ───────────────────────────────────────────────────────────────────────
// MCP invoker shim — same DI pattern as grantProposals.action.ts.
// ───────────────────────────────────────────────────────────────────────

function makeMcpInvoker(target: McpTarget, kind: 'person' | 'org'): McpInvoker {
  return {
    async call<T = unknown>(
      _t: McpTarget,
      tool: string,
      args: Record<string, unknown>,
    ): Promise<T> {
      void _t
      const server = target === 'fund' ? 'org' : kind
      return callMcp<T>(server as 'org' | 'person', tool, args)
    },
  }
}

// ───────────────────────────────────────────────────────────────────────
// Propose-match action (US4, FR-017–FR-021)
// ───────────────────────────────────────────────────────────────────────

export interface ProposeMatchActionInput {
  request: ProposeMatchRequest
  /** Routes to person-mcp by default (Maria's lane). */
  initiatorKind?: 'person' | 'org'
}

/**
 * Propose a match. v1 flow:
 *   1. Validates request shape locally (defensive — the MCP tool re-checks).
 *   2. Calls the initiator's MCP `match_initiation:create` tool via callMcp.
 *   3. On success, conditionally mints `sa:MatchInitiationAssertion` on chain
 *      (public/public-coarse only; cascade per IA § 3.1).
 *   4. Returns the typed `ProposeMatchResult` to the route handler.
 */
export async function proposeMatch(
  input: ProposeMatchActionInput,
): Promise<ProposeMatchResult> {
  const kind = input.initiatorKind ?? 'person'
  const invoker = makeMcpInvoker('self', kind)
  const client = new MatchInitiationClient(invoker)

  // Defensive shape validation.
  if (!input.request.viewedIntentId || !input.request.candidateIntentId) {
    return { ok: false, error: { kind: 'validation', messages: ['viewedIntentId and candidateIntentId are required'] } }
  }
  if (input.request.viewedIntentId === input.request.candidateIntentId) {
    return { ok: false, error: { kind: 'validation', messages: ['viewedIntentId and candidateIntentId must differ'] } }
  }

  let result: ProposeMatchResult
  try {
    result = await client.propose(input.request)
  } catch (err) {
    return {
      ok: false,
      error: {
        kind: 'validation',
        messages: [err instanceof Error ? err.message : 'MCP propose-match call failed'],
      },
    }
  }

  // Conditional on-chain emit — only for public/public-coarse rows.
  if (result.ok) {
    const initiation = result.initiation
    if (initiation.visibility === 'public' || initiation.visibility === 'public-coarse') {
      try {
        const assertionId = await emitMatchInitiationAssertion({
          id: initiation.id,
          viewedIntentId: initiation.viewedIntentId,
          candidateIntentId: initiation.candidateIntentId,
          initiatorAgentId: initiation.initiatorAgentId,
          initiationKind: initiation.initiationKind,
          proposedAt: initiation.proposedAt,
          basis: initiation.basis,
          status: initiation.status,
          visibility: initiation.visibility,
        })
        if (assertionId) {
          // Stitch the on-chain id back onto the result for the UI.
          result = {
            ok: true,
            initiation: { ...initiation, onChainAssertionId: assertionId },
          }
        }
      } catch (err) {
        // On-chain emit failure is non-fatal for v1 (the MCP row is the
        // authoritative copy). Log and continue.
        console.warn(
          '[matchInitiations.action] on-chain emit failed:',
          err instanceof Error ? err.message : err,
        )
      }
    }
  }

  return result
}

// ───────────────────────────────────────────────────────────────────────
// Read actions
// ───────────────────────────────────────────────────────────────────────

export interface ListMyInitiationsResult {
  initiations: MatchInitiation[]
}

export async function listMyInitiations(
  initiatorKind: 'person' | 'org' = 'person',
): Promise<ListMyInitiationsResult> {
  const invoker = makeMcpInvoker('self', initiatorKind)
  const client = new MatchInitiationClient(invoker)
  try {
    const initiations = await client.listForMember('')
    return { initiations }
  } catch {
    return { initiations: [] }
  }
}

export async function getInitiationById(
  id: string,
  initiatorKind: 'person' | 'org' = 'person',
): Promise<MatchInitiation | null> {
  const invoker = makeMcpInvoker('self', initiatorKind)
  const client = new MatchInitiationClient(invoker)
  try {
    return await client.getById(id)
  } catch {
    return null
  }
}

/**
 * List the caller's own initiations referencing `intentId`. Used for the
 * FR-019 "view existing match" affordance to detect a duplicate-pending
 * BEFORE the user clicks (so the button can render disabled).
 */
export async function listMyInitiationsForIntent(
  intentId: string,
  initiatorKind: 'person' | 'org' = 'person',
): Promise<MatchInitiation[]> {
  const invoker = makeMcpInvoker('self', initiatorKind)
  const client = new MatchInitiationClient(invoker)
  try {
    return await client.listForIntent(intentId, { status: 'pending' })
  } catch {
    return []
  }
}

// ───────────────────────────────────────────────────────────────────────
// Public mirror — surface FR-019 cross-pair active initiation check.
// ───────────────────────────────────────────────────────────────────────

export async function listPublicActiveInitiationsForIntent(
  intentId: string,
): Promise<Array<{ id: string; viewedIntentId: string; candidateIntentId: string; status: string }>> {
  try {
    const discovery = DiscoveryService.fromEnv()
    const rows = await discovery.listActiveInitiationsForIntent(intentId)
    return rows.map((r) => ({
      id: r.id,
      viewedIntentId: r.viewedIntentId,
      candidateIntentId: r.candidateIntentId,
      status: r.status,
    }))
  } catch {
    return []
  }
}

// ───────────────────────────────────────────────────────────────────────
// Candidates surface (US2 + US3) — sources from local web SQLite for v1
// demo data. Production callers can layer in DiscoveryService.listCandidatesForIntent
// to federate against the public mirror.
// ───────────────────────────────────────────────────────────────────────

interface RawIntentRow {
  id: string
  direction: 'receive' | 'give'
  object: string
  topic: string | null
  intentType: string
  intentTypeLabel: string
  expressedByAgent: string
  expressedByUserId: string | null
  addressedTo: string
  hubId: string
  title: string
  detail: string | null
  payload: string | null
  status: 'drafted' | 'expressed' | 'acknowledged' | 'in-progress' | 'fulfilled' | 'withdrawn' | 'abandoned'
  priority: 'critical' | 'high' | 'normal' | 'low'
  visibility: 'public' | 'public-coarse' | 'private' | 'off-chain'
  expectedOutcome: string | null
  projectionRef: string | null
  validUntil: string | null
  createdAt: string
  updatedAt: string
}

function rowToIntentRow(r: RawIntentRow): IntentRow {
  return {
    id: r.id,
    direction: r.direction,
    object: r.object,
    topic: r.topic,
    intentType: r.intentType,
    intentTypeLabel: r.intentTypeLabel,
    expressedByAgent: r.expressedByAgent,
    expressedByUserId: r.expressedByUserId,
    addressedTo: r.addressedTo,
    hubId: r.hubId,
    title: r.title,
    detail: r.detail,
    payload: (() => {
      if (!r.payload) return null
      try { return JSON.parse(r.payload) as IntentRow['payload'] } catch { return null }
    })(),
    status: r.status,
    priority: r.priority,
    visibility: r.visibility,
    expectedOutcome: (() => {
      if (!r.expectedOutcome) return null
      try { return JSON.parse(r.expectedOutcome) as IntentRow['expectedOutcome'] } catch { return null }
    })(),
    projectionRef: r.projectionRef,
    validUntil: r.validUntil,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

export interface CandidateRowForUI {
  intent: IntentRow
  basis: RankBasis
  cue: string
  /** True iff a pending MatchInitiation already exists for this pair from this viewer. */
  alreadyPaired: boolean
}

/**
 * Compute ranked candidates for the viewed intent. Returns intents in the
 * *opposite direction* on the *same object*, excluding self-matches and
 * withdrawn/abandoned/fulfilled candidates. Each candidate carries a
 * RankBasis snapshot (for the propose-match basis) and a one-line rank cue.
 *
 * v1 simplifications (with TODO markers):
 *   - Reads candidates from the web SQLite `intents` table — the local
 *     authoritative source for demo data. Production wires
 *     `DiscoveryService.listCandidatesForIntent` for the federated path.
 *     // TODO(production-discovery)
 *   - Prior outcomes are placeholders (0/0 = cold-start); real outcome data
 *     ships with downstream specs (validation/award).
 *     // TODO(prior-outcomes)
 *   - Sensitive (private) candidate filter (FR-011) drops non-public rows
 *     when the viewer is not the addressee. v1 conservative gate; the
 *     credentialed-agent rule lands when AnonCreds verification arrives.
 *     // TODO(anoncreds-credentialed-agent-gate)
 */
export async function listCandidatesForIntent(input: {
  viewedIntentId: string
  viewerAgentAddress?: string
}): Promise<CandidateRowForUI[]> {
  // Load the viewed intent.
  let viewedRaw: RawIntentRow | undefined
  try {
    viewedRaw = await db.select().from(schema.intents)
      .where(eq(schema.intents.id, input.viewedIntentId))
      .get() as unknown as RawIntentRow | undefined
  } catch {
    return []
  }
  if (!viewedRaw) return []
  if (viewedRaw.status === 'withdrawn' || viewedRaw.status === 'abandoned' || viewedRaw.status === 'fulfilled') {
    // FR-007: only expressed/acknowledged intents surface candidates. The page
    // still calls in for these; we return [] and the section renders nothing.
    return []
  }

  const oppositeDirection = viewedRaw.direction === 'receive' ? 'give' : 'receive'

  // Pull all opposite-direction same-object intents in any non-terminal state
  // (we exclude terminal states explicitly per FR-009).
  let candidatesRaw: RawIntentRow[] = []
  try {
    candidatesRaw = await db.select().from(schema.intents)
      .where(and(
        eq(schema.intents.hubId, viewedRaw.hubId),
        eq(schema.intents.direction, oppositeDirection),
        eq(schema.intents.object, viewedRaw.object),
        ne(schema.intents.expressedByAgent, viewedRaw.expressedByAgent.toLowerCase()),
      ))
      .orderBy(desc(schema.intents.updatedAt))
      .limit(50)
      .all() as unknown as RawIntentRow[]
  } catch {
    return []
  }

  // FR-009: drop terminal-state candidates.
  const filtered = candidatesRaw.filter((c) =>
    c.status !== 'withdrawn' && c.status !== 'abandoned' && c.status !== 'fulfilled',
  )

  // FR-011 (conservative gate): drop non-public candidates unless viewer is
  // the addressee. Credentialed-agent rule deferred. // TODO(anoncreds).
  const viewerLc = (input.viewerAgentAddress ?? '').toLowerCase()
  const visible = filtered.filter((c) => {
    if (c.visibility === 'public' || c.visibility === 'public-coarse') return true
    // Private / off-chain: only addressee can see.
    if (c.addressedTo === `agent:${viewerLc}` && viewerLc) return true
    return false
  })

  if (visible.length === 0) return []

  // Hop-distance hydration via DiscoveryService when available.
  let hopMap = new Map<string, number>()
  if (input.viewerAgentAddress) {
    try {
      const discovery = DiscoveryService.fromEnv()
      const results = await Promise.all(
        visible.map(async (c) => {
          try {
            const hops = await discovery.getHopDistance(input.viewerAgentAddress!, c.expressedByAgent)
            return [c.expressedByAgent.toLowerCase(), hops ?? 6] as const
          } catch {
            return [c.expressedByAgent.toLowerCase(), 6] as const
          }
        }),
      )
      hopMap = new Map(results)
    } catch {
      // Discovery unavailable — leave hopMap empty; cold-start basis below.
    }
  }

  // Detect already-paired candidates (FR-019). v1: same-DB lookup of the
  // initiator's own pending initiations referencing the viewed intent. The
  // public mirror check covers cross-initiator pairs (FR-019, AC#2).
  let myPendingPairs = new Set<string>()
  try {
    const myInitiations = await listMyInitiationsForIntent(input.viewedIntentId, 'person')
    myPendingPairs = new Set(
      myInitiations
        .filter((i) => i.status === 'pending')
        .map((i) =>
          i.viewedIntentId === input.viewedIntentId ? i.candidateIntentId : i.viewedIntentId,
        ),
    )
  } catch {
    // Same-DB MCP call failed — degrade gracefully.
  }

  // Compose Rankables and sort via the SDK matchmaker.
  const rankables: Array<Rankable<RawIntentRow>> = visible.map((c) => ({
    item: c,
    signals: {
      proximityHops: hopMap.get(c.expressedByAgent.toLowerCase()) ?? 6,
      // v1 cold-start: priorOutcomes hydrate to (0, 0) — Laplace smoothing
      // yields outcomeScore = 0.5 with isColdStart = true.
      priorOutcomes: { fulfilled: 0, abandoned: 0 },
      recencyKey: c.updatedAt,
    },
  }))
  const ranked = rank(rankables)

  return ranked.map((r) => ({
    intent: rowToIntentRow(r.item),
    basis: r.basis,
    cue: rankCue(r.basis),
    alreadyPaired: myPendingPairs.has(r.item.id),
  }))
}

/**
 * Used by the discover surface to show the top candidates for each of the
 * viewer's expressed intents. Returns up to `topPerIntent` ranked candidates
 * for each input intent id. Empty arrays when no candidates exist.
 */
export async function listTopCandidatesForViewer(input: {
  viewerAgentAddress: string
  intentIds: string[]
  topPerIntent?: number
}): Promise<Array<{ viewedIntentId: string; candidates: CandidateRowForUI[] }>> {
  const top = Math.max(1, input.topPerIntent ?? 2)
  const out: Array<{ viewedIntentId: string; candidates: CandidateRowForUI[] }> = []
  for (const intentId of input.intentIds) {
    const cands = await listCandidatesForIntent({
      viewedIntentId: intentId,
      viewerAgentAddress: input.viewerAgentAddress,
    })
    out.push({ viewedIntentId: intentId, candidates: cands.slice(0, top) })
  }
  return out
}

// Avoid unused-import warning for `inArray` (kept for forward use).
void inArray

// ───────────────────────────────────────────────────────────────────────
// Basis snapshot helper — wraps `computeBasis` from the SDK.
// Exposed for the route / button to recompute the basis just before submit
// to avoid stale signals when the candidate set was loaded a long time ago.
// ───────────────────────────────────────────────────────────────────────

export async function basisFromSignals(input: {
  proximityHops: number
  fulfilled: number
  abandoned: number
}): Promise<RankBasis> {
  return computeBasis({
    proximityHops: input.proximityHops,
    priorOutcomes: { fulfilled: input.fulfilled, abandoned: input.abandoned },
  })
}
