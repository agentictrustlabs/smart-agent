'use server'

import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { requireSession } from '@/lib/auth/session'
import { deploySmartAccount, getPublicClient, getWalletClient, createRelationship, confirmRelationship } from '@/lib/contracts'
import { agentControlAbi, ORGANIZATIONAL_CONTROL, ROLE_OPERATED_AGENT } from '@smart-agent/sdk'
import { keccak256, encodePacked } from 'viem'
import { registerAgentMetadata } from '@/lib/actions/agent-metadata.action'
import { addAgentController } from '@/lib/agent-resolver'

export interface DeployAIAgentInput {
  name: string
  description: string
  agentType: string
  operatedByOrg: string // org agent address that will operate this AI agent
  minOwners: number
  quorum: number
}

export interface DeployAIAgentResult {
  success: boolean
  agentId?: string
  smartAccountAddress?: string
  error?: string
}

export async function deployAIAgent(input: DeployAIAgentInput): Promise<DeployAIAgentResult> {
  try {
    const session = await requireSession()
    if (!session.walletAddress) return { success: false, error: 'No wallet connected' }
    if (!input.name.trim()) return { success: false, error: 'Agent name is required' }

    const users = await db.select().from(schema.users)
      .where(eq(schema.users.privyUserId, session.userId)).limit(1)
    const user = users[0]
    if (!user) return { success: false, error: 'User not found' }

    const ownerAddress = session.walletAddress as `0x${string}`
    const saltHash = keccak256(
      encodePacked(['string', 'address', 'string'], ['ai', ownerAddress, `${input.name.trim()}-${Date.now()}`]),
    )
    const salt = BigInt(saltHash)

    // 1. Deploy smart account
    const smartAccountAddress = await deploySmartAccount(ownerAddress, salt)

    // 2. Initialize governance
    const controlAddr = process.env.AGENT_CONTROL_ADDRESS as `0x${string}`
    if (controlAddr) {
      const walletClient = getWalletClient()
      const publicClient = getPublicClient()
      try {
        const hash = await walletClient.writeContract({
          address: controlAddr,
          abi: agentControlAbi,
          functionName: 'initializeAgent',
          args: [smartAccountAddress as `0x${string}`, BigInt(input.minOwners || 1), BigInt(input.quorum || 1)],
        })
        await publicClient.waitForTransactionReceipt({ hash })
      } catch { /* non-fatal */ }
    }

    // 3. Create OrganizationalControl relationship: AI agent → operating org
    if (input.operatedByOrg) {
      try {
        const edgeId = await createRelationship({
          subject: smartAccountAddress as `0x${string}`,
          object: input.operatedByOrg as `0x${string}`,
          roles: [ROLE_OPERATED_AGENT],
          relationshipType: ORGANIZATIONAL_CONTROL,
        })
        // Auto-confirm since creator owns both
        await confirmRelationship(edgeId)
      } catch { /* non-fatal */ }
    }

    await registerAgentMetadata({
      agentAddress: smartAccountAddress,
      displayName: input.name.trim(),
      description: input.description.trim(),
      agentType: 'ai',
      aiAgentClass: input.agentType,
    })
    await addAgentController(smartAccountAddress, ownerAddress)

    return { success: true, agentId: smartAccountAddress, smartAccountAddress }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to deploy AI agent'
    console.error('AI agent deployment failed:', message)
    return { success: false, error: message }
  }
}
