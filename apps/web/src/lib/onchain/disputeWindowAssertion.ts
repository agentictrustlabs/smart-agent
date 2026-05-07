/**
 * Treasury Phase 2.5 — emit `sa:DisputeWindowOpenedAssertion` alongside
 * `sa:AllocationDecidedAssertion` to mark the start of an oSnap-style
 * 72h challenge period. The SESSION_DELEGATION's TimestampEnforcer lower
 * bound = `disputeUntil`, so disbursement userOps revert until the window
 * passes. Pattern borrowed from UMA Optimistic Oracle / Snapshot oSnap;
 * see output/dao-pool-round-best-practices.md § 3 Q6.
 */

import { emitClassAssertion } from '@smart-agent/sdk'
import type { Address, Hex } from 'viem'

const DISPUTE_WINDOW_OPENED_CLASS = 'sa:DisputeWindowOpenedAssertion'

export interface DisputeWindowOpenedPayload {
  roundId: string
  decidedAt: string
  disputeUntil: string  // ISO-8601 — typically decidedAt + 72h
  /**
   * URI / DID for the steward / pool contact responsible for fielding
   * dispute filings during the window. May be a hub URL, a steward
   * agent IRI, or a generic contact endpoint.
   */
  escalationContact?: string
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

export async function emitDisputeWindowOpenedAssertion(
  payload: DisputeWindowOpenedPayload,
): Promise<string | null> {
  const env = readEnv()
  if (!env) {
    console.warn('[disputeWindowAssertion] emit skipped — missing env')
    return null
  }
  try {
    const result = await emitClassAssertion(env, {
      classIri: DISPUTE_WINDOW_OPENED_CLASS,
      subjectIri: `urn:smart-agent:round:${payload.roundId}:dispute-window`,
      payload: { ...payload },
    })
    return result.assertionId
  } catch (err) {
    console.error('[disputeWindowAssertion] emit failed:', err instanceof Error ? err.message : err)
    return null
  }
}
