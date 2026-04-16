import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import {
  encryptPayload,
  decryptPayload,
  randomHex,
} from '@smart-agent/sdk'
import { db } from '../db'
import { sessions } from '../db/schema'
import { config } from '../config'
import { requireSession } from '../middleware/require-session'

const session = new Hono()

// ─── POST /session/init ─────────────────────────────────────────────
// A2A agent generates ephemeral session keypair.
// Returns the public key so the web app can build + sign a delegation.
// The delegation comes back via POST /session/package.

session.post('/init', requireSession, async (c) => {
  const sessionRow = c.get('session')
  const body = await c.req.json<{ durationSeconds?: number }>()
  const durationSeconds = body.durationSeconds ?? 86400

  // Generate ephemeral session keypair (A2A agent holds the private key)
  const sessionPrivateKey = generatePrivateKey()
  const sessionAccount = privateKeyToAccount(sessionPrivateKey)

  const sessionId = `sa_${crypto.randomUUID().replace(/-/g, '')}`
  const expiresAt = new Date(Date.now() + durationSeconds * 1000)
  const hmacSecret = randomHex(32)

  // Store session private key encrypted. Status = 'pending' until
  // the web app sends back the signed delegation via /session/package.
  const encrypted = await encryptPayload(
    { sessionPrivateKey },
    config.A2A_SESSION_SECRET,
  )

  await db.insert(sessions).values({
    id: sessionId,
    accountAddress: sessionRow.accountAddress,
    sessionKeyAddress: sessionAccount.address,
    encryptedPackage: encrypted.ciphertext,
    iv: encrypted.iv,
    hmacSecret,
    status: 'pending',
    expiresAt: expiresAt.toISOString(),
    createdAt: new Date().toISOString(),
  })

  return c.json({
    sessionId,
    sessionKeyAddress: sessionAccount.address,
    durationSeconds,
    expiresAt: expiresAt.toISOString(),
  })
})

// ─── POST /session/package ──────────────────────────────────────────
// Receives the signed delegation from the web app.
// Combines it with the stored session private key into a full
// SessionPackage, re-encrypts, and marks the session active.

session.post('/package', requireSession, async (c) => {
  const sessionRow = c.get('session')
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

  // Find the pending session
  const [pendingSession] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, body.sessionId))
    .limit(1)

  if (!pendingSession) {
    return c.json({ error: 'Session not found' }, 404)
  }

  if (pendingSession.accountAddress !== sessionRow.accountAddress) {
    return c.json({ error: 'Session does not belong to this account' }, 403)
  }

  if (pendingSession.status !== 'pending') {
    return c.json({ error: 'Session already activated or revoked' }, 400)
  }

  // Verify delegation.delegate matches the session key we generated
  if (!pendingSession.sessionKeyAddress || body.delegation.delegate.toLowerCase() !== pendingSession.sessionKeyAddress.toLowerCase()) {
    return c.json({ error: 'Delegation delegate does not match session key' }, 400)
  }

  if (!pendingSession.encryptedPackage || !pendingSession.iv) {
    return c.json({ error: 'Session missing encrypted data' }, 500)
  }

  // Decrypt the stored session private key
  const storedData = await decryptPayload<{ sessionPrivateKey: string }>(
    { ciphertext: pendingSession.encryptedPackage, iv: pendingSession.iv },
    config.A2A_SESSION_SECRET,
  )

  // Build full session package and re-encrypt
  const fullPackage = {
    sessionPrivateKey: storedData.sessionPrivateKey,
    sessionKeyAddress: pendingSession.sessionKeyAddress,
    delegation: body.delegation,
    accountAddress: pendingSession.accountAddress,
    expiresAt: pendingSession.expiresAt,
  }

  const encrypted = await encryptPayload(fullPackage, config.A2A_SESSION_SECRET)

  // Activate the session
  await db
    .update(sessions)
    .set({
      encryptedPackage: encrypted.ciphertext,
      iv: encrypted.iv,
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

  if (!row) {
    return c.json({ error: 'Session not found' }, 404)
  }

  // Only allow reading your own sessions
  if (row.accountAddress !== authSession.accountAddress) {
    return c.json({ error: 'Forbidden' }, 403)
  }

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

  if (!row) {
    return c.json({ error: 'Session not found' }, 404)
  }

  // Only allow revoking your own sessions
  if (row.accountAddress !== authSession.accountAddress) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  await db
    .update(sessions)
    .set({ status: 'revoked' })
    .where(eq(sessions.id, id))

  return c.json({ status: 'revoked' })
})

export { session }
