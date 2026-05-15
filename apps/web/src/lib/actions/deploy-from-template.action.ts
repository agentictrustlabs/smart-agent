'use server'

import { requireSession } from '@/lib/auth/session'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import {
  agentControlAbi,
  ORGANIZATIONAL_CONTROL,
  ORGANIZATION_GOVERNANCE,
  ROLE_OPERATED_AGENT,
  ROLE_OWNER,
  CLASS_EXECUTOR,
  CLASS_VALIDATOR,
  CLASS_ASSISTANT,
  CLASS_DISCOVERY,
  CLASS_ORACLE,
  CLASS_CUSTOM,
} from '@smart-agent/sdk'
import { keccak256, encodePacked, type Address, type Hex } from 'viem'
import { ATL_TEMPLATE_ID } from '@/lib/agent-resolver'
import { callMcp } from '@/lib/clients/mcp-client'

import type { OrgTemplate } from '@/lib/org-templates'
import { registerAgentMetadata } from '@/lib/actions/agent-metadata.action'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import { getPublicClient, getWalletClient } from '@/lib/contracts'

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const AI_CLASS_MAP: Record<string, `0x${string}`> = {
  executor: CLASS_EXECUTOR as `0x${string}`,
  validator: CLASS_VALIDATOR as `0x${string}`,
  assistant: CLASS_ASSISTANT as `0x${string}`,
  discovery: CLASS_DISCOVERY as `0x${string}`,
  oracle: CLASS_ORACLE as `0x${string}`,
  custom: CLASS_CUSTOM as `0x${string}`,
}

export interface DeployFromTemplateInput {
  template: OrgTemplate
  orgName: string
  orgDescription: string
  minOwners: number
  quorum: number
}

export type DeployStepId =
  | 'org-account'
  | 'governance'
  | 'org-metadata'
  | 'person-agent'
  | 'ownership-edge'
  | `ai-agent:${string}`

export interface DeployStepResult {
  stepId: DeployStepId
  success: boolean
  error?: string
  data?: Record<string, string>
}

export interface DeployFromTemplateResult {
  success: boolean
  error?: string
  orgAddress?: string
  orgId?: string
  deployedAgents?: Array<{ name: string; address: string; type: string }>
  personAgentAddress?: string
}

export async function getDeploySteps(
  template: OrgTemplate,
): Promise<Array<{ id: DeployStepId; label: string }>> {
  const steps: Array<{ id: DeployStepId; label: string }> = [
    { id: 'org-account', label: 'Deploying organization account' },
    { id: 'governance', label: 'Initializing governance' },
    { id: 'org-metadata', label: 'Registering organization metadata' },
    { id: 'person-agent', label: 'Setting up your personal agent' },
    { id: 'ownership-edge', label: 'Linking you as owner' },
  ]
  for (const agent of template.aiAgents) {
    if (!agent.autoDeploy) continue
    steps.push({ id: `ai-agent:${agent.name}`, label: `Deploying ${agent.name}` })
  }
  return steps
}

/**
 * Phase 4 — Each step routes through MCP for the migrated registries.
 * AgentControl init stays deployer-signed (out of scope for Phase 4).
 */
