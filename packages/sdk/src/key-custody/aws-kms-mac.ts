/**
 * AWS KMS HMAC provider (KMS migration K3-extension).
 *
 * Implements the `KmsMacProvider` interface against AWS KMS HMAC keys via
 * Vercel OIDC federation. Replaces the static env-resident HMAC secrets
 * (`WEB_TO_A2A_HMAC_KEY`, `A2A_INTERSERVICE_HMAC_KEY_*`) used by the
 * inter-service auth plane between web/MCPs and a2a-agent.
 *
 * AWS KMS HMAC keys MUST be configured at provisioning time with:
 *   - `KeySpec   = HMAC_256`
 *   - `KeyUsage  = GENERATE_VERIFY_MAC`
 *   - `MacAlgorithms = [HMAC_SHA_256]`
 *
 * Critical caveat (see KMS-IMPLEMENTATION-PLAN.md §13):
 *   AWS KMS HMAC keys do NOT support `EncryptionContext` — that's a
 *   symmetric-encryption-only feature. Therefore ALL the binding metadata
 *   the verifier relies on (timestamp, nonce, audience, route, method,
 *   sha256(body), ...) MUST live inside the canonical message itself. The
 *   call sites in `apps/a2a-agent/src/auth/{inter-service,service-auth-web}.ts`
 *   already build a canonical of the form
 *   `${ts}|${nonce}|${path}|${sha256(body)}`, which is the HMAC-equivalent of
 *   K2's EncryptionContext.
 *
 * Defense-in-depth surfaces (parallels K4 §9):
 *   - Each MAC key is a SEPARATE AWS KMS HMAC key, with its own IAM scope
 *     ("the web role can call kms:GenerateMac on web-to-a2a only; person-mcp
 *     role on a2a-to-person only; a2a-agent role has kms:VerifyMac on all
 *     eight + kms:GenerateMac on the outbound seven a2a→MCP keys").
 *   - CloudTrail audit on every GenerateMac/VerifyMac call.
 *   - Replay-nonce cache (apps/a2a-agent/src/auth/replay-nonce.ts) still
 *     enforced — KMS MAC only authenticates messages, not request freshness.
 *
 * Error mapping (mirrors aws-kms-provider.ts):
 *   - `KMSInvalidMacException` / `KMSInvalidStateException` → "kms mac invalid"
 *   - `AccessDeniedException`                              → "kms unauthorized"
 *   - `ThrottlingException` / `KMSInternalException`       → "kms unreachable"
 *   - Timeout / abort / network                            → "kms unreachable"
 */
import {
  KMSClient,
  GenerateMacCommand,
  VerifyMacCommand,
} from '@aws-sdk/client-kms'
import { awsCredentialsProvider } from '@vercel/oidc-aws-credentials-provider'

/**
 * Provider-neutral HMAC interface — the application depends on this, not on
 * any specific KMS backend. The dev `local-hmac.ts` provider implements the
 * same interface using Node's `crypto.createHmac`.
 */
export interface KmsMacProvider {
  /**
   * Compute an HMAC-SHA256 over the canonical message and return the raw
   * MAC bytes. Callers encode (base64url, hex, …) at the wire boundary.
   */
  generateMac(input: {
    canonicalMessage: Uint8Array
  }): Promise<{ mac: Uint8Array; keyId: string }>

  /**
   * Verify an HMAC-SHA256 over the canonical message in constant time.
   * Returns `valid: true` only when the MAC matches.
   */
  verifyMac(input: {
    canonicalMessage: Uint8Array
    mac: Uint8Array
  }): Promise<{ valid: boolean; keyId: string }>
}

/**
 * Environment for `createAwsKmsMacProvider`.
 *
 * - `AWS_REGION`            — AWS region the MAC key lives in.
 * - `AWS_ROLE_ARN`          — IAM role assumed via OIDC federation; not a
 *                              secret (trust policy pins it to the Vercel
 *                              project + environment).
 * - `AWS_KMS_MAC_KEY_ID`    — KMS HMAC key ARN, UUID, or alias. The key
 *                              MUST have KeySpec=HMAC_256 + KeyUsage=
 *                              GENERATE_VERIFY_MAC + MacAlgorithms
 *                              containing HMAC_SHA_256.
 */
export interface AwsKmsMacEnv {
  AWS_REGION: string
  AWS_ROLE_ARN: string
  AWS_KMS_MAC_KEY_ID: string
}

/**
 * Optional dependencies (test-injectable). Production callers omit this
 * argument; tests inject a mocked `KMSClient` via `aws-sdk-client-mock`.
 */
export interface AwsKmsMacDeps {
  client?: KMSClient
  /** Override the per-call timeout. Defaults to 5000ms. */
  requestTimeoutMs?: number
}

const DEFAULT_REQUEST_TIMEOUT_MS = 5000

const ROLE_ARN_PATTERN = /^arn:aws:iam::\d+:role\/.+$/
const KEY_ID_PATTERN =
  /^(arn:aws:kms:[a-z0-9-]+:\d+:key\/[a-zA-Z0-9-]+|[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}|alias\/.+)$/

