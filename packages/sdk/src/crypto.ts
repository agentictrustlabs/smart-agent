/**
 * Cryptographic utilities for session package encryption.
 * Uses AES-GCM for at-rest encryption of session packages
 * containing private key material.
 *
 * AAD (Additional Authenticated Data) binding:
 *   `encryptPayload` and `decryptPayload` accept an optional AAD byte
 *   string. When provided, the AAD is bound into the AES-GCM tag — a
 *   ciphertext encrypted under one AAD will fail to decrypt under any
 *   other. Session callers MUST construct an AAD from session metadata
 *   (sessionId, accountAddress, chainId, expiresAt) so a leaked
 *   ciphertext + key cannot be replayed against a different session row.
 *
 *   For backward compatibility the AAD parameter is optional; rows
 *   encrypted without AAD only decrypt when AAD is omitted on decrypt.
 *   See HARDENING-PLAN §1.5 #8 for the migration trip-wire.
 */
import { keccak256, encodePacked } from 'viem'

const ALGORITHM = 'AES-GCM'
const KEY_LENGTH = 256
const IV_LENGTH = 12

/**
 * Derive an AES-GCM key from a secret string.
 * Uses SHA-256 hash of the secret as raw key material.
 */
async function deriveKey(secret: string): Promise<CryptoKey> {
  const encoder = new TextEncoder()
  const secretBytes = encoder.encode(secret)
  const keyMaterial = await crypto.subtle.digest('SHA-256', secretBytes.buffer as ArrayBuffer)
  return crypto.subtle.importKey(
    'raw',
    keyMaterial,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** Encode bytes to base64url */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Decode base64url to bytes */
export function fromBase64Url(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export interface EncryptedPayload {
  ciphertext: string // base64url
  iv: string         // base64url
}

/**
 * Encrypt a JSON-serializable value with AES-GCM.
 * The secret should be stored securely (env var, not in code).
 *
 * Pass `aad` to bind the ciphertext to a specific session/account/chain
 * context — see `buildSessionAAD()`. Rows written without AAD can ONLY
 * be decrypted by calling `decryptPayload` without AAD.
 */
export async function encryptPayload(
  data: unknown,
  secret: string,
  aad?: Uint8Array,
): Promise<EncryptedPayload> {
  const key = await deriveKey(secret)
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const encoder = new TextEncoder()
  // Handle BigInt serialization (delegation salts are BigInt)
  const jsonStr = JSON.stringify(data, (_key, value) =>
    typeof value === 'bigint' ? value.toString() : value,
  )
  const plaintext = encoder.encode(jsonStr)

  const algorithm: AesGcmParams = aad
    ? { name: ALGORITHM, iv: iv.buffer as ArrayBuffer, additionalData: aad.buffer as ArrayBuffer }
    : { name: ALGORITHM, iv: iv.buffer as ArrayBuffer }

  const ciphertext = await crypto.subtle.encrypt(
    algorithm,
    key,
    plaintext.buffer as ArrayBuffer,
  )

  return {
    ciphertext: toBase64Url(new Uint8Array(ciphertext)),
    iv: toBase64Url(iv),
  }
}

/**
 * Decrypt an AES-GCM encrypted payload back to its original value.
 *
 * Pass the SAME `aad` used at encrypt time. A mismatch (including
 * absent-vs-present) causes AES-GCM tag verification to fail and the
 * call to throw. That's the intended trip-wire when a session row's
 * binding context (sessionId/account/chain/expiry) has been tampered
 * with.
 */
export async function decryptPayload<T = unknown>(
  encrypted: EncryptedPayload,
  secret: string,
  aad?: Uint8Array,
): Promise<T> {
  const key = await deriveKey(secret)
  const iv = fromBase64Url(encrypted.iv)
  const ciphertext = fromBase64Url(encrypted.ciphertext)

  const algorithm: AesGcmParams = aad
    ? { name: ALGORITHM, iv: iv.buffer as ArrayBuffer, additionalData: aad.buffer as ArrayBuffer }
    : { name: ALGORITHM, iv: iv.buffer as ArrayBuffer }

  const plaintext = await crypto.subtle.decrypt(
    algorithm,
    key,
    ciphertext.buffer as ArrayBuffer,
  )

  const decoder = new TextDecoder()
  return JSON.parse(decoder.decode(plaintext)) as T
}

/**
 * Build a canonical AAD for a session-package encryption.
 *
 * Binds the ciphertext to
 * `(sessionId, accountAddress, chainId, expiresAt, keyVersion)`
 * via `keccak256(abi.encodePacked(...))`. Callers should reconstruct the
 * AAD on read by passing the SAME values from the session row.
 *
 * Canonical format (HARDENING-PLAN §1.5 #8 + reviewer P0-6):
 *   keccak256(
 *     abi.encodePacked(
 *       sessionId,           // string
 *       accountAddress,      // string (lower-cased)
 *       chainId,             // uint256
 *       expiresAt,           // string (ISO timestamp)
 *       keyVersion           // string ('local-v1' | 'aws-kms:<uuid>' | …)
 *     )
 *   )
 *
 * `expiresAt` is the ISO timestamp string from the DB row. Strings are
 * packed as bytes so any drift causes decrypt to fail (the trip-wire).
 *
 * `keyVersion` (added in P0-6): pinning the key-version label into the
 * AES-GCM tag means a row encrypted under `local-v1` cannot be
 * silently replayed against a verifier that has been told the row is
 * `aws-kms:<uuid>` (or vice versa). This is the AES-GCM-layer analogue
 * of the AWS KMS `EncryptionContext:key_version` binding enforced by
 * the IAM policy on the CMK.
 */
export function buildSessionAAD(input: {
  sessionId: string
  accountAddress: string
  chainId: number
  expiresAt: string
  keyVersion: string
}): Uint8Array {
  const hash = keccak256(
    encodePacked(
      ['string', 'string', 'uint256', 'string', 'string'],
      [
        input.sessionId,
        input.accountAddress.toLowerCase(),
        BigInt(input.chainId),
        input.expiresAt,
        input.keyVersion,
      ],
    ),
  )
  // Strip 0x and decode hex → bytes
  const hex = hash.slice(2)
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16)
  }
  return bytes
}

/**
 * Generate a random hex string for use as an HMAC secret or nonce.
 */
export function randomHex(bytes: number = 32): string {
  const arr = crypto.getRandomValues(new Uint8Array(bytes))
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Compute HMAC-SHA256 of a message using a hex-encoded secret.
 * Returns base64url-encoded signature.
 */
export async function hmacSign(message: string, secretHex: string): Promise<string> {
  const encoder = new TextEncoder()
  const hexPairs = secretHex.match(/.{2}/g)!
  const keyArr = new Uint8Array(hexPairs.map(b => parseInt(b, 16)))

  const key = await crypto.subtle.importKey(
    'raw',
    keyArr.buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const msgBytes = encoder.encode(message)
  const sig = await crypto.subtle.sign('HMAC', key, msgBytes.buffer as ArrayBuffer)
  return toBase64Url(new Uint8Array(sig))
}

/**
 * Verify HMAC-SHA256 signature.
 */
export async function hmacVerify(message: string, signature: string, secretHex: string): Promise<boolean> {
  const expected = await hmacSign(message, secretHex)
  // Constant-time comparison
  if (expected.length !== signature.length) return false
  let result = 0
  for (let i = 0; i < expected.length; i++) {
    result |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  }
  return result === 0
}
