/**
 * Key custody for session signers.
 *
 * Per design doc §8.4: one environment-wide master key (in KMS for
 * production, derived from SERVER_PEPPER for dev). Session signers are
 * HKDF-derived in process; never stored.
 *
 *   masterIkm  = master.getIkm()                  // KMS round-trip in prod
 *   sessionKey = HKDF-SHA256(
 *     ikm  = masterIkm,
 *     salt = sessionId,
 *     info = "smart-agent.session-signer.v1",
 *     L    = 32 bytes,
 *   )
 *   signerAddress = secp256k1.publicKey(sessionKey).toEthereumAddress()
 *
 * Implementation: dev-pepper for local, aws-kms stub for production.
 * Selection via SESSION_SIGNER_BACKEND env (defaults to 'dev-pepper').
 */

import type { CustodyBackend } from './types'
import { devPepperBackend } from './dev-pepper'
import { awsKmsBackend } from './aws-kms'

let _custody: CustodyBackend | null = null

export function getKeyCustody(): CustodyBackend {
  if (_custody) return _custody
  const which = process.env.SESSION_SIGNER_BACKEND ?? 'dev-pepper'
  if (which === 'aws-kms') {
    _custody = awsKmsBackend()
  } else {
    _custody = devPepperBackend()
  }
  return _custody
}

export type { CustodyBackend, DerivedSigner } from './types'
