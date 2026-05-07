/**
 * Treasury Phase 1 — emit `sa:AllocationDecidedAssertion` when stewards
 * finalize allocations for a Round. Carries the awards list + tranche
 * schedule + Merkle awardsRoot. Companion to `sa:RoundClosedAssertion`
 * (RoundClosed marks lifecycle, AllocationDecided carries the decision
 * payload).
 *
 * The `quorumProof` field is a Merkle awardsRoot that gets committed in
 * the SESSION_DELEGATION terms passed to `RoundDecisionWindowEnforcer` —
 * that's how the chain ties the off-chain award decision to the
 * disbursement-side enforcement.
 */

import { emitClassAssertion } from '@smart-agent/sdk'
import type { Address, Hex } from 'viem'

const ALLOCATION_DECIDED_CLASS = 'sa:AllocationDecidedAssertion'

export interface Award {
  /** GrantProposal IRI (hash); never reveal the proposal body. */
  proposalIRI: string
  recipientAgentIRI: string
  recipientAddr: string
  totalAmount: number
  unit: string
  tranches: Array<{
    trancheId: string
    amount: number
    milestoneRef: string
    releaseConditions?: string
  }>
}

export interface AllocationDecidedPayload {
  roundId: string
  poolAgentId: string
  awards: Award[]
  /** Merkle root over `keccak(proposalIRI || recipientAddr || totalAmount)` tuples — committed in SESSION_DELEGATION terms. */
  awardsRoot: string
  decisionDate: string
  /** Hash of (signerSet, threshold) at decision time; lets the rotation runbook detect orphan proposals after a steward-set rotation. */
  stewardSetHash: string
  decidedAt: string
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

export async function emitAllocationDecidedAssertion(
  payload: AllocationDecidedPayload,
): Promise<string | null> {
  const env = readEnv()
  if (!env) {
    console.warn('[allocationDecidedAssertion] emit skipped — missing env')
    return null
  }
  try {
    const result = await emitClassAssertion(env, {
      classIri: ALLOCATION_DECIDED_CLASS,
      subjectIri: `urn:smart-agent:round:${payload.roundId}:allocation`,
      payload: { ...payload },
    })
    return result.assertionId
  } catch (err) {
    console.error('[allocationDecidedAssertion] emit failed:', err instanceof Error ? err.message : err)
    return null
  }
}
