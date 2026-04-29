'use server'

/**
 * Work-queue aggregator — single server action that reads from the
 * 8 real data sources identified in the use-case analysis and maps
 * each row to a unified `WorkItem`. Returns the merged + sorted list
 * for a given user, optionally filtered by mode.
 *
 * No `work_items` table; truth lives on each source. Resolution
 * happens implicitly when the source's state changes (invite
 * accepted → invite removed from queue, edge confirmed → no longer
 * PROPOSED). See `types.ts` for the rationale.
 *
 * v1 sources implemented:
 *   1. on-chain PROPOSED edges where actor is the object  → decision-edge
 *   2. proposals (open) in orgs the actor is a member of   → decision-proposal
 *   3. messages (read=0) for the actor                     → message-pending
 *   4. derived: actor's owned orgs lacking profile data    → manage-orphan
 *   5. circles (plannedConversation=1) for the actor       → planned-conversation
 *   6. derived: stale COACHING_MENTORSHIP edges            → stale-mentee-checkin
 *   7. prayers due today for the actor                     → prayer-due
 *   8. trainingProgress cadence due                        → walk-step-due
 *
 * Each source is wrapped in a try/catch so a slow on-chain call or
 * a missing schema column never blocks the rest of the queue. The
 * UI shows partial results; logs surface the gap.
 */

import { db, schema } from '@/db'
import { eq, and, inArray } from 'drizzle-orm'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPersonAgentForUser, getOrgsForPersonAgent } from '@/lib/agent-registry'
import {
  getEdgesByObject, getEdgesBySubject, getEdge, getPublicClient,
} from '@/lib/contracts'
import { getAgentMetadata } from '@/lib/agent-metadata'
import {
  COACHING_MENTORSHIP, agentAccountResolverAbi, ATL_CONTROLLER,
  agentSkillRegistryAbi,
} from '@smart-agent/sdk'
import {
  type WorkItem, type WorkMode, type WorkItemKind, KIND_TO_MODE,
} from './types'

/** Stale-mentee-checkin: how old before we surface the prompt. */
const COACHING_CHECKIN_DAYS = 7
/** Walk-step-due: how long since the last completed step before we nudge. */
const WALK_CADENCE_DAYS = 7
/** Per-source result cap to keep the aggregator bounded under heavy load. */
const PER_SOURCE_LIMIT = 20

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString()
}

function makeWorkItem(item: Omit<WorkItem, 'mode'>): WorkItem {
  return { ...item, mode: KIND_TO_MODE[item.kind] }
}

/**
 * Public entry. Returns the actor's open work items, sorted by
 * dueAt ascending (urgent first), then createdAt descending.
 */
export async function listMyWorkItemsAction(opts: { mode?: WorkMode } = {}): Promise<{
  items: WorkItem[]
  modeBuckets: Record<WorkMode, number>
}> {
  const me = await getCurrentUser()
  if (!me) return { items: [], modeBuckets: emptyBuckets() }

  const personAgent = await getPersonAgentForUser(me.id) as `0x${string}` | null
  if (!personAgent) return { items: [], modeBuckets: emptyBuckets() }

  const items: WorkItem[] = []

  await Promise.all([
    // Govern
    decisionEdges(personAgent).then(rs => items.push(...rs)).catch(e => warn('decision-edge', e)),
    decisionProposals(me.id, personAgent).then(rs => items.push(...rs)).catch(e => warn('decision-proposal', e)),
    messagePending(me.id).then(rs => items.push(...rs)).catch(e => warn('message-pending', e)),
    manageOrphans(personAgent).then(rs => items.push(...rs)).catch(e => warn('manage-orphan', e)),
    // Disciple
    plannedConversations(me.id).then(rs => items.push(...rs)).catch(e => warn('planned-conversation', e)),
    staleMenteeCheckins(personAgent).then(rs => items.push(...rs)).catch(e => warn('stale-mentee-checkin', e)),
    // Walk
    prayersDue(me.id).then(rs => items.push(...rs)).catch(e => warn('prayer-due', e)),
    walkStepDue(me.id).then(rs => items.push(...rs)).catch(e => warn('walk-step-due', e)),
    // Discover
    matchesProposed(personAgent).then(rs => items.push(...rs)).catch(e => warn('match-proposed', e)),
  ])

  // Sort: urgent dueAt first, then most-recent createdAt. Items
  // without dueAt land after dueAt-bearing ones.
  items.sort((a, b) => {
    if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt)
    if (a.dueAt) return -1
    if (b.dueAt) return 1
    return b.createdAt.localeCompare(a.createdAt)
  })

  const modeBuckets: Record<WorkMode, number> = emptyBuckets()
  for (const it of items) modeBuckets[it.mode]++

  const filtered = opts.mode ? items.filter(it => it.mode === opts.mode) : items
  return { items: filtered, modeBuckets }
}

