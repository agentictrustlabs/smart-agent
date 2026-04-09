import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry, sepolia } from 'viem/chains'
import {
  agentAccountFactoryAbi,
  agentRelationshipAbi,
  agentAssertionAbi,
  agentResolverAbi,
  agentTemplateAbi,
} from '@smart-agent/sdk'
import type { DeployedContracts } from '@smart-agent/types'

const RPC_URL = process.env.RPC_URL ?? 'http://127.0.0.1:8545'
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')

/** Get the chain config based on chain ID */
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

/** Server-side wallet client for writing transactions (uses deployer key). */
export function getWalletClient() {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}`
  if (!privateKey) throw new Error('DEPLOYER_PRIVATE_KEY not set')
  const account = privateKeyToAccount(privateKey)
  return createWalletClient({
    account,
    chain: getChain(),
    transport: http(RPC_URL),
  })
}

/** Get deployed contract addresses from environment. */
export function getDeployedContracts(): DeployedContracts {
  const factoryAddress = process.env.AGENT_FACTORY_ADDRESS as `0x${string}`
  const delegationManagerAddress = process.env.DELEGATION_MANAGER_ADDRESS as `0x${string}`
  const entryPointAddress = process.env.ENTRYPOINT_ADDRESS as `0x${string}`

  if (!factoryAddress || !delegationManagerAddress || !entryPointAddress) {
    throw new Error(
      'Contract addresses not configured. Run scripts/deploy-local.sh first.',
    )
  }

  return {
    agentAccountFactory: factoryAddress,
    delegationManager: delegationManagerAddress,
    entryPoint: entryPointAddress,
    enforcers: {
      timestamp: (process.env.TIMESTAMP_ENFORCER_ADDRESS ?? '0x') as `0x${string}`,
      value: (process.env.VALUE_ENFORCER_ADDRESS ?? '0x') as `0x${string}`,
      allowedTargets: (process.env.ALLOWED_TARGETS_ENFORCER_ADDRESS ?? '0x') as `0x${string}`,
      allowedMethods: (process.env.ALLOWED_METHODS_ENFORCER_ADDRESS ?? '0x') as `0x${string}`,
    },
  }
}

/**
 * Get the counterfactual smart account address from the on-chain factory.
 * This calls factory.getAddress(owner, salt) — no transaction, just a view call.
 */
export async function getSmartAccountAddress(
  owner: `0x${string}`,
  salt: bigint,
): Promise<`0x${string}`> {
  const client = getPublicClient()
  const contracts = getDeployedContracts()

  return (await client.readContract({
    address: contracts.agentAccountFactory,
    abi: agentAccountFactoryAbi,
    functionName: 'getAddress',
    args: [owner, salt],
  })) as `0x${string}`
}

/**
 * Deploy a smart account via the on-chain factory.
 * Calls factory.createAccount(owner, salt) — creates if not exists, returns address.
 */
export async function deploySmartAccount(
  owner: `0x${string}`,
  salt: bigint,
): Promise<`0x${string}`> {
  const publicClient = getPublicClient()
  const walletClient = getWalletClient()
  const contracts = getDeployedContracts()

  // First check if already deployed
  const address = await getSmartAccountAddress(owner, salt)
  const code = await publicClient.getCode({ address })
  if (code && code !== '0x') {
    return address // already deployed
  }

  // Deploy via factory
  const hash = await walletClient.writeContract({
    address: contracts.agentAccountFactory,
    abi: agentAccountFactoryAbi,
    functionName: 'createAccount',
    args: [owner, salt],
  })

  await publicClient.waitForTransactionReceipt({ hash })
  return address
}

// ─── Relationship Protocol (3 contracts) ────────────────────────────

function getRelationshipAddress(): `0x${string}` {
  const addr = process.env.AGENT_RELATIONSHIP_ADDRESS as `0x${string}`
  if (!addr) throw new Error('AGENT_RELATIONSHIP_ADDRESS not set')
  return addr
}

function getAssertionAddress(): `0x${string}` {
  const addr = process.env.AGENT_ASSERTION_ADDRESS as `0x${string}`
  if (!addr) throw new Error('AGENT_ASSERTION_ADDRESS not set')
  return addr
}

function getResolverAddress(): `0x${string}` {
  const addr = process.env.AGENT_RESOLVER_ADDRESS as `0x${string}`
  if (!addr) throw new Error('AGENT_RESOLVER_ADDRESS not set')
  return addr
}

/**
 * Create a relationship edge with roles, activate it, and make an assertion.
 * If the edge already exists, just add the role.
 */
export async function createRelationship(params: {
  subject: `0x${string}`
  object: `0x${string}`
  roles: `0x${string}`[]
  relationshipType: `0x${string}`
  metadataURI?: string
}): Promise<`0x${string}`> {
  const walletClient = getWalletClient()
  const publicClient = getPublicClient()
  const relAddr = getRelationshipAddress()
  const assertAddr = getAssertionAddress()

  const edgeId = (await publicClient.readContract({
    address: relAddr,
    abi: agentRelationshipAbi,
    functionName: 'computeEdgeId',
    args: [params.subject, params.object, params.relationshipType],
  })) as `0x${string}`

  const exists = (await publicClient.readContract({
    address: relAddr,
    abi: agentRelationshipAbi,
    functionName: 'edgeExists',
    args: [edgeId],
  })) as boolean

  if (exists) {
    // Edge exists — add any new roles
    for (const role of params.roles) {
      const has = (await publicClient.readContract({
        address: relAddr,
        abi: agentRelationshipAbi,
        functionName: 'hasRole',
        args: [edgeId, role],
      })) as boolean
      if (!has) {
        const h = await walletClient.writeContract({
          address: relAddr,
          abi: agentRelationshipAbi,
          functionName: 'addRole',
          args: [edgeId, role],
        })
        await publicClient.waitForTransactionReceipt({ hash: h })
      }
    }
    return edgeId
  }

  // 1. Create edge with initial roles
  const createHash = await walletClient.writeContract({
    address: relAddr,
    abi: agentRelationshipAbi,
    functionName: 'createEdge',
    args: [params.subject, params.object, params.relationshipType, params.roles, params.metadataURI ?? ''],
  })
  await publicClient.waitForTransactionReceipt({ hash: createHash })

  // 2. Set ACTIVE
  const statusHash = await walletClient.writeContract({
    address: relAddr,
    abi: agentRelationshipAbi,
    functionName: 'setEdgeStatus',
    args: [edgeId, 2],
  })
  await publicClient.waitForTransactionReceipt({ hash: statusHash })

  // 3. Make object assertion
  const assertHash = await walletClient.writeContract({
    address: assertAddr,
    abi: agentAssertionAbi,
    functionName: 'makeAssertion',
    args: [edgeId, 2, 0n, 0n, ''],
  })
  await publicClient.waitForTransactionReceipt({ hash: assertHash })

  return edgeId
}

/** Get edges where the address is the object (authority). */
export async function getEdgesByObject(object: `0x${string}`): Promise<`0x${string}`[]> {
  const client = getPublicClient()
  return (await client.readContract({
    address: getRelationshipAddress(),
    abi: agentRelationshipAbi,
    functionName: 'getEdgesByObject',
    args: [object],
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

/** Get active roles via the resolver. */
export async function getActiveRoles(
  subject: `0x${string}`,
  object: `0x${string}`,
  relationshipType: `0x${string}`,
  mode: number = 0,
): Promise<`0x${string}`[]> {
  const client = getPublicClient()
  return (await client.readContract({
    address: getResolverAddress(),
    abi: agentResolverAbi,
    functionName: 'getActiveRoles',
    args: [subject, object, relationshipType, mode],
  })) as `0x${string}`[]
}

// ─── Templates ──────────────────────────────────────────────────────

function getTemplateAddress(): `0x${string}` {
  const addr = process.env.AGENT_TEMPLATE_ADDRESS as `0x${string}`
  if (!addr) throw new Error('AGENT_TEMPLATE_ADDRESS not set')
  return addr
}

export async function getTemplateCount(): Promise<bigint> {
  const client = getPublicClient()
  return (await client.readContract({
    address: getTemplateAddress(),
    abi: agentTemplateAbi,
    functionName: 'templateCount',
  })) as bigint
}

export async function getTemplate(templateId: bigint) {
  const client = getPublicClient()
  const result = (await client.readContract({
    address: getTemplateAddress(),
    abi: agentTemplateAbi,
    functionName: 'getTemplate',
    args: [templateId],
  })) as [bigint, `0x${string}`, `0x${string}`, string, string, string, string, `0x${string}`, bigint, boolean]

  return {
    id: result[0],
    relationshipType: result[1],
    role: result[2],
    name: result[3],
    description: result[4],
    delegationSchemaURI: result[5],
    metadataURI: result[6],
    createdBy: result[7],
    createdAt: result[8],
    active: result[9],
  }
}

export async function getTemplatesByTypeAndRole(
  relationshipType: `0x${string}`,
  role: `0x${string}`,
): Promise<bigint[]> {
  const client = getPublicClient()
  return (await client.readContract({
    address: getTemplateAddress(),
    abi: agentTemplateAbi,
    functionName: 'getTemplatesByTypeAndRole',
    args: [relationshipType, role],
  })) as bigint[]
}
