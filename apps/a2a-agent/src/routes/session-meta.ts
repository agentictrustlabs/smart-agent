/**
 * Phase 4 — Session metadata endpoints for the permission UI.
 *
 * These endpoints back the /sessions/permissions page in the web app:
 *
 *   GET /session/:id/status   — current session status + scope projection
 *                               (NO auth — the page proxies through web's
 *                               server actions, which gate on the user's
 *                               next-session cookie before calling us)
 *   GET /session/:id/audit    — recent ExecutionReceipts for the session.
 *
 * Both endpoints are read-only and operate on the session bound to :id.
 * They live in their own file (not session.ts) so the Phase 4 surface is
 * clearly delineated from the auth/session-lifecycle endpoints.
 *
 * They are read-only and intentionally NOT behind requireInterServiceAuth
 * — the web app calls them with the user's session id directly (the id
 * is the secret, just like cookies). They cannot mutate state.
 */
import { Hono } from 'hono'
import { desc, eq } from 'drizzle-orm'
import {
  hashDelegation,
  type ExecutionReceiptSummary,
} from '@smart-agent/sdk'
import { db } from '../db'
import { sessions, executionAudit } from '../db/schema'
import { config } from '../config'
import { decryptSessionPackage } from '../auth/encryption'

interface StoredSessionPackage {
  sessionPrivateKey: `0x${string}`
  sessionKeyAddress: `0x${string}`
  delegation: {
    delegator: `0x${string}`
    delegate: `0x${string}`
    authority: `0x${string}`
    caveats: Array<{ enforcer: `0x${string}`; terms: `0x${string}`; args?: `0x${string}` }>
    salt: string
    signature: `0x${string}`
  }
  accountAddress: `0x${string}`
  expiresAt: string
}

const sessionMeta = new Hono()

// ─── GET /session/:id/status ─────────────────────────────────────────
sessionMeta.get('/:id/status', async (c) => {
  const id = c.req.param('id')
  const [row] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.id, id))
    .limit(1)

  if (!row) {
    return c.json({ active: false, reason: 'not-found' }, 404)
  }

  const expiresAt = new Date(row.expiresAt)
  const isExpired = expiresAt.getTime() <= Date.now()
  const active = row.status === 'active' && !isExpired

  if (!active) {
    return c.json({
      active: false,
      reason: isExpired ? 'expired' : row.status,
      expiresAtIso: row.expiresAt,
      sessionId: row.id,
    })
  }

  // Derive the rootGrantHash so the revoke endpoint can call
  // DelegationManager.revokeDelegation(rootGrantHash) without re-signing.
  // Two sources:
  //   1) Most recent ExecutionReceipt (cheaper; no decryption).
  //   2) Decrypt the stored package and re-hash (works even if the session
  //      has never produced an audit row yet).
  let rootGrantHash: `0x${string}` | null = null
  const [latest] = await db
    .select({ rootGrantHash: executionAudit.rootGrantHash })
    .from(executionAudit)
    .where(eq(executionAudit.sessionId, row.id))
    .orderBy(desc(executionAudit.receivedAt))
    .limit(1)
  if (latest?.rootGrantHash) {
    rootGrantHash = latest.rootGrantHash as `0x${string}`
  } else if (row.encryptedPackage && row.iv) {
    try {
      // KMS migration K0+K1 — routes through `decryptSessionPackage` which
      // binds AAD on both the KMS aadContext and the AES-GCM additionalData
      // (Hardening §1.5 #8 trip-wire preserved).
      const pkg = await decryptSessionPackage<StoredSessionPackage>(
        {
          encryptedPackage: row.encryptedPackage,
          iv: row.iv,
          encryptedDataKey: row.encryptedDataKey,
          keyVersion: row.keyVersion,
          kmsKeyId: row.kmsKeyId,
        },
        {
          sessionId: row.id,
          accountAddress: row.accountAddress,
          chainId: config.CHAIN_ID,
          expiresAt: row.expiresAt,
        },
      )
      if (pkg?.delegation) {
        rootGrantHash = hashDelegation(
          {
            delegator: pkg.delegation.delegator,
            delegate: pkg.delegation.delegate,
            authority: pkg.delegation.authority,
            caveats: pkg.delegation.caveats.map((c) => ({ enforcer: c.enforcer, terms: c.terms })),
            salt: pkg.delegation.salt,
          },
          config.CHAIN_ID,
          config.DELEGATION_MANAGER_ADDRESS,
        )
      }
    } catch {
      // decryption failure → hash stays null; revoke path will report
      // "no rootGrantHash available" cleanly.
    }
  }

  return c.json({
    active: true,
    sessionId: row.id,
    expiresAtIso: row.expiresAt,
    createdAtIso: row.createdAt,
    accountAddress: row.accountAddress,
    sessionKeyAddress: row.sessionKeyAddress,
    rootGrantHash,
  })
})

// ─── GET /session/:id/audit ──────────────────────────────────────────
sessionMeta.get('/:id/audit', async (c) => {
  const id = c.req.param('id')
  const limit = clamp(Number(c.req.query('limit') ?? '20'), 1, 100)

  const rows = await db
    .select({
      sessionId: executionAudit.sessionId,
      mcpServer: executionAudit.mcpServer,
      mcpTool: executionAudit.mcpTool,
      target: executionAudit.target,
      status: executionAudit.status,
      txHash: executionAudit.txHash,
      executionPath: executionAudit.executionPath,
      finalizedAt: executionAudit.finalizedAt,
      receivedAt: executionAudit.receivedAt,
      errorReason: executionAudit.errorReason,
    })
    .from(executionAudit)
    .where(eq(executionAudit.sessionId, id))
    .orderBy(desc(executionAudit.receivedAt))
    .limit(limit)

  const summaries: Array<ExecutionReceiptSummary & {
    target: string | null
    mcpServer: string
    executionPath: string
    errorReason: string
    receivedAt: string
  }> = rows.map((r) => ({
    sessionId: r.sessionId,
    mcpTool: r.mcpTool,
    status: r.status as ExecutionReceiptSummary['status'],
    txHash: r.txHash as `0x${string}` | null,
    finalizedAt: r.finalizedAt,
    target: r.target,
    mcpServer: r.mcpServer,
    executionPath: r.executionPath,
    errorReason: r.errorReason,
    receivedAt: r.receivedAt,
  }))

  return c.json({ receipts: summaries })
})

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min
  return Math.max(min, Math.min(max, Math.floor(n)))
}

export { sessionMeta }
