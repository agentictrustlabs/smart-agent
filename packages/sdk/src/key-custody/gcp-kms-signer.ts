/**
 * GCP Cloud KMS asymmetric secp256k1 signer (GCP-KMS G-PR-3 — prod implementation).
 *
 * Implements `KmsAccountBackend` (the same interface `createKmsAccount` /
 * `viem-kms-account.ts` adapts into a viem `LocalAccount`). Sibling of
 * `aws-kms-signer.ts`; mirrors its API, recovery-id derivation, low-S
 * normalization, audit-event shape, and DER pipeline so the dev/prod
 * cutover is one env flip (`A2A_KMS_BACKEND`) with no call-site change.
 *
 * Required KMS key configuration (operator MUST provision this exact shape):
 *
 *   gcloud kms keys create master-signer \
 *     --location <loc> --keyring <ring> \
 *     --purpose asymmetric-signing \
 *     --default-algorithm ec-sign-secp256k1-sha256
 *
 * The signer pins a SPECIFIC `cryptoKeyVersion` (env
 * `GCP_KMS_MASTER_SIGNER_VERSION` = `projects/.../cryptoKeyVersions/<n>`)
 * because each version has its OWN public key. Rotation = new version +
 * env update + redeploy. This matches the AWS path's pinning behaviour
 * (the AWS CMK is immutable; GCP needs the version suffix to be
 * immutable). See GCP-KMS-IMPLEMENTATION-PLAN.md § G3 for the full design.
 *
 * Signing pipeline (mirror of `aws-kms-signer.ts` §5):
 *
 *   1. Build the 32-byte digest. Either the caller passes `digest`
 *      (viem's `hashMessage` / `hashTypedData` / RLP-keccak path; hot
 *      path), OR we compute the canonical "sa:sign:v1" digest from the
 *      binding tuple (rare).
 *   2. Compute CRC32C(digest) and call `asymmetricSign` with
 *      `digest: { sha256: digest }` + `digestCrc32c`. Cloud KMS uses the
 *      `sha256` field to denote "the 32 bytes I'm sending ARE a sha256
 *      digest" — it does NOT re-hash. (For `EC_SIGN_SECP256K1_SHA256`,
 *      the digest field accepts the raw 32-byte keccak/sha256 output.
 *      Smart Agent always sends keccak256 results because every viem
 *      surface keccak-hashes; KMS does not validate the hash algorithm,
 *      so this is safe.)
 *   3. Verify `response.verifiedDigestCrc32c === true` — KMS-side echo
 *      of "the bytes I received match the CRC you sent". A `false` here
 *      means the request was corrupted in flight.
 *   4. Verify `response.signatureCrc32c` against our local computation
 *      of `CRC32C(response.signature)` — KMS-side claim of "here is the
 *      CRC of the bytes I sent back"; if it disagrees with our local
 *      recompute, the response was corrupted in flight.
 *   5. DER-decode `response.signature` to `{ r, s }` via the shared
 *      `parseDerSignature` (`der-utils.ts`) — same parser the AWS path
 *      uses; handles leading-zero pad on high-bit integers.
 *   6. Apply low-S normalization defensively. Google CLAIMS to always
 *      return lower-S for secp256k1 but we verify: if `s > N/2`, replace
 *      `s = N - s`. When this fires, emit a `gcp-kms-low-s-normalized`
 *      audit event so the operator notices if Google's behaviour ever
 *      changes; the recovery bit flips with s, so the loop below picks
 *      the matching bit regardless.
 *   7. Derive `recovery ∈ {0, 1}` by trying both bits against the cached
 *      public key with `@noble/curves` and picking the match. Throws if
 *      neither matches (cached pubkey stale, KMS key swapped, or DER
 *      decoder bug — load-bearing assertion).
 *   8. Return `r || s || v` with `v = recovery + 27` (EIP-191 / ERC-1271
 *      convention; viem's transaction serializers re-derive `v` for
 *      EIP-155 and `yParity` for EIP-1559).
 *
 * `GetPublicKey` is fetched lazily on first use (matching the AWS path)
 * and cached for the process lifetime. KMS asymmetric key versions are
 * immutable; the public key for a given version never changes.
 *
 * Error handling: KMS API errors (gRPC status codes — PERMISSION_DENIED,
 * NOT_FOUND, FAILED_PRECONDITION when the key version is destroyed /
 * disabled, RESOURCE_EXHAUSTED for rate limits) are re-thrown with the
 * underlying Google error code preserved in the message (`gcp-kms-signer
 * (sign): <original>`). The operator needs the gRPC status to debug;
 * mapping to AWS-style operator strings would lose information.
 *
 * Substrate-independence (P1): `@google-cloud/kms` is approved for this
 * file (the SDK's `key-custody/` directory); `scripts/check-no-bypass.sh`
 * enforces the isolation rule. The application imports `KmsAccountBackend`
 * — never the Google SDK directly.
 */
