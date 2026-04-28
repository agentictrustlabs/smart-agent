/**
 * Deterministic JSON canonicalization (json-c14n-v1) + sha256 hashing.
 *
 * This is a pragmatic subset of RFC 8785 sufficient for our types:
 *   • object keys sorted lexicographically (UTF-16 code-unit order);
 *   • no whitespace;
 *   • numbers serialized via JS toString (we only ever encode integers
 *     and well-defined floats; full RFC 8785 number canonicalization
 *     is not needed for the fields we hash);
 *   • undefined / functions / symbols are rejected (throw).
 *
 * Two hashes always agree if the inputs would parse equivalently.
 */

import { createHash } from 'node:crypto'

export type Canonicalizable =
  | null
  | boolean
  | number
  | string
  | Canonicalizable[]
  | { [k: string]: Canonicalizable | undefined }

/** json-c14n-v1: deterministic stringify with sorted object keys and
 *  no whitespace. */
export function canonicalize(value: Canonicalizable): string {
  return stringify(value)
}

function stringify(v: Canonicalizable): string {
  if (v === null) return 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error('canonicalize: non-finite number')
    return String(v)
  }
  if (typeof v === 'string') return JSON.stringify(v)
  if (Array.isArray(v)) {
    return '[' + v.map(stringify).join(',') + ']'
  }
  if (typeof v === 'object') {
    // Drop undefined keys; sort remaining keys.
    const keys = Object.keys(v as object).filter(k => (v as Record<string, unknown>)[k] !== undefined)
    keys.sort()
    const parts = keys.map(k => JSON.stringify(k) + ':' + stringify((v as Record<string, Canonicalizable>)[k]))
    return '{' + parts.join(',') + '}'
  }
  throw new Error(`canonicalize: unsupported value (${typeof v})`)
}

/** sha256 over the canonical UTF-8 bytes; returns 0x-prefixed hex. */
export function hashCanonical(value: Canonicalizable): `0x${string}` {
  const text = canonicalize(value)
  const digest = createHash('sha256').update(text, 'utf8').digest('hex')
  return ('0x' + digest) as `0x${string}`
}
