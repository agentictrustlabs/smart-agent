/**
 * Unit tests for `packages/sdk/src/key-custody/crc32c.ts` (GCP-KMS G-PR-2).
 *
 * The Castagnoli CRC32C variant has well-known reference vectors. If our
 * polynomial implementation drifts, these tests fail loudly — Cloud KMS
 * accepts ONLY this polynomial, and a wrong-poly implementation would
 * silently break every encrypt/decrypt round-trip in production.
 *
 * Vectors:
 *   crc32c('')           = 0          (empty input — table-init sanity)
 *   crc32c('a')          = 0xc1d04330 (single byte path)
 *   crc32c('123456789')  = 0xe3069283 (Castagnoli canonical test vector
 *                                       from RFC 3720 / SCTP / SSE-4.2 spec)
 *   crc32c(<1 KB random>) deterministic — same input → same output, never
 *                                          0 (sanity for the byte path).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { crc32c } from '../../key-custody/crc32c'

test("crc32c('') === 0n", () => {
  assert.equal(crc32c(''), 0n)
  assert.equal(crc32c(new Uint8Array(0)), 0n)
})

test("crc32c('a') === 0xc1d04330n", () => {
  assert.equal(crc32c('a'), 0xc1d04330n)
})

test("crc32c('123456789') === 0xe3069283n (Castagnoli canonical vector)", () => {
  assert.equal(crc32c('123456789'), 0xe3069283n)
})

test('crc32c handles a 1 KB buffer deterministically', () => {
  const buf = new Uint8Array(1024)
  // Fill with a deterministic byte pattern so re-runs are stable.
  for (let i = 0; i < buf.length; i++) buf[i] = (i * 31 + 7) & 0xff
  const first = crc32c(buf)
  const second = crc32c(buf)
  // Determinism: identical input always yields identical output.
  assert.equal(first, second)
  // Never the empty-input value for non-empty input (sanity check that
  // the byte path is actually executing).
  assert.notEqual(first, 0n)
  // CRC32C fits in 32 bits — value MUST be in [0, 2^32).
  assert.ok(first >= 0n && first < 0x100000000n)
})

test('crc32c is byte-identical between string and equivalent Uint8Array input', () => {
  // The 'a' vector above is checked as a string; here we re-check it as
  // Uint8Array bytes to lock in the string→bytes path.
  const bytes = new TextEncoder().encode('a')
  assert.equal(crc32c(bytes), 0xc1d04330n)
})

test('crc32c differs between two single-bit-different inputs (avalanche sanity)', () => {
  // CRC32C must propagate single-bit flips. Two inputs differing by ONE
  // bit must produce different CRCs — locks out a stuck-at-zero
  // implementation that returns the same value for everything.
  const a = new Uint8Array([0x00])
  const b = new Uint8Array([0x01])
  assert.notEqual(crc32c(a), crc32c(b))
})
