import {
  verifyDelegationToken,
  hashDelegation,
  decodeTimestampTerms,
  decodeDataScopeTerms,
  decodeDelegateBindingTerms,
  DATA_SCOPE_ENFORCER,
  DELEGATE_BINDING_ENFORCER,
  agentAccountAbi,
  delegationManagerAbi,
  evaluateCaveats,
} from '@smart-agent/sdk'
import type { DataScopeGrant, DelegateBindingTerms } from '@smart-agent/sdk'
import { recoverMessageAddress, createPublicClient, http } from 'viem'
import { localhost } from 'viem/chains'
import { config } from '../config.js'
import { db } from '../db/index.js'
import { sql } from 'drizzle-orm'
import { resolvePersonAgentForSmartAccount } from './resolve-person-agent.js'
import { appendAuditEntry } from '../session-store/index.js'
import { randomUUID } from 'node:crypto'

/**
 * Compatibility flag for legacy cross-delegations that were issued BEFORE
 * Sprint 2 S2.3 added the DelegateBinding caveat. In dev (default for
 * existing seeds + `.env` state), set `ACCEPT_LEGACY_CROSS_DELEGATIONS=true`
 * to skip the dual-address binding check when no DelegateBinding caveat
 * is present. After `fresh-start.sh` re-seeds, every cross-delegation has
 * the binding caveat and this flag can be removed.
 *
 * In production this flag is ignored (assumed `false`) — no production
 * users exist, no legacy state to support.
 */
function acceptLegacyCrossDelegations(): boolean {
  if (process.env.NODE_ENV === 'production') return false
  const raw = process.env.ACCEPT_LEGACY_CROSS_DELEGATIONS
  return raw === 'true' || raw === '1'
}

