'use server'

import { cookies } from 'next/headers'
import { requireSession } from '@/lib/auth/session'
import { TOOL_POLICIES, type ActionDescriptor } from '@smart-agent/sdk'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { A2A_SESSION_COOKIE_NAME } from './a2a-session-constants'
import {
  computeAllowedSelectors,
  computeAllowedTargetAddresses,
} from './a2a-session-caveats'
import {
  resolveA2AEndpointForAgent,
  A2AUrlResolverError,
} from '@/lib/clients/a2a-url-resolver'
import { a2aFetch } from '@/lib/clients/a2a-fetch'

const A2A_SESSION_COOKIE = A2A_SESSION_COOKIE_NAME

/**
 * Resolve the A2A endpoint for an agent address, with structured error
 * mapping into the existing `{ success: false, error }` shape used by the
 * bootstrap helpers.
 */
async function endpointFor(addr: string): Promise<
  | { ok: true; endpoint: string; hostHeader: string }
  | { ok: false; error: string }
> {
  try {
    const r = await resolveA2AEndpointForAgent(addr)
    return { ok: true, endpoint: r.endpoint, hostHeader: r.hostHeader }
  } catch (e) {
    if (e instanceof A2AUrlResolverError) {
      return { ok: false, error: `A2A endpoint unresolvable for ${addr}: ${e.message}` }
    }
    throw e
  }
}

/**
 * Build the declared scope handed to `/session/hybrid-init`.
 *
 * The scope serves two purposes inside the hybrid endpoint:
 *
 *   1. Risk-tier classification: the route runs `classifySessionRiskTier`
 *      across the scope and picks Variant A (low/medium) or Variant B
 *      (high/critical). For the demo bootstrap we MUST stay on Variant
 *      A — high-tier actions (pledge:honor, commitment:commit, etc.) are
 *      exercised separately and either get their own Variant B session
 *      or are gated by the on-chain caveat enforcer. The bootstrap
 *      session is the "common-case" handle.
 *
 *   2. Caveat assembly: `buildSessionCaveats` unions every `args.target`
 *      and every entry of `args.selectors` across the scope to produce
 *      the AllowedTargetsEnforcer + AllowedMethodsEnforcer terms. We
 *      pass the full union of on-chain targets/selectors derived from
 *      `TOOL_POLICIES` so the session's delegation is broad enough to
 *      cover every routine-tier mcpTool the demo user might invoke.
 *
 * One descriptor per target address. The descriptors share a low-tier
 * route name (`agent_resolver:read`) so the classifier picks
 * tier='low' → Variant A. Selectors are the full union.
 */
function buildDemoScope(): ActionDescriptor[] {
  const allowedTargets = computeAllowedTargetAddresses()
  const allowedSelectors = computeAllowedSelectors()
  if (allowedTargets.length === 0) {
    throw new Error('No allowed targets resolved from TOOL_POLICIES — env addresses missing')
  }
  if (allowedSelectors.length === 0) {
    throw new Error('No allowed selectors derived from TOOL_POLICIES — registry empty')
  }
  // Use a low-tier route key so the max tier across the scope is 'low'
  // → Variant A. The actual mcpTool used at redeem time is independent
  // of what's declared here (policy-gate classifies the inbound action
  // by its own route name, see apps/a2a-agent/src/lib/policy-gate.ts).
  void TOOL_POLICIES // ensure registry import isn't tree-shaken; keys are documentation
  return allowedTargets.map<ActionDescriptor>((target) => ({
    route: 'agent_resolver:read',
    args: { target, selectors: allowedSelectors },
  }))
}

/**
 * Bootstrap an A2A session for the given user.
 *
 * Spec 007 Phase B + Phase C K6 migration: this helper uses the hybrid
 * session-init flow (`/session/hybrid-init` → user signs EIP-712 →
 * `/session/hybrid-finalize`). The legacy `/session/init` +
 * `/session/package` flow is gone.
 *
 * Variant A is the default for demo users — the scope declared here is
 * low-tier so the classifier picks A. High-tier actions (money movement,
 * grant award finalization, etc.) bootstrap their own Variant B session
 * separately when the user signs at action time.
 *
 * No deployer-fallback: per Phase C K6 migration, demo users always
 * carry their own private key (web `users.privateKey`). Passkey / SIWE
 * users bootstrap client-side via the `useA2ASession` hook (they sign
 * the EIP-712 payload with their passkey or injected wallet).
 */
