import { Hono } from 'hono'
import { db } from '../db/index.js'

export const auditRoutes = new Hono()

auditRoutes.get('/audit/:holderWalletId/credentials', (c) => {
  const rows = db.prepare(
    `SELECT id, issuer_id as issuerId, credential_type as credentialType, received_at as receivedAt, status
       FROM credential_metadata WHERE holder_wallet_id = ? ORDER BY received_at DESC`,
  ).all(c.req.param('holderWalletId'))
  return c.json({ credentials: rows })
})
