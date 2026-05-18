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
 */
import { createHash } from 'node:crypto'
import {
  encryptPayload,
  decryptPayload,
  buildSessionAAD,
  type EncryptedPayload,
} from '@smart-agent/sdk'
import type { A2AKeyProvider } from '@smart-agent/sdk/key-custody'
import { buildKeyProvider } from './key-provider'
import { auditAppend } from '../lib/audit'

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
 * Build the KMS-layer aadContext bound to this session's metadata + key version.
 *
 * Shape (reviewer P0-6 — keyVersion now in BOTH layers):
 *   {
 *     session_id_h:     sha256(sessionId).hex.slice(0, 32),  // 16-byte hash
 *     account_address:  meta.accountAddress.toLowerCase(),
 *     chain_id:         String(meta.chainId),
 *     expires_at:       meta.expiresAt,                       // ISO timestamp
 *     key_version:      keyVersion,                            // provider tag
 *   }
 *
 * Notes on the shape:
 *
 *   - The keys use snake_case so they line up 1:1 with the IAM policy's
 *     `kms:EncryptionContext:<key>` ARNs in `KMS-IMPLEMENTATION-PLAN.md`
 *     §8.1. They are deterministic so encrypt-time and decrypt-time
 *     contexts byte-match.
 *
 *   - `session_id_h`: KMS `EncryptionContext` is logged verbatim in
 *     CloudTrail. SessionIds are bearer-ish (they appear in cookies on
 *     the client) so we don't ship them raw into operator telemetry —
 *     instead the AAD carries a SHA-256 hash truncated to 16 bytes /
 *     32 hex chars. The hash is deterministic, so decrypt-time
 *     re-computes the same value from `meta.sessionId`. Per-session
 *     binding is preserved cryptographically (different sessionIds
 *     still hash to different contexts), but raw sessionIds never bleed
 *     into KMS audit logs.
 *
 *   - `key_version`: bound into BOTH the KMS EncryptionContext AND the
 *     AES-GCM AAD (`buildSessionAAD`). AWS KMS rejects a `Decrypt`
 *     whose context bytes don't match what was used at
 *     `GenerateDataKey` time; on the AES-GCM layer the same mismatch
 *     fails the tag. This is the substantive P0-6 fix: a row written
 *     under one keyVersion can NEVER be replayed against a verifier
 *     told the row is a different version, on either layer.
 *
 * Tamper-detection coverage:
 *   - any of (sessionId, accountAddress, chainId, expiresAt, keyVersion)
 *     differs at decrypt time → KMS context mismatch + AES-GCM tag
 *     failure (two independent trip-wires).
 *   - keyVersion mismatch is ALSO caught by the explicit
 *     `if (keyVersion !== ...)` check inside the provider's
 *     `decryptSessionDataKey` (third trip-wire — defense in depth).
 */
function buildAadContext(meta: SessionMeta, keyVersion: string): Record<string, string> {
  return {
    session_id_h: hashSessionId(meta.sessionId),
    account_address: meta.accountAddress.toLowerCase(),
    chain_id: String(meta.chainId),
    expires_at: meta.expiresAt,
    key_version: keyVersion,
  }
}

/**
 * SHA-256 the sessionId and return the first 32 hex chars (16 bytes).
 * Deterministic — both encrypt and decrypt re-derive the same value from
 * `meta.sessionId`. Keeping raw sessionIds out of KMS `EncryptionContext`
 * (and therefore CloudTrail) avoids accidental PII / bearer-token bleed
 * into operator telemetry.
 *
 * Why only 16 bytes: KMS EncryptionContext entry values have a 128-char
 * UTF-8 ceiling but operators read these in CloudTrail JSON; 32 hex
 * chars is a comfortable size and has 2^128 collision resistance which
 * is plenty for per-session binding (we'd need the full hash for
 * pre-image resistance against a determined attacker, but here the
 * point is JUST that the value be deterministically bound and not equal
 * to any sessionId of another session).
 */
