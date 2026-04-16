import {
  verifyDelegationToken,
  hashDelegation,
  decodeTimestampTerms,
  decodeMcpToolScopeTerms,
  MCP_TOOL_SCOPE_ENFORCER,
  agentAccountAbi,
  delegationManagerAbi,
} from '@smart-agent/sdk'
import { recoverMessageAddress, createPublicClient, http } from 'viem'
import { localhost } from 'viem/chains'
import { config } from '../config.js'
import { db } from '../db/index.js'
import { tokenUsage } from '../db/schema.js'
import { eq } from 'drizzle-orm'

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

  // ─── Layer 1 (HMAC) + Layer 2 (ECDSA) + expiry ────────────────
  const result = await verifyDelegationToken(
    token,
    config.mcpDelegationSharedSecret,
    async (message: string, signature: `0x${string}`) => {
      return recoverMessageAddress({ message, signature })
    },
  )

  if (!result.valid || !result.claims) {
    return { error: `Delegation verification failed: ${result.error ?? 'unknown'}` }
  }

  const { claims } = result

  // ─── Layer 3: delegate == session key ──────────────────────────
  if (claims.delegation.delegate.toLowerCase() !== claims.sessionKeyAddress.toLowerCase()) {
    return { error: 'Delegation delegate does not match session key' }
  }

  // ─── Layer 4: Compute EIP-712 delegation hash ─────────────────
  const delegationManagerAddr = process.env.DELEGATION_MANAGER_ADDRESS as `0x${string}` | undefined

  if (delegationManagerAddr) {
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
      console.warn('[verify] Revocation check failed:', err instanceof Error ? err.message : err)
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

  // ─── Layer 8: JTI usage tracking ──────────────────────────────
  const jti = claims.jti
  if (jti) {
    try {
      const existing = db.select().from(tokenUsage).where(eq(tokenUsage.jti, jti)).all()

      if (existing.length > 0) {
        const usage = existing[0]
        if (usage.usageCount >= claims.usageLimit) {
          return { error: `Token usage limit exceeded (${usage.usageCount}/${claims.usageLimit})` }
        }
        // Increment
        db.update(tokenUsage)
          .set({ usageCount: usage.usageCount + 1, lastUsedAt: new Date().toISOString() })
          .where(eq(tokenUsage.jti, jti))
          .run()
      } else {
        // First use
        db.insert(tokenUsage).values({
          jti,
          principal: claims.delegation.delegator.toLowerCase(),
          usageCount: 1,
          usageLimit: claims.usageLimit,
          firstUsedAt: new Date().toISOString(),
          lastUsedAt: new Date().toISOString(),
        }).run()
      }
    } catch (err) {
      console.warn('[verify] JTI tracking failed:', err instanceof Error ? err.message : err)
    }
  }

  // ─── Layer 9: Extract principal ───────────────────────────────
  return { principal: claims.delegation.delegator.toLowerCase() }
}