import { KeyManagementServiceClient } from '@google-cloud/kms'
import type { BaseExternalAccountClient } from 'google-auth-library'
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
import { createGcpAuthClient, type GcpAuthEnv, type GcpAuthDeps } from './gcp-auth'
import { crc32c } from './crc32c'

/**
 * Environment for `createGcpKmsSigner`.
 *
 * `GCP_KMS_MASTER_SIGNER_VERSION` is a FULLY-VERSIONED resource path
 * (`projects/.../cryptoKeyVersions/<n>`). Each version has its own
 * public key, so the signer must pin to a specific version — otherwise
 * a server-side rotation would silently swap the signing address.
 */
export interface GcpKmsSignerEnv extends GcpAuthEnv {
  /**
   * Fully-qualified cryptoKeyVersion resource path of the master EOA
   * signing key. Format:
   *   projects/<project>/locations/<loc>/keyRings/<ring>/cryptoKeys/<key>/cryptoKeyVersions/<n>
   *
   * The trailing `/cryptoKeyVersions/<n>` is REQUIRED — the asymmetric
   * `getPublicKey` and `asymmetricSign` calls operate on a SPECIFIC
   * version, not the parent key. See GCP-KMS-IMPLEMENTATION-PLAN.md § G3.
   */
  GCP_KMS_MASTER_SIGNER_VERSION: string
}

/**
 * Minimal interface the signer needs from the Google KMS client. Used by
 * `GcpKmsSignerDeps.kmsClientFactory` to inject test stubs without
 * depending on the full `KeyManagementServiceClient` surface. The real
 * client returns `[response]` tuples; we keep that shape.
 */
export interface SignerKmsClientLike {
  getPublicKey(request: {
    name: string
  }): Promise<
    [
      {
        pem?: string | null
        name?: string | null
        algorithm?: string | number | null
        pemCrc32c?: { value?: string | number | null } | null
      },
    ]
  >
  asymmetricSign(request: {
    name: string
    digest?: { sha256?: Uint8Array | null } | null
    digestCrc32c?: { value: string } | null
  }): Promise<
    [
      {
        name?: string | null
        signature?: Uint8Array | Buffer | string | null
        signatureCrc32c?: { value?: string | number | null } | null
        verifiedDigestCrc32c?: boolean | null
      },
    ]
  >
}

/**
 * Audit event payload. Mirrors `aws-kms-signer.ts`'s `AwsKmsSignerAuditEvent`
 * shape exactly so dev/prod parity is one-to-one and the caller's
 * `execution_audit` row writer doesn't branch on backend.
 *
 * `kind` differentiates the two event types emitted by this signer:
 *   - `'sign'`                    — every successful asymmetricSign call.
 *   - `'low-s-normalized'`        — fired alongside `'sign'` when KMS
 *                                   returns s > N/2 and the signer
 *                                   defensively flips it. Operator
 *                                   visibility for "GCP behaviour changed";
 *                                   does NOT replace the `'sign'` event.
 *
 * Other fields match the AWS signer audit event verbatim.
 */
export interface GcpKmsSignerAuditEvent {
  keyId: string
  signerAddress: `0x${string}`
  sessionId: string
  actionId: string
  accountAddress: string
  chainId: string
  /**
   * Sub-kind discriminator. Defaults to `'sign'`. The
   * `'low-s-normalized'` event is fired in addition to the `'sign'`
   * event when low-S normalization had to fix a high-S signature from
   * KMS. Mirrors the AWS signer's single-event shape but adds the
   * second event for the GCP-specific defensive-fix path.
   */
  kind?: 'sign' | 'low-s-normalized'
}

