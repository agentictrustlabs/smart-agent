/**
 * AWS KMS `A2AKeyProvider` (KMS migration K2 — v1 prod implementation target).
 *
 * Implements `A2AKeyProvider` against AWS KMS via Vercel OIDC federation per
 * `KMS-IMPLEMENTATION-PLAN.md` §3.2a:
 *
 *   - `generateSessionDataKey` → `kms:GenerateDataKey` with `KeySpec=AES_256`
 *   - `decryptSessionDataKey`  → `kms:Decrypt`
 *
 * The context tuple from the K0+K1 contract is passed as AWS's
 * `EncryptionContext` parameter — AWS embeds it in the cipher's MAC and
 * refuses to decrypt unless it matches what was used at GenerateDataKey
 * time. That's the second of two independent trip-wires (the first is the
 * AES-GCM AAD in `apps/a2a-agent/src/auth/encryption.ts`).
 *
 * Credentials come from `@vercel/oidc-aws-credentials-provider`, which
 * lazily reads the Vercel OIDC token from request scope on each
 * `client.send(...)` and trades it for AWS STS temp credentials via
 * `AssumeRoleWithWebIdentity`. The token is NEVER read at module-load
 * time — Vercel Function topology has no request context at module load.
 *
 * Why provider-neutral framing matters:
 *   - The app depends on `A2AKeyProvider`, NOT on AWS KMS.
 *   - AWS KMS is the chosen v1 implementation; HCP Vault Transit (§3.2b)
 *     is a documented sibling alternative whose provider file already
 *     exists in this directory.
 *
 * Error mapping (`KMS-IMPLEMENTATION-PLAN.md` §3.2a):
 *
 *   - `InvalidCiphertextException` → "context mismatch (KMS denied decrypt)"
 *   - `AccessDeniedException`     → "kms unauthorized"
 *   - throttling / 5xx            → SDK middleware retries with backoff; surface as "kms unreachable" after exhaustion
 *   - timeout                     → "kms unreachable"
 *
 * Plaintext data keys live in heap only for the duration of the encrypt/
 * decrypt call. Zeroising is the CALLER'S responsibility — see
 * `apps/a2a-agent/src/auth/encryption.ts`.
 */
import {
  KMSClient,
  GenerateDataKeyCommand,
  DecryptCommand,
} from '@aws-sdk/client-kms'
import { awsCredentialsProvider } from '@vercel/oidc-aws-credentials-provider'
import type { A2AKeyProvider } from './types'

/**
 * Environment for `createAwsKmsProvider`.
 *
 * - `AWS_REGION`       — AWS region the CMK lives in. Used to route the
 *                        KMS endpoint. Required, non-empty.
 * - `AWS_ROLE_ARN`     — IAM role ARN assumed via OIDC federation. NOT a
 *                        secret; the trust policy on the role pins it to
 *                        the specific Vercel project + environment.
 *                        Pattern: `arn:aws:iam::<account>:role/<role-name>`.
 * - `AWS_KMS_KEY_ID`   — CMK identifier. We accept a key ARN
 *                        (`arn:aws:kms:<region>:<account>:key/<uuid>`) or a
 *                        bare uuid / alias. Pattern validation is permissive.
 */
export interface AwsKmsEnv {
  AWS_REGION: string
  AWS_ROLE_ARN: string
  AWS_KMS_KEY_ID: string
}

/**
 * Optional dependencies (test-injectable). Production callers omit this
 * argument; tests inject a mocked `KMSClient` (via `aws-sdk-client-mock`'s
 * mock-mode client) plus a synchronous `extractKeyVersion` override.
 */
export interface AwsKmsDeps {
  /**
   * Override the constructed `KMSClient`. When supplied, the provider
   * uses this client and ignores credential / region configuration. Used
   * by mock-AWS tests in `apps/a2a-agent/test/aws-kms-provider.test.ts`.
   */
  client?: KMSClient
  /**
   * Override the per-call timeout. Defaults to 5000ms. Tests can shorten
   * this to assert the "kms unreachable" branch fires.
   */
  requestTimeoutMs?: number
}

