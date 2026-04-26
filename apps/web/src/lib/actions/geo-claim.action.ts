'use server'

/**
 * Geo-claim authoring actions.
 *
 *   listFeaturesAction        — read every published GeoFeature (latest
 *                               version), shaped for a UI dropdown.
 *   mintPublicGeoClaimAction  — mint a Public-visibility claim against
 *                               a feature for the caller's person agent.
 *
 * Public claims show up in stage B of geo-overlap.v1 and are visible to
 * every other caller. Private (PrivateZk) claims arrive after Phase 6's
 * snarkjs verifier deployment — same code path here, different
 * visibility flag + an evidenceCommit produced by the holder's prover.
 */

import { keccak256, stringToHex } from 'viem'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPublicClient, getWalletClient } from '@/lib/contracts'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import {
  geoFeatureRegistryAbi,
  geoClaimRegistryAbi,
  GEO_VISIBILITY,
  GEO_COORD_SCALE,
} from '@smart-agent/sdk'
import type { GeoRelation } from '@smart-agent/sdk'

export interface FeatureRow {
  featureId: `0x${string}`
  version: string
  metadataURI: string
  /** Best-effort display name from the metadataURI path
   *  (e.g. "fortcollins.colorado.us.geo"). */
  label: string
  centroidLat: number
  centroidLon: number
}

const REL_HASH: Record<GeoRelation, `0x${string}`> = {
  servesWithin:         keccak256(stringToHex('geo:servesWithin')) as `0x${string}`,
  operatesIn:           keccak256(stringToHex('geo:operatesIn')) as `0x${string}`,
  licensedIn:           keccak256(stringToHex('geo:licensedIn')) as `0x${string}`,
  completedTaskIn:      keccak256(stringToHex('geo:completedTaskIn')) as `0x${string}`,
  validatedPresenceIn:  keccak256(stringToHex('geo:validatedPresenceIn')) as `0x${string}`,
  stewardOf:            keccak256(stringToHex('geo:stewardOf')) as `0x${string}`,
  residentOf:           keccak256(stringToHex('geo:residentOf')) as `0x${string}`,
  originIn:             keccak256(stringToHex('geo:originIn')) as `0x${string}`,
}

const ZERO = '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`

function labelFromMetadataURI(uri: string): string {
  // https://smartagent.io/geo/us/co/erie/v1.json → "erie.colorado.us.geo"
  const m = uri.match(/\/geo\/([^/]+)\/([^/]+)\/([^/]+)\//)
  if (!m) return uri
  const [, country, region, city] = m
  return `${city}.${region}.${country}.geo`
}

export async function listFeaturesAction(): Promise<FeatureRow[]> {
  const registryAddr = process.env.GEO_FEATURE_REGISTRY_ADDRESS as `0x${string}` | undefined
  if (!registryAddr) return []
  const client = getPublicClient()
  let ids: `0x${string}`[] = []
  try {
    ids = (await client.readContract({
      address: registryAddr, abi: geoFeatureRegistryAbi, functionName: 'allFeatures',
    })) as `0x${string}`[]
  } catch { return [] }
  const out: FeatureRow[] = []
  for (const id of ids) {
    try {
      const r = (await client.readContract({
        address: registryAddr, abi: geoFeatureRegistryAbi,
        functionName: 'getLatest', args: [id],
      })) as {
        featureId: `0x${string}`; version: bigint; metadataURI: string
        centroidLat: bigint; centroidLon: bigint; active: boolean
      }
      if (!r.active) continue
      out.push({
        featureId: r.featureId,
        version: r.version.toString(),
        metadataURI: r.metadataURI,
        label: labelFromMetadataURI(r.metadataURI),
        centroidLat: Number(r.centroidLat) / Number(GEO_COORD_SCALE),
        centroidLon: Number(r.centroidLon) / Number(GEO_COORD_SCALE),
      })
    } catch { /* */ }
  }
  out.sort((a, b) => a.label.localeCompare(b.label))
  return out
}

export interface MintGeoClaimInput {
  featureId: `0x${string}`
  featureVersion: string
  relation: GeoRelation
  confidence: number    // 0..100
}

export async function mintPublicGeoClaimAction(input: MintGeoClaimInput): Promise<{ success: boolean; claimId?: `0x${string}`; error?: string }> {
  try {
    const me = await getCurrentUser()
    if (!me) return { success: false, error: 'Not signed in' }

    const personAgent = (await getPersonAgentForUser(me.id)) as `0x${string}` | null
    if (!personAgent) return { success: false, error: 'No person agent — finish onboarding first' }

    const claimRegistry = process.env.GEO_CLAIM_REGISTRY_ADDRESS as `0x${string}` | undefined
    if (!claimRegistry) return { success: false, error: 'GEO_CLAIM_REGISTRY_ADDRESS not set' }

    const wc = getWalletClient()
    const pc = getPublicClient()
    const issuer = personAgent  // self-asserted

    const policyIdHash = keccak256(stringToHex('smart-agent.geo-overlap.v1'))
    const nonce = keccak256(stringToHex(`${personAgent}|${input.featureId}|${input.relation}|${Date.now()}`))

    // Note: the SDK's GeoClaimClient would also work, but the deployer
    // needs to be the signer authorised on the subject agent's
    // AgentAccount.isOwner — which is true for demo person agents and
    // for the user's own person agent via setController.
    const hash = await wc.writeContract({
      address: claimRegistry,
      abi: geoClaimRegistryAbi,
      functionName: 'mint',
      args: [
        personAgent,                    // subjectAgent
        issuer,                         // issuer
        input.featureId,
        BigInt(input.featureVersion),
        REL_HASH[input.relation],
        GEO_VISIBILITY.Public,
        keccak256(stringToHex(`evidence:${personAgent}|${input.featureId}|${input.relation}`)) as `0x${string}`, // placeholder evidenceCommit
        ZERO,                            // edgeId
        ZERO,                            // assertionId
        Math.max(0, Math.min(100, input.confidence)),
        policyIdHash,
        0n, 0n,                          // validAfter / validUntil — open-ended
        nonce,
      ],
    })
    const receipt = await pc.waitForTransactionReceipt({ hash })
    void receipt
    // The contract returns the claimId in its event ClaimMinted; for
    // the demo we re-derive it the same way the contract does.
    const claimId = keccak256(
      `0x${personAgent.slice(2)}${input.featureId.slice(2)}${REL_HASH[input.relation].slice(2)}${nonce.slice(2)}` as `0x${string}`,
    )
    return { success: true, claimId }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'mint failed' }
  }
}