/**
 * Optional dependencies (test-injectable). Production callers omit this
 * argument; tests inject a `kmsClientFactory` stub.
 */
export interface GcpKmsSignerDeps {
  /**
   * Override for the KMS client. Receives the authenticated
   * `BaseExternalAccountClient` (production wires it via
   * `createGcpAuthClient(env)`); tests inject a hand-built stub
   * implementing `SignerKmsClientLike`.
   */
  kmsClientFactory?: (authClient: BaseExternalAccountClient) => SignerKmsClientLike
  /**
   * Override for the CRC32C function. Defaults to the in-tree
   * `crc32c.ts`; tests can stub it to force a "mismatch" path.
   */
  computeCrc32c?: (bytes: Uint8Array) => bigint
  /**
   * Optional override of the GCP auth client (test seam — same as
   * `GcpKmsDeps.gcpAuthDeps` on the provider).
   */
  gcpAuthDeps?: GcpAuthDeps
  /**
   * Audit callback emitted on every successful sign + every low-S
   * normalization event. Mirrors the AWS signer's `audit` shape so the
   * `a2a-signer.ts` caller's `execution_audit` row writer doesn't branch
   * on backend.
   */
  audit?: (event: GcpKmsSignerAuditEvent) => Promise<void> | void
}

/**
 * Public shape returned by `createGcpKmsSigner`. Mirrors `AwsKmsSigner`
 * plus a backend tag (`'gcp-kms'`) so the factory wiring
 * (`apps/a2a-agent/src/auth/key-provider.ts`) can identify the backend
 * without an `instanceof` check.
 */
export interface GcpKmsSigner {
  signA2AAction: NonNullable<A2AKeyProvider['signA2AAction']>
  /** Returns the EVM address derived from the cached `getPublicKey` response. */
  getSignerAddress(): Promise<`0x${string}`>
  readonly backend: 'gcp-kms'
  /** The pinned `cryptoKeyVersion` resource path. */
  readonly keyId: string
  /** Tagged version string `'gcp-kms:<n>'` (n extracted from the env path). */
  readonly keyVersion: string
}

// ─── Hex helpers ─────────────────────────────────────────────────────
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
 * Strip the PEM header/footer + whitespace and base64-decode the body to
 * the raw DER `SubjectPublicKeyInfo` bytes. Google's `getPublicKey`
 * returns the SPKI as a PEM-wrapped string in `response.pem`.
 */
function pemToSpkiBytes(pem: string): Uint8Array {
  const trimmed = pem.trim()
  // Strip "-----BEGIN ...-----" / "-----END ...-----" markers and all
  // whitespace; everything else is base64.
  const body = trimmed
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '')
  if (body.length === 0) {
    throw new Error('gcp-kms-signer: getPublicKey returned an empty PEM body')
  }
  return new Uint8Array(Buffer.from(body, 'base64'))
}

/**
 * Coerce `response.signature` (which the proto type admits as
 * `Uint8Array | Buffer | string | null`) to a Uint8Array. String form is
 * base64 (per protobuf convention when the proto is JSON-decoded).
 */
function toUint8Array(
  value: Uint8Array | Buffer | string | null | undefined,
  context: string,
): Uint8Array {
  if (value == null) {
    throw new Error(`gcp-kms-signer: missing ${context} in KMS response`)
  }
  if (typeof value === 'string') {
    return new Uint8Array(Buffer.from(value, 'base64'))
  }
  if (value instanceof Uint8Array) return value
  return new Uint8Array(value as ArrayLike<number>)
}

/**
 * Coerce an Int64Value-shaped CRC field to a bigint. Same shape used in
 * `gcp-kms-provider.ts`.
 */
function readCrc32c(
  field: { value?: string | number | null } | null | undefined,
  context: string,
): bigint {
  if (field == null || field.value == null) {
    throw new Error(`gcp-kms-signer: missing ${context} in KMS response`)
  }
  if (typeof field.value === 'string') return BigInt(field.value)
  return BigInt(field.value)
}

