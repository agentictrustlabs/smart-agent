/**
 * Smart-account → person-agent resolution for org-mcp's cross-delegation
 * verifier (Sprint 4 A.2, Option A defense in depth).
 *
 * Mirrors `apps/person-mcp/src/auth/resolve-person-agent.ts`. See that
 * file for the full design notes — the rationale (Option C in-caveat
 * binding is authoritative, Option A is defense-in-depth via chain
 * resolution) and the caching strategy (60-second TTL, in-memory,
 * negative results cached too) apply identically here.
 *
 * The only difference is the call site: org-mcp's
 * `verifyCrossDelegation` uses this when the cross-delegation carries a
 * `DelegateBinding` caveat — we resolve the caller's smart-account to a
 * person-agent on chain and assert the binding's `delegatePersonAgent`
 * still matches.
 */

import { createPublicClient, http } from 'viem'
import { localhost } from 'viem/chains'
import {
  agentAccountResolverAbi,
  ATL_CONTROLLER,
  TYPE_PERSON,
} from '@smart-agent/sdk'
import { config } from '../config.js'

interface CacheEntry {
  personAgent: `0x${string}` | null
  expiresAt: number
}

const CACHE_TTL_MS = 60_000
const cache = new Map<string, CacheEntry>()

/** For tests: clear the in-memory cache between cases. */
export function resetResolvePersonAgentCacheForTest(): void {
  cache.clear()
}

/** For tests: return cache stats so we can assert hit/miss behavior. */
export interface PersonAgentResolveStats {
  hits: number
  misses: number
  chainReads: number
}
const stats: PersonAgentResolveStats = { hits: 0, misses: 0, chainReads: 0 }
export function getResolvePersonAgentStats(): PersonAgentResolveStats {
  return { ...stats }
}
export function resetResolvePersonAgentStatsForTest(): void {
  stats.hits = 0
  stats.misses = 0
  stats.chainReads = 0
}

/**
 * Resolve the on-chain person-agent address for a given smart-account.
 *
 * Strategy:
 *   1. Single-account fast path — `getCore(smartAccount)`; if
 *      `agentType === TYPE_PERSON`, return the smart account.
 *   2. Fallback — walk the AgentAccountResolver registry, find
 *      PersonAgent entries whose `ATL_CONTROLLER` list contains the
 *      smart-account.
 *
 * @returns The person-agent address, or `null` if no person-agent can be
 *          resolved. `null` is cached negatively (60s TTL).
 *
 * @throws Never — chain errors return `null`.
 */
export async function resolvePersonAgentForSmartAccount(
  smartAccount: `0x${string}`,
): Promise<`0x${string}` | null> {
  const key = smartAccount.toLowerCase()
  const now = Date.now()
  const cached = cache.get(key)
  if (cached && cached.expiresAt > now) {
    stats.hits++
    return cached.personAgent
  }
  stats.misses++

  // Read at runtime so tests can override per-case and so we always see
  // the current deployed address (rotation via redeploy + restart).
  const envAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}` | undefined
  const resolverAddr = envAddr ?? config.agentAccountResolverAddress
  // Treat unset OR zero-address as "no resolver configured" — both mean
  // we cannot enforce Option A. The binding caveat (Option C) remains
  // authoritative.
  if (!resolverAddr || resolverAddr.toLowerCase() === '0x0000000000000000000000000000000000000000') {
    cache.set(key, { personAgent: null, expiresAt: now + CACHE_TTL_MS })
    return null
  }

  const publicClient = createPublicClient({
    chain: { ...localhost, id: config.chainId },
    transport: http(config.rpcUrl),
  })

  try {
    // Fast path: is the smart-account itself a registered PersonAgent?
    stats.chainReads++
    const core = await publicClient.readContract({
      address: resolverAddr,
      abi: agentAccountResolverAbi,
      functionName: 'getCore',
      args: [smartAccount],
    }) as { agentType: `0x${string}` }

    if (core.agentType === TYPE_PERSON) {
      cache.set(key, { personAgent: key as `0x${string}`, expiresAt: now + CACHE_TTL_MS })
      return key as `0x${string}`
    }
  } catch {
    // getCore reverts if the address isn't registered — fall through.
  }

  // Fallback: walk PersonAgent entries and find one whose ATL_CONTROLLER
  // list contains the smart-account address. Handles dual-account
  // users where EOA wallet → PersonAgent smart account, but the session
  // is signed off a separate "wallet smart account" registered as a
  // controller on the PersonAgent.
  try {
    stats.chainReads++
    const count = await publicClient.readContract({
      address: resolverAddr,
      abi: agentAccountResolverAbi,
      functionName: 'agentCount',
    }) as bigint

    const indexes = Array.from({ length: Number(count) }, (_, i) => BigInt(i))
    stats.chainReads += indexes.length
    const agentAddrs = await Promise.all(indexes.map(i =>
      publicClient.readContract({
        address: resolverAddr,
        abi: agentAccountResolverAbi,
        functionName: 'getAgentAt',
        args: [i],
      }) as Promise<`0x${string}`>,
    ))

    stats.chainReads += agentAddrs.length
    const cores = await Promise.all(agentAddrs.map(a =>
      publicClient.readContract({
        address: resolverAddr,
        abi: agentAccountResolverAbi,
        functionName: 'getCore',
        args: [a],
      }) as Promise<{ agentType: `0x${string}` }>,
    ))
    const persons = agentAddrs.filter((_, i) => cores[i].agentType === TYPE_PERSON)

    stats.chainReads += persons.length
    const controllerLists = await Promise.all(persons.map(a =>
      publicClient.readContract({
        address: resolverAddr,
        abi: agentAccountResolverAbi,
        functionName: 'getMultiAddressProperty',
        args: [a, ATL_CONTROLLER as `0x${string}`],
      }) as Promise<string[]>,
    ))

    for (let i = 0; i < persons.length; i++) {
      if (controllerLists[i].some(c => c.toLowerCase() === key)) {
        const resolved = persons[i].toLowerCase() as `0x${string}`
        cache.set(key, { personAgent: resolved, expiresAt: now + CACHE_TTL_MS })
        return resolved
      }
    }
  } catch {
    // chain unreachable — fall through to null result
  }

  cache.set(key, { personAgent: null, expiresAt: now + CACHE_TTL_MS })
  return null
}
