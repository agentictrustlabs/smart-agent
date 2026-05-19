/**
 * Spec 007 Phase G.3 — canonical inter-service MAC payload builder.
 *
 * Single source of truth for the inter-service HMAC wire format. Every
 * a2a-agent ↔ MCP hop (web → a2a, a2a → person, a2a → org, a2a → hub,
 * a2a → people-group, a2a → family, a2a → geo, a2a → verifier, a2a →
 * skill) signs and verifies the same canonical string. Before this
 * helper existed, each side had its own copy — drift between sender
 * and verifier was a recurring source of "signature mismatch" bugs
 * that ate hours.
 *
 * Canonical-v2:
 *
 *     `${timestamp}|${nonce}|${path}|${sha256hex(body)}`
 *
 * Every binding (timestamp, fresh per-request nonce, request path,
 * body-hash) lives INSIDE the signed message because KMS HMAC keys do
 * not support EncryptionContext (see `KMS-IMPLEMENTATION-PLAN.md` §13).
 * The legacy `${body}:${ts}:${sessionId}` canonical was replay-vulnerable
 * because the nonce was carried in the header but never bound into the
 * MAC; sessionId is still indirectly bound through `path` (every inter-
 * service route is mounted under `/session/:id/<verb>`).
 *
 * Body hashing: SHA-256 over the raw bytes received off the wire — never
 * a re-stringification of a parsed object, or the signature won't match.
 *
 * This module is platform-agnostic — uses `@noble/hashes/sha256` so it
 * works in Node, Bun, browsers, and Edge runtimes. (The Node `crypto`
 * module is also available, but importing it would tie the SDK to Node.)
 */

import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'

/** Hex SHA-256 of the raw body bytes — bound into the canonical string. */
export function sha256Hex(bodyRaw: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(bodyRaw)))
}

/**
 * Build the canonical-v2 message as a UTF-8 string. Use for debugging
 * or when feeding into a stringly-typed signing API.
 */
export function buildCanonicalMacMessage(
  timestamp: number | string,
  nonce: string,
  path: string,
  bodyRaw: string,
): string {
  return `${timestamp}|${nonce}|${path}|${sha256Hex(bodyRaw)}`
}

/**
 * Build the canonical-v2 message as the byte vector that gets passed
 * to a MAC provider's `generateMac` / `verifyMac` primitive. Identical
 * bytes to `new TextEncoder().encode(buildCanonicalMacMessage(...))`.
 */
export function buildCanonicalMacBytes(
  timestamp: number | string,
  nonce: string,
  path: string,
  bodyRaw: string,
): Uint8Array {
  return new TextEncoder().encode(buildCanonicalMacMessage(timestamp, nonce, path, bodyRaw))
}

/**
 * Convenience wrapper for callers that already have a MAC provider with
 * `verifyMac({ canonicalMessage, mac })`. Builds the canonical-v2 bytes
 * from `(ts, nonce, path, body)` and delegates verification to the
 * provider. Returns the provider's `valid` boolean directly.
 */
export interface CanonicalMacVerifyInput {
  timestamp: number | string
  nonce: string
  path: string
  bodyRaw: string
  mac: Uint8Array
}

export interface CanonicalMacVerifier {
  verifyMac(input: { canonicalMessage: Uint8Array; mac: Uint8Array }): Promise<{ valid: boolean }>
}

export async function verifyCanonicalMac(
  provider: CanonicalMacVerifier,
  input: CanonicalMacVerifyInput,
): Promise<boolean> {
  const canonicalMessage = buildCanonicalMacBytes(input.timestamp, input.nonce, input.path, input.bodyRaw)
  const { valid } = await provider.verifyMac({ canonicalMessage, mac: input.mac })
  return valid
}

/**
 * Convenience wrapper for callers that need to generate a MAC. Builds
 * the canonical-v2 bytes from `(ts, nonce, path, body)` and delegates
 * signing to the provider.
 */
export interface CanonicalMacSigner {
  generateMac(input: { canonicalMessage: Uint8Array }): Promise<{ mac: Uint8Array }>
}

export interface CanonicalMacSignInput {
  timestamp: number | string
  nonce: string
  path: string
  bodyRaw: string
}

export async function generateCanonicalMac(
  provider: CanonicalMacSigner,
  input: CanonicalMacSignInput,
): Promise<Uint8Array> {
  const canonicalMessage = buildCanonicalMacBytes(input.timestamp, input.nonce, input.path, input.bodyRaw)
  const { mac } = await provider.generateMac({ canonicalMessage })
  return mac
}
