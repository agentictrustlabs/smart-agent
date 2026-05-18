/**
 * GCP Cloud KMS HMAC provider (GCP-KMS G-PR-5 — inter-service MAC).
 *
 * Implements the `KmsMacProvider` interface against Google Cloud KMS MAC
 * keys via Workload Identity Federation. Sibling of `aws-kms-mac.ts`; same
 * interface, same call-site contract, same canonical-v2 message format
 * (`${ts}|${nonce}|${path}|${sha256(body)}`). Only the signing primitive
 * differs.
 *
 * Required KMS key configuration (operator MUST provision this exact shape):
 *
 *   gcloud kms keys create mac-web-to-a2a \
 *     --location <loc> --keyring <ring> \
 *     --purpose mac \
 *     --default-algorithm hmac-sha256
 *
 * The provider pins a SPECIFIC `cryptoKeyVersion` (env
 * `GCP_KMS_MAC_<MAC_KEY_ID>_VERSION` = `projects/.../cryptoKeyVersions/<n>`)
 * because each version is an independent secret. Rotation = new version +
 * env update + redeploy. This matches the AWS path's pinning behaviour
 * (the AWS HMAC key id is immutable; GCP needs the version suffix to be
 * immutable). See GCP-KMS-IMPLEMENTATION-PLAN.md § G5 for the full design.
 *
 * MAC pipeline (mirror of `aws-kms-mac.ts` but with CRC32C tripwires):
 *
 *   `generateMac({ canonicalMessage })`:
 *     1. Compute CRC32C(canonicalMessage).
 *     2. Call `kms.macSign({ name, data, dataCrc32c })`.
 *     3. Verify `response.verifiedDataCrc32c === true` — KMS-side echo
 *        of "the bytes I received hash to the CRC you sent". A `false`
 *        here means the request was corrupted in flight.
 *     4. Verify `response.macCrc32c` against our local computation of
 *        `CRC32C(response.mac)` — KMS-side claim of "here is the CRC of
 *        the bytes I sent back"; divergence means response corruption.
 *     5. Return `{ mac, keyId: keyVersionPath }`.
 *
 *   `verifyMac({ canonicalMessage, mac })`:
 *     1. Compute CRC32C(canonicalMessage) and CRC32C(mac).
 *     2. Call `kms.macVerify({ name, data, dataCrc32c, mac, macCrc32c })`.
 *     3. Verify `response.verifiedDataCrc32c === true` AND
 *        `response.verifiedMacCrc32c === true`.
 *     4. Return `{ valid: !!response.success }`. Soft-fail on
 *        `success: false` — do NOT throw. (Match AWS arm's behaviour.)
 *     5. Throw only on transport/IAM errors with the underlying gRPC
 *        code preserved in the message.
 *
 * Error handling: KMS API errors (gRPC status codes — PERMISSION_DENIED,
 * NOT_FOUND, FAILED_PRECONDITION when the key version is destroyed /
 * disabled, RESOURCE_EXHAUSTED for rate limits) are re-thrown with the
 * underlying Google error code preserved in the message
 * (`gcp-kms-mac (sign|verify): <original>`). The operator needs the gRPC
 * status to debug; mapping to AWS-style operator strings would lose
 * information.
 *
 * Substrate-independence (P1): `@google-cloud/kms` is approved for this
 * file (the SDK's `key-custody/` directory); `scripts/check-no-bypass.sh`
 * enforces the isolation rule. The application imports `KmsMacProvider`
 * — never the Google SDK directly.
 */
import { KeyManagementServiceClient } from '@google-cloud/kms'
import type { BaseExternalAccountClient } from 'google-auth-library'
import {
  createGcpAuthClient,
  type GcpAuthEnv,
  type GcpAuthDeps,
} from './gcp-auth'
import { crc32c } from './crc32c'
import type { KmsMacProvider } from './aws-kms-mac'
import type { MacKeyId } from './mac-provider-factory'

