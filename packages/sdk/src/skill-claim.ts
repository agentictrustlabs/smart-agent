/**
 * SDK client for AgentSkillRegistry.
 *
 * Mirrors `GeoClaimClient` for skills with three additional capabilities
 * the geo client doesn't have:
 *
 *   • mintSelf vs mintWithEndorsement — direct (self-attestation,
 *     rate-limited, capped to "advanced") vs cross-issued (EIP-712
 *     signature from issuer)
 *   • signEndorsement — convenience helper that produces the EIP-712
 *     signature an issuer creates off-chain to authorise a cross-issued
 *     mint
 *   • freshness check — `isFresh(claimId)` reads the current
 *     (issuer, subject) revocationEpoch and returns true iff the claim
 *     is still in the active epoch
 */

import type { Address, Hex, PublicClient, WalletClient } from 'viem'
import { keccak256, stringToHex } from 'viem'
import { agentSkillRegistryAbi } from './abi'
import {
  SKILL_REL_HAS_SKILL,
  SKILL_REL_PRACTICES_SKILL,
  SKILL_REL_CERTIFIED_IN,
  SKILL_REL_ENDORSES_SKILL,
  SKILL_REL_MENTORS_IN,
  SKILL_REL_CAN_TRAIN_OTHERS,
  SKILL_VISIBILITY,
  type SkillVisibility,
} from './predicates'

export type SkillRelationLabel =
  | 'hasSkill' | 'practicesSkill' | 'certifiedIn'
  | 'endorsesSkill' | 'mentorsIn' | 'canTrainOthersIn'

const REL_HASH: Record<SkillRelationLabel, Hex> = {
  hasSkill:          SKILL_REL_HAS_SKILL,
  practicesSkill:    SKILL_REL_PRACTICES_SKILL,
  certifiedIn:       SKILL_REL_CERTIFIED_IN,
  endorsesSkill:     SKILL_REL_ENDORSES_SKILL,
  mentorsIn:         SKILL_REL_MENTORS_IN,
  canTrainOthersIn:  SKILL_REL_CAN_TRAIN_OTHERS,
}

export interface SkillClaim {
  claimId: Hex
  subjectAgent: Address
  issuer: Address
  skillId: Hex
  skillVersion: bigint
  relation: Hex
  visibility: SkillVisibility
  proficiencyScore: number
  confidence: number
  evidenceCommit: Hex
  edgeId: Hex
  assertionId: Hex
  policyId: Hex
  validAfter: bigint
  validUntil: bigint
  revoked: boolean
  createdAt: bigint
  mintedAtEpoch: bigint
}

/** Compact mint tuple — matches the contract's `MintInput` struct. */
export interface MintInput {
  subjectAgent: Address
  issuer: Address
  skillId: Hex
  skillVersion: bigint
  relation: SkillRelationLabel | Hex
  visibility: SkillVisibility
  proficiencyScore: number   // 0..10000
  confidence: number          // 0..100
  evidenceCommit: Hex
  edgeId?: Hex
  assertionId?: Hex
  policyId: Hex
  validAfter?: bigint
  validUntil?: bigint
  nonce: Hex
}

const ZERO32: Hex = '0x0000000000000000000000000000000000000000000000000000000000000000'

function relHash(relation: SkillRelationLabel | Hex): Hex {
  return typeof relation === 'string' && relation.startsWith('0x') ? (relation as Hex) : REL_HASH[relation as SkillRelationLabel]
}

interface PackedInput {
  subjectAgent: Address
  issuer: Address
  skillId: Hex
  skillVersion: bigint
  relation: Hex
  visibility: number
  proficiencyScore: number
  confidence: number
  evidenceCommit: Hex
  edgeId: Hex
  assertionId: Hex
  policyId: Hex
  validAfter: bigint
  validUntil: bigint
  nonce: Hex
}

function packInput(input: MintInput): PackedInput {
  return {
    subjectAgent: input.subjectAgent,
    issuer: input.issuer,
    skillId: input.skillId,
    skillVersion: input.skillVersion,
    relation: relHash(input.relation),
    visibility: input.visibility,
    proficiencyScore: input.proficiencyScore,
    confidence: input.confidence,
    evidenceCommit: input.evidenceCommit,
    edgeId: input.edgeId ?? ZERO32,
    assertionId: input.assertionId ?? ZERO32,
    policyId: input.policyId,
    validAfter: input.validAfter ?? 0n,
    validUntil: input.validUntil ?? 0n,
    nonce: input.nonce,
  }
}

export class AgentSkillClient {
  constructor(
    private readonly publicClient: PublicClient,
    private readonly registryAddress: Address,
  ) {}

  static visibilityHash(v: keyof typeof SKILL_VISIBILITY): SkillVisibility {
    return SKILL_VISIBILITY[v]
  }

  static relationHash(rel: SkillRelationLabel): Hex {
    return REL_HASH[rel]
  }

  // ─── Reads ──────────────────────────────────────────────────────

  async getClaim(claimId: Hex): Promise<SkillClaim> {
    return await this.publicClient.readContract({
      address: this.registryAddress,
      abi: agentSkillRegistryAbi,
      functionName: 'getClaim',
      args: [claimId],
    }) as SkillClaim
  }

  async claimsBySubject(subject: Address): Promise<Hex[]> {
    return await this.publicClient.readContract({
      address: this.registryAddress,
      abi: agentSkillRegistryAbi,
      functionName: 'claimsBySubject',
      args: [subject],
    }) as Hex[]
  }

  async claimsBySkill(skillId: Hex): Promise<Hex[]> {
    return await this.publicClient.readContract({
      address: this.registryAddress,
      abi: agentSkillRegistryAbi,
      functionName: 'claimsBySkill',
      args: [skillId],
    }) as Hex[]
  }

