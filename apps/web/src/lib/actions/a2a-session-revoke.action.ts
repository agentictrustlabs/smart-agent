'use server'

/**
 * Phase 4 — Revoke the active A2A session.
 *
 * Flow (demo / privateKey users):
 *   1. Read the active session id from the A2A session cookie.
 *   2. GET /session/:id/status on a2a-agent → rootGrantHash.
 *   3. Send DelegationManager.revokeDelegation(rootGrantHash) signed by the
 *      user's stored EOA private key. (Production wallets — Privy/passkey —
 *      will be addressed in a follow-up; this path is the demo equivalent
 *      of the bootstrap flow that signs automatically.)
 *   4. DELETE /session/:id on a2a-agent (marks the session 'revoked').
 *   5. Clear the A2A session cookie.
 *
 * Returns a tagged result so the UI can render a precise error path.
 */

import { cookies } from 'next/headers'
import {
  createWalletClient,
  createPublicClient,
  http,
  type Address,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { localhost } from 'viem/chains'
import { delegationManagerAbi } from '@smart-agent/sdk'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import { requireSession } from '@/lib/auth/session'
import { A2A_SESSION_COOKIE_NAME } from './a2a-session-constants'
import { getA2ASessionToken } from './a2a-session.action'

const A2A_AGENT_URL = process.env.A2A_AGENT_URL ?? 'http://localhost:3100'

export interface RevokeResult {
  success: boolean
  txHash?: Hex
  rootGrantHash?: Hex
  /** Set when revocation succeeded server-side but on-chain tx failed/skipped. */
  partial?: boolean
  error?: string
}

export async function revokeA2ASessionForUser(): Promise<RevokeResult> {
  let userSession
  try {
    userSession = await requireSession()
  } catch {
    return { success: false, error: 'Not authenticated' }
  }
  if (!userSession.walletAddress) {
    return { success: false, error: 'No wallet on session' }
  }

  const sessionId = await getA2ASessionToken()
  if (!sessionId) {
    return { success: false, error: 'No active A2A session' }
  }

  // 1. Look up the user to access privateKey + smartAccountAddress.
  const users = await db
    .select()
    .from(schema.localUserAccounts)
    .where(eq(schema.localUserAccounts.walletAddress, userSession.walletAddress))
    .limit(1)
  const user = users[0]
  if (!user) return { success: false, error: 'User not found' }
  if (!user.privateKey) {
    // Passkey / Google / SIWE users — no server-side key. Phase 4 only
    // supports the demo / legacy path here; production wallet signing
    // will be wired into the wallet/passkey adapter later. We still
    // clear the cookie + delete the a2a session so the UI behaves sanely.
    await deleteA2aSession(sessionId)
    await clearCookie()
    return { success: true, partial: true, error: 'On-chain revoke skipped (no server-side signer)' }
  }

  // 2. Status lookup — must surface a rootGrantHash for the on-chain revoke.
  let rootGrantHash: Hex | null = null
  try {
    const statusRes = await fetch(`${A2A_AGENT_URL}/session/${sessionId}/status`)
    if (statusRes.ok) {
      const data = await statusRes.json()
      rootGrantHash = (data?.rootGrantHash as Hex | null) ?? null
    }
  } catch {
    // Best-effort; we fall through to cookie-only cleanup if needed.
  }

  // 3. On-chain revoke (if we have a hash).
  let txHash: Hex | undefined
  if (rootGrantHash) {
    const delegationManagerAddr = process.env.DELEGATION_MANAGER_ADDRESS as Address | undefined
    const rpcUrl = process.env.RPC_URL ?? 'http://127.0.0.1:8545'
    const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')
    if (!delegationManagerAddr) {
      return { success: false, error: 'DELEGATION_MANAGER_ADDRESS not set' }
    }

    try {
      const account = privateKeyToAccount(user.privateKey as `0x${string}`)
      const walletClient = createWalletClient({
        account,
        chain: { ...localhost, id: chainId },
        transport: http(rpcUrl),
      })
      const publicClient = createPublicClient({
        chain: { ...localhost, id: chainId },
        transport: http(rpcUrl),
      })

      txHash = await walletClient.writeContract({
        address: delegationManagerAddr,
        abi: delegationManagerAbi,
        functionName: 'revokeDelegation',
        args: [rootGrantHash],
      })
      // Wait briefly to confirm inclusion — keeps UX responsive but ensures
      // the session is truly dead before we clear the cookie.
      await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 10_000 })
    } catch (err) {
      // Don't block cleanup on on-chain failure; surface as partial.
      const msg = err instanceof Error ? err.message : 'Revoke tx failed'
      await deleteA2aSession(sessionId)
      await clearCookie()
      return { success: true, partial: true, rootGrantHash: rootGrantHash ?? undefined, error: msg }
    }
  }

  // 4. Delete the a2a-agent session (status='revoked').
  await deleteA2aSession(sessionId)

  // 5. Clear cookie.
  await clearCookie()

  return {
    success: true,
    txHash,
    rootGrantHash: rootGrantHash ?? undefined,
    partial: !rootGrantHash,
    error: rootGrantHash ? undefined : 'No rootGrantHash available — session marked revoked locally only',
  }
}

async function deleteA2aSession(sessionId: string): Promise<void> {
  try {
    await fetch(`${A2A_AGENT_URL}/api/a2a/session/${sessionId}`, { method: 'DELETE' }).catch(() => {})
    // Direct path on a2a-agent too — middleware DELETE requires Bearer.
    await fetch(`${A2A_AGENT_URL}/session/${sessionId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${sessionId}` },
    }).catch(() => {})
  } catch {
    // best-effort
  }
}

async function clearCookie(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set(A2A_SESSION_COOKIE_NAME, '', { path: '/', maxAge: 0 })
}
