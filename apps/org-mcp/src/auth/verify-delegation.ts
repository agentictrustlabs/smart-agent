import {
  verifyDelegationToken,
  hashDelegation,
  decodeTimestampTerms,
  decodeMcpToolScopeTerms,
  decodeDataScopeTerms,
  MCP_TOOL_SCOPE_ENFORCER,
  DATA_SCOPE_ENFORCER,
  agentAccountAbi,
  delegationManagerAbi,
} from '@smart-agent/sdk'
import type { DataScopeGrant } from '@smart-agent/sdk'
import { recoverMessageAddress, createPublicClient, http } from 'viem'
import { localhost } from 'viem/chains'
import { config } from '../config.js'
import { db } from '../db/index.js'
import { sql } from 'drizzle-orm'

const ERC1271_MAGIC_VALUE = '0x1626ba7e'

// Audience identifier for delegation tokens directed at org-mcp.
// Mirrors person-mcp's 'urn:mcp:server:person'.
const ORG_MCP_AUDIENCE = 'urn:mcp:server:org'

/**
 * Full delegation chain verification (mirror of person-mcp's flow):
 *
 *   1. HMAC integrity (envelope not tampered)
 *   2. Session key ECDSA recovery
 *   3. delegation.delegate == recovered session key
 *   4. EIP-712 delegation hash
 *   5. DelegationManager.isRevoked() — not revoked
 *   6. ERC-1271 on delegator's AgentAccount — owner signed
 *   7. Caveat enforcement (timestamp, MCP tool scope)
 *   8. JTI usage tracking (atomic)
 *   9. Extract orgPrincipal = delegation.delegator
 */
export async function verifyDelegationAndExtractOrgPrincipal(
  token: string,
  toolName?: string,
): Promise<{ orgPrincipal: string } | { error: string }> {

  const result = await verifyDelegationToken(
    token,
    async (message: string, signature: `0x${string}`) => {
      return recoverMessageAddress({ message, signature })
    },
  )

  if (!result.valid || !result.claims) {
    console.warn(`[org-mcp][verify-delegation] failed (token=${(token ?? '').slice(0, 32)}…, len=${(token ?? '').length}): ${result.error}`)
    return { error: `Delegation verification failed: ${result.error ?? 'unknown'}` }
  }

  const { claims } = result

  if (claims.aud !== ORG_MCP_AUDIENCE) {
    return { error: `Invalid audience: ${claims.aud}` }
  }

  if (claims.delegation.delegate.toLowerCase() !== claims.sessionKeyAddress.toLowerCase()) {
    return { error: 'Delegation delegate does not match session key' }
  }

  const delegationManagerAddr = config.delegationManagerAddress

  {
    const publicClient = createPublicClient({
      chain: { ...localhost, id: config.chainId },
      transport: http(config.rpcUrl),
    })

    const delegationHash = hashDelegation(
      {
        delegator: claims.delegation.delegator,
        delegate: claims.delegation.delegate,
        authority: claims.delegation.authority,
        caveats: claims.delegation.caveats,
        salt: claims.delegation.salt,
      },
      config.chainId,
      delegationManagerAddr,
    )

    try {
      const revoked = await publicClient.readContract({
        address: delegationManagerAddr,
        abi: delegationManagerAbi,
        functionName: 'isRevoked',
        args: [delegationHash],
      }) as boolean

      if (revoked) {
        return { error: 'Delegation has been revoked' }
      }
    } catch (err) {
      return { error: `Revocation check failed: ${err instanceof Error ? err.message : String(err)}` }
    }

    try {
      const returnValue = await publicClient.readContract({
        address: claims.delegation.delegator,
        abi: agentAccountAbi,
        functionName: 'isValidSignature',
        args: [delegationHash, claims.delegation.signature],
      })

      if (returnValue !== ERC1271_MAGIC_VALUE) {
        return { error: 'ERC-1271 delegation signature invalid' }
      }
    } catch (err) {
      return { error: `ERC-1271 verification error: ${err instanceof Error ? err.message : String(err)}` }
    }
  }

  const timestampEnforcerAddr = (process.env.TIMESTAMP_ENFORCER_ADDRESS ?? '').toLowerCase()
  for (const caveat of claims.delegation.caveats) {
    // Only decode timestamp terms when the caveat IS the TimestampEnforcer.
    // Other caveats (AllowedTargets, AllowedMethods, etc.) ABI-decode into
    // garbage values when treated as (uint256, uint256) — historical bug
    // that only surfaced once richer caveats were composed in Phase 1.
    if (timestampEnforcerAddr && caveat.enforcer.toLowerCase() === timestampEnforcerAddr) {
      try {
        const { validAfter, validUntil } = decodeTimestampTerms(caveat.terms)
        const now = Math.floor(Date.now() / 1000)
        if (now < validAfter) return { error: `Delegation not yet valid (validAfter: ${validAfter})` }
        if (now >= validUntil) return { error: `Delegation expired (validUntil: ${validUntil})` }
      } catch {
        return { error: 'Failed to decode timestamp caveat' }
      }
      continue
    }

    const mcpScopeEnforcerAddr = (process.env.MCP_TOOL_SCOPE_ENFORCER_ADDRESS ?? MCP_TOOL_SCOPE_ENFORCER).toLowerCase()
    if (caveat.enforcer.toLowerCase() === mcpScopeEnforcerAddr) {
      try {
        const { allowedTools } = decodeMcpToolScopeTerms(caveat.terms)
        if (toolName && !allowedTools.includes(toolName)) {
          return { error: `Tool '${toolName}' not permitted by delegation scope` }
        }
      } catch {
        return { error: 'Failed to decode MCP tool scope caveat' }
      }
    }
  }

  const jti = claims.jti
  if (jti) {
    try {
      const now = new Date().toISOString()
      const orgPrincipal = claims.delegation.delegator.toLowerCase()
      const limit = claims.usageLimit

      const result = db.run(sql`
        INSERT INTO org_token_usage (jti, org_principal, usage_count, usage_limit, first_used_at, last_used_at)
        VALUES (${jti}, ${orgPrincipal}, 1, ${limit}, ${now}, ${now})
        ON CONFLICT(jti) DO UPDATE SET
          usage_count = usage_count + 1,
          last_used_at = ${now}
        WHERE usage_count < usage_limit
      `)

      if (result.changes === 0) {
        return { error: `Token usage limit exceeded for jti ${jti}` }
      }
    } catch (err) {
      return { error: `JTI tracking failed: ${err instanceof Error ? err.message : String(err)}` }
    }
  }

  return { orgPrincipal: claims.delegation.delegator.toLowerCase() }
}

