/**
 * Voting strategy abstraction (Sprint A).
 *
 * Per output/voting-and-admin-plan.md. v1 ships `steward-quorum` only —
 * other strategies (member-approval, quadratic, ranked-choice) plug in
 * later by adding entries to the STRATEGIES map.
 *
 * The strategy decides:
 *   - Who's eligible to vote (eligibility(viewer, round))
 *   - How votes translate into a winning slate (decide(ballots, proposals))
 *   - UI copy for each phase
 */
import { canManageAgent } from '@/lib/agent-registry'

export type VotingStrategyName =
  | 'steward-quorum'
  | 'member-approval'
  | 'quadratic'
  | 'ranked-choice'

export interface VoteRow {
  id: string
  roundId: string
  proposalId: string
  voterAgentId: string
  vote: 'approve' | 'reject' | 'abstain'
  weight: number
  rationale?: string | null
  castAt: string
}

export interface RoundForStrategy {
  id: string
  fundAgentId: string
  votingStrategy: VotingStrategyName
  votingThreshold: number
  votingWindowStartsAt: string | null
  votingWindowEndsAt: string | null
}

export interface VoterEligibility {
  canVote: boolean
  weight: number
  reason?: string
}

export interface TallyEntry {
  proposalId: string
  approves: number
  rejects: number
  abstains: number
  totalWeight: number
  passes: boolean
}

export interface VotingStrategy {
  name: VotingStrategyName
  /** Compute eligibility + voting weight for a viewer. */
  eligibility(viewer: string, round: RoundForStrategy): Promise<VoterEligibility>
  /** Apply the threshold to a tally to determine winners. */
  decide(tally: TallyEntry[], threshold: number): TallyEntry[]
  /** Human-readable copy used by the UI per phase. */
  copy: {
    ballotPrompt: string
    eligibilityMessage: (e: VoterEligibility) => string
    tallyHeading: string
    resultLine: (e: TallyEntry, threshold: number) => string
  }
}

// ─── steward-quorum ─────────────────────────────────────────────────

const stewardQuorum: VotingStrategy = {
  name: 'steward-quorum',
  async eligibility(viewer, round) {
    if (!viewer) return { canVote: false, weight: 0, reason: 'not-authenticated' }
    // Spec 004 moved authorization to the credential layer: the actual
    // cast path requires a RoundVoterCredential + admin→holder delegation
    // (see castVote). The UI eligibility check used to gate on steward
    // status, but that's pre-spec-004 and locks out non-steward voters
    // that the round admin explicitly granted a cred to. The cast path
    // will surface a clear error if a non-steward without a cred clicks
    // Vote — the UI just shouldn't pre-block them.
    void canManageAgent // kept for future per-strategy gating
    const now = Date.now()
    if (round.votingWindowStartsAt && now < Date.parse(round.votingWindowStartsAt)) {
      return { canVote: false, weight: 0, reason: 'voting-not-started' }
    }
    if (round.votingWindowEndsAt && now > Date.parse(round.votingWindowEndsAt)) {
      return { canVote: false, weight: 0, reason: 'voting-closed' }
    }
    return { canVote: true, weight: 1 }
  },
  decide(tally, threshold) {
    return tally.filter((e) => e.approves >= threshold)
  },
  copy: {
    ballotPrompt: 'Approve, reject, or abstain on this proposal',
    eligibilityMessage: (e) => {
      if (e.canVote) return 'You can vote on proposals in this round.'
      switch (e.reason) {
        case 'not-a-steward': return 'Only stewards of the operating fund can vote.'
        case 'voting-not-started': return 'Voting opens after the submission deadline.'
        case 'voting-closed': return 'Voting window has closed.'
        case 'not-authenticated': return 'Sign in to vote.'
        default: return 'You cannot vote on this round.'
      }
    },
    tallyHeading: 'Steward votes',
    resultLine: (e, threshold) =>
      e.passes
        ? `Awarded — ${e.approves} approve / ${threshold} required`
        : `Not awarded — ${e.approves} approve / ${threshold} required`,
  },
}

// ─── Stubs for future strategies ────────────────────────────────────

const memberApproval: VotingStrategy = { ...stewardQuorum, name: 'member-approval' }
const quadratic: VotingStrategy = { ...stewardQuorum, name: 'quadratic' }
const rankedChoice: VotingStrategy = { ...stewardQuorum, name: 'ranked-choice' }

export const STRATEGIES: Record<VotingStrategyName, VotingStrategy> = {
  'steward-quorum': stewardQuorum,
  'member-approval': memberApproval,
  'quadratic': quadratic,
  'ranked-choice': rankedChoice,
}

export function getStrategy(name: VotingStrategyName | string): VotingStrategy {
  const s = STRATEGIES[name as VotingStrategyName]
  if (!s) throw new Error(`unknown voting strategy: ${name}`)
  return s
}
