/**
 * Spec 004 — Thin client classes for the on-chain marketplace registries.
 *
 * Each class wraps one registry contract and exposes a typed surface for
 * the org-mcp gateway to use when relaying marketplace actions on chain.
 * They follow the existing FundRegistryClient shape (encode + writeContract +
 * waitForTransactionReceipt).
 *
 * Auth note: writes only succeed when the calling EOA is an owner of the
 * registry's authority account (round.fundAgent for vote/grantProposal,
 * pool.poolAgent for pledge, publisher for matchInitiation). The gateway
 * either calls these directly with its session key (when redeem-via-account
 * applies) or builds calldata + redeems it through DelegationManager.
 */

import type { Address, Hex, PublicClient, WalletClient } from 'viem'
import { keccak256, toHex, encodeFunctionData, encodePacked } from 'viem'
import {
  voteRegistryAbi,
  grantProposalRegistryAbi,
  pledgeRegistryAbi,
  matchInitiationRegistryAbi,
} from '../../abi'

// ─── Shared helpers ──────────────────────────────────────────────────

function concept(curie: string): Hex {
  return keccak256(toHex(curie)) as Hex
}

export type Ballot = 'approve' | 'reject' | 'abstain'
const BALLOT_CONCEPT: Record<Ballot, string> = {
  approve: 'sa:Approve',
  reject:  'sa:Reject',
  abstain: 'sa:Abstain',
}

export type Cadence = 'one-time' | 'monthly' | 'annual' | 'recurring'
const CADENCE_CONCEPT: Record<Cadence, string> = {
  'one-time':  'sa:CadenceOneTime',
  'monthly':   'sa:CadenceMonthly',
  'annual':    'sa:CadenceAnnual',
  'recurring': 'sa:CadenceRecurring',
}

export type InitiationKind = 'self' | 'connector'
const INITIATION_KIND_CONCEPT: Record<InitiationKind, string> = {
  self:      'sa:Self',
  connector: 'sa:Connector',
}

export type MatchVisibility = 'public' | 'public-coarse' | 'private'
const MATCH_VISIBILITY_CONCEPT: Record<MatchVisibility, string> = {
  'public':        'sa:VisibilityPublic',
  'public-coarse': 'sa:VisibilityPublicCoarse',
  'private':       'sa:VisibilityPrivate',
}

export interface ClientConfig {
  registryAddress: Address
  walletClient: WalletClient
  publicClient: PublicClient
}

// ─── VoteRegistry ────────────────────────────────────────────────────

export interface CastVoteInput {
  roundSubject: Hex
  nullifier: Hex
  proposalSubject: Hex
  ballot: Ballot
  weight: bigint
  rationale?: string
}

export class VoteRegistryClient {
  constructor(private cfg: ClientConfig) {}

  static buildCastVote(input: CastVoteInput) {
    return {
      roundSubject: input.roundSubject,
      nullifier: input.nullifier,
      proposalSubject: input.proposalSubject,
      ballot: concept(BALLOT_CONCEPT[input.ballot]),
      weight: input.weight,
      rationale: input.rationale ?? '',
    } as const
  }

  static encodeCastVote(input: CastVoteInput): Hex {
    return encodeFunctionData({
      abi: voteRegistryAbi,
      functionName: 'castVote',
      args: [VoteRegistryClient.buildCastVote(input)],
    })
  }

  async castVote(input: CastVoteInput): Promise<{ txHash: Hex }> {
    const account = this.cfg.walletClient.account
    if (!account) throw new Error('VoteRegistryClient.castVote: walletClient has no account')
    const hash = await this.cfg.walletClient.writeContract({
      address: this.cfg.registryAddress,
      abi: voteRegistryAbi,
      functionName: 'castVote',
      args: [VoteRegistryClient.buildCastVote(input)],
      account,
      chain: this.cfg.walletClient.chain ?? null,
    })
    await this.cfg.publicClient.waitForTransactionReceipt({ hash })
    return { txHash: hash }
  }
}

// ─── GrantProposalRegistry ───────────────────────────────────────────

export interface SubmitGrantProposalInput {
  roundSubject: Hex
  nullifier: Hex
  displayName: string
  basedOnIntentId: string
  budgetJson: string
  planJson: string
  milestonesJson: string
  outcomesJson: string
  reportingJson: string
  orgBackgroundJson: string
  basisJson?: string
  /** Recipient AgentAccount that will receive funds at award time
   *  (the proposer's hub-org `sa:hasTreasury`). MUST be non-zero — the
   *  contract reverts with `MissingRecipient` otherwise. */
  recipient: Address
}

export interface EditGrantProposalInput {
  proposalSubject: Hex
  patch: {
    budgetJson?: string
    planJson?: string
    milestonesJson?: string
    outcomesJson?: string
    reportingJson?: string
    orgBackgroundJson?: string
  }
}

export class GrantProposalRegistryClient {
  constructor(private cfg: ClientConfig) {}

  static buildSubmit(input: SubmitGrantProposalInput) {
    return {
      roundSubject: input.roundSubject,
      nullifier: input.nullifier,
      displayName: input.displayName,
      basedOnIntentId: input.basedOnIntentId,
      budgetJson: input.budgetJson,
      planJson: input.planJson,
      milestonesJson: input.milestonesJson,
      outcomesJson: input.outcomesJson,
      reportingJson: input.reportingJson,
      orgBackgroundJson: input.orgBackgroundJson,
      basisJson: input.basisJson ?? '',
      recipient: input.recipient,
    } as const
  }