/**
 * Environment for `createGcpKmsMacProvider`.
 *
 * `keyVersionPath` is a FULLY-VERSIONED resource path
 * (`projects/.../cryptoKeyVersions/<n>`). Each version is an independent
 * MAC secret, so the provider must pin to a specific version — otherwise
 * a server-side rotation would silently swap the verification key.
 *
 * The exact env-var name that supplies `keyVersionPath` is per-edge:
 * `GCP_KMS_MAC_<MAC_KEY_ID>_VERSION` (resolved by `mac-provider-factory.ts`).
 */
export interface GcpKmsMacEnv extends GcpAuthEnv {
  /**
   * Fully-qualified cryptoKeyVersion resource path of the MAC key for one
   * inter-service edge. Format:
   *   projects/<project>/locations/<loc>/keyRings/<ring>/cryptoKeys/<key>/cryptoKeyVersions/<n>
   *
   * The trailing `/cryptoKeyVersions/<n>` is REQUIRED — `macSign` and
   * `macVerify` operate on a SPECIFIC version, not the parent key. See
   * GCP-KMS-IMPLEMENTATION-PLAN.md § G5.
   */
  readonly keyVersionPath: string
}

/**
 * Minimal interface the provider needs from the Google KMS client. Used
 * by `GcpKmsMacDeps.kmsClientFactory` to inject test stubs without
 * depending on the full `KeyManagementServiceClient` surface. The real
 * client returns `[response]` tuples; we keep that shape.
 */
export interface MacKmsClientLike {
  macSign(request: {
    name: string
    data: Uint8Array
    dataCrc32c?: { value: string } | null
  }): Promise<
    [
      {
        name?: string | null
        mac?: Uint8Array | Buffer | string | null
        macCrc32c?: { value?: string | number | null } | null
        verifiedDataCrc32c?: boolean | null
      },
    ]
  >
  macVerify(request: {
    name: string
    data: Uint8Array
    dataCrc32c?: { value: string } | null
    mac: Uint8Array
    macCrc32c?: { value: string } | null
  }): Promise<
    [
      {
        name?: string | null
        success?: boolean | null
        verifiedDataCrc32c?: boolean | null
        verifiedMacCrc32c?: boolean | null
        verifiedSuccessIntegrity?: boolean | null
      },
    ]
  >
}

/**
 * Optional dependencies (test-injectable). Production callers omit this
 * argument; tests inject a `kmsClientFactory` stub.
 */
export interface GcpKmsMacDeps {
  /**
   * Override for the KMS client. Receives the authenticated
   * `BaseExternalAccountClient` (production wires it via
   * `createGcpAuthClient(env)`); tests inject a hand-built stub
   * implementing `MacKmsClientLike`.
   */
  kmsClientFactory?: (authClient: BaseExternalAccountClient) => MacKmsClientLike
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
}

/**
 * Public shape returned by `createGcpKmsMacProvider`. Mirrors the AWS MAC
 * provider plus a backend tag (`'gcp-kms'`) and the pinned key id +
 * version, so the a2a-agent factory wiring
 * (`apps/a2a-agent/src/auth/mac-provider.ts`) can identify the backend
 * without an `instanceof` check.
 */
export interface GcpKmsMacProvider extends KmsMacProvider {
  readonly backend: 'gcp-kms'
  readonly macKeyId: MacKeyId
  readonly keyVersionPath: string
}

/** Coerce a Uint8Array | Buffer | string KMS payload to Uint8Array. */
function toUint8Array(
  value: Uint8Array | Buffer | string | null | undefined,
  context: string,
): Uint8Array {
  if (value == null) {
    throw new Error(`gcp-kms-mac: missing ${context} in KMS response`)
  }
  if (typeof value === 'string') {
    return new Uint8Array(Buffer.from(value, 'base64'))
  }
  if (value instanceof Uint8Array) return value
  return new Uint8Array(value as ArrayLike<number>)
}

/**
 * Coerce an Int64Value-shaped CRC field to a bigint. Same shape used in
 * `gcp-kms-provider.ts` and `gcp-kms-signer.ts`.
 */
function readCrc32c(
  field: { value?: string | number | null } | null | undefined,
  context: string,
): bigint {
  if (field == null || field.value == null) {
    throw new Error(`gcp-kms-mac: missing ${context} in KMS response`)
  }
  if (typeof field.value === 'string') return BigInt(field.value)
  return BigInt(field.value)
}

