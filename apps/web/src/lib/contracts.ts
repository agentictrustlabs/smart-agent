import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry, sepolia } from 'viem/chains'
import {
  agentAccountFactoryAbi,
  agentRootAccountAbi,
  agentRelationshipAbi,
  agentAssertionAbi,
  agentResolverAbi,
  agentTemplateAbi,
  delegationManagerAbi,
  agentReviewRecordAbi,
  encodeTimestampTerms,
  encodeAllowedMethodsTerms,
  encodeAllowedTargetsTerms,
  buildCaveat,
} from '@smart-agent/sdk'
import { encodeFunctionData } from 'viem'
import type { DeployedContracts, Delegation } from '@smart-agent/types'
import { ROOT_AUTHORITY } from '@smart-agent/types'

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

/**
 * Set the DelegationManager on an agent account.
 * This authorizes the DelegationManager to call execute() on the account
 * when redeeming delegations (ERC-7710 pattern).
 */
export async function setAgentDelegationManager(agentAddress: `0x${string}`): Promise<void> {
  const walletClient = getWalletClient()
  const publicClient = getPublicClient()
  const contracts = getDeployedContracts()

  const hash = await walletClient.writeContract({
    address: agentAddress,
    abi: agentRootAccountAbi,
    functionName: 'setDelegationManager',
    args: [contracts.delegationManager],
  })
  await publicClient.waitForTransactionReceipt({ hash })
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

  // 1. Create edge with initial roles — stays PROPOSED until counterparty confirms
  const createHash = await walletClient.writeContract({
    address: relAddr,
    abi: agentRelationshipAbi,
    functionName: 'createEdge',
    args: [params.subject, params.object, params.relationshipType, params.roles, params.metadataURI ?? ''],
  })
  await publicClient.waitForTransactionReceipt({ hash: createHash })

  // 2. Make self-assertion (subject claims the relationship)
  const assertHash = await walletClient.writeContract({
    address: assertAddr,
    abi: agentAssertionAbi,
    functionName: 'makeAssertion',
    args: [edgeId, 1, 0n, 0n, ''], // SELF_ASSERTED
  })
  await publicClient.waitForTransactionReceipt({ hash: assertHash })

  return edgeId
}

/**
 * Confirm a PROPOSED relationship.
 * Uses setEdgeStatus (allowed for createdBy) since the deployer created the edge.
 * PROPOSED → CONFIRMED(2) → ACTIVE(3), plus object assertion.
 */
export async function confirmRelationship(edgeId: `0x${string}`): Promise<void> {
  const walletClient = getWalletClient()
  const publicClient = getPublicClient()
  const relAddr = getRelationshipAddress()
  const assertAddr = getAssertionAddress()

  // 1. Set CONFIRMED
  let hash = await walletClient.writeContract({
    address: relAddr,
    abi: agentRelationshipAbi,
    functionName: 'setEdgeStatus',
    args: [edgeId, 2], // CONFIRMED
  })
  await publicClient.waitForTransactionReceipt({ hash })

  // 2. Set ACTIVE
  hash = await walletClient.writeContract({
    address: relAddr,
    abi: agentRelationshipAbi,
    functionName: 'setEdgeStatus',
    args: [edgeId, 3], // ACTIVE
  })
  await publicClient.waitForTransactionReceipt({ hash })

  // 3. Object assertion
  hash = await walletClient.writeContract({
    address: assertAddr,
    abi: agentAssertionAbi,
    functionName: 'makeAssertion',
    args: [edgeId, 2, 0n, 0n, ''], // OBJECT_ASSERTED
  })
  await publicClient.waitForTransactionReceipt({ hash })
}

/**
 * Reject a PROPOSED relationship.
 */
