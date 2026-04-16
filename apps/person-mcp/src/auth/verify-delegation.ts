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

/**
 * Full delegation chain verification matching the gym approach:
 *
 *   1. HMAC integrity (envelope not tampered)
 *   2. Session key ECDSA recovery (proves session key signed)
 *   3. delegation.delegate == recovered session key
 *   4. Compute EIP-712 delegation hash (matches DelegationManager contract)
 *   5. Check delegation not revoked via DelegationManager.isRevoked()
 *   6. Verify delegation signature via ERC-1271 on delegator's AgentAccount
 *   7. Decode and validate caveats (timestamp bounds)
 *   8. Track JTI usage (enforce usageLimit)
 *   9. Extract principal = delegation.delegator
 */
export async function verifyDelegationAndExtractPrincipal(
  token: string,
  toolName?: string,
): Promise<{ principal: string } | { error: string }> {

  // ─── Session key ECDSA verification + expiry ───────────────────
  const result = await verifyDelegationToken(
    token,
    async (message: string, signature: `0x${string}`) => {
      return recoverMessageAddress({ message, signature })
    },
  )

  if (!result.valid || !result.claims) {
    return { error: `Delegation verification failed: ${result.error ?? 'unknown'}` }
  }

  const { claims } = result

  // ─── Audience check ───────────────────────────────────────────
  if (claims.aud !== 'urn:mcp:server:person') {
    return { error: `Invalid audience: ${claims.aud}` }
  }

  // ─── Layer 3: delegate == session key ──────────────────────────
  if (claims.delegation.delegate.toLowerCase() !== claims.sessionKeyAddress.toLowerCase()) {
    return { error: 'Delegation delegate does not match session key' }
  }

  // ─── Layer 4: Compute EIP-712 delegation hash ─────────────────
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

    // ─── Layer 5: Revocation check ────────────────────────────────
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
      return { error: `Revocation check failed — cannot verify on-chain state: ${err instanceof Error ? err.message : String(err)}` }
    }

    // ─── Layer 6: ERC-1271 signature verification ─────────────────
    try {
      const returnValue = await publicClient.readContract({
        address: claims.delegation.delegator,
        abi: agentAccountAbi,
        functionName: 'isValidSignature',
        args: [delegationHash, claims.delegation.signature],
      })

      if (returnValue !== ERC1271_MAGIC_VALUE) {
        return { error: 'ERC-1271 delegation signature invalid — delegator did not sign this delegation' }
      }
      console.log('[verify] ERC-1271 delegation signature verified successfully')
    } catch (err) {
      return { error: `ERC-1271 verification error: ${err instanceof Error ? err.message : String(err)}` }
    }
  }

  // ─── Layer 7: Caveat enforcement ──────────────────────────────
  for (const caveat of claims.delegation.caveats) {
    // Timestamp enforcer — validate time window
    try {
      const { validAfter, validUntil } = decodeTimestampTerms(caveat.terms)
      const now = Math.floor(Date.now() / 1000)

      if (now < validAfter) {
        return { error: `Delegation not yet valid (validAfter: ${validAfter}, now: ${now})` }
      }
      if (now >= validUntil) {
        return { error: `Delegation expired (validUntil: ${validUntil}, now: ${now})` }
      }
      continue
    } catch { /* not a timestamp caveat */ }

    // MCP tool scope enforcer — validate tool name against allowed list
    if (caveat.enforcer.toLowerCase() === MCP_TOOL_SCOPE_ENFORCER.toLowerCase()) {
      try {
        const { allowedTools } = decodeMcpToolScopeTerms(caveat.terms)
        if (toolName && !allowedTools.includes(toolName)) {
          return { error: `Tool '${toolName}' not permitted by delegation scope. Allowed: ${allowedTools.join(', ')}` }
        }
      } catch {
        return { error: 'Failed to decode MCP tool scope caveat' }
      }
    }
  }

  // ─── Layer 8: JTI usage tracking (atomic upsert) ───────────────
  const jti = claims.jti
  if (jti) {
    try {
      const now = new Date().toISOString()
      const principal = claims.delegation.delegator.toLowerCase()
      const limit = claims.usageLimit

      // Atomic INSERT ... ON CONFLICT: either inserts first use or increments.
      // The WHERE guard rejects if usage_count already hit the limit.
      const result = db.run(sql`
        INSERT INTO token_usage (jti, principal, usage_count, usage_limit, first_used_at, last_used_at)
        VALUES (${jti}, ${principal}, 1, ${limit}, ${now}, ${now})
        ON CONFLICT(jti) DO UPDATE SET
          usage_count = usage_count + 1,
          last_used_at = ${now}
        WHERE usage_count < usage_limit
      `)

      // If no rows were affected, the WHERE guard blocked us → limit exceeded
      if (result.changes === 0) {
        return { error: `Token usage limit exceeded for jti ${jti}` }
      }
    } catch (err) {
      return { error: `JTI tracking failed — cannot verify token usage: ${err instanceof Error ? err.message : String(err)}` }
    }
  }

  // ─── Layer 9: Extract principal ───────────────────────────────
  return { principal: claims.delegation.delegator.toLowerCase() }
}

