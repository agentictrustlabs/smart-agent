/**
 * Unit tests for `apps/a2a-agent/src/auth/encryption.ts` (KMS migration
 * K0+K1 / §9.3 of plan).
 *
 * Covers:
 *   - Round-trip via local-aes provider returns the original payload.
 *   - Legacy decrypt path returns the original payload for a pre-K3 row.
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
  decryptLegacy,
  __resetKeyProviderForTests,
  __setKeyProviderForTests,
} from '../src/auth/encryption'
import { encryptPayload, buildSessionAAD } from '@smart-agent/sdk'
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

test('legacy decrypt path returns the original payload', async () => {
  // Write a row exactly the way the pre-K3 code path did: AES-GCM under
  // config.A2A_SESSION_SECRET with the same buildSessionAAD AAD.
  const secret = process.env.A2A_SESSION_SECRET!
  const aad = buildSessionAAD(META)
  const payload = { legacy: true, secret: '0xfeedface' }
  const enc = await encryptPayload(payload, secret, aad)

  // The decryptSessionPackage dispatcher routes by keyVersion === 'legacy'.
  const back = await decryptSessionPackage<typeof payload>(
    {
      encryptedPackage: enc.ciphertext,
      iv: enc.iv,
      encryptedDataKey: null,
      keyVersion: 'legacy',
      kmsKeyId: null,
    },
    META,
  )
  assert.deepEqual(back, payload)
})

test('decryptLegacy (direct) returns the original payload', async () => {
  const secret = process.env.A2A_SESSION_SECRET!
  const aad = buildSessionAAD(META)
  const payload = { legacy: 'direct' }
  const enc = await encryptPayload(payload, secret, aad)

  const back = await decryptLegacy<typeof payload>(
    { encryptedPackage: enc.ciphertext, iv: enc.iv },
    META,
  )
  assert.deepEqual(back, payload)
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

test('plaintext data key is zeroised by decryptSessionPackage in `finally`', async () => {
  // Same spy approach but verify the decrypt-side `finally` zeroises.
  __resetKeyProviderForTests()
  const enc = await encryptSessionPackage({ x: 42 }, META)

  const inner = createLocalAesProvider({ A2A_SESSION_SECRET: process.env.A2A_SESSION_SECRET! })
  let capturedKey: Uint8Array | null = null
  const spy: A2AKeyProvider = {
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
