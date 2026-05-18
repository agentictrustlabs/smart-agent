/**
 * Unit tests for `apps/a2a-agent/src/auth/encryption.ts` (KMS migration
 * K0+K1 / §9.3 of plan).
 *
 * Covers:
 *   - Round-trip via local-aes provider returns the original payload.
 *   - keyVersion mismatch rejected by the provider (e.g. claiming a row
 *     was 'aws-kms' when it's actually 'local-v1').
 *   - Plaintext data key is zeroised after the helper returns.
 *
 * Run: `node --import tsx --test apps/a2a-agent/test/encryption.test.ts`
 *
 * NOTE: this test installs an env first, then imports the module so the
 * lazy provider singleton picks the right backend. The `__resetKeyProviderForTests`
 * hook lets later tests rebind.
 */
process.env.A2A_SESSION_SECRET = '0x' + 'b'.repeat(64)
process.env.A2A_KMS_BACKEND = 'local-aes'
delete process.env.NODE_ENV  // ensure not 'production'

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  encryptSessionPackage,
  decryptSessionPackage,
  __resetKeyProviderForTests,
  __setKeyProviderForTests,
} from '../src/auth/encryption'
import { createLocalAesProvider } from '@smart-agent/sdk/key-custody'
import type { A2AKeyProvider } from '@smart-agent/sdk/key-custody'

const META = {
  sessionId: 'sa_test_round_trip',
  accountAddress: '0xAbC0000000000000000000000000000000000001',
  chainId: 31337,
  expiresAt: '2026-05-18T00:00:00.000Z',
}

test('encryptSessionPackage / decryptSessionPackage — round-trip', async () => {
  __resetKeyProviderForTests()
  const payload = { sessionPrivateKey: '0xdeadbeef', note: 'hello' }
  const enc = await encryptSessionPackage(payload, META)
  assert.equal(enc.keyVersion, 'local-v1')
  assert.equal(enc.kmsKeyId, 'local')
  assert.ok(enc.encryptedDataKey.length > 0, 'wrapped data key persisted')

  const back = await decryptSessionPackage<typeof payload>(
    {
      encryptedPackage: enc.ciphertext,
      iv: enc.iv,
      encryptedDataKey: enc.encryptedDataKey,
      keyVersion: enc.keyVersion,
      kmsKeyId: enc.kmsKeyId,
    },
    META,
  )
  assert.deepEqual(back, payload)
})

test('decryptSessionPackage rejects keyVersion mismatch (local-aes refuses aws-kms tag)', async () => {
  __resetKeyProviderForTests()
  const enc = await encryptSessionPackage({ x: 1 }, META)
  await assert.rejects(
    () => decryptSessionPackage(
      {
        encryptedPackage: enc.ciphertext,
        iv: enc.iv,
        encryptedDataKey: enc.encryptedDataKey,
        keyVersion: 'aws-kms:bogus', // tampered
        kmsKeyId: enc.kmsKeyId,
      },
      META,
    ),
    /keyVersion mismatch/,
  )
})

test('decryptSessionPackage rejects missing encryptedDataKey on a non-legacy row', async () => {
  __resetKeyProviderForTests()
  const enc = await encryptSessionPackage({ x: 1 }, META)
  await assert.rejects(
    () => decryptSessionPackage(
      {
        encryptedPackage: enc.ciphertext,
        iv: enc.iv,
        encryptedDataKey: null,
        keyVersion: enc.keyVersion,
        kmsKeyId: enc.kmsKeyId,
      },
      META,
    ),
    /missing encryptedDataKey/,
  )
})

