/**
 * CRC32C (Castagnoli) — table-based, table is precomputed once at module load.
 *
 * Why this file exists:
 *   Google Cloud KMS uses CRC32C to detect in-flight corruption of every
 *   request/response payload. Both sides compute the CRC32C of plaintext,
 *   ciphertext, and additionalAuthenticatedData; the API echoes back
 *   "verified" booleans the client must check (see
 *   `packages/sdk/src/key-custody/gcp-kms-provider.ts`). Without this
 *   end-to-end check a transient bit-flip between Node and Cloud KMS would
 *   silently corrupt a session DEK or ciphertext.
 *
 * Polynomial: 0x1EDC6F41 (Castagnoli — different from the standard
 * Ethernet/IEEE 802.3 CRC32 polynomial). This is the polynomial Cloud KMS
 * requires per the IInt64Value.value contract on its proto interface.
 *
 * Reference vectors (locked by `crc32c.test.ts`):
 *   crc32c('')           → 0n           (empty)
 *   crc32c('a')          → 0xc1d04330n
 *   crc32c('123456789')  → 0xe3069283n  (Castagnoli reference vector)
 *
 * Returns a `bigint` because Google's proto type for the CRC fields is
 * `IInt64Value.value: number|Long|string`. We always pass the value as a
 * bigint string (formatted at the call site) — Long is opt-in inside the
 * proto runtime and string is universally accepted.
 *
 * No external dependency: this is ~25 lines of code and one 256-entry
 * table. Pulling in `@node-rs/crc32` or `polycrc` for one CRC variant
 * would bloat the SDK bundle.
 */

/** Polynomial reflected: 0x82F63B78 (the reflected form of 0x1EDC6F41). */
const POLY_REFLECTED = 0x82f63b78

/** Precomputed 256-entry table for table-driven CRC32C. */
const TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? POLY_REFLECTED ^ (c >>> 1) : c >>> 1
    }
    t[i] = c >>> 0
  }
  return t
})()

/**
 * Compute CRC32C of a byte buffer.
 *
 * Accepts a Uint8Array, Buffer (Node), or plain string (encoded as UTF-8).
 * Returns a non-negative bigint in [0, 2^32).
 */
export function crc32c(input: Uint8Array | string): bigint {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    const idx = (crc ^ bytes[i]!) & 0xff
    crc = (TABLE[idx]! ^ (crc >>> 8)) >>> 0
  }
  return BigInt((crc ^ 0xffffffff) >>> 0)
}
