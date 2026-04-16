'use server'

import { requireSession } from '@/lib/auth/session'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { keccak256, encodePacked, toBytes } from 'viem'
import { deploySmartAccount, getWalletClient, getPublicClient } from '@/lib/contracts'
import {
  agentAccountResolverAbi, agentNameRegistryAbi, agentNameResolverAbi,
  ATL_PRIMARY_NAME, ATL_NAME_LABEL,
  TYPE_PERSON, TYPE_ORGANIZATION, TYPE_AI_AGENT, TYPE_HUB,
} from '@smart-agent/sdk'
import { addAgentController } from '@/lib/agent-resolver'

const AGENT_TYPE_MAP: Record<string, `0x${string}`> = {
  person: TYPE_PERSON as `0x${string}`,
  org: TYPE_ORGANIZATION as `0x${string}`,
  ai: TYPE_AI_AGENT as `0x${string}`,
  hub: TYPE_HUB as `0x${string}`,
}
const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`

export interface CreateAgentInput {
  /** .agent name label (e.g., "newchurch") */
  nameLabel: string
  /** Parent node hash — determines where in the namespace this agent sits */
  parentNode: string
  /** Parent's full .agent name (e.g., "globalchurch.agent") for building full name */
  parentAgentName: string
  /** Display name (e.g., "New Church Plant") */
  displayName: string
  /** Description */
  description: string
  /** Agent type: person, org, ai, hub */
  agentType: string
}

export async function createAgentFromExplorer(input: CreateAgentInput): Promise<{
  success: boolean
  error?: string
  address?: string
  fullName?: string
}> {
  const session = await requireSession()
  if (!session) return { success: false, error: 'Not authenticated' }

  const walletClient = getWalletClient()
  const publicClient = getPublicClient()
  const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
  const nameRegistryAddr = process.env.AGENT_NAME_REGISTRY_ADDRESS as `0x${string}`
  const nameResolverAddr = process.env.AGENT_NAME_RESOLVER_ADDRESS as `0x${string}`

  if (!resolverAddr || !nameRegistryAddr || !nameResolverAddr) {
    return { success: false, error: 'Contract addresses not configured' }
  }

  const ownerAddress = walletClient.account!.address
  const fullName = `${input.nameLabel}.${input.parentAgentName}`

  try {
    // 1. Deploy smart account
    const saltHash = keccak256(encodePacked(
      ['string', 'address', 'string'],
      ['explorer', ownerAddress, `${input.nameLabel}-${Date.now()}`],
    ))
    const salt = BigInt(saltHash)
    const agentAddress = await deploySmartAccount(ownerAddress, salt) as `0x${string}`

    // 2. Register in on-chain resolver
    const agentType = AGENT_TYPE_MAP[input.agentType] ?? AGENT_TYPE_MAP.org
    const isReg = await publicClient.readContract({
      address: resolverAddr, abi: agentAccountResolverAbi,
      functionName: 'isRegistered', args: [agentAddress],
    }) as boolean

    if (!isReg) {
      const regHash = await walletClient.writeContract({
        address: resolverAddr, abi: agentAccountResolverAbi,
        functionName: 'register',
        args: [agentAddress, input.displayName, input.description, agentType, ZERO_HASH, ''],
      })
      await publicClient.waitForTransactionReceipt({ hash: regHash })
    }

    // 3. Set ATL_CONTROLLER
    await addAgentController(agentAddress, ownerAddress)

    // 4. Register in AgentNameRegistry
    const nameRegHash = await walletClient.writeContract({
      address: nameRegistryAddr, abi: agentNameRegistryAbi,
      functionName: 'register',
      args: [input.parentNode as `0x${string}`, input.nameLabel, agentAddress, nameResolverAddr, 0n],
    })
    await publicClient.waitForTransactionReceipt({ hash: nameRegHash })

    // 5. Set addr record in name resolver
    const lh = keccak256(toBytes(input.nameLabel))
    const childNode = keccak256(encodePacked(['bytes32', 'bytes32'], [input.parentNode as `0x${string}`, lh]))
    await walletClient.writeContract({
      address: nameResolverAddr, abi: agentNameResolverAbi,
      functionName: 'setAddr', args: [childNode, agentAddress],
    })

    // 6. Set ATL_PRIMARY_NAME + ATL_NAME_LABEL
    await walletClient.writeContract({
      address: resolverAddr, abi: agentAccountResolverAbi,
      functionName: 'setStringProperty',
      args: [agentAddress, ATL_NAME_LABEL as `0x${string}`, input.nameLabel],
    })
    await walletClient.writeContract({
      address: resolverAddr, abi: agentAccountResolverAbi,
      functionName: 'setStringProperty',
      args: [agentAddress, ATL_PRIMARY_NAME as `0x${string}`, fullName],
    })

    return { success: true, address: agentAddress, fullName }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Agent creation failed' }
  }
}

/**
 * Register an additional .agent name (alias) for an existing agent.
 */
export async function registerAgentAlias(input: {
  agentAddress: string
  nameLabel: string
  parentNode: string
  parentAgentName: string
}): Promise<{ success: boolean; error?: string; fullName?: string }> {
  await requireSession()

  const walletClient = getWalletClient()
  const publicClient = getPublicClient()
  const nameRegistryAddr = process.env.AGENT_NAME_REGISTRY_ADDRESS as `0x${string}`
  const nameResolverAddr = process.env.AGENT_NAME_RESOLVER_ADDRESS as `0x${string}`

  if (!nameRegistryAddr || !nameResolverAddr) return { success: false, error: 'Not configured' }

  const fullName = `${input.nameLabel}.${input.parentAgentName}`

  try {
    // Register name pointing to existing agent
    const h = await walletClient.writeContract({
      address: nameRegistryAddr, abi: agentNameRegistryAbi,
      functionName: 'register',
      args: [input.parentNode as `0x${string}`, input.nameLabel, input.agentAddress as `0x${string}`, nameResolverAddr, 0n],
    })
    await publicClient.waitForTransactionReceipt({ hash: h })

    // Set addr record
    const lh = keccak256(toBytes(input.nameLabel))
    const childNode = keccak256(encodePacked(['bytes32', 'bytes32'], [input.parentNode as `0x${string}`, lh]))
    await walletClient.writeContract({
      address: nameResolverAddr, abi: agentNameResolverAbi,
      functionName: 'setAddr', args: [childNode, input.agentAddress as `0x${string}`],
    })

    return { success: true, fullName }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Alias registration failed' }
  }
}
