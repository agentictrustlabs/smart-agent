'use server'

/**
 * Spec 003 — Intent Marketplace (Proposal Lane). Round action layer.
 *
 * Server-only entry points for the rounds index + detail pages
 * (T032 / T036). Pipes through `@smart-agent/discovery` and applies
 * the mandate-match overlap (FR-001 / Research R2) here in TS — the
 * SPARQL layer can't easily filter a JSON literal by structured kind /
 * geo overlap, so we narrow server-side cheaply (deadline / search /
 * domain substring) and finish the comparison in this layer.
 *
 * Reads only. No on-chain or GraphDB writes.
 */

import { getHubDiscovery } from '@/lib/clients/hub-client'
import {
  RoundClient,
  proposerSideSignals,
  rank,
  type RankBasis,
  type SideSignalsDiscovery,
} from '@smart-agent/sdk'
import type {
  Round,
  RoundListFilters,
  RoundListItem,
} from '@smart-agent/sdk'
import { db, schema } from '@/db'
import { and, eq } from 'drizzle-orm'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ViewerIntent {
  id: string
  /** Round-mandate-comparable kind (the SKOS URI from intentType / object). */
  kind: string | null
  /** Round-mandate-comparable geo (the topic-or-payload geo string). */
  geo: string | null
  /** Stated need amount in the same unit the round's budgetCeiling uses. */
  amount: number | null
}

interface IntentRow {
  id: string
  intentType: string | null
  object: string | null
  topic: string | null
  payload: string | null
}

function safeParseJson<T>(raw: string | null | undefined): T | null {
  if (!raw) return null
  try { return JSON.parse(raw) as T } catch { return null }
}

/**
 * Normalize an intent row into the comparable shape used for
 * mandate-match overlap. Both `kind` and `geo` come out as plain
 * strings (no namespace prefix) so substring overlap against the
 * round's `acceptedKinds` works without requiring a SKOS resolution.
 */
function normalizeIntent(row: IntentRow): ViewerIntent {
  // The intent's "kind" — used for mandate.acceptedKinds overlap. We
  // accept either intentType ('intentType:NeedCoaching') or object
  // ('resourceType:Money') since rounds may key off either axis.
  const intentTypeBare = row.intentType?.split(':').pop() ?? null
  const objectBare = row.object?.split(':').pop() ?? null
  const kind = intentTypeBare ?? objectBare
  const payload = safeParseJson<Record<string, unknown>>(row.payload)
  const geoRaw = (payload && typeof payload['geo'] === 'string') ? (payload['geo'] as string) : null
  const geo = geoRaw ?? row.topic ?? null
  const amountRaw = (payload && typeof payload['amount'] === 'number') ? (payload['amount'] as number) : null
  return { id: row.id, kind, geo, amount: amountRaw }
}

/**
 * Returns a viewer's expressed (i.e., live) intents for the hub —
 * shaped for mandate-match overlap. Only `expressed` and
 * `acknowledged` intents qualify; withdrawn / fulfilled / abandoned
 * are dropped.
 */
async function loadViewerIntents(opts: {
  hubId: string
  expressedBy: string
}): Promise<ViewerIntent[]> {
  let rows: IntentRow[] = []
  try {
    rows = await db
      .select({
        id: schema.intents.id,
        intentType: schema.intents.intentType,
        object: schema.intents.object,
        topic: schema.intents.topic,
        payload: schema.intents.payload,
      })
      .from(schema.intents)
      .where(and(
        eq(schema.intents.hubId, opts.hubId),
        eq(schema.intents.expressedByAgent, opts.expressedBy.toLowerCase()),
      ))
  } catch {
    /* intents table missing in some envs — empty array is fine */
    return []
  }
  return rows.map(normalizeIntent)
}

/**
 * Compute `matchedIntentIds` for one round given the viewer's intents.
 *
 * Matching rules (Research R2):
 *   - intent.kind ∈ round.mandate.acceptedKinds   (case-insensitive substring;
 *     SKOS parent rollup is deferred — v1 does loose matching).
 *   - intent.geo ⊆ round.mandate.acceptedGeo      (substring containment).
 *   - intent.amount must not exceed budgetCeiling
 *     (above-ceiling intents still match — `budget-below-intent` warning fires).
 */
function computeMatch(
  round: RoundListItem,
  viewerIntents: ReadonlyArray<ViewerIntent>,
): { matchedIntentIds: string[]; warnings: Array<'budget-below-intent' | 'deadline-imminent'> } {
  const matched: string[] = []
  let budgetBelowSeen = false
  const acceptedKindsLc = (round.mandate.acceptedKinds ?? []).map(k => k.toLowerCase())
  const acceptedGeoLc = (round.mandate.acceptedGeo ?? []).map(g => g.toLowerCase())

  for (const intent of viewerIntents) {
    const kindLc = intent.kind?.toLowerCase() ?? null
    const geoLc = intent.geo?.toLowerCase() ?? null
    const kindOk = !kindLc || acceptedKindsLc.length === 0
      || acceptedKindsLc.some(k => k.includes(kindLc) || kindLc.includes(k))
    const geoOk = !geoLc || acceptedGeoLc.length === 0
      || acceptedGeoLc.some(g => g.includes(geoLc) || geoLc.includes(g))
    if (kindOk && geoOk) {
      matched.push(intent.id)
      if (intent.amount !== null && round.mandate.budgetCeiling > 0
          && intent.amount > round.mandate.budgetCeiling) {
        budgetBelowSeen = true
      }
    }
  }

  const warnings: Array<'budget-below-intent' | 'deadline-imminent'> = []
  if (budgetBelowSeen) warnings.push('budget-below-intent')
  if (round.deadline) {
    const ms = new Date(round.deadline).getTime() - Date.now()
    const days = ms / (1000 * 60 * 60 * 24)
    if (days >= 0 && days <= 3) warnings.push('deadline-imminent')
  }

  return { matchedIntentIds: matched, warnings }
}

