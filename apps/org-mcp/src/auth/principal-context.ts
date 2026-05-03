import {
  verifyDelegationAndExtractOrgPrincipal,
  verifyCrossDelegation,
} from './verify-delegation.js'
import {
  verifyDelegationToken,
} from '@smart-agent/sdk'
import { recoverMessageAddress } from 'viem'

/**
 * Require a valid delegation token and return the verified org-principal address.
 *
 * @param token - Base64url-encoded delegation token
 * @param toolName - Optional MCP tool name to validate against tool scope caveats
 * @returns Lowercase hex org-principal address
 * @throws Error if token is missing, invalid, or tool is not in scope
 */
export async function requireOrgPrincipal(token: string | undefined, toolName?: string): Promise<string> {
  if (!token) {
    throw new Error('Missing delegation token')
  }

  const result = await verifyDelegationAndExtractOrgPrincipal(token, toolName)

  if ('error' in result) {
    throw new Error(`Delegation verification failed: ${result.error}`)
  }

  return result.orgPrincipal.toLowerCase() as string
}

export interface OrgCrossDelegationInput {
  delegator: `0x${string}`
  delegate: `0x${string}`
  authority: `0x${string}`
  caveats: Array<{ enforcer: `0x${string}`; terms: `0x${string}` }>
  salt: string
  signature: `0x${string}`
}

/**
 * Bridged auth path: caller has a valid session for their OWN smart account
 * AND presents a signed cross-delegation Org→user-smart-account. Org-mcp
 * verifies both, asserts the bridge, and returns orgPrincipal = the org's
 * smart-account address.
 *
 * Chain: User EOA → User Smart Account (signs session) ←→ Cross-Delegation
 *        delegate ←- Org Smart Account (delegator, signed via ERC-1271).
 *
 * @throws Error on any verification failure.
 */
export async function requireOrgPrincipalViaCrossDelegation(
  token: string | undefined,
  crossDelegation: OrgCrossDelegationInput,
  _toolName?: string,
): Promise<string> {
  if (!token) throw new Error('Missing delegation token')
  if (!crossDelegation || !crossDelegation.delegator || !crossDelegation.delegate || !crossDelegation.signature) {
    throw new Error('Missing cross-delegation')
  }

  const sessionResult = await verifyDelegationToken(
    token,
    async (message: string, signature: `0x${string}`) =>
      recoverMessageAddress({ message, signature }),
  )
  if (!sessionResult.valid || !sessionResult.claims) {
    throw new Error(`Session verification failed: ${sessionResult.error ?? 'unknown'}`)
  }
  const callerPrincipal = sessionResult.claims.delegation.delegator.toLowerCase()

  if (crossDelegation.delegate.toLowerCase() !== callerPrincipal) {
    throw new Error('Cross-delegation delegate does not match session principal')
  }

  const cross = await verifyCrossDelegation(crossDelegation, callerPrincipal)
  if ('error' in cross) {
    throw new Error(`Cross-delegation verification failed: ${cross.error}`)
  }

  return crossDelegation.delegator.toLowerCase()
}

/**
 * Convenience entry point: if a `crossDelegation` arg was provided, use the
 * bridged path; otherwise use the direct delegation path. Lets every tool
 * support both flows with a single call site.
 */
export async function requireOrgPrincipalAny(
  token: string | undefined,
  args: unknown,
  toolName?: string,
): Promise<string> {
  const cross = (args as { crossDelegation?: OrgCrossDelegationInput } | null | undefined)?.crossDelegation
  if (cross && typeof cross === 'object') {
    return requireOrgPrincipalViaCrossDelegation(token, cross, toolName)
  }
  return requireOrgPrincipal(token, toolName)
}
