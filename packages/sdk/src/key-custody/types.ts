/**
 * KMS migration K0 — provider interface + canonical AAD context encoder.
 *
 * IMPORTANT — node:crypto isolation contract (read before adding exports):
 * This file is the ONLY key-custody module the SDK main barrel
 * (`packages/sdk/src/index.ts`) is allowed to re-export from. Sibling
 * runtime files (`local-hmac.ts`, `local-aes-provider.ts`,
 * `local-secp256k1-signer.ts`, …) import `node:crypto` or pull in
 * server-only SDKs (`@aws-sdk/client-kms`, `@google-cloud/kms`, …) which
 * webpack cannot bundle for Next.js client components. The barrel re-exporting
 * those files (even via `export type`) historically dragged `node:crypto`
 * into `apps/web` client bundles (`use-a2a-session.ts` regression).
 *
 * Contract for this file:
 *   1. Only `export type { … } from './sibling'` re-exports are allowed for
 *      types defined in sibling runtime files. `export type` is erased by
 *      TypeScript/SWC before webpack sees the graph, so no runtime edge to
 *      the sibling is emitted.
 *   2. NO runtime `export { … } from './sibling'` re-exports here. If you
 *      need a runtime value, import it directly from the
 *      `@smart-agent/sdk/key-custody` subpath (server-only).
 *   3. NO `import` of any sibling that itself imports `node:crypto` or a
 *      Node-only SDK. Types may be pulled via `import type` only.
 *
 * Anti-patterns that would re-break client bundling:
 *   - `export { foo } from './local-hmac'`
 *   - `import { createHmac } from 'node:crypto'`
 *   - `export * from './aws-kms-provider'` (would include runtime exports)
 *
 * `A2AKeyProvider` is the cloud-agnostic abstraction that lets a2a-agent
 * source session-package data keys from any KMS-class backend (local-aes
 * for dev, AWS KMS in prod, Vault Transit in the future). The interface
 * is intentionally cloud-independent — no AWS SDK types, no Vercel SDK
 * types. Providers translate `aadContext` to whatever shape their backend
 * accepts (AWS `EncryptionContext`, Vault `context`, etc.).
 *
 * Required methods (every provider must implement):
 *   - generateSessionDataKey: returns a fresh 32-byte AES key plus the
 *     KMS-wrapped form (CiphertextBlob in AWS terms; the HKDF salt for
 *     local-aes). The plaintext key lives in memory ONLY for the duration
 *     of the encrypt call; the caller must zeroise it in a finally block.
 *   - decryptSessionDataKey: inverse — given the wrapped blob + the same
 *     aadContext, returns the 32-byte plaintext key. A context mismatch
 *     must cause a hard failure (AWS does this via `InvalidCiphertextException`;
 *     local-aes re-derives a different key and downstream AES-GCM tag-checks fail).
 *
 * Optional methods (added in later phases):
 *   - signA2AAction (K4): asymmetric `kms:Sign` for the master EOA replacement.
 *     EncryptionContext does NOT apply to asymmetric KMS keys — see §13 of
 *     KMS-IMPLEMENTATION-PLAN.md. Binding metadata lives inside the
 *     canonical message instead.
 *   - generateMac (K3-extension): `kms:GenerateMac` for inter-service HMAC
 *     replacement. Same caveat as signA2AAction — no EncryptionContext.
 *
 * See `KMS-IMPLEMENTATION-PLAN.md` §2.1.
 */

export interface A2AKeyProvider {
  /**
   * Synchronously-knowable keyVersion tag for this provider instance.
   *
   * Used by callers (e.g. `encryptSessionPackage`) to build the
   * `aadContext` BEFORE invoking `generateSessionDataKey` — the
   * keyVersion participates in the EncryptionContext that AWS KMS
   * embeds in the cipher's MAC, so we need it on the encrypt side as
   * well as the decrypt side.
   *
   *   - local-aes: `'local-v1'` (compile-time constant)
   *   - aws-kms:   `'aws-kms:<uuid|alias-suffix>'` (derived from
   *                AWS_KMS_KEY_ID at construction time)
   *
   * The keyVersion returned from `generateSessionDataKey({ ... }).keyVersion`
   * MUST equal this property.
   */
  readonly keyVersion: string

  generateSessionDataKey(input: {
    aadContext: Record<string, string>
  }): Promise<{
    plaintextDataKey: Uint8Array
    encryptedDataKey: Uint8Array
    keyId: string
    keyVersion: string
  }>

  decryptSessionDataKey(input: {
    encryptedDataKey: Uint8Array
    aadContext: Record<string, string>
    keyId: string
    keyVersion: string
  }): Promise<Uint8Array>

