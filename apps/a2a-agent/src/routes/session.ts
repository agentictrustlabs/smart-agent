import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createPublicClient, http } from 'viem'
import { localhost } from 'viem/chains'
import {
  hashDelegation,
  agentAccountAbi,
  clampSessionTtl,
  type SessionRiskTier,
} from '@smart-agent/sdk'
import { db } from '../db'
import { sessions } from '../db/schema'
import { config } from '../config'
import { requireSession } from '../middleware/require-session'
import { encryptSessionPackage, decryptSessionPackage } from '../auth/encryption'

const ERC1271_MAGIC_VALUE = '0x1626ba7e'

const session = new Hono()

// ─── POST /session/init ─────────────────────────────────────────────
// NO AUTH REQUIRED — just generates a keypair and stores it.
// The session stays 'pending' until /session/package is called
// with a valid delegation signature (which IS the authentication).
// Only returns the session ID and public key — no sensitive data.

session.post('/init', async (c) => {
  const body = await c.req.json<{
    accountAddress: string
    durationSeconds?: number
    /** Risk tier — caps `durationSeconds` per `MAX_SESSION_TTL_SEC`. Defaults
     *  to `medium` (7 days). High-value or admin flows should pass 'high'
     *  or 'sensitive'. */
    tier?: SessionRiskTier
  }>()

  if (!body.accountAddress) {
    return c.json({ error: 'accountAddress is required' }, 400)
  }

  // Clamp requested duration to the cap for the requested risk tier.
  // An attacker passing a 10-year `durationSeconds` is reduced to the
  // tier cap; the default tier ('medium') caps at 7 days.
  const durationSeconds = clampSessionTtl(body.durationSeconds ?? 86400, body.tier ?? 'medium')

  // Generate ephemeral session keypair
  const sessionPrivateKey = generatePrivateKey()
  const sessionAccount = privateKeyToAccount(sessionPrivateKey)

  const sessionId = `sa_${crypto.randomUUID().replace(/-/g, '')}`
  const expiresAt = new Date(Date.now() + durationSeconds * 1000)
  const expiresAtISO = expiresAt.toISOString()

  // Envelope-encrypt the session private key under a fresh per-row data key
  // (KMS migration K0+K1). `encryptSessionPackage` binds the AES-GCM tag to
  // the (sessionId, accountAddress, chainId, expiresAt) tuple via AAD AND
  // returns the wrapped data key + provider tag for persistence. See
  // KMS-IMPLEMENTATION-PLAN.md §5.
  const encrypted = await encryptSessionPackage(
    { sessionPrivateKey },
    {
      sessionId,
      accountAddress: body.accountAddress,
      chainId: config.CHAIN_ID,
      expiresAt: expiresAtISO,
    },
  )

  await db.insert(sessions).values({
    id: sessionId,
    accountAddress: body.accountAddress,
    sessionKeyAddress: sessionAccount.address,
    encryptedPackage: encrypted.ciphertext,
    iv: encrypted.iv,
    encryptedDataKey: encrypted.encryptedDataKey,
    keyVersion: encrypted.keyVersion,
    kmsKeyId: encrypted.kmsKeyId,
    status: 'pending',
    expiresAt: expiresAtISO,
    createdAt: new Date().toISOString(),
  })

  return c.json({
    sessionId,
    sessionKeyAddress: sessionAccount.address,
    durationSeconds,
    expiresAt: expiresAtISO,
  })
})

// ─── POST /session/package ──────────────────────────────────────────
// SELF-AUTHENTICATING — the delegation signature proves the caller
// controls the delegator's smart account (verified via ERC-1271).
// No bearer token required. The signature IS the authentication.

