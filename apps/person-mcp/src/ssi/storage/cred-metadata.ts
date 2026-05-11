import { randomUUID } from 'node:crypto'
import { db } from '../db/index.js'

// Backfill the target_org_address column for DBs created before this column
// existed. SQLite doesn't accept `ADD COLUMN IF NOT EXISTS`, so guard with
// a try/catch — it'll throw "duplicate column" on already-migrated DBs.
try {
  db.exec(`ALTER TABLE credential_metadata ADD COLUMN target_org_address TEXT`)
} catch { /* column already exists */ }

// Spec 004 (b2) — store the admin → holder on-chain delegation alongside
// each marketplace credential so the action layer can rebuild the redeem
// chain at proposal-submit / vote-cast time. JSON-encoded SignedDelegation;
// target_registry is the registry address the delegation gates.
try {
  db.exec(`ALTER TABLE credential_metadata ADD COLUMN admin_delegation_json TEXT`)
} catch { /* column already exists */ }
try {
  db.exec(`ALTER TABLE credential_metadata ADD COLUMN admin_delegation_target TEXT`)
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
  /** Spec 004 (b2) — JSON-encoded SignedDelegation `admin → holder`,
   *  signed at credential-issuance time by the round/pool admin and
   *  carried in the holder's wallet so the action layer can rebuild
   *  the redeem chain at action time. Null for non-marketplace creds. */
  adminDelegationJson: string | null
  /** Registry address (bytes20 hex) the `admin → holder` delegation
   *  is scoped to (matches AllowedTargets caveat). */
  adminDelegationTarget: string | null
}

export function insertCredentialMetadata(
  row: Omit<CredentialMetadataRow, 'id' | 'receivedAt' | 'status' | 'targetOrgAddress' | 'adminDelegationJson' | 'adminDelegationTarget'> & {
    id?: string
    status?: CredentialMetadataRow['status']
    targetOrgAddress?: string | null
    adminDelegationJson?: string | null
    adminDelegationTarget?: string | null
  },
): CredentialMetadataRow {
  const id = row.id ?? `cred_${randomUUID()}`
  const receivedAt = new Date().toISOString()
  const status = row.status ?? 'active'
  const targetOrgAddress = row.targetOrgAddress ?? null
  const adminDelegationJson = row.adminDelegationJson ?? null
  const adminDelegationTarget = row.adminDelegationTarget ?? null
  db.prepare(
    `INSERT INTO credential_metadata
       (id, holder_wallet_id, issuer_id, schema_id, cred_def_id, credential_type,
        received_at, status, link_secret_id, target_org_address,
        admin_delegation_json, admin_delegation_target)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    adminDelegationJson,
    adminDelegationTarget,
  )
  return { id, ...row, receivedAt, status, targetOrgAddress, adminDelegationJson, adminDelegationTarget }
}

export function listCredentialMetadata(holderWalletId: string): CredentialMetadataRow[] {
  return db.prepare(
    `SELECT id,
            holder_wallet_id        as holderWalletId,
            issuer_id               as issuerId,
            schema_id               as schemaId,
            cred_def_id             as credDefId,
            credential_type         as credentialType,
            received_at             as receivedAt,
            status,
            link_secret_id          as linkSecretId,
            target_org_address      as targetOrgAddress,
            admin_delegation_json   as adminDelegationJson,
            admin_delegation_target as adminDelegationTarget
       FROM credential_metadata
      WHERE holder_wallet_id = ?
      ORDER BY received_at DESC`,
  ).all(holderWalletId) as CredentialMetadataRow[]
}

/** Look up a single credential metadata row by id (no holder scoping). */
export function getCredentialMetadataById(credentialId: string): CredentialMetadataRow | null {
  const row = db.prepare(
    `SELECT id,
            holder_wallet_id        as holderWalletId,
            issuer_id               as issuerId,
            schema_id               as schemaId,
            cred_def_id             as credDefId,
            credential_type         as credentialType,
            received_at             as receivedAt,
            status,
            link_secret_id          as linkSecretId,
            target_org_address      as targetOrgAddress,
            admin_delegation_json   as adminDelegationJson,
            admin_delegation_target as adminDelegationTarget
       FROM credential_metadata
      WHERE id = ?`,
  ).get(credentialId) as CredentialMetadataRow | undefined
  return row ?? null
}

/** Find the (admin-delegated) marketplace credential row for a holder
 *  bound to a specific registry target. Returns the most-recent active
 *  row, or null. The caller checks status and parses
 *  `adminDelegationJson` into a SignedDelegation. */
export function findMarketplaceCredentialForRegistry(
  holderWalletId: string,
  targetRegistry: string,
  credentialType?: string,
): CredentialMetadataRow | null {
  const row = db.prepare(
    `SELECT id,
            holder_wallet_id        as holderWalletId,
            issuer_id               as issuerId,
            schema_id               as schemaId,
            cred_def_id             as credDefId,
            credential_type         as credentialType,
            received_at             as receivedAt,
            status,
            link_secret_id          as linkSecretId,
            target_org_address      as targetOrgAddress,
            admin_delegation_json   as adminDelegationJson,
            admin_delegation_target as adminDelegationTarget
       FROM credential_metadata
      WHERE holder_wallet_id = ?
        AND lower(admin_delegation_target) = lower(?)
        AND (? IS NULL OR credential_type = ?)
        AND status = 'active'
      ORDER BY received_at DESC
      LIMIT 1`,
  ).get(
    holderWalletId,
    targetRegistry,
    credentialType ?? null,
    credentialType ?? null,
  ) as CredentialMetadataRow | undefined
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
