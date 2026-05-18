import { Hono } from 'hono'
import { db } from '../db/index.js'
import { requireInboundServiceAuth } from '../../auth/require-inbound-service-auth.js'

export const auditRoutes = new Hono()

// Sprint 5 W3 P1-2 — wire-auth gate for the SSI credential audit log.
// Even though no credential blob is returned, the receipt log (issuer,
// credential type, timestamp, status) is still PII keyed on a holder
// wallet. Every inbound request must now carry the `a2a-to-person`
// HMAC envelope.
const ssiInboundAuth = requireInboundServiceAuth()

/**
 * GET /audit/:holderWalletId/credentials — read credential receipt log for
 * a holder wallet. Read-only audit surface (issuer ids, credential types,
 * timestamps, status); credential blobs are NOT returned.
 *
 * Sprint 5 W3 P1-2: now requires the `a2a-to-person` HMAC envelope.
 * The receipt log is high-risk PII (issuer correlation across credential
 * types over time), so unauthenticated access is no longer permitted.
 *
 * @sa-route service-only
 * @sa-auth service-hmac
 * @sa-rate-limit none
 * @sa-prod-gate always
 * @sa-validation none-path-params
 * @sa-risk-tier high
 * @sa-owner security
 */
auditRoutes.get('/audit/:holderWalletId/credentials', ssiInboundAuth, (c) => {
  const rows = db.prepare(
    `SELECT id, issuer_id as issuerId, credential_type as credentialType, received_at as receivedAt, status
       FROM credential_metadata WHERE holder_wallet_id = ? ORDER BY received_at DESC`,
  ).all(c.req.param('holderWalletId'))
  return c.json({ credentials: rows })
})