const DEFAULT_REQUEST_TIMEOUT_MS = 5000

const ROLE_ARN_PATTERN = /^arn:aws:iam::\d+:role\/.+$/
// Accept either a full KMS key ARN, a bare UUID, or an alias.
const KEY_ID_PATTERN =
  /^(arn:aws:kms:[a-z0-9-]+:\d+:key\/[a-zA-Z0-9-]+|[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}|alias\/.+)$/

/**
 * Extract the KMS key UUID (or alias suffix) from an ARN / bare id for use
 * as the synchronous `keyVersion` tag.
 *
 * - ARN: `arn:aws:kms:us-east-1:111122223333:key/<uuid>` → `<uuid>`
 * - UUID: `<uuid>` → `<uuid>`
 * - Alias: `alias/smart-agent-session-encryption` → `alias/smart-agent-session-encryption`
 *
 * Exported for the unit tests.
 */
export function extractKmsKeyUuid(keyIdOrArn: string): string {
  if (keyIdOrArn.startsWith('arn:aws:kms:')) {
    const tail = keyIdOrArn.split('/').pop()
    if (!tail) throw new Error(`aws-kms-provider: malformed key ARN: ${keyIdOrArn}`)
    return tail
  }
  return keyIdOrArn
}

/**
 * Map an AWS SDK error to a clean operator-facing error. We never leak
 * the raw AWS response body or stack trace — the messages here are
 * intentionally stable so route handlers can match on substrings if they
 * need to translate to HTTP status codes.
 */
function mapAwsError(err: unknown, op: string): Error {
  if (err instanceof Error) {
    // The SDK throws typed errors with `name`. Match on name when possible.
    const name = (err as Error & { name?: string }).name ?? ''

    if (name === 'InvalidCiphertextException') {
      return new Error('context mismatch (KMS denied decrypt)')
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
      return new Error(`kms unreachable (${op}): ${name}`)
    }
    if (name === 'TimeoutError' || name === 'AbortError' || /timeout|aborted/i.test(err.message)) {
      return new Error(`kms unreachable (${op}): timeout`)
    }
    // Network-class errors from undici / Node http surface differently.
    if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|EAI_AGAIN/i.test(err.message)) {
      return new Error(`kms unreachable (${op}): network`)
    }
    return new Error(`kms error (${op}): ${name || err.message}`)
  }
  return new Error(`kms error (${op}): ${String(err)}`)
}

/**
 * Create the AWS KMS `A2AKeyProvider`.
 *
 * Validates env synchronously; does NOT contact AWS until the first
 * `generateSessionDataKey` / `decryptSessionDataKey` call. This keeps the
 * cold-start latency identical between long-running servers and Vercel
 * Function topology.
 *
 * @throws if `AWS_REGION` is empty, `AWS_ROLE_ARN` doesn't match the IAM
 *         role ARN pattern, or `AWS_KMS_KEY_ID` doesn't match a key ARN /
 *         UUID / alias.
 */
