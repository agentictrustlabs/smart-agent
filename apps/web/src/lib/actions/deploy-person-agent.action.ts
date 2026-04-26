'use server'

import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { requireSession } from '@/lib/auth/session'
import { deploySmartAccount } from '@/lib/contracts'
import { keccak256, encodePacked } from 'viem'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { addAgentController } from '@/lib/agent-resolver'
import { registerAgentMetadata } from '@/lib/actions/agent-metadata.action'

export interface DeployPersonAgentResult {
  success: boolean
  agentId?: string
  smartAccountAddress?: string
  error?: string
}

/**
 * Deploy a Person Agent — calls AgentAccountFactory.createAccount() on-chain
 * to deploy an ERC-4337 AgentAccount owned by the user's wallet.
 */
export async function deployPersonAgent(agentName?: string): Promise<DeployPersonAgentResult> {
  try {
    const session = await requireSession()

    if (!session.walletAddress) {
      return { success: false, error: 'No wallet connected' }
    }

    const users = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.did, session.userId))
      .limit(1)

    const user = users[0]
    if (!user) {
      return { success: false, error: 'User not found. Please complete onboarding first.' }
    }

    const existingAgent = await getPersonAgentForUser(user.id)
    if (existingAgent) {
      return {
        success: true,
        agentId: existingAgent,
        smartAccountAddress: existingAgent,
      }
    }

    const ownerAddress = session.walletAddress as `0x${string}`

    // Deterministic salt from owner address
    const saltHash = keccak256(encodePacked(['string', 'address'], ['person', ownerAddress]))
    const salt = BigInt(saltHash)

    // Deploy on-chain via factory
    const smartAccountAddress = await deploySmartAccount(ownerAddress, salt)

    await registerAgentMetadata({
      agentAddress: smartAccountAddress,
      displayName: agentName?.trim() || `${user.name}'s Agent`,
      description: '',
      agentType: 'person',
    })
    await addAgentController(smartAccountAddress, ownerAddress)

    return { success: true, agentId: smartAccountAddress, smartAccountAddress }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to deploy person agent'
    console.error('Person agent deployment failed:', message)
    return { success: false, error: message }
  }
}
