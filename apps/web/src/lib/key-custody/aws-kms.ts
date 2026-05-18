/**
 * AWS KMS-backed session-grant signer (Sprint 1 — S1.1).
 *
 * Production custody backend for the web `SessionGrant` ceremony. Replaces
 * the M5 stub that previously threw "aws-kms backend not yet implemented".
 *
 * ─── Architectural choice: one shared KMS key, all sessions ──────────────
 *
 * AWS KMS asymmetric keys are immutable — the public key (and therefore the
 * derived EVM address) for a given CMK is fixed for life. We do NOT mint a
 * fresh KMS key per session (would be cost-prohibitive: a `CreateKey` API
 * call per browser-tab login). Instead the web app uses ONE long-lived KMS
 * asymmetric key shared across every session.
 *
 * Per-session uniqueness is enforced elsewhere in the protocol — NOT by
 * the signing key:
 *
 *   1. The `sessionId` (random UUID) is the salt that ties a particular
 *      passkey assertion to a particular `SessionGrantV1`.
 *   2. `SessionGrant` includes a server nonce + issued-at + expires-at,
 *      so two sessions with the same delegate address are still distinct
 *      grants.
 *   3. `WalletAction` payloads include their own nonce + binding tuple
 *      (accountAddress, chainId, sessionId, actionId) — replay across
 *      sessions is rejected by the action-side verifier.
 *
 * This matches the pattern already used by `apps/a2a-agent` for its master
 * EOA (`packages/sdk/src/key-custody/aws-kms-signer.ts`): one KMS key, many
 * sessions / sub-delegations. The web key is a SEPARATE CMK from the
 * a2a-agent's master signer (`AWS_KMS_SIGNER_KEY_ID`) so the two runtimes
 * have distinct IAM scopes and can rotate on independent cadences.
 *
 * Sign pipeline (mirrors `aws-kms-signer.ts` §5):
 *   1. Cache the public key (1 round-trip per process via `kms:GetPublicKey`).
 *   2. For each sign call: `kms:Sign` with `MessageType=DIGEST` + `ECDSA_SHA_256`.
 *   3. DER decode the returned signature.
 *   4. Low-s normalize per EIP-2 (`s > N/2 → s = N - s`).
 *   5. Derive recovery id (0 or 1) by probing both bits against the cached
 *      pubkey.
 *   6. Return `r || s || v` (v = recovery + 27) as a 0x-prefixed hex string,
 *      matching viem's `Account.sign()` shape.
 *
 * The web app's existing route handlers (`/api/auth/session-grant/start`,
 * `/api/auth/session-grant/finalize`, `/api/wallet-action/*`) call
 * `custody.deriveSigner(sessionId)` and use the returned `signer.address`
 * + `signer.sign(digest)` without caring which backend produced them.
 *
 * IAM: this file is permitted to import `@aws-sdk/client-kms` because it
 * lives under `apps/web/src/lib/`, NOT under `apps/web/src/app/api/`. The
 * KMS-SDK-in-routes ban in `scripts/check-no-bypass.sh` does not fire here.
 */

import {
  KMSClient,
  SignCommand,
  GetPublicKeyCommand,
} from '@aws-sdk/client-kms'
import { awsCredentialsProvider } from '@vercel/oidc-aws-credentials-provider'
import { secp256k1 } from '@noble/curves/secp256k1'
import { keccak_256 } from '@noble/hashes/sha3'
import {
  parseDerSignature,
  extractSec1FromSpki,
  bigIntTo32Bytes,
  SECP256K1_N,
  SECP256K1_N_HALF,
} from '@smart-agent/sdk/key-custody'
import type { CustodyBackend, DerivedSigner } from './types'

/**
 * Constructor env. Each field is read from `process.env.*` at factory-call
 * time; nothing in this module captures values at import time so dynamic
 * config (Vercel env updates) takes effect on next request.
 *
 * - `AWS_REGION`                    — region the signing CMK lives in.
 * - `AWS_ROLE_ARN`                  — IAM role assumed via Vercel OIDC.
 * - `AWS_WEB_SESSION_SIGNER_KEY_ID` — asymmetric `ECC_SECG_P256K1` CMK used
 *                                     to sign WalletAction payloads on
 *                                     behalf of every web session.
 *                                     SEPARATE from `AWS_KMS_SIGNER_KEY_ID`
 *                                     (the a2a-agent's master EOA signer).
 */
