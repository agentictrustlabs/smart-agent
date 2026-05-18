/**
 * AWS KMS asymmetric secp256k1 signer (KMS migration K4 — PR-2 prod implementation).
 *
 * Implements the `signA2AAction` half of `A2AKeyProvider` against an AWS KMS
 * CMK with `KeySpec=ECC_SECG_P256K1` + `KeyUsage=SIGN_VERIFY` + `SigningAlgorithms=[ECDSA_SHA_256]`.
 * The private key never leaves AWS. The public key is fetched once at first use
 * via `kms:GetPublicKey`, the EOA address is derived locally via
 * `keccak256(rawPubkey).slice(-20)`, and the address is cached for the lifetime
 * of the provider instance (KMS asymmetric keys are immutable; the public key
 * for a given CMK never changes).
 *
 * Required KMS CMK configuration (operator MUST provision this exact shape):
 *
 *   aws kms create-key \
 *     --key-spec ECC_SECG_P256K1 \
 *     --key-usage SIGN_VERIFY \
 *     --description "Smart Agent master EOA signer"
 *
 * A symmetric AES key (K2 envelope encryption, `aws-kms-provider.ts`) is a
 * SEPARATE CMK with `KeySpec=SYMMETRIC_DEFAULT` and DIFFERENT IAM permissions
 * (`kms:GenerateDataKey` + `kms:Decrypt` vs `kms:Sign` + `kms:GetPublicKey`).
 * The two keys are kept distinct so least-privilege IAM policies pin each
 * runtime path to a single KMS action.
 *
 * Signing pipeline (per `KMS-IMPLEMENTATION-PLAN.md` §5 / K4 §5):
 *
 *   1. Build the 32-byte digest. Either the caller passes `digest` (viem's
 *      `hashMessage` / `hashTypedData` / RLP-keccak; this is the hot path)
 *      OR we compute the canonical "sa:sign:v1" digest from the binding
 *      tuple (audit-logged direct callers; rare).
 *   2. Call `kms:Sign` with `MessageType=DIGEST` + `SigningAlgorithm=ECDSA_SHA_256`.
 *      KMS expects the digest as RAW BYTES (Uint8Array), NOT base64 — the
 *      AWS SDK v3 marshals it for us when we pass a `Uint8Array`.
 *   3. DER-decode the returned signature `SEQUENCE { r INTEGER, s INTEGER }`
 *      via `parseDerSignature` (handles the leading-zero pad on high-bit
 *      integers — see `der-utils.ts`).
 *   4. Low-s normalize per EIP-2: if `s > N/2`, set `s = N - s`. Track whether
 *      we flipped because the recovery bit also flips when s does.
 *   5. Derive `recovery ∈ {0, 1}` by trying both bits against the cached
 *      public key with `@noble/curves` and picking the match.
 *   6. Return `r || s || v` with `v = recovery + 27` (EIP-191 / ERC-1271
 *      convention; viem's transaction serializers re-derive `v` for EIP-155
 *      and `yParity` for EIP-1559).
 *
 * Error mapping mirrors `aws-kms-provider.ts` (K2). Operator-facing strings
 * are stable so route handlers can match on substrings if needed:
 *   - `KMSInvalidSignatureException`         → "kms signature rejected"
 *   - `KMSInvalidStateException` /
 *     `KeyUnavailableException` /
 *     `DisabledException`                    → "kms key unavailable"
 *   - `AccessDeniedException`                → "kms unauthorized"
 *   - `ThrottlingException` /
 *     `KMSInternalException`                 → "kms unreachable (throttled)"
 *   - Network / AbortSignal 5s timeout       → "kms unreachable"
 *   - `InvalidKeyUsageException` (key was
 *     created with KeyUsage=ENCRYPT_DECRYPT) → "kms key wrong usage"
 *
 * This file is the second of two `packages/sdk/src/key-custody/` files allowed
 * to import `@aws-sdk/client-kms` (the first being `aws-kms-provider.ts`).
 * Route handlers under `apps/a2a-agent/src/routes/` MUST NOT import the AWS
 * SDK directly — see `scripts/check-no-bypass.sh`.
 */
