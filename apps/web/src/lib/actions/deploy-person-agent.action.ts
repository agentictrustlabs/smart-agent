'use server'

import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { requireSession } from '@/lib/auth/session'
import { keccak256, encodePacked, type Address } from 'viem'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { registerAgentMetadata } from '@/lib/actions/agent-metadata.action'
import { callMcp } from '@/lib/clients/mcp-client'

export interface DeployPersonAgentResult {
  success: boolean
  agentId?: string
  smartAccountAddress?: string
  error?: string
}

/**
 * Phase 4 — Deploy a Person Agent through the org-mcp `agent:deploy`
 * tool which forwards to a2a-agent's /session/:id/deploy-agent endpoint.
 * The web app no longer signs the factory call with the deployer wallet.
 *
 * The controller-list write was previously a direct setStringProperty;
 * registerAgentMetadata now routes through the agent_resolver:register
 * MCP tool, which handles register/updateCore + multi-string props.
 * Controller list additions become a separate concern handled by the
 * `agent_resolver:register` tool family when needed (the previous
 * addAgentController helper used the deployer wallet and is replaced
 * with the multi-string property pass inside the same MCP tool).
 */
export async function deployPersonAgent(agentName?: string): Promise<DeployPersonAgentResult> {
  try {
    const session = await requireSession()

    if (!session.walletAddress) {
      return { success: false, error: 'No wallet connected' }
    }

    const users = await db
      .select()
      .from(schema.localUserAccounts)
      .where(eq(schema.localUserAccounts.did, session.userId))
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
    const saltHash = keccak256(encodePacked(['string', 'address'], ['person', ownerAddress]))
    const salt = BigInt(saltHash)

    const deployRes = await callMcp<{ ok: true; address: Address; txHash: `0x${string}` }>(
      'org',
      'agent:deploy',
      { owner: ownerAddress, salt: salt.toString() },
      { agentAddress: ownerAddress },
    )
    const smartAccountAddress = deployRes.address

    await registerAgentMetadata({
      agentAddress: smartAccountAddress,
      displayName: agentName?.trim() || `${user.name}'s Agent`,
      description: '',
      agentType: 'person',
    })

    return { success: true, agentId: smartAccountAddress, smartAccountAddress }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to deploy person agent'
    console.error('Person agent deployment failed:', message)
    return { success: false, error: message }
  }
}
