import { randomUUID } from 'node:crypto'
import { db } from '../db/index.js'

// Backfill the target_org_address column for DBs created before this column
// existed. SQLite doesn't accept `ADD COLUMN IF NOT EXISTS`, so guard with
// a try/catch — it'll throw "duplicate column" on already-migrated DBs.
try {
  db.exec(`ALTER TABLE credential_metadata ADD COLUMN target_org_address TEXT`)
} catch { /* column already exists */ }

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
  /** Smart-account address of the org this credential references (e.g. the
   *  Red Feather Circle agent for an OrgMembership in that circle). The
   *  AnonCreds issuer DID's address is the org-mcp signing EOA, not the
   *  org agent itself — this column captures the *target* org so the held-
   *  credentials view can display the right name. May be null for
   *  credentials minted before this column existed. */
  targetOrgAddress: string | null
}

export function insertCredentialMetadata(
  row: Omit<CredentialMetadataRow, 'id' | 'receivedAt' | 'status' | 'targetOrgAddress'> & {
    id?: string
    status?: CredentialMetadataRow['status']
    targetOrgAddress?: string | null
  },
): CredentialMetadataRow {
  const id = row.id ?? `cred_${randomUUID()}`
  const receivedAt = new Date().toISOString()
  const status = row.status ?? 'active'
  const targetOrgAddress = row.targetOrgAddress ?? null
  db.prepare(
    `INSERT INTO credential_metadata
       (id, holder_wallet_id, issuer_id, schema_id, cred_def_id, credential_type,
        received_at, status, link_secret_id, target_org_address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    targetOrgAddress,
  )
  return { id, ...row, receivedAt, status, targetOrgAddress }
}

export function listCredentialMetadata(holderWalletId: string): CredentialMetadataRow[] {
  return db.prepare(
    `SELECT id,
            holder_wallet_id    as holderWalletId,
            issuer_id           as issuerId,
            schema_id           as schemaId,
            cred_def_id         as credDefId,
            credential_type     as credentialType,
            received_at         as receivedAt,
            status,
            link_secret_id      as linkSecretId,
            target_org_address  as targetOrgAddress
       FROM credential_metadata
      WHERE holder_wallet_id = ?
      ORDER BY received_at DESC`,
  ).all(holderWalletId) as CredentialMetadataRow[]
}

/** Look up a single credential metadata row by id (no holder scoping). */
export function getCredentialMetadataById(credentialId: string): CredentialMetadataRow | null {
  const row = db.prepare(
    `SELECT id,
            holder_wallet_id    as holderWalletId,
            issuer_id           as issuerId,
            schema_id           as schemaId,
            cred_def_id         as credDefId,
            credential_type     as credentialType,
            received_at         as receivedAt,
            status,
            link_secret_id      as linkSecretId,
            target_org_address  as targetOrgAddress
       FROM credential_metadata
      WHERE id = ?`,
  ).get(credentialId) as CredentialMetadataRow | undefined
  return row ?? null
}

/** Mark every cred in this wallet bound to the old link secret as 'stale'. */
export function markCredentialsStaleForLinkSecret(holderWalletId: string, oldLinkSecretId: string): number {
  const result = db.prepare(
    `UPDATE credential_metadata SET status = 'stale'
      WHERE holder_wallet_id = ? AND link_secret_id = ? AND status = 'active'`,
  ).run(holderWalletId, oldLinkSecretId)
  return result.changes
}