test('plaintext data key is zeroised by encryptSessionPackage in `finally`', async () => {
  // Inject a spy provider that captures the reference to the
  // `plaintextDataKey` it hands back. After `encryptSessionPackage`
  // returns, the bytes at that reference must be all zero — that proves
  // the helper's `finally { zeroise(...) }` block executed.
  __resetKeyProviderForTests()
  const inner = createLocalAesProvider({ A2A_SESSION_SECRET: process.env.A2A_SESSION_SECRET! })
  let capturedKey: Uint8Array | null = null
  const spy: A2AKeyProvider = {
    keyVersion: inner.keyVersion,
    async generateSessionDataKey(input) {
      const dk = await inner.generateSessionDataKey(input)
      capturedKey = dk.plaintextDataKey
      return dk
    },
    async decryptSessionDataKey(input) {
      return inner.decryptSessionDataKey(input)
    },
  }
  __setKeyProviderForTests(spy)

  await encryptSessionPackage({ secret: '0xfeedface' }, {
    sessionId: 'sa_zeroise_check',
    accountAddress: '0xabc0000000000000000000000000000000000001',
    chainId: 31337,
    expiresAt: '2026-05-19T00:00:00.000Z',
  })

  assert.ok(capturedKey, 'spy captured a plaintextDataKey reference')
  assert.equal(capturedKey!.length, 32, 'key is 32 bytes')
  assert.ok(
    capturedKey!.every((b) => b === 0),
    `plaintextDataKey should be zeroised after encryptSessionPackage returns; saw: ${Array.from(capturedKey!).slice(0, 8).join(',')}`,
  )

  __resetKeyProviderForTests()
})

test('P0-6: cross-version tamper — encrypt under local-v1, replace stored keyVersion with local-v2 → AES-GCM tag fails (AAD mismatch)', async () => {
  // The standard provider singleton (local-aes) refuses a keyVersion
  // mismatch outright — so we use a custom spy provider that ignores
  // the keyVersion field and ALWAYS returns the same plaintext data
  // key. This isolates the AES-GCM AAD trip-wire: even if a permissive
  // provider were used (or a future bug allowed cross-version key
  // recovery), the AES-GCM tag would still detect the mismatch because
  // keyVersion is bound into `buildSessionAAD`.
  __resetKeyProviderForTests()
  const innerV1 = createLocalAesProvider({ A2A_SESSION_SECRET: process.env.A2A_SESSION_SECRET! })
  const permissive: A2AKeyProvider = {
    keyVersion: innerV1.keyVersion,
    async generateSessionDataKey(input) {
      return innerV1.generateSessionDataKey(input)
    },
    async decryptSessionDataKey(input) {
      // Return the SAME plaintext data key regardless of keyVersion —
      // this is the worst-case where the KMS-layer trip-wire is
      // bypassed and only the AES-GCM AAD remains to catch tamper.
      return innerV1.decryptSessionDataKey({ ...input, keyVersion: innerV1.keyVersion })
    },
  }
  __setKeyProviderForTests(permissive)
  const enc = await encryptSessionPackage({ secret: 'rotated' }, META)
  assert.equal(enc.keyVersion, 'local-v1')

  // Tamper the stored keyVersion label to a future version. The
  // permissive provider hands back the same data key, but the
  // AES-GCM AAD now binds 'local-v2' — tag check must fail.
  await assert.rejects(
    () => decryptSessionPackage(
      {
        encryptedPackage: enc.ciphertext,
        iv: enc.iv,
        encryptedDataKey: enc.encryptedDataKey,
        keyVersion: 'local-v2', // tampered
        kmsKeyId: enc.kmsKeyId,
      },
      META,
    ),
  )
  __resetKeyProviderForTests()
})