/**
 * Map an AWS SDK error to a clean operator-facing error. Same shape as
 * `aws-kms-provider.ts::mapAwsError` so existing log-correlation patterns
 * keep working across K2/K3-ext/K4.
 */
function mapAwsError(err: unknown, op: string): Error {
  if (err instanceof Error) {
    const name = (err as Error & { name?: string }).name ?? ''
    if (name === 'KMSInvalidMacException') {
      return new Error('kms mac invalid')
    }
    if (
      name === 'KMSInvalidStateException' ||
      name === 'DisabledException' ||
      name === 'KeyUnavailableException'
    ) {
      return new Error(`kms key unavailable (${op})`)
    }
    if (name === 'AccessDeniedException' || name === 'NotAuthorizedException') {
      return new Error('kms unauthorized')
    }
    if (name === 'ThrottlingException' || name === 'KMSInternalException') {
      return new Error(`kms unreachable (${op}): ${name}`)
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
 * Create an AWS KMS-backed `KmsMacProvider`.
 *
 * Validates env synchronously; does NOT contact AWS until the first
 * `generateMac` / `verifyMac` call. This matches the cold-start behaviour
 * of the K2 envelope provider so Vercel Function topology has no extra
 * round-trips at module load.
 *
 * @throws if `AWS_REGION` is empty, `AWS_ROLE_ARN` doesn't match the IAM
 *         role ARN pattern, or `AWS_KMS_MAC_KEY_ID` doesn't match a key
 *         ARN / UUID / alias.
 */
export function createAwsKmsMacProvider(
  env: AwsKmsMacEnv,
  deps: AwsKmsMacDeps = {},
): KmsMacProvider {
  if (!env.AWS_REGION || env.AWS_REGION.trim().length === 0) {
    throw new Error('createAwsKmsMacProvider: AWS_REGION is required')
  }
  if (!env.AWS_ROLE_ARN || !ROLE_ARN_PATTERN.test(env.AWS_ROLE_ARN)) {
    throw new Error(
      'createAwsKmsMacProvider: AWS_ROLE_ARN must match arn:aws:iam::<account>:role/<name>',
    )
  }
  if (!env.AWS_KMS_MAC_KEY_ID || !KEY_ID_PATTERN.test(env.AWS_KMS_MAC_KEY_ID)) {
    throw new Error(
      'createAwsKmsMacProvider: AWS_KMS_MAC_KEY_ID must be a key ARN, UUID, or alias',
    )
  }

  const requestTimeoutMs = deps.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS

  const client =
    deps.client ??
    new KMSClient({
      region: env.AWS_REGION,
      credentials: awsCredentialsProvider({ roleArn: env.AWS_ROLE_ARN }),
    })

  function buildAbortSignal(): AbortSignal {
    return AbortSignal.timeout(requestTimeoutMs)
  }

  return {
    async generateMac({ canonicalMessage }) {
      try {
        const out = await client.send(
          new GenerateMacCommand({
            KeyId: env.AWS_KMS_MAC_KEY_ID,
            Message: canonicalMessage,
            MacAlgorithm: 'HMAC_SHA_256',
          }),
          { abortSignal: buildAbortSignal() },
        )
        if (!out.Mac) {
          throw new Error('kms error (mac): missing Mac in response')
        }
        return {
          mac: new Uint8Array(out.Mac),
          keyId: out.KeyId ?? env.AWS_KMS_MAC_KEY_ID,
        }
      } catch (err) {
        if (
          err instanceof Error &&
          /^kms (error|unauthorized|unreachable|key unavailable|mac invalid)/i.test(err.message)
        ) {
          throw err
        }
        throw mapAwsError(err, 'mac')
      }
    },

    async verifyMac({ canonicalMessage, mac }) {
      try {
        const out = await client.send(
          new VerifyMacCommand({
            KeyId: env.AWS_KMS_MAC_KEY_ID,
            Message: canonicalMessage,
            Mac: mac,
            MacAlgorithm: 'HMAC_SHA_256',
          }),
          { abortSignal: buildAbortSignal() },
        )
        // AWS returns `MacValid: false` for an HMAC mismatch. It only throws
        // `KMSInvalidMacException` for malformed inputs (wrong length, etc.).
        // Map both to a non-throwing `valid: false` so callers always get a
        // boolean — the existing middleware emits the same 401 response in
        // either case.
        return {
          valid: out.MacValid === true,
          keyId: out.KeyId ?? env.AWS_KMS_MAC_KEY_ID,
        }
      } catch (err) {
        if (err instanceof Error) {
          const name = (err as Error & { name?: string }).name ?? ''
          // Soft-fail on the invalid-mac surface — verifier callers always
          // want a boolean, not an exception, for a failed signature check.
          if (name === 'KMSInvalidMacException') {
            return { valid: false, keyId: env.AWS_KMS_MAC_KEY_ID }
          }
        }
        if (
          err instanceof Error &&
          /^kms (error|unauthorized|unreachable|key unavailable|mac invalid)/i.test(err.message)
        ) {
          throw err
        }
        throw mapAwsError(err, 'verify-mac')
      }
    },
  }
}
