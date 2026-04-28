/**
 * AWS KMS-backed master IKM stub.
 *
 * Production sketch: master key is an asymmetric ECC_NIST_P256 key in
 * KMS with a `Sign` permission attached to the signing service IAM
 * role. The IKM we feed into HKDF is the deterministic signature of a
 * fixed seed — this gives us a non-extractable root that the application
 * can use to derive session signers without ever seeing the master
 * private bytes.
 *
 * NOT WIRED YET. Returns a stub that throws on use until AWS_KMS_KEY_ID
 * is configured and the AWS SDK is installed. Production cutover lives
 * in M5; M1 lands the dev-pepper path only.
 */

import type { CustodyBackend } from './types'

export function awsKmsBackend(): CustodyBackend {
  const keyId = process.env.AWS_KMS_KEY_ID
  if (!keyId) {
    return {
      async deriveSigner() {
        throw new Error('aws-kms backend selected but AWS_KMS_KEY_ID not set')
      },
      async signWithDerivedSigner() {
        throw new Error('aws-kms backend selected but AWS_KMS_KEY_ID not set')
      },
    }
  }
  // TODO M5: wire AWS SDK. Sketch:
  //   const kms = new KMSClient({ ... })
  //   const ikm = await kms.send(new SignCommand({
  //     KeyId: keyId,
  //     Message: Buffer.from('smart-agent.master-ikm-seed.v1', 'utf8'),
  //     MessageType: 'RAW',
  //     SigningAlgorithm: 'ECDSA_SHA_256',
  //   }))
  //   then HKDF(ikm.Signature, sessionId, "smart-agent.session-signer.v1", 32)
  throw new Error('aws-kms backend not yet implemented (deferred to M5 production cutover)')
}
