/**
 * Custody backend contract. Implementations live in dev-pepper.ts (local)
 * and aws-kms.ts (production stub).
 *
 * Two operations:
 *   • deriveSigner(sessionId) → derives the secp256k1 session signer key
 *     via HKDF rooted at the master IKM. Returns address + signer fn.
 *     The private key lives in process memory only.
 *   • signWithDerivedSigner(sessionId, digest) → derive + sign + forget.
 *     Used by per-action paths.
 */

export interface DerivedSigner {
  address: `0x${string}`
  /** Sign a 32-byte digest. Returns 0x-prefixed hex with recovery byte. */
  sign(digest: `0x${string}`): Promise<`0x${string}`>
  /** Forget the in-memory key. Idempotent. */
  forget(): void
}

export interface CustodyBackend {
  /** Derive (and hold in memory) a session signer for `sessionId`. */
  deriveSigner(sessionId: string): Promise<DerivedSigner>
  /** Convenience: derive, sign, forget. */
  signWithDerivedSigner(sessionId: string, digest: `0x${string}`): Promise<{
    address: `0x${string}`
    signature: `0x${string}`
  }>
}
