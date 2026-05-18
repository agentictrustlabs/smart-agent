import { Hono } from 'hono'
import { db } from '../db/index.js'

export const auditRoutes = new Hono()

/**
 * GET /audit/:holderWalletId/credentials — read credential receipt log for
 * a holder wallet. Read-only audit surface; no PII fields are revealed
 * (only ids, issuer ids, credential types, timestamps, status).
 *
 * @sa-route public
 * @sa-auth none-system-scoped
 * @sa-rate-limit none
 * @sa-prod-gate always
 * @sa-validation none-path-params
 * @sa-risk-tier medium
 * @sa-owner security
 */
auditRoutes.get('/audit/:holderWalletId/credentials', (c) => {
  const rows = db.prepare(
    `SELECT id, issuer_id as issuerId, credential_type as credentialType, received_at as receivedAt, status
       FROM credential_metadata WHERE holder_wallet_id = ? ORDER BY received_at DESC`,
  ).all(c.req.param('holderWalletId'))
  return c.json({ credentials: rows })
})
