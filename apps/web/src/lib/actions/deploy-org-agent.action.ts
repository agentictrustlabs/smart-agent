'use server'

import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { requireSession } from '@/lib/auth/session'
import { deploySmartAccount, getPublicClient, getWalletClient } from '@/lib/contracts'
import { agentControlAbi } from '@smart-agent/sdk'
import { keccak256, encodePacked } from 'viem'
import { registerAgentMetadata } from '@/lib/actions/agent-metadata.action'
import { addAgentController } from '@/lib/agent-resolver'

export interface DeployOrgAgentInput {
  name: string
  description: string
  minOwners: number
  quorum: number
  coOwners: string[]  // additional EOA addresses to add as owners
}

export interface DeployOrgAgentResult {
  success: boolean
  agentId?: string
  smartAccountAddress?: string
  error?: string
}

/**
 * Deploy an Organization Agent with multi-sig governance:
 * 1. Deploy 4337 smart account via factory
 * 2. Initialize AgentControl governance (owner set, quorum)
 * 3. Add co-owners
 * 4. Store in DB
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

    // Unique salt
    const saltHash = keccak256(
      encodePacked(
        ['string', 'address', 'string'],
        ['org', ownerAddress, `${input.name.trim()}-${Date.now()}`],
      ),
    )
    const salt = BigInt(saltHash)

    // 1. Deploy smart account
    const smartAccountAddress = await deploySmartAccount(ownerAddress, salt)

    // 2. Initialize governance on AgentControl
    const controlAddr = process.env.AGENT_CONTROL_ADDRESS as `0x${string}`
    if (controlAddr) {
      const walletClient = getWalletClient()
      const publicClient = getPublicClient()

      const minOwners = Math.max(1, input.minOwners || 1)
      const quorum = Math.max(1, Math.min(input.quorum || 1, minOwners))

      try {
        let hash = await walletClient.writeContract({
          address: controlAddr,
          abi: agentControlAbi,
          functionName: 'initializeAgent',
          args: [smartAccountAddress as `0x${string}`, BigInt(minOwners), BigInt(quorum)],
        })
        await publicClient.waitForTransactionReceipt({ hash })

        // 3. Add co-owners
        for (const coOwner of input.coOwners) {
          const addr = coOwner.trim()
          if (addr && addr.startsWith('0x') && addr.length === 42) {
            hash = await walletClient.writeContract({
              address: controlAddr,
              abi: agentControlAbi,
              functionName: 'addOwner',
              args: [smartAccountAddress as `0x${string}`, addr as `0x${string}`],
            })
            await publicClient.waitForTransactionReceipt({ hash })
          }
        }
      } catch (govError) {
        console.warn('Governance init failed (non-fatal):', govError)
      }
    }

    await registerAgentMetadata({
      agentAddress: smartAccountAddress,
      displayName: input.name.trim(),
      description: input.description.trim(),
      agentType: 'org',
    })
    await addAgentController(smartAccountAddress, ownerAddress)

    return { success: true, agentId: smartAccountAddress, smartAccountAddress }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to deploy org agent'
    console.error('Org agent deployment failed:', message)
    return { success: false, error: message }
  }
}