function emptyBuckets(): Record<WorkMode, number> {
  return { govern: 0, disciple: 0, route: 0, walk: 0, discover: 0 }
}

function warn(label: WorkItemKind, e: unknown) {
  console.warn(`[work-queue] ${label} source failed:`, e instanceof Error ? e.message.slice(0, 200) : e)
}

// ─── Source 1: decision-edge (on-chain PROPOSED edges) ────────────

async function decisionEdges(personAgent: `0x${string}`): Promise<WorkItem[]> {
  const inIds = await getEdgesByObject(personAgent)
  const out: WorkItem[] = []
  for (const id of inIds.slice(0, PER_SOURCE_LIMIT)) {
    try {
      const edge = await getEdge(id)
      if (edge.status !== 1) continue   // 1 = PROPOSED
      const meta = await getAgentMetadata(edge.subject as string).catch(() => null)
      out.push(makeWorkItem({
        id: `decision-edge:${id}`,
        kind: 'decision-edge',
        subject: edge.subject as `0x${string}`,
        subjectLabel: meta?.displayName ?? null,
        title: `Confirm relationship from ${meta?.displayName ?? 'an agent'}`,
        detail: `Pending edge — accept or reject this proposed relationship.`,
        dueAt: null,
        createdAt: new Date(Number(edge.createdAt) * 1000).toISOString(),
        actionUrl: `/agents/${personAgent}#relationships`,
        icon: '🔗',
      }))
    } catch { /* skip bad row */ }
  }
  return out
}

// ─── Source 2: decision-proposal (DB proposals open) ──────────────

async function decisionProposals(userId: string, personAgent: `0x${string}`): Promise<WorkItem[]> {
  const myOrgs = await getOrgsForPersonAgent(personAgent)
  if (myOrgs.length === 0) return []
  const orgAddrs = myOrgs.map(o => o.address.toLowerCase())
  const open = await db.select().from(schema.proposals)
    .where(and(eq(schema.proposals.status, 'open'), inArray(schema.proposals.orgAddress, orgAddrs)))
    .limit(PER_SOURCE_LIMIT)
  // The proposer doesn't need to vote on their own proposal — surface
  // it as a "monitor your proposal" item with a different verb.
  return open.map(p => {
    const isMine = p.proposer === userId
    const meta = myOrgs.find(o => o.address.toLowerCase() === p.orgAddress.toLowerCase())
    return makeWorkItem({
      id: `decision-proposal:${p.id}`,
      kind: 'decision-proposal',
      subject: p.orgAddress as `0x${string}`,
      subjectLabel: meta ? `${meta.address.slice(0, 6)}…${meta.address.slice(-4)}` : null,
      title: isMine ? `Awaiting votes: ${p.title}` : `Vote: ${p.title}`,
      detail: `${p.actionType} — ${p.votesFor}/${p.quorumRequired} votes`,
      dueAt: null,
      createdAt: p.createdAt,
      actionUrl: `/steward?proposal=${p.id}`,
      icon: '🗳️',
    })
  })
}

// ─── Source 3: message-pending (DB messages, unread) ──────────────

async function messagePending(userId: string): Promise<WorkItem[]> {
  const unread = await db.select().from(schema.messages)
    .where(and(eq(schema.messages.userId, userId), eq(schema.messages.read, 0)))
    .limit(PER_SOURCE_LIMIT)
  // Some message types are pure read-receipts (relationship_confirmed,
  // data_access_granted) and shouldn't act as work items — keep only
  // the action-required types.
  const ACTIONABLE = new Set([
    'relationship_proposed', 'ownership_offered',
    'review_received', 'dispute_filed',
    'proposal_created', 'invite_sent',
  ])
  return unread.filter(m => ACTIONABLE.has(m.type)).map(m => makeWorkItem({
    id: `message-pending:${m.id}`,
    kind: 'message-pending',
    subject: null,
    subjectLabel: null,
    title: m.title,
    detail: m.body,
    dueAt: null,
    createdAt: m.createdAt,
    actionUrl: m.link ?? '/activity',
    icon: messageIcon(m.type),
  }))
}

function messageIcon(type: string): string {
  if (type.includes('relationship')) return '🔗'
  if (type.includes('proposal')) return '🗳️'
  if (type.includes('review')) return '⭐'
  if (type.includes('ownership')) return '🔑'
  if (type.includes('dispute')) return '⚖️'
  if (type.includes('invite')) return '✉️'
  return '🔔'
}