export function createAwsKmsProvider(
  env: AwsKmsEnv,
  deps: AwsKmsDeps = {},
): A2AKeyProvider {
  if (!env.AWS_REGION || env.AWS_REGION.trim().length === 0) {
    throw new Error('createAwsKmsProvider: AWS_REGION is required')
  }
  if (!env.AWS_ROLE_ARN || !ROLE_ARN_PATTERN.test(env.AWS_ROLE_ARN)) {
    throw new Error(
      `createAwsKmsProvider: AWS_ROLE_ARN must match arn:aws:iam::<account>:role/<name>`,
    )
  }
  if (!env.AWS_KMS_KEY_ID || !KEY_ID_PATTERN.test(env.AWS_KMS_KEY_ID)) {
    throw new Error(
      `createAwsKmsProvider: AWS_KMS_KEY_ID must be a key ARN, UUID, or alias`,
    )
  }

  // Synchronously knowable: the keyVersion tag is derived from the key id
  // at construction time. No 'pending' placeholder dance.
  const keyVersion = `aws-kms:${extractKmsKeyUuid(env.AWS_KMS_KEY_ID)}`
  const requestTimeoutMs = deps.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS

  // Production: build the KMSClient with Vercel-OIDC-federated credentials.
  // Tests inject a mock client via `deps.client` (aws-sdk-client-mock) and
  // bypass the credentials provider entirely.
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
    async generateSessionDataKey({ aadContext }) {
      try {
        const out = await client.send(
          new GenerateDataKeyCommand({
            KeyId: env.AWS_KMS_KEY_ID,
            KeySpec: 'AES_256',
            EncryptionContext: aadContext,
          }),
          { abortSignal: buildAbortSignal() },
        )
        if (!out.Plaintext || !out.CiphertextBlob || !out.KeyId) {
          throw new Error('kms error (datakey): missing key material in response')
        }
        // AWS SDK v3 returns Uint8Array directly for these fields.
        const plaintextDataKey = new Uint8Array(out.Plaintext)
        const encryptedDataKey = new Uint8Array(out.CiphertextBlob)
        if (plaintextDataKey.length !== 32) {
          // Zero the bad bytes before throwing — same defensive pattern as
          // the Vault provider.
          for (let i = 0; i < plaintextDataKey.length; i++) plaintextDataKey[i] = 0
          throw new Error(
            `kms error (datakey): data key must be 32 bytes (got ${plaintextDataKey.length})`,
          )
        }
        return {
          plaintextDataKey,
          encryptedDataKey,
          keyId: out.KeyId,
          keyVersion,
        }
      } catch (err) {
        // If we already produced a clean Error (the size check above),
        // re-throw verbatim — don't re-wrap.
        if (
          err instanceof Error &&
          /^kms (error|unauthorized|unreachable|key unavailable)/i.test(err.message)
        ) {
          throw err
        }
        if (err instanceof Error && err.message === 'context mismatch (KMS denied decrypt)') {
          throw err
        }
        throw mapAwsError(err, 'datakey')
      }
    },

    async decryptSessionDataKey({ encryptedDataKey, aadContext, keyId, keyVersion: rowKeyVersion }) {
      // Strictness: refuse to attempt decrypt if the row's keyVersion is not
      // our tag. This prevents silent cross-provider misuse (e.g. a row
      // stamped 'local-v1' being routed at runtime to AWS KMS).
      if (rowKeyVersion !== keyVersion) {
        throw new Error(
          `aws-kms provider: keyVersion mismatch (expected '${keyVersion}', got '${rowKeyVersion}')`,
        )
      }
      try {
        const out = await client.send(
          new DecryptCommand({
            KeyId: keyId,
            CiphertextBlob: encryptedDataKey,
            EncryptionContext: aadContext,
          }),
          { abortSignal: buildAbortSignal() },
        )
        if (!out.Plaintext) {
          throw new Error('kms error (decrypt): missing plaintext in response')
        }
        const plaintextDataKey = new Uint8Array(out.Plaintext)
        if (plaintextDataKey.length !== 32) {
          for (let i = 0; i < plaintextDataKey.length; i++) plaintextDataKey[i] = 0
          throw new Error(
            `kms error (decrypt): decrypted key must be 32 bytes (got ${plaintextDataKey.length})`,
          )
        }
        return plaintextDataKey
      } catch (err) {
        if (
          err instanceof Error &&
          /^kms (error|unauthorized|unreachable|key unavailable)/i.test(err.message)
        ) {
          throw err
        }
        if (err instanceof Error && err.message === 'context mismatch (KMS denied decrypt)') {
          throw err
        }
        throw mapAwsError(err, 'decrypt')
      }
    },
  }
}
