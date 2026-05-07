'use server'

/**
 * Discover server actions — the heart of the Need ↔ Resource bridge.
 *
 *   runDiscoverMatch(needId)   — score every available offering against
 *                                a need; persist top matches; return them
 *   acceptMatch(matchId)       — promote to 'accepted'; mint a
 *                                RoleAssignment if the match has a
 *                                requiresRole satisfied; emit a
 *                                relationship_proposed message to the
 *                                matched agent
 *   rejectMatch(matchId)       — promote to 'rejected'; never re-surface
 *
 * The scorer used here is a thin wrapper. The full implementation with
 * trust-graph proximity, AnonCred verification, and per-requirement
 * weighting lives in `packages/privacy-creds/src/match-overlap.ts`
 * (N7) — once that lands, we swap the call.
 */

import { randomUUID } from 'crypto'
import { db, schema } from '@/db'
import { and, eq, desc, inArray } from 'drizzle-orm'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { scoreOfferingAgainstNeed, type ScoredMatch } from '@/lib/discover/scorer'
import {
  getNeed, getOffering, listOfferings,
  type NeedRow, type OfferingRow,
} from './needs.action'

export interface MatchRow {
  id: string
  needId: string
  offeringId: string
  matchedAgent: string
  status: 'proposed' | 'accepted' | 'rejected' | 'stale' | 'fulfilled'
  score: number
  scorePct: number
  reason: string
  satisfies: string[]
  misses: string[]
  generatedByActivity: string | null
  createdAt: string
  updatedAt: string
  // Hydrated convenience fields:
  need?: NeedRow
  offering?: OfferingRow
}

