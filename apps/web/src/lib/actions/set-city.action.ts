'use server'

/**
 * Set the caller's coarse geo tag (ATL_CITY / ATL_REGION / ATL_COUNTRY)
 * on their person agent in AgentAccountResolver.
 *
 *   geo-overlap.v1 reads these three string properties as the coarse
 *   filter before any GeoSPARQL feature lookup. Same-city pairs
 *   immediately gain a +1 point in the trust-search ranking.
 *
 * The deployer signs the writes (the demo/onboarding pattern); for a
 * full passkey/SIWE-signed profile-edit path, swap to a session-key or
 * batched WalletAction in a follow-on commit.
 */

import { getCurrentUser } from '@/lib/auth/get-current-user'
import { getPublicClient, getWalletClient } from '@/lib/contracts'
import { getPersonAgentForUser } from '@/lib/agent-registry'
import {
  agentAccountResolverAbi,
  ATL_CITY, ATL_REGION, ATL_COUNTRY,
} from '@smart-agent/sdk'

export interface SetCityInput {
  city: string
  region: string
  country: string
}

export async function setMyCityAction(input: SetCityInput): Promise<{ success: boolean; error?: string }> {
  try {
    const me = await getCurrentUser()
    if (!me) return { success: false, error: 'Not signed in' }

    const personAgent = (await getPersonAgentForUser(me.id)) as `0x${string}` | null
    if (!personAgent) return { success: false, error: 'No person agent — finish onboarding first' }

    const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}` | undefined
    if (!resolverAddr) return { success: false, error: 'AGENT_ACCOUNT_RESOLVER_ADDRESS not set' }

    const wc = getWalletClient()
    const pc = getPublicClient()

    const writes: Array<{ predicate: `0x${string}`; value: string }> = [
      { predicate: ATL_CITY    as `0x${string}`, value: input.city.trim() },
      { predicate: ATL_REGION  as `0x${string}`, value: input.region.trim() },
      { predicate: ATL_COUNTRY as `0x${string}`, value: input.country.trim() },
    ]

    for (const w of writes) {
      const hash = await wc.writeContract({
        address: resolverAddr,
        abi: agentAccountResolverAbi,
        functionName: 'setStringProperty',
        args: [personAgent, w.predicate, w.value],
      })
      await pc.waitForTransactionReceipt({ hash })
    }

    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'set city failed' }
  }
}

export async function getMyCityAction(): Promise<{ city: string; region: string; country: string } | null> {
  const me = await getCurrentUser()
  if (!me) return null
  const personAgent = (await getPersonAgentForUser(me.id)) as `0x${string}` | null
  if (!personAgent) return null
  const resolverAddr = process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}` | undefined
  if (!resolverAddr) return null
  const pc = getPublicClient()
  async function read(predicate: `0x${string}`): Promise<string> {
    try {
      return (await pc.readContract({
        address: resolverAddr!,
        abi: agentAccountResolverAbi,
        functionName: 'getStringProperty',
        args: [personAgent!, predicate],
      })) as string
    } catch { return '' }
  }
  const [city, region, country] = await Promise.all([
    read(ATL_CITY    as `0x${string}`),
    read(ATL_REGION  as `0x${string}`),
    read(ATL_COUNTRY as `0x${string}`),
  ])
  return { city, region, country }
}