export async function bootstrapA2ASessionForUser(user: {
  smartAccountAddress?: string | null
  privateKey?: string | null
  /** Routes A2A traffic for this user. In the catalyst seed model the smart
   *  account (signs delegations via ERC-1271) and the person agent (registered
   *  on AgentAccountResolver with a primary name) are distinct addresses. We
   *  resolve the A2A host from the person agent and keep the session bound to
   *  the smart account. Falls back to the smart account if absent. */
  personAgentAddress?: string | null
}, options?: { durationSeconds?: number }): Promise<{ success: boolean; sessionId?: string; error?: string }> {
  const durationSeconds = options?.durationSeconds ?? 86400
  if (!user.smartAccountAddress) {
    return { success: false, error: 'No smart account deployed' }
  }
  if (!user.privateKey) {
    // No silent fallback (project_arch_hardening_007 + feedback_no_patches_dev_mode).
    // Demo users have `users.privateKey`; passkey/SIWE users must
    // bootstrap client-side via the hook (passkey prompt OR injected
    // wallet signs the EIP-712 typed-data payload returned by
    // `/session/hybrid-init`).
    return {
      success: false,
      error:
        'bootstrapA2ASessionForUser requires a private key — passkey/SIWE users ' +
        'must bootstrap client-side via the useA2ASession hook',
    }
  }

  const { privateKeyToAccount } = await import('viem/accounts')
  const signer = privateKeyToAccount(user.privateKey as `0x${string}`)

  const routingAddress = user.personAgentAddress ?? user.smartAccountAddress
  const ep = await endpointFor(routingAddress)
  if (!ep.ok) return { success: false, error: ep.error }

  // Build the declared scope. Failure here is loud (env addresses
  // missing / registry empty) — bootstrap can't proceed.
  let scope: ActionDescriptor[]
  try {
    scope = buildDemoScope()
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Scope assembly failed' }
  }

  const now = Math.floor(Date.now() / 1000)
  const validUntil = now + durationSeconds

  try {
    // ─── Step 1 — POST /session/hybrid-init ─────────────────────────
    const initRes = await a2aFetch(`${ep.endpoint}/session/hybrid-init`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Host': ep.hostHeader,
      },
      body: JSON.stringify({
        accountAddress: user.smartAccountAddress,
        scope,
        validUntil,
      }),
    })
    if (!initRes.ok) {
      const err = await initRes.json().catch(() => ({})) as { error?: string }
      return { success: false, error: `hybrid-init: ${err.error ?? initRes.statusText}` }
    }
    const initJson = await initRes.json() as {
      variant: 'A' | 'B'
      sessionId: string
      sessionKeyAddress: `0x${string}`
      delegationHash: `0x${string}`
      riskTier: 'low' | 'medium' | 'high' | 'critical'
      validUntil: number
      signingPayload?: {
        domain: {
          name: string
          version: string
          chainId: number
          verifyingContract: `0x${string}`
        }
        types: Record<string, ReadonlyArray<{ name: string; type: string }>>
        primaryType: 'Delegation'
        message: {
          delegator: `0x${string}`
          delegate: `0x${string}`
          authority: `0x${string}`
          caveatsHash: `0x${string}`
          salt: string
        }
      }
      userOpHash?: `0x${string}`
    }

    if (initJson.variant !== 'A') {
      // Demo bootstrap is intentionally low-tier — anything that lands
      // here as Variant B is a misconfiguration in `buildDemoScope`.
      // Fail loudly per the no-silent-fallback rule.
      return {
        success: false,
        error:
          `hybrid-init returned Variant ${initJson.variant} (tier=${initJson.riskTier}); ` +
          `bootstrap scope must be low/medium. Check buildDemoScope() in a2a-session.action.ts.`,
      }
    }
    if (!initJson.signingPayload) {
      return { success: false, error: 'hybrid-init Variant A response missing signingPayload' }
    }

    // ─── Step 2 — Sign the EIP-712 typed-data payload ───────────────
    //
    // The smart account's `isValidSignature(delegationHash, sig)` in
    // AgentAccount.sol tries raw-hash recovery first, then eth-signed
    // wrap. Signing the typed-data structure produces an ECDSA sig
    // over the EIP-712 hash (== `delegationHash`); recovery against
    // the owner set succeeds. (Cf. _verifyEcdsa in AgentAccount.sol.)
    const { domain, types, primaryType, message } = initJson.signingPayload
    // viem's signTypedData accepts the EIP712Domain entry but doesn't
    // require it — strip it to keep the structure minimal. The
    // server-side EIP-712 hash (= delegationHash) is derived from the
    // remaining type entries, which the smart account's ERC-1271
    // verifier reproduces via raw ECDSA recovery on `delegationHash`.
    const messageTypes: Record<string, ReadonlyArray<{ name: string; type: string }>> = {}
    for (const [k, v] of Object.entries(types)) {
      if (k !== 'EIP712Domain') messageTypes[k] = v
    }
    const signature = await signer.signTypedData({
      domain: {
        name: domain.name,
        version: domain.version,
        chainId: domain.chainId,
        verifyingContract: domain.verifyingContract,
      },
      types: messageTypes,
      primaryType,
      message: {
        delegator: message.delegator,
        delegate: message.delegate,
        authority: message.authority,
        caveatsHash: message.caveatsHash,
        salt: BigInt(message.salt),
      },
    })

    // ─── Step 3 — POST /session/hybrid-finalize ─────────────────────
    const finalizeRes = await a2aFetch(`${ep.endpoint}/session/hybrid-finalize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Host': ep.hostHeader,
      },
      body: JSON.stringify({
        sessionId: initJson.sessionId,
        signature,
      }),
    })
    if (!finalizeRes.ok) {
      const err = await finalizeRes.json().catch(() => ({})) as { error?: string }
      return { success: false, error: `hybrid-finalize: ${err.error ?? finalizeRes.statusText}` }
    }
    const finalJson = await finalizeRes.json() as { status?: string; sessionId?: string }
    if (finalJson.status !== 'active' || !finalJson.sessionId) {
      return {
        success: false,
        error: `hybrid-finalize returned unexpected response: ${JSON.stringify(finalJson)}`,
      }
    }

    return { success: true, sessionId: finalJson.sessionId }
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

  // Phase C K6 migration: passkey + SIWE users have no `users.privateKey`
  // and CANNOT bootstrap server-side — they must run the hybrid flow
  // client-side via the `useA2ASession` hook (passkey prompt or
  // injected wallet signs the EIP-712 payload). This server-action is
  // a no-op for them.
  const stateless = session.via === 'passkey' || session.via === 'siwe'
  if (stateless) {
    return {
      success: false,
      error:
        'Passkey/SIWE users must bootstrap via the client-side useA2ASession hook ' +
        '(no server-side private key available)',
    }
  }

  const user = await db.select().from(schema.localUserAccounts)
    .where(eq(schema.localUserAccounts.walletAddress, session.walletAddress))
    .limit(1)
    .then(r => r[0] ?? null)
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
