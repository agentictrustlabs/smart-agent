/**
 * Cryptographic utilities for session package encryption.
 * Uses AES-GCM for at-rest encryption of session packages
 * containing private key material.
 */

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
function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Decode base64url to bytes */
function fromBase64Url(str: string): Uint8Array {
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
 */
export async function encryptPayload(
  data: unknown,
  secret: string,
): Promise<EncryptedPayload> {
  const key = await deriveKey(secret)
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const encoder = new TextEncoder()
  // Handle BigInt serialization (delegation salts are BigInt)
  const jsonStr = JSON.stringify(data, (_key, value) =>
    typeof value === 'bigint' ? value.toString() : value,
  )
  const plaintext = encoder.encode(jsonStr)

  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv: iv.buffer as ArrayBuffer },
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
 */
export async function decryptPayload<T = unknown>(
  encrypted: EncryptedPayload,
  secret: string,
): Promise<T> {
  const key = await deriveKey(secret)
  const iv = fromBase64Url(encrypted.iv)
  const ciphertext = fromBase64Url(encrypted.ciphertext)

  const plaintext = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv: iv.buffer as ArrayBuffer },
    key,
    ciphertext.buffer as ArrayBuffer,
  )

  const decoder = new TextDecoder()
  return JSON.parse(decoder.decode(plaintext)) as T
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