test('P0-6: aadContext passed to provider uses snake_case keys with hashed sessionId', async () => {
  // Spy on `generateSessionDataKey` to capture the aadContext that
  // `encryptSessionPackage` builds. Assert the shape matches the new
  // canonical form (snake_case keys + sha256(sessionId)[:32]).
  __resetKeyProviderForTests()
  const inner = createLocalAesProvider({ A2A_SESSION_SECRET: process.env.A2A_SESSION_SECRET! })
  let capturedCtx: Record<string, string> | null = null
  const spy: A2AKeyProvider = {
    keyVersion: inner.keyVersion,
    async generateSessionDataKey(input) {
      capturedCtx = input.aadContext
      return inner.generateSessionDataKey(input)
    },
    async decryptSessionDataKey(input) {
      return inner.decryptSessionDataKey(input)
    },
  }
  __setKeyProviderForTests(spy)
  await encryptSessionPackage({ x: 1 }, META)

  assert.ok(capturedCtx, 'spy captured the aadContext')
  // Exactly the new canonical keys — no raw sessionId leak.
  assert.deepEqual(
    Object.keys(capturedCtx!).sort(),
    ['account_address', 'chain_id', 'expires_at', 'key_version', 'session_id_h'],
  )
  // `session_id_h` must be a 32-hex-char hash, NOT the raw sessionId.
  assert.match(capturedCtx!.session_id_h!, /^[0-9a-f]{32}$/)
  assert.notEqual(capturedCtx!.session_id_h, META.sessionId)
  // `key_version` is present and matches the provider's sync tag.
  assert.equal(capturedCtx!.key_version, 'local-v1')
  // `account_address` is lowercased.
  assert.equal(capturedCtx!.account_address, META.accountAddress.toLowerCase())
  __resetKeyProviderForTests()
})

test('P0-6: encrypt-time and decrypt-time aadContexts are byte-identical (no PII bleed difference)', async () => {
  __resetKeyProviderForTests()
  const inner = createLocalAesProvider({ A2A_SESSION_SECRET: process.env.A2A_SESSION_SECRET! })
  let encCtx: Record<string, string> | null = null
  let decCtx: Record<string, string> | null = null
  const spy: A2AKeyProvider = {
    keyVersion: inner.keyVersion,
    async generateSessionDataKey(input) {
      encCtx = { ...input.aadContext }
      return inner.generateSessionDataKey(input)
    },
    async decryptSessionDataKey(input) {
      decCtx = { ...input.aadContext }
      return inner.decryptSessionDataKey(input)
    },
  }
  __setKeyProviderForTests(spy)
  const enc = await encryptSessionPackage({ x: 1 }, META)
  await decryptSessionPackage(
    {
      encryptedPackage: enc.ciphertext,
      iv: enc.iv,
      encryptedDataKey: enc.encryptedDataKey,
      keyVersion: enc.keyVersion,
      kmsKeyId: enc.kmsKeyId,
    },
    META,
  )
  assert.deepEqual(encCtx, decCtx, 'encrypt/decrypt aadContexts must match byte-for-byte')
  __resetKeyProviderForTests()
})

test('plaintext data key is zeroised by decryptSessionPackage in `finally`', async () => {
  // Same spy approach but verify the decrypt-side `finally` zeroises.
  __resetKeyProviderForTests()
  const enc = await encryptSessionPackage({ x: 42 }, META)

  const inner = createLocalAesProvider({ A2A_SESSION_SECRET: process.env.A2A_SESSION_SECRET! })
  let capturedKey: Uint8Array | null = null
  const spy: A2AKeyProvider = {
    keyVersion: inner.keyVersion,
    async generateSessionDataKey(input) {
      return inner.generateSessionDataKey(input)
    },
    async decryptSessionDataKey(input) {
      const out = await inner.decryptSessionDataKey(input)
      capturedKey = out
      return out
    },
  }
  __setKeyProviderForTests(spy)

  await decryptSessionPackage<{ x: number }>(
    {
      encryptedPackage: enc.ciphertext,
      iv: enc.iv,
      encryptedDataKey: enc.encryptedDataKey,
      keyVersion: enc.keyVersion,
      kmsKeyId: enc.kmsKeyId,
    },
    META,
  )

  assert.ok(capturedKey, 'spy captured a plaintextDataKey reference')
  assert.ok(
    capturedKey!.every((b) => b === 0),
    'plaintextDataKey should be zeroised after decryptSessionPackage returns',
  )

  __resetKeyProviderForTests()
})
