import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { createPublicClient, http, hashMessage, toBytes, toHex, isHex } from 'viem'
import { localhost } from 'viem/chains'
import {
  createChallenge,
  hashChallenge,
  agentAccountAbi,
} from '@smart-agent/sdk'
import { db } from '../db'
import { challenges, sessions } from '../db/schema'
import { config } from '../config'
import { requireInterServiceAuth } from '../auth/inter-service'
import { getMasterSigner, getMasterSignerBackend } from '../auth/a2a-signer'
import { auditDeny } from '../lib/audit'

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

// ─── POST /auth/sign-checkpoint ─────────────────────────────────────
//
// Sprint 4 A.3 — person-mcp checkpoint signing service.
//
// Person-mcp's `lib/audit-checkpoint.ts` builds the same digest
// a2a-agent's own checkpoint exporter builds, then POSTs it here so the
// master signer (already held by a2a-agent's KMS plane) produces the
// signature without person-mcp ever holding a separate signing key.
// Restricting the inbound `x-a2a-service` header at the handler keeps
// this endpoint scoped to the one allowed caller — adding more services
// in the future requires an explicit allow-list entry below.
//
// Auth: `requireInterServiceAuth()` (same HMAC envelope every privileged
//   `/session/:id/*` endpoint uses). No `:id` path param here so the
//   canonical message's session-id slot is empty — wire-compatible with
//   the verifier (`buildCanonicalMessage` simply concatenates with `:`).
//
// Audit: every call would normally write one `kms-sign` row via the
//   standard `makeSignerAudit` hook in `a2a-signer.ts` — but this
//   signing path uses an `actionId` starting with `checkpoint:` which
//   the hook recognizes and skips (same posture as a2a-agent's own
//   checkpoint exporter). Skipping prevents a feedback loop where every
//   checkpoint sign would shift the chain head and force the next
//   checkpoint to attest a different head than the one we just signed.
//
// On failure (bad digest, signing error): write an `audit-deny` row and
// return 400/500. The denial-path audit is best-effort.
auth.post(
  '/sign-checkpoint',
  requireInterServiceAuth(),
  async (c) => {
    const route = '/auth/sign-checkpoint'
    // Defense-in-depth: requireInterServiceAuth accepts any enrolled
    // MCP. Restrict /auth/sign-checkpoint to the one allowed caller
    // (person-mcp) at the handler. Future MCPs that need checkpoint
    // signing add themselves explicitly here, NOT silently by being
    // enrolled in the broader MAC-key family.
    const ctx = c.get('interService' as never) as { service?: string } | undefined
    const callingService = ctx?.service ?? 'unknown'
    const ALLOWED: ReadonlySet<string> = new Set(['person-mcp'])
    if (!ALLOWED.has(callingService)) {
      await auditDeny(c, {
        route,
        reason: `sign-checkpoint: service ${callingService} not allowed`,
        mcpServer: callingService,
      })
      return c.json({ error: `service ${callingService} not allowed` }, 403)
    }

    let body: { digest?: string } = {}
    try {
      body = (await c.req.json<{ digest?: string }>()) ?? {}
    } catch {
      await auditDeny(c, {
        route,
        reason: 'sign-checkpoint: malformed JSON body',
        mcpServer: callingService,
      })
      return c.json({ error: 'malformed JSON body' }, 400)
    }
    const digest = body.digest
    if (!digest || !isHex(digest) || digest.length !== 2 + 64) {
      await auditDeny(c, {
        route,
        reason: 'sign-checkpoint: invalid digest (must be 0x + 32-byte hex)',
        mcpServer: callingService,
      })
      return c.json(
        { error: 'invalid digest — must be 0x-prefixed 32-byte hex' },
        400,
      )
    }

    try {
      // Resolve signer up front so the response's `signerAddress` matches
      // exactly what produced the signature.
      const signer = await getMasterSigner()
      const backend = getMasterSignerBackend()
      // Apply the EIP-191 prefix so the signature recovers via
      // `recoverMessageAddress({ message: { raw: digest } })` — same
      // posture as a2a-agent's own `exportCheckpoint`.
      const eip191Digest = hashMessage({ raw: toBytes(digest as `0x${string}`) })
      // The `checkpoint:` actionId prefix is recognized by
      // `a2a-signer.ts::makeSignerAudit` and skipped — without this every
      // call would write a `kms-sign` row that would shift the audit
      // chain head and force the NEXT checkpoint (a2a-agent OR person-
      // mcp) to attest a head different from the one we just signed.
      const timestamp = new Date().toISOString()
      const { signature: sigBytes } = await backend.signA2AAction({
        canonicalPayload: new Uint8Array(0),
        accountAddress: signer.address,
        chainId: String(config.CHAIN_ID),
        sessionId: 'audit-checkpoint:person-mcp',
        actionId: `checkpoint:person-mcp:${timestamp}`,
        digest: toBytes(eip191Digest),
      })
      const signature = toHex(sigBytes)
      return c.json({ signature, signerAddress: signer.address })
    } catch (err) {
      console.error('[sign-checkpoint] sign failed:', err)
      await auditDeny(c, {
        route,
        reason: `sign-checkpoint: master-signer threw: ${(err as Error).message ?? 'unknown'}`,
        mcpServer: callingService,
      })
      return c.json({ error: 'sign-checkpoint failed' }, 500)
    }
  },
)

export { auth }
