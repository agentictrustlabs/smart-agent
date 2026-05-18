/**
 * Key custody for session signers.
 *
 * Per design doc §8.4 + Sprint S1.1: production uses an AWS KMS asymmetric
 * key (one shared CMK across all sessions, address derived once at first
 * use); local dev derives session keys from `SERVER_PEPPER` via HKDF.
 *
 *   dev-pepper:
 *     masterIkm  = sha256("smart-agent.master-key.v1" || SERVER_PEPPER)
 *     sessionKey = HKDF-SHA256(masterIkm, sessionId,
 *                              "smart-agent.session-signer.v1", 32)
 *     signer.address = secp256k1.publicKey(sessionKey).toEthereumAddress()
 *
 *   aws-kms:
 *     signer.address = keccak256(kms:GetPublicKey()).slice(-20)
 *     signature      = kms:Sign(MessageType=DIGEST, ECDSA_SHA_256)
 *                      → DER-decode → low-s normalize → recover-id probe
 *                      → r||s||v (v = recovery + 27)
 *
 * Selection via `SESSION_SIGNER_BACKEND` env (defaults to `dev-pepper`).
 *
 * Production guard (S1.4): `NODE_ENV=production` + `dev-pepper` is a
 * hard failure at first `getKeyCustody()` call. Production MUST use a
 * KMS backend; HKDF-from-SERVER_PEPPER is dev-only. The guard runs in the
 * factory rather than at module load so test setups that swap NODE_ENV
 * mid-process (see `__tests__/index.test.ts`) get the expected behavior.
 */

import type { CustodyBackend } from './types'
import { devPepperBackend } from './dev-pepper'
import { awsKmsBackend } from './aws-kms'

let _custody: CustodyBackend | null = null

/**
 * Test-only hook to reset the memoized backend. Production code MUST NOT
 * call this — every request handler that grabs a custody backend assumes
 * the same instance lives for the process lifetime.
 */
export function _resetKeyCustodyForTests(): void {
  _custody = null
}

export function getKeyCustody(): CustodyBackend {
  if (_custody) return _custody
  const which = process.env.SESSION_SIGNER_BACKEND ?? 'dev-pepper'
  if (which === 'aws-kms') {
    _custody = awsKmsBackend()
    return _custody
  }
  if (which === 'dev-pepper') {
    // S1.4 — production-safety guard. Dev-pepper derives keys from
    // SERVER_PEPPER via HKDF; this is documented-weaker custody and is
    // forbidden in production. The boot must fail loudly here rather
    // than silently fall back to a key derived from a non-HSM secret.
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'SESSION_SIGNER_BACKEND=dev-pepper is forbidden in production. ' +
          'Set SESSION_SIGNER_BACKEND=aws-kms and provision ' +
          'AWS_REGION / AWS_ROLE_ARN / AWS_WEB_SESSION_SIGNER_KEY_ID. ' +
          'See docs/operations/kms-signer-setup.md § "Web session-grant signer key (S1.1)".',
      )
    }
    _custody = devPepperBackend()
    return _custody
  }
  throw new Error(
    `unknown SESSION_SIGNER_BACKEND=${JSON.stringify(which)} ` +
      '(expected "aws-kms" or "dev-pepper")',
  )
}

export type { CustodyBackend, DerivedSigner } from './types'
