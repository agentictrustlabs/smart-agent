import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import {
  hashDelegation,
  encodeTimestampTerms,
  buildCaveat,
  ROOT_AUTHORITY,
} from '@smart-agent/sdk'

const A2A_AGENT_URL = process.env.A2A_AGENT_URL ?? 'http://localhost:3100'

/**
 * POST /api/a2a/bootstrap/client
 *
 * Single-signature A2A bootstrap — no deployer key, no challenge.
 *
 *   1. Deploy smart account if needed
 *   2. Call A2A /session/init (unauthenticated — just generates keypair)
 *   3. Build delegation hash (delegator=user, delegate=session key)
 *   4. Return delegation hash for ONE MetaMask signature
 *
 * The delegation signature IS the authentication (verified via ERC-1271
 * in the A2A agent's /session/package endpoint).
 */
export async function POST() {
  const session = await getSession()
  if (!session?.walletAddress) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const walletAddress = session.walletAddress
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')

  // Look up user
  const users = await db.select().from(schema.users)
    .where(eq(schema.users.walletAddress, walletAddress))
    .limit(1)
  let user = users[0]

  // Deploy smart account if needed
  if (user && !user.smartAccountAddress) {
    try {
      const { deploySmartAccount } = await import('@/lib/contracts')
      const salt = BigInt(Date.now() + Math.floor(Math.random() * 100000))
      const smartAcct = await deploySmartAccount(walletAddress as `0x${string}`, salt)
      await db.update(schema.users)
        .set({ smartAccountAddress: smartAcct })
        .where(eq(schema.users.id, user.id))
      user = { ...user, smartAccountAddress: smartAcct }
    } catch (err) {
      return NextResponse.json({ error: `Smart account deployment failed: ${err instanceof Error ? err.message : 'unknown'}` }, { status: 500 })
    }
  }

  const accountAddress = (user?.smartAccountAddress ?? walletAddress) as `0x${string}`

  try {
    // ─── Step 1: Session init (unauthenticated — just generates keypair) ─
    const initRes = await fetch(`${A2A_AGENT_URL}/session/init`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountAddress, durationSeconds: 86400 }),
    })
    if (!initRes.ok) {
      const err = await initRes.json().catch(() => ({}))
      return NextResponse.json({ error: `Session init: ${err.error ?? initRes.statusText}` }, { status: 502 })
    }
    const { sessionId, sessionKeyAddress } = await initRes.json()

    // ─── Step 2: Build delegation hash ────────────────────────────
    const now = Math.floor(Date.now() / 1000)
    const expiresAt = now + 86400
    const timestampEnforcerAddr = process.env.TIMESTAMP_ENFORCER_ADDRESS as `0x${string}`
    const delegationManagerAddr = process.env.DELEGATION_MANAGER_ADDRESS as `0x${string}`
    const timeCaveat = buildCaveat(timestampEnforcerAddr, encodeTimestampTerms(now, expiresAt))
    const salt = BigInt(Date.now() + Math.floor(Math.random() * 100000))

    const delegation = {
      delegator: accountAddress,
      delegate: sessionKeyAddress as `0x${string}`,
      authority: ROOT_AUTHORITY as `0x${string}`,
      caveats: [{ enforcer: timeCaveat.enforcer as `0x${string}`, terms: timeCaveat.terms as `0x${string}` }],
      salt,
    }

    const delegationHash = hashDelegation(delegation, chainId, delegationManagerAddr)

    return NextResponse.json({
      delegationHash,
      sessionId,
      delegation: { ...delegation, salt: salt.toString() },
      accountAddress,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Bootstrap failed' },
      { status: 500 },
    )
  }
}
