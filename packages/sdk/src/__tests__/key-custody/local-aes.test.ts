/**
 * Unit tests for `createLocalAesProvider` (KMS migration K1 / §9.1 of plan).
 *
 * Covers:
 *   - Round-trip: generate → decrypt with matching context returns same 32 bytes.
 *   - Context mismatch: recovered key bytes differ (downstream AES-GCM tag
 *     will fail; we assert the key bytes themselves diverge here).
 *   - Salt determinism: same (ikm, salt, context) → same data key.
 *   - keyVersion: stable 'local-v1' across instances.
 *   - Constructor: missing / weak / non-hex `A2A_SESSION_SECRET` rejected.
 *   - canonicalContextBytes: deterministic; sort-stable; rejects reserved delimiters.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createLocalAesProvider, canonicalContextBytes } from '../../key-custody'

// 64 hex chars = 32 bytes — the minimum required by both `requireSecret`
// in `apps/a2a-agent/src/config.ts:25-34` and our constructor check.
const VALID_SECRET = 'a'.repeat(64)

const CTX = {
  sessionId: 'sa_abc',
  accountAddress: '0xabc0000000000000000000000000000000000001',
  chainId: '31337',
  expiresAt: '2026-05-17T12:00:00.000Z',
  keyVersion: 'local-v1',
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

describe('createLocalAesProvider / round-trip', () => {
  it('matching aadContext returns the same 32-byte key', async () => {
    const provider = createLocalAesProvider({ A2A_SESSION_SECRET: VALID_SECRET })
    const dk = await provider.generateSessionDataKey({ aadContext: CTX })
    assert.equal(dk.plaintextDataKey.length, 32)
    assert.equal(dk.encryptedDataKey.length, 16)
    assert.equal(dk.keyId, 'local')
    assert.equal(dk.keyVersion, 'local-v1')

    const recovered = await provider.decryptSessionDataKey({
      encryptedDataKey: dk.encryptedDataKey,
      aadContext: CTX,
      keyId: dk.keyId,
      keyVersion: dk.keyVersion,
    })
    assert.equal(recovered.length, 32)
    assert.ok(bytesEqual(dk.plaintextDataKey, recovered), 'recovered key differs from original')
  })

  it('different aadContext yields different recovered key bytes', async () => {
    const provider = createLocalAesProvider({ A2A_SESSION_SECRET: VALID_SECRET })
    const dk = await provider.generateSessionDataKey({ aadContext: CTX })

    const wrong = await provider.decryptSessionDataKey({
      encryptedDataKey: dk.encryptedDataKey,
      aadContext: { ...CTX, accountAddress: '0xabc0000000000000000000000000000000000002' },
      keyId: dk.keyId,
      keyVersion: dk.keyVersion,
    })
    assert.ok(!bytesEqual(dk.plaintextDataKey, wrong), 'context mismatch did not change derived key')
  })

  it('same salt + same context → same key (HKDF determinism)', async () => {
    const provider = createLocalAesProvider({ A2A_SESSION_SECRET: VALID_SECRET })
    const dk = await provider.generateSessionDataKey({ aadContext: CTX })

    const again = await provider.decryptSessionDataKey({
      encryptedDataKey: dk.encryptedDataKey,
      aadContext: CTX,
      keyId: 'local',
      keyVersion: 'local-v1',
    })
    const again2 = await provider.decryptSessionDataKey({
      encryptedDataKey: dk.encryptedDataKey,
      aadContext: CTX,
      keyId: 'local',
      keyVersion: 'local-v1',
    })
    assert.ok(bytesEqual(again, again2), 'repeated derive should be deterministic')
  })

  it('different salts (same context) yield different keys', async () => {
    const provider = createLocalAesProvider({ A2A_SESSION_SECRET: VALID_SECRET })
    const a = await provider.generateSessionDataKey({ aadContext: CTX })
    const b = await provider.generateSessionDataKey({ aadContext: CTX })
    assert.ok(!bytesEqual(a.encryptedDataKey, b.encryptedDataKey), 'salts must be random per call')
    assert.ok(!bytesEqual(a.plaintextDataKey, b.plaintextDataKey), 'different salts must yield different keys')
  })

  it('keyVersion returns local-v1 across instances', async () => {
    const a = createLocalAesProvider({ A2A_SESSION_SECRET: VALID_SECRET })
    const b = createLocalAesProvider({ A2A_SESSION_SECRET: 'b'.repeat(64) })
    const da = await a.generateSessionDataKey({ aadContext: CTX })
    const db = await b.generateSessionDataKey({ aadContext: CTX })
    assert.equal(da.keyVersion, 'local-v1')
    assert.equal(db.keyVersion, 'local-v1')
    assert.equal(da.keyId, 'local')
    assert.equal(db.keyId, 'local')
  })
})

describe('createLocalAesProvider / construction validation', () => {
  it('rejects missing A2A_SESSION_SECRET', () => {
    assert.throws(
      () => createLocalAesProvider({ A2A_SESSION_SECRET: '' }),
      /A2A_SESSION_SECRET is required/,
    )
  })

  it('rejects secret that decodes to <32 bytes', () => {
    // 31 bytes = 62 hex chars
    assert.throws(
      () => createLocalAesProvider({ A2A_SESSION_SECRET: 'a'.repeat(62) }),
      /must decode to .*32 bytes/i,
    )
  })

  it('rejects non-hex secrets', () => {
    // 64 chars, but 'z' is not a valid hex digit
    assert.throws(
      () => createLocalAesProvider({ A2A_SESSION_SECRET: 'z'.repeat(64) }),
      /hex-encoded|hex character/i,
    )
  })

  it('rejects odd-length hex', () => {
    assert.throws(
      () => createLocalAesProvider({ A2A_SESSION_SECRET: 'a'.repeat(65) }),
      /hex-encoded|odd length/i,
    )
  })

  it('accepts a 0x-prefixed hex secret of correct length', () => {
    const provider = createLocalAesProvider({ A2A_SESSION_SECRET: '0x' + 'a'.repeat(64) })
    assert.ok(provider)
  })
})

describe('createLocalAesProvider / cross-provider mismatches', () => {
  it('rejects keyId mismatch', async () => {
    const provider = createLocalAesProvider({ A2A_SESSION_SECRET: VALID_SECRET })
    const dk = await provider.generateSessionDataKey({ aadContext: CTX })
    await assert.rejects(
      () => provider.decryptSessionDataKey({
        encryptedDataKey: dk.encryptedDataKey,
        aadContext: CTX,
        keyId: 'aws-kms:bogus',
        keyVersion: 'local-v1',
      }),
      /keyId mismatch/,
    )
  })

  it('rejects keyVersion mismatch', async () => {
    const provider = createLocalAesProvider({ A2A_SESSION_SECRET: VALID_SECRET })
    const dk = await provider.generateSessionDataKey({ aadContext: CTX })
    await assert.rejects(
      () => provider.decryptSessionDataKey({
        encryptedDataKey: dk.encryptedDataKey,
        aadContext: CTX,
        keyId: 'local',
        keyVersion: 'aws-kms:foo',
      }),
      /keyVersion mismatch/,
    )
  })

  it('rejects wrong-length encryptedDataKey', async () => {
    const provider = createLocalAesProvider({ A2A_SESSION_SECRET: VALID_SECRET })
    await assert.rejects(
      () => provider.decryptSessionDataKey({
        encryptedDataKey: new Uint8Array(12), // wrong length
        aadContext: CTX,
        keyId: 'local',
        keyVersion: 'local-v1',
      }),
      /encryptedDataKey must be 16 bytes/,
    )
  })
})

describe('canonicalContextBytes', () => {
  it('produces a deterministic byte string', () => {
    const a = canonicalContextBytes({ b: '2', a: '1' })
    const b = canonicalContextBytes({ a: '1', b: '2' })
    assert.deepEqual(Array.from(a), Array.from(b))
  })

  it('sorts keys lexicographically', () => {
    const out = canonicalContextBytes({ z: 'last', a: 'first' })
    const decoded = new TextDecoder().decode(out)
    assert.equal(decoded, 'a=first\0z=last')
  })

  it('empty context yields empty bytes', () => {
    const out = canonicalContextBytes({})
    assert.equal(out.length, 0)
  })

  it('rejects context keys containing NUL', () => {
    assert.throws(() => canonicalContextBytes({ 'a\0b': 'v' }), /reserved delimiter/)
  })

  it('rejects context keys containing =', () => {
    assert.throws(() => canonicalContextBytes({ 'a=b': 'v' }), /reserved delimiter/)
  })

  it('rejects context values containing NUL', () => {
    assert.throws(() => canonicalContextBytes({ k: 'a\0b' }), /NUL byte/)
  })
})
