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
  agentAccountResolverAbi,
  ORGANIZATIONAL_CONTROL,
  ROLE_OPERATED_AGENT,
  TYPE_ORGANIZATION,
  TYPE_AI_AGENT,
  CLASS_EXECUTOR,
  CLASS_VALIDATOR,
  CLASS_ASSISTANT,
  CLASS_DISCOVERY,
  CLASS_ORACLE,
  CLASS_CUSTOM,
  ATL_CAPABILITY,
  ATL_SUPPORTED_TRUST,
} from '@smart-agent/sdk'
import { keccak256, toBytes } from 'viem'
import type { OrgTemplate } from '@/lib/org-templates'

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

export interface DeployStep {
  label: string
  status: 'pending' | 'running' | 'done' | 'failed'
  detail?: string
}

export interface DeployFromTemplateResult {
  success: boolean
  error?: string
  orgAddress?: string
  orgId?: string
  deployedAgents?: Array<{ name: string; address: string; type: string }>
}

export async function deployFromTemplate(
  input: DeployFromTemplateInput,
): Promise<DeployFromTemplateResult> {
  try {
    const session = await requireSession()
    if (!session.walletAddress) return { success: false, error: 'Not connected' }

    const walletAddress = session.walletAddress as `0x${string}`
    const walletClient = getWalletClient()
    const publicClient = getPublicClient()
    const controlAddr = process.env.AGENT_CONTROL_ADDRESS as `0x${string}`
    const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`

    // Get or create user
    const users = await db.select().from(schema.users)
      .where(eq(schema.users.privyUserId, session.userId)).limit(1)
    if (!users[0]) return { success: false, error: 'User not found' }
    const userId = users[0].id

    // ─── Step 1: Deploy Org Smart Account ────────────────────────────
    const orgSalt = BigInt(Date.now())
    const orgAddress = await deploySmartAccount(walletAddress, orgSalt)

    // Store in DB
    const orgId = crypto.randomUUID()
    await db.insert(schema.orgAgents).values({
      id: orgId,
      name: input.orgName,
      description: input.orgDescription,
      createdBy: userId,
      smartAccountAddress: orgAddress,
      templateId: input.template.id,
      chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337'),
      salt: orgSalt.toString(),
      status: 'deployed',
    })

    // ─── Step 2: Initialize Governance ───────────────────────────────
    if (controlAddr) {
      try {
        const hash = await walletClient.writeContract({
          address: controlAddr,
          abi: agentControlAbi,
          functionName: 'initializeAgent',
          args: [orgAddress, BigInt(input.minOwners), BigInt(input.quorum)],
        })
        await publicClient.waitForTransactionReceipt({ hash })
      } catch { /* may already be initialized */ }
    }

    // ─── Step 3: Register Org in Resolver ────────────────────────────
    if (resolverAddr) {
      try {
        const hash = await walletClient.writeContract({
          address: resolverAddr,
          abi: agentAccountResolverAbi,
          functionName: 'register',
          args: [
            orgAddress,
            input.orgName,
            input.orgDescription,
            TYPE_ORGANIZATION as `0x${string}`,
            '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
            '',
          ],
        })
        await publicClient.waitForTransactionReceipt({ hash })
      } catch { /* resolver may not be deployed */ }
    }

    // ─── Step 4: Deploy AI Agents from Template ──────────────────────
    const deployedAgents: Array<{ name: string; address: string; type: string }> = []

    for (const agentDef of input.template.aiAgents) {
      if (!agentDef.autoDeploy) continue

      try {
        const agentSalt = BigInt(Date.now() + Math.floor(Math.random() * 10000))
        const agentAddress = await deploySmartAccount(walletAddress, agentSalt)

        // Store in DB
        await db.insert(schema.aiAgents).values({
          id: crypto.randomUUID(),
          name: agentDef.name,
          description: agentDef.description,
          agentType: agentDef.agentType,
          createdBy: userId,
          operatedBy: orgAddress,
          smartAccountAddress: agentAddress,
          chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337'),
          salt: agentSalt.toString(),
          status: 'deployed',
        })

        // Create Org Control relationship (AI → Org)
        try {
          const edgeId = await createRelationship({
            subject: agentAddress as `0x${string}`,
            object: orgAddress as `0x${string}`,
            roles: [ROLE_OPERATED_AGENT],
            relationshipType: ORGANIZATIONAL_CONTROL,
          })
          await confirmRelationship(edgeId)
        } catch { /* relationship creation may fail */ }

        // Register in resolver
        if (resolverAddr) {
          try {
            const classHash = AI_CLASS_MAP[agentDef.agentType] ?? AI_CLASS_MAP.custom
            let h = await walletClient.writeContract({
              address: resolverAddr,
              abi: agentAccountResolverAbi,
              functionName: 'register',
              args: [
                agentAddress as `0x${string}`,
                agentDef.name,
                agentDef.description,
                TYPE_AI_AGENT as `0x${string}`,
                classHash,
                '',
              ],
            })
            await publicClient.waitForTransactionReceipt({ hash: h })

            // Set capabilities
            for (const cap of agentDef.capabilities) {
              h = await walletClient.writeContract({
                address: resolverAddr,
                abi: agentAccountResolverAbi,
                functionName: 'addMultiStringProperty',
                args: [agentAddress as `0x${string}`, ATL_CAPABILITY as `0x${string}`, cap],
              })
              await publicClient.waitForTransactionReceipt({ hash: h })
            }

            // Set trust models
            for (const tm of agentDef.trustModels) {
              h = await walletClient.writeContract({
                address: resolverAddr,
                abi: agentAccountResolverAbi,
                functionName: 'addMultiStringProperty',
                args: [agentAddress as `0x${string}`, ATL_SUPPORTED_TRUST as `0x${string}`, tm],
              })
              await publicClient.waitForTransactionReceipt({ hash: h })
            }
          } catch { /* resolver registration may fail */ }
        }

        deployedAgents.push({
          name: agentDef.name,
          address: agentAddress,
          type: agentDef.agentType,
        })
      } catch (e) {
        console.error(`Failed to deploy AI agent ${agentDef.name}:`, e)
      }
    }

    return {
      success: true,
      orgAddress,
      orgId,
      deployedAgents,
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to deploy from template',
    }
  }
}
