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
import { and, eq, desc } from 'drizzle-orm'
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
    const existing = db.select().from(schema.needResourceMatches)
      .where(and(
        eq(schema.needResourceMatches.needId, needId),
        eq(schema.needResourceMatches.offeringId, s.offering.id),
      ))
      .get()
    if (existing) {
      // Only re-score; never overwrite an accept/reject decision.
      if (existing.status === 'proposed' || existing.status === 'stale') {
        db.update(schema.needResourceMatches)
          .set({
            score: s.score,
            reason: s.reason,
            satisfies: JSON.stringify(s.satisfies),
            misses: JSON.stringify(s.misses),
            updatedAt: now,
          })
          .where(eq(schema.needResourceMatches.id, existing.id))
          .run()
        const reread = db.select().from(schema.needResourceMatches)
          .where(eq(schema.needResourceMatches.id, existing.id)).get()
        if (reread) persisted.push(rowToMatch(reread))
      } else {
        persisted.push(rowToMatch(existing))
      }
    } else {
      const id = randomUUID()
      db.insert(schema.needResourceMatches).values({
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
      }).run()
      const reread = db.select().from(schema.needResourceMatches)
        .where(eq(schema.needResourceMatches.id, id)).get()
      if (reread) persisted.push(rowToMatch(reread))
    }
  }

  return { matches: persisted }
}

/** Run match against every open need in the hub. Used by the Discover page. */
export async function runDiscoverMatchForHub(hubId: string): Promise<{ count: number; runs: number }> {
  const opens = await db.select().from(schema.needs)
    .where(and(eq(schema.needs.hubId, hubId), eq(schema.needs.status, 'open')))
    .limit(50)
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
  const rows = where
    ? await db.select().from(schema.needResourceMatches).where(where).orderBy(desc(schema.needResourceMatches.score)).limit(opts.limit ?? 50)
    : await db.select().from(schema.needResourceMatches).orderBy(desc(schema.needResourceMatches.score)).limit(opts.limit ?? 50)
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
  const row = await db.select().from(schema.needResourceMatches)
    .where(eq(schema.needResourceMatches.id, id))
    .limit(1).then(r => r[0])
  if (!row) return null
  const m = rowToMatch(row)
  if (hydrate) {
    m.need = (await getNeed(m.needId)) ?? undefined
    m.offering = (await getOffering(m.offeringId)) ?? undefined
  }
  return m
}

// ─── Accept / Reject ────────────────────────────────────────────────

export async function acceptMatch(matchId: string): Promise<{ ok: true; roleAssignmentId?: string } | { error: string }> {
  const me = await getCurrentUser()
  if (!me) return { error: 'not-authenticated' }
  const match = await getMatch(matchId, true)
  if (!match) return { error: 'match-not-found' }
  if (match.status !== 'proposed') return { error: `cannot-accept-from-status-${match.status}` }

  const now = new Date().toISOString()
  // Promote the match.
  db.update(schema.needResourceMatches)
    .set({ status: 'accepted', updatedAt: now })
    .where(eq(schema.needResourceMatches.id, matchId))
    .run()

  // Move need from open → in-progress.
  if (match.need?.status === 'open') {
    db.update(schema.needs)
      .set({ status: 'in-progress', updatedAt: now })
      .where(eq(schema.needs.id, match.needId))
      .run()
  }

  // Mint a RoleAssignment when the match satisfies a role requirement.
  let roleAssignmentId: string | undefined
  const reqs = match.need?.requirements
  if (reqs?.role && match.satisfies.includes('role') && match.offering) {
    roleAssignmentId = randomUUID()
    db.insert(schema.roleAssignments).values({
      id: roleAssignmentId,
      bearerAgent: match.matchedAgent,
      rolePlayed: reqs.role,
      contextEntity: match.need!.neededByAgent,
      targetAgent: null,
      sourceMatchId: matchId,
      startsAt: now,
      endsAt: null,
      status: 'active',
      createdAt: now,
    }).run()
  }

  // Notify the matched agent. Re-uses the existing actionable-message
  // pipeline so the work-queue's message-pending source surfaces it.
  if (me.id !== match.matchedAgent) {
    db.insert(schema.messages).values({
      id: randomUUID(),
      userId: me.id, // notification author; the in-app message is for the matched agent — TODO: route by agent
      type: 'relationship_proposed',
      title: `Match accepted: ${match.need?.title ?? 'a need'}`,
      body: `You've been matched to fulfill "${match.need?.title}" via your offering "${match.offering?.title}". Open the match for next steps.`,
      link: `/h/catalyst/matches/${matchId}`,
      read: 0,
    }).run()
  }

  return { ok: true, roleAssignmentId }
}

export async function rejectMatch(matchId: string, reason?: string): Promise<{ ok: true } | { error: string }> {
  const me = await getCurrentUser()
  if (!me) return { error: 'not-authenticated' }
  const match = await getMatch(matchId, false)
  if (!match) return { error: 'match-not-found' }
  if (match.status !== 'proposed') return { error: `cannot-reject-from-status-${match.status}` }

  db.update(schema.needResourceMatches)
    .set({
      status: 'rejected',
      misses: JSON.stringify([...match.misses, reason ?? 'manual-reject']),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.needResourceMatches.id, matchId))
    .run()
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
  const openRows = await db.select().from(schema.needs)
    .where(and(eq(schema.needs.hubId, hubId), eq(schema.needs.status, 'open')))
    .orderBy(desc(schema.needs.updatedAt))
    .limit(60)

  const counts = new Map<string, number>()
  for (const r of openRows) {
    const ct = db.select().from(schema.activityLogs)
      .where(eq(schema.activityLogs.fulfillsNeedId, r.id))
      .all().length
    counts.set(r.id, ct)
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
  const openRows = await db.select().from(schema.needs)
    .where(and(eq(schema.needs.hubId, hubId), eq(schema.needs.status, 'open')))
    .orderBy(desc(schema.needs.updatedAt))
    .limit(50)

  // Count proposed matches across all open needs in this hub.
  const needIds = openRows.map(r => r.id)
  let proposedMatches = 0
  if (needIds.length > 0) {
    for (const nid of needIds) {
      const c = db.select({ id: schema.needResourceMatches.id }).from(schema.needResourceMatches)
        .where(and(
          eq(schema.needResourceMatches.needId, nid),
          eq(schema.needResourceMatches.status, 'proposed'),
        ))
        .all()
      proposedMatches += c.length
    }
  }

  // Top-by-priority — critical > high > normal > low, then most-recent.
  const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 }
  const topNeeds = openRows
    .slice()
    .sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority] ?? 4
      const pb = PRIORITY_ORDER[b.priority] ?? 4
      if (pa !== pb) return pa - pb
      return b.updatedAt.localeCompare(a.updatedAt)
    })
    .slice(0, 5)
    .map(r => ({
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
    openNeeds: openRows.length,
    proposedMatches,
    topNeeds,
  }
}
