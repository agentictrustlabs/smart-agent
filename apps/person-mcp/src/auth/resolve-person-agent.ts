/**
 * Smart-account → person-agent resolution for person-mcp's cross-delegation
 * verifier (Sprint 2 S2.3, Option A defense in depth).
 *
 * Why this exists
 * ---------------
 * The cross-delegation in `verifyCrossDelegation` carries an explicit
 * `DelegateBinding` caveat that names BOTH the recipient's smart-account
 * and their person-agent address. Option C (in-caveat dual binding) is
 * authoritative because both addresses are committed to the data
 * owner's EIP-712 signature. This helper adds Option A on top — at
 * verify time we resolve the caller's smart-account → person-agent via
 * the on-chain `AgentAccountResolver` and assert the result still
 * matches the binding caveat. A divergence (e.g. registry corruption,
 * stale caveat, mis-signed delegation) is treated as a hard reject.
 *
 * Single-account model
 * --------------------
 * For OAuth / passkey / SIWE users the smart-account IS the person
 * agent (see `apps/web/src/lib/agent-registry.ts::getPersonAgentForUser`).
 * In that case the resolver returns the same address back and the
 * binding-caveat's two fields are equal. The check still runs — it just
 * never disagrees.
 *
 * Caching
 * -------
 * Each verify call would otherwise issue N chain reads (`agentCount`,
 * `getAgentAt × N`, `getCore × N`, `getMultiAddressProperty × N`). We
 * cache the resolved person-agent address per smart-account with a
 * 60-second TTL. The cache is in-memory and process-local — fine for
 * person-mcp's single-process deployment; if we ever shard, replace
 * with a redis-backed cache. Empty results ("no person-agent
 * registered") are also cached negatively so we don't re-walk the
 * registry on each failed lookup.
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
 *   1. Single-account fast path — most demo / dev users have a single
 *      AgentAccount that IS their person-agent. Try `getCore(smartAccount)`
 *      first; if `agentType === TYPE_PERSON`, return the smart account.
 *   2. Fallback — walk the AgentAccountResolver registry, find PersonAgent
 *      entries whose `ATL_CONTROLLER` list contains the smart-account.
 *
 * @returns The person-agent address, or `null` if no person-agent can be
 *          resolved. `null` is cached negatively (60s TTL).
 *
 * @throws Never — chain errors return `null` so the verifier sees a
 *         "not resolvable" outcome rather than a 500.
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

  // Read the env at runtime rather than via the module-init `config`
  // snapshot — tests need to override the resolver address per-case
  // without re-importing the module, and security-critical reads
  // shouldn't capture the value at boot when the actual deployed
  // address may rotate via redeploy + restart.
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
    // getCore reverts if the address isn't registered — fall through to
    // the controller-walk path below.
  }

  // Fallback: walk PersonAgent entries and find one whose ATL_CONTROLLER
  // list contains the smart-account address. This handles dual-account
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