/** Emit an audit-deny row for cross-delegation rejection paths (Sprint 2 S2.3). */
function auditCrossDelegationDeny(args: {
  reason: string
  callerPrincipal?: string
  delegator?: string
  delegate?: string
}): void {
  try {
    appendAuditEntry({
      ts: new Date(),
      smartAccountAddress: (args.callerPrincipal ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
      sessionId: '',
      grantHash: '',
      actionId: `cross-delegation-deny-${randomUUID()}`,
      actionType: 'cross-delegation:verify',
      actionHash: '',
      decision: 'denied',
      reason: `[cross-delegation] ${args.reason}${args.delegator ? ` delegator=${args.delegator}` : ''}${args.delegate ? ` delegate=${args.delegate}` : ''}`.slice(0, 1000),
      audience: undefined,
      verifier: undefined,
    })
  } catch (err) {
    console.error('[verify-delegation] audit-deny write failed:', err)
  }
}

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

  // ─── Layer 3: delegate == smart account (Option A) ────────────
  // The on-chain leaf-delegate check inside DelegationManager requires
  // msg.sender == leaf.delegate; under Option A the userOp is submitted
  // by the user's smart account (= claims.sub), so the off-chain
  // delegation's `delegate` field must equal that smart account too.
  // The session signer's authorization comes from being a registered
  // owner of the smart account, not from being the delegate.
  if (claims.delegation.delegate.toLowerCase() !== claims.sub.toLowerCase()) {
    return { error: 'Delegation delegate does not match smart account (claims.sub)' }
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

  // ─── Layer 7: Caveat enforcement (fail-closed dispatcher) ─────
  // The off-chain twin of `packages/contracts/src/enforcers/`. Unknown
  // enforcers reject the request — previously they fell through
  // silently and `mcp-only` tools were effectively un-caveat-scoped.
  // See packages/sdk/src/policy/caveat-evaluator.ts.
  {
    const verdicts = evaluateCaveats(
      claims.delegation.caveats,
      {
        mcpTool: toolName ?? '',
        principal: claims.delegation.delegator,
        sessionId: claims.jti,
        timestamp: Math.floor(Date.now() / 1000),
      },
    )
    for (const v of verdicts) {
      if (!v.allowed) {
        return { error: `Caveat denied (enforcer ${v.enforcer}): ${v.reason ?? 'no reason'}` }
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
 * Verification (Sprint 2 S2.3 — cross-delegation binding proof):
 *   0. Dual-address binding (Option C, authoritative).
 *      The cross-delegation MUST include a DelegateBinding caveat that
 *      commits to BOTH `delegateSmartAccount` and `delegatePersonAgent`.
 *      We assert:
 *        - `delegateSmartAccount === callerPrincipal` (session smart-account)
 *        - `delegatePersonAgent === resolvePersonAgent(callerPrincipal)`
 *          (defense in depth — Option A — using AgentAccountResolver)
 *      Legacy delegations issued before Sprint 2 S2.3 have no DelegateBinding
 *      caveat; they are rejected in production and accepted (with a one-cycle
 *      compat warning) in dev when `ACCEPT_LEGACY_CROSS_DELEGATIONS=true`.
 *   1. EIP-712 delegation hash
 *   2. DelegationManager.isRevoked() — not revoked
 *   3. ERC-1271 on delegator's account — proves owner signed this delegation
 *   4. Caveat enforcement: TimestampEnforcer + DataScopeEnforcer +
 *      DelegateBindingEnforcer (the binding caveat is itself decoded above;
 *      we still walk all caveats here to enforce timestamp + extract grants).
 *   5. Extract data scope grants
 *
 * See `docs/architecture/01-web-a2a-mcp-flows.md` § Cross-delegation binding
 * (Sprint 2 S2.3) for the full architectural argument.
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
  callerPrincipal: string,
  targetServer: string,
): Promise<CrossDelegationResult | { error: string }> {

  // ─── 0. Dual-address binding (Sprint 2 S2.3) ─────────────────────
  const callerPrincipalLower = callerPrincipal.toLowerCase()

  // Locate the binding caveat (if any). Unknown caveats are fail-closed
  // at the standard verifier; here we explicitly require the binding
  // caveat to be present (post-migration) or accept legacy when the
  // env flag allows it.
  let binding: DelegateBindingTerms | null = null
  for (const caveat of crossDelegation.caveats) {
    if (caveat.enforcer.toLowerCase() === DELEGATE_BINDING_ENFORCER.toLowerCase()) {
      try {
        binding = decodeDelegateBindingTerms(caveat.terms)
      } catch {
        auditCrossDelegationDeny({
          reason: 'failed to decode DelegateBinding caveat terms',
          callerPrincipal: callerPrincipalLower,
          delegator: crossDelegation.delegator,
          delegate: crossDelegation.delegate,
        })
        return { error: 'Cross-delegation has a malformed DelegateBinding caveat' }
      }
      break
    }
  }

  if (binding) {
    // Option C — authoritative: the data owner's EIP-712 signature
    // committed to BOTH addresses. The verifier just checks equality.
    if (binding.delegateSmartAccount.toLowerCase() !== callerPrincipalLower) {
      auditCrossDelegationDeny({
        reason: `binding.delegateSmartAccount (${binding.delegateSmartAccount}) does not match callerPrincipal (${callerPrincipalLower})`,
        callerPrincipal: callerPrincipalLower,
        delegator: crossDelegation.delegator,
        delegate: crossDelegation.delegate,
      })
      return { error: 'Cross-delegation binding mismatch — caller smart-account is not the bound delegate' }
    }

    // Option A — defense in depth: chain-resolve the caller's
    // person-agent and assert it equals the binding's claim. A
    // mismatch means either the chain registry diverged from the
    // binding OR the binding was forged off the wrong person-agent;
    // either way we reject.
    //
    // Degraded mode: when the AgentAccountResolver is not configured
    // (`agentAccountResolverAddress` is undefined), resolution returns
    // null and we cannot enforce Option A. We log and fall through —
    // Option C (in-caveat binding) remains the authoritative gate.
    const resolvedPA = await resolvePersonAgentForSmartAccount(callerPrincipalLower as `0x${string}`)
    // Resolver-configured check must match the helper's runtime read —
    // see `resolve-person-agent.ts`. Treat unset or zero-address as
    // "no resolver" so dev environments without on-chain registry
    // configured fall through to Option C (in-caveat binding only).
    const resolverEnv = (process.env.AGENT_ACCOUNT_RESOLVER_ADDRESS as `0x${string}` | undefined) ?? config.agentAccountResolverAddress
    const resolverConfigured = resolverEnv
      && resolverEnv.toLowerCase() !== '0x0000000000000000000000000000000000000000'
    if (resolvedPA === null) {
      if (resolverConfigured) {
        // Resolver is configured but the caller's smart-account is not
        // registered as / linked to any person-agent. Treat as reject.
        auditCrossDelegationDeny({
          reason: 'no person-agent registered for callerPrincipal in AgentAccountResolver',
          callerPrincipal: callerPrincipalLower,
          delegator: crossDelegation.delegator,
          delegate: crossDelegation.delegate,
        })
        return { error: 'Cross-delegation rejected — no person-agent registered for caller' }
      }
      console.warn(
        '[verify-delegation] AGENT_ACCOUNT_RESOLVER_ADDRESS not configured — '
        + 'skipping Option A chain-side person-agent check (Option C in-caveat binding still enforced)',
      )
    } else if (resolvedPA.toLowerCase() !== binding.delegatePersonAgent.toLowerCase()) {
      auditCrossDelegationDeny({
        reason: `chain-resolved personAgent (${resolvedPA}) does not match binding.delegatePersonAgent (${binding.delegatePersonAgent})`,
        callerPrincipal: callerPrincipalLower,
        delegator: crossDelegation.delegator,
        delegate: crossDelegation.delegate,
      })
      return { error: 'Cross-delegation binding mismatch — chain-resolved person-agent disagrees with bound person-agent' }
    }
  } else {
    // No DelegateBinding caveat. Legacy path — accept only in dev when
    // the compat env flag is set, and only when the caller can still
    // be linked to the legacy `delegate` field via chain resolution.
    if (!acceptLegacyCrossDelegations()) {
      auditCrossDelegationDeny({
        reason: 'cross-delegation missing required DelegateBinding caveat (Sprint 2 S2.3)',
        callerPrincipal: callerPrincipalLower,
        delegator: crossDelegation.delegator,
        delegate: crossDelegation.delegate,
      })
      return { error: 'Cross-delegation rejected — missing DelegateBinding caveat (Sprint 2 S2.3)' }
    }

    // Dev/legacy path: at minimum, assert that the caller's session
    // smart-account resolves to a person-agent that equals OR is
    // controlled by the legacy `delegate` address. In the
    // single-account model `callerPrincipal == delegate`, which is
    // the strict check below; in the dual-account model we accept
    // when `resolvePersonAgent(callerPrincipal) == delegate`.
    const delegateLower = crossDelegation.delegate.toLowerCase()
    const isStrictMatch = callerPrincipalLower === delegateLower
    if (!isStrictMatch) {
      const resolvedPA = await resolvePersonAgentForSmartAccount(callerPrincipalLower as `0x${string}`)
      if (!resolvedPA || resolvedPA.toLowerCase() !== delegateLower) {
        auditCrossDelegationDeny({
          reason: `legacy delegate (${delegateLower}) does not match callerPrincipal (${callerPrincipalLower}) nor its resolved person-agent`,
          callerPrincipal: callerPrincipalLower,
          delegator: crossDelegation.delegator,
          delegate: crossDelegation.delegate,
        })
        return { error: 'Cross-delegation rejected — caller does not match legacy delegate (compat path)' }
      }
    }
    console.warn(
      '[verify-delegation] cross-delegation accepted via ACCEPT_LEGACY_CROSS_DELEGATIONS compat path '
      + '— re-issue with a DelegateBinding caveat (Sprint 2 S2.3)',
    )
  }

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

    // Delegate-binding enforcer — already enforced in step 0; just
    // acknowledge here so the timestamp fallback doesn't misinterpret
    // the (address, address) ABI payload as a timestamp.
    if (enforcerAddr === DELEGATE_BINDING_ENFORCER.toLowerCase()) {
      continue
    }

    // Timestamp enforcer — try to decode as timestamp terms
    // Only attempt if it's NOT a known specific-shape caveat (already handled above)
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
