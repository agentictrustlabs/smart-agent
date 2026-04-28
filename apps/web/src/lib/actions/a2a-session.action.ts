'use server'

import { cookies } from 'next/headers'
import { requireSession } from '@/lib/auth/session'
import { hashDelegation, encodeTimestampTerms, buildCaveat, ROOT_AUTHORITY } from '@smart-agent/sdk'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'

const A2A_AGENT_URL = process.env.A2A_AGENT_URL ?? 'http://localhost:3100'
const A2A_SESSION_COOKIE = 'a2a-session'

/**
 * Bootstrap an A2A session by signing a delegation on behalf of the user's
 * smart account using their own EOA private key.
 *
 *   1. Call A2A /session/init (unauthenticated) — gets sessionId + sessionKey
 *   2. Build delegation hash
 *   3. Sign delegation with the user's stored private key
 *   4. Submit to A2A /session/package (validated via ERC-1271 against the
 *      smart account's owner set)
 *   5. Store session ID in httpOnly cookie
 *
 * Only demo / legacy legacy users have `users.privateKey`. Google / Passkey /
 * SIWE users must use the client-side bootstrap (use-a2a-session hook):
 *   - Passkey: WebAuthn signs the delegation hash, packed with the 0x01
 *     type byte; AgentAccount's ERC-1271 path validates it against the
 *     smart account's registered passkeys.
 *   - SIWE / MetaMask: injected EIP-1193 signs the hash; ERC-1271 validates
 *     it against the smart account's owner set.
 *
 * We intentionally do NOT fall back to DEPLOYER_PRIVATE_KEY here. The
 * deployer is a co-owner only as a recovery / bootstrap relay; it must not
 * become a routine signer of user-scoped delegations.
 */
export async function bootstrapA2ASession(): Promise<{
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
  if (!user?.smartAccountAddress) {
    return { success: false, error: 'No smart account deployed' }
  }
  if (!user?.privateKey) {
    return { success: false, error: 'Client-side signing required (use passkey or wallet bootstrap)' }
  }

  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')
  const { privateKeyToAccount } = await import('viem/accounts')
  const userAccount = privateKeyToAccount(user.privateKey as `0x${string}`)

  try {
    // ─── Step 1: Session init (unauthenticated) ─────────────────
    const initRes = await fetch(`${A2A_AGENT_URL}/session/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountAddress: user.smartAccountAddress, durationSeconds: 86400 }),
    })
    if (!initRes.ok) {
      const err = await initRes.json().catch(() => ({}))
      return { success: false, error: `Init: ${err.error ?? initRes.statusText}` }
    }
    const { sessionId, sessionKeyAddress } = await initRes.json()

    // ─── Step 2: Build and sign delegation ───────────────────────
    const now = Math.floor(Date.now() / 1000)
    const expiresAt = now + 86400
    const timestampEnforcerAddr = process.env.TIMESTAMP_ENFORCER_ADDRESS as `0x${string}`
    const delegationManagerAddr = process.env.DELEGATION_MANAGER_ADDRESS as `0x${string}`
    const timeCaveat = buildCaveat(timestampEnforcerAddr, encodeTimestampTerms(now, expiresAt))
    const salt = BigInt(Date.now() + Math.floor(Math.random() * 100000))

    const delegationData = {
      delegator: user.smartAccountAddress as `0x${string}`,
      delegate: sessionKeyAddress as `0x${string}`,
      authority: ROOT_AUTHORITY as `0x${string}`,
      caveats: [{ enforcer: timeCaveat.enforcer as `0x${string}`, terms: timeCaveat.terms as `0x${string}` }],
      salt,
    }
    const delegationHash = hashDelegation(delegationData, chainId, delegationManagerAddr)
    const delegationSig = await userAccount.signMessage({ message: { raw: delegationHash } })

    // ─── Step 3: Submit to A2A (self-authenticating via ERC-1271) ─
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

    // ─── Step 4: Store session ID in httpOnly cookie ─────────────
    const cookieStore = await cookies()
    cookieStore.set(A2A_SESSION_COOKIE, sessionId, {
      path: '/',
      maxAge: 60 * 60 * 24,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
    })

    return { success: true, sessionToken: sessionId }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Bootstrap failed' }
  }
}

export async function getA2ASessionToken(): Promise<string | null> {
  const cookieStore = await cookies()
  // Prefer the unified session-grant cookie (M4); a2a-agent's middleware
  // accepts both grant and legacy session-table tokens via Bearer auth.
  const { grantCookieName } = await import('@/lib/auth/session-cookie')
  return cookieStore.get(grantCookieName())?.value
    ?? cookieStore.get(A2A_SESSION_COOKIE)?.value
    ?? null
}

export async function clearA2ASession(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set(A2A_SESSION_COOKIE, '', { path: '/', maxAge: 0 })
}
