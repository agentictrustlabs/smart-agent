'use server'

import { DiscoveryService } from '@smart-agent/discovery'
import type { KBAgent } from '@smart-agent/discovery'

/**
 * Re-export KBAgent as AgentCardData for backward compat with the UI component.
 */
export interface AgentCardData {
  address: string
  displayName: string
  /** .agent primary name (e.g., "david.fortcollins.catalyst.agent") */
  primaryName: string
  description: string
  agentType: 'person' | 'org' | 'ai' | 'hub' | 'unknown'
  agentTypeLabel: string
  aiAgentClass: string
  capabilities: string[]
  trustModels: string[]
  a2aEndpoint: string
  mcpServer: string
  controllers: string[]
  outEdges: Array<{
    targetAddress: string
    targetName: string
    roles: string[]
    relType: string
    status: string
  }>
  inEdges: Array<{
    sourceAddress: string
    sourceName: string
    roles: string[]
    relType: string
    status: string
  }>
  isActive: boolean
}

const TYPE_LABELS: Record<string, string> = {
  person: 'Person',
  org: 'Organization',
  ai: 'AI Agent',
  hub: 'Hub',
  unknown: 'Unknown',
}

function kbAgentToCardData(agent: KBAgent): AgentCardData {
  return {
    address: agent.address,
    displayName: agent.displayName,
    primaryName: '',  // populated later from on-chain resolver
    description: agent.description,
    agentType: agent.agentType,
    agentTypeLabel: TYPE_LABELS[agent.agentType] ?? 'Unknown',
    aiAgentClass: agent.aiAgentClass,
    capabilities: agent.capabilities,
    trustModels: agent.trustModels,
    a2aEndpoint: agent.a2aEndpoint,
    mcpServer: agent.mcpServer,
    controllers: agent.controllers,
    outEdges: [],
    inEdges: [],
    isActive: agent.isActive,
  }
}

/**
 * Fetch all registered agents from GraphDB knowledge base.
 * Falls back to empty array if GraphDB is unavailable.
 */
export async function listAllAgents(): Promise<AgentCardData[]> {
  try {
    const discovery = DiscoveryService.fromEnv()
    const agents = await discovery.listAgents()

    // Load relationships for each agent in parallel (batched)
    const results = await Promise.all(
      agents.map(async (agent) => {
        const card = kbAgentToCardData(agent)
        try {
          const [outEdges, inEdges] = await Promise.all([
            discovery.getOutgoingEdges(agent.address),
            discovery.getIncomingEdges(agent.address),
          ])
          card.outEdges = outEdges.map(e => ({
            targetAddress: e.objectAddress,
            targetName: e.objectName,
            roles: e.roles,
            relType: e.relationshipType,
            status: e.status,
          }))
          card.inEdges = inEdges.map(e => ({
            sourceAddress: e.subjectAddress,
            sourceName: e.subjectName,
            roles: e.roles,
            relType: e.relationshipType,
            status: e.status,
          }))
        } catch {
          // Edges optional — card still valid without them
        }
        return card
      }),
    )

    // Enrich with .agent names from on-chain resolver
    try {
      const { getAgentMetadata } = await import('@/lib/agent-metadata')
      await Promise.all(results.map(async (card) => {
        try {
          const meta = await getAgentMetadata(card.address)
          if (meta.primaryName) card.primaryName = meta.primaryName
        } catch { /* resolver may not have this agent */ }
      }))
    } catch { /* resolver unavailable */ }

    return results
  } catch (error) {
    console.error('[listAllAgents] GraphDB query failed, returning empty:', error)
    return []
  }
}
