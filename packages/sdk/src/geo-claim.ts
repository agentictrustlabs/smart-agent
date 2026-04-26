/**
 * SDK client for GeoClaimRegistry.
 *
 *   const claims = new GeoClaimClient(publicClient, claimRegistryAddr)
 *   await claims.mint(walletClient, {
 *     subjectAgent, issuer, featureId, featureVersion,
 *     relation: 'residentOf',
 *     visibility: 'Public',
 *     evidenceCommit, edgeId, assertionId,
 *     confidence: 80, policyId: 'smart-agent.geo-overlap.v1',
 *   })
 */

import type { Address, Hex, PublicClient, WalletClient } from 'viem'
import { keccak256, stringToHex, toHex } from 'viem'
import { geoClaimRegistryAbi } from './abi'
import {
  GEO_REL_SERVES_WITHIN, GEO_REL_OPERATES_IN, GEO_REL_LICENSED_IN,
  GEO_REL_COMPLETED_TASK_IN, GEO_REL_VALIDATED_PRESENCE_IN,
  GEO_REL_STEWARD_OF, GEO_REL_RESIDENT_OF, GEO_REL_ORIGIN_IN,
  GEO_VISIBILITY,
} from './predicates'

export type GeoRelation =
  | 'servesWithin' | 'operatesIn' | 'licensedIn' | 'completedTaskIn'
  | 'validatedPresenceIn' | 'stewardOf' | 'residentOf' | 'originIn'

const REL_HASH: Record<GeoRelation, Hex> = {
  servesWithin:         GEO_REL_SERVES_WITHIN as Hex,
  operatesIn:           GEO_REL_OPERATES_IN as Hex,
  licensedIn:           GEO_REL_LICENSED_IN as Hex,
  completedTaskIn:      GEO_REL_COMPLETED_TASK_IN as Hex,
  validatedPresenceIn:  GEO_REL_VALIDATED_PRESENCE_IN as Hex,
  stewardOf:            GEO_REL_STEWARD_OF as Hex,
  residentOf:           GEO_REL_RESIDENT_OF as Hex,
  originIn:             GEO_REL_ORIGIN_IN as Hex,
}

export type GeoVisibilityLabel = keyof typeof GEO_VISIBILITY

export interface GeoClaimRecord {
  claimId: Hex
  subjectAgent: Address
  issuer: Address
  featureId: Hex
  featureVersion: bigint
  relation: Hex
  visibility: number
  evidenceCommit: Hex
  edgeId: Hex
  assertionId: Hex
  confidence: number
  policyId: Hex
  validAfter: bigint
  validUntil: bigint
  revoked: boolean
  createdAt: bigint
}

export interface MintClaimInput {
  subjectAgent: Address
  issuer: Address
  featureId: Hex
  featureVersion: bigint
  relation: GeoRelation
  visibility: GeoVisibilityLabel
  evidenceCommit: Hex
  edgeId?: Hex
  assertionId?: Hex
  confidence: number   // 0..100
  policyId: string     // e.g. 'smart-agent.geo-overlap.v1'
  validAfter?: bigint
  validUntil?: bigint
  nonce?: Hex
}

const ZERO_HASH = '0x' + '0'.repeat(64) as Hex

function randomNonce(): Hex {
  const buf = new Uint8Array(32)
  crypto.getRandomValues(buf)
  return toHex(buf)
}

export class GeoClaimClient {
  constructor(
    private readonly publicClient: PublicClient,
    private readonly registryAddress: Address,
  ) {}

  static relationHash(rel: GeoRelation): Hex {
    return REL_HASH[rel]
  }

  async getClaim(claimId: Hex): Promise<GeoClaimRecord> {
    return await this.publicClient.readContract({
      address: this.registryAddress,
      abi: geoClaimRegistryAbi,
      functionName: 'getClaim',
      args: [claimId],
    }) as GeoClaimRecord
  }

  async claimsBySubject(subject: Address): Promise<Hex[]> {
    return await this.publicClient.readContract({
      address: this.registryAddress,
      abi: geoClaimRegistryAbi,
      functionName: 'claimsBySubject',
      args: [subject],
    }) as Hex[]
  }

  async claimsByFeature(featureId: Hex): Promise<Hex[]> {
    return await this.publicClient.readContract({
      address: this.registryAddress,
      abi: geoClaimRegistryAbi,
      functionName: 'claimsByFeature',
      args: [featureId],
    }) as Hex[]
  }

  async mint(walletClient: WalletClient, input: MintClaimInput): Promise<Hex> {
    return await walletClient.writeContract({
      address: this.registryAddress,
      abi: geoClaimRegistryAbi,
      functionName: 'mint',
      args: [
        input.subjectAgent,
        input.issuer,
        input.featureId,
        input.featureVersion,
        REL_HASH[input.relation],
        GEO_VISIBILITY[input.visibility],
        input.evidenceCommit,
        input.edgeId ?? ZERO_HASH,
        input.assertionId ?? ZERO_HASH,
        input.confidence,
        keccak256(stringToHex(input.policyId)),
        input.validAfter ?? 0n,
        input.validUntil ?? 0n,
        input.nonce ?? randomNonce(),
      ],
      account: walletClient.account!,
      chain: walletClient.chain ?? null,
    })
  }

  async revoke(walletClient: WalletClient, claimId: Hex): Promise<Hex> {
    return await walletClient.writeContract({
      address: this.registryAddress,
      abi: geoClaimRegistryAbi,
      functionName: 'revoke',
      args: [claimId],
      account: walletClient.account!,
      chain: walletClient.chain ?? null,
    })
  }
}
