import { verifyDelegationAndExtractPrincipal } from './verify-delegation.js'

/**
 * Require a valid delegation token and return the verified principal address.
 *
 * @param token - Base64url-encoded delegation token
 * @param toolName - Optional MCP tool name to validate against tool scope caveats
 * @returns Lowercase hex principal address
 * @throws Error if token is missing, invalid, or tool is not in scope
 */
export async function requirePrincipal(token: string | undefined, toolName?: string): Promise<string> {
  if (!token) {
    throw new Error('Missing delegation token')
  }

  const result = await verifyDelegationAndExtractPrincipal(token, toolName)

  if ('error' in result) {
    throw new Error(`Delegation verification failed: ${result.error}`)
  }

  return result.principal.toLowerCase() as string
}
