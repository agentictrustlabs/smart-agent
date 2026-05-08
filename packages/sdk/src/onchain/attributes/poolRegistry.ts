/**
 * Typed write-side helper for PoolRegistry (Phase 0.3).
 *
 * Encodes the input shape used by the action layer and demo seeds into the
 * on-chain `OpenParams` struct. Hashes free-text concept slugs into the
 * canonical `bytes32` ids the registry's shape validator expects.
 */
import {
  keccak256,
  toHex,
  type Address,
  type Hex,
  type WalletClient,
  type PublicClient,
} from 'viem'

import { poolRegistryAbi } from '../../abi'

export type PoolGovernanceModel = 'fund' | 'giving-circle' | 'daf' | 'open-call'
export type PoolCeilingPolicy = 'block' | 'waitlist' | 'accept'
export type PoolVisibility = 'public' | 'private'

const GOVERNANCE_CONCEPT: Record<PoolGovernanceModel, string> = {
  daf: 'sa:GovDAF',
  'giving-circle': 'sa:GovGivingCircle',
  fund: 'sa:GovFund',
  'open-call': 'sa:GovOpenCall',
}
const CEILING_CONCEPT: Record<PoolCeilingPolicy, string> = {
  block: 'sa:CeilingBlock',
  waitlist: 'sa:CeilingWaitlist',
  accept: 'sa:CeilingAccept',
}
const VISIBILITY_CONCEPT: Record<PoolVisibility, string> = {
  public: 'sa:VisibilityPublic',
  private: 'sa:VisibilityPrivate',
}

function concept(curie: string): Hex {
  return keccak256(toHex(curie))
}

/**
 * Map the action layer's `governanceModel` field (which historically also
 * mixed in pool-kind values like 'coaching-network') to the canonical
 * governance enum. Non-fund kinds collapse to `open-call`; the kind itself
 * lives in `domain` instead.
 */
export function normalizeGovernance(input: string): PoolGovernanceModel {
  if (input === 'fund') return 'fund'
  if (input === 'giving-circle') return 'giving-circle'
  if (input === 'daf') return 'daf'
  return 'open-call'
}

export interface OpenPoolInput {
  /** Pool's smart-account address (already deployed). */
  poolAgent: Address
  /** Free-text domain slug (e.g. 'faith-network', 'coaching-network'). */
  domain: string
  governanceModel: PoolGovernanceModel
  /** Hex of `keccak256(canonical mandate JSON)`. */
  mandateHash: Hex
  /** Optional mandate URI (ipfs://… or https://…). */
  mandateURI?: string
  /** Free-text unit slugs (e.g. 'usdc', 'hours'). */
  acceptedUnits?: string[]
  /** Free-text intent kind slugs (e.g. 'sa:GivingKind'). */
  acceptedKinds: string[]
  ceilingPolicy: PoolCeilingPolicy
  /** USDC subunits or other amount; 0 = unlimited. */
  capacityCeiling?: bigint
  stewards: Address[]
  visibility: PoolVisibility
  /** JSON-encoded acceptance restrictions (e.g. {minPledge: 100}). */
  acceptedRestrictions?: string
  /** Off-chain slug for IRI derivation (e.g. "demo-trauma-care-pool"). */
  slug?: string
}

export interface PoolRegistryClientConfig {
  registryAddress: Address
  walletClient: WalletClient
  publicClient: PublicClient
}

export class PoolRegistryClient {
  constructor(private cfg: PoolRegistryClientConfig) {}

  /** Build the `OpenParams` struct for `PoolRegistry.open(...)`. */
  static buildOpenParams(input: OpenPoolInput) {
    return {
      poolAgent: input.poolAgent,
      domain: concept(input.domain),
      governanceModel: concept(GOVERNANCE_CONCEPT[input.governanceModel]),
      mandateHash: input.mandateHash,
      mandateURI: input.mandateURI ?? '',
      acceptedUnits: (input.acceptedUnits ?? []).map(concept),
      acceptedKinds: input.acceptedKinds.map(concept),
      ceilingPolicy: concept(CEILING_CONCEPT[input.ceilingPolicy]),
      capacityCeiling: input.capacityCeiling ?? 0n,
      stewards: input.stewards,
      visibility: concept(VISIBILITY_CONCEPT[input.visibility]),
      acceptedRestrictions: input.acceptedRestrictions ?? '',
      slug: input.slug ?? '',
    } as const
  }