  /**
   * Sign a 32-byte digest with the master-EOA secp256k1 key.
   *
   * Two signing modes, distinguished by the optional `digest` argument:
   *
   *   - `digest` provided (32 bytes): the caller has already computed the
   *     authoritative digest (EIP-191 `hashMessage`, EIP-712 `hashTypedData`,
   *     or the keccak256 of the RLP/EIP-2718 transaction pre-image). The
   *     signer signs the bytes verbatim and returns `r || s || v`. This is
   *     the path the viem `LocalAccount` adapter (`createKmsAccount`) drives.
   *     The signer MUST NOT re-hash a caller-supplied digest.
   *
   *   - `digest` omitted: the signer computes the canonical "sa:sign:v1"
   *     digest from the binding tuple itself, per KMS-IMPLEMENTATION-PLAN
   *     §13 / K4 §3:
   *         keccak256(
   *           "sa:sign:v1" || sessionId || accountAddress.toLowerCase()
   *           || chainId || actionId || keccak256(canonicalPayload)
   *         )
   *     This is the path direct callers of `signA2AAction` (audit-logged
   *     application-level signatures, not viem flows) take. The binding
   *     metadata fields are emitted into the digest so the signature is
   *     bound to a specific (session, account, chain, action) tuple.
   *
   * Returned `signature` is always 65 bytes: `r (32) || s (32) || v (1)`
   * with `v = recovery + 27` (EIP-191 / ERC-1271 convention). Callers that
   * need EIP-155 / EIP-1559 `v` encodings derive them from `recovery`
   * themselves (viem's `serializeTransaction` does this automatically when
   * given a `{r, s, v: 27|28}` Signature struct).
   *
   * Implementations MUST low-s normalize per EIP-2 (`s ≤ n/2`); high-s
   * signatures are rejected by Ethereum consensus.
   */
  signA2AAction?(input: {
    canonicalPayload: Uint8Array
    accountAddress: string
    chainId: string
    sessionId: string
    actionId: string
    /**
     * Optional caller-computed 32-byte digest. When present, the signer
     * signs these bytes directly and IGNORES `canonicalPayload`. When
     * absent, the signer computes the "sa:sign:v1" digest above.
     */
    digest?: Uint8Array
  }): Promise<{ signature: Uint8Array; keyId: string; signerAddress: string }>

  generateMac?(input: {
    canonicalMessage: Uint8Array
    service: string
    audience: string
  }): Promise<{ mac: Uint8Array; keyId: string }>
}

/**
 * Canonicalise an aadContext into a deterministic byte string for HKDF / MAC inputs.
 *
 * Algorithm:
 *   1. Sort entries by key (lexicographic, UTF-16 code units — JS default).
 *   2. Join each entry as `key=value`.
 *   3. Concatenate with `\0` (NUL byte) separators.
 *   4. UTF-8 encode.
 *
 * Used by:
 *   - local-aes provider: as the HKDF `info` parameter — different contexts
 *     yield different data keys from the same `(ikm, salt)`.
 *   - aws-kms provider: for audit logging only. AWS sorts EncryptionContext
 *     keys internally; we don't need to canonicalise on the wire. But having
 *     a single shared encoder eliminates a class of context-drift bugs and
 *     lets tests compare local-aes/aws-kms behaviour byte-for-byte.
 *
 * Empty contexts are valid — yield an empty Uint8Array.
 */
// ─── Sibling type re-exports ─────────────────────────────────────────
// These are pure `export type` re-exports. TypeScript / SWC erase them
// before webpack sees the module graph, so the SDK main barrel can pull
// these types via `./key-custody/types` without dragging the sibling
// runtime modules (and their `node:crypto` / Node-SDK imports) into the
// client bundle.
//
// If you add a sibling type that the main barrel needs, add it here —
// NOT to `./key-custody/index.ts` (that barrel is server-only).
export type { LocalAesProviderEnv } from './local-aes-provider'
export type { AwsKmsEnv, AwsKmsDeps } from './aws-kms-provider'
export type {
  LocalSecp256k1Env,
  LocalSecp256k1Signer,
} from './local-secp256k1-signer'
export type {
  KmsAccountBackend,
  CreateKmsAccountOptions,
} from './viem-kms-account'
export type {
  AwsKmsSignerEnv,
  AwsKmsSignerDeps,
  AwsKmsSigner,
} from './aws-kms-signer'
export type {
  ToolExecutorId,
  ToolExecutorSignerBackend,
  ToolExecutorSignerEnv,
  ToolExecutorSignerDeps,
} from './tool-executor-signer'
export type {
  KmsMacProvider,
  AwsKmsMacEnv,
  AwsKmsMacDeps,
} from './aws-kms-mac'
export type { LocalHmacEnv } from './local-hmac'
export type {
  MacKeyId,
  McpName,
  McpMacProviderEnv,
} from './mac-provider-factory'

export function canonicalContextBytes(ctx: Record<string, string>): Uint8Array {
  const keys = Object.keys(ctx).sort()
  const parts: string[] = []
  for (const k of keys) {
    // Reject keys/values containing '\0' or '=' — they would break the
    // delimiter encoding and admit a context-confusion attack where two
    // different contexts canonicalise to the same bytes.
    if (k.includes('\0') || k.includes('=')) {
      throw new Error(`canonicalContextBytes: context key contains reserved delimiter: ${JSON.stringify(k)}`)
    }
    const v = ctx[k]!
    if (v.includes('\0')) {
      throw new Error(`canonicalContextBytes: context value contains NUL byte for key ${JSON.stringify(k)}`)
    }
    parts.push(`${k}=${v}`)
  }
  return new TextEncoder().encode(parts.join('\0'))
}
