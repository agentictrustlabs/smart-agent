/**
 * Class Assertion Emit Helper
 *
 * Submits a public-tier on-chain assertion via the ClassAssertion contract.
 * Used by the MCPs (person-mcp, org-mcp) and any other server-side caller
 * that needs to anchor an artifact's existence on chain so the on-chain →
 * GraphDB sync can mirror it to the public knowledge graph.
 *
 * Privacy note (per IA P4 + ontology SHACL):
 *   This function MUST only be called for visibility = 'public' or
 *   'public-coarse'. The caller is responsible for the visibility check;
 *   the helper does NOT enforce it.
 *
 * Relayer model (v1): the helper uses an operator key (typically
 * DEPLOYER_PRIVATE_KEY for local dev) to submit the tx. The on-chain
 * `asserter` is therefore the operator's address — not the data owner's
 * smart account. The data owner's identity lives in the payload URI's
 * JSON body. This is acceptable for v1 because the assertion is
 * intrinsically public-tier; no privacy is leaked. Production deployments
 * may switch to per-user session signing or a separate relayer per tenant.
 */

import {
  createWalletClient,
  createPublicClient,
  http,
  keccak256,
  toBytes,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import type { Address, Hex, PublicClient, WalletClient } from 'viem'
import { classAssertionAbi } from './abi'

export interface ClassAssertionEmitConfig {
  /** Base RPC URL (e.g., process.env.RPC_URL). */
  rpcUrl: string
  /** ClassAssertion contract address (CLASS_ASSERTION_ADDRESS). */
  contractAddress: Address
  /** Operator private key used to relay the tx. */
  operatorPrivateKey: Hex
}

export interface ClassAssertionEmitInput {
  /** Class IRI of the assertion (e.g., 'sa:MatchInitiationAssertion'). */
  classIri: string
  /** Subject IRI (the artifact's IRI, e.g., 'urn:smart-agent:intent:<uuid>'). */
  subjectIri: string
  /** Off-chain payload to be content-addressed via payloadURI. */
  payload: Record<string, unknown>
  /** Optional Unix seconds; 0 → block.timestamp. */
  validFrom?: number
  /** Optional Unix seconds; 0 → never expires. */
  validUntil?: number
  /**
   * Optional pre-built payload URI (overrides the helper's default
   * `data:application/json,...` rendering).
   */
  payloadURI?: string
}

export interface ClassAssertionEmitResult {
  /** The on-chain assertionId returned by the contract. */
  assertionId: string
  /** The transaction hash. */
  txHash: Hex
  /** keccak256 of `classIri`. */
  classId: Hex
  /** keccak256 of `subjectIri`. */
  subjectId: Hex
  /** The actual payloadURI submitted. */
  payloadURI: string
}

/** Compute the on-chain identifier for an IRI string. */
export function iriToBytes32(iri: string): Hex {
  return keccak256(toBytes(iri))
}

/**
 * Default payload-URI builder: `data:application/json,<urlencoded-json>`.
 * Sufficient for local dev. Production deployments may swap for IPFS/HTTP.
 */
export function defaultPayloadURI(payload: Record<string, unknown>): string {
  const json = JSON.stringify(payload)
  return `data:application/json,${encodeURIComponent(json)}`
}

/**
 * Submit a class assertion. Returns the assertion id on success, throws on failure.
 *
 * NOTE: Returns the assertionId as a decimal string (not bigint) for easy
 * persistence in MCP rows that store it in a TEXT column.
 */
export async function emitClassAssertion(
  config: ClassAssertionEmitConfig,
  input: ClassAssertionEmitInput,
): Promise<ClassAssertionEmitResult> {
  const account = privateKeyToAccount(config.operatorPrivateKey)
  const transport = http(config.rpcUrl)

  const walletClient: WalletClient = createWalletClient({ account, transport })
  const publicClient: PublicClient = createPublicClient({ transport })

  const classId = iriToBytes32(input.classIri)
  const subjectId = iriToBytes32(input.subjectIri)
  const payloadURI = input.payloadURI ?? defaultPayloadURI(input.payload)
  const validFrom = BigInt(input.validFrom ?? 0)
  const validUntil = BigInt(input.validUntil ?? 0)

  const txHash = await walletClient.writeContract({
    address: config.contractAddress,
    abi: classAssertionAbi,
    functionName: 'assertClass',
    args: [classId, subjectId, validFrom, validUntil, payloadURI],
    chain: null,
    account,
  })

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })

  // Decode the assertionId from the ClassAssertionMade event (first indexed topic).
  // Event sig: ClassAssertionMade(uint256 indexed assertionId, bytes32 indexed classId, ...)
  const eventSig = keccak256(
    toBytes(
      'ClassAssertionMade(uint256,bytes32,bytes32,address,uint256,uint256,string)',
    ),
  )
  const log = receipt.logs.find((l) => l.topics[0] === eventSig)
  if (!log || !log.topics[1]) {
    throw new Error(
      `ClassAssertion: tx ${txHash} confirmed but no ClassAssertionMade event found`,
    )
  }
  const assertionId = BigInt(log.topics[1]).toString()

  return { assertionId, txHash, classId, subjectId, payloadURI }
}
