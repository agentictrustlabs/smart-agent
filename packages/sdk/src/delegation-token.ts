/**
 * Dual-Signed Delegation Token
 *
 * Mints and verifies delegation tokens for A2A agent → MCP server
 * communication. Each token has three security layers:
 *
 *   Layer 1: On-chain delegation data (EIP-712 signed by root account owner)
 *   Layer 2: Session key ECDSA signature (proves session key holder authorized)
 *   Layer 3: HMAC-SHA256 integrity seal (proves token not tampered)
 *
 * See docs/agents/security.md for the full threat model.
 */

import type { Delegation } from '@smart-agent/types'
import { hmacSign, hmacVerify } from './crypto'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DelegationTokenClaims {
  /** Version */
  v: 1
  /** Issuer (the A2A agent) */
  iss: string
  /** Audience (the target MCP server) */
  aud: string
  /** Subject (the principal smart account address) */
  sub: `0x${string}`
  /** Chain ID */
  chainId: number
  /** The on-chain delegation */
  delegation: {
    delegator: `0x${string}`
    delegate: `0x${string}`
    authority: `0x${string}`
    caveats: Array<{ enforcer: `0x${string}`; terms: `0x${string}` }>
    salt: string
    signature: `0x${string}`
  }
  /** Session key address (should match delegation.delegate) */
  sessionKeyAddress: `0x${string}`
  /** Issued timestamp (ISO) */
  issuedAtISO: string
  /** Expiry timestamp (ISO) */
  expiresAtISO: string
  /** Unique token ID for usage tracking */
  jti: string
  /** Max number of times this token can be used */
  usageLimit: number
}

export interface DelegationTokenEnvelope {
  /** Envelope version */
  v: 2
  /** Token type URN */
  typ: 'urn:smart-agent:mcp-delegation-envelope'
  /** Algorithm description */
  alg: 'session-ecdsa+hmac-sha256'
  /** Claims */
  claims: DelegationTokenClaims
  /** Session key ECDSA signature over canonical claims string */
  sessionSignature: `0x${string}`
  /** HMAC-SHA256 over canonical claims + sessionSignature */
  issuerSignature: string
}

// ---------------------------------------------------------------------------
// Canonical String
// ---------------------------------------------------------------------------

/**
 * Build canonical string representation of claims for signing.
 * Deterministic serialization — no JSON.stringify (key order matters).
 */
export function claimsCanonicalString(claims: DelegationTokenClaims): string {
  return [
    `v=${claims.v}`,
    `iss=${claims.iss}`,
    `aud=${claims.aud}`,
    `sub=${claims.sub}`,
    `chainId=${claims.chainId}`,
    `delegator=${claims.delegation.delegator}`,
    `delegate=${claims.delegation.delegate}`,
    `authority=${claims.delegation.authority}`,
    `salt=${claims.delegation.salt}`,
    `sessionKey=${claims.sessionKeyAddress}`,
    `iat=${claims.issuedAtISO}`,
    `exp=${claims.expiresAtISO}`,
    `jti=${claims.jti}`,
    `usageLimit=${claims.usageLimit}`,
  ].join('|')
}

// ---------------------------------------------------------------------------
// Mint
// ---------------------------------------------------------------------------

/**
 * Mint a delegation token.
 *
 * @param claims - Token claims
 * @param signMessage - Function that signs a message with the session key (returns 0x-prefixed sig)
 * @param hmacSecret - Hex-encoded HMAC secret shared with the MCP server
 * @returns Encoded token string (base64url JSON)
 */
export async function mintDelegationToken(
  claims: DelegationTokenClaims,
  signMessage: (message: string) => Promise<`0x${string}`>,
  hmacSecret: string,
): Promise<{ envelope: DelegationTokenEnvelope; token: string }> {
  const canonical = claimsCanonicalString(claims)

  // Layer 2: Session key ECDSA
  const sessionSignature = await signMessage(canonical)

  // Layer 3: HMAC over (canonical + sessionSignature)
  const hmacPayload = `${canonical}|sig=${sessionSignature}`
  const issuerSignature = await hmacSign(hmacPayload, hmacSecret)

  const envelope: DelegationTokenEnvelope = {
    v: 2,
    typ: 'urn:smart-agent:mcp-delegation-envelope',
    alg: 'session-ecdsa+hmac-sha256',
    claims,
    sessionSignature,
    issuerSignature,
  }

  // Encode as base64url JSON
  const json = JSON.stringify(envelope)
  const token = btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  return { envelope, token }
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

export interface DelegationTokenVerification {
  valid: boolean
  error?: string
  claims?: DelegationTokenClaims
  sessionKeyAddress?: `0x${string}`
}

/**
 * Verify a delegation token's integrity and signatures.
 *
 * This verifies Layer 2 (HMAC) and Layer 3 (session ECDSA recovery).
 * Layer 1 (on-chain ERC-1271) must be verified separately by the consumer
 * by calling AgentAccount.isValidSignature() on the delegator.
 *
 * @param token - Base64url-encoded token string
 * @param hmacSecret - Hex-encoded HMAC secret
 * @param recoverAddress - Function that recovers signer address from (message, signature)
 */
export async function verifyDelegationToken(
  token: string,
  hmacSecret: string,
  recoverAddress: (message: string, signature: `0x${string}`) => Promise<`0x${string}`>,
): Promise<DelegationTokenVerification> {
  // Decode
  let envelope: DelegationTokenEnvelope
  try {
    const base64 = token.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const json = decodeURIComponent(escape(atob(padded)))
    envelope = JSON.parse(json) as DelegationTokenEnvelope
  } catch {
    return { valid: false, error: 'Invalid token encoding' }
  }

  if (envelope.v !== 2 || envelope.typ !== 'urn:smart-agent:mcp-delegation-envelope') {
    return { valid: false, error: 'Invalid token type or version' }
  }

  const { claims, sessionSignature, issuerSignature } = envelope
  const canonical = claimsCanonicalString(claims)

  // Verify Layer 3: HMAC
  const hmacPayload = `${canonical}|sig=${sessionSignature}`
  const hmacValid = await hmacVerify(hmacPayload, issuerSignature, hmacSecret)
  if (!hmacValid) {
    return { valid: false, error: 'HMAC verification failed' }
  }

  // Verify Layer 2: Session key ECDSA
  let recoveredAddress: `0x${string}`
  try {
    recoveredAddress = await recoverAddress(canonical, sessionSignature)
  } catch {
    return { valid: false, error: 'Session signature recovery failed' }
  }

  if (recoveredAddress.toLowerCase() !== claims.sessionKeyAddress.toLowerCase()) {
    return { valid: false, error: 'Session key address mismatch' }
  }

  // Check delegation.delegate matches session key
  if (claims.delegation.delegate.toLowerCase() !== claims.sessionKeyAddress.toLowerCase()) {
    return { valid: false, error: 'Delegation delegate does not match session key' }
  }

  // Check expiry
  if (new Date(claims.expiresAtISO) < new Date()) {
    return { valid: false, error: 'Token expired' }
  }

  return {
    valid: true,
    claims,
    sessionKeyAddress: recoveredAddress,
  }
}
