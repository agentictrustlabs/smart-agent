'use server'

import { cookies } from 'next/headers'
import { requireSession } from '@/lib/auth/session'
import { hashChallenge, encodeTimestampTerms, buildCaveat, ROOT_AUTHORITY, hashDelegation } from '@smart-agent/sdk'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'

const A2A_AGENT_URL = process.env.A2A_AGENT_URL ?? 'http://localhost:3100'
const A2A_SESSION_COOKIE = 'a2a-session'

/**
 * Bootstrap a full A2A session.
 *
 * Flow:
 *   1. Request challenge from A2A agent
 *   2. Sign challenge with user's own private key (from DB)
 *   3. Verify challenge → get auth token
 *   4. Request session init from A2A → A2A generates session keypair, returns public key
 *   5. Build delegation: delegator=user's SmartAccount, delegate=session public key
 *   6. Sign delegation with user's private key
 *   7. Send signed delegation back to A2A /session/package → session activated
 *
 * The A2A agent NEVER sees the user's private key.
 * It only holds the ephemeral session private key.
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

  // Load user's private key and smart account from DB
  const users = await db.select().from(schema.users)
    .where(eq(schema.users.walletAddress, session.walletAddress))
    .limit(1)

  const user = users[0]
  if (!user?.privateKey) {
    // Privy/MetaMask users don't have server-side keys.
    // Clear any stale demo session cookie.
    const cookieStore = await cookies()
    cookieStore.set(A2A_SESSION_COOKIE, '', { path: '/', maxAge: 0 })
    return { success: false, error: 'Client-side wallet signing required for Privy users. A2A session bootstrap only available for demo users.' }
  }
  if (!user?.smartAccountAddress) {
    return { success: false, error: 'No smart account deployed' }
  }

  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')
  const { privateKeyToAccount } = await import('viem/accounts')
  const userAccount = privateKeyToAccount(user.privateKey as `0x${string}`)

  try {
    // ─── Step 1: Request challenge ────────────────────────────────
    const challengeRes = await fetch(`${A2A_AGENT_URL}/auth/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountAddress: user.smartAccountAddress }),
    })
    if (!challengeRes.ok) return { success: false, error: `Challenge: ${challengeRes.statusText}` }
    const { challengeId, typedData } = await challengeRes.json()

    // ─── Step 2: Sign challenge with user's key ──────────────────
    const challengeData = {
      id: typedData.message.challengeId as string,
      nonce: typedData.message.nonce as `0x${string}`,
      accountAddress: typedData.message.accountAddress as `0x${string}`,
      origin: typedData.message.origin as string,
      issuedAt: typedData.message.issuedAt as string,
      expiresAt: typedData.message.expiresAt as string,
    }
    const challengeHash = hashChallenge(challengeData, chainId)
    const challengeSig = await userAccount.signMessage({ message: { raw: challengeHash } })

    // ─── Step 3: Verify → get auth token ─────────────────────────
    const verifyRes = await fetch(`${A2A_AGENT_URL}/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeId, signature: challengeSig }),
    })
    if (!verifyRes.ok) {
      const err = await verifyRes.json().catch(() => ({}))
      return { success: false, error: `Verify: ${err.error ?? verifyRes.statusText}` }
    }
    const { sessionToken } = await verifyRes.json()

    // ─── Step 4: Session init → A2A generates session keypair ────
    const initRes = await fetch(`${A2A_AGENT_URL}/session/init`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ durationSeconds: 86400 }),
    })
    if (!initRes.ok) {
      const err = await initRes.json().catch(() => ({}))
      return { success: false, error: `Init: ${err.error ?? initRes.statusText}` }
    }
    const { sessionId, sessionKeyAddress, durationSeconds } = await initRes.json()

    // ─── Step 5: Build delegation ────────────────────────────────
    const now = Math.floor(Date.now() / 1000)
    const expiresAt = now + (durationSeconds ?? 86400)

    const timestampEnforcerAddr = process.env.TIMESTAMP_ENFORCER_ADDRESS as `0x${string}`
    const timeCaveat = buildCaveat(
      timestampEnforcerAddr,
      encodeTimestampTerms(now, expiresAt),
    )

    const delegator = user.smartAccountAddress as `0x${string}`
    const delegate = sessionKeyAddress as `0x${string}`
    const salt = BigInt(Date.now() + Math.floor(Math.random() * 100000))
    const delegationManagerAddr = process.env.DELEGATION_MANAGER_ADDRESS as `0x${string}`

    // Compute EIP-712 delegation hash (matches DelegationManager contract exactly)
    const delegationData = {
      delegator,
      delegate,
      authority: ROOT_AUTHORITY as `0x${string}`,
      caveats: [{ enforcer: timeCaveat.enforcer as `0x${string}`, terms: timeCaveat.terms as `0x${string}` }],
      salt,
    }
    const delegationHash = hashDelegation(delegationData, chainId, delegationManagerAddr)

    // ─── Step 6: Sign delegation with user's key ─────────────────
    // DelegationManager._validateSignature converts to ethSignedMessageHash for EOAs
    const delegationSig = await userAccount.signMessage({ message: { raw: delegationHash } })

    const delegation = {
      delegator,
      delegate,
      authority: ROOT_AUTHORITY,
      caveats: [{ enforcer: timeCaveat.enforcer, terms: timeCaveat.terms }],
      salt: salt.toString(),
      signature: delegationSig,
    }

    // ─── Step 7: Send delegation to A2A → activates session ──────
    const pkgRes = await fetch(`${A2A_AGENT_URL}/session/package`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({ sessionId, delegation }),
    })
    if (!pkgRes.ok) {
      const err = await pkgRes.json().catch(() => ({}))
      return { success: false, error: `Package: ${err.error ?? pkgRes.statusText}` }
    }

    // ─── Step 8: Store auth token in cookie ──────────────────────
    const cookieStore = await cookies()
    cookieStore.set(A2A_SESSION_COOKIE, sessionToken, {
      path: '/',
      maxAge: 60 * 60 * 24,
      httpOnly: false,
    })

    return { success: true, sessionToken }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Bootstrap failed' }
  }
}

export async function getA2ASessionToken(): Promise<string | null> {
  const cookieStore = await cookies()
  return cookieStore.get(A2A_SESSION_COOKIE)?.value ?? null
}

export async function clearA2ASession(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set(A2A_SESSION_COOKIE, '', { path: '/', maxAge: 0 })
}
