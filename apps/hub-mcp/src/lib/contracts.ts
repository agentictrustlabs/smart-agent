/**
 * Minimal on-chain read helpers for hub-mcp.
 *
 * The graphdb-sync emitters used to import these from the web app's
 * `@/lib/contracts`. Phase 5 moves the sync into hub-mcp, which needs the
 * same read helpers — but NOT the deployer wallet, KYC flows, deployment
 * paths, or any other writer code in the web's contracts.ts. We re-implement
 * the read surface here to keep hub-mcp's dependency surface small.
 *
 * Hub-mcp is read-only against the chain. Writes against the chain go through
 * the action layer in the web (which still has its full contracts.ts).
 */

import { createPublicClient, http } from 'viem'
import { foundry, sepolia } from 'viem/chains'
import { agentRelationshipAbi, agentAccountResolverAbi, ATL_TEMPLATE_ID } from '@smart-agent/sdk'

const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545'
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? process.env.CHAIN_ID ?? '31337')

function getChain() {
  if (CHAIN_ID === 31337) return foundry
  if (CHAIN_ID === 11155111) return sepolia
  return foundry
}

/** Server-side public client for reading contract state. */
export function getPublicClient() {
  return createPublicClient({
    chain: getChain(),
    transport: http(RPC_URL),
  })
}

function getRelationshipAddress(): `0x${string}` {
  const addr = process.env.AGENT_RELATIONSHIP_ADDRESS as `0x${string}`
  if (!addr) throw new Error('AGENT_RELATIONSHIP_ADDRESS not set')
  return addr
}

/** Get edges where the address is the subject. */
export async function getEdgesBySubject(subject: `0x${string}`): Promise<`0x${string}`[]> {
  const client = getPublicClient()
  return (await client.readContract({
    address: getRelationshipAddress(),
    abi: agentRelationshipAbi,
    functionName: 'getEdgesBySubject',
    args: [subject],
  })) as `0x${string}`[]
}

/** Get an edge by ID. */
export async function getEdge(edgeId: `0x${string}`) {
  const client = getPublicClient()
  return (await client.readContract({
    address: getRelationshipAddress(),
    abi: agentRelationshipAbi,
    functionName: 'getEdge',
    args: [edgeId],
  })) as {
    edgeId: `0x${string}`
    subject: `0x${string}`
    object_: `0x${string}`
    relationshipType: `0x${string}`
    status: number
    createdBy: `0x${string}`
    createdAt: bigint
    updatedAt: bigint
    metadataURI: string
  }
}

/** Get roles on an edge. */
export async function getEdgeRoles(edgeId: `0x${string}`): Promise<`0x${string}`[]> {
  const client = getPublicClient()
  return (await client.readContract({
    address: getRelationshipAddress(),
    abi: agentRelationshipAbi,
    functionName: 'getRoles',
    args: [edgeId],
  })) as `0x${string}`[]
}

/** Read the agent's template-id attribute via the resolver. Mirrors the
 *  `getAgentTemplateId` helper that used to live in the web's agent-resolver.ts. */
export async function getAgentTemplateId(agentAddress: string): Promise<string | null> {
  const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}` | undefined
  if (!resolverAddr) return null
  try {
    const client = getPublicClient()
    const value = await client.readContract({
      address: resolverAddr,
      abi: agentAccountResolverAbi,
      functionName: 'getStringProperty',
      args: [agentAddress as `0x${string}`, ATL_TEMPLATE_ID as `0x${string}`],
    }) as string
    return value || null
  } catch {
    return null
  }
}
