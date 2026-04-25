import { verifyJwt } from './jwt'

/** Verify a (token, challenge) pair came from /api/auth/passkey-challenge. */
export function verifyPasskeyChallenge(token: string, expectedChallenge: string): boolean {
  const claims = verifyJwt(token)
  if (!claims) return false
  if (claims.kind !== 'passkey-challenge') return false
  return claims.challenge === expectedChallenge
}

/** Verify a SIWE challenge token + nonce. */
export function verifySiweChallengeToken(token: string, expectedNonce: string): boolean {
  const claims = verifyJwt(token)
  if (!claims) return false
  if (claims.kind !== 'passkey-challenge') return false
  if (claims.sub !== 'siwe-challenge') return false
  return claims.challenge === expectedNonce
}
