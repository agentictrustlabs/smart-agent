/**
 * HTTP endpoints for the passkey-rooted delegated session signing system.
 *
 *   POST /wallet-action/verify  — verify a session-signer-signed WalletAction.v1.
 *                                 On success, the verifier itself burns the
 *                                 action nonce and appends an "allowed" audit
 *                                 entry. Callers downstream (web app, other
 *                                 services) get a deterministic yes/no.
 *
 *   POST /audit/append          — for action types the web app executes itself
 *                                 (e.g. presentation creation), it can push an
 *                                 audit entry directly. The verifier still
 *                                 owns the prevEntryHash chain.
 *
 *   GET  /audit/log/:account    — read back the audit chain for a given
 *                                 smart account.
 */

import { Hono } from 'hono'
import {
  verifyDelegatedWalletAction,
  DelegatedActionDenied,
} from './verify-delegated-action.js'
import {
  appendAuditEntry,
  listAuditLogForAccount,
  getRevocationEpoch,
  bumpRevocationEpoch,
  insertSession,
  getSessionByCookieValue,
  revokeSession,
  listActiveSessionsForAccount,
} from '../session-store/index.js'
import type { SessionRecord } from '@smart-agent/privacy-creds/session-grant'
import { verifyInsertPasskey, type InsertPasskeyAssertion } from './verify-insert-passkey.js'

export const walletActionRoutes = new Hono()

walletActionRoutes.post('/wallet-action/verify', async (c) => {
  const body = await c.req.json<{
    action: unknown
    actionSignature: `0x${string}`
    sessionId: string
    serviceName?: string
  }>()

  const serviceName = body.serviceName ?? process.env.PERSON_MCP_SERVICE_NAME ?? 'person-mcp'

  try {
    await verifyDelegatedWalletAction(
      {
        // Validated structurally inside the verifier; types are erased here.
        action: body.action as Parameters<typeof verifyDelegatedWalletAction>[0]['action'],
        actionSignature: body.actionSignature,
        sessionId: body.sessionId,
      },
      { serviceName },
    )
    return c.json({ ok: true })
  } catch (err) {
    if (err instanceof DelegatedActionDenied) {
      return c.json({ ok: false, code: err.code, detail: err.detail }, 403)
    }
    return c.json({ ok: false, code: 'verifier_error', detail: err instanceof Error ? err.message : String(err) }, 500)
  }
})

walletActionRoutes.post('/audit/append', async (c) => {
  const body = await c.req.json<{
    smartAccountAddress: `0x${string}`
    sessionId: string
    grantHash: string
    actionId: string
    actionType: string
    actionHash: string
    decision: 'allowed' | 'denied' | 'high-risk-passthrough' | 'session_revoked' | 'grant_minted'
    reason?: string
    audience?: string
    verifier?: string
  }>()

  const entry = appendAuditEntry({
    ts: new Date(),
    smartAccountAddress: body.smartAccountAddress,
    sessionId: body.sessionId,
    grantHash: body.grantHash,
    actionId: body.actionId,
    actionType: body.actionType,
    actionHash: body.actionHash,
    decision: body.decision,
    reason: body.reason,
    audience: body.audience,
    verifier: body.verifier,
  })

  return c.json({ entryHash: entry.entryHash, prevEntryHash: entry.prevEntryHash })
})

walletActionRoutes.get('/audit/log/:account', (c) => {
  const account = c.req.param('account') as `0x${string}`
  const limitParam = c.req.query('limit')
  const limit = limitParam ? Math.min(500, Math.max(1, parseInt(limitParam, 10))) : 100
  const entries = listAuditLogForAccount(account, limit)
  return c.json({ entries })
})

// ─── SessionRecord lifecycle (called by web app) ────────────────────

walletActionRoutes.get('/session-store/epoch/:account', (c) => {
  const account = c.req.param('account') as `0x${string}`
  const epoch = getRevocationEpoch(account)
  return c.json({ epoch })
})

