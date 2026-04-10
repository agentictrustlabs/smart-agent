'use server'

import { requireSession } from '@/lib/auth/session'
import { getPublicClient, getWalletClient } from '@/lib/contracts'
import { mockTeeVerifierAbi, agentValidationProfileAbi } from '@smart-agent/sdk'
import { keccak256, toBytes, toHex } from 'viem'

const TEE_ARCHS: Record<string, `0x${string}`> = {
  'aws-nitro': keccak256(toBytes('aws-nitro')),
  'intel-tdx': keccak256(toBytes('intel-tdx')),
  'intel-sgx': keccak256(toBytes('intel-sgx')),
  'amd-sev': keccak256(toBytes('amd-sev')),
}

const VM_TEE_ONCHAIN = keccak256(toBytes('tee-onchain-verified'))

export interface SimulateTeeInput {
  agentAddress: string
  teeArch: string
  sourceCode: string
  appConfig: string
  kernelVersion: string
}

export interface SimulateTeeResult {
  success: boolean
  error?: string
  data?: {
    pcr0: string
    pcr1: string
    pcr2: string
    codeMeasurement: string
    validationId: number
    txHash: string
    evidenceURI: string
  }
}

export async function simulateTeeAttestation(input: SimulateTeeInput): Promise<SimulateTeeResult> {
  try {
    const session = await requireSession()
    if (!session.walletAddress) return { success: false, error: 'Not connected' }

    const verifierAddr = process.env.MOCK_TEE_VERIFIER_ADDRESS as `0x${string}`
    const validationAddr = process.env.AGENT_VALIDATION_ADDRESS as `0x${string}`
    if (!verifierAddr) return { success: false, error: 'MockTeeVerifier not deployed' }
    if (!validationAddr) return { success: false, error: 'AgentValidationProfile not deployed' }

    const teeArchHash = TEE_ARCHS[input.teeArch]
    if (!teeArchHash) return { success: false, error: 'Unknown TEE architecture' }

    const walletClient = getWalletClient()
    const publicClient = getPublicClient()
    const agentAddr = input.agentAddress as `0x${string}`

    // ─── Step 1: Compute PCR-like measurements from input ───────────
    // In production these come from the TEE hardware. Here we simulate
    // by hashing the user-provided code, kernel, and config.

    // PCR0 / Measurement 0: Hash of the enclave image / application code
    const pcr0 = keccak256(toBytes(input.sourceCode))

    // PCR1 / Measurement 1: Hash of the kernel / bootstrap / firmware
    const pcr1 = keccak256(toBytes(input.kernelVersion))

    // PCR2 / Measurement 2: Hash of the application config / compose file
    const pcr2 = keccak256(toBytes(input.appConfig))

    // Code measurement = keccak256(pcr0 || pcr1 || pcr2)
    // This is computed on-chain by the verifier, but we compute it here for display
    const codeMeasurement = keccak256(
      `0x${pcr0.slice(2)}${pcr1.slice(2)}${pcr2.slice(2)}` as `0x${string}`,
    )

    // Generate a mock public key (in production this would be the TEE-bound key)
    const mockPublicKey = keccak256(toBytes(`${input.agentAddress}-${Date.now()}`))

    // ─── Step 2: Call MockTeeVerifier on-chain ──────────────────────
    // This simulates what a real verifier does: accept measurements,
    // verify them, store the attestation, emit event.

    let verifyTxHash: `0x${string}`

    if (input.teeArch === 'aws-nitro') {
      verifyTxHash = await walletClient.writeContract({
        address: verifierAddr,
        abi: mockTeeVerifierAbi,
        functionName: 'verifyNitro',
        args: [agentAddr, pcr0, pcr1, pcr2, mockPublicKey],
      })
    } else if (input.teeArch === 'intel-tdx') {
      verifyTxHash = await walletClient.writeContract({
        address: verifierAddr,
        abi: mockTeeVerifierAbi,
        functionName: 'verifyTdx',
        args: [agentAddr, pcr0, pcr1, pcr2, mockPublicKey],
      })
    } else {
      verifyTxHash = await walletClient.writeContract({
        address: verifierAddr,
        abi: mockTeeVerifierAbi,
        functionName: 'verify',
        args: [agentAddr, teeArchHash, pcr0, pcr1, pcr2, mockPublicKey],
      })
    }

    await publicClient.waitForTransactionReceipt({ hash: verifyTxHash })

    // ─── Step 3: Build evidence bundle ──────────────────────────────
    // In production this would be uploaded to IPFS. Here we encode it
    // as a data URI so it's self-contained.

    const evidenceBundle = {
      attestation: {
        teeArch: input.teeArch,
        simulated: true,
        measurements: { pcr0, pcr1, pcr2 },
        codeMeasurement,
        publicKey: mockPublicKey,
      },
      sourceInput: {
        sourceCode: input.sourceCode,
        kernelVersion: input.kernelVersion,
        appConfig: input.appConfig,
      },
      verifier: {
        contract: verifierAddr,
        txHash: verifyTxHash,
        type: 'MockTeeVerifier',
      },
      timestamp: new Date().toISOString(),
    }

    const evidenceURI = `data:application/json;base64,${Buffer.from(JSON.stringify(evidenceBundle, null, 2)).toString('base64')}`

    // ─── Step 4: Record validation in AgentValidationProfile ────────

    const recordHash = await walletClient.writeContract({
      address: validationAddr,
      abi: agentValidationProfileAbi,
      functionName: 'recordValidation',
      args: [
        agentAddr,  // agent being validated
        0n,         // assertionId (0 for standalone validation)
        VM_TEE_ONCHAIN,
        verifierAddr,
        teeArchHash,
        codeMeasurement,
        evidenceURI,
      ],
    })

    await publicClient.waitForTransactionReceipt({ hash: recordHash })

    // Get the validation ID
    const count = (await publicClient.readContract({
      address: validationAddr,
      abi: agentValidationProfileAbi,
      functionName: 'validationCount',
    })) as bigint

    return {
      success: true,
      data: {
        pcr0,
        pcr1,
        pcr2,
        codeMeasurement,
        validationId: Number(count) - 1,
        txHash: recordHash,
        evidenceURI,
      },
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Simulation failed',
    }
  }
}
