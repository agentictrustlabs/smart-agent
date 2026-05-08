/**
 * Typed write-side helper for FundRegistry (Phase 0.4).
 *
 * Manages both Fund subjects (Fund agent address) and Round subjects
 * (synthetic id keccak256("sa:round:" + roundId)).
 */
import {
  keccak256,
  toHex,
  encodePacked,
  type Address,
  type Hex,
  type WalletClient,
  type PublicClient,
} from 'viem'

import { fundRegistryAbi } from '../../abi'

export type RoundStatus = 'open' | 'review' | 'decided' | 'closed' | 'canceled'
export type RoundVisibility = 'public' | 'private'

const STATUS_CONCEPT: Record<RoundStatus, string> = {
  open: 'sa:RoundOpen',
  review: 'sa:RoundReview',
  decided: 'sa:RoundDecided',
  closed: 'sa:RoundClosed',
  canceled: 'sa:RoundCanceled',
}
const VISIBILITY_CONCEPT: Record<RoundVisibility, string> = {
  public: 'sa:VisibilityPublic',
  private: 'sa:VisibilityPrivate',
}

function concept(curie: string): Hex {
  return keccak256(toHex(curie))
}

/** Compute the canonical round subject id for an off-chain string id. */
export function roundSubjectFor(roundId: string): Hex {
  return keccak256(encodePacked(['string', 'string'], ['sa:round:', roundId]))
}

export interface OpenRoundInput {
  /** Off-chain canonical round id slug (e.g. 'q2-2026-trauma-care'). */
  roundId: string
  /** Fund's agent address. */
  fundAgent: Address
  /** Unix seconds; the registry shape requires REQUIRED_ONE uint256. */
  deadline: bigint
  decisionDate: bigint
  /** Free-text reporting cadence (e.g. 'sa:CadenceQuarterly'). */
  reportingCadence: string
  /** Free-text credential identifiers. */
  requiredCredentials?: string[]
  visibility: RoundVisibility
  initialStatus?: RoundStatus
  /** JSON-encoded round mandate (acceptedKinds, geoScope, etc.). */
  mandate?: string
  /** JSON-encoded milestone template. */
  milestoneTemplate?: string
  /** JSON-encoded validator requirements. */
  validatorRequirements?: string
}

// roundId itself is the slug used for IRI derivation; the buildOpenParams
// helper passes it as p.slug.

export interface FundRegistryClientConfig {
  registryAddress: Address
  walletClient: WalletClient
  publicClient: PublicClient
}

export class FundRegistryClient {
  constructor(private cfg: FundRegistryClientConfig) {}

  static buildOpenParams(input: OpenRoundInput) {
    return {
      roundSubject: roundSubjectFor(input.roundId),
      fundAgent: input.fundAgent,
      deadline: input.deadline,
      decisionDate: input.decisionDate,
      reportingCadence: concept(input.reportingCadence),
      requiredCredentials: (input.requiredCredentials ?? []).map(concept),
      visibility: concept(VISIBILITY_CONCEPT[input.visibility]),
      initialStatus: concept(STATUS_CONCEPT[input.initialStatus ?? 'open']),
      mandate: input.mandate ?? '',
      milestoneTemplate: input.milestoneTemplate ?? '',
      validatorRequirements: input.validatorRequirements ?? '',
      slug: input.roundId,
    } as const
  }

  async registerFund(fundAgent: Address, acceptedKinds: string[], openForCalls: boolean): Promise<Hex> {
    const account = this.cfg.walletClient.account
    if (!account) throw new Error('FundRegistryClient.registerFund: walletClient has no account')
    const hash = await this.cfg.walletClient.writeContract({
      address: this.cfg.registryAddress,
      abi: fundRegistryAbi,
      functionName: 'registerFund',
      args: [fundAgent, acceptedKinds.map(concept), openForCalls],
      account,
      chain: this.cfg.walletClient.chain ?? null,
    })
    await this.cfg.publicClient.waitForTransactionReceipt({ hash })
    return hash
  }

  async openRound(input: OpenRoundInput): Promise<{ txHash: Hex; roundSubject: Hex }> {
    const params = FundRegistryClient.buildOpenParams(input)
    const account = this.cfg.walletClient.account
    if (!account) throw new Error('FundRegistryClient.openRound: walletClient has no account')
    const hash = await this.cfg.walletClient.writeContract({
      address: this.cfg.registryAddress,
      abi: fundRegistryAbi,
      functionName: 'openRound',
      args: [params],
      account,
      chain: this.cfg.walletClient.chain ?? null,
    })
    await this.cfg.publicClient.waitForTransactionReceipt({ hash })
    return { txHash: hash, roundSubject: params.roundSubject }
  }

