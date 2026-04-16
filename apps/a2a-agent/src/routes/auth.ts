import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { createPublicClient, http } from 'viem'
import { localhost } from 'viem/chains'
import {
  createChallenge,
  hashChallenge,
  agentAccountAbi,
} from '@smart-agent/sdk'
import { db } from '../db'
import { challenges, sessions } from '../db/schema'
import { config } from '../config'

const ERC1271_MAGIC_VALUE = '0x1626ba7e'

const auth = new Hono()

// ─── POST /auth/challenge ────────────────────────────────────────────

auth.post('/challenge', async (c) => {
  const body = await c.req.json<{ accountAddress: string }>()

  if (!body.accountAddress) {
    return c.json({ error: 'accountAddress is required' }, 400)
  }

  const accountAddress = body.accountAddress as `0x${string}`
  const origin = c.req.header('Origin') ?? 'unknown'

  const { challenge, typedData } = createChallenge(
    accountAddress,
    origin,
    config.CHAIN_ID,
  )

  // Store in DB
  await db.insert(challenges).values({
    id: challenge.id,
    accountAddress: challenge.accountAddress,
    nonce: challenge.nonce,
    typedDataJson: JSON.stringify(typedData),
    status: 'pending',
    expiresAt: challenge.expiresAt,
    createdAt: challenge.issuedAt,
  })

  return c.json({
    challengeId: challenge.id,
    typedData,
  })
})

// ─── POST /auth/verify ──────────────────────────────────────────────

auth.post('/verify', async (c) => {
  const body = await c.req.json<{ challengeId: string; signature: string }>()

  if (!body.challengeId || !body.signature) {
    return c.json({ error: 'challengeId and signature are required' }, 400)
  }

  // Load challenge
  const [challenge] = await db
    .select()
    .from(challenges)
    .where(eq(challenges.id, body.challengeId))
    .limit(1)

  if (!challenge) {
    return c.json({ error: 'Challenge not found' }, 404)
  }

  if (challenge.status !== 'pending') {
    return c.json({ error: 'Challenge already used or expired' }, 400)
  }

  if (new Date(challenge.expiresAt) < new Date()) {
    await db
      .update(challenges)
      .set({ status: 'expired' })
      .where(eq(challenges.id, challenge.id))
    return c.json({ error: 'Challenge expired' }, 400)
  }

  // Verify signature via ERC-1271 on-chain
  const publicClient = createPublicClient({
    chain: { ...localhost, id: config.CHAIN_ID },
    transport: http(config.RPC_URL),
  })

  const typedData = JSON.parse(challenge.typedDataJson)
  const challengeData = {
    id: challenge.id,
    nonce: challenge.nonce as `0x${string}`,
    accountAddress: challenge.accountAddress as `0x${string}`,
    origin: typedData.message.origin,
    issuedAt: typedData.message.issuedAt,
    expiresAt: challenge.expiresAt,
  }

  const hash = hashChallenge(challengeData, config.CHAIN_ID)

  // Verify signature via ERC-1271 on the user's deployed AgentAccount.
  // No fallback — every user must have a real deployed smart account.
  try {
    const result = await publicClient.readContract({
      address: challenge.accountAddress as `0x${string}`,
      abi: agentAccountAbi,
      functionName: 'isValidSignature',
      args: [hash, body.signature as `0x${string}`],
    })

    if (result !== ERC1271_MAGIC_VALUE) {
      return c.json({ error: 'Invalid signature' }, 401)
    }
  } catch (err) {
    return c.json({ error: 'Signature verification failed — is the AgentAccount deployed?' }, 401)
  }

  // Mark challenge as verified
  await db
    .update(challenges)
    .set({ status: 'verified' })
    .where(eq(challenges.id, challenge.id))

  // Create session
  const sessionToken = `sa_${crypto.randomUUID().replace(/-/g, '')}`
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours

  await db.insert(sessions).values({
    id: sessionToken,
    accountAddress: challenge.accountAddress,
    status: 'active',
    expiresAt: expiresAt.toISOString(),
    createdAt: new Date().toISOString(),
  })

  return c.json({
    sessionToken,
    expiresAt: expiresAt.toISOString(),
  })
})

export { auth }
