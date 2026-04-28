/**
 * WebAuthn challenge derivation per design doc §8.2.
 *
 *   challenge = base64url( sha256( "SessionGrant:v1" || grantHash || serverNonce ) )
 *
 * The "SessionGrant:v1" prefix is a domain separator: a future
 * "WalletAction:v1" challenge cannot collide with this one.
 */

import { createHash } from 'node:crypto'
import type { SessionGrantV1 } from './types'
import { hashCanonical } from './canonicalize'

const DOMAIN_SEP = 'SessionGrant:v1'

/** Build the WebAuthn challenge bytes (raw, not base64-encoded). */
export function deriveSessionGrantChallengeBytes(
  grant: SessionGrantV1,
  serverNonce: string,
): Buffer {
  const grantHashHex = hashCanonical(grant as unknown as import('./canonicalize').Canonicalizable).slice(2)
  const h = createHash('sha256')
  h.update(DOMAIN_SEP, 'utf8')
  h.update(Buffer.from(grantHashHex, 'hex'))
  h.update(serverNonce, 'utf8')
  return h.digest()
}

/** Same challenge, base64url-encoded for transport / WebAuthn API. */
export function deriveSessionGrantChallenge(
  grant: SessionGrantV1,
  serverNonce: string,
): string {
  return base64url(deriveSessionGrantChallengeBytes(grant, serverNonce))
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
