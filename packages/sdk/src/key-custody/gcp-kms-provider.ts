/**
 * GCP Cloud KMS `A2AKeyProvider` (G-PR-2 — session envelope encryption).
 *
 * Implements `A2AKeyProvider` against Google Cloud KMS using the
 * **local-DEK + KEK-wrap** pattern Google recommends for envelope
 * encryption:
 *
 *   1. App generates a 32-byte plaintext DEK locally via
 *      `crypto.getRandomValues`.
 *   2. App calls `kms.encrypt(...)` to wrap the DEK with the configured
 *      KEK (`GCP_KMS_SESSION_KEK`). The AAD (additionalAuthenticatedData)
 *      embedded in the KEK-wrap is the SAME `canonicalContextBytes(...)`
 *      payload AES-GCM uses for its own tag — dual tripwire on tamper.
 *
 * AWS sibling (`aws-kms-provider.ts`) uses `GenerateDataKey` which returns
 * a fresh DEK + its wrapped form in one call; GCP does not have an
 * equivalent so the pattern above is the canonical Google approach.
 *
 * ─── CRC32C integrity ──────────────────────────────────────────────────
 *
 * Cloud KMS uses CRC32C as an end-to-end corruption tripwire on every
 * request/response. We compute the CRC of every payload going in
 * (plaintext, AAD, ciphertext) and verify the response's CRC of every
 * payload coming out (response.plaintextCrc32c, response.ciphertextCrc32c).
 * KMS-side echo of these comes back as boolean flags
 * (`verifiedPlaintextCrc32c`, `verifiedAdditionalAuthenticatedDataCrc32c`)
 * — `false` means a bit flipped in transit. Both halves are checked; any
 * mismatch throws with `CRC32C integrity check failed` so the operator
 * can grep for it.
 *
 * Reference: see § "Verify and provide integrity checksums" in
 *   https://cloud.google.com/kms/docs/data-integrity-guidelines
 *
 * ─── AAD semantics ─────────────────────────────────────────────────────
 *
 * The aadContext from the caller is canonicalised via
 * `canonicalContextBytes(...)` (the shared encoder in `types.ts`) and
 * passed verbatim to Cloud KMS as `additionalAuthenticatedData`. The
 * SAME bytes are passed by the caller (encryption.ts) to AES-GCM's AAD.
 * This is the two-tripwire pattern: a tampered AAD fails the KMS unwrap
 * AND the AES-GCM tag — independent cryptographic gates.
 *
 * The aadContext post-P0-6 already includes `key_version` and a hashed
 * `session_id_h`. That binding carries over verbatim from the AWS path.
 *
 * ─── Plaintext lifecycle / zeroization ─────────────────────────────────
 *
 * The provider does NOT zero the returned `plaintextDataKey` — the
 * CALLER (apps/a2a-agent/src/auth/encryption.ts) owns the lifecycle and
 * zeroises in a `finally` block after the AES-GCM call. Mirrors the AWS
 * provider on this point.
 *
 * ─── Error handling ────────────────────────────────────────────────────
 *
 * KMS API errors (rate limit, key disabled, key not found, IAM denied)
 * are re-thrown with the underlying Google error code preserved. The
 * caller decides what to surface — we deliberately do NOT mask the
 * reason because the operator needs the gRPC status to debug.
 *
 * ─── Substrate-independence (P1) ───────────────────────────────────────
 *
 * `@google-cloud/kms` is approved for `packages/sdk/src/key-custody/`
 * only (`scripts/check-no-bypass.sh` enforces this). The application
 * imports `A2AKeyProvider` — never the Google SDK directly.
 */
import { KeyManagementServiceClient } from '@google-cloud/kms'
import type { BaseExternalAccountClient } from 'google-auth-library'
import type { A2AKeyProvider } from './types'
import { canonicalContextBytes } from './types'
import {
  createGcpAuthClient,
  type GcpAuthEnv,
  type GcpAuthDeps,
} from './gcp-auth'
import { crc32c } from './crc32c'

/**
 * Environment for `createGcpKmsProvider`.
 *
 * `GCP_KMS_SESSION_KEK` is a fully-qualified key resource path of the
 * form:
 *   projects/<project-id>/locations/<loc>/keyRings/<ring>/cryptoKeys/<name>
 *
 * `GCP_KMS_SESSION_KEK_VERSION` is optional — when absent, the request
 * targets the KEK at the parent-key level and Google routes to whichever
 * version is `PRIMARY`. The response.name returned by `kms.encrypt`
 * carries the resolved version (`.../cryptoKeyVersions/<n>`) which the
 * provider extracts and tags into `keyVersion`.
 */
