/**
 * Out-of-band AES-256-GCM helpers (Sprint 5 W3 P1-3).
 *
 * The normal A2A session-package encryption path goes through
 * `A2AKeyProvider` (KMS migration K0+K1+K2): the provider mints a fresh
 * 32-byte data key bound to the canonical AAD context, the session
 * package is sealed with that key, and the data key itself is wrapped
 * for at-rest storage. Every step is auditable, every key has a
 * `keyId`/`keyVersion` tag, and the provider's startup gates keep the
 * runtime backend honest.
 *
 * The helpers in THIS module are for the out-of-band cases where that
 * machinery is the wrong shape:
 *
 *   - **Test fixtures** — unit tests that need a deterministic
 *     ciphertext from a hard-coded 32-byte key + canonical AAD.
 *   - **Proposal-body / off-chain content-hash binding** — the proposal
 *     marketplace lane wraps a body under a CALLER-SUPPLIED DEK so the
 *     ciphertext can be hashed and the hash bound on-chain; the DEK is
 *     distributed out-of-band by the proposer (it is NOT a session
 *     data key).
 *   - **Future migrations** — bulk re-wrap utilities that already hold
 *     the plaintext DEK from the old provider and need to re-seal under
 *     a new one without re-routing through `A2AKeyProvider`.
 *
 * These callers OWN the key lifecycle (including any zeroisation). The
 * helpers DO NOT zero the plaintext, DO NOT register a `keyId` /
 * `keyVersion`, and DO NOT touch the provider chain. They are the
 * lowest-level primitive available.
 *
 * AAD bytes SHOULD be `canonicalContextBytes(ctx)` from `./types.ts` so
 * the same canonicalisation rules apply (sort-stable, NUL-separated,
 * reserved-delimiter rejection). The helpers themselves treat AAD as an
 * opaque byte string.
 *
 * Crypto choice: WebCrypto (`crypto.subtle`) — same primitive
 * `crypto.ts`, `local-aes-provider.ts`, and every other `key-custody`
 * module use. No `node:crypto` import, no provider dependency.
 *
 * Substrate independence (P1): no Safe/Privy/MetaMask DTK calls — pure
 * AES-GCM via the WHATWG SubtleCrypto API.
 */

const ALGORITHM = 'AES-GCM'
const KEY_BYTES = 32
const IV_BYTES = 12
const AUTH_TAG_BYTES = 16

export interface RawAesEncryptInput {
  /**
   * Raw 32-byte AES-256 key. The caller owns this key — it is not
   * registered with any provider, has no `keyId` or `keyVersion`, and
   * the helper will not zeroise it after use.
   */
  rawKey: Uint8Array
  /**
   * Plaintext bytes. The helper will not zeroise on success or failure;
   * the caller is responsible for any wipe semantics.
   */
  plaintext: Uint8Array
  /**
   * Canonical AAD byte string. SHOULD be produced by
   * `canonicalContextBytes(ctx)` from `./types.ts` so a single shared
   * encoder eliminates a class of context-drift bugs. Treated as opaque
   * bytes by the helper.
   */
  aad: Uint8Array
}

export interface RawAesEncryptOutput {
  /** Fresh random 12-byte IV. */
  iv: Uint8Array
  /** Ciphertext WITHOUT the trailing GCM tag. */
  ciphertext: Uint8Array
  /** GCM authentication tag (16 bytes). */
  authTag: Uint8Array
}

export interface RawAesDecryptInput {
  rawKey: Uint8Array
  iv: Uint8Array
  ciphertext: Uint8Array
  authTag: Uint8Array
  aad: Uint8Array
}

function assertKeyLength(rawKey: Uint8Array, role: 'encrypt' | 'decrypt'): void {
  if (rawKey.length !== KEY_BYTES) {
    throw new Error(
      `${role === 'encrypt' ? 'encryptPayloadWithRawKey' : 'decryptPayloadWithRawKey'}: ` +
        `rawKey must be exactly ${KEY_BYTES} bytes (AES-256); got ${rawKey.length}`,
    )
  }
}

