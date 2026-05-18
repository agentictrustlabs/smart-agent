/**
 * Tests for crypto.ts AAD binding (HARDENING-PLAN §1.5 #8 / C3).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { encryptPayload, decryptPayload, buildSessionAAD } from '../crypto'

const SECRET = 'a-very-secret-string-only-for-tests'

describe('crypto / AAD binding', () => {
  it('round-trips without AAD', async () => {
    const enc = await encryptPayload({ k: 'v', n: 1 }, SECRET)
    const out = await decryptPayload<{ k: string; n: number }>(enc, SECRET)
    assert.deepEqual(out, { k: 'v', n: 1 })
  })

  it('round-trips with AAD', async () => {
    const aad = new Uint8Array([1, 2, 3, 4])
    const enc = await encryptPayload({ k: 'v' }, SECRET, aad)
    const out = await decryptPayload<{ k: string }>(enc, SECRET, aad)
    assert.deepEqual(out, { k: 'v' })
  })

  it('decrypt with wrong AAD throws', async () => {
    const aad = new Uint8Array([1, 2, 3, 4])
    const wrong = new Uint8Array([1, 2, 3, 5])
    const enc = await encryptPayload({ k: 'v' }, SECRET, aad)
    await assert.rejects(() => decryptPayload(enc, SECRET, wrong))
  })

  it('decrypt without AAD against an AAD-bound ciphertext throws', async () => {
    const aad = new Uint8Array([1, 2, 3, 4])
    const enc = await encryptPayload({ k: 'v' }, SECRET, aad)
    await assert.rejects(() => decryptPayload(enc, SECRET))
  })

  it('decrypt with AAD against a non-AAD ciphertext throws', async () => {
    const aad = new Uint8Array([1, 2, 3, 4])
    const enc = await encryptPayload({ k: 'v' }, SECRET)
    await assert.rejects(() => decryptPayload(enc, SECRET, aad))
  })
})

describe('buildSessionAAD', () => {
  const base = {
    sessionId: 'sa_abc123',
    accountAddress: '0xAbC0000000000000000000000000000000000001',
    chainId: 31337,
    expiresAt: '2026-05-17T12:00:00.000Z',
    keyVersion: 'local-v1',
  }

  it('is deterministic for identical inputs', () => {
    const a = buildSessionAAD(base)
    const b = buildSessionAAD(base)
    assert.deepEqual(Array.from(a), Array.from(b))
  })

  it('is case-insensitive on accountAddress (lowercased internally)', () => {
    const a = buildSessionAAD(base)
    const b = buildSessionAAD({ ...base, accountAddress: base.accountAddress.toLowerCase() })
    assert.deepEqual(Array.from(a), Array.from(b))
  })

  it('differs when sessionId differs', () => {
    const a = buildSessionAAD(base)
    const b = buildSessionAAD({ ...base, sessionId: 'sa_other' })
    assert.notDeepEqual(Array.from(a), Array.from(b))
  })

  it('differs when chainId differs', () => {
    const a = buildSessionAAD(base)
    const b = buildSessionAAD({ ...base, chainId: 1 })
    assert.notDeepEqual(Array.from(a), Array.from(b))
  })

  it('differs when expiresAt differs', () => {
    const a = buildSessionAAD(base)
    const b = buildSessionAAD({ ...base, expiresAt: '2026-05-18T12:00:00.000Z' })
    assert.notDeepEqual(Array.from(a), Array.from(b))
  })

  it('differs when keyVersion differs (P0-6: per-version isolation)', () => {
    const a = buildSessionAAD(base)
    const b = buildSessionAAD({ ...base, keyVersion: 'aws-kms:00000000-0000-0000-0000-000000000000' })
    assert.notDeepEqual(Array.from(a), Array.from(b))
  })

  it('end-to-end: ciphertext bound under (id_a) fails to decrypt with (id_b)', async () => {
    const aadA = buildSessionAAD(base)
    const aadB = buildSessionAAD({ ...base, sessionId: 'sa_attacker' })
    const enc = await encryptPayload({ secret: 'x' }, SECRET, aadA)
    await assert.rejects(() => decryptPayload(enc, SECRET, aadB))
  })

  it('P0-6: ciphertext bound under keyVersion=v1 fails to decrypt under keyVersion=v2', async () => {
    const aadV1 = buildSessionAAD({ ...base, keyVersion: 'local-v1' })
    const aadV2 = buildSessionAAD({ ...base, keyVersion: 'local-v2' })
    const enc = await encryptPayload({ secret: 'rotated' }, SECRET, aadV1)
    await assert.rejects(() => decryptPayload(enc, SECRET, aadV2))
  })
})