  /**
   * Submit `PoolRegistry.open(params)` as a direct tx from the wallet
   * client's account. Caller must be an owner of `input.poolAgent`'s
   * AgentAccount.
   */
  async open(input: OpenPoolInput): Promise<Hex> {
    const params = PoolRegistryClient.buildOpenParams(input)
    const account = this.cfg.walletClient.account
    if (!account) throw new Error('PoolRegistryClient.open: walletClient has no account')
    const hash = await this.cfg.walletClient.writeContract({
      address: this.cfg.registryAddress,
      abi: poolRegistryAbi,
      functionName: 'open',
      args: [params],
      account,
      chain: this.cfg.walletClient.chain ?? null,
    })
    await this.cfg.publicClient.waitForTransactionReceipt({ hash })
    return hash
  }

  async close(poolAgent: Address): Promise<Hex> {
    const account = this.cfg.walletClient.account
    if (!account) throw new Error('PoolRegistryClient.close: walletClient has no account')
    const hash = await this.cfg.walletClient.writeContract({
      address: this.cfg.registryAddress,
      abi: poolRegistryAbi,
      functionName: 'close',
      args: [poolAgent],
      account,
      chain: this.cfg.walletClient.chain ?? null,
    })
    await this.cfg.publicClient.waitForTransactionReceipt({ hash })
    return hash
  }

  async updateMandate(poolAgent: Address, newMandateHash: Hex, newMandateURI = ''): Promise<Hex> {
    const account = this.cfg.walletClient.account
    if (!account) throw new Error('PoolRegistryClient.updateMandate: walletClient has no account')
    const hash = await this.cfg.walletClient.writeContract({
      address: this.cfg.registryAddress,
      abi: poolRegistryAbi,
      functionName: 'updateMandate',
      args: [poolAgent, newMandateHash, newMandateURI],
      account,
      chain: this.cfg.walletClient.chain ?? null,
    })
    await this.cfg.publicClient.waitForTransactionReceipt({ hash })
    return hash
  }

  async rotateStewards(poolAgent: Address, stewards: Address[]): Promise<Hex> {
    const account = this.cfg.walletClient.account
    if (!account) throw new Error('PoolRegistryClient.rotateStewards: walletClient has no account')
    const hash = await this.cfg.walletClient.writeContract({
      address: this.cfg.registryAddress,
      abi: poolRegistryAbi,
      functionName: 'rotateStewards',
      args: [poolAgent, stewards],
      account,
      chain: this.cfg.walletClient.chain ?? null,
    })
    await this.cfg.publicClient.waitForTransactionReceipt({ hash })
    return hash
  }

  async setAcceptedRestrictions(poolAgent: Address, restrictionsJson: string): Promise<Hex> {
    const account = this.cfg.walletClient.account
    if (!account) throw new Error('PoolRegistryClient.setAcceptedRestrictions: walletClient has no account')
    const hash = await this.cfg.walletClient.writeContract({
      address: this.cfg.registryAddress,
      abi: poolRegistryAbi,
      functionName: 'setAcceptedRestrictions',
      args: [poolAgent, restrictionsJson],
      account,
      chain: this.cfg.walletClient.chain ?? null,
    })
    await this.cfg.publicClient.waitForTransactionReceipt({ hash })
    return hash
  }

  async getAcceptedRestrictions(poolAgent: Address): Promise<string> {
    const result = await this.cfg.publicClient.readContract({
      address: this.cfg.registryAddress,
      abi: poolRegistryAbi,
      functionName: 'getAcceptedRestrictions',
      args: [poolAgent],
    })
    return result as string
  }

  /** Read pool's off-chain slug. Used by on-chain → GraphDB sync to derive
   *  the canonical urn:smart-agent:pool:<slug> IRI. */
  async getPoolSlug(poolAgent: Address): Promise<string> {
    const result = await this.cfg.publicClient.readContract({
      address: this.cfg.registryAddress,
      abi: poolRegistryAbi,
      functionName: 'getPoolSlug',
      args: [poolAgent],
    })
    return result as string
  }
}
