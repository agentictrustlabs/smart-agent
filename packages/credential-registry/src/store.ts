import Database from 'better-sqlite3'
import type {
  SchemaRecord,
  CredentialDefinitionRecord,
  CredentialDefinitionPrivateRecord,
  IssuerRecord,
} from './types'

/**
 * File-backed SQLite credential registry.
 *
 * Phase 1: off-chain, single-file. Phase 6 will anchor hashes on-chain in a
 * new CredentialRegistry.sol. For now the registry is the source of truth for
 * both wallet and verifier; issuers are trusted by having their record here.
 */
export class CredentialRegistryStore {
  private readonly db: Database.Database

  constructor(path: string) {
    this.db = new Database(path)
    this.db.pragma('journal_mode = WAL')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schemas (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        attribute_names TEXT NOT NULL,   -- JSON string[]
        issuer_id TEXT NOT NULL,
        json TEXT NOT NULL,
        signature TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS credential_definitions (
        id TEXT PRIMARY KEY,
        schema_id TEXT NOT NULL,
        issuer_id TEXT NOT NULL,
        tag TEXT NOT NULL,
        json TEXT NOT NULL,
        key_correctness_proof TEXT NOT NULL,
        support_revocation INTEGER NOT NULL DEFAULT 0,
        signature TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS credential_definition_private (
        credential_definition_id TEXT PRIMARY KEY,
        private_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS issuers (
        id TEXT PRIMARY KEY,
        address TEXT NOT NULL,           -- EOA derived from did:ethr
        display_name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_creddef_schema ON credential_definitions(schema_id);
      CREATE INDEX IF NOT EXISTS idx_creddef_issuer ON credential_definitions(issuer_id);
    `)
  }

  upsertIssuer(r: IssuerRecord): void {
    this.db.prepare(`
      INSERT INTO issuers (id, address, display_name, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        address = excluded.address,
        display_name = excluded.display_name
    `).run(r.id, r.address.toLowerCase(), r.displayName, r.createdAt)
  }

  getIssuer(id: string): IssuerRecord | null {
    const row = this.db.prepare(`SELECT * FROM issuers WHERE id = ?`).get(id) as
      | { id: string; address: string; display_name: string; created_at: string }
      | undefined
    if (!row) return null
    return {
      id: row.id,
      address: row.address as `0x${string}`,
      displayName: row.display_name,
      createdAt: row.created_at,
    }
  }

  insertSchema(r: SchemaRecord): void {
    this.db.prepare(`
      INSERT INTO schemas (id, name, version, attribute_names, issuer_id, json, signature, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING
    `).run(r.id, r.name, r.version, JSON.stringify(r.attributeNames), r.issuerId, r.json, r.signature, r.createdAt)
  }

  getSchema(id: string): SchemaRecord | null {
    const row = this.db.prepare(`SELECT * FROM schemas WHERE id = ?`).get(id) as
      | { id: string; name: string; version: string; attribute_names: string; issuer_id: string; json: string; signature: string; created_at: string }
      | undefined
    if (!row) return null
    return {
      id: row.id,
      name: row.name,
      version: row.version,
      attributeNames: JSON.parse(row.attribute_names),
      issuerId: row.issuer_id,
      json: row.json,
      signature: row.signature as `0x${string}`,
      createdAt: row.created_at,
    }
  }

  insertCredDef(r: CredentialDefinitionRecord, priv?: CredentialDefinitionPrivateRecord): void {
    const tx = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO credential_definitions
          (id, schema_id, issuer_id, tag, json, key_correctness_proof, support_revocation, signature, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
      `).run(r.id, r.schemaId, r.issuerId, r.tag, r.json, r.keyCorrectnessProof, r.supportRevocation ? 1 : 0, r.signature, r.createdAt)
      if (priv) {
        this.db.prepare(`
          INSERT INTO credential_definition_private (credential_definition_id, private_json, created_at)
          VALUES (?, ?, ?)
          ON CONFLICT(credential_definition_id) DO NOTHING
        `).run(priv.credentialDefinitionId, priv.privateJson, priv.createdAt)
      }
    })
    tx()
  }

  getCredDef(id: string): CredentialDefinitionRecord | null {
    const row = this.db.prepare(`SELECT * FROM credential_definitions WHERE id = ?`).get(id) as
      | { id: string; schema_id: string; issuer_id: string; tag: string; json: string; key_correctness_proof: string; support_revocation: number; signature: string; created_at: string }
      | undefined
    if (!row) return null
    return {
      id: row.id,
      schemaId: row.schema_id,
      issuerId: row.issuer_id,
      tag: row.tag,
      json: row.json,
      keyCorrectnessProof: row.key_correctness_proof,
      supportRevocation: row.support_revocation === 1,
      signature: row.signature as `0x${string}`,
      createdAt: row.created_at,
    }
  }

  getCredDefPrivate(id: string): CredentialDefinitionPrivateRecord | null {
    const row = this.db.prepare(
      `SELECT credential_definition_id, private_json, created_at FROM credential_definition_private WHERE credential_definition_id = ?`,
    ).get(id) as { credential_definition_id: string; private_json: string; created_at: string } | undefined
    if (!row) return null
    return {
      credentialDefinitionId: row.credential_definition_id,
      privateJson: row.private_json,
      createdAt: row.created_at,
    }
  }

  close(): void {
    this.db.close()
  }
}
