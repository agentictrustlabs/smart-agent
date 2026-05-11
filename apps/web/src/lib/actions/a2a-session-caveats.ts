/**
 * Sync helpers for assembling the A2A delegation's caveat set.
 *
 * These live in their own module (NOT in `a2a-session.action.ts`)
 * because that file is `'use server'`, which Next.js requires every
 * export to be `async`. The helpers below need to be importable from
 * synchronous code paths (e.g. `/api/a2a/bootstrap/client/route.ts`'s
 * delegation builder) so they have to live outside the server-action
 * boundary.
 */

import { toFunctionSelector, type AbiFunction } from 'viem'
import {
  poolRegistryAbi,
  fundRegistryAbi,
  agentAccountFactoryAbi,
  listAllowedFunctionNames,
  listAllowedTargetSymbols,
  resolveTargetAddress,
} from '@smart-agent/sdk'

interface AbiByTarget {
  PoolRegistry: readonly unknown[]
  FundRegistry: readonly unknown[]
  AgentAccountFactory: readonly unknown[]
}

const ABIS: AbiByTarget = {
  PoolRegistry: poolRegistryAbi as readonly unknown[],
  FundRegistry: fundRegistryAbi as readonly unknown[],
  AgentAccountFactory: agentAccountFactoryAbi as readonly unknown[],
}

function selectorOf(targetSymbol: keyof AbiByTarget, functionName: string): `0x${string}` {
  const abi = ABIS[targetSymbol]
  if (!abi) throw new Error(`No ABI registered for target ${targetSymbol}`)
  const fn = (abi as readonly AbiFunction[]).find(
    (it) => it && (it as AbiFunction).type === 'function' && (it as AbiFunction).name === functionName,
  )
  if (!fn) throw new Error(`a2a-session.bootstrap: ABI for ${targetSymbol} is missing function "${functionName}"`)
  return toFunctionSelector(fn)
}

export function computeAllowedSelectors(): `0x${string}`[] {
  const out = new Set<`0x${string}`>()
  for (const { target, functionName } of listAllowedFunctionNames()) {
    if (!(target in ABIS)) continue
    out.add(selectorOf(target as keyof AbiByTarget, functionName))
  }
  // Phase 1 also covers the pool-agent factory deploy path via /session/deploy-agent.
  // The on-chain redeem will go through AgentAccountFactory.createAccount; include
  // that selector so the AllowedMethods caveat doesn't reject it.
  try {
    out.add(selectorOf('AgentAccountFactory', 'createAccount'))
  } catch {
    /* factory ABI may not expose createAccount in some builds — non-fatal */
  }
  return Array.from(out)
}

export function computeAllowedTargetAddresses(): `0x${string}`[] {
  const env = process.env as Record<string, string | undefined>
  const symbols = listAllowedTargetSymbols()
  const out: `0x${string}`[] = []
  for (const sym of symbols) {
    const addr = resolveTargetAddress(sym, env)
    if (addr) out.push(addr)
  }
  // Include AgentAccountFactory if the registry didn't already (deploy-agent path).
  const factoryAddr = env.AGENT_FACTORY_ADDRESS as `0x${string}` | undefined
  if (factoryAddr && !out.includes(factoryAddr)) out.push(factoryAddr)
  return out
}
