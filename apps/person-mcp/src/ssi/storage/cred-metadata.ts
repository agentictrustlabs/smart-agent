import { randomUUID } from 'node:crypto'
import { db } from '../db/index.js'

export interface CredentialMetadataRow {
  id: string
  holderWalletId: string
  issuerId: string
  schemaId: string
  credDefId: string
  credentialType: string
  receivedAt: string
  status: 'active' | 'revoked' | 'expired'
  /** Link secret this credential was issued against. Allows RotateLinkSecret
   *  to mark old-secret credentials as stale/re-issue-required. */
  linkSecretId: string
}

export function insertCredentialMetadata(
  row: Omit<CredentialMetadataRow, 'id' | 'receivedAt' | 'status'> & {
    id?: string
    status?: CredentialMetadataRow['status']
  },
): CredentialMetadataRow {
  const id = row.id ?? `cred_${randomUUID()}`
  const receivedAt = new Date().toISOString()
  const status = row.status ?? 'active'
  db.prepare(
    `INSERT INTO credential_metadata
       (id, holder_wallet_id, issuer_id, schema_id, cred_def_id, credential_type, received_at, status, link_secret_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    row.holderWalletId,
    row.issuerId,
    row.schemaId,
    row.credDefId,
    row.credentialType,
    receivedAt,
    status,
    row.linkSecretId,
  )
  return { id, ...row, receivedAt, status }
}

export function listCredentialMetadata(holderWalletId: string): CredentialMetadataRow[] {
  return db.prepare(
    `SELECT id,
            holder_wallet_id as holderWalletId,
            issuer_id        as issuerId,
            schema_id        as schemaId,
            cred_def_id      as credDefId,
            credential_type  as credentialType,
            received_at      as receivedAt,
            status,
            link_secret_id   as linkSecretId
       FROM credential_metadata
      WHERE holder_wallet_id = ?
      ORDER BY received_at DESC`,
  ).all(holderWalletId) as CredentialMetadataRow[]
}

/** Mark every cred in this wallet bound to the old link secret as 'stale'. */
export function markCredentialsStaleForLinkSecret(holderWalletId: string, oldLinkSecretId: string): number {
  const result = db.prepare(
    `UPDATE credential_metadata SET status = 'stale'
      WHERE holder_wallet_id = ? AND link_secret_id = ? AND status = 'active'`,
  ).run(holderWalletId, oldLinkSecretId)
  return result.changes
}