  async claimsByIssuer(issuer: Address): Promise<Hex[]> {
    return await this.publicClient.readContract({
      address: this.registryAddress,
      abi: agentSkillRegistryAbi,
      functionName: 'claimsByIssuer',
      args: [issuer],
    }) as Hex[]
  }

  async isFresh(claimId: Hex): Promise<boolean> {
    return await this.publicClient.readContract({
      address: this.registryAddress,
      abi: agentSkillRegistryAbi,
      functionName: 'isFresh',
      args: [claimId],
    }) as boolean
  }

  async revocationEpoch(issuer: Address, subject: Address): Promise<bigint> {
    return await this.publicClient.readContract({
      address: this.registryAddress,
      abi: agentSkillRegistryAbi,
      functionName: 'revocationEpoch',
      args: [issuer, subject],
    }) as bigint
  }

  async selfMintsRemaining(subject: Address): Promise<number> {
    return await this.publicClient.readContract({
      address: this.registryAddress,
      abi: agentSkillRegistryAbi,
      functionName: 'selfMintsRemaining',
      args: [subject],
    }) as number
  }

  // ─── Writes ─────────────────────────────────────────────────────

  /**
   * Self-attested mint. `walletClient` must be (or own) `input.subjectAgent`.
   * Capped at proficiencyScore ≤ 6000; CERTIFIED_IN forbidden in this path.
   * Rate-limited to 20 mints / 24h.
   */
  async mintSelf(walletClient: WalletClient, input: MintInput): Promise<Hex> {
    if (input.subjectAgent !== input.issuer) {
      throw new Error('mintSelf: issuer must equal subjectAgent — use mintWithEndorsement for cross-issued claims')
    }
    const account = walletClient.account
    if (!account) throw new Error('walletClient.account required')
    return await walletClient.writeContract({
      account,
      chain: walletClient.chain ?? null,
      address: this.registryAddress,
      abi: agentSkillRegistryAbi,
      functionName: 'mintSelf',
      args: [packInput(input)],
    })
  }

  /**
   * Cross-issued mint. The issuer signs an EIP-712 `SkillEndorsement`
   * off-chain (see `signEndorsement` below); any wallet (typically the
   * subject's) submits the on-chain transaction with the signature.
   */
  async mintWithEndorsement(
    walletClient: WalletClient,
    input: MintInput,
    endorsementSig: Hex,
  ): Promise<Hex> {
    if (input.subjectAgent === input.issuer) {
      throw new Error('mintWithEndorsement: subjectAgent and issuer must differ — use mintSelf')
    }
    const account = walletClient.account
    if (!account) throw new Error('walletClient.account required')
    return await walletClient.writeContract({
      account,
      chain: walletClient.chain ?? null,
      address: this.registryAddress,
      abi: agentSkillRegistryAbi,
      functionName: 'mintWithEndorsement',
      args: [packInput(input), endorsementSig],
    })
  }

  async revoke(walletClient: WalletClient, claimId: Hex): Promise<Hex> {
    const account = walletClient.account
    if (!account) throw new Error('walletClient.account required')
    return await walletClient.writeContract({
      account,
      chain: walletClient.chain ?? null,
      address: this.registryAddress,
      abi: agentSkillRegistryAbi,
      functionName: 'revoke',
      args: [claimId],
    })
  }

  async bumpRevocationEpoch(walletClient: WalletClient, subject: Address): Promise<Hex> {
    const account = walletClient.account
    if (!account) throw new Error('walletClient.account required')
    return await walletClient.writeContract({
      account,
      chain: walletClient.chain ?? null,
      address: this.registryAddress,
      abi: agentSkillRegistryAbi,
      functionName: 'bumpRevocationEpoch',
      args: [subject],
    })
  }

  // ─── EIP-712 endorsement helper ─────────────────────────────────

  /**
   * Produce the typed-data structure an issuer signs to authorise a
   * cross-issued mint. The signature is consumed by
   * `mintWithEndorsement` on chain.
   *
   *   const sig = await issuerWallet.signTypedData(
   *     skillClient.endorsementTypedData(input, chainId, registryAddress)
   *   )
   *
   * Returned shape is what viem's `signTypedData` expects.
   */
  static endorsementTypedData(
    input: MintInput,
    chainId: number,
    verifyingContract: Address,
  ): {
    domain: { name: 'AgentSkillRegistry'; version: '1'; chainId: number; verifyingContract: Address }
    types: { SkillEndorsement: Array<{ name: string; type: string }> }
    primaryType: 'SkillEndorsement'
    message: Record<string, unknown>
  } {
    return {
      domain: {
        name: 'AgentSkillRegistry',
        version: '1',
        chainId,
        verifyingContract,
      },
      types: {
        SkillEndorsement: [
          { name: 'subjectAgent',     type: 'address' },
          { name: 'skillId',          type: 'bytes32' },
          { name: 'skillVersion',     type: 'uint64' },
          { name: 'relation',         type: 'bytes32' },
          { name: 'proficiencyScore', type: 'uint16' },
          { name: 'validAfter',       type: 'uint64' },
          { name: 'validUntil',       type: 'uint64' },
          { name: 'nonce',            type: 'bytes32' },
        ],
      },
      primaryType: 'SkillEndorsement',
      message: {
        subjectAgent: input.subjectAgent,
        skillId: input.skillId,
        skillVersion: input.skillVersion,
        relation: relHash(input.relation),
        proficiencyScore: input.proficiencyScore,
        validAfter: input.validAfter ?? 0n,
        validUntil: input.validUntil ?? 0n,
        nonce: input.nonce,
      },
    }
  }
}
