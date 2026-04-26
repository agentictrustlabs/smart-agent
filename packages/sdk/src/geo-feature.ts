/**
 * SDK client for GeoFeatureRegistry.
 *
 * Reads versioned geographic features (boundaries, centroids, h3
 * coverage roots) and binds .geo names to featureId records. Writes
 * are steward-authorised on chain — callers must pass a wallet client
 * whose signer is authorised on the feature's stewardAccount.
 *
 * Off-chain canonical geometry is referenced by `metadataURI`; this
 * client never inspects the off-chain payload, only the
 * `geometryHash` anchor.
 */

import type { Address, Hex, PublicClient, WalletClient } from 'viem'
import { keccak256, stringToHex } from 'viem'
import { geoFeatureRegistryAbi } from './abi'

export type GeoFeatureKindLabel =
  | 'Planet' | 'Country' | 'State' | 'County' | 'Municipality'
  | 'Neighborhood' | 'ZipCode' | 'Custom'

const KIND_LOOKUP: Record<GeoFeatureKindLabel, Hex> = {
  Planet:       keccak256(stringToHex('geo:Planet')),
  Country:      keccak256(stringToHex('geo:Country')),
  State:        keccak256(stringToHex('geo:State')),
  County:       keccak256(stringToHex('geo:County')),
  Municipality: keccak256(stringToHex('geo:Municipality')),
  Neighborhood: keccak256(stringToHex('geo:Neighborhood')),
  ZipCode:      keccak256(stringToHex('geo:ZipCode')),
  Custom:       keccak256(stringToHex('geo:Custom')),
}

export interface GeoFeatureRecord {
  featureId: Hex
  version: bigint
  stewardAccount: Address
  featureKind: Hex
  geometryHash: Hex
  h3CoverageRoot: Hex
  sourceSetRoot: Hex
  metadataURI: string
  centroidLat: bigint
  centroidLon: bigint
  bboxMinLat: bigint
  bboxMinLon: bigint
  bboxMaxLat: bigint
  bboxMaxLon: bigint
  validAfter: bigint
  validUntil: bigint
  active: boolean
  registeredAt: bigint
}

export interface PublishFeatureInput {
  featureId: Hex
  kind: GeoFeatureKindLabel | Hex
  stewardAccount: Address
  geometryHash: Hex
  h3CoverageRoot: Hex
  sourceSetRoot: Hex
  metadataURI: string
  centroidLat: number   // degrees, will be scaled by 1e7
  centroidLon: number
  bbox: [number, number, number, number]  // [minLat, minLon, maxLat, maxLon]
  validAfter?: bigint
  validUntil?: bigint
}

const SCALE = 10_000_000n  // matches GeoFeatureRegistry.COORD_SCALE

function deg(x: number): bigint {
  return BigInt(Math.round(x * 1e7))
}

export class GeoFeatureClient {
  constructor(
    private readonly publicClient: PublicClient,
    private readonly registryAddress: Address,
  ) {}

  /** keccak256("geo:City|<countryCode>|<region>|<city>|<sourceTag>") — stable across versions. */
  static featureIdFor(parts: { countryCode: string; region: string; city: string; sourceTag?: string }): Hex {
    const key = ['geo:City', parts.countryCode, parts.region, parts.city, parts.sourceTag ?? 'sa-demo']
      .map(s => s.toLowerCase().trim())
      .join('|')
    return keccak256(stringToHex(key))
  }

  static kindHash(kind: GeoFeatureKindLabel | Hex): Hex {
    return typeof kind === 'string' && kind.startsWith('0x') ? (kind as Hex) : KIND_LOOKUP[kind as GeoFeatureKindLabel]
  }

  async getLatest(featureId: Hex): Promise<GeoFeatureRecord> {
    return await this.publicClient.readContract({
      address: this.registryAddress,
      abi: geoFeatureRegistryAbi,
      functionName: 'getLatest',
      args: [featureId],
    }) as GeoFeatureRecord
  }

  async getFeature(featureId: Hex, version: bigint): Promise<GeoFeatureRecord> {
    return await this.publicClient.readContract({
      address: this.registryAddress,
      abi: geoFeatureRegistryAbi,
      functionName: 'getFeature',
      args: [featureId, version],
    }) as GeoFeatureRecord
  }

  async featureForName(nameNode: Hex): Promise<Hex> {
    return await this.publicClient.readContract({
      address: this.registryAddress,
      abi: geoFeatureRegistryAbi,
      functionName: 'featureForName',
      args: [nameNode],
    }) as Hex
  }

  async allFeatures(): Promise<Hex[]> {
    return await this.publicClient.readContract({
      address: this.registryAddress,
      abi: geoFeatureRegistryAbi,
      functionName: 'allFeatures',
    }) as Hex[]
  }

  // ─── Writes ──────────────────────────────────────────────────────

  /**
   * Publish a feature version. Caller's signer must be authorised on
   * `stewardAccount` (matches the contract's _isAuthorized check).
   */
  async publish(walletClient: WalletClient, input: PublishFeatureInput): Promise<Hex> {
    return await walletClient.writeContract({
      address: this.registryAddress,
      abi: geoFeatureRegistryAbi,
      functionName: 'publish',
      args: [
        input.featureId,
        GeoFeatureClient.kindHash(input.kind),
        input.stewardAccount,
        input.geometryHash,
        input.h3CoverageRoot,
        input.sourceSetRoot,
        input.metadataURI,
        deg(input.centroidLat),
        deg(input.centroidLon),
        deg(input.bbox[0]),
        deg(input.bbox[1]),
        deg(input.bbox[2]),
        deg(input.bbox[3]),
        input.validAfter ?? 0n,
        input.validUntil ?? 0n,
      ],
      account: walletClient.account!,
      chain: walletClient.chain ?? null,
    })
  }

  async bindName(walletClient: WalletClient, featureId: Hex, nameNode: Hex): Promise<Hex> {
    return await walletClient.writeContract({
      address: this.registryAddress,
      abi: geoFeatureRegistryAbi,
      functionName: 'bindName',
      args: [featureId, nameNode],
      account: walletClient.account!,
      chain: walletClient.chain ?? null,
    })
  }
}

export { KIND_LOOKUP as GEO_FEATURE_KIND_HASHES }
export { SCALE as GEO_COORD_SCALE }
