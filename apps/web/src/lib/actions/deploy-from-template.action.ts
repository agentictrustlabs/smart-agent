'use server'

import { requireSession } from '@/lib/auth/session'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import {
  deploySmartAccount,
  getPublicClient,
  getWalletClient,
  createRelationship,
  confirmRelationship,
} from '@/lib/contracts'
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
import { addAgentController, setAgentTemplateId } from '@/lib/agent-resolver'
import { keccak256, encodePacked } from 'viem'

import type { OrgTemplate } from '@/lib/org-templates'
import { registerAgentMetadata } from '@/lib/actions/agent-metadata.action'
import { getPersonAgentForUser } from '@/lib/agent-registry'

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

/** Identifies a deployment step for the progress UI. */
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

/**
 * Returns the list of step IDs/labels for a given template so the client
 * can render the full progress bar before deployment starts.
 */
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
 * Run a single deployment step. The client calls this sequentially,
 * updating the progress bar after each step completes.
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
    const walletClient = getWalletClient()
    const publicClient = getPublicClient()
    const controlAddr = process.env.AGENT_CONTROL_ADDRESS as `0x${string}`
    const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
    tick(`clients ready, controlAddr=${controlAddr ? 'set' : 'unset'}, resolverAddr=${resolverAddr ? 'set' : 'unset'}`)

    // Get user
    const users = await db.select().from(schema.users)
      .where(eq(schema.users.privyUserId, session.userId)).limit(1)
    tick(`user query done (found=${!!users[0]})`)
    if (!users[0]) return { stepId, success: false, error: 'User not found' }
    const user = users[0]

    switch (stepId) {
      case 'org-account': {
        const orgSalt = BigInt(Date.now())
        tick(`deploySmartAccount starting salt=${orgSalt}`)
        const orgAddress = await deploySmartAccount(walletAddress, orgSalt)
        tick(`deploySmartAccount done addr=${orgAddress}`)
        return { stepId, success: true, data: { orgAddress } }
      }

      case 'governance': {
        if (controlAddr && context.orgAddress) {
          try {
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
          await addAgentController(context.orgAddress, walletAddress)
          await setAgentTemplateId(context.orgAddress, input.template.id)
        }
        return { stepId, success: true }
      }

      case 'person-agent': {
        // Reuse existing person agent or deploy a new one
        const existingAddr = await getPersonAgentForUser(user.id)
        if (existingAddr) {
          return { stepId, success: true, data: { personAgentAddress: existingAddr } }
        }
        const saltHash = keccak256(encodePacked(['string', 'address'], ['person', walletAddress]))
        const salt = BigInt(saltHash)
        const personAddr = await deploySmartAccount(walletAddress, salt)
        await registerAgentMetadata({
          agentAddress: personAddr,
          displayName: `${user.name}'s Agent`,
          description: '',
          agentType: 'person',
        })
        await addAgentController(personAddr, walletAddress)
        return { stepId, success: true, data: { personAgentAddress: personAddr } }
      }

      case 'ownership-edge': {
        if (context.personAgentAddress && context.orgAddress) {
          const edgeId = await createRelationship({
            subject: context.personAgentAddress as `0x${string}`,
            object: context.orgAddress as `0x${string}`,
            roles: [ROLE_OWNER as `0x${string}`],
            relationshipType: ORGANIZATION_GOVERNANCE as `0x${string}`,
          })
          await confirmRelationship(edgeId)
        }
        return { stepId, success: true }
      }

      default: {
        // AI agent steps: "ai-agent:AgentName"
        if (stepId.startsWith('ai-agent:') && context.orgAddress) {
          const agentName = stepId.replace('ai-agent:', '')
          const agentDef = input.template.aiAgents.find(a => a.name === agentName)
          if (!agentDef) return { stepId, success: false, error: `Agent definition not found: ${agentName}` }

          const agentSalt = BigInt(Date.now() + Math.floor(Math.random() * 10000))
          const agentAddress = await deploySmartAccount(walletAddress, agentSalt)

          // Create Org Control relationship (AI → Org)
          try {
            const edgeId = await createRelationship({
              subject: agentAddress as `0x${string}`,
              object: context.orgAddress as `0x${string}`,
              roles: [ROLE_OPERATED_AGENT],
              relationshipType: ORGANIZATIONAL_CONTROL,
            })
            await confirmRelationship(edgeId)
          } catch { /* relationship creation may fail */ }

          // Register in resolver
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
            await addAgentController(agentAddress, walletAddress)
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
