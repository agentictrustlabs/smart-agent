/**
 * Treasury Phase 2.5 — emit `sa:AllocationRevokedAssertion` when a
 * specific award within an AllocationDecided is revoked between the
 * decision and the first tranche disbursement. Per-proposal granularity
 * (vs. round-level cancellation in `sa:RoundCanceledAssertion`).
 *
 * Companion to `sa:GrantRescindedAssertion`, which is the post-disbursement
 * equivalent. The two together cover the full Award → Disburse → Validate
 * lifecycle's adversarial paths.
 */

import { emitClassAssertion } from '@smart-agent/sdk'
import type { Address, Hex } from 'viem'

const ALLOCATION_REVOKED_CLASS = 'sa:AllocationRevokedAssertion'

export type AllocationRevokeReason =
  | 'dispute-upheld'
  | 'fraud'
  | 'mandate-mismatch'
  | 'recipient-withdrew'
  | 'other'

export interface AllocationRevokedPayload {
  /** Proposal IRI whose award is revoked. */
  proposalIRI: string
  roundId: string
  reasonKind: AllocationRevokeReason
  /** Optional URI to the dispute record / explanation. */
  reasonURI?: string
  revokedAt: string
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

export async function emitAllocationRevokedAssertion(
  payload: AllocationRevokedPayload,
): Promise<string | null> {
  const env = readEnv()
  if (!env) {
    console.warn('[allocationRevokedAssertion] emit skipped — missing env')
    return null
  }
  try {
    const result = await emitClassAssertion(env, {
      classIri: ALLOCATION_REVOKED_CLASS,
      subjectIri: payload.proposalIRI,
      payload: { ...payload },
    })
    return result.assertionId
  } catch (err) {
    console.error('[allocationRevokedAssertion] emit failed:', err instanceof Error ? err.message : err)
    return null
  }
}