async function importRawAesKey(rawKey: Uint8Array, usage: KeyUsage): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    rawKey.buffer.slice(rawKey.byteOffset, rawKey.byteOffset + rawKey.byteLength) as ArrayBuffer,
    { name: ALGORITHM, length: KEY_BYTES * 8 },
    false,
    [usage],
  )
}

/**
 * Encrypt `plaintext` under `rawKey` with AES-256-GCM, binding `aad` into
 * the authentication tag.
 *
 * Throws synchronously with a clean error message if `rawKey.length !== 32`.
 *
 * Generates a fresh random 12-byte IV per call (WebCrypto `getRandomValues`).
 * The returned `ciphertext` does NOT include the trailing 16-byte GCM tag;
 * the tag is returned separately as `authTag` so callers can store /
 * transmit the three components however they like.
 */
export async function encryptPayloadWithRawKey(
  input: RawAesEncryptInput,
): Promise<RawAesEncryptOutput> {
  assertKeyLength(input.rawKey, 'encrypt')
  const key = await importRawAesKey(input.rawKey, 'encrypt')
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))

  const plaintextBuf = input.plaintext.buffer.slice(
    input.plaintext.byteOffset,
    input.plaintext.byteOffset + input.plaintext.byteLength,
  ) as ArrayBuffer
  const aadBuf = input.aad.buffer.slice(
    input.aad.byteOffset,
    input.aad.byteOffset + input.aad.byteLength,
  ) as ArrayBuffer

  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: ALGORITHM,
        iv: iv.buffer as ArrayBuffer,
        additionalData: aadBuf,
        tagLength: AUTH_TAG_BYTES * 8,
      } satisfies AesGcmParams,
      key,
      plaintextBuf,
    ),
  )

  // WebCrypto returns `ciphertext || authTag` — split them so callers
  // hold the components independently.
  const tagStart = sealed.length - AUTH_TAG_BYTES
  const ciphertext = sealed.slice(0, tagStart)
  const authTag = sealed.slice(tagStart)

  return { iv, ciphertext, authTag }
}

/**
 * Decrypt the `(iv, ciphertext, authTag)` triple under `rawKey` with
 * AES-256-GCM, verifying that `aad` matches what was bound at encrypt
 * time.
 *
 * Throws synchronously with a clean error message when:
 *   - `rawKey.length !== 32`
 *   - `iv.length !== 12`
 *   - `authTag.length !== 16`
 *
 * On a tag-verification failure (wrong key, tampered ciphertext,
 * mismatched AAD, wrong IV) throws `"AES-GCM authentication failed"`.
 * The underlying WebCrypto error is intentionally NOT surfaced — its
 * shape varies across runtimes and may leak length/oracle hints.
 */
export async function decryptPayloadWithRawKey(
  input: RawAesDecryptInput,
): Promise<Uint8Array> {
  assertKeyLength(input.rawKey, 'decrypt')
  if (input.iv.length !== IV_BYTES) {
    throw new Error(
      `decryptPayloadWithRawKey: iv must be exactly ${IV_BYTES} bytes; got ${input.iv.length}`,
    )
  }
  if (input.authTag.length !== AUTH_TAG_BYTES) {
    throw new Error(
      `decryptPayloadWithRawKey: authTag must be exactly ${AUTH_TAG_BYTES} bytes; got ${input.authTag.length}`,
    )
  }

  const key = await importRawAesKey(input.rawKey, 'decrypt')

  // WebCrypto wants `ciphertext || authTag` concatenated.
  const sealed = new Uint8Array(input.ciphertext.length + input.authTag.length)
  sealed.set(input.ciphertext, 0)
  sealed.set(input.authTag, input.ciphertext.length)

  const aadBuf = input.aad.buffer.slice(
    input.aad.byteOffset,
    input.aad.byteOffset + input.aad.byteLength,
  ) as ArrayBuffer

  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: ALGORITHM,
        iv: input.iv.buffer.slice(input.iv.byteOffset, input.iv.byteOffset + input.iv.byteLength) as ArrayBuffer,
        additionalData: aadBuf,
        tagLength: AUTH_TAG_BYTES * 8,
      } satisfies AesGcmParams,
      key,
      sealed.buffer as ArrayBuffer,
    )
    return new Uint8Array(plaintext)
  } catch {
    throw new Error('AES-GCM authentication failed')
  }
}