import {
  KMSClient,
  SignCommand,
  GetPublicKeyCommand,
} from '@aws-sdk/client-kms'
import { awsCredentialsProvider } from '@vercel/oidc-aws-credentials-provider'
import { secp256k1 } from '@noble/curves/secp256k1'
import { keccak_256 } from '@noble/hashes/sha3'
import type { A2AKeyProvider } from './types'
import {
  buildCanonicalDigest,
  SECP256K1_N,
  SECP256K1_N_HALF,
} from './local-secp256k1-signer'
import {
  parseDerSignature,
  extractSec1FromSpki,
  bigIntTo32Bytes,
} from './der-utils'

/**
 * Environment for `createAwsKmsSigner`.
 *
 * - `AWS_REGION`           — region the signing CMK lives in. Required.
 * - `AWS_ROLE_ARN`         — IAM role assumed via Vercel OIDC federation.
 *                            Pattern `arn:aws:iam::<account>:role/<name>`.
 *                            NOT a secret; the trust policy on the role pins
 *                            it to a specific Vercel project + environment.
 * - `AWS_KMS_SIGNER_KEY_ID` — the asymmetric `ECC_SECG_P256K1` CMK. Accepts
 *                            a key ARN, bare UUID, or alias. Distinct from
 *                            `AWS_KMS_KEY_ID` (which is the K2 symmetric
 *                            envelope-encryption key).
 */
export interface AwsKmsSignerEnv {
  AWS_REGION: string
  AWS_ROLE_ARN: string
  AWS_KMS_SIGNER_KEY_ID: string
}

/**
 * Optional dependencies (test-injectable). Production callers omit this
 * argument; tests inject a mocked `KMSClient` via `aws-sdk-client-mock`.
 */
export interface AwsKmsSignerDeps {
  client?: KMSClient
  requestTimeoutMs?: number
  /**
   * Sprint 3 S3.2 — optional audit callback. When provided, a single
   * audit event is emitted on every successful `signA2AAction` call
   * carrying the keyId, signer address, and the caller's actionId /
   * sessionId. Failures are NOT routed here — the SDK never owns the
   * audit-table writes; the a2a-agent caller traps the throw and
   * decides whether the failure is itself audit-worthy (today: yes,
   * but as a deny row written by the caller).
   */
  audit?: (event: AwsKmsSignerAuditEvent) => Promise<void> | void
}

/**
 * Sprint 3 S3.2 — payload handed to the optional `audit` callback after
 * a successful `kms:Sign` call. The SDK does NOT depend on the
 * audit-table schema — the callback receives a plain record and the
 * a2a-agent caller writes the corresponding `execution_audit` row.
 */
export interface AwsKmsSignerAuditEvent {
  keyId: string
  signerAddress: `0x${string}`
  sessionId: string
  actionId: string
  accountAddress: string
  chainId: string
}

/** Public shape returned by `createAwsKmsSigner`. Mirrors `LocalSecp256k1Signer`. */
export interface AwsKmsSigner {
  signA2AAction: NonNullable<A2AKeyProvider['signA2AAction']>
  /** Returns the EVM address derived from the cached `kms:GetPublicKey` response. */
  getSignerAddress(): Promise<`0x${string}`>
}

const DEFAULT_REQUEST_TIMEOUT_MS = 5000

const ROLE_ARN_PATTERN = /^arn:aws:iam::\d+:role\/.+$/
// Accept either a full KMS key ARN, a bare UUID, or an alias. Matches the
// pattern used in `aws-kms-provider.ts` so the validation surface is uniform.
const KEY_ID_PATTERN =
  /^(arn:aws:kms:[a-z0-9-]+:\d+:key\/[a-zA-Z0-9-]+|[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}|alias\/.+)$/

function bytesToHex(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!
    s += (b < 16 ? '0' : '') + b.toString(16)
  }
  return s
}

function uint8eq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/**
 * Derive the ECDSA recovery id (0 or 1) by recovering with each candidate
 * and comparing to the expected public key. Throws if neither matches —
 * load-bearing assertion: a mismatch means the cached pubkey is stale, the
 * KMS key was swapped, or the DER decoder is broken.
 *
 * `s` MUST already be low-s normalized; the recovery bit returned applies
 * to the post-normalization signature.
 *
 * `expectedRawPubkey` is 64 bytes (X || Y), per SEC1 uncompressed minus the
 * leading 0x04 prefix.
 */
