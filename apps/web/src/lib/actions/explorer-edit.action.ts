'use server'

import { requireSession } from '@/lib/auth/session'
import { getPublicClient, getWalletClient } from '@/lib/contracts'
import {
  agentAccountResolverAbi, agentNameRegistryAbi, agentNameResolverAbi,
  ATL_PRIMARY_NAME, ATL_NAME_LABEL,
  ATL_A2A_ENDPOINT, ATL_MCP_SERVER,
  ATL_LATITUDE, ATL_LONGITUDE,
} from '@smart-agent/sdk'
import { keccak256, toBytes, encodePacked } from 'viem'

// ─── Predicate map: key → on-chain predicate hash ──────────────────

const EDITABLE_PREDICATES: Record<string, `0x${string}`> = {
  a2aEndpoint: ATL_A2A_ENDPOINT as `0x${string}`,
  mcpServer: ATL_MCP_SERVER as `0x${string}`,
  latitude: ATL_LATITUDE as `0x${string}`,
  longitude: ATL_LONGITUDE as `0x${string}`,
  primaryName: ATL_PRIMARY_NAME as `0x${string}`,
  nameLabel: ATL_NAME_LABEL as `0x${string}`,
}

// ─── Edit a string property on an agent ─────────────────────────────

export async function setAgentStringProperty(
  agentAddress: string,
  key: string,
  value: string,
): Promise<{ success: boolean; error?: string }> {
  await requireSession()

  const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
  if (!resolverAddr) return { success: false, error: 'Resolver not configured' }

  const predicate = EDITABLE_PREDICATES[key]
  if (!predicate) return { success: false, error: `Unknown property: ${key}` }

  try {
    const walletClient = getWalletClient()
    const publicClient = getPublicClient()

    const hash = await walletClient.writeContract({
      address: resolverAddr,
      abi: agentAccountResolverAbi,
      functionName: 'setStringProperty',
      args: [agentAddress as `0x${string}`, predicate, value],
    })
    await publicClient.waitForTransactionReceipt({ hash })

    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to set property' }
  }
}

// ─── Update core metadata (displayName, description) ────────────────

export async function updateAgentCore(
  agentAddress: string,
  displayName: string,
  description: string,
): Promise<{ success: boolean; error?: string }> {
  await requireSession()

  const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
  if (!resolverAddr) return { success: false, error: 'Resolver not configured' }

  try {
    const walletClient = getWalletClient()
    const publicClient = getPublicClient()

    // Read current core to preserve agentType and agentClass
    const core = await publicClient.readContract({
      address: resolverAddr, abi: agentAccountResolverAbi,
      functionName: 'getCore', args: [agentAddress as `0x${string}`],
    }) as { agentType: `0x${string}`; agentClass: `0x${string}` }

    const hash = await walletClient.writeContract({
      address: resolverAddr, abi: agentAccountResolverAbi,
      functionName: 'updateCore',
      args: [agentAddress as `0x${string}`, displayName, description, core.agentType, core.agentClass],
    })
    await publicClient.waitForTransactionReceipt({ hash })

    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to update core' }
  }
}

// ─── Register additional .agent name for an existing agent ──────────

export async function registerAdditionalName(
  agentAddress: string,
  nameLabel: string,
  parentNode: string,
  parentAgentName: string,
): Promise<{ success: boolean; error?: string; fullName?: string }> {
  await requireSession()

  const nameRegistryAddr = process.env.AGENT_NAME_REGISTRY_ADDRESS as `0x${string}`
  const nameResolverAddr = process.env.AGENT_NAME_RESOLVER_ADDRESS as `0x${string}`
  if (!nameRegistryAddr || !nameResolverAddr) return { success: false, error: 'Name registry not configured' }

  const fullName = `${nameLabel}.${parentAgentName}`

  try {
    const walletClient = getWalletClient()
    const publicClient = getPublicClient()

    // Check availability
    const lh = keccak256(toBytes(nameLabel))
    const childNode = keccak256(encodePacked(['bytes32', 'bytes32'], [parentNode as `0x${string}`, lh]))

    const exists = await publicClient.readContract({
      address: nameRegistryAddr, abi: agentNameRegistryAbi,
      functionName: 'recordExists', args: [childNode],
    }) as boolean

    if (exists) return { success: false, error: `"${fullName}" is already registered` }

    // Register
    const regHash = await walletClient.writeContract({
      address: nameRegistryAddr, abi: agentNameRegistryAbi,
      functionName: 'register',
      args: [parentNode as `0x${string}`, nameLabel, agentAddress as `0x${string}`, nameResolverAddr, 0n],
    })
    await publicClient.waitForTransactionReceipt({ hash: regHash })

    // Set addr record
    await walletClient.writeContract({
      address: nameResolverAddr, abi: agentNameResolverAbi,
      functionName: 'setAddr', args: [childNode, agentAddress as `0x${string}`],
    })

    return { success: true, fullName }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Registration failed' }
  }
}