export async function rejectRelationship(edgeId: `0x${string}`): Promise<void> {
  const walletClient = getWalletClient()
  const publicClient = getPublicClient()
  const relAddr = getRelationshipAddress()

  // Use setEdgeStatus with REJECTED(6)
  const hash = await walletClient.writeContract({
    address: relAddr,
    abi: agentRelationshipAbi,
    functionName: 'setEdgeStatus',
    args: [edgeId, 6], // REJECTED
  })
  await publicClient.waitForTransactionReceipt({ hash })
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

// ─── Review Delegation (DelegationManager flow) ────────────────────

/** Default delegation duration: 7 days */
const REVIEW_DELEGATION_DURATION = 7 * 24 * 60 * 60

/**
 * Issue a delegation from a subject agent to a reviewer.
 * The delegation authorizes the reviewer to call createReview() on the AgentReviewRecord
 * contract, constrained by:
 *   - TimestampEnforcer: valid for REVIEW_DELEGATION_DURATION
 *   - AllowedMethodsEnforcer: only createReview selector
 *   - AllowedTargetsEnforcer: only the AgentReviewRecord contract
 *
 * The deployer signs on behalf of the subject agent (deployer is owner via ERC-1271).
 */
export async function issueReviewDelegation(params: {
  subjectAgentAddress: `0x${string}`
  reviewerAgentAddress: `0x${string}`
}): Promise<{ delegation: Delegation; expiresAt: string }> {
  const walletClient = getWalletClient()
  const publicClient = getPublicClient()
  const contracts = getDeployedContracts()

  const reviewAddr = process.env.AGENT_REVIEW_ADDRESS as `0x${string}`
  if (!reviewAddr) throw new Error('AGENT_REVIEW_ADDRESS not set')

  // Build caveats
  const now = Math.floor(Date.now() / 1000)
  const expiresAtUnix = now + REVIEW_DELEGATION_DURATION
  const expiresAt = new Date(expiresAtUnix * 1000).toISOString()

  // 1. Time window
  const timeCaveat = buildCaveat(
    contracts.enforcers.timestamp,
    encodeTimestampTerms(now, expiresAtUnix),
  )

  // 2. Only createReview function selector
  const createReviewSelector = '0x7e653da2' as `0x${string}` // createReview(address,address,bytes32,bytes32,uint8,(bytes32,uint8)[],string,string)
  const methodsCaveat = buildCaveat(
    contracts.enforcers.allowedMethods,
    encodeAllowedMethodsTerms([createReviewSelector]),
  )

  // 3. Only AgentReviewRecord contract
  const targetsCaveat = buildCaveat(
    contracts.enforcers.allowedTargets,
    encodeAllowedTargetsTerms([reviewAddr]),
  )

  const caveats = [timeCaveat, methodsCaveat, targetsCaveat]
  const salt = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER))

  // Build unsigned delegation
  // delegate = deployer address (the server relays the call on behalf of the reviewer)
  // The reviewer's identity is encoded in the createReview calldata, not the delegate field.
  // In future, when reviewers call redeemDelegation directly, delegate = reviewer agent.
  const deployerAddress = walletClient.account!.address
  const delegation: Delegation = {
    delegator: params.subjectAgentAddress,
    delegate: deployerAddress,
    authority: ROOT_AUTHORITY as `0x${string}`,
    caveats,
    salt,
    signature: '0x',
  }

  // Get the delegation hash from the contract
  const hash = await publicClient.readContract({
    address: contracts.delegationManager,
    abi: delegationManagerAbi,
    functionName: 'hashDelegation',
    args: [delegation],
  }) as `0x${string}`

  // Sign with deployer (who is owner of the subject agent smart account → ERC-1271 validates)
  const signature = await walletClient.signMessage({
    account: walletClient.account!,
    message: { raw: hash },
  })

  return {
    delegation: { ...delegation, signature },
    expiresAt,
  }
}

/**
 * Redeem a review delegation — submit a review through DelegationManager.
 * The delegation proves the subject agent authorized the reviewer.
 */
export async function redeemReviewDelegation(params: {
  delegation: Delegation
  reviewerAgentAddress: `0x${string}`
  subjectAgentAddress: `0x${string}`
  reviewType: `0x${string}`
  recommendation: `0x${string}`
  overallScore: number
  dimensions: Array<{ dimension: `0x${string}`; score: number }>
  comment: string
  evidenceURI: string
}): Promise<`0x${string}`> {
  const walletClient = getWalletClient()
  const publicClient = getPublicClient()
  const contracts = getDeployedContracts()

  const reviewAddr = process.env.AGENT_REVIEW_ADDRESS as `0x${string}`
  if (!reviewAddr) throw new Error('AGENT_REVIEW_ADDRESS not set')

  // Encode the createReview calldata
  const calldata = encodeFunctionData({
    abi: agentReviewRecordAbi,
    functionName: 'createReview',
    args: [
      params.reviewerAgentAddress,
      params.subjectAgentAddress,
      params.reviewType,
      params.recommendation,
      params.overallScore,
      params.dimensions,
      params.comment,
      params.evidenceURI,
    ],
  })

  // Redeem the delegation — DelegationManager validates caveats and executes
  const hash = await walletClient.writeContract({
    address: contracts.delegationManager,
    abi: delegationManagerAbi,
    functionName: 'redeemDelegation',
    args: [
      [params.delegation],  // delegation chain (single root delegation)
      reviewAddr,            // target contract
      0n,                    // no ETH value
      calldata,              // createReview calldata
    ],
  })

  await publicClient.waitForTransactionReceipt({ hash })
  return hash
}
