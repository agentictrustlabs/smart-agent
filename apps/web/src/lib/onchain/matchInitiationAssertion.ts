/**
 * Spec 001 — Intent Marketplace (Direct Lane).
 *
 * On-chain emit helper for `sa:MatchInitiationAssertion` (per data-model.md
 * § MatchInitiation + IA § 2.1).
 *
 * Reuses the existing `ClassAssertion` contract — no new ABI required. The
 * on-chain → GraphDB sync at `apps/web/src/lib/ontology/graphdb-sync.ts`
 * already includes `sa:MatchInitiationAssertion` in `KNOWN_ASSERTION_CLASSES`,
 * so anchored rows automatically appear in the public mirror.
 *
 * Visibility cascade (IA § 3.1):
 *   - 'public'        → full payload anchored (basis included).
 *   - 'public-coarse' → coarse payload anchored; basis is OMITTED on chain
 *                       (preserved locally in the initiator's MCP).
 *   - 'private' / 'off-chain' → NEVER anchored (this helper returns null
 *                                without calling the contract).
 *
 * SHACL `sa:PrivateIntentInitiationNoAnchorShape` enforces the private-tier
 * no-anchor invariant; this helper is the runtime backstop.
 */

import { emitClassAssertion } from '@smart-agent/sdk'
import type { Address, Hex } from 'viem'

const MATCH_INITIATION_CLASS = 'sa:MatchInitiationAssertion'

interface RankBasisShape {
  proximityHops: number
  proximityScore: number
  priorOutcomes: { fulfilled: number; abandoned: number }
  outcomeScore: number
  composite: number
  isColdStart: boolean
}

export type MatchInitiationVisibility = 'public' | 'public-coarse' | 'private' | 'off-chain'

export interface MatchInitiationAssertionPayload {
  id: string
  viewedIntentId: string
  candidateIntentId: string
  initiatorAgentId: string
  initiationKind: 'self' | 'connector'
  proposedAt: string // ISO-8601
  basis: RankBasisShape
  status: 'pending' | 'superseded' | 'consumed'
  visibility: MatchInitiationVisibility
}

interface ClassAssertionEnv {
  rpcUrl: string
  contractAddress: Address
  operatorPrivateKey: Hex
}

function readEnv(): ClassAssertionEnv | null {
  const rpcUrl = process.env.RPC_URL
  const contractAddress = process.env.CLASS_ASSERTION_ADDRESS as Address | undefined
  const operatorPrivateKey = process.env.DEPLOYER_PRIVATE_KEY as Hex | undefined
  if (!rpcUrl || !contractAddress || !operatorPrivateKey) return null
  return { rpcUrl, contractAddress, operatorPrivateKey }
}

function initiationSubjectIRI(initiationId: string): string {
  // The initiationId is already a full IRI in v1 (urn:smart-agent:match-initiation:<uuid>).
  // emitClassAssertion expects the subject IRI as-is, so pass through.
  return initiationId
}

/**
 * Emit a `sa:MatchInitiationAssertion` on chain when the row's visibility
 * cascade allows it. Returns the on-chain assertionId (decimal string) on
 * success, null when:
 *   - visibility is private / off-chain (never anchored), or
 *   - the env (RPC_URL / CLASS_ASSERTION_ADDRESS / DEPLOYER_PRIVATE_KEY) is
 *     missing (matches the resilience pattern intent emitters use).
 *
 * Public-coarse anchors omit `basis` from the on-chain payload (per IA §
 * 3.1 / SHACL `sa:PrivateIntentInitiationNoAnchorShape`).
 */
export async function emitMatchInitiationAssertion(
  initiation: MatchInitiationAssertionPayload,
): Promise<string | null> {
  // Private / off-chain — never anchored.
  if (initiation.visibility !== 'public' && initiation.visibility !== 'public-coarse') {
    return null
  }

  const env = readEnv()
  if (!env) {
    console.warn(
      '[matchInitiationAssertion] emit skipped — missing RPC_URL, CLASS_ASSERTION_ADDRESS, or DEPLOYER_PRIVATE_KEY',
    )
    return null
  }

  const isCoarse = initiation.visibility === 'public-coarse'
  const payload: Record<string, unknown> = isCoarse
    ? {
        id: initiation.id,
        viewedIntentId: initiation.viewedIntentId,
        candidateIntentId: initiation.candidateIntentId,
        initiatorAgentId: initiation.initiatorAgentId,
        initiationKind: initiation.initiationKind,
        proposedAt: initiation.proposedAt,
        // basis intentionally OMITTED for public-coarse.
        status: initiation.status,
        visibility: 'public-coarse',
      }
    : {
        id: initiation.id,
        viewedIntentId: initiation.viewedIntentId,
        candidateIntentId: initiation.candidateIntentId,
        initiatorAgentId: initiation.initiatorAgentId,
        initiationKind: initiation.initiationKind,
        proposedAt: initiation.proposedAt,
        basis: initiation.basis,
        status: initiation.status,
        visibility: 'public',
      }

  try {
    const result = await emitClassAssertion(env, {
      classIri: MATCH_INITIATION_CLASS,
      subjectIri: initiationSubjectIRI(initiation.id),
      payload,
    })
    return result.assertionId
  } catch (err) {
    console.error(
      '[matchInitiationAssertion] emit failed:',
      err instanceof Error ? err.message : err,
    )
    return null
  }
}