/**
 * Extract the trailing version suffix from a cryptoKeyVersion resource
 * path. Input:
 *   `projects/.../cryptoKeyVersions/3`
 * Output: `3`.
 *
 * Returns `null` if the path does not contain `/cryptoKeyVersions/`.
 */
function extractVersionSuffix(resourceName: string): string | null {
  const idx = resourceName.lastIndexOf('/cryptoKeyVersions/')
  if (idx < 0) return null
  const suffix = resourceName.slice(idx + '/cryptoKeyVersions/'.length)
  return suffix.length > 0 ? suffix : null
}

const MASTER_SIGNER_VERSION_PATTERN =
  /^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+\/cryptoKeyVersions\/[^/]+$/

/**
 * Derive the ECDSA recovery id (0 or 1) by recovering with each
 * candidate and comparing to the expected public key. Throws if neither
 * matches — load-bearing assertion: a mismatch means the cached pubkey
 * is stale, the KMS key was swapped, or the DER decoder is broken.
 *
 * `s` MUST already be low-S normalized. `expectedRawPubkey` is 64 bytes
 * (X || Y), per SEC1 uncompressed minus the leading 0x04 prefix.
 *
 * Mirrors the AWS signer's `deriveRecoveryId` helper exactly.
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
      const recovered = sig.recoverPublicKey(msgHash).toRawBytes(false) // 65 bytes
      const rawRecovered = recovered.slice(1) // drop 0x04 prefix → 64 bytes
      if (uint8eq(rawRecovered, expectedRawPubkey)) return rec
    } catch {
      // recovery failed for this bit — try the other
    }
  }
  throw new Error(
    'gcp-kms-signer: recovered address does not match expected signer ' +
      '(neither recovery id matches cached pubkey — KMS key swap, stale cache, or DER decode bug)',
  )
}

/**
 * Construct the GCP Cloud KMS secp256k1 signer.
 *
 * Validates env synchronously; does NOT contact Google until the first
 * `signA2AAction` / `getSignerAddress` call. The OIDC token is resolved
 * at request scope inside the `BaseExternalAccountClient`, never at
 * module load (Vercel Function topology has no request context then).
 *
 * Mirrors the AWS signer's sync-construct + lazy-pubkey-fetch pattern
 * exactly so the factory wiring (`apps/a2a-agent/src/auth/key-provider.ts`
 * `buildSignerBackend`) stays synchronous — both AWS and GCP arms return
 * a backend whose `getSignerAddress()` is the only async surface.
 *
 * @throws if env is missing or `GCP_KMS_MASTER_SIGNER_VERSION` doesn't
 *         match the expected fully-versioned resource path pattern.
 */
