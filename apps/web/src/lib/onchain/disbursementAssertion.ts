/**
 * Treasury Phase 1 — emit `sa:DisbursementAssertion` when a tranche of
 * an awarded proposal is disbursed from the pool's AgentAccount.
 *
 * Phase 1 mode (no real money): emits the assertion only — no
 * USDC.transfer is executed. Phase 3 will compose this with the
 * MultiSendCallOnly call so the transfer + assertion land atomically in
 * one userOp.
 *
 * Asserter is the pool's AgentAccount (via DelegationManager.execute
 * → ClassAssertion.emit, gated by the redeemed delegation chain).
 * In Phase 1 we mint as the deployer key for simplicity; that becomes
 * the steward's session-redeem path in Phase 2.
 */

import { emitClassAssertion } from '@smart-agent/sdk'
import type { Address, Hex } from 'viem'

const DISBURSEMENT_CLASS = 'sa:DisbursementAssertion'

export interface DisbursementPayload {
  disbursementId: string
  poolAgentId: string
  recipientAddr: string
  recipientAgentIRI: string
  amount: number
  unit: string
  /** GrantProposal IRI this tranche pays toward. */
  sourceProposalIRI: string
  /** Tranche id within the proposal (matches AllocationDecided.awards[i].tranches[j].trancheId). */
  trancheId: string
  /** Tx hash of the underlying USDC.transfer (Phase 3 only); empty in Phase 1 mock. */
  txHash: string
  disbursedAt: string
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

export async function emitDisbursementAssertion(
  payload: DisbursementPayload,
): Promise<string | null> {
  const env = readEnv()
  if (!env) {
    console.warn('[disbursementAssertion] emit skipped — missing env')
    return null
  }
  try {
    const result = await emitClassAssertion(env, {
      classIri: DISBURSEMENT_CLASS,
      subjectIri: `urn:smart-agent:disbursement:${payload.disbursementId}`,
      payload: { ...payload },
    })
    return result.assertionId
  } catch (err) {
    console.error('[disbursementAssertion] emit failed:', err instanceof Error ? err.message : err)
    return null
  }
}
