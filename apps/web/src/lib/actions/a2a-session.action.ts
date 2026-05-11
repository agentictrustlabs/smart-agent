'use server'

import { cookies } from 'next/headers'
import { type Address } from 'viem'
import { requireSession } from '@/lib/auth/session'
import {
  hashDelegation,
  encodeTimestampTerms,
  encodeAllowedTargetsTerms,
  encodeAllowedMethodsTerms,
  encodeValueTerms,
  encodeMcpToolScopeTerms,
  buildCaveat,
  ROOT_AUTHORITY,
  MCP_TOOL_SCOPE_ENFORCER,
  TOOL_POLICIES,
} from '@smart-agent/sdk'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { A2A_SESSION_COOKIE_NAME } from './a2a-session-constants'
import {
  computeAllowedSelectors,
  computeAllowedTargetAddresses,
} from './a2a-session-caveats'

const A2A_AGENT_URL = process.env.A2A_AGENT_URL ?? 'http://localhost:3100'
const A2A_SESSION_COOKIE = A2A_SESSION_COOKIE_NAME

/**
 * Bootstrap an A2A session by signing a delegation on behalf of the user's
 * smart account using their own EOA private key.
 *
 * Phase 1 of the delegation refactor: the user signs ONE root delegation that
 * carries BOTH the MCP tool scope (verified off-chain by MCPs in
 * `verify-delegation.ts`) AND the on-chain authority for stateless redeems
 * (verified on-chain by DelegationManager + caveat enforcers).
 *
 * Caveats composed from `TOOL_POLICIES` (packages/sdk/src/policy/tool-policies.ts):
 *   • Timestamp:        validAfter=now, validUntil=now+86400
 *   • AllowedTargets:   union of every on-chain target across tool policies
 *   • AllowedMethods:   union of every 4-byte selector across tool policies
 *   • Value:            0 (no ETH transfer)
 *   • McpToolScope:     union of every tool name in TOOL_POLICIES (off-chain)
 *
 * The user signs once. The same delegation now gates BOTH MCP authentication
 * (via `verify-delegation.ts` in each MCP server) AND on-chain redemption
 * (via `DelegationManager.redeemDelegation` from the a2a-agent's session EOA).
 *
 * Only demo / legacy users have `users.privateKey`. Google / Passkey / SIWE
 * users must use the client-side bootstrap (use-a2a-session hook).
 */
