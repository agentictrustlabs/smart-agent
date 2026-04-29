/**
 * Work queue type vocabulary — shared across the aggregator, the
 * server actions, and the components.
 *
 * The work queue is the unified inbox primitive that powers every
 * "what should I do next?" surface in the hub: Maria's governance
 * decisions, Rachel's contact follow-ups, Sophia's hand-offs, Ana's
 * prayer-for-circle queue. Same card, same panel, different filter
 * per actor + mode.
 *
 * Key design decisions (from the use-case analysis, see chat history
 * and `docs/specs/agent-skills-plan.md` history thread):
 *
 *   • No `work_items` DB table in v1 — every kind derives from an
 *     existing source (DB tables, on-chain reads). The aggregator
 *     reads + maps each call. Resolution semantics live on each
 *     source (e.g. an invite goes to `accepted`, removing the item).
 *
 *   • `mode` is the primary user-facing filter. Five modes —
 *     govern / disciple / route / walk / discover — chosen by
 *     pattern of work, not by role. A user with multi-role coverage
 *     (Maria: govern + discover; Kenji: disciple + govern) picks
 *     which mode to view via `<ModePicker>`.
 *
 *   • `kind` is the data taxonomy under the hood — eight kinds in
 *     v1, two more deferred (lead-route, hand-off) until the
 *     inbound-lead entity exists.
 */

export type WorkMode = 'govern' | 'disciple' | 'route' | 'walk' | 'discover'

export type WorkItemKind =
  /** govern — on-chain PROPOSED edge where I'm the object */
  | 'decision-edge'
  /** govern — open governance proposal in an org I'm a member of */
  | 'decision-proposal'
  /** govern — unread DB notification (relationships, ownership offers, disputes, etc.) */
  | 'message-pending'
  /** govern — derived: org I control with no public profile / claims / controllers */
  | 'manage-orphan'
  /** disciple — circle/oikos contact with plannedConversation = 1 */
  | 'planned-conversation'
  /** disciple — coaching edge whose last assertion is older than threshold */
  | 'stale-mentee-checkin'
  /** walk — prayer scheduled for today and not yet prayed */
  | 'prayer-due'
  /** walk — training-progress cadence due (28-lesson walk) */
  | 'walk-step-due'
  /** discover — NeedResourceMatch proposed for me, awaiting decision */
  | 'match-proposed'

export interface WorkItem {
  /** Stable id — `kind:source-pk` so re-aggregation is idempotent at render time. */
  id: string
  kind: WorkItemKind
  mode: WorkMode
  /** Agent address this item is about (org for governance, contact for follow-up). Null for self-only. */
  subject: `0x${string}` | null
  /** Human-readable label for `subject`, when known. */
  subjectLabel: string | null
  title: string
  detail: string | null
  /** ISO timestamp; null = no specific due date (just "needs attention"). */
  dueAt: string | null
  createdAt: string
  /** Where to go to act — route or anchor. */
  actionUrl: string
  /** Single-emoji icon hint; the UI may also dispatch on `kind` for richer visuals. */
  icon: string
}

export const KIND_TO_MODE: Record<WorkItemKind, WorkMode> = {
  'decision-edge':         'govern',
  'decision-proposal':     'govern',
  'message-pending':       'govern',
  'manage-orphan':         'govern',
  'planned-conversation':  'disciple',
  'stale-mentee-checkin':  'disciple',
  'prayer-due':            'walk',
  'walk-step-due':         'walk',
  'match-proposed':        'discover',
}

export const MODE_LABEL: Record<WorkMode, string> = {
  govern:   'Govern',
  disciple: 'Disciple',
  route:    'Route',
  walk:     'Walk',
  discover: 'Discover',
}

/** Short blurb shown when a mode has zero items. */
export const MODE_EMPTY_HINT: Record<WorkMode, string> = {
  govern:   'No decisions waiting. Proposals, edge confirmations, and review requests will appear here.',
  disciple: 'No follow-ups due. Contacts you flag for "planned conversation" and stale coaching check-ins surface here.',
  route:    'Route mode is coming soon — inbound-lead routing for Dispatchers and Digital Responders is v2.',
  walk:     'Nothing on your walk today. Daily prayers and training-progress steps surface here.',
  discover: 'No proposed matches right now. The Discover surface generates new matches when you visit it.',
}
