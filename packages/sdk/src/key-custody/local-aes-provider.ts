/**
 * Local-dev `A2AKeyProvider` (K1).
 *
 * Per `KMS-IMPLEMENTATION-PLAN.md` §3.1: per-row HKDF over
 * `(env.A2A_SESSION_SECRET, randomSalt, canonicalContextBytes(aadContext))`.
 *
 * Why per-row HKDF and not a single shared CryptoKey:
 *   - Deterministic HKDF over `(secret, context)` alone is brittle: an
 *     attacker who steals the env secret can pre-compute every session's
 *     data key from the row's metadata.
 *   - Adding 16 bytes of fresh per-row salt means stealing the env secret
 *     no longer yields the data keys without also stealing the database.
 *     Strictly weaker than AWS KMS (because the secret + DB is enough);
 *     strictly stronger than today's single-CryptoKey path (which only
 *     needs the env secret).
 *
 * The wrapped form (`encryptedDataKey`) is the 16-byte random salt. Decrypt
 * re-derives the data key by running HKDF over the same `(ikm, salt, info)`.
 *
 * `keyId='local'`, `keyVersion='local-v1'`. The startup check in
 * `apps/a2a-agent/src/auth/key-provider.ts` refuses to instantiate this
 * provider when `NODE_ENV === 'production'`.
 */
import type { A2AKeyProvider } from './types'
import { canonicalContextBytes } from './types'

const HKDF_HASH = 'SHA-256'
const DATA_KEY_BYTES = 32
const SALT_BYTES = 16
const KEY_ID = 'local'
const KEY_VERSION = 'local-v1'

export interface LocalAesProviderEnv {
  /**
   * Hex-encoded session secret. Must be ≥32 bytes after hex decode (64+
   * hex chars). Source of HKDF input keying material — the env var that
   * gets removed in production once K2 lands.
   */
  A2A_SESSION_SECRET: string
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

async function hkdfDeriveKey(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array): Promise<Uint8Array> {
  const ikmKey = await crypto.subtle.importKey(
    'raw',
    ikm.buffer.slice(ikm.byteOffset, ikm.byteOffset + ikm.byteLength) as ArrayBuffer,
    { name: 'HKDF' },
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: HKDF_HASH,
      salt: salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer,
      info: info.buffer.slice(info.byteOffset, info.byteOffset + info.byteLength) as ArrayBuffer,
    },
    ikmKey,
    DATA_KEY_BYTES * 8,
  )
  return new Uint8Array(bits)
}

/**
 * Create a local-dev `A2AKeyProvider`.
 *
 * Throws synchronously if `A2A_SESSION_SECRET` is missing or shorter than
 * 32 bytes after hex decode. The check matches the existing `requireSecret`
 * gate in `apps/a2a-agent/src/config.ts:25-34` so any value that already
 * boots a2a-agent today also satisfies this provider.
 */
export function createLocalAesProvider(env: LocalAesProviderEnv): A2AKeyProvider {
  const raw = env.A2A_SESSION_SECRET
  if (!raw) {
    throw new Error('createLocalAesProvider: A2A_SESSION_SECRET is required')
  }
  let ikm: Uint8Array
  try {
    ikm = hexToBytes(raw)
  } catch (err) {
    throw new Error(`createLocalAesProvider: A2A_SESSION_SECRET must be hex-encoded (${(err as Error).message})`)
  }
  if (ikm.length < 32) {
    throw new Error(
      `createLocalAesProvider: A2A_SESSION_SECRET must decode to ≥32 bytes (got ${ikm.length})`,
    )
  }

  return {
    keyVersion: KEY_VERSION,
    async generateSessionDataKey({ aadContext }) {
      const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
      const info = canonicalContextBytes(aadContext)
      const dataKey = await hkdfDeriveKey(ikm, salt, info)
      return {
        plaintextDataKey: dataKey,
        encryptedDataKey: salt,
        keyId: KEY_ID,
        keyVersion: KEY_VERSION,
      }
    },

    async decryptSessionDataKey({ encryptedDataKey, aadContext, keyId, keyVersion }) {
      if (keyId !== KEY_ID) {
        throw new Error(`local-aes provider: keyId mismatch (expected '${KEY_ID}', got '${keyId}')`)
      }
      if (keyVersion !== KEY_VERSION) {
        throw new Error(
          `local-aes provider: keyVersion mismatch (expected '${KEY_VERSION}', got '${keyVersion}')`,
        )
      }
      if (encryptedDataKey.length !== SALT_BYTES) {
        throw new Error(
          `local-aes provider: encryptedDataKey must be ${SALT_BYTES} bytes (got ${encryptedDataKey.length})`,
        )
      }
      const info = canonicalContextBytes(aadContext)
      return await hkdfDeriveKey(ikm, encryptedDataKey, info)
    },
  }
}
