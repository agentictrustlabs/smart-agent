'use server'

/**
 * Commitment Thread — typed persistent backbone of an engagement's round trip.
 *
 * Every stage emits entries: intent reference, contract terms, work items,
 * activities, two-way messages, evidence pins, witness sigs, mutual
 * confirmations, and the final trust deposit. Reading the thread top-to-bottom
 * is the audit story of the engagement.
 *
 * Append helpers are typed by `kind`; `appendThreadEntry` is the generic form.
 * Most stage-emit calls use the typed wrappers.
 *
 * Schema: schema.commitmentThreadEntries
 * Spec:   docs/specs/round-trip-trust-deposit-plan.md §5
 */

import { randomUUID } from 'crypto'
import { db, schema } from '@/db'
import { asc, eq } from 'drizzle-orm'

export type ThreadEntryKind =
  | 'intent_ref'
  | 'match_accept'
  | 'contract_term'
  | 'work_item'
  | 'activity'
  | 'message'
  | 'evidence_pin'
  | 'witness_sig'
  | 'confirmation'
  | 'trust_deposit'

export interface ThreadEntryRow {
  id: string
  engagementId: string
  kind: ThreadEntryKind
  fromAgent: string | null
  body: unknown
  attachmentUri: string | null
  hashAnchor: string | null
  createdAt: string
}

function safeParse<T>(s: string | null): T | null {
  if (!s) return null
  try { return JSON.parse(s) as T } catch { return null }
}

function rowToEntry(r: typeof schema.commitmentThreadEntries.$inferSelect): ThreadEntryRow {
  return {
    id: r.id,
    engagementId: r.engagementId,
    kind: r.kind,
    fromAgent: r.fromAgent,
    body: safeParse<unknown>(r.body) ?? r.body,
    attachmentUri: r.attachmentUri,
    hashAnchor: r.hashAnchor,
    createdAt: r.createdAt,
  }
}

// ─── Generic append ─────────────────────────────────────────────────

export async function appendThreadEntry(input: {
  engagementId: string
  kind: ThreadEntryKind
  fromAgent?: string | null
  body: unknown
  attachmentUri?: string | null
  hashAnchor?: string | null
}): Promise<{ id: string }> {
  const id = randomUUID()
  db.insert(schema.commitmentThreadEntries).values({
    id,
    engagementId: input.engagementId,
    kind: input.kind,
    fromAgent: input.fromAgent ? input.fromAgent.toLowerCase() : null,
    body: JSON.stringify(input.body),
    attachmentUri: input.attachmentUri ?? null,
    hashAnchor: input.hashAnchor ?? null,
    createdAt: new Date().toISOString(),
  }).run()
  return { id }
}

// ─── Typed emitters per stage ───────────────────────────────────────

export async function emitIntentRef(args: {
  engagementId: string
  intentId: string
  side: 'holder' | 'provider'
  title: string
  outcome?: string | null
}) {
  return appendThreadEntry({
    engagementId: args.engagementId,
    kind: 'intent_ref',
    body: {
      intentId: args.intentId,
      side: args.side,
      title: args.title,
      outcome: args.outcome ?? null,
    },
  })
}

export async function emitMatchAccept(args: {
  engagementId: string
  matchId: string
  score: number
  satisfies: string[]
  misses: string[]
}) {
  return appendThreadEntry({
    engagementId: args.engagementId,
    kind: 'match_accept',
    body: {
      matchId: args.matchId,
      score: args.score,
      satisfies: args.satisfies,
      misses: args.misses,
    },
  })
}

export async function emitContractTerm(args: {
  engagementId: string
  cadence: string
  validUntil: string | null
  capacityGranted: number
  capacityUnit: string
  terms: unknown
}) {
  return appendThreadEntry({
    engagementId: args.engagementId,
    kind: 'contract_term',
    body: {
      cadence: args.cadence,
      validUntil: args.validUntil,
      capacityGranted: args.capacityGranted,
      capacityUnit: args.capacityUnit,
      terms: args.terms,
    },
  })
}