function deriveRecoveryId(
  msgHash: Uint8Array,
  r: bigint,
  s: bigint,
  expectedRawPubkey: Uint8Array,
): 0 | 1 {
  for (const rec of [0, 1] as const) {
    try {
      const sig = new secp256k1.Signature(r, s).addRecoveryBit(rec)
      const recovered = sig.recoverPublicKey(msgHash).toRawBytes(false) // 65 bytes, 0x04 prefix
      const rawRecovered = recovered.slice(1) // 64 bytes (X || Y)
      if (uint8eq(rawRecovered, expectedRawPubkey)) return rec
    } catch {
      // recovery failed for this bit — try the other
    }
  }
  throw new Error(
    'kms-signer: neither recovery id matches cached pubkey (KMS key swap, stale cache, or DER decode bug)',
  )
}

/**
 * Map AWS SDK errors to clean operator-facing messages. Mirrors the shape
 * of `mapAwsError` in `aws-kms-provider.ts` with signer-specific additions
 * (`KMSInvalidSignatureException`, `InvalidKeyUsageException`).
 */
function mapAwsError(err: unknown, op: string): Error {
  if (err instanceof Error) {
    const name = (err as Error & { name?: string }).name ?? ''
    if (name === 'KMSInvalidSignatureException') {
      return new Error(`kms signature rejected (${op})`)
    }
    if (name === 'InvalidKeyUsageException') {
      return new Error(`kms key wrong usage (${op}): expected SIGN_VERIFY`)
    }
    if (name === 'AccessDeniedException' || name === 'NotAuthorizedException') {
      return new Error('kms unauthorized')
    }
    if (
      name === 'KMSInvalidStateException' ||
      name === 'DisabledException' ||
      name === 'KeyUnavailableException'
    ) {
      return new Error(`kms key unavailable (${op})`)
    }
    if (name === 'ThrottlingException' || name === 'KMSInternalException') {
      return new Error(`kms unreachable (${op}): throttled`)
    }
    if (name === 'TimeoutError' || name === 'AbortError' || /timeout|aborted/i.test(err.message)) {
      return new Error(`kms unreachable (${op}): timeout`)
    }
    if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN/i.test(err.message)) {
      return new Error(`kms unreachable (${op}): network`)
    }
    return new Error(`kms error (${op}): ${name || err.message}`)
  }
  return new Error(`kms error (${op}): ${String(err)}`)
}

/**
 * Construct the AWS KMS secp256k1 signer.
 *
 * Validates env synchronously; does NOT contact AWS until the first
 * `signA2AAction` / `getSignerAddress` call. The Vercel OIDC token is
 * resolved at request scope inside `awsCredentialsProvider`, never at
 * module load (Vercel Function topology has no request context then).
 *
 * @throws if env is missing or malformed.
 */
