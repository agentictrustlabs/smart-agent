import { verifyDelegationAndExtractOrgPrincipal } from './verify-delegation.js'

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
