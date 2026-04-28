/**
 * SDK client for SkillIssuerRegistry — the v1 on-chain registry of
 * trusted skill issuers. Replaces the v0/v1 "signed manifest in repo"
 * pattern with permissioned writes (curator-only register/slash) and
 * permissionless reads (`canIssue` / `trustWeight` for scoring).
 *
 * Mirrors the shape of `AgentSkillClient` and `GeoFeatureClient`.
 */

import type { Address, Hex, PublicClient, WalletClient } from 'viem'
import { skillIssuerRegistryAbi } from './abi'

/** Wildcard skillId — matches any skill. */
export const ANY_SKILL: Hex = '0x0000000000000000000000000000000000000000000000000000000000000000'

export interface IssuerProfile {
  account: Address
  did: string
  metadataURI: string
  trustWeight: number
  stakeWei: bigint
  registeredAt: bigint
  active: boolean
}

export interface RegisterIssuerInput {
  account: Address
  did: string
  trustWeight: number      // 0..10000
  initialStakeWei?: bigint // bookkeeping; not custodied yet
  metadataURI?: string
  skillIds?: Hex[]         // pass [ANY_SKILL] for wildcard
}

export class SkillIssuerClient {
  constructor(
    private readonly publicClient: PublicClient,
    private readonly registryAddress: Address,
  ) {}

  // ─── Reads ──────────────────────────────────────────────────────

  async getIssuer(account: Address): Promise<IssuerProfile> {
    return await this.publicClient.readContract({
      address: this.registryAddress,
      abi: skillIssuerRegistryAbi,
      functionName: 'getIssuer',
      args: [account],
    }) as IssuerProfile
  }

  async issuerByDid(did: string): Promise<Address> {
    return await this.publicClient.readContract({
      address: this.registryAddress,
      abi: skillIssuerRegistryAbi,
      functionName: 'issuerByDid',
      args: [did],
    }) as Address
  }

  async isRegistered(account: Address): Promise<boolean> {
    return await this.publicClient.readContract({
      address: this.registryAddress,
      abi: skillIssuerRegistryAbi,
      functionName: 'isRegistered',
      args: [account],
    }) as boolean
  }

  async isActive(account: Address): Promise<boolean> {
    return await this.publicClient.readContract({
      address: this.registryAddress,
      abi: skillIssuerRegistryAbi,
      functionName: 'isActive',
      args: [account],
    }) as boolean
  }

  /**
   * Authority probe: is `account` registered, active, and authorised
   * for `skillId` (either explicitly or via ANY_SKILL)? Returns false
   * for unknown issuers — callers must not treat false as a hard veto;
   * the registry is advisory at scoring time, not gate-keeping at mint.
   */
  async canIssue(account: Address, skillId: Hex): Promise<boolean> {
    return await this.publicClient.readContract({
      address: this.registryAddress,
      abi: skillIssuerRegistryAbi,
      functionName: 'canIssue',
      args: [account, skillId],
    }) as boolean
  }

  /**
   * Issuer-trust weight (0..10000). Returns 0 for unregistered issuers.
   * Scorer code should fall back to its default trust floor (typically
   * 1.0× = 10000) when this returns 0 — silence on the registry side
   * doesn't prove an issuer is illegitimate, only unregistered.
   */
  async trustWeight(account: Address): Promise<number> {
    return await this.publicClient.readContract({
      address: this.registryAddress,
      abi: skillIssuerRegistryAbi,
      functionName: 'trustWeight',
      args: [account],
    }) as number
  }

  async allIssuers(): Promise<Address[]> {
    return await this.publicClient.readContract({
      address: this.registryAddress,
      abi: skillIssuerRegistryAbi,
      functionName: 'allIssuers',
    }) as Address[]
  }

  async issuerSkills(account: Address): Promise<Hex[]> {
    return await this.publicClient.readContract({
      address: this.registryAddress,
      abi: skillIssuerRegistryAbi,
      functionName: 'issuerSkills',
      args: [account],
    }) as Hex[]
  }

  // ─── Writes ─────────────────────────────────────────────────────

  /** Curator-only: register a new issuer. */
  async registerIssuer(walletClient: WalletClient, input: RegisterIssuerInput): Promise<Hex> {
    const account = walletClient.account
    if (!account) throw new Error('walletClient.account required')
    return await walletClient.writeContract({
      account,
      chain: walletClient.chain ?? null,
      address: this.registryAddress,
      abi: skillIssuerRegistryAbi,
      functionName: 'registerIssuer',
      args: [
        input.account,
        input.did,
        input.trustWeight,
        input.initialStakeWei ?? 0n,
        input.metadataURI ?? '',
        input.skillIds ?? [],
      ],
    })
  }

  /** Curator OR the issuer itself can update trust + metadata. */
  async updateIssuer(
    walletClient: WalletClient,
    account: Address,
    weight: number,
    metadataURI: string,
  ): Promise<Hex> {
    const wallet = walletClient.account
    if (!wallet) throw new Error('walletClient.account required')
    return await walletClient.writeContract({
      account: wallet,
      chain: walletClient.chain ?? null,
      address: this.registryAddress,
      abi: skillIssuerRegistryAbi,
      functionName: 'updateIssuer',
      args: [account, weight, metadataURI],
    })
  }

  /** Curator-only: slash bookkeeping stake (no ETH transfer in v1). */
  async slash(
    walletClient: WalletClient,
    account: Address,
    amountWei: bigint,
    reason: string,
  ): Promise<Hex> {
    const wallet = walletClient.account
    if (!wallet) throw new Error('walletClient.account required')
    return await walletClient.writeContract({
      account: wallet,
      chain: walletClient.chain ?? null,
      address: this.registryAddress,
      abi: skillIssuerRegistryAbi,
      functionName: 'slash',
      args: [account, amountWei, reason],
    })
  }
}
