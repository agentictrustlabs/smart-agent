/**
 * SDK client for SkillDefinitionRegistry.
 *
 * Mirrors `GeoFeatureClient` for skills. Reads versioned skill definitions
 * (taxonomy entries with SKOS / OASF lineage) and writes are
 * steward-authorised on chain.
 *
 * Off-chain canonical SKOS triples (synonyms, broader / narrower / related,
 * OASF mapping) are referenced by `metadataURI`; the client never inspects
 * the off-chain blob, only the `ontologyMerkleRoot` anchor.
 */

import type { Address, Hex, PublicClient, WalletClient } from 'viem'
import { keccak256, stringToHex } from 'viem'
import { skillDefinitionRegistryAbi } from './abi'

export type SkillKindLabel = 'OasfLeaf' | 'Domain' | 'Custom'

const KIND_LOOKUP: Record<SkillKindLabel, Hex> = {
  OasfLeaf: keccak256(stringToHex('skill:OasfLeaf')),
  Domain:   keccak256(stringToHex('skill:Domain')),
  Custom:   keccak256(stringToHex('skill:Custom')),
}

export interface SkillRecord {
  skillId: Hex
  version: bigint
  stewardAccount: Address
  skillKind: Hex
  conceptHash: Hex
  ontologyMerkleRoot: Hex
  predecessorMerkleRoot: Hex
  metadataURI: string
  validAfter: bigint
  validUntil: bigint
  active: boolean
  registeredAt: bigint
}

export interface PublishSkillInput {
  skillId: Hex
  kind: SkillKindLabel | Hex
  stewardAccount: Address
  conceptHash: Hex
  ontologyMerkleRoot: Hex
  predecessorMerkleRoot?: Hex   // optional — defaults to bytes32(0) for v1
  metadataURI: string
  validAfter?: bigint
  validUntil?: bigint
}

const ZERO32: Hex = '0x0000000000000000000000000000000000000000000000000000000000000000'

export class SkillDefinitionClient {
  constructor(
    private readonly publicClient: PublicClient,
    private readonly registryAddress: Address,
  ) {}

  /**
   * Deterministic skillId. Mirrors the `featureIdFor` shape — flat
   * key list joined by `|` and lower-cased.
   *
   *   skillIdFor({ scheme: 'oasf', conceptId: 'oasf:communication.write.grant_writing' })
   *
   * `conceptId` is treated as the canonical, scheme-prefixed identifier;
   * callers SHOULD include the scheme prefix (`oasf:`, `custom:`, `skos:`)
   * in the conceptId itself rather than splitting it across keys.
   */
  static skillIdFor(parts: { scheme: 'oasf' | 'custom' | 'skos'; conceptId: string; variant?: string }): Hex {
    const key = ['skill', parts.scheme, parts.conceptId, parts.variant ?? '']
      .map(s => s.toLowerCase().trim())
      .join('|')
    return keccak256(stringToHex(key))
  }

  static kindHash(kind: SkillKindLabel | Hex): Hex {
    return typeof kind === 'string' && kind.startsWith('0x') ? (kind as Hex) : KIND_LOOKUP[kind as SkillKindLabel]
  }

  async getLatest(skillId: Hex): Promise<SkillRecord> {
    return await this.publicClient.readContract({
      address: this.registryAddress,
      abi: skillDefinitionRegistryAbi,
      functionName: 'getLatest',
      args: [skillId],
    }) as SkillRecord
  }

  async getSkill(skillId: Hex, version: bigint): Promise<SkillRecord> {
    return await this.publicClient.readContract({
      address: this.registryAddress,
      abi: skillDefinitionRegistryAbi,
      functionName: 'getSkill',
      args: [skillId, version],
    }) as SkillRecord
  }

  async latestVersion(skillId: Hex): Promise<bigint> {
    return await this.publicClient.readContract({
      address: this.registryAddress,
      abi: skillDefinitionRegistryAbi,
      functionName: 'latestVersion',
      args: [skillId],
    }) as bigint
  }

  async allSkills(): Promise<Hex[]> {
    return await this.publicClient.readContract({
      address: this.registryAddress,
      abi: skillDefinitionRegistryAbi,
      functionName: 'allSkills',
    }) as Hex[]
  }

  /** Steward-authorised publish. `walletClient` must be (or own) the steward account. */
  async publish(walletClient: WalletClient, input: PublishSkillInput): Promise<Hex> {
    const account = walletClient.account
    if (!account) throw new Error('walletClient.account required')
    return await walletClient.writeContract({
      account,
      chain: walletClient.chain ?? null,
      address: this.registryAddress,
      abi: skillDefinitionRegistryAbi,
      functionName: 'publish',
      args: [
        input.skillId,
        SkillDefinitionClient.kindHash(input.kind),
        input.stewardAccount,
        input.conceptHash,
        input.ontologyMerkleRoot,
        input.predecessorMerkleRoot ?? ZERO32,
        input.metadataURI,
        input.validAfter ?? 0n,
        input.validUntil ?? 0n,
      ],
    })
  }

  async deactivate(walletClient: WalletClient, skillId: Hex): Promise<Hex> {
    const account = walletClient.account
    if (!account) throw new Error('walletClient.account required')
    return await walletClient.writeContract({
      account,
      chain: walletClient.chain ?? null,
      address: this.registryAddress,
      abi: skillDefinitionRegistryAbi,
      functionName: 'deactivate',
      args: [skillId],
    })
  }
}
