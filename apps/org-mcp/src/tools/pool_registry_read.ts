/**
 * Phase 4 — PoolRegistry read-only MCP tools.
 *
 * Tools registered:
 *   - pool_registry:get_pool              — read pool core + stewards for a poolAgent
 *   - pool_registry:list_pools_by_steward — scan allSubjects + filter by steward
 *
 * Pool subject = the pool AgentAccount address as bytes32 (left-padded).
 */
import { type Address, type Hex, pad } from 'viem'
import { requireOrgPrincipalAny as requireOrgPrincipal } from '../auth/principal-context.js'
import { poolRegistryAbi } from '@smart-agent/sdk'
import { requirePoolRegistryAddress, getPublicClient } from '../lib/contracts.js'

const mcpText = <T>(v: T) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v) }] })

function poolSubject(poolAgent: Address): Hex {
  return pad(poolAgent, { size: 32 }) as Hex
}

// ─── Tool: pool_registry:get_pool ──────────────────────────────────────

const getPoolTool = {
  name: 'pool_registry:get_pool',
  description:
    "Read a pool's core record (domain, governance, mandate, stewards, accepted kinds/units, ceiling, visibility) from PoolRegistry.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token:     { type: 'string' },
      poolAgent: { type: 'string' },
    },
    required: ['token', 'poolAgent'],
  },
  handler: async (args: { token: string; poolAgent: Address }) => {
    await requireOrgPrincipal(args.token, args, 'pool_registry:get_pool')
    const target = requirePoolRegistryAddress()
    const pub = getPublicClient()
    const subj = poolSubject(args.poolAgent)
    try {
      const [
        slug, domain, governance, mandateHash, mandateURI,
        acceptedKinds, acceptedUnits, ceilingPolicy, capacityCeiling,
        stewards, visibility, restrictionsJson, openedAt, closedAt, isOpen,
      ] = await Promise.all([
        pub.readContract({ address: target, abi: poolRegistryAbi, functionName: 'getPoolSlug',           args: [subj] }) as Promise<string>,
        pub.readContract({ address: target, abi: poolRegistryAbi, functionName: 'getDomain',             args: [subj] }) as Promise<string>,
        pub.readContract({ address: target, abi: poolRegistryAbi, functionName: 'getGovernanceModel',    args: [subj] }) as Promise<Hex>,
        pub.readContract({ address: target, abi: poolRegistryAbi, functionName: 'getMandate',            args: [subj] }) as Promise<readonly [Hex, string]>,
        Promise.resolve(''),
        pub.readContract({ address: target, abi: poolRegistryAbi, functionName: 'getAcceptedKinds',      args: [subj] }) as Promise<readonly string[]>,
        pub.readContract({ address: target, abi: poolRegistryAbi, functionName: 'getAcceptedUnits',      args: [subj] }) as Promise<readonly string[]>,
        pub.readContract({ address: target, abi: poolRegistryAbi, functionName: 'getCeilingPolicy',      args: [subj] }) as Promise<Hex>,
        pub.readContract({ address: target, abi: poolRegistryAbi, functionName: 'getCapacityCeiling',    args: [subj] }) as Promise<bigint>,
        pub.readContract({ address: target, abi: poolRegistryAbi, functionName: 'getStewards',           args: [subj] }) as Promise<readonly Address[]>,
        pub.readContract({ address: target, abi: poolRegistryAbi, functionName: 'getVisibility',         args: [subj] }) as Promise<Hex>,
        pub.readContract({ address: target, abi: poolRegistryAbi, functionName: 'getAcceptedRestrictions', args: [subj] }) as Promise<string>,
        pub.readContract({ address: target, abi: poolRegistryAbi, functionName: 'getOpenedAt',           args: [subj] }) as Promise<bigint>,
        pub.readContract({ address: target, abi: poolRegistryAbi, functionName: 'getClosedAt',           args: [subj] }) as Promise<bigint>,
        pub.readContract({ address: target, abi: poolRegistryAbi, functionName: 'isOpen',                args: [subj] }) as Promise<boolean>,
      ])
      // Unpack the getMandate tuple (mandateHash, mandateURI) into the
      // declared placeholders since Promise.all keeps positional ordering.
      const _mh = mandateHash[0]
      const _mu = mandateHash[1]
      void mandateURI
      return mcpText({
        pool: {
          poolAgent: args.poolAgent,
          slug,
          domain,
          governance,
          mandateHash: _mh,
          mandateURI: _mu,
          acceptedKinds,
          acceptedUnits,
          ceilingPolicy,
          capacityCeiling: capacityCeiling.toString(),
          stewards,
          visibility,
          restrictionsJson,
          openedAt: Number(openedAt),
          closedAt: Number(closedAt),
          isOpen,
        },
      })
    } catch (e) {
      return mcpText({ pool: null, error: (e as Error).message })
    }
  },
}

// ─── Tool: pool_registry:list_pools_by_steward ─────────────────────────

const listPoolsByStewardTool = {
  name: 'pool_registry:list_pools_by_steward',
  description:
    "Enumerate every pool whose stewards include the given address. Scans PoolRegistry.allSubjects() and filters by getStewards.",
  inputSchema: {
    type: 'object' as const,
    properties: {
      token:    { type: 'string' },
      steward:  { type: 'string' },
      limit:    { type: 'integer' },
    },
    required: ['token', 'steward'],
  },
  handler: async (args: { token: string; steward: Address; limit?: number }) => {
    await requireOrgPrincipal(args.token, args, 'pool_registry:list_pools_by_steward')
    const target = requirePoolRegistryAddress()
    const pub = getPublicClient()
    const limit = args.limit ?? 50
    let subjects: Hex[] = []
    try {
      subjects = await pub.readContract({
        address: target, abi: poolRegistryAbi, functionName: 'allSubjects',
      }) as Hex[]
    } catch {
      return mcpText({ pools: [] })
    }
    const want = args.steward.toLowerCase()
    const rows: Array<{ poolAgent: Hex; slug: string; isOpen: boolean }> = []
    for (const subj of subjects) {
      try {
        const stewards = await pub.readContract({
          address: target, abi: poolRegistryAbi,
          functionName: 'getStewards', args: [subj],
        }) as readonly Address[]
        if (!stewards.map(s => s.toLowerCase()).includes(want)) continue
        const slug = await pub.readContract({
          address: target, abi: poolRegistryAbi,
          functionName: 'getPoolSlug', args: [subj],
        }) as string
        const isOpen = await pub.readContract({
          address: target, abi: poolRegistryAbi,
          functionName: 'isOpen', args: [subj],
        }) as boolean
        rows.push({ poolAgent: subj, slug, isOpen })
        if (rows.length >= limit) break
      } catch { /* skip */ }
    }
    return mcpText({ pools: rows })
  },
}

export const poolRegistryReadTools = {
  'pool_registry:get_pool': getPoolTool,
  'pool_registry:list_pools_by_steward': listPoolsByStewardTool,
}
