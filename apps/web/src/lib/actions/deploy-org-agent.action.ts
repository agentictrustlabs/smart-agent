'use server'

import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { requireSession } from '@/lib/auth/session'
import { deploySmartAccount } from '@/lib/contracts'
import { keccak256, encodePacked } from 'viem'

const DEFAULT_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID || '31337')

export interface DeployOrgAgentInput {
  name: string
  description: string
}

export interface DeployOrgAgentResult {
  success: boolean
  agentId?: string
  smartAccountAddress?: string
  error?: string
}

/**
 * Deploy an Organization Agent — calls AgentAccountFactory.createAccount() on-chain
 * to deploy an ERC-4337 AgentRootAccount for the org, owned by the creating user.
 */
export async function deployOrgAgent(
  input: DeployOrgAgentInput,
): Promise<DeployOrgAgentResult> {
  try {
    const session = await requireSession()

    if (!session.walletAddress) {
      return { success: false, error: 'No wallet connected' }
    }

    if (!input.name.trim()) {
      return { success: false, error: 'Organization name is required' }
    }

    const users = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.privyUserId, session.userId))
      .limit(1)

    const user = users[0]
    if (!user) {
      return { success: false, error: 'User not found' }
    }

    const ownerAddress = session.walletAddress as `0x${string}`

    // Unique salt from owner + org name + timestamp
    const saltHash = keccak256(
      encodePacked(
        ['string', 'address', 'string'],
        ['org', ownerAddress, `${input.name.trim()}-${Date.now()}`],
      ),
    )
    const salt = BigInt(saltHash)

    // Deploy on-chain via factory
    const smartAccountAddress = await deploySmartAccount(ownerAddress, salt)

    const agentId = crypto.randomUUID()

    await db.insert(schema.orgAgents).values({
      id: agentId,
      name: input.name.trim(),
      description: input.description.trim() || null,
      createdBy: user.id,
      smartAccountAddress,
      chainId: DEFAULT_CHAIN_ID,
      salt: saltHash,
      implementationType: 'hybrid',
      status: 'deployed',
    })

    return { success: true, agentId, smartAccountAddress }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to deploy org agent'
    console.error('Org agent deployment failed:', message)
    return { success: false, error: message }
  }
}