export async function runDeployStep(
  stepId: DeployStepId,
  input: DeployFromTemplateInput,
  context: {
    orgAddress?: string
    personAgentAddress?: string
  },
): Promise<DeployStepResult> {
  const t0 = Date.now()
  const tick = (msg: string) => console.log(`[deploy-step] ${stepId} +${Date.now() - t0}ms ${msg}`)
  tick('start')
  try {
    const session = await requireSession()
    tick(`session resolved (wallet=${session.walletAddress ?? 'none'})`)
    if (!session.walletAddress) {
      return { stepId, success: false, error: 'Not connected' }
    }

    const walletAddress = session.walletAddress as `0x${string}`
    const controlAddr = process.env.AGENT_CONTROL_ADDRESS as `0x${string}`
    const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
    tick(`controlAddr=${controlAddr ? 'set' : 'unset'}, resolverAddr=${resolverAddr ? 'set' : 'unset'}`)

    const users = await db.select().from(schema.localUserAccounts)
      .where(eq(schema.localUserAccounts.did, session.userId)).limit(1)
    if (!users[0]) return { stepId, success: false, error: 'User not found' }
    const user = users[0]

    switch (stepId) {
      case 'org-account': {
        const orgSalt = BigInt(Date.now())
        tick(`agent:deploy starting salt=${orgSalt}`)
        const r = await callMcp<{ ok: true; address: Address }>(
          'org',
          'agent:deploy',
          { owner: walletAddress, salt: orgSalt.toString() },
          { agentAddress: walletAddress },
        )
        tick(`agent:deploy done addr=${r.address}`)
        return { stepId, success: true, data: { orgAddress: r.address } }
      }

      case 'governance': {
        // AgentControl is OUT OF Phase 4 migration scope; still deployer-signed.
        if (controlAddr && context.orgAddress) {
          try {
            const walletClient = getWalletClient()
            const publicClient = getPublicClient()
            const hash = await walletClient.writeContract({
              address: controlAddr,
              abi: agentControlAbi,
              functionName: 'initializeAgent',
              args: [context.orgAddress as `0x${string}`, BigInt(input.minOwners), BigInt(input.quorum)],
            })
            await publicClient.waitForTransactionReceipt({ hash })
          } catch { /* may already be initialized */ }
        }
        return { stepId, success: true }
      }

      case 'org-metadata': {
        if (resolverAddr && context.orgAddress) {
          await registerAgentMetadata({
            agentAddress: context.orgAddress,
            displayName: input.orgName,
            description: input.orgDescription,
            agentType: 'org',
          })
          await callMcp(
            'org',
            'agent_resolver:set_string_property',
            {
              agentAddress: context.orgAddress,
              predicate: ATL_TEMPLATE_ID,
              value: input.template.id,
            },
            { agentAddress: context.orgAddress },
          )
        }
        return { stepId, success: true }
      }

      case 'person-agent': {
        const existingAddr = await getPersonAgentForUser(user.id)
        if (existingAddr) {
          return { stepId, success: true, data: { personAgentAddress: existingAddr } }
        }
        const saltHash = keccak256(encodePacked(['string', 'address'], ['person', walletAddress]))
        const salt = BigInt(saltHash)
        const dep = await callMcp<{ ok: true; address: Address }>(
          'org',
          'agent:deploy',
          { owner: walletAddress, salt: salt.toString() },
          { agentAddress: walletAddress },
        )
        const personAddr = dep.address
        await registerAgentMetadata({
          agentAddress: personAddr,
          displayName: `${user.name}'s Agent`,
          description: '',
          agentType: 'person',
        })
        return { stepId, success: true, data: { personAgentAddress: personAddr } }
      }

      case 'ownership-edge': {
        if (context.personAgentAddress && context.orgAddress) {
          const r = await callMcp<{ ok: true; edgeId: Hex }>(
            'person',
            'relationship:emit_edge',
            {
              subject: context.personAgentAddress,
              object: context.orgAddress,
              relationshipType: ORGANIZATION_GOVERNANCE,
              roles: [ROLE_OWNER],
            },
            { agentAddress: context.personAgentAddress },
          )
          await callMcp('person', 'relationship:set_edge_status',
            { edgeId: r.edgeId, newStatus: 2 },
            { agentAddress: context.personAgentAddress }).catch(() => undefined)
          await callMcp('person', 'relationship:set_edge_status',
            { edgeId: r.edgeId, newStatus: 3 },
            { agentAddress: context.personAgentAddress }).catch(() => undefined)
        }
        return { stepId, success: true }
      }

      default: {
        if (stepId.startsWith('ai-agent:') && context.orgAddress) {
          const agentName = stepId.replace('ai-agent:', '')
          const agentDef = input.template.aiAgents.find(a => a.name === agentName)
          if (!agentDef) return { stepId, success: false, error: `Agent definition not found: ${agentName}` }

          const agentSalt = BigInt(Date.now() + Math.floor(Math.random() * 10000))
          const dep = await callMcp<{ ok: true; address: Address }>(
            'org',
            'agent:deploy',
            { owner: walletAddress, salt: agentSalt.toString() },
            { agentAddress: walletAddress },
          )
          const agentAddress = dep.address

          try {
            // The OrganizationalControl edge is between two ORG-side
            // agents (the AI agent and its operating org), not a person
            // edge, but person-mcp's relationship tool is the only
            // surface available; auth gate is the caller's session, and
            // the contract validates createdBy is acceptable.
            if (user.personAgentAddress) {
              const r = await callMcp<{ ok: true; edgeId: Hex }>(
                'person',
                'relationship:emit_edge',
                {
                  subject: agentAddress,
                  object: context.orgAddress,
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
            }
          } catch { /* relationship creation may fail */ }

          if (resolverAddr) {
            await registerAgentMetadata({
              agentAddress,
              displayName: agentDef.name,
              description: agentDef.description,
              agentType: 'ai',
              aiAgentClass: agentDef.agentType,
              capabilities: agentDef.capabilities,
              trustModels: agentDef.trustModels,
            })
          }

          return {
            stepId,
            success: true,
            data: { agentAddress, agentName: agentDef.name, agentType: agentDef.agentType },
          }
        }
        return { stepId, success: false, error: 'Unknown step' }
      }
    }
  } catch (error) {
    console.log(`[deploy-step] ${stepId} threw after ${Date.now() - t0}ms:`, (error as Error).message)
    return {
      stepId,
      success: false,
      error: error instanceof Error ? error.message : 'Step failed',
    }
  }
}