  async setRoundStatus(roundId: string, newStatus: RoundStatus): Promise<Hex> {
    const account = this.cfg.walletClient.account
    if (!account) throw new Error('FundRegistryClient.setRoundStatus: walletClient has no account')
    const hash = await this.cfg.walletClient.writeContract({
      address: this.cfg.registryAddress,
      abi: fundRegistryAbi,
      functionName: 'setRoundStatus',
      args: [roundSubjectFor(roundId), concept(STATUS_CONCEPT[newStatus])],
      account,
      chain: this.cfg.walletClient.chain ?? null,
    })
    await this.cfg.publicClient.waitForTransactionReceipt({ hash })
    return hash
  }

  async setRoundAwardsRoot(roundId: string, awardsRoot: Hex, disputeUntil: bigint): Promise<Hex> {
    const account = this.cfg.walletClient.account
    if (!account) throw new Error('FundRegistryClient.setRoundAwardsRoot: walletClient has no account')
    const hash = await this.cfg.walletClient.writeContract({
      address: this.cfg.registryAddress,
      abi: fundRegistryAbi,
      functionName: 'setRoundAwardsRoot',
      args: [roundSubjectFor(roundId), awardsRoot, disputeUntil],
      account,
      chain: this.cfg.walletClient.chain ?? null,
    })
    await this.cfg.publicClient.waitForTransactionReceipt({ hash })
    return hash
  }

  async setRoundMandate(roundId: string, mandateJson: string): Promise<Hex> {
    const account = this.cfg.walletClient.account
    if (!account) throw new Error('FundRegistryClient.setRoundMandate: walletClient has no account')
    const hash = await this.cfg.walletClient.writeContract({
      address: this.cfg.registryAddress,
      abi: fundRegistryAbi,
      functionName: 'setRoundMandate',
      args: [roundSubjectFor(roundId), mandateJson],
      account,
      chain: this.cfg.walletClient.chain ?? null,
    })
    await this.cfg.publicClient.waitForTransactionReceipt({ hash })
    return hash
  }

  async setRoundMilestoneTemplate(roundId: string, templateJson: string): Promise<Hex> {
    const account = this.cfg.walletClient.account
    if (!account) throw new Error('FundRegistryClient.setRoundMilestoneTemplate: walletClient has no account')
    const hash = await this.cfg.walletClient.writeContract({
      address: this.cfg.registryAddress,
      abi: fundRegistryAbi,
      functionName: 'setRoundMilestoneTemplate',
      args: [roundSubjectFor(roundId), templateJson],
      account,
      chain: this.cfg.walletClient.chain ?? null,
    })
    await this.cfg.publicClient.waitForTransactionReceipt({ hash })
    return hash
  }

  async setRoundValidatorRequirements(roundId: string, requirementsJson: string): Promise<Hex> {
    const account = this.cfg.walletClient.account
    if (!account) throw new Error('FundRegistryClient.setRoundValidatorRequirements: walletClient has no account')
    const hash = await this.cfg.walletClient.writeContract({
      address: this.cfg.registryAddress,
      abi: fundRegistryAbi,
      functionName: 'setRoundValidatorRequirements',
      args: [roundSubjectFor(roundId), requirementsJson],
      account,
      chain: this.cfg.walletClient.chain ?? null,
    })
    await this.cfg.publicClient.waitForTransactionReceipt({ hash })
    return hash
  }

  // ─── Read helpers ──────────────────────────────────────────────

  async getRoundMandate(roundId: string): Promise<string> {
    const result = await this.cfg.publicClient.readContract({
      address: this.cfg.registryAddress,
      abi: fundRegistryAbi,
      functionName: 'getRoundMandate',
      args: [roundSubjectFor(roundId)],
    })
    return result as string
  }

  async getRoundMilestoneTemplate(roundId: string): Promise<string> {
    const result = await this.cfg.publicClient.readContract({
      address: this.cfg.registryAddress,
      abi: fundRegistryAbi,
      functionName: 'getRoundMilestoneTemplate',
      args: [roundSubjectFor(roundId)],
    })
    return result as string
  }

  async getRoundValidatorRequirements(roundId: string): Promise<string> {
    const result = await this.cfg.publicClient.readContract({
      address: this.cfg.registryAddress,
      abi: fundRegistryAbi,
      functionName: 'getRoundValidatorRequirements',
      args: [roundSubjectFor(roundId)],
    })
    return result as string
  }

  /** Read the round's stored slug given its on-chain subject hash. Used by
   *  the on-chain → GraphDB sync to derive the canonical urn:smart-agent:round:<slug> IRI. */
  async getRoundSlug(roundSubject: Hex): Promise<string> {
    const result = await this.cfg.publicClient.readContract({
      address: this.cfg.registryAddress,
      abi: fundRegistryAbi,
      functionName: 'getRoundSlug',
      args: [roundSubject],
    })
    return result as string
  }
}
