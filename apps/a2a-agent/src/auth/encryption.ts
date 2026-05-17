/**
 * Session-package envelope encryption (KMS migration K0+K1 / §5 of
 * KMS-IMPLEMENTATION-PLAN.md).
 *
 * This is the ONLY module in a2a-agent that calls `@smart-agent/sdk`'s
 * `encryptPayload` / `decryptPayload`. Every route gets here via
 * `encryptSessionPackage` / `decryptSessionPackage`.
 *
 * Invariants enforced by this file:
 *   1. Every encrypt uses a freshly-generated data key (no caching).
 *   2. Every decrypt rebuilds the aadContext from sessionMeta and passes
 *      it to BOTH the KMS provider (KMS-side AAD / EncryptionContext) and
 *      AES-GCM (cipher-side AAD via `buildSessionAAD`). Either mismatch
 *      causes a hard failure — two independent trip-wires.
 *   3. Plaintext data keys live in heap only for the duration of the
 *      call; we zeroise them in a finally block.
 *   4. The legacy decrypt path (`keyVersion === 'legacy'`) routes through
 *      `config.A2A_SESSION_SECRET` directly — the rollback safety net for
 *      pre-K3 rows. Stays alive in this PR; removed T+30 days post-K3
 *      cutover (plan §7).
 */
import {
  encryptPayload,
  decryptPayload,
  buildSessionAAD,
  type EncryptedPayload,
} from '@smart-agent/sdk'
import type { A2AKeyProvider } from '@smart-agent/sdk/key-custody'
import { buildKeyProvider } from './key-provider'

/** Lazy singleton — instantiated on first use so tests can set env before import. */
let providerSingleton: A2AKeyProvider | null = null
function getProvider(): A2AKeyProvider {
  if (!providerSingleton) {
    providerSingleton = buildKeyProvider(process.env as NodeJS.ProcessEnv)
  }
  return providerSingleton
}

/**
 * Test hook — reset the cached provider so a test can mutate
 * `process.env.A2A_KMS_BACKEND` and re-instantiate. NOT for production use.
 */
export function __resetKeyProviderForTests(): void {
  providerSingleton = null
}

/**
 * Test hook — inject a custom provider (e.g. for capturing the
 * `plaintextDataKey` reference to assert the helper zeroises it in
 * `finally`). NOT for production use.
 */
export function __setKeyProviderForTests(provider: A2AKeyProvider): void {
  providerSingleton = provider
}

export interface SessionMeta {
  sessionId: string
  accountAddress: string
  chainId: number
  expiresAt: string
}

export interface EncryptedSessionRow {
  /** base64url ciphertext for `sessions.encrypted_package`. */
  ciphertext: string
  /** base64url AES-GCM IV for `sessions.iv`. */
  iv: string
  /** base64 of provider.encryptedDataKey for `sessions.encrypted_data_key`. */
  encryptedDataKey: string
  /** `sessions.key_version` — provider tag. */
  keyVersion: string
  /** `sessions.kms_key_id` — informational KMS keyId/ARN at encrypt time. */
  kmsKeyId: string
}

interface DecryptableRow {
  encryptedPackage: string | null
  iv: string | null
  encryptedDataKey: string | null
  keyVersion: string
  kmsKeyId: string | null
}

/**
 * Build the KMS-layer aadContext bound to this session's metadata.
 *
 * Includes (sessionId, accountAddress, chainId, expiresAt). `keyVersion`
 * is NOT included here — for local-aes the keyVersion is statically known
 * ('local-v1') and the provider asserts it directly; for AWS KMS (K2) the
 * keyVersion is `aws-kms:<uuid>` derived from `KeyId`, which the IAM
 * `kms:EncryptionContext:keyVersion` `Null` condition (plan §8.2) enforces
 * as a separate trip-wire. Including keyVersion here is intentionally
 * deferred to K2 because we don't know the AWS KMS key UUID synchronously
 * before calling `GenerateDataKey`.
 *
 * Tamper-detection coverage in K0+K1:
 *   - sessionId/accountAddress/chainId/expiresAt tamper → KMS context
 *     mismatch (local-aes: HKDF re-derives wrong key → downstream AES-GCM
 *     fails; aws-kms K2: `InvalidCiphertextException`).
 *   - keyVersion tamper → caught by the explicit `if (keyVersion !== ...)` check
 *     inside `decryptSessionDataKey` on both providers.
 *   - same fields ALSO bind into the AES-GCM AAD via `buildSessionAAD` — two
 *     independent trip-wires per spec §13.
 */
