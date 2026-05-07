/**
 * Treasury Phase 2.5 — emit `sa:RoundCanceledAssertion` when a Round is
 * canceled before any disbursement. Cancellation-guardian path borrowed
 * from OZ Governor: a single-trusted-role tx (pool root key, or
 * designated lead steward) can revoke the SESSION_DELEGATION between
 * AllocationDecided and Disbursement. Different from sa:RoundClosedAssertion
 * which marks a normal lifecycle close.
 */

import { emitClassAssertion } from '@smart-agent/sdk'
import type { Address, Hex } from 'viem'

const ROUND_CANCELED_CLASS = 'sa:RoundCanceledAssertion'

export type RoundCancelReason =
  | 'dispute'
  | 'security-incident'
  | 'mandate-change'
  | 'steward-action'
  | 'other'

export interface RoundCanceledPayload {
  roundId: string
  reasonKind: RoundCancelReason
  /** Optional URI to a longer explanation / dispute record. */
  reasonURI?: string
  /** Hash of the SESSION_DELEGATION that was revoked, if any. */
  revokedSessionHash?: string
  canceledAt: string
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

export async function emitRoundCanceledAssertion(
  payload: RoundCanceledPayload,
): Promise<string | null> {
  const env = readEnv()
  if (!env) {
    console.warn('[roundCanceledAssertion] emit skipped — missing env')
    return null
  }
  try {
    const result = await emitClassAssertion(env, {
      classIri: ROUND_CANCELED_CLASS,
      subjectIri: `urn:smart-agent:round:${payload.roundId}`,
      payload: { ...payload },
    })
    return result.assertionId
  } catch (err) {
    console.error('[roundCanceledAssertion] emit failed:', err instanceof Error ? err.message : err)
    return null
  }
}