// ─── Set primary name for an agent ──────────────────────────────────

export async function setPrimaryName(
  agentAddress: string,
  fullName: string,
  nameLabel: string,
): Promise<{ success: boolean; error?: string }> {
  await requireSession()

  const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
  if (!resolverAddr) return { success: false, error: 'Resolver not configured' }

  try {
    const walletClient = getWalletClient()
    const publicClient = getPublicClient()

    // Set ATL_PRIMARY_NAME
    const h1 = await walletClient.writeContract({
      address: resolverAddr, abi: agentAccountResolverAbi,
      functionName: 'setStringProperty',
      args: [agentAddress as `0x${string}`, ATL_PRIMARY_NAME as `0x${string}`, fullName],
    })
    await publicClient.waitForTransactionReceipt({ hash: h1 })

    // Set ATL_NAME_LABEL
    const h2 = await walletClient.writeContract({
      address: resolverAddr, abi: agentAccountResolverAbi,
      functionName: 'setStringProperty',
      args: [agentAddress as `0x${string}`, ATL_NAME_LABEL as `0x${string}`, nameLabel],
    })
    await publicClient.waitForTransactionReceipt({ hash: h2 })

    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to set primary name' }
  }
}

// ─── Find all registered names for an address ───────────────────────

export async function findAllNamesForAgent(agentAddress: string): Promise<Array<{ fullName: string; label: string; node: string; isPrimary: boolean }>> {
  const registryAddr = process.env.AGENT_NAME_REGISTRY_ADDRESS as `0x${string}`
  const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
  if (!registryAddr || !resolverAddr) return []

  const client = getPublicClient()
  const names: Array<{ fullName: string; label: string; node: string; isPrimary: boolean }> = []

  // Get the current primary name
  let primaryName = ''
  try {
    primaryName = await client.readContract({
      address: resolverAddr, abi: agentAccountResolverAbi,
      functionName: 'getStringProperty',
      args: [agentAddress as `0x${string}`, ATL_PRIMARY_NAME as `0x${string}`],
    }) as string
  } catch { /* */ }

  // Search the registry for any node owned by this address (2 levels deep)
  try {
    const root = await client.readContract({ address: registryAddr, abi: agentNameRegistryAbi, functionName: 'AGENT_ROOT' }) as `0x${string}`

    async function searchLevel(parentNode: `0x${string}`, parentName: string) {
      const labelhashes = await client.readContract({
        address: registryAddr, abi: agentNameRegistryAbi,
        functionName: 'childLabelhashes', args: [parentNode],
      }) as `0x${string}`[]

      for (const lh of labelhashes) {
        const childNode = await client.readContract({
          address: registryAddr, abi: agentNameRegistryAbi,
          functionName: 'childNode', args: [parentNode, lh],
        }) as `0x${string}`

        const owner = await client.readContract({
          address: registryAddr, abi: agentNameRegistryAbi,
          functionName: 'owner', args: [childNode],
        }) as `0x${string}`

        // Get the label from agent metadata
        const { getAgentMetadata } = await import('@/lib/agent-metadata')
        const meta = await getAgentMetadata(owner)
        const label = meta.nameLabel || '?'
        const fullName = parentName ? `${label}.${parentName}` : `${label}.agent`

        if (owner.toLowerCase() === agentAddress.toLowerCase()) {
          names.push({
            fullName,
            label,
            node: childNode,
            isPrimary: fullName === primaryName,
          })
        }

        // Search one level deeper
        try {
          const subLabelhashes = await client.readContract({
            address: registryAddr, abi: agentNameRegistryAbi,
            functionName: 'childLabelhashes', args: [childNode],
          }) as `0x${string}`[]

          for (const slh of subLabelhashes) {
            const subNode = await client.readContract({
              address: registryAddr, abi: agentNameRegistryAbi,
              functionName: 'childNode', args: [childNode, slh],
            }) as `0x${string}`

            const subOwner = await client.readContract({
              address: registryAddr, abi: agentNameRegistryAbi,
              functionName: 'owner', args: [subNode],
            }) as `0x${string}`

            if (subOwner.toLowerCase() === agentAddress.toLowerCase()) {
              const subMeta = await getAgentMetadata(subOwner)
              const subLabel = subMeta.nameLabel || '?'
              const subFullName = `${subLabel}.${fullName}`
              names.push({
                fullName: subFullName,
                label: subLabel,
                node: subNode,
                isPrimary: subFullName === primaryName,
              })
            }
          }
        } catch { /* */ }
      }
    }

    await searchLevel(root, '')
  } catch { /* */ }

  return names
}