function buildAadContext(meta: SessionMeta): Record<string, string> {
  return {
    sessionId: meta.sessionId,
    accountAddress: meta.accountAddress.toLowerCase(),
    chainId: String(meta.chainId),
    expiresAt: meta.expiresAt,
  }
}

function zeroise(buf: Uint8Array): void {
  for (let i = 0; i < buf.length; i++) buf[i] = 0
}

function toB64(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

/**
 * Encrypt a session payload under a freshly-generated per-row data key.
 *
 * The data key is wrapped by the configured `A2AKeyProvider` (local-aes in
 * dev, AWS KMS in prod after K2). The AAD is bound on BOTH layers — the
 * KMS provider's aadContext AND the AES-GCM additionalData.
 *
 * Why pass the 32-byte data key as 64 hex chars rather than rewriting
 * `encryptPayload` to accept raw bytes: `encryptPayload` is stable SDK API.
 * Internally it SHA-256s the secret string to derive the AES key — feeding
 * it 64 hex chars produces a deterministic 32-byte key. Equivalent semantic
 * to "use this exact key material"; lets the SDK signature stay frozen.
 */
export async function encryptSessionPackage<T>(
  payload: T,
  meta: SessionMeta,
): Promise<EncryptedSessionRow> {
  const provider = getProvider()

  const dk = await provider.generateSessionDataKey({
    aadContext: buildAadContext(meta),
  })

  try {
    const aesAad = buildSessionAAD(meta)
    const dataKeyHex = bytesToHex(dk.plaintextDataKey)
    const enc: EncryptedPayload = await encryptPayload(payload, dataKeyHex, aesAad)
    return {
      ciphertext: enc.ciphertext,
      iv: enc.iv,
      encryptedDataKey: toB64(dk.encryptedDataKey),
      keyVersion: dk.keyVersion,
      kmsKeyId: dk.keyId,
    }
  } finally {
    zeroise(dk.plaintextDataKey)
  }
}

/**
 * Decrypt a session row. Routes by `row.keyVersion`:
 *   - 'legacy' → `decryptLegacy` (pre-K3 rows; uses `config.A2A_SESSION_SECRET`).
 *   - anything else → unwrap data key via provider, then AES-GCM with the
 *     bound `buildSessionAAD(meta)` AAD.
 *
 * Throws if any binding field has been tampered with — the AAD trip-wire.
 */
export async function decryptSessionPackage<T>(
  row: DecryptableRow,
  meta: SessionMeta,
): Promise<T> {
  if (!row.encryptedPackage || !row.iv) {
    throw new Error('decryptSessionPackage: session row missing ciphertext/iv')
  }

  if (row.keyVersion === 'legacy') {
    return decryptLegacy<T>(row, meta)
  }

  if (!row.encryptedDataKey || !row.kmsKeyId) {
    throw new Error(
      'decryptSessionPackage: session row missing encryptedDataKey/kmsKeyId (post-cutover row)',
    )
  }

  const provider = getProvider()
  const aadContext = buildAadContext(meta)
  const dataKey = await provider.decryptSessionDataKey({
    encryptedDataKey: fromB64(row.encryptedDataKey),
    aadContext,
    keyId: row.kmsKeyId,
    keyVersion: row.keyVersion,
  })
  try {
    const aesAad = buildSessionAAD(meta)
    const dataKeyHex = bytesToHex(dataKey)
    return await decryptPayload<T>(
      { ciphertext: row.encryptedPackage, iv: row.iv },
      dataKeyHex,
      aesAad,
    )
  } finally {
    zeroise(dataKey)
  }
}

/**
 * Legacy decrypt path for pre-K3 session rows (`keyVersion === 'legacy'`).
 * Routes through `config.A2A_SESSION_SECRET` exactly like the old code,
 * preserving the AAD binding from Hardening §1.5 #8. Removed T+30 days
 * post-cutover (plan §7).
 *
 * Exported for explicit testability — production callers go through
 * `decryptSessionPackage`.
 */
export async function decryptLegacy<T>(
  row: { encryptedPackage: string | null; iv: string | null },
  meta: SessionMeta,
): Promise<T> {
  if (!row.encryptedPackage || !row.iv) {
    throw new Error('decryptLegacy: session row missing ciphertext/iv')
  }
  // Dynamically import config so the helper is testable without booting
  // the full config (which reads .env at module load). Production calls
  // pay the import cost once per process.
  const { config } = await import('../config')
  const aad = buildSessionAAD(meta)
  return decryptPayload<T>(
    { ciphertext: row.encryptedPackage, iv: row.iv },
    config.A2A_SESSION_SECRET,
    aad,
  )
}
