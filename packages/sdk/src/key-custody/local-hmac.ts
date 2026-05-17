/**
 * Local-dev `KmsMacProvider` (K3-extension counterpart of `local-aes-provider.ts`).
 *
 * Implements the same `KmsMacProvider` interface as `aws-kms-mac.ts` but
 * uses Node's built-in `crypto.createHmac('sha256', secret)` so dev
 * iterations stay fast and offline. The hex-encoded secret is read from a
 * per-key env var named by the caller; the factory does NOT enumerate
 * variables, so accidental cross-binding between the eight MAC keys is
 * impossible.
 *
 * Refuses to instantiate when `NODE_ENV === 'production'` — same posture
 * as `createLocalAesProvider` (per `KMS-IMPLEMENTATION-PLAN.md` §3.1):
 * the dev shim must not silently land in a production deployment.
 *
 * The canonical-message contract is identical to the AWS provider — the
 * caller hands in `Uint8Array` bytes and gets back `Uint8Array` bytes. No
 * encoding is implied by this layer.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { KmsMacProvider } from './aws-kms-mac'

export interface LocalHmacEnv {
  /**
   * Per-key env var name (e.g. `WEB_TO_A2A_HMAC_KEY`,
   * `A2A_INTERSERVICE_HMAC_KEY_PERSON`). The value is read at construction
   * time from `process.env`-shaped input passed by the caller; the
   * factory does NOT touch `process.env` itself.
   */
  envKey: string

  /** Optional production-guard override (defaults to `process.env.NODE_ENV`). */
  NODE_ENV?: string

  /**
   * Object whose `[envKey]` property holds the hex-encoded secret. The
   * caller passes `process.env` or a test fixture. Letting the caller own
   * env resolution keeps the SDK package free of `process.env` reads.
   */
  env: Record<string, string | undefined>
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  if (clean.length % 2 !== 0) throw new Error('hex string has odd length')
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(clean.substring(i * 2, i * 2 + 2), 16)
    if (Number.isNaN(byte)) throw new Error('invalid hex character')
    out[i] = byte
  }
  return out
}

const LOCAL_KEY_ID = 'local-hmac'

/**
 * Build a `KmsMacProvider` whose secret is the hex-encoded env-var value
 * named by `envKey`. The same env-var-name mapping the legacy code paths
 * already use (`WEB_TO_A2A_HMAC_KEY`, `A2A_INTERSERVICE_HMAC_KEY_<MCP>`)
 * keeps `scripts/deploy-local.sh` unchanged for the local-aes path.
 *
 * @throws if `NODE_ENV === 'production'`, the env var is missing, or the
 *         secret can't be hex-decoded to ≥16 bytes.
 */
export function createLocalHmacProvider(input: LocalHmacEnv): KmsMacProvider {
  const nodeEnv = input.NODE_ENV ?? input.env.NODE_ENV
  if (nodeEnv === 'production') {
    throw new Error(
      "createLocalHmacProvider: refusing to instantiate the local-hmac dev shim in production. " +
        "Set A2A_KMS_BACKEND to 'aws-kms' and provision per-key KMS HMAC keys.",
    )
  }

  const rawSecret = input.env[input.envKey]
  if (!rawSecret) {
    throw new Error(
      `createLocalHmacProvider: required env var ${input.envKey} is missing`,
    )
  }

  let secretBytes: Uint8Array
  try {
    secretBytes = hexToBytes(rawSecret)
  } catch (err) {
    throw new Error(
      `createLocalHmacProvider: ${input.envKey} must be hex-encoded (${(err as Error).message})`,
    )
  }
  if (secretBytes.length < 16) {
    throw new Error(
      `createLocalHmacProvider: ${input.envKey} must decode to ≥16 bytes (got ${secretBytes.length})`,
    )
  }

  const secretBuf = Buffer.from(secretBytes)

  return {
    async generateMac({ canonicalMessage }) {
      const mac = createHmac('sha256', secretBuf)
        .update(canonicalMessage)
        .digest()
      return {
        mac: new Uint8Array(mac.buffer, mac.byteOffset, mac.byteLength),
        keyId: LOCAL_KEY_ID,
      }
    },
    async verifyMac({ canonicalMessage, mac }) {
      const expected = createHmac('sha256', secretBuf)
        .update(canonicalMessage)
        .digest()
      // `timingSafeEqual` throws if the buffers differ in length — short-
      // circuit to `false` instead so callers always get a boolean.
      if (expected.length !== mac.length) {
        return { valid: false, keyId: LOCAL_KEY_ID }
      }
      const macBuf = Buffer.from(mac)
      const valid = timingSafeEqual(expected, macBuf)
      return { valid, keyId: LOCAL_KEY_ID }
    },
  }
}