// ─── Source 4: manage-orphan (derived) ────────────────────────────
//
// For each org the user controls (ATL_CONTROLLER), check whether the
// org has any public skill claims. No claims → "set up profile" hint.
// Cheap to compute; results are bounded by the user's controlled-org
// count (typically 1-3 for hub admins).

async function manageOrphans(personAgent: `0x${string}`): Promise<WorkItem[]> {
  const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}` | undefined
  const skillRegAddr = process.env.AGENT_SKILL_REGISTRY_ADDRESS as `0x${string}` | undefined
  if (!resolverAddr || !skillRegAddr) return []

  const myOrgs = await getOrgsForPersonAgent(personAgent)
  if (myOrgs.length === 0) return []

  const pc = getPublicClient()
  const out: WorkItem[] = []

  for (const org of myOrgs.slice(0, PER_SOURCE_LIMIT)) {
    try {
      const ctrls = await pc.readContract({
        address: resolverAddr, abi: agentAccountResolverAbi,
        functionName: 'getMultiAddressProperty',
        args: [org.address as `0x${string}`, ATL_CONTROLLER as `0x${string}`],
      }) as string[]
      const isController = ctrls.some(c => c.toLowerCase() === personAgent.toLowerCase())
      if (!isController) continue

      const claims = await pc.readContract({
        address: skillRegAddr, abi: agentSkillRegistryAbi,
        functionName: 'claimsBySubject',
        args: [org.address as `0x${string}`],
      }) as `0x${string}`[]
      if (claims.length > 0) continue   // already has profile

      const meta = await getAgentMetadata(org.address).catch(() => null)
      out.push(makeWorkItem({
        id: `manage-orphan:${org.address.toLowerCase()}`,
        kind: 'manage-orphan',
        subject: org.address as `0x${string}`,
        subjectLabel: meta?.displayName ?? null,
        title: `Set up ${meta?.displayName ?? 'your org'}'s public profile`,
        detail: 'No skill claims yet. Publish what this org practices so it surfaces in trust-search.',
        dueAt: null,
        createdAt: new Date().toISOString(),
        actionUrl: `/agents/${org.address}/manage`,
        icon: '🛠️',
      }))
    } catch { /* skip */ }
  }
  return out
}

// ─── Source 5: planned-conversation (circles flagged) ─────────────

async function plannedConversations(userId: string): Promise<WorkItem[]> {
  const planned = await db.select().from(schema.circles)
    .where(and(eq(schema.circles.userId, userId), eq(schema.circles.plannedConversation, 1)))
    .limit(PER_SOURCE_LIMIT)
  return planned.map(c => makeWorkItem({
    id: `planned-conversation:${c.id}`,
    kind: 'planned-conversation',
    subject: null,
    subjectLabel: c.personName,
    title: `Follow up with ${c.personName}`,
    detail: `Proximity ring ${c.proximity} · response: ${c.response}${c.notes ? ' · ' + c.notes.slice(0, 60) : ''}`,
    dueAt: null,
    createdAt: c.createdAt,
    actionUrl: `/oikos?focus=${c.id}`,
    icon: '🗣️',
  }))
}

// ─── Source 6: stale-mentee-checkin (derived from on-chain) ───────
//
// COACHING_MENTORSHIP edges where I'm subject (I coach them) AND
// the edge.updatedAt is older than the cadence threshold. We use
// `updatedAt` as the proxy for last-touch; a fresh assertion bumps
// the edge's updatedAt timestamp via the relationship contract.

async function staleMenteeCheckins(personAgent: `0x${string}`): Promise<WorkItem[]> {
  const outIds = await getEdgesBySubject(personAgent)
  const cutoffMs = Date.now() - COACHING_CHECKIN_DAYS * 86400_000
  const out: WorkItem[] = []
  for (const id of outIds.slice(0, PER_SOURCE_LIMIT * 2)) {
    try {
      const edge = await getEdge(id)
      if (edge.relationshipType.toLowerCase() !== (COACHING_MENTORSHIP as string).toLowerCase()) continue
      if (edge.status !== 3) continue   // 3 = ACTIVE
      const updatedAtMs = Number(edge.updatedAt) * 1000
      if (updatedAtMs >= cutoffMs) continue
      const meta = await getAgentMetadata(edge.object_ as string).catch(() => null)
      out.push(makeWorkItem({
        id: `stale-mentee-checkin:${id}`,
        kind: 'stale-mentee-checkin',
        subject: edge.object_ as `0x${string}`,
        subjectLabel: meta?.displayName ?? null,
        title: `Check in with ${meta?.displayName ?? 'mentee'}`,
        detail: `No coaching activity for ${COACHING_CHECKIN_DAYS}+ days.`,
        dueAt: null,
        createdAt: new Date(updatedAtMs).toISOString(),
        actionUrl: `/agents/${edge.object_}/communicate`,
        icon: '🧭',
      }))
    } catch { /* */ }
  }
  return out.slice(0, PER_SOURCE_LIMIT)
}