function hashSessionId(sessionId: string): string {
  const bytes = new TextEncoder().encode(sessionId)
  const digest = createHash('sha256').update(bytes).digest('hex')
  return digest.slice(0, 32)
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

  // P0-6 — `key_version` is bound into BOTH the KMS EncryptionContext
  // AND the AES-GCM AAD. Provider's `keyVersion` is synchronously
  // knowable at construction time so we can build the context upfront.
  const keyVersion = provider.keyVersion
  const aadContext = buildAadContext(meta, keyVersion)

  const dk = await provider.generateSessionDataKey({ aadContext })

  // Defense in depth: the provider's runtime keyVersion must equal the
  // sync property we used to build the AAD. A drift would silently
  // bind the AES-GCM tag to a key-version label different from what
  // KMS bound into the ciphertext MAC — fail loudly here.
  if (dk.keyVersion !== keyVersion) {
    zeroise(dk.plaintextDataKey)
    throw new Error(
      `encryptSessionPackage: provider keyVersion drift (sync='${keyVersion}', generated='${dk.keyVersion}')`,
    )
  }

  try {
    const aesAad = buildSessionAAD({ ...meta, keyVersion })
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
 * Optional audit-trace context passed by callers that want the
 * KMS-decrypt / key-version-rejected events to carry their correlation
 * id and an expected key-version baseline. Decoupled from `SessionMeta`
 * because the trace is observability-only and not in the AAD.
 */
export interface DecryptAuditContext {
  /** Hardening §1D — cross-service correlation id from the request edge. */
  correlationId?: string
  /**
   * Sprint 3 S3.2 — when set, a decrypt that finds a stored
   * `keyVersion` not matching this allow-list emits a
   * `key-version-rejected` audit row before the underlying provider
   * decrypt throws. The decrypt is NOT short-circuited — we still let
   * the provider reject the cipher-text so the cryptographic deny is
   * authoritative. The audit row is purely the operator-visible signal.
   */
  expectedKeyVersions?: ReadonlyArray<string>
  /** Service that triggered the decrypt — defaults to 'a2a-agent'. */
  source?: string
}

/**
 * Decrypt a session row. Unwraps the data key via the configured KMS
 * provider, then AES-GCM with the bound `buildSessionAAD(meta)` AAD.
 *
 * Throws if any binding field has been tampered with — the AAD trip-wire.
 *
 * Sprint 3 S3.2 — emits one of three audit events:
 *   - `kms-decrypt`           on success
 *   - `kms-decrypt-failed`    on every throw (provider error, AAD mismatch, bad blob)
 *   - `key-version-rejected`  when the stored keyVersion doesn't match
 *                             `audit.expectedKeyVersions` (in addition to
 *                             whatever the provider does — we let the
 *                             cryptographic deny remain authoritative)
 *
 * Audit writes are best-effort: failures are logged but never block the
 * decrypt path.
 */
export async function decryptSessionPackage<T>(
  row: DecryptableRow,
  meta: SessionMeta,
  audit: DecryptAuditContext = {},
): Promise<T> {
  if (!row.encryptedPackage || !row.iv) {
    await safeAudit({
      eventType: 'kms-decrypt-failed',
      meta,
      keyVersion: row.keyVersion,
      keyId: row.kmsKeyId,
      audit,
      reason: 'missing ciphertext/iv',
    })
    throw new Error('decryptSessionPackage: session row missing ciphertext/iv')
  }

  if (!row.encryptedDataKey || !row.kmsKeyId) {
    await safeAudit({
      eventType: 'kms-decrypt-failed',
      meta,
      keyVersion: row.keyVersion,
      keyId: row.kmsKeyId,
      audit,
      reason: 'missing encryptedDataKey/kmsKeyId',
    })
    throw new Error(
      'decryptSessionPackage: session row missing encryptedDataKey/kmsKeyId',
    )
  }

  // Sprint 3 S3.2 — key-version allow-list check. Audit BEFORE the
  // provider decrypt so an operator sees the row even if the AWS call
  // fails for an unrelated reason. We still call the provider so the
  // cryptographic reject (AAD mismatch on a wrong-version blob) is the
  // authoritative deny.
  if (audit.expectedKeyVersions && audit.expectedKeyVersions.length > 0) {
    if (!audit.expectedKeyVersions.includes(row.keyVersion)) {
      await safeAudit({
        eventType: 'key-version-rejected',
        meta,
        keyVersion: row.keyVersion,
        keyId: row.kmsKeyId,
        audit,
        reason: `keyVersion '${row.keyVersion}' not in expected set [${audit.expectedKeyVersions.join(',')}]`,
        status: 'denied',
      })
    }
  }

  const provider = getProvider()
  // P0-6 — use the STORED `row.keyVersion` (not the provider's current
  // sync tag) when building the aadContext. KMS will detect any
  // mismatch against the actual ciphertext's bound context via
  // InvalidCiphertextException; the provider's own `keyVersion !==`
  // check is the third (post-IAM, pre-network) trip-wire.
  const aadContext = buildAadContext(meta, row.keyVersion)
  let dataKey: Uint8Array
  try {
    dataKey = await provider.decryptSessionDataKey({
      encryptedDataKey: fromB64(row.encryptedDataKey),
      aadContext,
      keyId: row.kmsKeyId,
      keyVersion: row.keyVersion,
    })
  } catch (err) {
    await safeAudit({
      eventType: 'kms-decrypt-failed',
      meta,
      keyVersion: row.keyVersion,
      keyId: row.kmsKeyId,
      audit,
      reason: (err as Error).message ?? 'provider decrypt threw',
    })
    throw err
  }
  try {
    // AES-GCM AAD binds the stored keyVersion too — a row whose
    // `key_version` column was tampered to a different label fails the
    // tag here even if the provider somehow returned a valid data key.
    const aesAad = buildSessionAAD({ ...meta, keyVersion: row.keyVersion })
    const dataKeyHex = bytesToHex(dataKey)
    const out = await decryptPayload<T>(
      { ciphertext: row.encryptedPackage, iv: row.iv },
      dataKeyHex,
      aesAad,
    )
    await safeAudit({
      eventType: 'kms-decrypt',
      meta,
      keyVersion: row.keyVersion,
      keyId: row.kmsKeyId,
      audit,
    })
    return out
  } catch (err) {
    await safeAudit({
      eventType: 'kms-decrypt-failed',
      meta,
      keyVersion: row.keyVersion,
      keyId: row.kmsKeyId,
      audit,
      reason: (err as Error).message ?? 'AES-GCM decrypt threw',
    })
    throw err
  } finally {
    zeroise(dataKey)
  }
}

/**
 * Best-effort audit writer for the KMS-decrypt completeness sweep
 * (Sprint 3 S3.2). Never throws — a failing audit must not block the
 * cryptographic decision.
 */
async function safeAudit(args: {
  eventType: 'kms-decrypt' | 'kms-decrypt-failed' | 'key-version-rejected'
  meta: SessionMeta
  keyVersion: string
  keyId: string | null
  audit: DecryptAuditContext
  reason?: string
  status?: 'completed' | 'denied'
}): Promise<void> {
  try {
    const status = args.status ?? (args.eventType === 'kms-decrypt' ? 'completed' : 'denied')
    await auditAppend({
      rootGrantHash: '',
      sessionId: args.meta.sessionId,
      sessionPrincipal: args.meta.accountAddress,
      mcpServer: args.audit.source ?? 'a2a-agent',
      mcpTool: `kms:${args.eventType}`,
      eventType: args.eventType,
      executionPath: 'mcp-only',
      target: args.keyId ?? null,
      status,
      errorReason: args.reason ?? '',
      correlationId: args.audit.correlationId ?? null,
    })
  } catch (err) {
    console.error('[kms-decrypt audit] failed:', err)
  }
}
