/**
 * WebAuthn passkey helpers.
 *
 * These helpers translate between the browser's navigator.credentials API
 * and the shape our PasskeyValidator contract expects. They are intentionally
 * transport-agnostic: you can run them in a browser, a Playwright spec, or
 * a Node test harness that constructs the same byte layout.
 *
 * Contract calldata layout (abi.encode of Assertion):
 *   authenticatorData   bytes
 *   clientDataJSON      string
 *   challengeIndex      uint256
 *   typeIndex           uint256
 *   r                   uint256
 *   s                   uint256
 *   credentialIdDigest  bytes32
 */

import { keccak256, encodeAbiParameters, toHex, toBytes } from 'viem'

/** Base64url-encode a Uint8Array (no padding). */
export function base64urlEncode(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  // btoa exists in browsers and modern Node (>=18). In older Node, fall back
  // to Buffer.from(bytes).toString('base64') then transform.
  let b64: string
  if (typeof btoa === 'function') {
    b64 = btoa(bin)
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    b64 = (globalThis as any).Buffer.from(bytes).toString('base64')
  }
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Base64url-decode to bytes. */
export function base64urlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice((2 - (s.length & 3)) & 3)
  const bin = typeof atob === 'function'
    ? atob(padded)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    : (globalThis as any).Buffer.from(padded, 'base64').toString('binary')
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** The structured Assertion argument our contract expects. */
export interface PasskeyAssertion {
  authenticatorData: `0x${string}`
  clientDataJSON: string
  challengeIndex: bigint
  typeIndex: bigint
  r: bigint
  s: bigint
  credentialIdDigest: `0x${string}`
}

/**
 * Parse a DER-encoded P-256 ECDSA signature into (r, s) components.
 * WebAuthn authenticators return signatures in this format.
 */
export function parseDerSignature(der: Uint8Array): { r: bigint; s: bigint } {
  // Layout: 0x30 len 0x02 rLen r... 0x02 sLen s...
  if (der[0] !== 0x30) throw new Error('DER: missing sequence tag')
  let i = 2
  if (der[i] !== 0x02) throw new Error('DER: missing r tag')
  i++
  const rLen = der[i]; i++
  const rBytes = der.slice(i, i + rLen); i += rLen
  if (der[i] !== 0x02) throw new Error('DER: missing s tag')
  i++
  const sLen = der[i]; i++
  const sBytes = der.slice(i, i + sLen); i += sLen
  return { r: bytesToBigInt(rBytes), s: bytesToBigInt(sBytes) }
}

function bytesToBigInt(b: Uint8Array): bigint {
  let n = 0n
  for (const x of b) n = (n << 8n) | BigInt(x)
  return n
}

/** secp256r1 order used to normalise s to the low half. */
export const P256_N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551n
/**
 * Many WebAuthn authenticators produce high-s signatures (allowed by FIPS 186-4).
 * Solidity verifiers that reject non-canonical signatures require low-s.
 * Our PasskeyValidator defers to the RIP-7212 precompile, which accepts both,
 * but we normalise defensively so compatibility with stricter verifiers holds.
 */
export function normaliseLowS(s: bigint): bigint {
  return s > P256_N / 2n ? P256_N - s : s
}

/** Locate substring index in a Uint8Array (sequentially). */
function findIndex(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}

/**
 * Build the structured Assertion argument from a raw WebAuthn assertion response.
 *
 * @param credentialIdBytes — the credentialId bytes returned by the authenticator.
 * @param authenticatorData — navigator.credentials.get response authenticatorData.
 * @param clientDataJSON    — navigator.credentials.get response clientDataJSON (UTF-8 bytes).
 * @param derSignature      — DER ECDSA signature as returned by the authenticator.
 */
export function buildPasskeyAssertion(args: {
  credentialIdBytes: Uint8Array
  authenticatorData: Uint8Array
  clientDataJSON: Uint8Array
  derSignature: Uint8Array
}): PasskeyAssertion {
  const cdjStr = new TextDecoder().decode(args.clientDataJSON)
  const cdjBytes = args.clientDataJSON

  const typeMarker = new TextEncoder().encode('"type":"webauthn.get"')
  const typeIndex = findIndex(cdjBytes, typeMarker)
  if (typeIndex < 0) throw new Error('clientDataJSON: missing "type":"webauthn.get"')

  const challengeMarker = new TextEncoder().encode('"challenge":"')
  const challengeIndex = findIndex(cdjBytes, challengeMarker)
  if (challengeIndex < 0) throw new Error('clientDataJSON: missing "challenge" key')

  const { r, s } = parseDerSignature(args.derSignature)

  return {
    authenticatorData: toHex(args.authenticatorData),
    clientDataJSON: cdjStr,
    challengeIndex: BigInt(challengeIndex),
    typeIndex: BigInt(typeIndex),
    r,
    s: normaliseLowS(s),
    credentialIdDigest: keccak256(args.credentialIdBytes),
  }
}

/** abi.encode the assertion in the shape PasskeyValidator.isValidSignature expects. */
export function encodeAssertionForValidator(a: PasskeyAssertion): `0x${string}` {
  return encodeAbiParameters(
    [{
      type: 'tuple',
      components: [
        { name: 'authenticatorData',  type: 'bytes'   },
        { name: 'clientDataJSON',     type: 'string'  },
        { name: 'challengeIndex',     type: 'uint256' },
        { name: 'typeIndex',          type: 'uint256' },
        { name: 'r',                  type: 'uint256' },
        { name: 's',                  type: 'uint256' },
        { name: 'credentialIdDigest', type: 'bytes32' },
      ],
    }],
    [a],
  )
}

/** Produce the on-chain-consumable blob in one step from a raw WebAuthn assertion. */
export function packWebAuthnSignature(args: {
  credentialIdBytes: Uint8Array
  authenticatorData: Uint8Array
  clientDataJSON: Uint8Array
  derSignature: Uint8Array
}): `0x${string}` {
  return encodeAssertionForValidator(buildPasskeyAssertion(args))
}

/**
 * Helper for contract callers: challenge is the 32-byte hash the smart
 * account expects the passkey to sign (UserOp hash, message hash, etc).
 * Returns the base64url-encoded challenge the browser should pass to
 * `navigator.credentials.get({ publicKey: { challenge } })`.
 */
export function hashToWebAuthnChallenge(hash: `0x${string}`): string {
  return base64urlEncode(toBytes(hash))
}
