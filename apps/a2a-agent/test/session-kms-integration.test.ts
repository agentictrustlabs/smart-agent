/**
 * Integration tests for KMS migration K0+K1 envelope encryption end-to-end
 * through the `sessions` table (§9.4 subset of plan).
 *
 * What's exercised:
 *   1. Full round trip: encrypt → INSERT → SELECT → decrypt. New rows have
 *      `key_version='local-v1'`.
 *   2. Tamper `key_version`            → decrypt rejects.
 *   3. Tamper `account_address`        → AAD trip-wire on AES-GCM tag (401).
 *   4. Tamper `expires_at`             → AAD trip-wire on AES-GCM tag (401).
 *   5. Tamper `encrypted_data_key`     → HKDF re-derives wrong key; AES-GCM tag fails.
 *
 * The /session/init → /session/package → MCP tool call HTTP flow itself is
 * exercised in `scripts/fresh-start.sh` (smoke test step at the end of the
 * PR's verification list); reproducing it here would require booting anvil
 * + person-mcp inside the test process, which is out of scope for unit/
 * integration tests in this PR. Instead, these tests run the same crypto
 * primitives against a fresh in-process SQLite row to give us deterministic
 * tamper-detection coverage.
 *
 * Run: `node --import tsx --test apps/a2a-agent/test/session-kms-integration.test.ts`
 */
process.env.A2A_SESSION_SECRET = '0x' + 'c'.repeat(64)
process.env.A2A_KMS_BACKEND = 'local-aes'
delete process.env.NODE_ENV

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '../src/db'
import { sessions } from '../src/db/schema'
import {
  encryptSessionPackage,
  decryptSessionPackage,
  __resetKeyProviderForTests,
} from '../src/auth/encryption'

function newSession(): { id: string; accountAddress: string; chainId: number; expiresAt: string } {
  return {
    id: `sa_${randomUUID().replace(/-/g, '')}`,
    accountAddress: '0xAbC0000000000000000000000000000000000001',
    chainId: 31337,
    expiresAt: new Date(Date.now() + 86400_000).toISOString(),
  }
}

async function insertEncrypted(meta: ReturnType<typeof newSession>, payload: unknown) {
  __resetKeyProviderForTests()
  const enc = await encryptSessionPackage(payload, {
    sessionId: meta.id,
    accountAddress: meta.accountAddress,
    chainId: meta.chainId,
    expiresAt: meta.expiresAt,
  })
  db.insert(sessions).values({
    id: meta.id,
    accountAddress: meta.accountAddress,
    encryptedPackage: enc.ciphertext,
    iv: enc.iv,
    encryptedDataKey: enc.encryptedDataKey,
    keyVersion: enc.keyVersion,
    kmsKeyId: enc.kmsKeyId,
    status: 'active',
    expiresAt: meta.expiresAt,
    createdAt: new Date().toISOString(),
  }).run()
  return enc
}

async function loadAndDecrypt(meta: ReturnType<typeof newSession>) {
  const [row] = await db.select().from(sessions).where(eq(sessions.id, meta.id)).limit(1)
  if (!row) throw new Error('row not found')
  return decryptSessionPackage<{ sessionPrivateKey: string }>(
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
      chainId: meta.chainId,
      expiresAt: row.expiresAt,
    },
  )
}

test('full local-aes round trip: encrypt → INSERT → SELECT → decrypt; key_version=local-v1', async () => {
  const meta = newSession()
  const payload = { sessionPrivateKey: '0xdeadbeef' }
  await insertEncrypted(meta, payload)
  const back = await loadAndDecrypt(meta)
  assert.deepEqual(back, payload)

  // Confirm key_version was persisted as 'local-v1'.
  const [row] = await db.select().from(sessions).where(eq(sessions.id, meta.id)).limit(1)
  assert.equal(row!.keyVersion, 'local-v1')
  assert.equal(row!.kmsKeyId, 'local')
  assert.ok(row!.encryptedDataKey, 'encrypted_data_key persisted')
})

test('tamper key_version → decrypt throws (provider rejects mismatch)', async () => {
  const meta = newSession()
  await insertEncrypted(meta, { sessionPrivateKey: '0x1' })
  // Tamper the persisted key_version.
  db.update(sessions).set({ keyVersion: 'aws-kms:tampered' }).where(eq(sessions.id, meta.id)).run()
  await assert.rejects(() => loadAndDecrypt(meta), /keyVersion mismatch/)
})

test('tamper account_address → AAD trip-wire (AES-GCM tag fails)', async () => {
  const meta = newSession()
  await insertEncrypted(meta, { sessionPrivateKey: '0x2' })
  const [row] = await db.select().from(sessions).where(eq(sessions.id, meta.id)).limit(1)
  await assert.rejects(
    () => decryptSessionPackage(
      {
        encryptedPackage: row!.encryptedPackage,
        iv: row!.iv,
        encryptedDataKey: row!.encryptedDataKey,
        keyVersion: row!.keyVersion,
        kmsKeyId: row!.kmsKeyId,
      },
      {
        sessionId: row!.id,
        accountAddress: '0xDeAdBeEf00000000000000000000000000000000', // tampered
        chainId: meta.chainId,
        expiresAt: row!.expiresAt,
      },
    ),
  )
})

test('tamper expires_at → AAD trip-wire (AES-GCM tag fails)', async () => {
  const meta = newSession()
  await insertEncrypted(meta, { sessionPrivateKey: '0x3' })
  const [row] = await db.select().from(sessions).where(eq(sessions.id, meta.id)).limit(1)
  await assert.rejects(
    () => decryptSessionPackage(
      {
        encryptedPackage: row!.encryptedPackage,
        iv: row!.iv,
        encryptedDataKey: row!.encryptedDataKey,
        keyVersion: row!.keyVersion,
        kmsKeyId: row!.kmsKeyId,
      },
      {
        sessionId: row!.id,
        accountAddress: row!.accountAddress,
        chainId: meta.chainId,
        expiresAt: '2099-12-31T23:59:59.000Z', // tampered
      },
    ),
  )
})

test('tamper sessionId → AAD trip-wire (AES-GCM tag fails)', async () => {
  const meta = newSession()
  await insertEncrypted(meta, { sessionPrivateKey: '0x3b' })
  const [row] = await db.select().from(sessions).where(eq(sessions.id, meta.id)).limit(1)
  await assert.rejects(
    () => decryptSessionPackage(
      {
        encryptedPackage: row!.encryptedPackage,
        iv: row!.iv,
        encryptedDataKey: row!.encryptedDataKey,
        keyVersion: row!.keyVersion,
        kmsKeyId: row!.kmsKeyId,
      },
      {
        sessionId: 'sa_someone_else',
        accountAddress: row!.accountAddress,
        chainId: meta.chainId,
        expiresAt: row!.expiresAt,
      },
    ),
  )
})

test('tamper encrypted_data_key → HKDF re-derives wrong key; downstream tag fails', async () => {
  const meta = newSession()
  await insertEncrypted(meta, { sessionPrivateKey: '0x4' })
  // Replace encrypted_data_key with a different valid base64 16-byte blob.
  const wrongSaltB64 = Buffer.from(new Uint8Array(16).fill(0xff)).toString('base64')
  db.update(sessions).set({ encryptedDataKey: wrongSaltB64 }).where(eq(sessions.id, meta.id)).run()
  await assert.rejects(() => loadAndDecrypt(meta))
})