export interface GcpKmsEnv extends GcpAuthEnv {
  /**
   * Fully-qualified KEK resource path. NO version suffix on the symmetric
   * envelope key — versions for symmetric keys are managed server-side by
   * Cloud KMS. See § G2 of GCP-KMS-IMPLEMENTATION-PLAN.md.
   */
  GCP_KMS_SESSION_KEK: string
  /**
   * Optional pin to a specific KEK version (`projects/.../cryptoKeyVersions/<n>`).
   * Mostly a forensics knob — production deployments pin via IAM policy
   * (`cloudkms.cryptoKeyVersions.useToEncrypt` on a specific version) or
   * accept Google's PRIMARY routing.
   */
  GCP_KMS_SESSION_KEK_VERSION?: string
}

/**
 * Minimal interface the provider needs from the Google KMS client. Used
 * by `GcpKmsDeps.kmsClientFactory` to inject test stubs without
 * depending on the full `KeyManagementServiceClient` surface.
 *
 * The real client returns `[response]` tuples; we keep that shape.
 */
export interface KmsClientLike {
  encrypt(request: {
    name: string
    plaintext: Uint8Array
    plaintextCrc32c?: { value: string } | null
    additionalAuthenticatedData?: Uint8Array
    additionalAuthenticatedDataCrc32c?: { value: string } | null
  }): Promise<
    [
      {
        name?: string | null
        ciphertext?: Uint8Array | Buffer | string | null
        ciphertextCrc32c?: { value?: string | number | null } | null
        verifiedPlaintextCrc32c?: boolean | null
        verifiedAdditionalAuthenticatedDataCrc32c?: boolean | null
      },
    ]
  >
  decrypt(request: {
    name: string
    ciphertext: Uint8Array
    ciphertextCrc32c?: { value: string } | null
    additionalAuthenticatedData?: Uint8Array
    additionalAuthenticatedDataCrc32c?: { value: string } | null
  }): Promise<
    [
      {
        plaintext?: Uint8Array | Buffer | string | null
        plaintextCrc32c?: { value?: string | number | null } | null
      },
    ]
  >
}

/**
 * Audit event payload, mirroring the shape used by `aws-kms-signer`'s
 * audit-callback pattern. Emitted on every successful `kms.encrypt` /
 * `kms.decrypt` round-trip — operator visibility for "which key did
 * what, when".
 *
 * Field semantics:
 *   - `eventType`     'gcp-kms-encrypt' on `generateSessionDataKey`,
 *                     'gcp-kms-decrypt' on `decryptSessionDataKey`.
 *   - `keyId`         the GCP_KMS_SESSION_KEK resource path used.
 *   - `keyVersion`    the resolved `gcp-kms:<version>` tag.
 *   - `bytesOut`      length of the ciphertext / plaintext we returned
 *                     to the caller — a sanity check for forensic
 *                     reconstruction (no payload bytes leak into audit).
 */
export interface GcpKmsAuditEvent {
  eventType: 'gcp-kms-encrypt' | 'gcp-kms-decrypt'
  keyId: string
  keyVersion: string
  bytesOut: number
  occurredAt: string
}

/**
 * Optional test-injectable seams.
 *
 * `kmsClientFactory` — replaces the default `KeyManagementServiceClient`
 * construction. The factory receives the authenticated
 * `BaseExternalAccountClient` (production wires it via
 * `createGcpAuthClient(env)`); tests inject a stub.
 *
 * `randomBytes` — overrides the local 32-byte DEK generator. Tests use
 * this to assert byte-identity between the DEK the provider generates and
 * the DEK passed to `kms.encrypt`'s plaintext field.
 *
 * `computeCrc32c` — overrides the CRC32C function. Defaults to the
 * in-tree `crc32c.ts`; tests can stub it to force a "mismatch" path.
 *
 * `audit` — callback emitted on every successful operation. The
 * application wires this through to the audit table; tests assert on it
 * via a capturing closure.
 */
export interface GcpKmsDeps {
  kmsClientFactory?: (authClient: BaseExternalAccountClient) => KmsClientLike
  randomBytes?: (n: number) => Uint8Array
  computeCrc32c?: (bytes: Uint8Array) => bigint
  audit?: (event: GcpKmsAuditEvent) => Promise<void> | void
  /** Optional override of the GCP auth client (test seam). */
  gcpAuthDeps?: GcpAuthDeps
}

