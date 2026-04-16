import { getAgentMetadata } from '@/lib/agent-metadata'
import { toDidEthr } from '@smart-agent/sdk'

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')

/**
 * Get the best display identifier for an agent:
 * 1. .agent primary name (e.g., "david.fortcollins.catalyst.agent")
 * 2. did:ethr DID (e.g., "did:ethr:31337:0x...")
 * 3. Truncated address (e.g., "0xf39F...2266")
 *
 * Returns both the identifier and the .agent name (if available) separately
 * so callers can show both if desired.
 */
export async function getAgentDisplayId(address: string): Promise<{
  /** The best identifier to show */
  displayId: string
  /** The .agent name if registered, empty string otherwise */
  agentName: string
  /** The did:ethr identifier */
  did: string
  /** Truncated address */
  shortAddress: string
}> {
  const meta = await getAgentMetadata(address)
  const did = toDidEthr(CHAIN_ID, address as `0x${string}`)
  const shortAddress = `${address.slice(0, 6)}...${address.slice(-4)}`
  const agentName = meta.primaryName || ''

  return {
    displayId: agentName || did,
    agentName,
    did,
    shortAddress,
  }
}

/**
 * Build a name map for multiple addresses in one batch.
 * More efficient than calling getAgentDisplayId for each one.
 */
export async function buildAgentDisplayMap(addresses: string[]): Promise<Map<string, {
  displayId: string
  agentName: string
  did: string
  displayName: string
}>> {
  const map = new Map<string, { displayId: string; agentName: string; did: string; displayName: string }>()
  for (const addr of addresses) {
    const meta = await getAgentMetadata(addr)
    const did = toDidEthr(CHAIN_ID, addr as `0x${string}`)
    const agentName = meta.primaryName || ''
    map.set(addr.toLowerCase(), {
      displayId: agentName || did,
      agentName,
      did,
      displayName: meta.displayName,
    })
  }
  return map
}
