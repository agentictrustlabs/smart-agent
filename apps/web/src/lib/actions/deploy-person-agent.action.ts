'use server'

import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { requireSession } from '@/lib/auth/session'
import { deploySmartAccount, getSmartAccountAddress } from '@/lib/contracts'
import { keccak256, encodePacked } from 'viem'

const DEFAULT_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID || '31337')

export interface DeployPersonAgentResult {
  success: boolean
  agentId?: string
  smartAccountAddress?: string
  error?: string
}

/**
 * Deploy a Person Agent — calls AgentAccountFactory.createAccount() on-chain
 * to deploy an ERC-4337 AgentRootAccount owned by the user's wallet.
 */
export async function deployPersonAgent(): Promise<DeployPersonAgentResult> {
  try {
    const session = await requireSession()

    if (!session.walletAddress) {
      return { success: false, error: 'No wallet connected' }
    }

    const users = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.privyUserId, session.userId))
      .limit(1)

    const user = users[0]
    if (!user) {
      return { success: false, error: 'User not found. Please complete onboarding first.' }
    }

    // Check for existing agent
    const existingAgent = await db
      .select()
      .from(schema.personAgents)
      .where(eq(schema.personAgents.userId, user.id))
      .limit(1)

    if (existingAgent[0]) {
      return {
        success: true,
        agentId: existingAgent[0].id,
        smartAccountAddress: existingAgent[0].smartAccountAddress,
      }
    }

    const ownerAddress = session.walletAddress as `0x${string}`

    // Deterministic salt from owner address
    const saltHash = keccak256(encodePacked(['string', 'address'], ['person', ownerAddress]))
    const salt = BigInt(saltHash)

    // Deploy on-chain via factory
    const smartAccountAddress = await deploySmartAccount(ownerAddress, salt)

    const agentId = crypto.randomUUID()

    await db.insert(schema.personAgents).values({
      id: agentId,
      userId: user.id,
      smartAccountAddress,
      chainId: DEFAULT_CHAIN_ID,
      salt: saltHash,
      implementationType: 'hybrid',
      status: 'deployed',
    })

    return { success: true, agentId, smartAccountAddress }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to deploy person agent'
    console.error('Person agent deployment failed:', message)
    return { success: false, error: message }
  }
}