function rowToMatch(r: typeof schema.needResourceMatches.$inferSelect): MatchRow {
  return {
    id: r.id,
    needId: r.needId,
    offeringId: r.offeringId,
    matchedAgent: r.matchedAgent,
    status: r.status,
    score: r.score,
    scorePct: Math.round(r.score / 100),
    reason: r.reason,
    satisfies: r.satisfies ? safeJsonParse<string[]>(r.satisfies) ?? [] : [],
    misses: r.misses ? safeJsonParse<string[]>(r.misses) ?? [] : [],
    generatedByActivity: r.generatedByActivity,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

function safeJsonParse<T = unknown>(s: string): T | null {
  try { return JSON.parse(s) as T } catch { return null }
}

// ─── Run match ──────────────────────────────────────────────────────

const MIN_SCORE_TO_PERSIST = 2000   // <20% never surfaced
const MIN_SCORE_DEFAULT_LIST = 4000 // <40% not in default ranked list

/**
 * Score every available offering in the same hub against the need;
 * persist the top results above MIN_SCORE_TO_PERSIST; return them.
 *
 * Idempotent: re-running for the same need updates existing match
 * rows in place (keyed on needId+offeringId) and adds new ones.
 */
export async function runDiscoverMatch(needId: string): Promise<{ matches: MatchRow[] } | { error: string }> {
  const need = await getNeed(needId)
  if (!need) return { error: 'need-not-found' }
  if (need.status !== 'open' && need.status !== 'in-progress') {
    return { matches: [] }
  }

  // Pull candidate offerings: same hub, available status. The scorer
  // weeds out type-mismatches (e.g. "needs coach" should not match a
  // "money" offering) via the requirement check.
  const offerings = await listOfferings({ hubId: need.hubId, status: 'available', limit: 200 })
  if (offerings.length === 0) return { matches: [] }

  const scored: ScoredMatch[] = []
  for (const offering of offerings) {
    const result = await scoreOfferingAgainstNeed({ need, offering })
    if (result.score < MIN_SCORE_TO_PERSIST) continue
    scored.push(result)
  }

  // Sort by score desc; persist top N (N=20 — discover is a recommendation,
  // not exhaustive).
  scored.sort((a, b) => b.score - a.score)
  const top = scored.slice(0, 20)

  const now = new Date().toISOString()
  const persisted: MatchRow[] = []
  for (const s of top) {
    // Upsert by (needId, offeringId).
    let existing: any = undefined
    try { existing = db.select().from(schema.needResourceMatches)
      .where(and(
        eq(schema.needResourceMatches.needId, needId),
        eq(schema.needResourceMatches.offeringId, s.offering.id),
      ))
      .get() } catch { /* needResourceMatches table dropped */ }
    if (existing) {
      // Only re-score; never overwrite an accept/reject decision.
      if (existing.status === 'proposed' || existing.status === 'stale') {
        try { db.update(schema.needResourceMatches)
          .set({
            score: s.score,
            reason: s.reason,
            satisfies: JSON.stringify(s.satisfies),
            misses: JSON.stringify(s.misses),
            updatedAt: now,
          })
          .where(eq(schema.needResourceMatches.id, existing.id))
          .run() } catch { /* needResourceMatches table dropped */ }
        let reread: any = undefined
        try { reread = db.select().from(schema.needResourceMatches)
          .where(eq(schema.needResourceMatches.id, existing.id)).get() } catch { /* needResourceMatches table dropped */ }
        if (reread) persisted.push(rowToMatch(reread))
      } else {
        persisted.push(rowToMatch(existing))
      }
    } else {
      const id = randomUUID()
      try { db.insert(schema.needResourceMatches).values({
        id,
        needId,
        offeringId: s.offering.id,
        matchedAgent: s.offering.offeredByAgent,
        status: 'proposed',
        score: s.score,
        reason: s.reason,
        satisfies: JSON.stringify(s.satisfies),
        misses: JSON.stringify(s.misses),
        generatedByActivity: null,
        createdAt: now,
        updatedAt: now,
      }).run() } catch { /* needResourceMatches table dropped */ }
      let reread: any = undefined
      try { reread = db.select().from(schema.needResourceMatches)
        .where(eq(schema.needResourceMatches.id, id)).get() } catch { /* needResourceMatches table dropped */ }
      if (reread) persisted.push(rowToMatch(reread))
    }
  }

  return { matches: persisted }
}

/** Run match against every open need in the hub. Used by the Discover page. */
export async function runDiscoverMatchForHub(hubId: string): Promise<{ count: number; runs: number }> {
  let opens: any[] = []
  try { opens = await db.select().from(schema.needs)
    .where(and(eq(schema.needs.hubId, hubId), eq(schema.needs.status, 'open')))
    .limit(50) } catch { /* needs table dropped */ }
  let count = 0
  for (const n of opens) {
    const r = await runDiscoverMatch(n.id)
    if ('matches' in r) count += r.matches.length
  }
  return { count, runs: opens.length }
}

// ─── List matches ───────────────────────────────────────────────────

export interface ListMatchesOptions {
  needId?: string
  matchedAgent?: string
  status?: MatchRow['status']
  minScore?: number
  hydrate?: boolean
  limit?: number
}

export async function listMatches(opts: ListMatchesOptions = {}): Promise<MatchRow[]> {
  const filters = []
  if (opts.needId) filters.push(eq(schema.needResourceMatches.needId, opts.needId))
  if (opts.matchedAgent) filters.push(eq(schema.needResourceMatches.matchedAgent, opts.matchedAgent.toLowerCase()))
  if (opts.status) filters.push(eq(schema.needResourceMatches.status, opts.status))
  const where = filters.length === 0 ? undefined : filters.length === 1 ? filters[0] : and(...filters)
  let rows: any[] = []
  try {
    rows = where
      ? await db.select().from(schema.needResourceMatches).where(where).orderBy(desc(schema.needResourceMatches.score)).limit(opts.limit ?? 50)
      : await db.select().from(schema.needResourceMatches).orderBy(desc(schema.needResourceMatches.score)).limit(opts.limit ?? 50)
  } catch { /* needResourceMatches table dropped */ }
  let matches = rows.map(rowToMatch)
  const minScore = opts.minScore ?? MIN_SCORE_DEFAULT_LIST
  matches = matches.filter(m => m.score >= minScore)
  if (opts.hydrate) {
    for (const m of matches) {
      m.need = (await getNeed(m.needId)) ?? undefined
      m.offering = (await getOffering(m.offeringId)) ?? undefined
    }
  }
  return matches
}

export async function getMatch(id: string, hydrate = true): Promise<MatchRow | null> {
  let row: any = undefined
  try { row = await db.select().from(schema.needResourceMatches)
    .where(eq(schema.needResourceMatches.id, id))
    .limit(1).then(r => r[0]) } catch { /* needResourceMatches table dropped */ }
  if (!row) return null
  const m = rowToMatch(row)
  if (hydrate) {
    m.need = (await getNeed(m.needId)) ?? undefined
    m.offering = (await getOffering(m.offeringId)) ?? undefined
  }
  return m
}

// ─── Accept / Reject ────────────────────────────────────────────────

export async function acceptMatch(matchId: string): Promise<{
  ok: true
  roleAssignmentId?: string
  matchingEngagementId?: string
  deliveryEngagementId?: string
} | { error: string }> {
  const me = await getCurrentUser()
  if (!me) return { error: 'not-authenticated' }
  const match = await getMatch(matchId, true)
  if (!match) return { error: 'match-not-found' }
  if (match.status !== 'proposed') return { error: `cannot-accept-from-status-${match.status}` }

  const now = new Date().toISOString()
  // Promote the match.
  try { db.update(schema.needResourceMatches)
    .set({ status: 'accepted', updatedAt: now })
    .where(eq(schema.needResourceMatches.id, matchId))
    .run() } catch { /* needResourceMatches table dropped */ }

  // Move need from open → in-progress.
  if (match.need?.status === 'open') {
    try { db.update(schema.needs)
      .set({ status: 'in-progress', updatedAt: now })
      .where(eq(schema.needs.id, match.needId))
      .run() } catch { /* needs table dropped */ }
  }

  // ── R16: Two-engagement split. ──────────────────────────────────
  // 1. Matching engagement: holder=requester (whoever expressed the intent),
  //    provider=selected agent. Closes immediately — the match itself IS
  //    the deliverable; trust deposit fires at creation.
  // 2. Delivery engagement: holder=beneficiary (the person on whose behalf
  //    the request was made; equals the requester for personal intents),
  //    provider=same selected agent. References (1) via parentEngagementId.
  //    Runs the normal Cadence/Tranche/OneShot/Governance round trip.
  //
  // The intent's `payload.beneficiaryAgent` field is REQUIRED — no fallback.
  // If absent, the match cannot be accepted; the intent must be re-expressed
  // with an explicit beneficiary first.
  let matchingEngagementId: string | undefined
  let deliveryEngagementId: string | undefined
  try {
    const { mintEntitlement, seedInitialWorkItem } = await import('./entitlements.action')
    const { getIntentForLegacyNeed, getIntentForLegacyOffering } = await import('./intents.action')
    const [holderIntent, providerIntent] = await Promise.all([
      getIntentForLegacyNeed(match.needId),
      getIntentForLegacyOffering(match.offeringId),
    ])
    if (!holderIntent || !providerIntent || !match.offering || !match.need) {
      throw new Error('intent or offering missing — cannot mint engagement')
    }

    // Beneficiary check. No fallbacks: explicit field on intent payload required.
    const holderPayload = (holderIntent.payload ?? {}) as Record<string, unknown>
    const beneficiaryAgent = typeof holderPayload.beneficiaryAgent === 'string'
      ? (holderPayload.beneficiaryAgent as string).toLowerCase()
      : null
    if (!beneficiaryAgent) {
      throw new Error('intent.payload.beneficiaryAgent is required (no fallback) — re-express the intent with an explicit beneficiary')
    }

    // Pull both outcomes; matching outcome belongs to the matching engagement,
    // delivery outcome belongs to the delivery engagement.
    let holderOutcomeRow: any = undefined
    try { holderOutcomeRow = db.select().from(schema.outcomes)
      .where(eq(schema.outcomes.intentId, holderIntent.id)).get() } catch { /* outcomes table dropped */ }
    let providerOutcomeRow: any = undefined
    try { providerOutcomeRow = db.select().from(schema.outcomes)
      .where(eq(schema.outcomes.intentId, providerIntent.id)).get() } catch { /* outcomes table dropped */ }

    // If provider intent has no explicit outcome, project one for the delivery
    // engagement (Maria's "delivered the coaching cleanly").
    let providerOutcomeId = providerOutcomeRow?.id ?? null
    if (!providerOutcomeId) {
      providerOutcomeId = randomUUID()
      const objectLeaf = match.offering.resourceType.split(':').pop() ?? match.offering.resourceType
      const topic = holderIntent.topic ?? match.need.title
      try { db.insert(schema.outcomes).values({
        id: providerOutcomeId,
        intentId: providerIntent.id,
        description: `Successfully delivered ${objectLeaf} engagement around "${topic}".`,
        metric: JSON.stringify({ kind: 'narrative', target: 'engagement-completed' }),
        status: 'pending',
        createdAt: now,
      }).run() } catch { /* outcomes table dropped */ }
    }

    const reqs = match.need.requirements ?? {}
    const baseTerms = {
      object: match.offering.resourceType,
      topic: holderIntent.topic ?? match.need.title,
      role: reqs.role,
      skill: reqs.skill,
      geo: reqs.geo,
      scope: holderIntent.intentTypeLabel,
      quietMode: holderPayload.quietMode === true,
    }

    // ── (1) Matching engagement ──────────────────────────────────
    const matchingMint = await mintEntitlement({
      sourceMatchId: matchId,
      holderIntentId: holderIntent.id,
      providerIntentId: providerIntent.id,
      holderAgent: match.need.neededByAgent,
      providerAgent: match.matchedAgent,
      hubId: match.need.hubId,
      resourceType: match.offering.resourceType,
      terms: { ...baseTerms, scope: 'matching' },
      holderOutcomeId: holderOutcomeRow?.id ?? undefined,
      providerOutcomeId: undefined,
      cadenceOverride: 'one-shot',
      engagementKind: 'matching',
    })
    if ('error' in matchingMint) throw new Error(`matching mint: ${matchingMint.error}`)
    matchingEngagementId = matchingMint.id

    if (matchingMint.created) {
      // Auto-close the matching engagement: both parties confirmed at accept,
      // capacity exhausted (the match is done), phase → deposited.
      try { db.update(schema.entitlements)
        .set({
          holderConfirmedAt: now,
          providerConfirmedAt: now,
          status: 'fulfilled',
          phase: 'deposited',
          capacityRemaining: 0,
          updatedAt: now,
        })
        .where(eq(schema.entitlements.id, matchingEngagementId!))
        .run() } catch { /* entitlements table dropped */ }

      // Mark holder intent fulfilled — the matching IS the outcome.
      try { db.update(schema.intents)
        .set({ status: 'fulfilled', updatedAt: now })
        .where(eq(schema.intents.id, holderIntent.id))
        .run() } catch { /* intents table dropped */ }
      if (holderOutcomeRow) {
        try { db.update(schema.outcomes)
          .set({ status: 'achieved', observedAt: now, observedBy: match.need.neededByAgent })
          .where(eq(schema.outcomes.id, holderOutcomeRow.id))
          .run() } catch { /* outcomes table dropped */ }
      }

      // Thread entries on the matching engagement: just record what happened.
      const { emitMatchAccept, emitConfirmation, emitTrustDeposit } = await import('./engagements/thread.action')
      await emitMatchAccept({
        engagementId: matchingEngagementId!,
        matchId,
        score: match.score,
        satisfies: match.satisfies,
        misses: match.misses,
      })
      await emitConfirmation({ engagementId: matchingEngagementId!, side: 'holder', fromAgent: match.need.neededByAgent })
      await emitConfirmation({ engagementId: matchingEngagementId!, side: 'provider', fromAgent: match.matchedAgent })

      // Mint the matching trust deposit (thinner — the deposit is "made a good match").
      try {
        const { mintTrustDeposit } = await import('./engagements/trust-deposit.action')
        await mintTrustDeposit({ engagementId: matchingEngagementId! })
      } catch (err) {
        console.warn('[acceptMatch] matching trust deposit failed (non-fatal):', (err as Error).message)
      }
      await emitTrustDeposit({
        engagementId: matchingEngagementId!,
        reviewIds: [],
        skillClaimIds: [],
        assertionId: 'matching',
      })
    }

    // ── (2) Delivery engagement ──────────────────────────────────
    const deliveryMint = await mintEntitlement({
      sourceMatchId: matchId,
      holderIntentId: holderIntent.id,
      providerIntentId: providerIntent.id,
      holderAgent: beneficiaryAgent,                         // person being served
      providerAgent: match.matchedAgent,                     // selected agent
      hubId: match.need.hubId,
      resourceType: match.offering.resourceType,
      terms: baseTerms,
      holderOutcomeId: undefined,                            // delivery outcomes are intentionally distinct from matching outcome
      providerOutcomeId: providerOutcomeId ?? undefined,
      engagementKind: 'delivery',
      parentEngagementId: matchingEngagementId,
    })
    if ('error' in deliveryMint) throw new Error(`delivery mint: ${deliveryMint.error}`)
    deliveryEngagementId = deliveryMint.id

    if (deliveryMint.created) {
      await seedInitialWorkItem(deliveryEngagementId!)
      const { emitIntentRef, emitMatchAccept, emitContractTerm } = await import('./engagements/thread.action')
      await emitIntentRef({
        engagementId: deliveryEngagementId!,
        intentId: holderIntent.id,
        side: 'holder',
        title: holderIntent.title,
        outcome: null,  // matching outcome belonged to the matching engagement
      })
      await emitIntentRef({
        engagementId: deliveryEngagementId!,
        intentId: providerIntent.id,
        side: 'provider',
        title: providerIntent.title,
        outcome: providerOutcomeRow?.description ?? null,
      })
      await emitMatchAccept({
        engagementId: deliveryEngagementId!,
        matchId,
        score: match.score,
        satisfies: match.satisfies,
        misses: match.misses,
      })
      let ent: any = undefined
      try { ent = db.select().from(schema.entitlements)
        .where(eq(schema.entitlements.id, deliveryEngagementId!)).get() } catch { /* entitlements table dropped */ }
      if (ent) {
        await emitContractTerm({
          engagementId: deliveryEngagementId!,
          cadence: ent.cadence,
          validUntil: ent.validUntil,
          capacityGranted: ent.capacityGranted,
          capacityUnit: ent.capacityUnit,
          terms: JSON.parse(ent.terms),
        })
      }
    }
  } catch (err) {
    return { error: `engagement-mint-failed: ${(err as Error).message}` }
  }

  // Mint a RoleAssignment when the match satisfies a role requirement.
  // Bound to the *delivery* engagement (the working relationship), not the matching one.
  let roleAssignmentId: string | undefined
  const reqs = match.need?.requirements
  if (reqs?.role && match.satisfies.includes('role') && match.offering) {
    roleAssignmentId = randomUUID()
    try { db.insert(schema.roleAssignments).values({
      id: roleAssignmentId,
      bearerAgent: match.matchedAgent,
      rolePlayed: reqs.role,
      contextEntity: match.need!.neededByAgent,
      targetAgent: null,
      sourceMatchId: matchId,
      sourceEntitlementId: deliveryEngagementId ?? null,
      startsAt: now,
      endsAt: null,
      status: 'active',
      createdAt: now,
    }).run() } catch { /* roleAssignments table dropped */ }
  }

  // Notify the matched agent. Link goes to the *delivery* engagement —
  // that's the working surface; the matching engagement is the closed receipt.
  if (me.id !== match.matchedAgent) {
    try { db.insert(schema.messages).values({
      id: randomUUID(),
      userId: me.id,
      type: 'relationship_proposed',
      title: `Match accepted: ${match.need?.title ?? 'a need'}`,
      body: deliveryEngagementId
        ? `You've been matched to fulfill "${match.need?.title}" via your offering "${match.offering?.title}". The working engagement has been opened — start with the first work item.`
        : `You've been matched to fulfill "${match.need?.title}" via your offering "${match.offering?.title}". Open the match for next steps.`,
      link: deliveryEngagementId ? `/h/catalyst/entitlements/${deliveryEngagementId}` : `/h/catalyst/matches/${matchId}`,
      read: 0,
    }).run() } catch { /* messages table dropped */ }
  }

  return { ok: true, roleAssignmentId, matchingEngagementId, deliveryEngagementId }
}

export async function rejectMatch(matchId: string, reason?: string): Promise<{ ok: true } | { error: string }> {
  const me = await getCurrentUser()
  if (!me) return { error: 'not-authenticated' }
  const match = await getMatch(matchId, false)
  if (!match) return { error: 'match-not-found' }
  if (match.status !== 'proposed') return { error: `cannot-reject-from-status-${match.status}` }

  try { db.update(schema.needResourceMatches)
    .set({
      status: 'rejected',
      misses: JSON.stringify([...match.misses, reason ?? 'manual-reject']),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.needResourceMatches.id, matchId))
    .run() } catch { /* needResourceMatches table dropped */ }
  return { ok: true }
}

// ─── Hub-level summaries ────────────────────────────────────────────

export interface HubDiscoverSummary {
  openNeeds: number
  proposedMatches: number
  topNeeds: NeedRow[]
}

// ─── Open-needs picker (for QuickActivityModal "fulfills which need?") ──

export interface PickerOption {
  id: string
  title: string
  needTypeLabel: string
  status: string
  /** "Connected" = need is on an org I'm a member of (governance, membership,
   *  advisor, has-member). Surfaced first in the dropdown so the most
   *  relevant fulfillment options appear before generic hub-wide needs. */
  scope: 'connected' | 'hub'
  /** How many activities still required for status → met (per-type threshold). */
  remaining: number
}

const PICKER_THRESHOLDS: Record<string, number> = {
  'needType:PrayerPartner': 1,
  'needType:VenueForGathering': 1,
  'needType:ConnectorToFunder': 1,
  'needType:HeartLanguageScripture': 2,
  'needType:CircleCoachNeeded': 3,
  'needType:Treasurer': 3,
  'needType:TrainerForT4T': 3,
  'needType:GroupLeaderApprentice': 3,
  'needType:TraumaInformedCare': 2,
}

/**
 * Open needs the current user could plausibly fulfill, ranked by
 * relevance:
 *
 *   1. Needs on orgs the user is *connected to* (their person agent
 *      has any AgentRelationship to the need-bearing org). These come
 *      first in the dropdown.
 *   2. Other open needs in the same hub. Capped at 12 total to keep the
 *      <select> manageable.
 *
 * Used by QuickActivityModal to render a "Fulfills which need?" dropdown.
 */
export async function listOpenNeedsForActor(hubId: string): Promise<PickerOption[]> {
  const me = await getCurrentUser()
  if (!me) return []
  const { getPersonAgentForUser, getOrgsForPersonAgent } = await import('@/lib/agent-registry')
  const personAgent = await getPersonAgentForUser(me.id) as `0x${string}` | null
  if (!personAgent) return []
  const orgs = await getOrgsForPersonAgent(personAgent).catch(() => [])
  const myOrgAddrs = new Set<string>([
    personAgent.toLowerCase(),
    ...orgs.map(o => o.address.toLowerCase()),
  ])

  // Pull all open needs in the hub once, then partition.
  let openRows: any[] = []
  try { openRows = await db.select().from(schema.needs)
    .where(and(eq(schema.needs.hubId, hubId), eq(schema.needs.status, 'open')))
    .orderBy(desc(schema.needs.updatedAt))
    .limit(60) } catch { /* needs table dropped */ }

  const counts = new Map<string, number>()
  for (const r of openRows) {
    let ct: any[] = []
    try {
      ct = db.select().from(schema.activityLogs)
        .where(eq(schema.activityLogs.fulfillsNeedId, r.id))
        .all()
    } catch { /* activityLogs table dropped */ }
    counts.set(r.id, ct.length)
  }

  const connected: PickerOption[] = []
  const hubWide: PickerOption[] = []
  for (const r of openRows) {
    const threshold = PICKER_THRESHOLDS[r.needType] ?? 2
    const opt: PickerOption = {
      id: r.id,
      title: r.title,
      needTypeLabel: r.needTypeLabel,
      status: r.status,
      scope: myOrgAddrs.has(r.neededByAgent) ? 'connected' : 'hub',
      remaining: Math.max(0, threshold - (counts.get(r.id) ?? 0)),
    }
    if (opt.scope === 'connected') connected.push(opt)
    else hubWide.push(opt)
  }
  return [...connected, ...hubWide.slice(0, 12 - connected.length)]
}

export async function getHubDiscoverSummary(hubId: string): Promise<HubDiscoverSummary> {
  // openNeeds: count of receive-shape intents in this hub at `expressed` /
  // `acknowledged`. The legacy `needs` table is read only as a fallback
  // for the topNeeds card stack (NeedRow shape) — the headline number
  // tracks the intents table, which is the post-spec-001 source of truth.
  let openIntentCount = 0
  try {
    const rows = db.select({ id: schema.intents.id }).from(schema.intents)
      .where(and(
        eq(schema.intents.hubId, hubId),
        eq(schema.intents.direction, 'receive'),
        inArray(schema.intents.status, ['expressed', 'acknowledged']),
      ))
      .all()
    openIntentCount = rows.length
  } catch { /* intents table missing — count stays 0 */ }

  // topNeeds card stack still reads the legacy `needs` table.
  let openRows: any[] = []
  try { openRows = await db.select().from(schema.needs)
    .where(and(eq(schema.needs.hubId, hubId), eq(schema.needs.status, 'open')))
    .orderBy(desc(schema.needs.updatedAt))
    .limit(50) } catch { /* needs table dropped */ }

  // Count proposed matches across legacy `needResourceMatches`. The newer
  // `match_initiations` mirror lives in person-mcp; surfacing it through
  // this hub-level summary requires a downstream MCP call that's intentionally
  // not in v1's hot path. Per-intent candidate counts already render on the
  // intent detail page from `listCandidatesForIntent`.
  const needIds = (openRows as any[]).map((r: any) => r.id)
  let proposedMatches = 0
  if (needIds.length > 0) {
    for (const nid of needIds) {
      let c: any[] = []
      try { c = db.select({ id: schema.needResourceMatches.id }).from(schema.needResourceMatches)
        .where(and(
          eq(schema.needResourceMatches.needId, nid),
          eq(schema.needResourceMatches.status, 'proposed'),
        ))
        .all() } catch { /* needResourceMatches table dropped */ }
      proposedMatches += c.length
    }
  }

  // Top-by-priority — critical > high > normal > low, then most-recent.
  const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 }
  const topNeeds = (openRows as any[])
    .slice()
    .sort((a: any, b: any) => {
      const pa = PRIORITY_ORDER[a.priority] ?? 4
      const pb = PRIORITY_ORDER[b.priority] ?? 4
      if (pa !== pb) return pa - pb
      return b.updatedAt.localeCompare(a.updatedAt)
    })
    .slice(0, 5)
    .map((r: any) => ({
      id: r.id,
      needType: r.needType,
      needTypeLabel: r.needTypeLabel,
      neededByAgent: r.neededByAgent,
      hubId: r.hubId,
      title: r.title,
      detail: r.detail,
      priority: r.priority,
      status: r.status,
      requirements: r.requirements ? safeJsonParse<NeedRow['requirements']>(r.requirements) : null,
      validUntil: r.validUntil,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }))

  return {
    openNeeds: Math.max(openIntentCount, openRows.length),
    proposedMatches,
    topNeeds,
  }
}
