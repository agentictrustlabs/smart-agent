'use server'

import { getPublicClient } from '@/lib/contracts'
import { createWalletClient, http, keccak256, toBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'
import { agentAccountResolverAbi } from '@smart-agent/sdk'

const RESOLVER = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}`
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')

// Predicate for storing group health data as JSON string
const ATL_HEALTH_DATA = keccak256(toBytes('atl:healthData'))

function getWallet() {
  const key = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}`
  if (!key) throw new Error('No deployer key')
  const account = privateKeyToAccount(key)
  return createWalletClient({
    account,
    chain: CHAIN_ID === 31337 ? foundry : undefined,
    transport: http(process.env.RPC_URL ?? 'http://127.0.0.1:8545'),
  })
}

/**
 * Register the atl:healthData predicate if not already registered.
 */
async function ensureHealthPredicate() {
  const ontologyAddr = process.env.ONTOLOGY_REGISTRY_ADDRESS as `0x${string}`
  if (!ontologyAddr) return
  const client = getPublicClient()
  try {
    const term = await client.readContract({
      address: ontologyAddr,
      abi: [{ type: 'function', name: 'getTerm', inputs: [{ name: 'id', type: 'bytes32' }], outputs: [{ name: '', type: 'tuple', components: [{ name: 'id', type: 'bytes32' }, { name: 'curie', type: 'string' }, { name: 'uri', type: 'string' }, { name: 'label', type: 'string' }, { name: 'datatype', type: 'string' }, { name: 'active', type: 'bool' }, { name: 'registeredAt', type: 'uint256' }] }], stateMutability: 'view' }],
      functionName: 'getTerm', args: [ATL_HEALTH_DATA],
    }) as { registeredAt: bigint }
    if (term.registeredAt > 0n) return // already registered
  } catch { /* not found */ }

  const wallet = getWallet()
  await wallet.writeContract({
    address: ontologyAddr,
    abi: [{ type: 'function', name: 'registerTerm', inputs: [{ name: 'id', type: 'bytes32' }, { name: 'curie', type: 'string' }, { name: 'uri', type: 'string' }, { name: 'label', type: 'string' }, { name: 'datatype', type: 'string' }], outputs: [], stateMutability: 'nonpayable' }],
    functionName: 'registerTerm',
    args: [ATL_HEALTH_DATA, 'atl:healthData', 'https://agentictrust.io/ontology/core#healthData', 'Health Data', 'string'],
  })
}

/**
 * Update group on-chain: name/description via updateCore, health data via setStringProperty.
 */
export async function updateGroupHealth(args: {
  address: string
  name: string
  leaderName?: string
  location?: string
  healthData: Record<string, unknown>
  status?: string
}) {
  if (!RESOLVER) throw new Error('Resolver not configured')

  await ensureHealthPredicate()

  const wallet = getWallet()
  const client = getPublicClient()
  const agentAddr = args.address as `0x${string}`

  // Read current core to preserve agentType + agentClass
  const core = await client.readContract({
    address: RESOLVER, abi: agentAccountResolverAbi,
    functionName: 'getCore', args: [agentAddr],
  }) as { agentType: `0x${string}`; agentClass: `0x${string}`; description: string }

  // Build description
  const desc = [
    args.leaderName ? `Led by ${args.leaderName}` : '',
    args.location ?? '',
    args.status && args.status !== 'active' ? `Status: ${args.status}` : '',
  ].filter(Boolean).join(' — ') || core.description

  // Update core (name + description)
  await wallet.writeContract({
    address: RESOLVER, abi: agentAccountResolverAbi,
    functionName: 'updateCore',
    args: [agentAddr, args.name, desc, core.agentType, core.agentClass],
  })

  // Store health data as JSON string property
  const healthJson = JSON.stringify({
    ...args.healthData,
    leaderName: args.leaderName ?? null,
    location: args.location ?? null,
    circleStatus: args.status ?? 'active',
  })

  await wallet.writeContract({
    address: RESOLVER, abi: agentAccountResolverAbi,
    functionName: 'setStringProperty',
    args: [agentAddr, ATL_HEALTH_DATA, healthJson],
  })

  return { success: true }
}
