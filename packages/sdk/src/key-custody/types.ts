/**
 * KMS migration K0 — provider interface + canonical AAD context encoder.
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
