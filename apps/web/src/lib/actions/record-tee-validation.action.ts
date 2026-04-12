'use server'

import { db, schema } from '@/db'

import { requireSession } from '@/lib/auth/session'
import { getPublicClient, getWalletClient } from '@/lib/contracts'
import { agentValidationProfileAbi, agentAssertionAbi } from '@smart-agent/sdk'
import { keccak256, toBytes } from 'viem'

// TEE architecture hashes (match AgentValidationProfile.sol constants)
const TEE_ARCHS: Record<string, `0x${string}`> = {
  'aws-nitro': keccak256(toBytes('aws-nitro')),
  'intel-tdx': keccak256(toBytes('intel-tdx')),
  'intel-sgx': keccak256(toBytes('intel-sgx')),
  'amd-sev': keccak256(toBytes('amd-sev')),
}

// Validation method hashes
const VALIDATION_METHODS: Record<string, `0x${string}`> = {
  'tee-onchain-verified': keccak256(toBytes('tee-onchain-verified')),
  'tee-offchain-aggregated': keccak256(toBytes('tee-offchain-aggregated')),
  'reproducible-build': keccak256(toBytes('reproducible-build')),
}

export interface RecordTeeValidationInput {
  /** Agent smart account address being validated */
  agentAddress: string
  /** TEE architecture: aws-nitro, intel-tdx, intel-sgx, amd-sev */
  teeArch: string
  /** Validation method: tee-onchain-verified, tee-offchain-aggregated, reproducible-build */
  validationMethod: string
  /** Code measurement hash (PCR hash for Nitro, RTMR hash for TDX, mrEnclave for SGX) */
  codeMeasurement: string
  /** Address of the on-chain verifier contract (0x0 if off-chain verified) */
  verifierContract: string
  /** URI to the full attestation evidence bundle */
  evidenceURI: string
}

export interface RecordTeeValidationResult {
  success: boolean
  validationId?: number
  error?: string
}

export async function recordTeeValidation(
  input: RecordTeeValidationInput,
): Promise<RecordTeeValidationResult> {
  try {
    const session = await requireSession()
    if (!session.walletAddress) return { success: false, error: 'Not connected' }

    const validationAddr = process.env.AGENT_VALIDATION_ADDRESS as `0x${string}`
    const assertionAddr = process.env.AGENT_ASSERTION_ADDRESS as `0x${string}`
    if (!validationAddr) return { success: false, error: 'Validation contract not deployed' }

    const teeArchHash = TEE_ARCHS[input.teeArch]
    if (!teeArchHash) return { success: false, error: `Unknown TEE architecture: ${input.teeArch}` }

    const methodHash = VALIDATION_METHODS[input.validationMethod]
    if (!methodHash) return { success: false, error: `Unknown validation method: ${input.validationMethod}` }

    const codeMeasurement = input.codeMeasurement as `0x${string}`
    if (!codeMeasurement || codeMeasurement.length !== 66) {
      return { success: false, error: 'Code measurement must be a 32-byte hex string (0x...)' }
    }

    const walletClient = getWalletClient()
    const publicClient = getPublicClient()

    // Find an assertion for this agent's RuntimeAttestation relationship
    // For now, use assertionId = 0 as a placeholder when no specific assertion exists
    let assertionId = 0n
    try {
      const relAddr = process.env.AGENT_RELATIONSHIP_ADDRESS as `0x${string}`
      if (relAddr && assertionAddr) {
        // Look for RuntimeAttestation edges for this agent
        const { agentRelationshipAbi } = await import('@smart-agent/sdk')
        const RUNTIME_ATTESTATION = keccak256(toBytes('RuntimeAttestation'))

        const edgeIds = await publicClient.readContract({
          address: relAddr,
          abi: agentRelationshipAbi,
          functionName: 'getEdgesBySubject',
          args: [input.agentAddress as `0x${string}`],
        }) as `0x${string}`[]

        for (const edgeId of edgeIds) {
          const edge = await publicClient.readContract({
            address: relAddr,
            abi: agentRelationshipAbi,
            functionName: 'getEdge',
            args: [edgeId],
          }) as { relationshipType: `0x${string}`; status: number }

          if (edge.relationshipType === RUNTIME_ATTESTATION && edge.status >= 2) {
            // Find assertions for this edge
            const assertionIds = await publicClient.readContract({
              address: assertionAddr,
              abi: agentAssertionAbi,
              functionName: 'getAssertionsByEdge',
              args: [edgeId],
            }) as bigint[]

            if (assertionIds.length > 0) {
              assertionId = assertionIds[0]
              break
            }
          }
        }
      }
    } catch { /* non-fatal — use assertionId 0 */ }

    // Record validation on-chain
    const hash = await walletClient.writeContract({
      address: validationAddr,
      abi: agentValidationProfileAbi,
      functionName: 'recordValidation',
      args: [
        input.agentAddress as `0x${string}`,
        assertionId,
        methodHash,
        (input.verifierContract || '0x0000000000000000000000000000000000000000') as `0x${string}`,
        teeArchHash,
        codeMeasurement,
        input.evidenceURI,
      ],
    })

    await publicClient.waitForTransactionReceipt({ hash })

    // Extract validationId from logs
    let validationId = 0
    try {
      const count = await publicClient.readContract({
        address: validationAddr,
        abi: agentValidationProfileAbi,
        functionName: 'validationCount',
      }) as bigint
      validationId = Number(count) - 1
    } catch { /* non-fatal */ }

    // Notify agent owner
    try {
      const allAgents = [
        ...(await db.select().from(schema.orgAgents)),
        ...(await db.select().from(schema.aiAgents)),
      ]
      const agent = allAgents.find(
        (a) => a.smartAccountAddress.toLowerCase() === input.agentAddress.toLowerCase(),
      )
      if (agent) {
        await db.insert(schema.messages).values({
          id: crypto.randomUUID(),
          userId: agent.createdBy,
          type: 'proposal_created',
          title: 'TEE validation recorded',
          body: `Agent ${agent.name} received a ${input.teeArch} TEE validation (method: ${input.validationMethod})`,
          link: '/tee',
        })
      }
    } catch { /* non-fatal */ }

    return { success: true, validationId }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to record validation',
    }
  }
}