export function createAwsKmsSigner(
  env: AwsKmsSignerEnv,
  deps: AwsKmsSignerDeps = {},
): AwsKmsSigner {
  if (!env.AWS_REGION || env.AWS_REGION.trim().length === 0) {
    throw new Error('createAwsKmsSigner: AWS_REGION is required')
  }
  if (!env.AWS_ROLE_ARN || !ROLE_ARN_PATTERN.test(env.AWS_ROLE_ARN)) {
    throw new Error(
      'createAwsKmsSigner: AWS_ROLE_ARN must match arn:aws:iam::<account>:role/<name>',
    )
  }
  if (!env.AWS_KMS_SIGNER_KEY_ID || !KEY_ID_PATTERN.test(env.AWS_KMS_SIGNER_KEY_ID)) {
    throw new Error(
      'createAwsKmsSigner: AWS_KMS_SIGNER_KEY_ID must be a key ARN, UUID, or alias',
    )
  }

  const requestTimeoutMs = deps.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  const client =
    deps.client ??
    new KMSClient({
      region: env.AWS_REGION,
      credentials: awsCredentialsProvider({ roleArn: env.AWS_ROLE_ARN }),
    })

  // Lifetime cache for the public key + derived address. One `GetPublicKey`
  // round-trip per provider instance.
  let cachedAddress: `0x${string}` | undefined
  let cachedRawPubkey: Uint8Array | undefined // 64 bytes (X || Y) for recovery-id match
  let pubkeyFetchInflight: Promise<void> | undefined

  function buildAbortSignal(): AbortSignal {
    return AbortSignal.timeout(requestTimeoutMs)
  }

  async function fetchAndCachePubkey(): Promise<void> {
    // Coalesce concurrent first-use calls so we never issue two parallel
    // `GetPublicKey` round-trips.
    if (cachedAddress && cachedRawPubkey) return
    if (pubkeyFetchInflight) return pubkeyFetchInflight
    pubkeyFetchInflight = (async () => {
      try {
        const out = await client.send(
          new GetPublicKeyCommand({ KeyId: env.AWS_KMS_SIGNER_KEY_ID }),
          { abortSignal: buildAbortSignal() },
        )
        if (!out.PublicKey) {
          throw new Error('kms-signer: GetPublicKey returned no key material')
        }
        const spki = new Uint8Array(out.PublicKey)
        // DER SubjectPublicKeyInfo → 65-byte SEC1 uncompressed point (0x04 || X || Y).
        const sec1 = extractSec1FromSpki(spki)
        const rawPubkey = sec1.slice(1) // 64 bytes
        const addrBytes = keccak_256(rawPubkey).slice(-20)
        cachedRawPubkey = rawPubkey
        cachedAddress = (`0x${bytesToHex(addrBytes)}`) as `0x${string}`
      } catch (err) {
        if (
          err instanceof Error &&
          /^kms[- ]signer:|^kms (error|unauthorized|unreachable|key unavailable|signature rejected|key wrong usage)/i.test(
            err.message,
          )
        ) {
          throw err
        }
        throw mapAwsError(err, 'getPublicKey')
      } finally {
        pubkeyFetchInflight = undefined
      }
    })()
    return pubkeyFetchInflight
  }

  return {
    async getSignerAddress(): Promise<`0x${string}`> {
      await fetchAndCachePubkey()
      return cachedAddress!
    },

    async signA2AAction({ canonicalPayload, accountAddress, chainId, sessionId, actionId, digest }) {
      await fetchAndCachePubkey()
      const msgHash =
        digest ??
        buildCanonicalDigest({ canonicalPayload, accountAddress, chainId, sessionId, actionId })
      if (msgHash.length !== 32) {
        throw new Error(`createAwsKmsSigner: digest must be 32 bytes (got ${msgHash.length})`)
      }

      let signatureDer: Uint8Array
      try {
        const out = await client.send(
          new SignCommand({
            KeyId: env.AWS_KMS_SIGNER_KEY_ID,
            // KMS expects the digest as raw bytes (Uint8Array). The AWS SDK
            // v3 marshals Uint8Array → base64 over the wire on our behalf;
            // we MUST pass bytes, NOT base64 ourselves.
            Message: msgHash,
            MessageType: 'DIGEST',
            SigningAlgorithm: 'ECDSA_SHA_256',
          }),
          { abortSignal: buildAbortSignal() },
        )
        if (!out.Signature) {
          throw new Error('kms-signer: Sign returned no signature')
        }
        signatureDer = new Uint8Array(out.Signature)
      } catch (err) {
        if (
          err instanceof Error &&
          /^kms[- ]signer:|^kms (error|unauthorized|unreachable|key unavailable|signature rejected|key wrong usage)/i.test(
            err.message,
          )
        ) {
          throw err
        }
        throw mapAwsError(err, 'sign')
      }

      // DER decode → (r, s).
      const { r, s: sRaw } = parseDerSignature(signatureDer)

      // Low-s normalize (EIP-2). The recovery-id loop below works against
      // the post-normalization s — picking the bit that recovers to the
      // cached pubkey is correct regardless of whether we flipped s.
      const s = sRaw > SECP256K1_N_HALF ? SECP256K1_N - sRaw : sRaw

      const recovery = deriveRecoveryId(msgHash, r, s, cachedRawPubkey!)

      // Pack r || s || v=recovery+27 (EIP-191 / ERC-1271 convention).
      const sig = new Uint8Array(65)
      sig.set(bigIntTo32Bytes(r), 0)
      sig.set(bigIntTo32Bytes(s), 32)
      sig[64] = recovery + 27

      // Sprint 3 S3.2 — emit the audit event AFTER the signature is
      // fully derived. We do this best-effort: a failing audit must not
      // cancel a returned signature (the call already committed at AWS).
      if (deps.audit) {
        try {
          await deps.audit({
            keyId: env.AWS_KMS_SIGNER_KEY_ID,
            signerAddress: cachedAddress!,
            sessionId,
            actionId,
            accountAddress,
            chainId,
          })
        } catch (err) {
          // Swallow — log to stderr so an operator can see broken audit
          // plumbing in the agent logs without breaking signing.
          console.error('[aws-kms-signer audit] callback threw:', err)
        }
      }

      return {
        signature: sig,
        keyId: env.AWS_KMS_SIGNER_KEY_ID,
        signerAddress: cachedAddress!,
      }
    },
  }
}
