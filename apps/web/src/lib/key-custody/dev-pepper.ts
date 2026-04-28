/**
 * Dev key custody: master IKM derived from SERVER_PEPPER.
 *
 * Documented as weaker than production custody (no HSM); pen-test
 * scenarios bypass this path. Master IKM is computed once at process
 * start and held in module-scope; a new SERVER_PEPPER value invalidates
 * every existing session.
 */

import { createHmac, createHash, randomUUID } from 'node:crypto'
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import type { CustodyBackend, DerivedSigner } from './types'

const HKDF_INFO = Buffer.from('smart-agent.session-signer.v1', 'utf8')

let _masterIkm: Buffer | null = null
function getMasterIkm(): Buffer {
  if (_masterIkm) return _masterIkm
  const pepper = process.env.SERVER_PEPPER
  if (!pepper) throw new Error('SERVER_PEPPER required for dev-pepper key custody')
  // master IKM = sha256("smart-agent.master-key.v1" || SERVER_PEPPER)
  _masterIkm = createHash('sha256')
    .update('smart-agent.master-key.v1', 'utf8')
    .update(pepper, 'utf8')
    .digest()
  return _masterIkm
}

/** HKDF-SHA256 — RFC 5869 Extract + Expand. */
function hkdfSha256(ikm: Buffer, salt: Buffer, info: Buffer, length: number): Buffer {
  // Extract: HMAC(salt, ikm)
  const prk = createHmac('sha256', salt.length === 0 ? Buffer.alloc(32) : salt).update(ikm).digest()
  // Expand: T(1) = HMAC(prk, info || 0x01); T(i) = HMAC(prk, T(i-1) || info || 0xi)
  const out = Buffer.alloc(length)
  let t = Buffer.alloc(0)
  let off = 0
  for (let i = 1; off < length; i++) {
    const h = createHmac('sha256', prk)
    h.update(t)
    h.update(info)
    h.update(Buffer.from([i]))
    t = h.digest()
    const slice = t.subarray(0, Math.min(t.length, length - off))
    slice.copy(out, off)
    off += slice.length
  }
  return out
}

function deriveSecp256k1KeyBytes(sessionId: string): Buffer {
  const ikm = getMasterIkm()
  const salt = Buffer.from(sessionId, 'utf8')
  // secp256k1 private keys are 32 bytes; we derive 32 + 1 and reduce to
  // [1, n-1] by retrying if necessary. In practice the chance of needing
  // a retry is negligible (~2^-128); we still bound the loop.
  for (let bump = 0; bump < 8; bump++) {
    const info = bump === 0
      ? HKDF_INFO
      : Buffer.concat([HKDF_INFO, Buffer.from([bump])])
    const candidate = hkdfSha256(ikm, salt, info, 32)
    // Validate by attempting to parse as a private key. viem will throw
    // on out-of-range values (zero or ≥ n).
    try {
      const hex = ('0x' + candidate.toString('hex')) as `0x${string}`
      privateKeyToAccount(hex)
      return candidate
    } catch { /* retry with bump */ }
  }
  throw new Error('hkdf: failed to derive valid secp256k1 key after 8 attempts')
}

class InMemorySigner implements DerivedSigner {
  private account: PrivateKeyAccount | null
  readonly address: `0x${string}`

  constructor(privateKey: Buffer) {
    const hex = ('0x' + privateKey.toString('hex')) as `0x${string}`
    this.account = privateKeyToAccount(hex)
    this.address = this.account.address
  }

  async sign(digest: `0x${string}`): Promise<`0x${string}`> {
    if (!this.account) throw new Error('signer forgotten')
    return this.account.sign({ hash: digest })
  }

  forget(): void {
    this.account = null
  }
}

export function devPepperBackend(): CustodyBackend {
  return {
    async deriveSigner(sessionId) {
      const keyBytes = deriveSecp256k1KeyBytes(sessionId)
      return new InMemorySigner(keyBytes)
    },
    async signWithDerivedSigner(sessionId, digest) {
      const signer = new InMemorySigner(deriveSecp256k1KeyBytes(sessionId))
      try {
        const signature = await signer.sign(digest)
        return { address: signer.address, signature }
      } finally {
        signer.forget()
      }
    },
  }
}

/** Convenience: generate a fresh sessionId. */
export function newSessionId(): string {
  return randomUUID()
}