// ═══════════════════════════════════════════════════════════════════
// Cross-Principal Delegation Verification (org-mcp variant)
// ═══════════════════════════════════════════════════════════════════

export interface CrossDelegationResult {
  dataPrincipal: string
  grants: DataScopeGrant[]
}

export async function verifyCrossDelegation(
  crossDelegation: {
    delegator: `0x${string}`
    delegate: `0x${string}`
    authority: `0x${string}`
    caveats: Array<{ enforcer: `0x${string}`; terms: `0x${string}` }>
    salt: string
    signature: `0x${string}`
  },
  _callerPrincipal: string,
  targetServer: string = ORG_MCP_AUDIENCE,
): Promise<CrossDelegationResult | { error: string }> {

  const delegationManagerAddr = config.delegationManagerAddress

  const publicClient = createPublicClient({
    chain: { ...localhost, id: config.chainId },
    transport: http(config.rpcUrl),
  })

  const delegationHash = hashDelegation(
    {
      delegator: crossDelegation.delegator,
      delegate: crossDelegation.delegate,
      authority: crossDelegation.authority,
      caveats: crossDelegation.caveats,
      salt: crossDelegation.salt,
    },
    config.chainId,
    delegationManagerAddr,
  )

  try {
    const revoked = await publicClient.readContract({
      address: delegationManagerAddr,
      abi: delegationManagerAbi,
      functionName: 'isRevoked',
      args: [delegationHash],
    }) as boolean
    if (revoked) return { error: 'Cross-principal delegation has been revoked' }
  } catch (err) {
    return { error: `Cross-delegation revocation check failed: ${err instanceof Error ? err.message : String(err)}` }
  }

  try {
    const returnValue = await publicClient.readContract({
      address: crossDelegation.delegator,
      abi: agentAccountAbi,
      functionName: 'isValidSignature',
      args: [delegationHash, crossDelegation.signature],
    })
    if (returnValue !== ERC1271_MAGIC_VALUE) {
      return { error: 'Cross-delegation signature invalid' }
    }
  } catch (err) {
    return { error: `Cross-delegation ERC-1271 verification error: ${err instanceof Error ? err.message : String(err)}` }
  }

  let grants: DataScopeGrant[] = []
  for (const caveat of crossDelegation.caveats) {
    const enforcerAddr = caveat.enforcer.toLowerCase()
    if (enforcerAddr === DATA_SCOPE_ENFORCER.toLowerCase()) {
      try {
        grants = decodeDataScopeTerms(caveat.terms)
      } catch {
        return { error: 'Failed to decode data scope caveat' }
      }
      continue
    }
    try {
      const { validAfter, validUntil } = decodeTimestampTerms(caveat.terms)
      if (validAfter > 1577836800 && validUntil > 1577836800) {
        const now = Math.floor(Date.now() / 1000)
        if (now < validAfter) return { error: `Cross-delegation not yet valid` }
        if (now >= validUntil) return { error: `Cross-delegation expired` }
      }
    } catch { /* not a timestamp caveat */ }
  }

  const serverGrants = grants.filter(g => g.server === targetServer)
  if (serverGrants.length === 0) {
    return { error: `Cross-delegation has no grants for server ${targetServer}` }
  }

  return {
    dataPrincipal: crossDelegation.delegator.toLowerCase(),
    grants: serverGrants,
  }
}
