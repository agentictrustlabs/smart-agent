/**
 * Treasury resolution — spec-006.
 *
 * The recipient/donor of any commitment is a treasury AgentAccount.
 * Every party (org or person) declares theirs via on-chain predicates:
 *
 *   sa:hasTreasury           — generic pointer, set by org / person owner
 *   sa:hasPersonalTreasury   — spec-005 self-link for person agents
 *
 * Resolution priority (first match wins):
 *   1. proposerPrincipal is a hex AgentAccount address →
 *      a. read sa:hasTreasury on it; if non-zero, return.
 *      b. read sa:hasPersonalTreasury on it; if non-zero, return.
 *      c. return the address itself (self-as-treasury fallback).
 *   2. proposerPrincipal is a non-hex form ("did:…", "person_…",
 *      "nullifier:…", "0x…40-hex-pretending-to-be-a-principal-id") →
 *      use the caller-provided PrincipalToAgentResolver to map to an
 *      AgentAccount, then recurse with the address path.
 *   3. Unresolved → return null. Caller stamps the commitment as
 *      `ReleasesBlocked` and exposes a setRecipient action.
 */

import type { Address, PublicClient } from 'viem'
import { getAddress, isAddress } from 'viem'
import { agentAccountResolverAbi } from './abi'
import { SA_HAS_TREASURY, SA_HAS_PERSONAL_TREASURY } from './predicates'

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address

/**
 * Pluggable mapper from a non-hex principal id (did:, person_, nullifier:)
 * to the underlying AgentAccount address. Provided by the caller — the SDK
 * intentionally doesn't depend on a specific MCP transport.
 */
export interface PrincipalToAgentResolver {
  resolveAgent(principal: string): Promise<Address | null>
}

export interface ResolveRecipientContext {
  publicClient: PublicClient
  /** AgentAccountResolver contract address. */
  resolverAddress: Address
  /** Required for non-hex principal inputs; safe to omit for hex-only contexts. */
  principalToAgent?: PrincipalToAgentResolver
}

async function readAddressPredicate(
  ctx: ResolveRecipientContext,
  subject: Address,
  predicate: `0x${string}`,
): Promise<Address | null> {
  try {
    const v = (await ctx.publicClient.readContract({
      address: ctx.resolverAddress,
      abi: agentAccountResolverAbi,
      functionName: 'getAddressProperty',
      args: [subject, predicate],
    })) as Address
    if (!v || v.toLowerCase() === ZERO_ADDRESS) return null
    return getAddress(v)
  } catch {
    return null
  }
}

/**
 * Resolve a proposer/donor principal to the AgentAccount address that should
 * receive (or send) funds. Returns null if the principal can't be resolved
 * to any agent at all — at which point the caller stamps a `ReleasesBlocked`
 * commitment.
 */
export async function resolveRecipientTreasury(
  proposerPrincipal: string,
  ctx: ResolveRecipientContext,
): Promise<Address | null> {
  if (!proposerPrincipal) return null

  // Path 1: hex address principal. Walk sa:hasTreasury → sa:hasPersonalTreasury → self.
  if (isAddress(proposerPrincipal)) {
    const agent = getAddress(proposerPrincipal)
    const t = await readAddressPredicate(ctx, agent, SA_HAS_TREASURY)
    if (t) return t
    const pt = await readAddressPredicate(ctx, agent, SA_HAS_PERSONAL_TREASURY)
    if (pt) return pt
    return agent // self-as-treasury
  }

  // Path 2: non-hex principal. Need a PrincipalToAgentResolver to bridge.
  if (!ctx.principalToAgent) return null
  let resolvedAgent: Address | null
  try {
    resolvedAgent = await ctx.principalToAgent.resolveAgent(proposerPrincipal)
  } catch {
    return null
  }
  if (!resolvedAgent) return null
  return resolveRecipientTreasury(resolvedAgent, ctx)
}