export interface AwsKmsCustodyEnv {
  AWS_REGION: string
  AWS_ROLE_ARN: string
  AWS_WEB_SESSION_SIGNER_KEY_ID: string
}

/**
 * Optional test-injectable dependencies. Production callers omit this
 * argument; tests inject a mocked `KMSClient` via `aws-sdk-client-mock`.
 */
export interface AwsKmsCustodyDeps {
  client?: KMSClient
  requestTimeoutMs?: number
}

const DEFAULT_REQUEST_TIMEOUT_MS = 5000
const ROLE_ARN_PATTERN = /^arn:aws:iam::\d+:role\/.+$/
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

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex
  if (h.length % 2 !== 0) throw new Error('kms-custody: odd-length hex digest')
  const out = new Uint8Array(h.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(h.substring(i * 2, i * 2 + 2), 16)
  }
  return out
}

/**
 * Probe both candidate recovery bits against the cached public key and
 * return the one whose recovered pubkey matches. Throws if neither matches
 * — indicates a stale cache, a swapped KMS key, or a DER-decode bug.
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
      const recovered = sig.recoverPublicKey(msgHash).toRawBytes(false)
      const rawRecovered = recovered.slice(1) // strip 0x04 prefix
      if (uint8eq(rawRecovered, expectedRawPubkey)) return rec
    } catch {
      // try the other bit
    }
  }
  throw new Error(
    'kms-custody: neither recovery id matches cached pubkey (KMS key swap, stale cache, or DER decode bug)',
  )
}

/**
 * Map AWS SDK errors to clean operator-facing messages. Mirrors the
 * substrings in `packages/sdk/src/key-custody/aws-kms-signer.ts` so log
 * patterns and runbook entries are uniform across the two runtimes.
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
    if (name === 'InvalidCiphertextException') {
      // Unexpected on a Sign/GetPublicKey path, but map cleanly anyway so
      // an env-misconfigured caller sees a stable error string.
      return new Error(`kms ciphertext invalid (${op})`)
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
 * Build the AWS KMS session-grant custody backend.
 *
 * Validates env synchronously. Does NOT contact AWS until the first signer
 * use — the Vercel OIDC token is resolved at request scope inside
 * `awsCredentialsProvider`, never at module load.
 *
 * @throws if `env` is missing or malformed.
 */