export async function emitWorkItemEntry(args: {
  engagementId: string
  workItemId: string
  title: string
  taskKind: string
  assigneeAgent: string
}) {
  return appendThreadEntry({
    engagementId: args.engagementId,
    kind: 'work_item',
    fromAgent: args.assigneeAgent,
    body: {
      workItemId: args.workItemId,
      title: args.title,
      taskKind: args.taskKind,
      assigneeAgent: args.assigneeAgent,
    },
  })
}

export async function emitActivityEntry(args: {
  engagementId: string
  activityId: string
  title: string
  activityType: string
  capacityConsumed?: number
  fromAgent: string
}) {
  return appendThreadEntry({
    engagementId: args.engagementId,
    kind: 'activity',
    fromAgent: args.fromAgent,
    body: {
      activityId: args.activityId,
      title: args.title,
      activityType: args.activityType,
      capacityConsumed: args.capacityConsumed ?? null,
    },
  })
}

export async function emitMessage(args: {
  engagementId: string
  fromAgent: string
  text: string
  attachmentUri?: string | null
}) {
  return appendThreadEntry({
    engagementId: args.engagementId,
    kind: 'message',
    fromAgent: args.fromAgent,
    body: { text: args.text },
    attachmentUri: args.attachmentUri ?? null,
  })
}

export async function emitEvidencePin(args: {
  engagementId: string
  fromAgent: string
  activityIds: string[]
  attachments: { uri: string; description?: string }[]
  bundleHash: string
}) {
  return appendThreadEntry({
    engagementId: args.engagementId,
    kind: 'evidence_pin',
    fromAgent: args.fromAgent,
    body: {
      activityIds: args.activityIds,
      attachments: args.attachments,
    },
    hashAnchor: args.bundleHash,
  })
}

export async function emitWitnessSig(args: {
  engagementId: string
  witnessAgent: string
  signature: string
  signedAt: string
}) {
  return appendThreadEntry({
    engagementId: args.engagementId,
    kind: 'witness_sig',
    fromAgent: args.witnessAgent,
    body: {
      witnessAgent: args.witnessAgent,
      signedAt: args.signedAt,
      signature: args.signature,
    },
  })
}

export async function emitConfirmation(args: {
  engagementId: string
  side: 'holder' | 'provider'
  fromAgent: string
}) {
  return appendThreadEntry({
    engagementId: args.engagementId,
    kind: 'confirmation',
    fromAgent: args.fromAgent,
    body: { side: args.side },
  })
}

export async function emitTrustDeposit(args: {
  engagementId: string
  reviewIds: string[]
  skillClaimIds: string[]
  assertionId: string
  txHash?: string | null
}) {
  return appendThreadEntry({
    engagementId: args.engagementId,
    kind: 'trust_deposit',
    body: {
      reviewIds: args.reviewIds,
      skillClaimIds: args.skillClaimIds,
      assertionId: args.assertionId,
    },
    hashAnchor: args.txHash ?? null,
  })
}

// ─── Read ───────────────────────────────────────────────────────────

export async function listThreadEntries(engagementId: string): Promise<ThreadEntryRow[]> {
  const rows = await db.select().from(schema.commitmentThreadEntries)
    .where(eq(schema.commitmentThreadEntries.engagementId, engagementId))
    .orderBy(asc(schema.commitmentThreadEntries.createdAt))
  return rows.map(rowToEntry)
}

// ─── Backfill ──────────────────────────────────────────────────────
//
// One-shot: project an engagement's existing intents, match, work items, and
// activities into thread entries. Idempotent — checks each kind for existing
// entries before inserting. Used on first read after the R3 migration.

