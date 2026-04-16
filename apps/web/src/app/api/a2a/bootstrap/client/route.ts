import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth/session'
import { db, schema } from '@/db'
import { eq } from 'drizzle-orm'
import {
  hashChallenge,
  hashDelegation,
  encodeTimestampTerms,
  buildCaveat,
  ROOT_AUTHORITY,
} from '@smart-agent/sdk'

const A2A_AGENT_URL = process.env.A2A_AGENT_URL ?? 'http://localhost:3100'

/**
 * POST /api/a2a/bootstrap/client
 *
 * Phase 1 of client-side A2A bootstrap:
 *   1. Request challenge from A2A agent
 *   2. Request session init from A2A agent (generates session keypair)
 *   3. Compute challenge hash and delegation hash
 *   4. Return both hashes for the client to sign with MetaMask
 *
 * The client signs both hashes and sends them to /api/a2a/bootstrap/complete.
 */
export async function POST(request: Request) {
  const session = await getSession()
  if (!session?.walletAddress) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const body = await request.json()
  const walletAddress = body.walletAddress ?? session.walletAddress

  // Look up user to get smart account address
  const users = await db.select().from(schema.users)
    .where(eq(schema.users.walletAddress, walletAddress))
    .limit(1)

  let user = users[0]

  // If Privy user has no smart account yet, deploy one
  if (user && !user.smartAccountAddress) {
    try {
      const { deploySmartAccount } = await import('@/lib/contracts')
      const salt = BigInt(Date.now() + Math.floor(Math.random() * 100000))
      const smartAcct = await deploySmartAccount(walletAddress as `0x${string}`, salt)
      await db.update(schema.users)
        .set({ smartAccountAddress: smartAcct })
        .where(eq(schema.users.id, user.id))
      user = { ...user, smartAccountAddress: smartAcct }
      console.log(`[bootstrap/client] Deployed AgentAccount for ${walletAddress}: ${smartAcct}`)
    } catch (err) {
      console.warn('[bootstrap/client] AgentAccount deployment failed:', err)
    }
  }

  const accountAddress = (user?.smartAccountAddress ?? walletAddress) as string

  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '31337')

  try {
    // ─── Step 1: Get challenge from A2A agent ─────────────────────
    const challengeRes = await fetch(`${A2A_AGENT_URL}/auth/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountAddress }),
    })
    if (!challengeRes.ok) {
      return NextResponse.json({ error: 'Challenge request failed' }, { status: 502 })
    }
    const { challengeId, typedData } = await challengeRes.json()

    // Compute challenge hash (what the user needs to sign)
    const challengeData = {
      id: typedData.message.challengeId as string,
      nonce: typedData.message.nonce as `0x${string}`,
      accountAddress: typedData.message.accountAddress as `0x${string}`,
      origin: typedData.message.origin as string,
      issuedAt: typedData.message.issuedAt as string,
      expiresAt: typedData.message.expiresAt as string,
    }
    const challengeHash = hashChallenge(challengeData, chainId)

    // ─── Step 2: Temporarily verify with a placeholder to get auth token
    // We need a session token to call /session/init. For client-side flow,
    // we'll return the challenge hash for the client to sign, then complete
    // everything in the /complete endpoint.

    // ─── Step 3: Compute delegation data ──────────────────────────
    // We need to know the session key address to build the delegation,
    // but that comes from /session/init which requires auth.
    // Solution: return the challenge hash now, do session init in /complete.

    // Build delegation params (for the hash computation)
    const now = Math.floor(Date.now() / 1000)
    const durationSeconds = 86400
    const expiresAt = now + durationSeconds
    const timestampEnforcerAddr = process.env.TIMESTAMP_ENFORCER_ADDRESS as `0x${string}`
    const delegationManagerAddr = process.env.DELEGATION_MANAGER_ADDRESS as `0x${string}`

    const timeCaveat = buildCaveat(
      timestampEnforcerAddr,
      encodeTimestampTerms(now, expiresAt),
    )
    const salt = BigInt(Date.now() + Math.floor(Math.random() * 100000))

    return NextResponse.json({
      challengeId,
      challengeHash,
      accountAddress,
      // Delegation params for the client to know what will be signed
      delegationParams: {
        delegator: accountAddress,
        authority: ROOT_AUTHORITY,
        caveats: [{ enforcer: timeCaveat.enforcer, terms: timeCaveat.terms }],
        salt: salt.toString(),
        timestampEnforcerAddr,
        delegationManagerAddr,
        chainId,
        durationSeconds,
        now,
        expiresAt,
      },
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Bootstrap client init failed' },
      { status: 500 },
    )
  }
}
