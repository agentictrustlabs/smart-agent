/**
 * ASN.1 DER decoding helpers shared by the KMS signer family (KMS K4 §5.3, §5.5).
 *
 * AWS KMS returns ECDSA signatures (`kms:Sign`) as ASN.1 DER `SEQUENCE { r INTEGER, s INTEGER }`
 * and public keys (`kms:GetPublicKey`) as DER `SubjectPublicKeyInfo` (RFC 5280).
 * Both shapes need careful walking — naive fixed-offset slicers silently corrupt
 * `~0.4%` of inputs (`r` or `s` with leading-zero pad when the high bit is set).
 *
 * Exports:
 *   - `parseDerSignature(der)` — decode a DER `SEQUENCE { r INTEGER, s INTEGER }`
 *     to `{ r: bigint, s: bigint }`. Handles:
 *       • Leading-zero pad on positive integers whose high bit is set (33-byte form).
 *       • Naturally-short integers (< 32 bytes).
 *       • Length encodings (single-byte AND multi-byte).
 *       • Rejects non-minimal encodings + trailing bytes after the SEQUENCE.
 *   - `extractSec1FromSpki(spki)` — unwrap a DER `SubjectPublicKeyInfo` to the
 *     65-byte SEC1 uncompressed point (`0x04 || X || Y`). Used by the KMS signer
 *     to derive the master-EOA address from `kms:GetPublicKey` output.
 *
 * The decoder does NOT validate the AlgorithmIdentifier OID inside SPKI — AWS
 * returns `1.2.840.10045.2.1 ecPublicKey` + `1.3.132.0.10 secp256k1`. A wrong-
 * curve key is caught implicitly by recovery-id mismatch in the signer.
 *
 * Notes for future maintainers: this is a minimal hand-rolled walker. If we
 * ever need general-purpose ASN.1 (X.509 certificate parsing, CMS), pull in
 * `@peculiar/asn1-schema` instead of extending this file.
 */

/** Read a DER length field. Returns the length value + the next-byte offset. */
export function readDerLen(buf: Uint8Array, off: number): { value: number; next: number } {
  if (off >= buf.length) {
    throw new Error('der: unexpected end of buffer when reading length')
  }
  const b = buf[off]!
  if (b < 0x80) return { value: b, next: off + 1 }
  const n = b & 0x7f
  if (n === 0 || n > 4) {
    throw new Error('der: unsupported length form')
  }
  if (off + 1 + n > buf.length) {
    throw new Error('der: length bytes exceed buffer')
  }
  let v = 0
  for (let i = 0; i < n; i++) {
    v = (v << 8) | buf[off + 1 + i]!
  }
  return { value: v, next: off + 1 + n }
}

/**
 * Strip the leading 0x00 byte DER prepends to a positive integer whose
 * most-significant byte has its high bit set. Reject other forms of
 * leading zeros — they are non-minimal per DER and we don't want to admit
 * malleable encodings.
 */
export function stripDerIntegerPad(b: Uint8Array): Uint8Array {
  if (b.length === 0) throw new Error('der: empty integer')
  if (b[0] === 0x00) {
    if (b.length === 1) return b // canonical zero
    if ((b[1]! & 0x80) === 0) throw new Error('der: non-minimal integer encoding')
    return b.slice(1)
  }
  return b
}

/** Big-endian unsigned-bytes → bigint. */
export function bytesToBigInt(b: Uint8Array): bigint {
  let v = 0n
  for (const x of b) v = (v << 8n) | BigInt(x)
  return v
}

/**
 * Decode a DER-encoded ECDSA signature `SEQUENCE { r INTEGER, s INTEGER }`.
 * Throws on any malformed structure (wrong tags, length mismatches, trailing
 * bytes, non-minimal integer encoding).
 *
 * Returns `r` and `s` as bigints; the caller converts to 32-byte big-endian
 * via `bigIntTo32Bytes` after low-s normalization.
 */
