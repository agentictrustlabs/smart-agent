/**
 * Unit tests for `encryptPayloadWithRawKey` / `decryptPayloadWithRawKey`
 * (Sprint 5 W3 P1-3).
 *
 * Covers:
 *   - Round-trip: encrypt then decrypt with same key + same AAD → plaintext matches.
 *   - Different AAD on decrypt → GCM auth fail.
 *   - Different rawKey on decrypt → GCM auth fail.
 *   - Wrong-length key on encrypt / decrypt → clean throw naming the expected length.
 *   - 12-byte IV → permitted; other IV lengths → clean throw on decrypt.
 *   - Tampered ciphertext → GCM auth fail.
 *   - Tampered authTag (wrong length AND mutated bytes) → clean throw / GCM fail.
 *   - AAD shape: `canonicalContextBytes(ctx)` interop.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  encryptPayloadWithRawKey,
  decryptPayloadWithRawKey,
  canonicalContextBytes,
} from '../../key-custody'

const VALID_KEY = new Uint8Array(32).fill(0xab)
const OTHER_KEY = new Uint8Array(32).fill(0xcd)
const AAD = new TextEncoder().encode('proposal-id=42|chain=31337')
const OTHER_AAD = new TextEncoder().encode('proposal-id=99|chain=31337')
const PLAINTEXT = new TextEncoder().encode('hello, proposal body')

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

describe('encryptPayloadWithRawKey / decryptPayloadWithRawKey — round-trip', () => {
  it('encrypts and decrypts with matching key + AAD → plaintext matches', async () => {
    const sealed = await encryptPayloadWithRawKey({
      rawKey: VALID_KEY,
      plaintext: PLAINTEXT,
      aad: AAD,
    })
    assert.equal(sealed.iv.length, 12, 'iv is 12 bytes')
    assert.equal(sealed.authTag.length, 16, 'authTag is 16 bytes')
    assert.equal(sealed.ciphertext.length, PLAINTEXT.length, 'ciphertext length equals plaintext length (GCM)')

    const recovered = await decryptPayloadWithRawKey({
      rawKey: VALID_KEY,
      iv: sealed.iv,
      ciphertext: sealed.ciphertext,
      authTag: sealed.authTag,
      aad: AAD,
    })
    assert.ok(bytesEqual(recovered, PLAINTEXT), 'recovered bytes match plaintext')
  })

  it('two calls produce different IVs (random)', async () => {
    const a = await encryptPayloadWithRawKey({ rawKey: VALID_KEY, plaintext: PLAINTEXT, aad: AAD })
    const b = await encryptPayloadWithRawKey({ rawKey: VALID_KEY, plaintext: PLAINTEXT, aad: AAD })
    assert.ok(!bytesEqual(a.iv, b.iv), 'IVs are random per call')
    assert.ok(!bytesEqual(a.ciphertext, b.ciphertext), 'ciphertexts differ given fresh IV')
  })

  it('round-trips with canonicalContextBytes AAD (interop with provider AAD encoding)', async () => {
    const ctx = { proposalId: '42', chainId: '31337', keyVersion: 'proposal-dek-v1' }
    const aad = canonicalContextBytes(ctx)
    const sealed = await encryptPayloadWithRawKey({ rawKey: VALID_KEY, plaintext: PLAINTEXT, aad })
    const recovered = await decryptPayloadWithRawKey({
      rawKey: VALID_KEY,
      iv: sealed.iv,
      ciphertext: sealed.ciphertext,
      authTag: sealed.authTag,
      aad: canonicalContextBytes(ctx),
    })
    assert.ok(bytesEqual(recovered, PLAINTEXT))
  })

  it('empty plaintext round-trips', async () => {
    const empty = new Uint8Array(0)
    const sealed = await encryptPayloadWithRawKey({ rawKey: VALID_KEY, plaintext: empty, aad: AAD })
    assert.equal(sealed.ciphertext.length, 0, 'empty plaintext → empty ciphertext')
    const recovered = await decryptPayloadWithRawKey({
      rawKey: VALID_KEY,
      iv: sealed.iv,
      ciphertext: sealed.ciphertext,
      authTag: sealed.authTag,
      aad: AAD,
    })
    assert.equal(recovered.length, 0)
  })

  it('empty AAD is permitted', async () => {
    const empty = new Uint8Array(0)
    const sealed = await encryptPayloadWithRawKey({
      rawKey: VALID_KEY,
      plaintext: PLAINTEXT,
      aad: empty,
    })
    const recovered = await decryptPayloadWithRawKey({
      rawKey: VALID_KEY,
      iv: sealed.iv,
      ciphertext: sealed.ciphertext,
      authTag: sealed.authTag,
      aad: empty,
    })
    assert.ok(bytesEqual(recovered, PLAINTEXT))
  })
})

describe('encryptPayloadWithRawKey / decryptPayloadWithRawKey — auth failures', () => {
  it('different AAD on decrypt → GCM auth fail', async () => {
    const sealed = await encryptPayloadWithRawKey({
      rawKey: VALID_KEY,
      plaintext: PLAINTEXT,
      aad: AAD,
    })
    await assert.rejects(
      () =>
        decryptPayloadWithRawKey({
          rawKey: VALID_KEY,
          iv: sealed.iv,
          ciphertext: sealed.ciphertext,
          authTag: sealed.authTag,
          aad: OTHER_AAD,
        }),
      /AES-GCM authentication failed/,
    )
  })

  it('different rawKey on decrypt → GCM auth fail', async () => {
    const sealed = await encryptPayloadWithRawKey({
      rawKey: VALID_KEY,
      plaintext: PLAINTEXT,
      aad: AAD,
    })
    await assert.rejects(
      () =>
        decryptPayloadWithRawKey({
          rawKey: OTHER_KEY,
          iv: sealed.iv,
          ciphertext: sealed.ciphertext,
          authTag: sealed.authTag,
          aad: AAD,
        }),
      /AES-GCM authentication failed/,
    )
  })

  it('tampered ciphertext → GCM auth fail', async () => {
    const sealed = await encryptPayloadWithRawKey({
      rawKey: VALID_KEY,
      plaintext: PLAINTEXT,
      aad: AAD,
    })
    const tampered = new Uint8Array(sealed.ciphertext)
    tampered[0] = tampered[0] ^ 0x01
    await assert.rejects(
      () =>
        decryptPayloadWithRawKey({
          rawKey: VALID_KEY,
          iv: sealed.iv,
          ciphertext: tampered,
          authTag: sealed.authTag,
          aad: AAD,
        }),
      /AES-GCM authentication failed/,
    )
  })

  it('tampered authTag bytes → GCM auth fail', async () => {
    const sealed = await encryptPayloadWithRawKey({
      rawKey: VALID_KEY,
      plaintext: PLAINTEXT,
      aad: AAD,
    })
    const tampered = new Uint8Array(sealed.authTag)
    tampered[0] = tampered[0] ^ 0x01
    await assert.rejects(
      () =>
        decryptPayloadWithRawKey({
          rawKey: VALID_KEY,
          iv: sealed.iv,
          ciphertext: sealed.ciphertext,
          authTag: tampered,
          aad: AAD,
        }),
      /AES-GCM authentication failed/,
    )
  })

  it('tampered IV → GCM auth fail (still 12 bytes)', async () => {
    const sealed = await encryptPayloadWithRawKey({
      rawKey: VALID_KEY,
      plaintext: PLAINTEXT,
      aad: AAD,
    })
    const tampered = new Uint8Array(sealed.iv)
    tampered[0] = tampered[0] ^ 0x01
    await assert.rejects(
      () =>
        decryptPayloadWithRawKey({
          rawKey: VALID_KEY,
          iv: tampered,
          ciphertext: sealed.ciphertext,
          authTag: sealed.authTag,
          aad: AAD,
        }),
      /AES-GCM authentication failed/,
    )
  })
})

describe('encryptPayloadWithRawKey / decryptPayloadWithRawKey — length validation', () => {
  it('wrong-length key on encrypt → clean throw naming expected length', async () => {
    await assert.rejects(
      () =>
        encryptPayloadWithRawKey({
          rawKey: new Uint8Array(16), // AES-128 length, not allowed
          plaintext: PLAINTEXT,
          aad: AAD,
        }),
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        assert.match(msg, /encryptPayloadWithRawKey/)
        assert.match(msg, /32 bytes/)
        assert.match(msg, /got 16/)
        return true
      },
    )
  })

  it('wrong-length key on decrypt → clean throw naming expected length', async () => {
    await assert.rejects(
      () =>
        decryptPayloadWithRawKey({
          rawKey: new Uint8Array(31),
          iv: new Uint8Array(12),
          ciphertext: new Uint8Array(0),
          authTag: new Uint8Array(16),
          aad: AAD,
        }),
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        assert.match(msg, /decryptPayloadWithRawKey/)
        assert.match(msg, /32 bytes/)
        assert.match(msg, /got 31/)
        return true
      },
    )
  })

  it('empty key on encrypt → clean throw', async () => {
    await assert.rejects(
      () =>
        encryptPayloadWithRawKey({
          rawKey: new Uint8Array(0),
          plaintext: PLAINTEXT,
          aad: AAD,
        }),
      /32 bytes/,
    )
  })

  it('12-byte IV is permitted (round-trip already covers this implicitly)', async () => {
    // The encrypt helper produces a 12-byte IV; round-trip succeeds.
    const sealed = await encryptPayloadWithRawKey({
      rawKey: VALID_KEY,
      plaintext: PLAINTEXT,
      aad: AAD,
    })
    assert.equal(sealed.iv.length, 12)
    const recovered = await decryptPayloadWithRawKey({
      rawKey: VALID_KEY,
      iv: sealed.iv,
      ciphertext: sealed.ciphertext,
      authTag: sealed.authTag,
      aad: AAD,
    })
    assert.ok(bytesEqual(recovered, PLAINTEXT))
  })

  it('wrong-length IV on decrypt (8 bytes) → clean throw', async () => {
    const sealed = await encryptPayloadWithRawKey({
      rawKey: VALID_KEY,
      plaintext: PLAINTEXT,
      aad: AAD,
    })
    await assert.rejects(
      () =>
        decryptPayloadWithRawKey({
          rawKey: VALID_KEY,
          iv: new Uint8Array(8),
          ciphertext: sealed.ciphertext,
          authTag: sealed.authTag,
          aad: AAD,
        }),
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        assert.match(msg, /iv must be exactly 12 bytes/)
        assert.match(msg, /got 8/)
        return true
      },
    )
  })

  it('wrong-length IV on decrypt (16 bytes) → clean throw', async () => {
    const sealed = await encryptPayloadWithRawKey({
      rawKey: VALID_KEY,
      plaintext: PLAINTEXT,
      aad: AAD,
    })
    await assert.rejects(
      () =>
        decryptPayloadWithRawKey({
          rawKey: VALID_KEY,
          iv: new Uint8Array(16),
          ciphertext: sealed.ciphertext,
          authTag: sealed.authTag,
          aad: AAD,
        }),
      /iv must be exactly 12 bytes/,
    )
  })

  it('wrong-length authTag on decrypt → clean throw', async () => {
    const sealed = await encryptPayloadWithRawKey({
      rawKey: VALID_KEY,
      plaintext: PLAINTEXT,
      aad: AAD,
    })
    await assert.rejects(
      () =>
        decryptPayloadWithRawKey({
          rawKey: VALID_KEY,
          iv: sealed.iv,
          ciphertext: sealed.ciphertext,
          authTag: new Uint8Array(15),
          aad: AAD,
        }),
      /authTag must be exactly 16 bytes/,
    )
  })
})