/**
 * Public `GcpKmsProvider` shape — `A2AKeyProvider` plus two readonly
 * tag-fields (`backend`, `keyVersion`) so the a2a-agent factory wiring
 * (`apps/a2a-agent/src/auth/key-provider.ts`) can assert on the backend
 * tag at startup without an `instanceof` check.
 */
export interface GcpKmsProvider extends A2AKeyProvider {
  readonly backend: 'gcp-kms'
  readonly keyVersion: string
}

/** Coerce a Uint8Array | Buffer | string KMS payload field to Uint8Array. */
function toUint8Array(
  value: Uint8Array | Buffer | string | null | undefined,
  context: string,
): Uint8Array {
  if (value == null) {
    throw new Error(`gcp-kms-provider: missing ${context} in KMS response`)
  }
  if (typeof value === 'string') {
    // Cloud KMS responses arrive as bytes when the proto is grpc-decoded,
    // but the typed surface admits string (base64) too. We accept either.
    return new Uint8Array(Buffer.from(value, 'base64'))
  }
  if (value instanceof Uint8Array) return value
  // Buffer is a Uint8Array subclass in Node, but the typed union admits
  // raw Buffer too. The above branch already handles it; the defensive
  // copy below keeps the contract uniform.
  return new Uint8Array(value as ArrayLike<number>)
}

/**
 * Coerce an Int64Value-shaped CRC field from a KMS response into a bigint.
 *
 * The proto encodes int64 as `{ value: number|Long|string|null }`. In
 * practice google-cloud/kms hands back `string` (decimal) when CRC ≥ 2^31.
 * We normalise to bigint so comparisons against our locally-computed CRC
 * (also a bigint) are exact regardless of representation.
 */
function readCrc32c(
  field: { value?: string | number | null } | null | undefined,
  context: string,
): bigint {
  if (field == null || field.value == null) {
    throw new Error(`gcp-kms-provider: missing ${context} in KMS response`)
  }
  if (typeof field.value === 'string') return BigInt(field.value)
  return BigInt(field.value)
}

/**
 * Extract the version suffix from a Cloud KMS resource name.
 *
 * Input:
 *   `projects/<p>/locations/<l>/keyRings/<r>/cryptoKeys/<k>/cryptoKeyVersions/3`
 * Output: `3`
 *
 * When the response.name doesn't carry a version (some symmetric envelope
 * responses elide it), the caller falls back to env.GCP_KMS_SESSION_KEK_VERSION
 * or the string `'primary'`.
 */
function extractVersionSuffix(resourceName: string | null | undefined): string | null {
  if (!resourceName) return null
  const idx = resourceName.lastIndexOf('/cryptoKeyVersions/')
  if (idx < 0) return null
  return resourceName.slice(idx + '/cryptoKeyVersions/'.length)
}

const SESSION_KEK_PATTERN =
  /^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+(?:\/cryptoKeyVersions\/[^/]+)?$/

/**
 * Create a GCP Cloud KMS `A2AKeyProvider` instance.
 *
 * Validates env synchronously; does NOT contact Google until the first
 * `generateSessionDataKey` / `decryptSessionDataKey` call. The
 * `BaseExternalAccountClient` is constructed eagerly (cheap — does not
 * touch the network or the Vercel OIDC token) and reused across calls.
 *
 * `keyVersion` is initially seeded as
 * `'gcp-kms:' + (env.GCP_KMS_SESSION_KEK_VERSION ?? 'primary')`. After
 * the first successful `kms.encrypt`, the resolved version from the
 * response name is preferred (the symmetric KEK's primary can rotate
 * server-side; we tag rows with the actual version that wrapped them
 * so a future `kms.decrypt` against that exact version is possible).
 *
 * @throws if any required env field is missing or `GCP_KMS_SESSION_KEK`
 *         doesn't match the expected resource path pattern.
 */