export function parseDerSignature(der: Uint8Array): { r: bigint; s: bigint } {
  if (der.length < 2) throw new Error('der: signature too short')
  if (der[0] !== 0x30) throw new Error('der: expected SEQUENCE')
  let off = 1
  const seqLen = readDerLen(der, off)
  off = seqLen.next
  if (seqLen.value !== der.length - off) {
    throw new Error('der: seq length mismatch')
  }

  // INTEGER r
  if (off >= der.length || der[off] !== 0x02) {
    throw new Error('der: expected INTEGER (r)')
  }
  off++
  const rLen = readDerLen(der, off)
  off = rLen.next
  if (off + rLen.value > der.length) throw new Error('der: r overruns buffer')
  const r = bytesToBigInt(stripDerIntegerPad(der.slice(off, off + rLen.value)))
  off += rLen.value

  // INTEGER s
  if (off >= der.length || der[off] !== 0x02) {
    throw new Error('der: expected INTEGER (s)')
  }
  off++
  const sLen = readDerLen(der, off)
  off = sLen.next
  if (off + sLen.value > der.length) throw new Error('der: s overruns buffer')
  const s = bytesToBigInt(stripDerIntegerPad(der.slice(off, off + sLen.value)))
  off += sLen.value

  if (off !== der.length) throw new Error('der: trailing bytes after signature')
  return { r, s }
}

/**
 * Extract the 65-byte SEC1 uncompressed EC point from a DER `SubjectPublicKeyInfo`.
 *
 * `SubjectPublicKeyInfo ::= SEQUENCE {`
 * `    algorithm   AlgorithmIdentifier,`
 * `    subjectPublicKey BIT STRING`
 * `}`
 *
 * The interior BIT STRING for secp256k1 is `0x04 || X || Y` (65 bytes total).
 * Returns the full 65-byte point WITH the leading `0x04` prefix.
 */
export function extractSec1FromSpki(spki: Uint8Array): Uint8Array {
  if (spki.length < 2 || spki[0] !== 0x30) {
    throw new Error('spki: expected SEQUENCE')
  }
  let off = 1
  const seqLen = readDerLen(spki, off)
  off = seqLen.next
  if (seqLen.value !== spki.length - off) {
    throw new Error('spki: outer length mismatch')
  }

  // AlgorithmIdentifier — another SEQUENCE; skip it.
  if (off >= spki.length || spki[off] !== 0x30) {
    throw new Error('spki: expected AlgorithmIdentifier SEQUENCE')
  }
  off++
  const algLen = readDerLen(spki, off)
  off = algLen.next + algLen.value
  if (off > spki.length) throw new Error('spki: alg block overruns buffer')

  // BIT STRING
  if (off >= spki.length || spki[off] !== 0x03) {
    throw new Error('spki: expected BIT STRING')
  }
  off++
  const bitLen = readDerLen(spki, off)
  off = bitLen.next
  if (off + bitLen.value > spki.length) {
    throw new Error('spki: bit string overruns buffer')
  }
  // First byte of BIT STRING content is the "unused bits" count — must be 0 for SEC1.
  if (spki[off] !== 0x00) {
    throw new Error('spki: non-zero unused-bits byte')
  }
  off++
  const point = spki.slice(off, off + bitLen.value - 1)
  if (point.length !== 65 || point[0] !== 0x04) {
    throw new Error(
      `spki: expected 65-byte SEC1 uncompressed point with 0x04 prefix (got ${point.length} bytes, first=${point[0]?.toString(16)})`,
    )
  }
  return point
}

/** Big-endian bigint → 32-byte Uint8Array. Throws on overflow. */
export function bigIntTo32Bytes(v: bigint): Uint8Array {
  if (v < 0n) throw new Error('bigIntTo32Bytes: negative value')
  const out = new Uint8Array(32)
  let x = v
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(x & 0xffn)
    x >>= 8n
  }
  if (x !== 0n) throw new Error('bigIntTo32Bytes: integer overflows 32 bytes')
  return out
}
