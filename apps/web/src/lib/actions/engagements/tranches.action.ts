'use server'

/**
 * Tranches — Money engagement primary surface.
 *
 * The TrancheSchedule is the visual; this is the action layer:
 *   • ensureTrancheSchedule  — auto-seed N quarterly tranches if none exist
 *   • requestReport           — provider flips a tranche to report-due
 *   • attachReport            — holder attaches a report (thread entry + state move)
 *   • releaseTranche          — provider releases funds; ticks engagement capacity down
 *   • listTranches            — read for UI
 *
 * Spec: docs/specs/engagement-shapes-plan.md §6 R12.
 */

import { randomUUID } from 'crypto'
import { db, schema } from '@/db'
import { and, asc, eq } from 'drizzle-orm'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPersonAgentForUser } from '@/lib/agent-registry'

export type TrancheState = 'scheduled' | 'report-due' | 'reported' | 'released' | 'held'

export interface TrancheRow {
  id: string
  engagementId: string
  idx: number
  amountCents: number
  scheduledFor: string | null
  releasedAt: string | null
  reportRequired: boolean
  reportThreadEntryId: string | null
  state: TrancheState
  createdAt: string
  updatedAt: string
}

function rowToTranche(r: typeof schema.engagementTranches.$inferSelect): TrancheRow {
  return {
    id: r.id,
    engagementId: r.engagementId,
    idx: r.idx,
    amountCents: r.amountCents,
    scheduledFor: r.scheduledFor,
    releasedAt: r.releasedAt,
    reportRequired: r.reportRequired === 1,
    reportThreadEntryId: r.reportThreadEntryId,
    state: r.state,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

async function authorizeRole(engagementId: string): Promise<
  { ok: true; agent: string; engagement: typeof schema.entitlements.$inferSelect; role: 'holder' | 'provider' }
  | { error: string }
> {
  const me = await getCurrentUser()
  if (!me) return { error: 'not-authenticated' }
  const agentAddr = await getPersonAgentForUser(me.id)
  if (!agentAddr) return { error: 'no-person-agent' }
  const lower = agentAddr.toLowerCase()
  let ent: any = [] as any[]
  try { ent = db.select().from(schema.entitlements)
    .where(eq(schema.entitlements.id, engagementId)).get()
   } catch { /* entitlements table dropped */ }if (!ent) return { error: 'engagement-not-found' }
  const role: 'holder' | 'provider' | null =
    ent.holderAgent === lower ? 'holder'
    : ent.providerAgent === lower ? 'provider'
    : null
  if (!role) return { error: 'not-a-party' }
  return { ok: true, agent: lower, engagement: ent, role }
}

// ─── Auto-seed schedule ────────────────────────────────────────────

const QUARTER_DAYS = 90

/**
 * Idempotent: if no tranches exist for this engagement, project a default
 * schedule from `capacityGranted` (in dollars). Default to 4 quarterly
 * tranches; round each tranche to whole dollars; remainder lands on the last.
 *
 * Reads `terms.tranches` from the engagement's terms JSON if present, else
 * uses a sensible default.
 */
export async function ensureTrancheSchedule(engagementId: string): Promise<void> {
  let ent: any = [] as any[]
  try { ent = db.select().from(schema.entitlements)
    .where(eq(schema.entitlements.id, engagementId)).get()
   } catch { /* entitlements table dropped */ }if (!ent) return
  let existing: any = [] as any[]
  try { existing = db.select().from(schema.engagementTranches)
    .where(eq(schema.engagementTranches.engagementId, engagementId))
    .get()
   } catch { /* engagementTranches table dropped */ }if (existing) return

  let count = 4
  let reportRequired = true
  try {
    const terms = JSON.parse(ent.terms) as { tranches?: { count?: number; reportRequired?: boolean } }
    if (typeof terms.tranches?.count === 'number' && terms.tranches.count > 0) count = terms.tranches.count
    if (typeof terms.tranches?.reportRequired === 'boolean') reportRequired = terms.tranches.reportRequired
  } catch { /* terms.tranches optional */ }

  // capacity is in *units*, by convention dollars when capacityUnit === 'capacityUnit:Dollars'.
  const totalDollars = ent.capacityGranted
  const baseDollars = Math.floor(totalDollars / count)
  const remainder = totalDollars - baseDollars * count
  const startDate = new Date(ent.validFrom)
  const now = new Date().toISOString()

  const rows: typeof schema.engagementTranches.$inferInsert[] = []
  for (let i = 0; i < count; i++) {
    const dollars = baseDollars + (i === count - 1 ? remainder : 0)
    const scheduled = new Date(startDate.getTime() + i * QUARTER_DAYS * 86_400_000).toISOString()
    rows.push({
      id: randomUUID(),
      engagementId,
      idx: i + 1,
      amountCents: dollars * 100,
      scheduledFor: scheduled,
      releasedAt: null,
      reportRequired: reportRequired ? 1 : 0,
      reportThreadEntryId: null,
      // First tranche skips the report-required gate (initial disbursement).
      state: i === 0 ? 'scheduled' : (reportRequired ? 'scheduled' : 'scheduled'),
      createdAt: now,
      updatedAt: now,
    })
  }
  try { db.insert(schema.engagementTranches).values(rows).run()
 } catch { /* engagementTranches table dropped */ }}

// ─── Reads ─────────────────────────────────────────────────────────

export async function listTranches(engagementId: string): Promise<TrancheRow[]> {
  await ensureTrancheSchedule(engagementId)
  let rows: any = [] as any[]
  try { rows = await db.select().from(schema.engagementTranches)
    .where(eq(schema.engagementTranches.engagementId, engagementId))
    .orderBy(asc(schema.engagementTranches.idx))
   } catch { /* engagementTranches table dropped */ }return rows.map(rowToTranche)
}

export interface TrancheSummary {
  totalCents: number
  releasedCents: number
  remainingCents: number
  totalCount: number
  releasedCount: number
  currentTranche: TrancheRow | null
  tranches: TrancheRow[]
}

export async function summarizeTranches(engagementId: string): Promise<TrancheSummary> {
  const tranches = await listTranches(engagementId)
  const totalCents = tranches.reduce((s, t) => s + t.amountCents, 0)
  const releasedCents = tranches.filter(t => t.state === 'released')
    .reduce((s, t) => s + t.amountCents, 0)
  const releasedCount = tranches.filter(t => t.state === 'released').length
  // Current = first non-released, or null if all released.
  const currentTranche = tranches.find(t => t.state !== 'released' && t.state !== 'held') ?? null
  return {
    totalCents,
    releasedCents,
    remainingCents: totalCents - releasedCents,
    totalCount: tranches.length,
    releasedCount,
    currentTranche,
    tranches,
  }
}

// ─── Mutators ──────────────────────────────────────────────────────

export async function requestReport(input: {
  engagementId: string
  trancheIdx: number
}): Promise<{ ok: true } | { error: string }> {
  const auth = await authorizeRole(input.engagementId)
  if ('error' in auth) return auth
  if (auth.role !== 'provider') return { error: 'only-provider-may-request' }

  let tranche: any = [] as any[]
  try { tranche = db.select().from(schema.engagementTranches)
    .where(and(
      eq(schema.engagementTranches.engagementId, input.engagementId),
      eq(schema.engagementTranches.idx, input.trancheIdx),
    )).get()
   } catch { /* engagementTranches table dropped */ }if (!tranche) return { error: 'tranche-not-found' }
  if (tranche.state !== 'scheduled') return { error: `cannot-request-from-${tranche.state}` }

  try { db.update(schema.engagementTranches)
    .set({ state: 'report-due', updatedAt: new Date().toISOString() })
    .where(eq(schema.engagementTranches.id, tranche.id))
    .run()
   } catch { /* engagementTranches table dropped */ }return { ok: true }
}

export async function attachReport(input: {
  engagementId: string
  trancheIdx: number
  reportText: string
  reportUri?: string
}): Promise<{ ok: true; threadEntryId: string } | { error: string }> {
  const auth = await authorizeRole(input.engagementId)
  if ('error' in auth) return auth
  if (auth.role !== 'holder') return { error: 'only-holder-may-attach-report' }

  let tranche: any = [] as any[]
  try { tranche = db.select().from(schema.engagementTranches)
    .where(and(
      eq(schema.engagementTranches.engagementId, input.engagementId),
      eq(schema.engagementTranches.idx, input.trancheIdx),
    )).get()
   } catch { /* engagementTranches table dropped */ }if (!tranche) return { error: 'tranche-not-found' }

  const text = input.reportText.trim()
  if (!text) return { error: 'empty-report' }

  // Emit a typed thread entry so the report shows up in the audit + records tab.
  const { emitMessage } = await import('./thread.action')
  const entry = await emitMessage({
    engagementId: input.engagementId,
    fromAgent: auth.agent,
    text: `Report — Tranche ${tranche.idx}: ${text}`,
    attachmentUri: input.reportUri ?? null,
  })

  try { db.update(schema.engagementTranches)
    .set({
      state: 'reported',
      reportThreadEntryId: entry.id,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.engagementTranches.id, tranche.id))
    .run()
   } catch { /* engagementTranches table dropped */ }return { ok: true, threadEntryId: entry.id }
}

export async function releaseTranche(input: {
  engagementId: string
  trancheIdx: number
}): Promise<{ ok: true; isFinal: boolean } | { error: string }> {
  const auth = await authorizeRole(input.engagementId)
  if ('error' in auth) return auth
  if (auth.role !== 'provider') return { error: 'only-provider-may-release' }

  let tranche: any = [] as any[]
  try { tranche = db.select().from(schema.engagementTranches)
    .where(and(
      eq(schema.engagementTranches.engagementId, input.engagementId),
      eq(schema.engagementTranches.idx, input.trancheIdx),
    )).get()
   } catch { /* engagementTranches table dropped */ }if (!tranche) return { error: 'tranche-not-found' }
  if (tranche.state === 'released') return { error: 'already-released' }
  if (tranche.reportRequired === 1 && tranche.state !== 'reported' && tranche.idx !== 1) {
    return { error: 'report-required-before-release' }
  }

  const now = new Date().toISOString()
  try { db.update(schema.engagementTranches)
    .set({ state: 'released', releasedAt: now, updatedAt: now })
    .where(eq(schema.engagementTranches.id, tranche.id))
    .run()

   } catch { /* engagementTranches table dropped */ }// Drive the engagement capacity meter: release decrements remaining
  // capacity by the tranche dollars. The cascade on the entitlement layer
  // handles outcome / parent-intent flips when capacity hits zero.
  const dollars = Math.floor(tranche.amountCents / 100)
  let ent: any = [] as any[]
  try { ent = db.select().from(schema.entitlements)
    .where(eq(schema.entitlements.id, input.engagementId)).get()
   } catch { /* entitlements table dropped */ }if (ent) {
    const newRemaining = Math.max(0, ent.capacityRemaining - dollars)
    try { db.update(schema.entitlements)
      .set({
        capacityRemaining: newRemaining,
        // Phase advance: granted/kickoff → in_cadence on first release.
        phase: ent.phase === 'granted' || ent.phase === 'kickoff' ? 'in_cadence' : ent.phase,
        status: ent.status === 'granted' ? 'active' : ent.status,
        updatedAt: now,
      })
      .where(eq(schema.entitlements.id, input.engagementId))
      .run()

     } catch { /* entitlements table dropped */ }// Emit a thread entry for the release.
    const { emitActivityEntry } = await import('./thread.action')
    await emitActivityEntry({
      engagementId: input.engagementId,
      activityId: tranche.id, // tranche id stands in for activity id in the thread
      title: `Tranche ${tranche.idx} released — $${dollars.toLocaleString()}`,
      activityType: 'service',
      capacityConsumed: dollars,
      fromAgent: auth.agent,
    })
  }

  // Determine whether this was the final tranche.
  const all = await listTranches(input.engagementId)
  const allReleased = all.every(t => t.state === 'released' || t.state === 'held')
  return { ok: true, isFinal: allReleased }
}
