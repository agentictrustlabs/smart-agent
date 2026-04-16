import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { privateKeyToAccount } from 'viem/accounts'
import {
  decryptPayload,
  mintDelegationToken,
} from '@smart-agent/sdk'
import type { DelegationTokenClaims } from '@smart-agent/sdk'
import { db } from '../db'
import { sessions } from '../db/schema'
import { config } from '../config'
import { requireSession } from '../middleware/require-session'

/** Shape of our encrypted session package (from /session/package) */
interface StoredSessionPackage {
  sessionPrivateKey: string
  sessionKeyAddress: string
  delegation: {
    delegator: string
    delegate: string
    authority: string
    caveats: Array<{ enforcer: string; terms: string }>
    salt: string
    signature: string
  }
  accountAddress: string
  expiresAt: string
}

const delegation = new Hono()

// ─── POST /delegation/mint ──────────────────────────────────────────

delegation.post('/mint', requireSession, async (c) => {
  const authSession = c.get('session')

  // Find the active session with encrypted package for this account
  const sessionRows = await db
    .select()
    .from(sessions)
    .where(eq(sessions.accountAddress, authSession.accountAddress))

  const activeSession = sessionRows.find(
    (row) => row.encryptedPackage && row.iv && row.hmacSecret && row.status === 'active',
  )

  if (!activeSession) {
    return c.json({ error: 'No active agent session found' }, 400)
  }

  if (new Date(activeSession.expiresAt) < new Date()) {
    return c.json({ error: 'Agent session expired' }, 400)
  }

  // Decrypt the session package
  const pkg = await decryptPayload<StoredSessionPackage>(
    { ciphertext: activeSession.encryptedPackage!, iv: activeSession.iv! },
    config.A2A_SESSION_SECRET,
  )

  // Build delegation token claims
  const now = new Date()
  const expiresAt = new Date(activeSession.expiresAt)

  const claims: DelegationTokenClaims = {
    v: 1,
    iss: 'smart-agent-a2a',
    aud: 'urn:mcp:server:person',
    sub: pkg.accountAddress as `0x${string}`,
    chainId: config.CHAIN_ID,
    delegation: {
      delegator: pkg.delegation.delegator as `0x${string}`,
      delegate: pkg.delegation.delegate as `0x${string}`,
      authority: pkg.delegation.authority as `0x${string}`,
      caveats: pkg.delegation.caveats.map((cav) => ({
        enforcer: cav.enforcer as `0x${string}`,
        terms: cav.terms as `0x${string}`,
      })),
      salt: pkg.delegation.salt,
      signature: pkg.delegation.signature as `0x${string}`,
    },
    sessionKeyAddress: pkg.sessionKeyAddress as `0x${string}`,
    issuedAtISO: now.toISOString(),
    expiresAtISO: expiresAt.toISOString(),
    jti: crypto.randomUUID(),
    usageLimit: 10,
  }

  // Sign with session private key (held by A2A agent, never the user's key)
  const sessionAccount = privateKeyToAccount(pkg.sessionPrivateKey as `0x${string}`)
  const signMessage = async (message: string): Promise<`0x${string}`> => {
    return sessionAccount.signMessage({ message })
  }

  const { token } = await mintDelegationToken(
    claims,
    signMessage,
    config.MCP_DELEGATION_SHARED_SECRET,
  )

  return c.json({
    token,
    expiresAtISO: expiresAt.toISOString(),
  })
})

export { delegation }