  static encodeSubmit(input: SubmitGrantProposalInput): Hex {
    return encodeFunctionData({
      abi: grantProposalRegistryAbi,
      functionName: 'submit',
      args: [GrantProposalRegistryClient.buildSubmit(input)],
    })
  }

  static encodeEdit(input: EditGrantProposalInput): Hex {
    const p = input.patch
    return encodeFunctionData({
      abi: grantProposalRegistryAbi,
      functionName: 'edit',
      args: [input.proposalSubject, {
        editBudget:           p.budgetJson !== undefined,
        newBudgetJson:        p.budgetJson ?? '',
        editPlan:             p.planJson !== undefined,
        newPlanJson:          p.planJson ?? '',
        editMilestones:       p.milestonesJson !== undefined,
        newMilestonesJson:    p.milestonesJson ?? '',
        editOutcomes:         p.outcomesJson !== undefined,
        newOutcomesJson:      p.outcomesJson ?? '',
        editReporting:        p.reportingJson !== undefined,
        newReportingJson:     p.reportingJson ?? '',
        editOrgBackground:    p.orgBackgroundJson !== undefined,
        newOrgBackgroundJson: p.orgBackgroundJson ?? '',
      }],
    })
  }

  static encodeWithdraw(proposalSubject: Hex): Hex {
    return encodeFunctionData({
      abi: grantProposalRegistryAbi,
      functionName: 'withdraw',
      args: [proposalSubject],
    })
  }
}

// ─── PledgeRegistry ──────────────────────────────────────────────────

export interface SubmitPledgeInput {
  poolAgent: Address
  nullifier: Hex
  salt: bigint
  amount: bigint
  unit: string                    // 'USD' | 'prayer-minutes' | ... — hashed to concept
  cadence: Cadence
  duration?: bigint
  restrictionsJson?: string
  storyPermissionsJson?: string
}

export class PledgeRegistryClient {
  constructor(private cfg: ClientConfig) {}

  static buildSubmit(input: SubmitPledgeInput) {
    return {
      poolAgent: input.poolAgent,
      nullifier: input.nullifier,
      salt: input.salt,
      amount: input.amount,
      unit: concept(input.unit),
      cadence: concept(CADENCE_CONCEPT[input.cadence]),
      duration: input.duration ?? 0n,
      restrictionsJson: input.restrictionsJson ?? '',
      storyPermissionsJson: input.storyPermissionsJson ?? '',
    } as const
  }

  static encodeSubmit(input: SubmitPledgeInput): Hex {
    return encodeFunctionData({
      abi: pledgeRegistryAbi,
      functionName: 'submit',
      args: [PledgeRegistryClient.buildSubmit(input)],
    })
  }

  static encodeAmend(input: { pledgeSubject: Hex; newAmount: bigint; newDuration?: bigint }): Hex {
    return encodeFunctionData({
      abi: pledgeRegistryAbi,
      functionName: 'amend',
      args: [input.pledgeSubject, input.newAmount, input.newDuration ?? 0n],
    })
  }

  static encodeStop(pledgeSubject: Hex): Hex {
    return encodeFunctionData({
      abi: pledgeRegistryAbi,
      functionName: 'stop',
      args: [pledgeSubject],
    })
  }

  /** Deterministic subject derivation matching the on-chain
   *  `_pledgeSubject(poolAgent, nullifier, salt)` formula:
   *  `keccak256(abi.encodePacked("sa:pledge:", poolAgent, nullifier, salt))`. */
  static pledgeSubject(poolAgent: Address, nullifier: Hex, salt: bigint): Hex {
    return keccak256(
      encodePacked(
        ['string', 'address', 'bytes32', 'uint256'],
        ['sa:pledge:', poolAgent, nullifier, salt],
      ),
    ) as Hex
  }
}

// ─── MatchInitiationRegistry ─────────────────────────────────────────

export interface CreateMatchInitiationInput {
  viewedIntentId: string
  candidateIntentId: string
  initiatorNullifier: Hex
  initiationKind: InitiationKind
  visibility: MatchVisibility
  basisJson?: string
  publisher: Address
}

export class MatchInitiationRegistryClient {
  constructor(private cfg: ClientConfig) {}

  static buildCreate(input: CreateMatchInitiationInput) {
    return {
      viewedIntentId: input.viewedIntentId,
      candidateIntentId: input.candidateIntentId,
      initiatorNullifier: input.initiatorNullifier,
      initiationKind: concept(INITIATION_KIND_CONCEPT[input.initiationKind]),
      visibility: concept(MATCH_VISIBILITY_CONCEPT[input.visibility]),
      basisJson: input.basisJson ?? '',
      publisher: input.publisher,
    } as const
  }

  static encodeCreate(input: CreateMatchInitiationInput): Hex {
    return encodeFunctionData({
      abi: matchInitiationRegistryAbi,
      functionName: 'create',
      args: [MatchInitiationRegistryClient.buildCreate(input)],
    })
  }

  static encodeSetStatus(input: { miSubject: Hex; newStatus: Hex; publisher: Address }): Hex {
    return encodeFunctionData({
      abi: matchInitiationRegistryAbi,
      functionName: 'setStatus',
      args: [input.miSubject, input.newStatus, input.publisher],
    })
  }
}