export function createGcpKmsSigner(
  env: GcpKmsSignerEnv,
  deps: GcpKmsSignerDeps = {},
): GcpKmsSigner {
  if (
    !env.GCP_KMS_MASTER_SIGNER_VERSION ||
    env.GCP_KMS_MASTER_SIGNER_VERSION.trim().length === 0
  ) {
    throw new Error(
      'createGcpKmsSigner: GCP_KMS_MASTER_SIGNER_VERSION is required ' +
        '(see GCP-KMS-IMPLEMENTATION-PLAN.md § G3).',
    )
  }
  if (!MASTER_SIGNER_VERSION_PATTERN.test(env.GCP_KMS_MASTER_SIGNER_VERSION)) {
    throw new Error(
      'createGcpKmsSigner: GCP_KMS_MASTER_SIGNER_VERSION must match ' +
        '`projects/<id>/locations/<loc>/keyRings/<ring>/cryptoKeys/<key>/cryptoKeyVersions/<n>` ' +
        `(got: '${env.GCP_KMS_MASTER_SIGNER_VERSION}')`,
    )
  }

  // Build the auth client eagerly (synchronous, no network) so any
  // identifier-env error surfaces at startup. Tests override via
  // `deps.gcpAuthDeps.subjectTokenSupplier`.
  const authClient = createGcpAuthClient(env, deps.gcpAuthDeps)

  const computeCrc32c = deps.computeCrc32c ?? crc32c
  const keyId = env.GCP_KMS_MASTER_SIGNER_VERSION
  const versionSuffix = extractVersionSuffix(keyId)
  // Pattern validation above ensures we always have a suffix here.
  const keyVersion = `gcp-kms:${versionSuffix ?? 'primary'}`

  // Lazy-cached KMS client. First call triggers construction; subsequent
  // calls reuse it.
  let kmsClientCache: SignerKmsClientLike | null = null
  function getKmsClient(): SignerKmsClientLike {
    if (kmsClientCache) return kmsClientCache
    if (deps.kmsClientFactory) {
      kmsClientCache = deps.kmsClientFactory(authClient)
    } else {
      // The real Google client accepts `authClient` via the gax client
      // options. The typed surface admits it directly.
      const real = new KeyManagementServiceClient({
        authClient,
      } as unknown as ConstructorParameters<typeof KeyManagementServiceClient>[0])
      // Adapt the real client to SignerKmsClientLike — same method names
      // and tuple-response shape, narrower types.
      kmsClientCache = {
        getPublicKey: (req) =>
          real.getPublicKey(req) as unknown as ReturnType<
            SignerKmsClientLike['getPublicKey']
          >,
        asymmetricSign: (req) =>
          real.asymmetricSign(req) as unknown as ReturnType<
            SignerKmsClientLike['asymmetricSign']
          >,
      }
    }
    return kmsClientCache
  }

  // Lifetime cache for the public key + derived address. One
  // `getPublicKey` round-trip per signer instance.
  let cachedAddress: `0x${string}` | undefined
  let cachedRawPubkey: Uint8Array | undefined // 64 bytes (X || Y) for recovery-id match
  let pubkeyFetchInflight: Promise<void> | undefined

  async function fetchAndCachePubkey(): Promise<void> {
    if (cachedAddress && cachedRawPubkey) return
    if (pubkeyFetchInflight) return pubkeyFetchInflight
    pubkeyFetchInflight = (async () => {
      try {
        const kms = getKmsClient()
        const [resp] = await kms.getPublicKey({ name: keyId })
        if (!resp.pem || resp.pem.length === 0) {
          throw new Error('gcp-kms-signer: getPublicKey returned no PEM key material')
        }
        const spki = pemToSpkiBytes(resp.pem)
        // DER SubjectPublicKeyInfo → 65-byte SEC1 uncompressed point (0x04 || X || Y).
        // Shared extractor with the AWS path; secp256k1 SPKI has the same
        // shape regardless of which cloud KMS produced it.
        const sec1 = extractSec1FromSpki(spki)
        const rawPubkey = sec1.slice(1) // 64 bytes (X || Y)
        const addrBytes = keccak_256(rawPubkey).slice(-20)
        cachedRawPubkey = rawPubkey
        cachedAddress = (`0x${bytesToHex(addrBytes)}`) as `0x${string}`
      } catch (err) {
        // Preserve our own pre-shaped errors verbatim.
        if (err instanceof Error && /^gcp-kms-signer:/.test(err.message)) {
          throw err
        }
        // Preserve the underlying Google error code; the operator needs
        // the gRPC status to debug. Re-throw with a contextual prefix so
        // logs can grep for the operation.
        throw err instanceof Error
          ? new Error(`gcp-kms-signer (getPublicKey): ${err.message}`)
          : new Error(`gcp-kms-signer (getPublicKey): ${String(err)}`)
      } finally {
        pubkeyFetchInflight = undefined
      }
    })()
    return pubkeyFetchInflight
  }

  async function safeAudit(event: GcpKmsSignerAuditEvent): Promise<void> {
    if (!deps.audit) return
    try {
      await deps.audit(event)
    } catch (err) {
      // Mirror the AWS signer pattern: never let a failing audit break
      // the cryptographic path. Log to stderr so the operator sees the
      // dropped event.
      console.error('[gcp-kms-signer audit] callback threw:', err)
    }
  }

  return {
    backend: 'gcp-kms' as const,
    keyId,
    keyVersion,

    async getSignerAddress(): Promise<`0x${string}`> {
      await fetchAndCachePubkey()
      return cachedAddress!
    },

    async signA2AAction({
      canonicalPayload,
      accountAddress,
      chainId,
      sessionId,
      actionId,
      digest,
    }) {
      await fetchAndCachePubkey()
      const msgHash =
        digest ??
        buildCanonicalDigest({ canonicalPayload, accountAddress, chainId, sessionId, actionId })
      if (msgHash.length !== 32) {
        throw new Error(
          `gcp-kms-signer: digest must be 32 bytes (got ${msgHash.length})`,
        )
      }

      const digestCrc = computeCrc32c(msgHash)
      let resp: Awaited<ReturnType<SignerKmsClientLike['asymmetricSign']>>[0]
      try {
        const kms = getKmsClient()
        const [r] = await kms.asymmetricSign({
          name: keyId,
          digest: { sha256: msgHash },
          digestCrc32c: { value: digestCrc.toString() },
        })
        resp = r
      } catch (err) {
        // Preserve the underlying Google error code (PERMISSION_DENIED,
        // NOT_FOUND, FAILED_PRECONDITION for disabled/destroyed versions,
        // RESOURCE_EXHAUSTED for rate limit, etc.). The operator needs
        // the gRPC status to debug.
        throw err instanceof Error
          ? new Error(`gcp-kms-signer (sign): ${err.message}`)
          : new Error(`gcp-kms-signer (sign): ${String(err)}`)
      }

      // KMS-side echo: "the digest bytes I received hash to the CRC you
      // sent". A `false` here means the request was corrupted between
      // Node and Cloud KMS — refuse to use a signature that was produced
      // over uncertain input.
      if (resp.verifiedDigestCrc32c !== true) {
        throw new Error(
          'gcp-kms-signer: CRC32C integrity check failed on sign digest ' +
            '(KMS-side verifiedDigestCrc32c was not true — network corruption on request)',
        )
      }

      const signatureDer = toUint8Array(resp.signature, 'response.signature (sign)')
      // KMS-side claim: "here is the CRC of the signature I sent back".
      // Recompute locally; if they disagree, the response was corrupted
      // in flight.
      const responseSigCrc = readCrc32c(resp.signatureCrc32c, 'response.signatureCrc32c')
      const localSigCrc = computeCrc32c(signatureDer)
      if (responseSigCrc !== localSigCrc) {
        throw new Error(
          `gcp-kms-signer: CRC32C integrity check failed on sign signature ` +
            `(response said ${responseSigCrc.toString(16)}, computed ${localSigCrc.toString(16)})`,
        )
      }

      // DER decode → (r, s). Shared parser with the AWS path.
      const { r, s: sRaw } = parseDerSignature(signatureDer)

      // Defensive low-S normalization (EIP-2). Google CLAIMS to always
      // emit lower-S for secp256k1, but we verify. If we ever have to
      // fix it, fire a separate audit event so the operator notices.
      let s = sRaw
      let normalized = false
      if (sRaw > SECP256K1_N_HALF) {
        s = SECP256K1_N - sRaw
        normalized = true
      }

      const recovery = deriveRecoveryId(msgHash, r, s, cachedRawPubkey!)

      // Pack r || s || v=recovery+27 (EIP-191 / ERC-1271 convention).
      const sig = new Uint8Array(65)
      sig.set(bigIntTo32Bytes(r), 0)
      sig.set(bigIntTo32Bytes(s), 32)
      sig[64] = recovery + 27

      if (normalized) {
        // Best-effort observability event: GCP returned high-S, we
        // defensively flipped. Emitted BEFORE the standard `'sign'`
        // event so an operator scanning the audit chain sees the
        // anomaly in order with the sign that consumed it.
        await safeAudit({
          keyId,
          signerAddress: cachedAddress!,
          sessionId,
          actionId,
          accountAddress,
          chainId,
          kind: 'low-s-normalized',
        })
      }

      // Standard `'sign'` audit event. Mirror of AWS signer behaviour:
      // emitted AFTER the signature is fully derived, best-effort; a
      // failing audit must not cancel a returned signature (the call
      // already committed at KMS).
      await safeAudit({
        keyId,
        signerAddress: cachedAddress!,
        sessionId,
        actionId,
        accountAddress,
        chainId,
        kind: 'sign',
      })

      return {
        signature: sig,
        keyId,
        signerAddress: cachedAddress!,
      }
    },
  }
}