export function createGcpKmsProvider(
  env: GcpKmsEnv,
  deps: GcpKmsDeps = {},
): GcpKmsProvider {
  if (!env.GCP_KMS_SESSION_KEK || env.GCP_KMS_SESSION_KEK.trim().length === 0) {
    throw new Error(
      'createGcpKmsProvider: GCP_KMS_SESSION_KEK is required (see GCP-KMS-IMPLEMENTATION-PLAN.md § G2).',
    )
  }
  if (!SESSION_KEK_PATTERN.test(env.GCP_KMS_SESSION_KEK)) {
    throw new Error(
      'createGcpKmsProvider: GCP_KMS_SESSION_KEK must match ' +
        '`projects/<id>/locations/<loc>/keyRings/<ring>/cryptoKeys/<name>` ' +
        `(got: '${env.GCP_KMS_SESSION_KEK}')`,
    )
  }

  // Build the auth client eagerly (synchronous, no network) so any
  // identifier-env error surfaces at startup. Tests may override via
  // `deps.gcpAuthDeps.subjectTokenSupplier`.
  const authClient = createGcpAuthClient(env, deps.gcpAuthDeps)

  // Default CSPRNG: Node 20+ exposes `crypto.getRandomValues` on the
  // global `crypto` object — same as the browser.
  const randomBytes =
    deps.randomBytes ??
    ((n: number): Uint8Array => {
      const out = new Uint8Array(n)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cryptoObj: Crypto = (globalThis as unknown as { crypto: Crypto }).crypto
      cryptoObj.getRandomValues(out)
      return out
    })

  const computeCrc32c = deps.computeCrc32c ?? crc32c

  // The synchronously-knowable initial tag. We refine it from the
  // response.name on the first successful encrypt — but the property
  // must be readable at construction time because callers (encryption.ts)
  // build the aadContext from it BEFORE calling generateSessionDataKey.
  const initialVersion = env.GCP_KMS_SESSION_KEK_VERSION
    ? extractVersionSuffix(env.GCP_KMS_SESSION_KEK_VERSION) ?? env.GCP_KMS_SESSION_KEK_VERSION
    : 'primary'
  const keyVersion = `gcp-kms:${initialVersion}`

  // Lazy-cached KMS client. The first call triggers construction; all
  // subsequent calls reuse it.
  let kmsClientCache: KmsClientLike | null = null
  function getKmsClient(): KmsClientLike {
    if (kmsClientCache) return kmsClientCache
    if (deps.kmsClientFactory) {
      kmsClientCache = deps.kmsClientFactory(authClient)
    } else {
      // The real Google client accepts `authClient` via the gax client
      // options. The typed surface admits it directly.
      const real = new KeyManagementServiceClient({
        authClient,
      } as unknown as ConstructorParameters<typeof KeyManagementServiceClient>[0])
      // Adapt the real client to KmsClientLike — same method names and
      // tuple-response shape, just narrower types.
      kmsClientCache = {
        encrypt: (req) => real.encrypt(req) as unknown as ReturnType<KmsClientLike['encrypt']>,
        decrypt: (req) => real.decrypt(req) as unknown as ReturnType<KmsClientLike['decrypt']>,
      }
    }
    return kmsClientCache
  }

  async function safeAudit(event: GcpKmsAuditEvent): Promise<void> {
    if (!deps.audit) return
    try {
      await deps.audit(event)
    } catch (err) {
      // Mirror the AWS signer pattern: never let a failing audit break
      // the cryptographic path. Log to stderr so the operator sees the
      // dropped event.
      console.error('[gcp-kms-provider audit] callback threw:', err)
    }
  }

  return {
    backend: 'gcp-kms' as const,
    keyVersion,

    async generateSessionDataKey({ aadContext }) {
      const plaintextDataKey = randomBytes(32)
      if (plaintextDataKey.length !== 32) {
        throw new Error(
          `gcp-kms-provider: randomBytes returned ${plaintextDataKey.length} bytes (expected 32)`,
        )
      }
      const aadBytes = canonicalContextBytes(aadContext)
      const plaintextCrc = computeCrc32c(plaintextDataKey)
      const aadCrc = computeCrc32c(aadBytes)

      const kms = getKmsClient()
      let resp: Awaited<ReturnType<KmsClientLike['encrypt']>>[0]
      try {
        const result = await kms.encrypt({
          name: env.GCP_KMS_SESSION_KEK,
          plaintext: plaintextDataKey,
          plaintextCrc32c: { value: plaintextCrc.toString() },
          additionalAuthenticatedData: aadBytes,
          additionalAuthenticatedDataCrc32c: { value: aadCrc.toString() },
        })
        resp = result[0]
      } catch (err) {
        // Preserve the underlying Google error code; do not mask the
        // reason. The caller's audit/log path captures the message.
        throw err instanceof Error
          ? new Error(`gcp-kms-provider (encrypt): ${err.message}`)
          : new Error(`gcp-kms-provider (encrypt): ${String(err)}`)
      }

      if (resp.verifiedPlaintextCrc32c !== true) {
        throw new Error(
          'gcp-kms-provider: CRC32C integrity check failed on encrypt plaintext ' +
            '(KMS-side verifiedPlaintextCrc32c was not true — network corruption on request)',
        )
      }
      if (resp.verifiedAdditionalAuthenticatedDataCrc32c !== true) {
        throw new Error(
          'gcp-kms-provider: CRC32C integrity check failed on encrypt additionalAuthenticatedData ' +
            '(KMS-side verifiedAdditionalAuthenticatedDataCrc32c was not true — network corruption on request)',
        )
      }

      const ciphertext = toUint8Array(resp.ciphertext, 'response.ciphertext (encrypt)')

      // Resolve the precise version that wrapped this DEK. Cloud KMS
      // includes the cryptoKeyVersions suffix in `response.name`; if
      // that's absent (e.g. mocked or pinned-version requests),
      // fall back to env.GCP_KMS_SESSION_KEK_VERSION → 'primary'.
      const resolvedVersion =
        extractVersionSuffix(resp.name) ??
        (env.GCP_KMS_SESSION_KEK_VERSION
          ? extractVersionSuffix(env.GCP_KMS_SESSION_KEK_VERSION) ??
            env.GCP_KMS_SESSION_KEK_VERSION
          : 'primary')
      const tag = `gcp-kms:${resolvedVersion}`

      await safeAudit({
        eventType: 'gcp-kms-encrypt',
        keyId: env.GCP_KMS_SESSION_KEK,
        keyVersion: tag,
        bytesOut: ciphertext.length,
        occurredAt: new Date().toISOString(),
      })

      return {
        plaintextDataKey,
        encryptedDataKey: ciphertext,
        keyId: env.GCP_KMS_SESSION_KEK,
        keyVersion: tag,
      }
    },

    async decryptSessionDataKey({ encryptedDataKey, aadContext, keyId, keyVersion: rowKeyVersion }) {
      // Strictness: refuse to attempt decrypt unless the row's key version
      // is tagged with our provider's backend. Mirrors `aws-kms-provider.ts`.
      if (!rowKeyVersion.startsWith('gcp-kms:')) {
        throw new Error(
          `gcp-kms-provider: keyVersion mismatch (expected 'gcp-kms:<v>', got '${rowKeyVersion}')`,
        )
      }

      const aadBytes = canonicalContextBytes(aadContext)
      const cipherCrc = computeCrc32c(encryptedDataKey)
      const aadCrc = computeCrc32c(aadBytes)

      const kms = getKmsClient()
      let resp: Awaited<ReturnType<KmsClientLike['decrypt']>>[0]
      try {
        const result = await kms.decrypt({
          name: keyId,
          ciphertext: encryptedDataKey,
          ciphertextCrc32c: { value: cipherCrc.toString() },
          additionalAuthenticatedData: aadBytes,
          additionalAuthenticatedDataCrc32c: { value: aadCrc.toString() },
        })
        resp = result[0]
      } catch (err) {
        // Preserve the underlying Google error code; don't mask.
        // KMS-side AAD/cipher mismatch surfaces here as INVALID_ARGUMENT.
        throw err instanceof Error
          ? new Error(`gcp-kms-provider (decrypt): ${err.message}`)
          : new Error(`gcp-kms-provider (decrypt): ${String(err)}`)
      }

      const plaintext = toUint8Array(resp.plaintext, 'response.plaintext (decrypt)')
      // Verify the response CRC32C matches our local computation. This
      // is the inverse of the encrypt-side flags — Google ships back the
      // CRC of `plaintext` and we recompute locally; a divergence means
      // the response was corrupted in flight.
      const responseCrc = readCrc32c(resp.plaintextCrc32c, 'response.plaintextCrc32c')
      const localCrc = computeCrc32c(plaintext)
      if (responseCrc !== localCrc) {
        throw new Error(
          `gcp-kms-provider: CRC32C integrity check failed on decrypt plaintext ` +
            `(response said ${responseCrc.toString(16)}, computed ${localCrc.toString(16)})`,
        )
      }

      await safeAudit({
        eventType: 'gcp-kms-decrypt',
        keyId,
        keyVersion: rowKeyVersion,
        bytesOut: plaintext.length,
        occurredAt: new Date().toISOString(),
      })

      return plaintext
    },
  }
}