// ─── Source 7: prayer-due (DB prayers fired today) ────────────────

async function prayersDue(userId: string): Promise<WorkItem[]> {
  const all = await db.select().from(schema.prayers)
    .where(and(eq(schema.prayers.userId, userId), eq(schema.prayers.answered, 0)))
    .limit(PER_SOURCE_LIMIT * 2)
  const today = new Date().toISOString().slice(0, 10)   // YYYY-MM-DD
  const todayDow = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date().getDay()]
  const due = all.filter(p => {
    const lastDay = (p.lastPrayed ?? '').slice(0, 10)
    if (lastDay === today) return false
    const sched = (p.schedule ?? 'daily').toLowerCase()
    if (sched === 'daily') return true
    return sched.split(',').map(s => s.trim()).includes(todayDow)
  }).slice(0, PER_SOURCE_LIMIT)
  return due.map(p => makeWorkItem({
    id: `prayer-due:${p.id}`,
    kind: 'prayer-due',
    subject: null,
    subjectLabel: null,
    title: `Pray: ${p.title}`,
    detail: p.notes ?? null,
    dueAt: null,
    createdAt: p.createdAt,
    actionUrl: `/nurture/prayer?focus=${p.id}`,
    icon: '🙏',
  }))
}

// ─── Source 9: match-proposed (Discover layer) ───────────────────
//
// NeedResourceMatch rows where I'm the matched agent and status is
// proposed. Surfaces as a `discover` mode work item; mode picker
// in MyWorkPanel must include `discover` for these to render.

async function matchesProposed(personAgent: `0x${string}`): Promise<WorkItem[]> {
  const rows = await db.select().from(schema.needResourceMatches)
    .where(and(
      eq(schema.needResourceMatches.matchedAgent, personAgent.toLowerCase()),
      eq(schema.needResourceMatches.status, 'proposed'),
    ))
    .limit(PER_SOURCE_LIMIT)
  if (rows.length === 0) return []
  const out: WorkItem[] = []
  for (const r of rows) {
    // Hydrate the need title for the work-item label.
    const need = await db.select().from(schema.needs)
      .where(eq(schema.needs.id, r.needId)).limit(1).then(rs => rs[0])
    if (!need) continue
    const scorePct = Math.round(r.score / 100)
    out.push(makeWorkItem({
      id: `match-proposed:${r.id}`,
      kind: 'match-proposed',
      subject: need.neededByAgent as `0x${string}`,
      subjectLabel: null,
      title: `Possible match: ${need.title}`,
      detail: `${scorePct}% fit — ${need.needTypeLabel}`,
      dueAt: null,
      createdAt: r.createdAt,
      actionUrl: `/h/catalyst/matches/${r.id}`,
      icon: '🎯',
    }))
  }
  return out
}

// ─── Source 8: walk-step-due (training cadence) ───────────────────

async function walkStepDue(userId: string): Promise<WorkItem[]> {
  const cutoff = daysAgoIso(WALK_CADENCE_DAYS)
  const recent = await db.select().from(schema.trainingProgress)
    .where(eq(schema.trainingProgress.userId, userId))
    .limit(50)
  if (recent.length === 0) {
    // First-time user — surface a "start your walk" item so the queue
    // never appears empty for a brand-new account.
    return [makeWorkItem({
      id: `walk-step-due:start:${userId}`,
      kind: 'walk-step-due',
      subject: null,
      subjectLabel: null,
      title: 'Start your discipleship walk',
      detail: 'The 28-lesson 411 program is the first track. Pick it up at any time.',
      dueAt: null,
      createdAt: new Date().toISOString(),
      actionUrl: '/grow',
      icon: '🌱',
    })]
  }
  const lastCompleted = recent
    .filter(r => r.completed === 1 && r.completedAt)
    .map(r => r.completedAt!)
    .sort()
    .pop() ?? '1970-01-01'
  if (lastCompleted >= cutoff) return []
  return [makeWorkItem({
    id: `walk-step-due:cadence:${userId}`,
    kind: 'walk-step-due',
    subject: null,
    subjectLabel: null,
    title: 'Continue your walk',
    detail: `It has been ${WALK_CADENCE_DAYS}+ days since your last step.`,
    dueAt: null,
    createdAt: new Date().toISOString(),
    actionUrl: '/grow',
    icon: '🌱',
  })]
}
