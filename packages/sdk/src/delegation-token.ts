/**
 * Delegation Token
 *
 * Mints and verifies delegation tokens for A2A agent → MCP server
 * communication. Security comes from two layers:
 *
 *   Layer 1: Session key ECDSA signature over canonical claims
 *            (proves the session key holder authorized this token)
 *   Layer 2: On-chain ERC-1271 verification of the delegation signature
 *            (proves the root account authorized the session key)
 *
 * No shared secrets between A2A and MCP. The MCP server verifies
 * the token using only cryptographic proofs and on-chain state.
 *
 * See docs/agents/security.md for the full threat model.
 */

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
  v: 3
  /** Token type URN */
  typ: 'urn:smart-agent:mcp-delegation-envelope'
  /** Algorithm — session ECDSA only (no HMAC) */
  alg: 'session-ecdsa'
  /** Claims */
  claims: DelegationTokenClaims
  /** Session key ECDSA signature over canonical claims string */
  sessionSignature: `0x${string}`
}

// ---------------------------------------------------------------------------
// Canonical String
// ---------------------------------------------------------------------------

/**
 * Build canonical string representation of claims for signing.
 * Deterministic serialization — no JSON.stringify (key order matters).
 * The session ECDSA signature covers this entire string.
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
    `sig=${claims.delegation.signature}`,
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
 * @param signMessage - Signs with the session key (returns 0x-prefixed sig)
 * @returns Encoded token string (base64url JSON)
 */
export async function mintDelegationToken(
  claims: DelegationTokenClaims,
  signMessage: (message: string) => Promise<`0x${string}`>,
): Promise<{ envelope: DelegationTokenEnvelope; token: string }> {
  const canonical = claimsCanonicalString(claims)
  const sessionSignature = await signMessage(canonical)

  const envelope: DelegationTokenEnvelope = {
    v: 3,
    typ: 'urn:smart-agent:mcp-delegation-envelope',
    alg: 'session-ecdsa',
    claims,
    sessionSignature,
  }

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
 * Verify a delegation token.
 *
 * Checks:
 *   1. Session key ECDSA — recovers signer, must match claims.sessionKeyAddress
 *   2. delegate == sessionKeyAddress
 *   3. Token not expired
 *
 * The consumer must ALSO verify on-chain:
 *   - ERC-1271 on delegator (proves delegation was signed by root account)
 *   - DelegationManager.isRevoked() (proves delegation not revoked)
 *   - Caveat enforcement (timestamp bounds, tool scope, etc.)
 *
 * @param token - Base64url-encoded token string
 * @param recoverAddress - Recovers signer address from (message, signature)
 */
export async function verifyDelegationToken(
  token: string,
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

  if (envelope.typ !== 'urn:smart-agent:mcp-delegation-envelope') {
    return { valid: false, error: 'Invalid token type' }
  }

  // Accept both v2 (legacy with HMAC) and v3 (ECDSA only)
  if (envelope.v !== 3 && envelope.v !== 2) {
    return { valid: false, error: 'Unsupported token version' }
  }

  const { claims, sessionSignature } = envelope
  const canonical = claimsCanonicalString(claims)

  // Verify session key ECDSA
  let recoveredAddress: `0x${string}`
  try {
    recoveredAddress = await recoverAddress(canonical, sessionSignature)
  } catch {
    return { valid: false, error: 'Session signature recovery failed' }
  }

  if (recoveredAddress.toLowerCase() !== claims.sessionKeyAddress.toLowerCase()) {
    return { valid: false, error: 'Session key address mismatch' }
  }

  if (claims.delegation.delegate.toLowerCase() !== claims.sessionKeyAddress.toLowerCase()) {
    return { valid: false, error: 'Delegation delegate does not match session key' }
  }

  if (new Date(claims.expiresAtISO) < new Date()) {
    return { valid: false, error: 'Token expired' }
  }

  return {
    valid: true,
    claims,
    sessionKeyAddress: recoveredAddress,
  }
}
