'use server'

import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { requireSession } from '@/lib/auth/session'
import {
  agentControlAbi, ORGANIZATION_GOVERNANCE, ROLE_OWNER,
} from '@smart-agent/sdk'
import { keccak256, encodePacked, type Address, type Hex } from 'viem'
import { registerAgentMetadata } from '@/lib/actions/agent-metadata.action'
import { callMcp } from '@/lib/clients/mcp-client'
import { scheduleKbSyncEager } from '@/lib/ontology/kb-write-through'
import { getPublicClient, getWalletClient } from '@/lib/contracts'

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
 * Phase 4 — Deploy an Organization Agent with multi-sig governance.
 *
 *   1. Deploy 4337 smart account via the `agent:deploy` MCP tool
 *      (forwards to a2a /session/:id/deploy-agent).
 *   2. Initialize AgentControl governance — AgentControl is NOT in the
 *      Phase 4 migration scope, so this step still uses the deployer
 *      wallet directly (best-effort; non-fatal).
 *   3. registerAgentMetadata via the agent_resolver:register MCP tool.
 *   4. Emit OWNER edge from the user's person agent to the new org via
 *      the person-mcp `relationship:emit_edge` tool.
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
      .from(schema.localUserAccounts)
      .where(eq(schema.localUserAccounts.did, session.userId))
      .limit(1)

    const user = users[0]
    if (!user) {
      return { success: false, error: 'User not found' }
    }

    const ownerAddress = session.walletAddress as `0x${string}`

    const saltHash = keccak256(
      encodePacked(
        ['string', 'address', 'string'],
        ['org', ownerAddress, `${input.name.trim()}-${Date.now()}`],
      ),
    )
    const salt = BigInt(saltHash)

    // 1. Deploy smart account via MCP.
    const deployRes = await callMcp<{ ok: true; address: Address }>(
      'org',
      'agent:deploy',
      { owner: ownerAddress, salt: salt.toString() },
      { agentAddress: ownerAddress },
    )
    const smartAccountAddress = deployRes.address

    // 2. Governance init — AgentControl is OUT OF Phase 4 migration scope
    // and stays a deployer-signed write here. The auto-add-co-owners loop
    // also stays direct because AgentControl is not on the MCP surface.
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
          args: [smartAccountAddress, BigInt(minOwners), BigInt(quorum)],
        })
        await publicClient.waitForTransactionReceipt({ hash })
        for (const coOwner of input.coOwners) {
          const addr = coOwner.trim()
          if (addr && addr.startsWith('0x') && addr.length === 42) {
            hash = await walletClient.writeContract({
              address: controlAddr,
              abi: agentControlAbi,
              functionName: 'addOwner',
              args: [smartAccountAddress, addr as `0x${string}`],
            })
            await publicClient.waitForTransactionReceipt({ hash })
          }
        }
      } catch (govError) {
        console.warn('Governance init failed (non-fatal):', govError)
      }
    }

    // 3. Register metadata via MCP.
    await registerAgentMetadata({
      agentAddress: smartAccountAddress,
      displayName: input.name.trim(),
      description: input.description.trim(),
      agentType: 'org',
    })

    // 4. Owner-edge from the user's person agent → org via person-mcp.
    if (user.personAgentAddress) {
      try {
        const r = await callMcp<{ ok: true; edgeId: Hex }>(
          'person',
          'relationship:emit_edge',
          {
            subject: user.personAgentAddress,
            object: smartAccountAddress,
            relationshipType: ORGANIZATION_GOVERNANCE,
            roles: [ROLE_OWNER],
          },
          { agentAddress: user.personAgentAddress },
        )
        // Move PROPOSED → CONFIRMED → ACTIVE so the owner edge reflects
        // the same lifecycle the prior createRelationship/confirmRelationship
        // pair produced.
        await callMcp(
          'person',
          'relationship:set_edge_status',
          { edgeId: r.edgeId, newStatus: 2 },
          { agentAddress: user.personAgentAddress },
        ).catch(() => undefined)
        await callMcp(
          'person',
          'relationship:set_edge_status',
          { edgeId: r.edgeId, newStatus: 3 },
          { agentAddress: user.personAgentAddress },
        ).catch(() => undefined)
        scheduleKbSyncEager()
      } catch (e) {
        console.warn('Owner edge mint failed (non-fatal):', (e as Error).message)
      }
    }

    return { success: true, agentId: smartAccountAddress, smartAccountAddress }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to deploy org agent'
    console.error('Org agent deployment failed:', message)
    return { success: false, error: message }
  }
}