export async function backfillThreadFromEngagement(engagementId: string): Promise<{ inserted: number }> {
  const ent = db.select().from(schema.entitlements)
    .where(eq(schema.entitlements.id, engagementId)).get()
  if (!ent) return { inserted: 0 }

  const existing = db.select().from(schema.commitmentThreadEntries)
    .where(eq(schema.commitmentThreadEntries.engagementId, engagementId))
    .all()
  const existingKinds = new Set(existing.map(e => e.kind))
  const existingActivityIds = new Set(
    existing.filter(e => e.kind === 'activity').map(e => {
      try { return (JSON.parse(e.body) as { activityId?: string }).activityId } catch { return undefined }
    }).filter(Boolean) as string[],
  )
  const existingWorkItemIds = new Set(
    existing.filter(e => e.kind === 'work_item').map(e => {
      try { return (JSON.parse(e.body) as { workItemId?: string }).workItemId } catch { return undefined }
    }).filter(Boolean) as string[],
  )

  let inserted = 0

  // intent_ref (×2) — only if not present.
  if (!existingKinds.has('intent_ref')) {
    const holderIntent = db.select().from(schema.intents)
      .where(eq(schema.intents.id, ent.holderIntentId)).get()
    const providerIntent = db.select().from(schema.intents)
      .where(eq(schema.intents.id, ent.providerIntentId)).get()
    const holderOutcome = ent.holderOutcomeId
      ? db.select().from(schema.outcomes).where(eq(schema.outcomes.id, ent.holderOutcomeId)).get()
      : null
    const providerOutcome = ent.providerOutcomeId
      ? db.select().from(schema.outcomes).where(eq(schema.outcomes.id, ent.providerOutcomeId)).get()
      : null
    if (holderIntent) {
      await emitIntentRef({
        engagementId,
        intentId: holderIntent.id,
        side: 'holder',
        title: holderIntent.title,
        outcome: holderOutcome?.description ?? null,
      })
      inserted++
    }
    if (providerIntent) {
      await emitIntentRef({
        engagementId,
        intentId: providerIntent.id,
        side: 'provider',
        title: providerIntent.title,
        outcome: providerOutcome?.description ?? null,
      })
      inserted++
    }
  }

  // match_accept — re-derive score/satisfies/misses from the match row.
  if (!existingKinds.has('match_accept')) {
    const match = db.select().from(schema.needResourceMatches)
      .where(eq(schema.needResourceMatches.id, ent.sourceMatchId)).get()
    if (match) {
      const satisfies = safeParse<string[]>(match.satisfies) ?? []
      const misses = safeParse<string[]>(match.misses) ?? []
      await emitMatchAccept({
        engagementId,
        matchId: match.id,
        score: match.score,
        satisfies,
        misses,
      })
      inserted++
    }
  }

  // contract_term — synthesize from current entitlement row.
  if (!existingKinds.has('contract_term')) {
    await emitContractTerm({
      engagementId,
      cadence: ent.cadence,
      validUntil: ent.validUntil,
      capacityGranted: ent.capacityGranted,
      capacityUnit: ent.capacityUnit,
      terms: safeParse<unknown>(ent.terms) ?? {},
    })
    inserted++
  }

  // work_item entries — one per existing item not already projected.
  const workItems = db.select().from(schema.fulfillmentWorkItems)
    .where(eq(schema.fulfillmentWorkItems.entitlementId, engagementId))
    .all()
  for (const wi of workItems) {
    if (existingWorkItemIds.has(wi.id)) continue
    await emitWorkItemEntry({
      engagementId,
      workItemId: wi.id,
      title: wi.title,
      taskKind: wi.taskKind,
      assigneeAgent: wi.assigneeAgent,
    })
    inserted++
  }

  // activity entries — one per logged activity not already projected.
  const activities = db.select().from(schema.activityLogs)
    .where(eq(schema.activityLogs.fulfillsEntitlementId, engagementId))
    .orderBy(asc(schema.activityLogs.activityDate))
    .all()
  for (const a of activities) {
    if (existingActivityIds.has(a.id)) continue
    await emitActivityEntry({
      engagementId,
      activityId: a.id,
      title: a.title,
      activityType: a.activityType,
      fromAgent: ent.providerAgent,
    })
    inserted++
  }

  return { inserted }
}
