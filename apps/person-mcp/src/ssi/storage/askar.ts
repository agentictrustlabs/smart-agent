/**
 * Pure-JS encrypted vault backed by SQLite — drop-in for Askar.
 *
 * Why not @hyperledger/aries-askar-nodejs?
 *   The package transitively depends on @2060.io/ref-napi, which does not
 *   compile against Node 24's node-addon-api on WSL2 (symbol mismatches in
 *   TypedThreadSafeFunction). Rather than pin Node, we implement the same
 *   (category, name) -> value KV model with envelope-encrypted blobs. Same
 *   guarantees (encrypted at library layer, profile-isolated, in-process-
 *   only-has-plaintext), different implementation. Phase 1-appropriate.
 *
 * Model:
 *   vault_kv(profile, category, name) -> { iv, ciphertext, tag, aad, tags }
 *   Each profile has its own DEK; DEKs are envelope-encrypted by a KEK
 *   derived from SSI_ASKAR_KEY via scrypt. Swapping the key outside a
 *   migration rotates everyone out — production would use a real KMS.
 */

import Database from 'better-sqlite3'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { config } from '../config.js'

const KEK = scryptSync(config.askarKey, 'smart-agent-ssi-wallet-kek-v1', 32)

function encrypt(plain: Buffer, key: Buffer, aad: string): { iv: Buffer; ciphertext: Buffer; tag: Buffer } {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(aad, 'utf8'))
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()])
  return { iv, ciphertext, tag: cipher.getAuthTag() }
}

function decrypt(iv: Buffer, ciphertext: Buffer, tag: Buffer, key: Buffer, aad: string): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAAD(Buffer.from(aad, 'utf8'))
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

// ─── DB ──────────────────────────────────────────────────────────────────────

const vaultPath = `${config.askarStorePath}/vault.db`
mkdirSync(dirname(vaultPath), { recursive: true })
const vdb = new Database(vaultPath)
vdb.pragma('journal_mode = WAL')
vdb.exec(`
  CREATE TABLE IF NOT EXISTS profiles (
    name TEXT PRIMARY KEY,
    wrapped_dek BLOB NOT NULL,
    dek_iv BLOB NOT NULL,
    dek_tag BLOB NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS vault_kv (
    profile TEXT NOT NULL,
    category TEXT NOT NULL,
    name TEXT NOT NULL,
    iv BLOB NOT NULL,
    ciphertext BLOB NOT NULL,
    tag BLOB NOT NULL,
    aad TEXT NOT NULL,
    tags TEXT,                    -- JSON
    created_at TEXT NOT NULL,
    PRIMARY KEY (profile, category, name)
  );
`)

// ─── Profile DEK handling ───────────────────────────────────────────────────

function unwrapDek(profile: string): Buffer {
  const row = vdb.prepare(
    `SELECT wrapped_dek as w, dek_iv as iv, dek_tag as tag FROM profiles WHERE name = ?`,
  ).get(profile) as { w: Buffer; iv: Buffer; tag: Buffer } | undefined
  if (!row) throw new Error(`vault profile not found: ${profile}`)
  return decrypt(row.iv, row.w, row.tag, KEK, `profile:${profile}`)
}

export async function createProfile(profileName: string): Promise<void> {
  const existing = vdb.prepare(`SELECT name FROM profiles WHERE name = ?`).get(profileName)
  if (existing) return
  const dek = randomBytes(32)
  const { iv, ciphertext, tag } = encrypt(dek, KEK, `profile:${profileName}`)
  vdb.prepare(
    `INSERT INTO profiles (name, wrapped_dek, dek_iv, dek_tag, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(profileName, ciphertext, iv, tag, new Date().toISOString())
}

// ─── Public KV API — matches Askar shape ────────────────────────────────────

function put(profile: string, category: string, name: string, value: string, tags?: Record<string, string>): void {
  const dek = unwrapDek(profile)
  const aad = `${profile}|${category}|${name}`
  const { iv, ciphertext, tag } = encrypt(Buffer.from(value, 'utf8'), dek, aad)
  vdb.prepare(
    `INSERT OR REPLACE INTO vault_kv (profile, category, name, iv, ciphertext, tag, aad, tags, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(profile, category, name, iv, ciphertext, tag, aad, tags ? JSON.stringify(tags) : null, new Date().toISOString())
}

function get(profile: string, category: string, name: string): string {
  const dek = unwrapDek(profile)
  const row = vdb.prepare(
    `SELECT iv, ciphertext, tag, aad FROM vault_kv WHERE profile = ? AND category = ? AND name = ?`,
  ).get(profile, category, name) as { iv: Buffer; ciphertext: Buffer; tag: Buffer; aad: string } | undefined
  if (!row) throw new Error(`${category}/${name} not found in profile ${profile}`)
  return decrypt(row.iv, row.ciphertext, row.tag, dek, row.aad).toString('utf8')
}

function remove(profile: string, category: string, name: string): void {
  vdb.prepare(`DELETE FROM vault_kv WHERE profile = ? AND category = ? AND name = ?`).run(profile, category, name)
}

// ─── Domain-specific wrappers — same names the rest of the app imports. ─────

export async function putLinkSecret(profile: string, linkSecretId: string, value: string): Promise<void> {
  put(profile, 'link_secret', linkSecretId, value, { id: linkSecretId })
}

export async function getLinkSecret(profile: string, linkSecretId: string): Promise<string> {
  return get(profile, 'link_secret', linkSecretId)
}

export async function putCredential(
  profile: string,
  credId: string,
  credentialJson: string,
  tags: Record<string, string>,
): Promise<void> {
  put(profile, 'credential', credId, credentialJson, { id: credId, ...tags })
}

export async function getCredential(profile: string, credId: string): Promise<string> {
  return get(profile, 'credential', credId)
}

export async function putCredentialRequestMeta(profile: string, name: string, value: string): Promise<void> {
  put(profile, 'credential_request', name, value, { id: name })
}

export async function takeCredentialRequestMeta(profile: string, name: string): Promise<string> {
  const v = get(profile, 'credential_request', name)
  remove(profile, 'credential_request', name)
  return v
}
