'use server'

import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { requireSession } from '@/lib/auth/session'
import {
  agentControlAbi, ORGANIZATIONAL_CONTROL, ROLE_OPERATED_AGENT,
} from '@smart-agent/sdk'
import { keccak256, encodePacked, type Address, type Hex } from 'viem'
import { registerAgentMetadata } from '@/lib/actions/agent-metadata.action'
import { callMcp } from '@/lib/clients/mcp-client'
import { getPublicClient, getWalletClient } from '@/lib/contracts'

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

    const users = await db.select().from(schema.localUserAccounts)
      .where(eq(schema.localUserAccounts.did, session.userId)).limit(1)
    const user = users[0]
    if (!user) return { success: false, error: 'User not found' }

    const ownerAddress = session.walletAddress as `0x${string}`
    const saltHash = keccak256(
      encodePacked(['string', 'address', 'string'], ['ai', ownerAddress, `${input.name.trim()}-${Date.now()}`]),
    )
    const salt = BigInt(saltHash)

    // 1. Deploy via MCP.
    const deployRes = await callMcp<{ ok: true; address: Address }>(
      'org',
      'agent:deploy',
      { owner: ownerAddress, salt: salt.toString() },
      { agentAddress: ownerAddress },
    )
    const smartAccountAddress = deployRes.address

    // 2. Governance init — AgentControl stays deployer-signed (out of Phase 4 scope).
    const controlAddr = process.env.AGENT_CONTROL_ADDRESS as `0x${string}`
    if (controlAddr) {
      const walletClient = getWalletClient()
      const publicClient = getPublicClient()
      try {
        const hash = await walletClient.writeContract({
          address: controlAddr,
          abi: agentControlAbi,
          functionName: 'initializeAgent',
          args: [smartAccountAddress, BigInt(input.minOwners || 1), BigInt(input.quorum || 1)],
        })
        await publicClient.waitForTransactionReceipt({ hash })
      } catch { /* non-fatal */ }
    }

    // 3. AI agent → Org OrganizationalControl edge via person-mcp.
    if (input.operatedByOrg && user.personAgentAddress) {
      try {
        // We emit the edge from the user's person agent's side because the
        // person-mcp tool is auth-scoped to the caller's principal. The
        // edge's subject/object can still be set freely — the underlying
        // contract checks createdBy is an authorized party at write time.
        const r = await callMcp<{ ok: true; edgeId: Hex }>(
          'person',
          'relationship:emit_edge',
          {
            subject: smartAccountAddress,
            object: input.operatedByOrg,
            relationshipType: ORGANIZATIONAL_CONTROL,
            roles: [ROLE_OPERATED_AGENT],
          },
          { agentAddress: user.personAgentAddress },
        )
        await callMcp('person', 'relationship:set_edge_status',
          { edgeId: r.edgeId, newStatus: 2 },
          { agentAddress: user.personAgentAddress }).catch(() => undefined)
        await callMcp('person', 'relationship:set_edge_status',
          { edgeId: r.edgeId, newStatus: 3 },
          { agentAddress: user.personAgentAddress }).catch(() => undefined)
        const { scheduleKbSyncEager } = await import('@/lib/ontology/kb-write-through')
        scheduleKbSyncEager()
      } catch { /* non-fatal */ }
    }

    await registerAgentMetadata({
      agentAddress: smartAccountAddress,
      displayName: input.name.trim(),
      description: input.description.trim(),
      agentType: 'ai',
      aiAgentClass: input.agentType,
    })

    return { success: true, agentId: smartAccountAddress, smartAccountAddress }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to deploy AI agent'
    console.error('AI agent deployment failed:', message)
    return { success: false, error: message }
  }
}