session.post('/package', async (c) => {
  const body = await c.req.json<{
    sessionId: string
    delegation: {
      delegator: string
      delegate: string
      authority: string
      caveats: Array<{ enforcer: string; terms: string }>
      salt: string
      signature: string
    }
  }>()

  if (!body.sessionId || !body.delegation?.signature) {
    return c.json({ error: 'sessionId and signed delegation required' }, 400)
  }

  // Find the pending session
  const [pendingSession] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, body.sessionId))
    .limit(1)

  if (!pendingSession) {
    return c.json({ error: 'Session not found' }, 404)
  }

  if (pendingSession.status !== 'pending') {
    return c.json({ error: 'Session already activated or revoked' }, 400)
  }

  // Verify delegation.delegate matches the session key we generated
  if (!pendingSession.sessionKeyAddress ||
      body.delegation.delegate.toLowerCase() !== pendingSession.sessionKeyAddress.toLowerCase()) {
    return c.json({ error: 'Delegation delegate does not match session key' }, 400)
  }

  // Verify delegation.delegator matches the account address on the session
  if (body.delegation.delegator.toLowerCase() !== pendingSession.accountAddress.toLowerCase()) {
    return c.json({ error: 'Delegation delegator does not match session account' }, 400)
  }

  // ─── ERC-1271: Verify the delegation signature on-chain ─────────
  // This is the authentication — proves the caller controls the delegator's smart account.
  const publicClient = createPublicClient({
    chain: { ...localhost, id: config.CHAIN_ID },
    transport: http(config.RPC_URL),
  })

  const delegationHash = hashDelegation(
    {
      delegator: body.delegation.delegator as `0x${string}`,
      delegate: body.delegation.delegate as `0x${string}`,
      authority: body.delegation.authority as `0x${string}`,
      caveats: body.delegation.caveats.map(c => ({
        enforcer: c.enforcer as `0x${string}`,
        terms: c.terms as `0x${string}`,
      })),
      salt: body.delegation.salt,
    },
    config.CHAIN_ID,
    config.DELEGATION_MANAGER_ADDRESS,
  )

  try {
    const result = await publicClient.readContract({
      address: body.delegation.delegator as `0x${string}`,
      abi: agentAccountAbi,
      functionName: 'isValidSignature',
      args: [delegationHash, body.delegation.signature as `0x${string}`],
    })

    if (result !== ERC1271_MAGIC_VALUE) {
      // Detailed diagnostics so we can see WHY a passkey signature is
      // rejected. Helpful when the OS picker offered a credential whose
      // digest isn't in the account's _passkeys mapping, or when the
      // clientDataJSON challenge doesn't decode to the delegation hash.
      const sig = body.delegation.signature as `0x${string}`
      const sigPrefix = sig.slice(0, 4) // '0x01' for WebAuthn, plain for ECDSA
      let diag = ''
      if (sigPrefix === '0x01') {
        try {
          // Decode the WebAuthn assertion struct to see which digest the
          // client submitted vs what's actually registered on the account.
          const { decodeAbiParameters } = await import('viem')
          const [a] = decodeAbiParameters(
            [{ type: 'tuple', components: [
              { name: 'authenticatorData',  type: 'bytes'   },
              { name: 'clientDataJSON',     type: 'string'  },
              { name: 'challengeIndex',     type: 'uint256' },
              { name: 'typeIndex',          type: 'uint256' },
              { name: 'r',                  type: 'uint256' },
              { name: 's',                  type: 'uint256' },
              { name: 'credentialIdDigest', type: 'bytes32' },
            ]}],
            ('0x' + sig.slice(4)) as `0x${string}`,
          ) as unknown as [{ credentialIdDigest: string; clientDataJSON: string }]
          const passkeyCount = await publicClient.readContract({
            address: body.delegation.delegator as `0x${string}`,
            abi: agentAccountAbi,
            functionName: 'passkeyCount',
          }) as bigint
          const stored = await publicClient.readContract({
            address: body.delegation.delegator as `0x${string}`,
            abi: agentAccountAbi,
            functionName: 'getPasskey',
            args: [a.credentialIdDigest as `0x${string}`],
          }) as readonly [bigint, bigint]
          diag = ` (sig path=passkey, account passkeyCount=${passkeyCount}, submitted digest=${a.credentialIdDigest}, getPasskey(digest)=(${stored[0]}, ${stored[1]}), clientDataJSON=${a.clientDataJSON.slice(0, 80)}…, hash=${delegationHash})`
        } catch (e) {
          diag = ` (assertion decode failed: ${(e as Error).message})`
        }
      } else {
        diag = ` (sig path=ECDSA, prefix=${sigPrefix})`
      }
      console.warn('[session/package] ERC-1271 rejected', diag)
      return c.json({ error: `Delegation signature invalid — ERC-1271 rejected${diag}` }, 401)
    }
  } catch (err) {
    return c.json({ error: `ERC-1271 verification failed: ${err instanceof Error ? err.message : 'unknown'}` }, 401)
  }

  // ─── Signature verified — activate the session ──────────────────

  if (!pendingSession.encryptedPackage || !pendingSession.iv) {
    return c.json({ error: 'Session missing encrypted data' }, 500)
  }

  // Decrypt the pending row (the trip-wire fires on tampered metadata).
  // KMS migration K0+K1 — routes through `decryptSessionPackage` which
  // binds aadContext on the KMS layer AND aesAad on the AES-GCM layer.
  const sessionMeta = {
    sessionId: pendingSession.id,
    accountAddress: pendingSession.accountAddress,
    chainId: config.CHAIN_ID,
    expiresAt: pendingSession.expiresAt,
  }
  const storedData = await decryptSessionPackage<{ sessionPrivateKey: string }>(
    {
      encryptedPackage: pendingSession.encryptedPackage,
      iv: pendingSession.iv,
      encryptedDataKey: pendingSession.encryptedDataKey,
      keyVersion: pendingSession.keyVersion,
      kmsKeyId: pendingSession.kmsKeyId,
    },
    sessionMeta,
  )

  // Build full session package and re-encrypt under a fresh data key.
  const fullPackage = {
    sessionPrivateKey: storedData.sessionPrivateKey,
    sessionKeyAddress: pendingSession.sessionKeyAddress,
    delegation: body.delegation,
    accountAddress: pendingSession.accountAddress,
    expiresAt: pendingSession.expiresAt,
  }

  const encrypted = await encryptSessionPackage(fullPackage, sessionMeta)

  // Activate
  await db
    .update(sessions)
    .set({
      encryptedPackage: encrypted.ciphertext,
      iv: encrypted.iv,
      encryptedDataKey: encrypted.encryptedDataKey,
      keyVersion: encrypted.keyVersion,
      kmsKeyId: encrypted.kmsKeyId,
      status: 'active',
    })
    .where(eq(sessions.id, body.sessionId))

  return c.json({ status: 'active', sessionId: body.sessionId })
})

// ─── GET /session/:id ───────────────────────────────────────────────

session.get('/:id', requireSession, async (c) => {
  const authSession = c.get('session')
  const id = c.req.param('id')

  const [row] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, id))
    .limit(1)

  if (!row) return c.json({ error: 'Session not found' }, 404)
  if (row.accountAddress !== authSession.accountAddress) return c.json({ error: 'Forbidden' }, 403)

  return c.json({
    id: row.id,
    accountAddress: row.accountAddress,
    sessionKeyAddress: row.sessionKeyAddress,
    status: row.status,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  })
})

// ─── DELETE /session/:id ────────────────────────────────────────────

session.delete('/:id', requireSession, async (c) => {
  const authSession = c.get('session')
  const id = c.req.param('id')

  const [row] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, id))
    .limit(1)

  if (!row) return c.json({ error: 'Session not found' }, 404)
  if (row.accountAddress !== authSession.accountAddress) return c.json({ error: 'Forbidden' }, 403)

  await db.update(sessions).set({ status: 'revoked' }).where(eq(sessions.id, id))
  return c.json({ status: 'revoked' })
})

export { session }