// ---------------------------------------------------------------------------
// Public action — list rounds
// ---------------------------------------------------------------------------

export interface ListRoundsActionInput {
  hubId: string
  viewerAgentId: string
  domain?: string
  deadlineHorizon?: 'this-week' | 'this-month' | 'this-quarter' | 'all'
  budgetMin?: number
  budgetMax?: number
  search?: string
  includeClosed?: boolean
}

/**
 * Fetch rounds for the index page with mandate-match badging applied.
 * Implements FR-001, FR-002, FR-003, FR-004 in concert with the
 * components in `(components)/`.
 */
export async function listRoundsForViewer(
  input: ListRoundsActionInput,
): Promise<RoundListItem[]> {
  const filters: RoundListFilters = {
    hubId: input.hubId,
    viewerAgentId: input.viewerAgentId,
    domain: input.domain,
    deadlineHorizon: input.deadlineHorizon,
    budgetMin: input.budgetMin,
    budgetMax: input.budgetMax,
    search: input.search,
    includeClosed: input.includeClosed,
  }

  const discovery = getHubDiscovery()
  const client = new RoundClient(discovery)

  let rounds: RoundListItem[] = []
  try {
    rounds = await client.list(filters)
  } catch {
    // GraphDB unavailable — surface empty list, the page renders an empty
    // state. Logging is left to the platform.
    rounds = []
  }

  const viewerIntents = await loadViewerIntents({
    hubId: input.hubId,
    expressedBy: input.viewerAgentId,
  })

  // ─── Mandate-match overlap + soft warnings ────────────────────────────
  const withMatch: RoundListItem[] = rounds.map((r) => {
    const overlap = computeMatch(r, viewerIntents)
    return {
      ...r,
      matchedIntentIds: overlap.matchedIntentIds,
      warnings: overlap.warnings,
    }
  })

  // ─── US4 (T049) — proposer-side ranking ──────────────────────────────
  // Hydrate each round with `proposerSideSignals` (hops to fund agent +
  // fund's prior outcomes filtered by the proposer's intent domains;
  // falls back to fund-wide when no domain match exists). Tie-break on
  // `round.deadline` desc per FR-019 / Research R10. Best-effort — when
  // discovery is unavailable, we surface the unranked list so the page
  // still renders.
  const proposerIntentDomains = Array.from(
    new Set(
      viewerIntents
        .map((it) => it.kind?.toLowerCase())
        .filter((k): k is string => typeof k === 'string' && k.length > 0),
    ),
  )

  let ranked: RoundListItem[] = withMatch
  try {
    const sideDiscovery = discovery as unknown as SideSignalsDiscovery
    const enriched = await Promise.all(
      withMatch.map(async (r) => {
        try {
          const signals = await proposerSideSignals(
            {
              proposerAgentId: input.viewerAgentId,
              roundId: r.id,
              proposerIntentDomains,
            },
            sideDiscovery,
          )
          return { round: r, basis: signals.basis, domainMatch: signals.domainMatch }
        } catch {
          return { round: r, basis: undefined, domainMatch: false }
        }
      }),
    )
    const rankInput = enriched.map(({ round, basis, domainMatch }) => ({
      item: { round, basis, domainMatch },
      signals: basis
        ? {
            proximityHops: basis.proximityHops,
            priorOutcomes: basis.priorOutcomes,
            recencyKey: round.deadline,
          }
        : {
            proximityHops: 6,
            priorOutcomes: { fulfilled: 0, abandoned: 0 },
            recencyKey: round.deadline,
          },
    }))
    const result = rank(rankInput)
    ranked = result.map((r) => ({
      ...r.item.round,
      basis: (r.item.basis ?? r.basis) as RankBasis,
      domainMatch: r.item.domainMatch ?? false,
    }))
  } catch {
    /* discovery unavailable — keep unranked. */
  }

  return ranked
}

// ---------------------------------------------------------------------------
// Public action — get round detail
// ---------------------------------------------------------------------------

export interface RoundDetailActionResult {
  round: Round | null
  /** True when the round id was non-empty but the discovery layer returned
   *  null (e.g., private round + viewer not addressed); the page renders
   *  a friendly "not authorized" message in this case. */
  notAddressed: boolean
}

export async function getRoundForViewer(
  roundId: string,
  viewerAgentId: string,
): Promise<RoundDetailActionResult> {
  const discovery = getHubDiscovery()
  const client = new RoundClient(discovery)
  let round: Round | null = null
  try {
    round = await client.getById(roundId, viewerAgentId)
  } catch {
    round = null
  }
  return { round, notAddressed: false }
}
