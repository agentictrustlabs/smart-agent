/**
 * Treasury Phase 1 — emit `sa:GrantAwardedAssertion` when stewards mark
 * a specific GrantProposal as the winner of a Round. Coarse public
 * attestation: references the proposal IRI by hash; the proposal body
 * stays private in the proposer's MCP.
 *
 * Asserter = pool's AgentAccount (the same delegation chain that signs
 * the AllocationDecidedAssertion). The award assertion is emitted *as
 * part of* the AllocationDecided emit batch — one Award assertion per
 * proposal; one AllocationDecided assertion per Round.
 *
 * Per SHACL `sa:GrantProposalAlwaysPrivateShape`, the proposal IRI here
 * is the only public reference to the proposal; the proposal body never
 * appears on chain.
 */

import { emitClassAssertion } from '@smart-agent/sdk'
import type { Address, Hex } from 'viem'

const GRANT_AWARDED_CLASS = 'sa:GrantAwardedAssertion'
const GRANT_RESCINDED_CLASS = 'sa:GrantRescindedAssertion'

export interface GrantAwardedPayload {
  proposalIRI: string
  roundId: string
  poolAgentId: string
  recipientAgentIRI: string
  totalAwarded: number
  unit: string
  awardedAt: string
}

export interface GrantRescindedPayload {
  proposalIRI: string
  reasonURI: string
  rescindedAt: string
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

function proposalSubjectIRI(proposalIRI: string): string {
  // Use the proposal's IRI as the subject so SPARQL queries land it
  // alongside the (private) proposal entity.
  return proposalIRI
}

export async function emitGrantAwardedAssertion(
  payload: GrantAwardedPayload,
): Promise<string | null> {
  const env = readEnv()
  if (!env) {
    console.warn('[grantAwardedAssertion] emit skipped — missing env')
    return null
  }
  try {
    const result = await emitClassAssertion(env, {
      classIri: GRANT_AWARDED_CLASS,
      subjectIri: proposalSubjectIRI(payload.proposalIRI),
      payload: { ...payload },
    })
    return result.assertionId
  } catch (err) {
    console.error('[grantAwardedAssertion] emit failed:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function emitGrantRescindedAssertion(
  payload: GrantRescindedPayload,
): Promise<string | null> {
  const env = readEnv()
  if (!env) {
    console.warn('[grantAwardedAssertion] emit skipped — missing env')
    return null
  }
  try {
    const result = await emitClassAssertion(env, {
      classIri: GRANT_RESCINDED_CLASS,
      subjectIri: proposalSubjectIRI(payload.proposalIRI),
      payload: { ...payload },
    })
    return result.assertionId
  } catch (err) {
    console.error('[grantAwardedAssertion] emitGrantRescindedAssertion failed:', err instanceof Error ? err.message : err)
    return null
  }
}