walletActionRoutes.post('/session-store/insert', async (c) => {
  const body = await c.req.json<{
    record: Omit<SessionRecord, 'idleExpiresAt' | 'expiresAt' | 'createdAt' | 'revokedAt'> & {
      idleExpiresAtMs: number
      expiresAtMs: number
      createdAtMs: number
    }
    /**
     * Hardening §1.3 (Stream B Task B3) — the same passkey assertion
     * that the web's /session-grant/finalize already verified. Person-mcp
     * re-verifies it against the smart account via ERC-1271 BEFORE
     * writing the row. Without this bundle, the insert is rejected:
     * fail-closed defense against forged bootstrap calls.
     */
    passkeyAssertion?: InsertPasskeyAssertion
  }>()
  const r = body.record

  // ─── Hardening §1.3 (Task B3) — passkey re-verification ────────────
  if (!body.passkeyAssertion) {
    // Audit the denial so a probing attacker leaves a trail.
    try {
      appendAuditEntry({
        ts: new Date(),
        smartAccountAddress: r.smartAccountAddress,
        sessionId: r.sessionId,
        grantHash: r.grantHash,
        actionId: 'grant-insert-deny-' + r.sessionId,
        actionType: 'GrantMinted',
        actionHash: r.grantHash,
        decision: 'denied',
        reason: 'missing passkeyAssertion',
      })
    } catch { /* audit best-effort */ }
    return c.json({ ok: false, code: 'missing_passkey_assertion', detail: 'insert requires passkeyAssertion (Hardening §1.3)' }, 401)
  }

  const verify = await verifyInsertPasskey({
    smartAccountAddress: r.smartAccountAddress,
    grantHash: r.grantHash,
    assertion: body.passkeyAssertion,
  })
  if (!verify.ok) {
    try {
      appendAuditEntry({
        ts: new Date(),
        smartAccountAddress: r.smartAccountAddress,
        sessionId: r.sessionId,
        grantHash: r.grantHash,
        actionId: 'grant-insert-deny-' + r.sessionId,
        actionType: 'GrantMinted',
        actionHash: r.grantHash,
        decision: 'denied',
        reason: `passkey-reverify-failed: ${verify.reason}`,
      })
    } catch { /* audit best-effort */ }
    return c.json({ ok: false, code: 'passkey_reverify_failed', detail: verify.reason }, 401)
  }

  const fullRecord: SessionRecord = {
    sessionId: r.sessionId,
    sessionIdHash: r.sessionIdHash,
    smartAccountAddress: r.smartAccountAddress,
    sessionSignerAddress: r.sessionSignerAddress,
    verifiedPasskeyPubkey: r.verifiedPasskeyPubkey,
    grant: r.grant,
    grantHash: r.grantHash,
    idleExpiresAt: new Date(r.idleExpiresAtMs),
    expiresAt: new Date(r.expiresAtMs),
    createdAt: new Date(r.createdAtMs),
    revokedAt: null,
    revocationEpoch: r.revocationEpoch,
  }
  insertSession(fullRecord)

  // Audit: mint event.
  appendAuditEntry({
    ts: new Date(),
    smartAccountAddress: fullRecord.smartAccountAddress,
    sessionId: fullRecord.sessionId,
    grantHash: fullRecord.grantHash,
    actionId: 'grant-' + fullRecord.sessionId,
    actionType: 'GrantMinted',
    actionHash: fullRecord.grantHash,
    decision: 'grant_minted',
    audience: fullRecord.grant.audience.join(','),
  })

  return c.json({ ok: true })
})

walletActionRoutes.get('/session-store/by-cookie/:cookieValue', (c) => {
  const cookieValue = c.req.param('cookieValue')
  const record = getSessionByCookieValue(cookieValue)
  return c.json({ record })
})

walletActionRoutes.get('/session-store/active/:account', (c) => {
  const account = c.req.param('account') as `0x${string}`
  const records = listActiveSessionsForAccount(account)
  return c.json({ records })
})

walletActionRoutes.post('/session-store/revoke', async (c) => {
  const body = await c.req.json<{ sessionId: string }>()
  revokeSession(body.sessionId)
  return c.json({ ok: true })
})

walletActionRoutes.post('/session-store/bump-epoch', async (c) => {
  const body = await c.req.json<{ smartAccountAddress: `0x${string}` }>()
  const epoch = bumpRevocationEpoch(body.smartAccountAddress)
  return c.json({ epoch })
})
