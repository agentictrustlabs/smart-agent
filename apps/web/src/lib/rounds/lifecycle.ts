/**
 * Shared round-lifecycle label resolver.
 *
 * Combines on-chain `FundRegistry.getRoundStatus` (open / review / decided
 * / closed / canceled) with the deadline + voting window timestamps to
 * produce a user-facing phase label that says what the round is *doing*
 * right now, not just its raw status.
 */

export type RoundStatus = 'open' | 'review' | 'decided' | 'closed' | 'canceled'

export interface RoundLifecycleInput {
  status: string                          // raw on-chain status (open/review/decided/…)
  deadline?: string | null                // ISO — submission deadline
  votingWindowStartsAt?: string | null
  votingWindowEndsAt?: string | null
  now?: number                            // override for tests; defaults to Date.now()
}

export interface RoundLifecycleLabel {
  /** Short user-facing label, e.g. "Accepting proposals". */
  label: string
  /** Stable phase identifier for styling: 'accepting' | 'voting' | 'reviewing' | 'decided' | 'closed' | 'canceled'. */
  phase: 'accepting' | 'voting' | 'reviewing' | 'decided' | 'closed' | 'canceled' | 'unknown'
  /** One-line caption explaining what's happening (suitable for subtitle). */
  caption: string
}

export function roundLifecycle(input: RoundLifecycleInput): RoundLifecycleLabel {
  const now = input.now ?? Date.now()
  const deadlineMs = input.deadline ? Date.parse(input.deadline) : null
  const voteStartMs = input.votingWindowStartsAt ? Date.parse(input.votingWindowStartsAt) : null
  const voteEndMs = input.votingWindowEndsAt ? Date.parse(input.votingWindowEndsAt) : null

  const status = input.status as RoundStatus

  if (status === 'canceled') {
    return { label: 'Canceled', phase: 'canceled', caption: 'This round was canceled.' }
  }
  if (status === 'closed') {
    return { label: 'Closed', phase: 'closed', caption: 'This round is closed.' }
  }
  if (status === 'decided') {
    return { label: 'Decided', phase: 'decided', caption: 'Voting ended; awards announced.' }
  }
  if (status === 'review') {
    // Status === 'review' IS the voting phase in this codebase — that's
    // what the admin's "Open for voting" action transitions to. Voting
    // window timestamps are optional bounds:
    //   - no window set       → voting is open
    //   - now < voteStartMs   → voting hasn't started yet
    //   - now > voteEndMs     → voting window closed (but status hasn't
    //                            advanced to 'decided' yet)
    if (voteStartMs && now < voteStartMs) {
      return { label: 'Awaiting voting window', phase: 'reviewing', caption: 'Voting opens at the scheduled start time.' }
    }
    if (voteEndMs && now > voteEndMs) {
      return { label: 'Voting ended', phase: 'reviewing', caption: 'Voting window closed; awaiting close/decide.' }
    }
    return { label: 'Voting', phase: 'voting', caption: 'Stewards are voting on proposals.' }
  }
  if (status === 'open') {
    // The most nuanced case — derive from the timestamps.
    if (voteStartMs && voteEndMs && now >= voteStartMs && now <= voteEndMs) {
      return { label: 'Voting', phase: 'voting', caption: 'Stewards are voting on proposals.' }
    }
    if (deadlineMs && now < deadlineMs) {
      return { label: 'Accepting proposals', phase: 'accepting', caption: 'Members may draft and submit proposals.' }
    }
    if (deadlineMs && now >= deadlineMs && (!voteStartMs || now < voteStartMs)) {
      return { label: 'Awaiting voting window', phase: 'reviewing', caption: 'Submission deadline passed; voting opens soon.' }
    }
    if (voteEndMs && now > voteEndMs) {
      return { label: 'Voting ended', phase: 'reviewing', caption: 'Voting window closed; awaiting close/decide.' }
    }
    return { label: 'Open', phase: 'accepting', caption: 'Round is open.' }
  }

  return { label: status || 'Unknown', phase: 'unknown', caption: '' }
}

/** Tailwind-style colors for the phase badge. */
export function lifecyclePalette(phase: RoundLifecycleLabel['phase']): { bg: string; fg: string; border: string } {
  switch (phase) {
    case 'accepting': return { bg: '#dcfce7', fg: '#166534', border: '#86efac' }   // green
    case 'voting':    return { bg: '#dbeafe', fg: '#1e3a8a', border: '#93c5fd' }   // blue
    case 'reviewing': return { bg: '#fef3c7', fg: '#92400e', border: '#fcd34d' }   // amber
    case 'decided':   return { bg: '#ede9fe', fg: '#5b21b6', border: '#c4b5fd' }   // violet
    case 'closed':    return { bg: '#f1f5f9', fg: '#475569', border: '#cbd5e1' }   // slate
    case 'canceled':  return { bg: '#fee2e2', fg: '#991b1b', border: '#fca5a5' }   // red
    default:          return { bg: '#f1f5f9', fg: '#475569', border: '#cbd5e1' }
  }
}