export function createAwsKmsCustody(
  env: AwsKmsCustodyEnv,
  deps: AwsKmsCustodyDeps = {},
): CustodyBackend {
  if (!env.AWS_REGION || env.AWS_REGION.trim().length === 0) {
    throw new Error('createAwsKmsCustody: AWS_REGION is required')
  }
  if (!env.AWS_ROLE_ARN || !ROLE_ARN_PATTERN.test(env.AWS_ROLE_ARN)) {
    throw new Error(
      'createAwsKmsCustody: AWS_ROLE_ARN must match arn:aws:iam::<account>:role/<name>',
    )
  }
  if (
    !env.AWS_WEB_SESSION_SIGNER_KEY_ID ||
    !KEY_ID_PATTERN.test(env.AWS_WEB_SESSION_SIGNER_KEY_ID)
  ) {
    throw new Error(
      'createAwsKmsCustody: AWS_WEB_SESSION_SIGNER_KEY_ID must be a key ARN, UUID, or alias',
    )
  }

  const requestTimeoutMs = deps.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  const client =
    deps.client ??
    new KMSClient({
      region: env.AWS_REGION,
      credentials: awsCredentialsProvider({ roleArn: env.AWS_ROLE_ARN }),
    })

  // Lifetime cache: KMS asymmetric keys are immutable, so one
  // `GetPublicKey` round-trip per process suffices.
  let cachedAddress: `0x${string}` | undefined
  let cachedRawPubkey: Uint8Array | undefined // 64 bytes (X || Y)
  let pubkeyFetchInflight: Promise<void> | undefined

  function buildAbortSignal(): AbortSignal {
    return AbortSignal.timeout(requestTimeoutMs)
  }

  async function fetchAndCachePubkey(): Promise<void> {
    if (cachedAddress && cachedRawPubkey) return
    if (pubkeyFetchInflight) return pubkeyFetchInflight
    pubkeyFetchInflight = (async () => {
      try {
        const out = await client.send(
          new GetPublicKeyCommand({ KeyId: env.AWS_WEB_SESSION_SIGNER_KEY_ID }),
          { abortSignal: buildAbortSignal() },
        )
        if (!out.PublicKey) {
          throw new Error('kms-custody: GetPublicKey returned no key material')
        }
        const spki = new Uint8Array(out.PublicKey)
        const sec1 = extractSec1FromSpki(spki)
        const rawPubkey = sec1.slice(1) // strip 0x04 → 64 bytes
        const addrBytes = keccak_256(rawPubkey).slice(-20)
        cachedRawPubkey = rawPubkey
        cachedAddress = (`0x${bytesToHex(addrBytes)}`) as `0x${string}`
      } catch (err) {
        if (
          err instanceof Error &&
          /^kms[- ]custody:|^kms (error|unauthorized|unreachable|key unavailable|signature rejected|key wrong usage|ciphertext invalid)/i.test(
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

  /** Pack r||s||v into a viem-compatible 0x-hex signature. */
  function packSignature(r: bigint, s: bigint, recovery: 0 | 1): `0x${string}` {
    const out = new Uint8Array(65)
    out.set(bigIntTo32Bytes(r), 0)
    out.set(bigIntTo32Bytes(s), 32)
    out[64] = recovery + 27
    return (`0x${bytesToHex(out)}`) as `0x${string}`
  }

  async function signDigest(digest: `0x${string}`): Promise<`0x${string}`> {
    await fetchAndCachePubkey()
    const msgHash = hexToBytes(digest)
    if (msgHash.length !== 32) {
      throw new Error(
        `kms-custody: digest must be 32 bytes (got ${msgHash.length})`,
      )
    }

    let signatureDer: Uint8Array
    try {
      const out = await client.send(
        new SignCommand({
          KeyId: env.AWS_WEB_SESSION_SIGNER_KEY_ID,
          // KMS expects raw bytes — the AWS SDK v3 base64s them for us.
          Message: msgHash,
          MessageType: 'DIGEST',
          SigningAlgorithm: 'ECDSA_SHA_256',
        }),
        { abortSignal: buildAbortSignal() },
      )
      if (!out.Signature) {
        throw new Error('kms-custody: Sign returned no signature')
      }
      signatureDer = new Uint8Array(out.Signature)
    } catch (err) {
      if (
        err instanceof Error &&
        /^kms[- ]custody:|^kms (error|unauthorized|unreachable|key unavailable|signature rejected|key wrong usage|ciphertext invalid)/i.test(
          err.message,
        )
      ) {
        throw err
      }
      throw mapAwsError(err, 'sign')
    }

    const { r, s: sRaw } = parseDerSignature(signatureDer)
    const s = sRaw > SECP256K1_N_HALF ? SECP256K1_N - sRaw : sRaw
    const recovery = deriveRecoveryId(msgHash, r, s, cachedRawPubkey!)
    return packSignature(r, s, recovery)
  }

  /**
   * Build the per-call `DerivedSigner`. The address is the same for every
   * sessionId (cached). `forget()` is a no-op — there is no in-process
   * private key material to scrub. `sessionId` is accepted for interface
   * parity but is not used to derive the signing identity (see header).
   */
  function buildSigner(_sessionId: string): DerivedSigner {
    void _sessionId
    return {
      get address(): `0x${string}` {
        if (!cachedAddress) {
          // Defensive: deriveSigner ensures the pubkey is cached before
          // returning the signer, so this branch is only reachable if a
          // caller invokes `address` before `await`-ing `deriveSigner()`.
          throw new Error('kms-custody: signer address unavailable; await deriveSigner() first')
        }
        return cachedAddress
      },
      async sign(digest) {
        return signDigest(digest)
      },
      forget() {
        // No-op: no key material lives in this process.
      },
    }
  }

  return {
    async deriveSigner(sessionId) {
      await fetchAndCachePubkey()
      return buildSigner(sessionId)
    },
    async signWithDerivedSigner(sessionId, digest) {
      void sessionId
      const signature = await signDigest(digest)
      return { address: cachedAddress!, signature }
    },
  }
}

/**
 * Backwards-compatible wrapper around `createAwsKmsCustody` that reads the
 * required values from `process.env`. Selected by `getKeyCustody()` when
 * `SESSION_SIGNER_BACKEND=aws-kms`.
 */
export function awsKmsBackend(): CustodyBackend {
  return createAwsKmsCustody({
    AWS_REGION: process.env.AWS_REGION ?? '',
    AWS_ROLE_ARN: process.env.AWS_ROLE_ARN ?? '',
    AWS_WEB_SESSION_SIGNER_KEY_ID: process.env.AWS_WEB_SESSION_SIGNER_KEY_ID ?? '',
  })
}