export async function bootstrapA2ASessionForUser(user: {
  smartAccountAddress?: string | null
  privateKey?: string | null
}, options?: { durationSeconds?: number }): Promise<{ success: boolean; sessionId?: string; error?: string }> {
  const durationSeconds = options?.durationSeconds ?? 86400
  if (!user.smartAccountAddress) {
    return { success: false, error: 'No smart account deployed' }
  }
  // Passkey users have no private key — fall through to deployer-signed
  // delegations. The deployer is an initial owner of every freshly-
  // created AgentAccount (set at factory.createAccount time), so the
  // account's ERC-1271 isValidSignature accepts the deployer's ECDSA
  // signature on the delegation hash. The user retains their passkey
  // as the primary signer; the deployer-as-relayer signature is only
  // used to bootstrap the session — every actual on-chain redeem still
  // goes through DelegationManager's caveat enforcement.
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')
  const { privateKeyToAccount } = await import('viem/accounts')
  let signer: ReturnType<typeof privateKeyToAccount>
  if (user.privateKey) {
    signer = privateKeyToAccount(user.privateKey as `0x${string}`)
  } else {
    const deployerKey = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}` | undefined
    if (!deployerKey) {
      return { success: false, error: 'No user private key + no DEPLOYER_PRIVATE_KEY for deployer-signed fallback' }
    }
    signer = privateKeyToAccount(deployerKey)
  }
  const userAccount = signer

  try {
    const initRes = await fetch(`${A2A_AGENT_URL}/session/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountAddress: user.smartAccountAddress, durationSeconds }),
    })
    if (!initRes.ok) {
      const err = await initRes.json().catch(() => ({}))
      return { success: false, error: `Init: ${err.error ?? initRes.statusText}` }
    }
    const { sessionId, sessionKeyAddress } = await initRes.json()

    const now = Math.floor(Date.now() / 1000)
    const expiresAt = now + durationSeconds

    const timestampEnforcerAddr = process.env.TIMESTAMP_ENFORCER_ADDRESS as `0x${string}` | undefined
    const allowedTargetsEnforcerAddr = process.env.ALLOWED_TARGETS_ENFORCER_ADDRESS as `0x${string}` | undefined
    const allowedMethodsEnforcerAddr = process.env.ALLOWED_METHODS_ENFORCER_ADDRESS as `0x${string}` | undefined
    const valueEnforcerAddr = process.env.VALUE_ENFORCER_ADDRESS as `0x${string}` | undefined
    const delegationManagerAddr = process.env.DELEGATION_MANAGER_ADDRESS as `0x${string}` | undefined

    if (!timestampEnforcerAddr) return { success: false, error: 'TIMESTAMP_ENFORCER_ADDRESS not set' }
    if (!allowedTargetsEnforcerAddr) return { success: false, error: 'ALLOWED_TARGETS_ENFORCER_ADDRESS not set' }
    if (!allowedMethodsEnforcerAddr) return { success: false, error: 'ALLOWED_METHODS_ENFORCER_ADDRESS not set' }
    if (!valueEnforcerAddr) return { success: false, error: 'VALUE_ENFORCER_ADDRESS not set' }
    if (!delegationManagerAddr) return { success: false, error: 'DELEGATION_MANAGER_ADDRESS not set' }

    const allowedTargets = computeAllowedTargetAddresses()
    const allowedSelectors = computeAllowedSelectors()
    const allowedToolNames = Object.keys(TOOL_POLICIES)

    const caveats = [
      buildCaveat(timestampEnforcerAddr, encodeTimestampTerms(now, expiresAt)),
      buildCaveat(allowedTargetsEnforcerAddr, encodeAllowedTargetsTerms(allowedTargets)),
      buildCaveat(allowedMethodsEnforcerAddr, encodeAllowedMethodsTerms(allowedSelectors)),
      buildCaveat(valueEnforcerAddr, encodeValueTerms(0n)),
      // McpToolScope uses a sentinel enforcer address — verified off-chain by
      // each MCP server's `verify-delegation.ts`. Not enforced on-chain (the
      // on-chain caveat path stops at the AllowedMethods/AllowedTargets check).
      // Use the deployed McpToolScopeEnforcer (Phase 1 fix): the same
      // delegation is now ALSO redeemed on-chain, so DelegationManager
      // invokes every caveat's enforcer — calling the previous sentinel
      // (non-contract) address reverted. The deployed enforcer is a no-op;
      // the real tool-scope policy stays off-chain in the MCP verifier.
      buildCaveat(
        (process.env.MCP_TOOL_SCOPE_ENFORCER_ADDRESS ?? MCP_TOOL_SCOPE_ENFORCER) as `0x${string}`,
        encodeMcpToolScopeTerms(allowedToolNames),
      ),
      // NOTE: a per-session-key RateLimit caveat is deliberately deferred. The
      // RateLimitEnforcer in @smart-agent/sdk is keyed by (delegator,
      // delegationHash, scopeKey); wiring scopeKey choice + window/cap defaults
      // into the bootstrap is Phase 2 work alongside per-call sub-delegations.
    ]

    const caveatsForHash = caveats.map((c) => ({ enforcer: c.enforcer, terms: c.terms }))
    const salt = BigInt(Date.now() + Math.floor(Math.random() * 100000))

    const delegationData = {
      delegator: user.smartAccountAddress as `0x${string}`,
      delegate: sessionKeyAddress as `0x${string}`,
      authority: ROOT_AUTHORITY as `0x${string}`,
      caveats: caveatsForHash,
      salt,
    }
    const delegationHash = hashDelegation(delegationData, chainId, delegationManagerAddr)
    const delegationSig = await userAccount.signMessage({ message: { raw: delegationHash } })

    const pkgRes = await fetch(`${A2A_AGENT_URL}/session/package`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId,
        delegation: {
          ...delegationData,
          salt: salt.toString(),
          signature: delegationSig,
        },
      }),
    })
    if (!pkgRes.ok) {
      const err = await pkgRes.json().catch(() => ({}))
      return { success: false, error: `Package: ${err.error ?? pkgRes.statusText}` }
    }

    return { success: true, sessionId }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Bootstrap failed' }
  }
}


export async function bootstrapA2ASession(options?: { durationSeconds?: number }): Promise<{
  success: boolean
  sessionToken?: string
  error?: string
}> {
  const session = await requireSession()
  if (!session.walletAddress) {
    return { success: false, error: 'No wallet address' }
  }

  const users = await db.select().from(schema.users)
    .where(eq(schema.users.walletAddress, session.walletAddress))
    .limit(1)

  const user = users[0]
  if (!user) return { success: false, error: 'User not found' }

  const durationSeconds = options?.durationSeconds ?? 86400
  const r = await bootstrapA2ASessionForUser(user, { durationSeconds })
  if (!r.success || !r.sessionId) return { success: false, error: r.error }

  const cookieStore = await cookies()
  cookieStore.set(A2A_SESSION_COOKIE, r.sessionId, {
    path: '/',
    maxAge: durationSeconds,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
  })

  return { success: true, sessionToken: r.sessionId }
}


export async function getA2ASessionToken(): Promise<string | null> {
  const cookieStore = await cookies()
  // Prefer the legacy `a2a-session` (write-capable) cookie. The
  // SessionGrant.v1 grant cookie is scoped read-only (credential ops,
  // wallet provisioning, trust matching) — its session id won't resolve
  // in a2a-agent's `sessions` table, so the mcp-proxy's redeem path
  // returns "No active agent session" when the grant cookie is the
  // chosen bearer. Fall back to the grant cookie when no legacy session
  // exists (e.g. read-only / credential-only flows). The middleware
  // accepts either form, but only the legacy one carries the delegation
  // bytes needed to redeem on-chain via DelegationManager.
  const { grantCookieName } = await import('@/lib/auth/session-cookie')
  return cookieStore.get(A2A_SESSION_COOKIE)?.value
    ?? cookieStore.get(grantCookieName())?.value
    ?? null
}

export async function clearA2ASession(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set(A2A_SESSION_COOKIE, '', { path: '/', maxAge: 0 })
}