/**
 * Extract the trailing version suffix from a cryptoKeyVersion resource
 * path. Input:
 *   `projects/.../cryptoKeyVersions/3`
 * Output: `3`.
 */
function extractVersionSuffix(resourceName: string): string | null {
  const idx = resourceName.lastIndexOf('/cryptoKeyVersions/')
  if (idx < 0) return null
  const suffix = resourceName.slice(idx + '/cryptoKeyVersions/'.length)
  return suffix.length > 0 ? suffix : null
}

const MAC_KEY_VERSION_PATTERN =
  /^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+\/cryptoKeyVersions\/[^/]+$/

/**
 * Construct the GCP Cloud KMS MAC provider for one inter-service edge.
 *
 * Validates env synchronously; does NOT contact Google until the first
 * `generateMac` / `verifyMac` call. The OIDC token is resolved at request
 * scope inside the `BaseExternalAccountClient`, never at module load
 * (Vercel Function topology has no request context then).
 *
 * Mirrors the AWS MAC provider's sync-construct + lazy-client pattern.
 *
 * @throws if env is missing or `keyVersionPath` doesn't match the
 *         fully-versioned resource path pattern.
 */
export function createGcpKmsMacProvider(
  env: GcpKmsMacEnv,
  macKeyId: MacKeyId,
  deps: GcpKmsMacDeps = {},
): GcpKmsMacProvider {
  if (!env.keyVersionPath || env.keyVersionPath.trim().length === 0) {
    throw new Error(
      'createGcpKmsMacProvider: keyVersionPath is required ' +
        '(see GCP-KMS-IMPLEMENTATION-PLAN.md § G5).',
    )
  }
  if (!MAC_KEY_VERSION_PATTERN.test(env.keyVersionPath)) {
    throw new Error(
      'createGcpKmsMacProvider: keyVersionPath must match ' +
        '`projects/<id>/locations/<loc>/keyRings/<ring>/cryptoKeys/<key>/cryptoKeyVersions/<n>` ' +
        `(got: '${env.keyVersionPath}')`,
    )
  }

  // Build the auth client eagerly (synchronous, no network) so any
  // identifier-env error surfaces at startup. Tests override via
  // `deps.gcpAuthDeps.subjectTokenSupplier`.
  const authClient = createGcpAuthClient(env, deps.gcpAuthDeps)

  const computeCrc32c = deps.computeCrc32c ?? crc32c
  const keyVersionPath = env.keyVersionPath
  const versionSuffix = extractVersionSuffix(keyVersionPath)
  // Pattern validation above guarantees a non-null suffix.
  const keyVersion = `gcp-kms:${versionSuffix ?? 'primary'}`

  // Lazy-cached KMS client. First call triggers construction; subsequent
  // calls reuse it.
  let kmsClientCache: MacKmsClientLike | null = null
  function getKmsClient(): MacKmsClientLike {
    if (kmsClientCache) return kmsClientCache
    if (deps.kmsClientFactory) {
      kmsClientCache = deps.kmsClientFactory(authClient)
    } else {
      // The real Google client accepts `authClient` via the gax client
      // options. The typed surface admits it directly.
      const real = new KeyManagementServiceClient({
        authClient,
      } as unknown as ConstructorParameters<typeof KeyManagementServiceClient>[0])
      // Adapt the real client to MacKmsClientLike — same method names
      // and tuple-response shape, narrower types.
      kmsClientCache = {
        macSign: (req) =>
          real.macSign(req) as unknown as ReturnType<MacKmsClientLike['macSign']>,
        macVerify: (req) =>
          real.macVerify(req) as unknown as ReturnType<
            MacKmsClientLike['macVerify']
          >,
      }
    }
    return kmsClientCache
  }

  return {
    backend: 'gcp-kms' as const,
    macKeyId,
    keyVersionPath,

    async generateMac({ canonicalMessage }) {
      const dataCrc = computeCrc32c(canonicalMessage)

      let resp: Awaited<ReturnType<MacKmsClientLike['macSign']>>[0]
      try {
        const kms = getKmsClient()
        const [r] = await kms.macSign({
          name: keyVersionPath,
          data: canonicalMessage,
          dataCrc32c: { value: dataCrc.toString() },
        })
        resp = r
      } catch (err) {
        // Preserve the underlying Google error code (PERMISSION_DENIED,
        // NOT_FOUND, FAILED_PRECONDITION for disabled/destroyed versions,
        // RESOURCE_EXHAUSTED for rate limit, etc.). The operator needs
        // the gRPC status to debug.
        throw err instanceof Error
          ? new Error(`gcp-kms-mac (sign): ${err.message}`)
          : new Error(`gcp-kms-mac (sign): ${String(err)}`)
      }

      // KMS-side echo: "the data bytes I received hash to the CRC you
      // sent". A `false` here means the request was corrupted between
      // Node and Cloud KMS — refuse to use a MAC that was produced over
      // uncertain input.
      if (resp.verifiedDataCrc32c !== true) {
        throw new Error(
          'gcp-kms-mac: CRC32C integrity check failed on sign data ' +
            '(KMS-side verifiedDataCrc32c was not true — network corruption on request)',
        )
      }

      const macBytes = toUint8Array(resp.mac, 'response.mac (sign)')
      // KMS-side claim: "here is the CRC of the MAC I sent back".
      // Recompute locally; if they disagree, the response was corrupted
      // in flight.
      const responseMacCrc = readCrc32c(resp.macCrc32c, 'response.macCrc32c')
      const localMacCrc = computeCrc32c(macBytes)
      if (responseMacCrc !== localMacCrc) {
        throw new Error(
          `gcp-kms-mac: CRC32C integrity check failed on sign mac ` +
            `(response said ${responseMacCrc.toString(16)}, computed ${localMacCrc.toString(16)})`,
        )
      }

      return {
        mac: macBytes,
        keyId: keyVersionPath,
        // `keyVersion` is part of the GcpKmsMacProvider readonly fields
        // but not part of the base KmsMacProvider return shape — callers
        // who care about provenance read `provider.keyVersionPath` /
        // `provider.macKeyId` directly. Documented here for forensics.
      } as { mac: Uint8Array; keyId: string }
    },

    async verifyMac({ canonicalMessage, mac }) {
      const dataCrc = computeCrc32c(canonicalMessage)
      const macCrc = computeCrc32c(mac)

      let resp: Awaited<ReturnType<MacKmsClientLike['macVerify']>>[0]
      try {
        const kms = getKmsClient()
        const [r] = await kms.macVerify({
          name: keyVersionPath,
          data: canonicalMessage,
          dataCrc32c: { value: dataCrc.toString() },
          mac,
          macCrc32c: { value: macCrc.toString() },
        })
        resp = r
      } catch (err) {
        // Preserve the underlying Google error code. KMS-side input
        // validation errors (malformed mac length, key disabled, etc.)
        // surface here.
        throw err instanceof Error
          ? new Error(`gcp-kms-mac (verify): ${err.message}`)
          : new Error(`gcp-kms-mac (verify): ${String(err)}`)
      }

      // KMS-side echo of "the data + mac CRCs I received hash to the
      // values you sent". A `false` here means the request was corrupted
      // between Node and Cloud KMS — refuse to trust the success flag.
      if (resp.verifiedDataCrc32c !== true) {
        throw new Error(
          'gcp-kms-mac: CRC32C integrity check failed on verify data ' +
            '(KMS-side verifiedDataCrc32c was not true — network corruption on request)',
        )
      }
      if (resp.verifiedMacCrc32c !== true) {
        throw new Error(
          'gcp-kms-mac: CRC32C integrity check failed on verify mac ' +
            '(KMS-side verifiedMacCrc32c was not true — network corruption on request)',
        )
      }

      // Soft-fail: the middleware always wants a boolean. The `success`
      // flag on macVerify is set to `true` ONLY when the MAC is valid;
      // a tampered MAC OR a tampered canonical message both surface as
      // `success: false` — same shape AWS returns for MacValid=false.
      return {
        valid: resp.success === true,
        keyId: keyVersionPath,
      }
    },
  }
}