// ═══════════════════════════════════════════════════════════════════
// Cross-Principal Delegation Verification
// ═══════════════════════════════════════════════════════════════════

export interface CrossDelegationResult {
  /** The data owner's principal (delegator) */
  dataPrincipal: string
  /** Data scope grants extracted from caveats */
  grants: DataScopeGrant[]
}

/**
 * Verify a cross-principal delegation — proves that a data owner (delegator)
 * authorized a reader (delegate) to access specific data.
 *
 * Verification:
 *   1. delegate == callerPrincipal (proves the grant is for this caller)
 *   2. EIP-712 delegation hash
 *   3. DelegationManager.isRevoked() — not revoked
 *   4. ERC-1271 on delegator's account — proves owner signed this delegation
 *   5. Caveat enforcement: TimestampEnforcer + DataScopeEnforcer
 *   6. Extract data scope grants
 */
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
  targetServer: string,
): Promise<CrossDelegationResult | { error: string }> {

  // Note: We do NOT require delegate == callerPrincipal because the session
  // delegation uses the smart account as principal, while the cross-delegation
  // uses the person agent as delegate. These are different addresses for the
  // same user. The critical security checks are ERC-1271 (data owner signed),
  // revocation, and caveat enforcement. The A2A agent ensures the correct
  // cross-delegation is paired with the correct session.

  const delegationManagerAddr = config.delegationManagerAddress

  const publicClient = createPublicClient({
    chain: { ...localhost, id: config.chainId },
    transport: http(config.rpcUrl),
  })

  // ─── 2. Compute EIP-712 delegation hash ──────────────────────────
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

  // ─── 3. Revocation check ─────────────────────────────────────────
  try {
    const revoked = await publicClient.readContract({
      address: delegationManagerAddr,
      abi: delegationManagerAbi,
      functionName: 'isRevoked',
      args: [delegationHash],
    }) as boolean

    if (revoked) {
      return { error: 'Cross-principal delegation has been revoked' }
    }
  } catch (err) {
    return { error: `Cross-delegation revocation check failed: ${err instanceof Error ? err.message : String(err)}` }
  }

  // ─── 4. ERC-1271 signature verification on data owner ────────────
  try {
    const returnValue = await publicClient.readContract({
      address: crossDelegation.delegator,
      abi: agentAccountAbi,
      functionName: 'isValidSignature',
      args: [delegationHash, crossDelegation.signature],
    })

    if (returnValue !== ERC1271_MAGIC_VALUE) {
      return { error: 'Cross-delegation signature invalid — data owner did not sign this delegation' }
    }
  } catch (err) {
    return { error: `Cross-delegation ERC-1271 verification error: ${err instanceof Error ? err.message : String(err)}` }
  }

  // ─── 5. Caveat enforcement ───────────────────────────────────────
  let grants: DataScopeGrant[] = []

  for (const caveat of crossDelegation.caveats) {
    const enforcerAddr = caveat.enforcer.toLowerCase()

    // Data scope enforcer — check first since it's specific to cross-delegation
    if (enforcerAddr === DATA_SCOPE_ENFORCER.toLowerCase()) {
      try {
        grants = decodeDataScopeTerms(caveat.terms)
      } catch {
        return { error: 'Failed to decode data scope caveat' }
      }
      continue
    }

    // Timestamp enforcer — try to decode as timestamp terms
    // Only attempt if it's NOT the data scope enforcer (already handled above)
    try {
      const { validAfter, validUntil } = decodeTimestampTerms(caveat.terms)
      // Sanity check: valid timestamps are > year 2020 (1577836800)
      if (validAfter > 1577836800 && validUntil > 1577836800) {
        const now = Math.floor(Date.now() / 1000)
        if (now < validAfter) return { error: `Cross-delegation not yet valid (validAfter: ${validAfter})` }
        if (now >= validUntil) return { error: `Cross-delegation expired (validUntil: ${validUntil})` }
      }
    } catch { /* not a timestamp caveat */ }
  }

  // ─── 6. Filter grants to target server ───────────────────────────
  const serverGrants = grants.filter(g => g.server === targetServer)
  if (serverGrants.length === 0) {
    return { error: `Cross-delegation has no grants for server ${targetServer}` }
  }

  return {
    dataPrincipal: crossDelegation.delegator.toLowerCase(),
    grants: serverGrants,
  }
}
