# Smart Agent KMS Migration — K4 Implementation Plan (AWS KMS Asymmetric Signing)

**Synthesis date**: 2026-05-17
**Parent spec**: `output/KMS-IMPLEMENTATION-PLAN.md` (K0–K3 landed; §11, §13, §16 sketch K4).
**Scope of this document**: Full implementation specification for **K4** — the replacement of the env-resident `A2A_MASTER_EOA_PRIVATE_KEY` with an AWS-KMS-resident asymmetric `ECC_SECG_P256K1` signer.
**Why a dedicated spec**: K4 is the single most error-prone phase of the migration. The K0–K3 path is symmetric envelope encryption — well-understood primitives, AWS's `EncryptionContext` carries the binding metadata, and the cipher format is unchanged. K4 is the opposite: every EVM-specific quirk of secp256k1 signing surfaces in code we write ourselves (DER decoding, low-s normalization, recovery-id derivation, address derivation from `GetPublicKey`, viem `LocalAccount` adapter, on-chain owner rotation). Senior architects and security auditors will zoom in here; the spec has to read tight.

---

## 1. Architecture summary

App code calls a vendor-neutral `a2aSigner.sign(canonicalPayload, sessionMeta)` wrapper and, for viem-shaped sites, `createKmsAccount(provider)` returning a `viem.LocalAccount`. The wrapper routes through the existing optional `A2AKeyProvider.signA2AAction` (declared `packages/sdk/src/key-custody/types.ts:49-55`, unchanged) with two backends: **local-secp256k1** for dev (real secp256k1 from a hex env var; identical wire behaviour to today's `privateKeyToAccount`) and **aws-kms-secp256k1** for prod (AWS KMS `Sign` against an `ECC_SECG_P256K1` CMK). The KMS private key never leaves AWS; the public key is fetched once at startup (`kms:GetPublicKey`), the EOA address is derived via `keccak256(rawPublicKey).slice(-20)`, and the address is cached forever (KMS asymmetric keys are immutable). Rotation is an on-chain operation: create a new CMK, `addOwner(newAddr)` on every account, switch env, then `removeOwner(oldAddr)`. Provider selection reuses the `A2A_KMS_BACKEND` env var already in place for K1/K2 — no new top-level switch.

---

## 2. Why this is hard (EVM signing complexity surfaces)

K0–K3 only had two failure modes that mattered: AAD/context mismatch (KMS rejects decrypt) and provider unreachable (timeout). K4 has at least eight, and most of them are silent corruption — the signature returns, the call doesn't revert, but the recovered address is wrong. Enumerated:

1. **Curve naming**: AWS KMS spells it `ECC_SECG_P256K1` (KeySpec for the CMK) and `ECDSA_SHA_256` (SigningAlgorithm). The viem/noble/ethereum world calls it `secp256k1`. Same curve, different names. A reviewer looking for `secp256k1` in the AWS request will not find it; the spec must document the mapping in one place so search hits land on the right line.

2. **DER decoding**: `kms:Sign` returns the signature as ASN.1 DER `SEQUENCE { r INTEGER, s INTEGER }`, not the 64-byte `(r ‖ s)` packing EVM uses. DER `INTEGER`s are big-endian, two's-complement, **without** leading zero bytes — except when the high bit of the first byte is set, in which case DER prepends a `0x00` to keep the integer positive. A naive decoder that just takes `tlv.value.slice(-32)` works most of the time and silently truncates `~0.4%` of the time, producing a 33-byte r-or-s and an invalid signature. The decoder MUST strip the leading `0x00` when present **and** left-pad short values back to 32 bytes when the integer is naturally short (the top byte is < `0x10`).

3. **Low-s normalization (EIP-2)**: EVM `ecrecover` accepts any `(r, s, v)` mathematically, but Ethereum consensus (EIP-2, post-Homestead) and viem's `verifyMessage` / on-chain `ECDSA.tryRecover` reject signatures with `s > secp256k1.n / 2`. ECDSA produces both `(r, s)` and `(r, n - s)` for the same message; AWS KMS does not guarantee low-s. We normalize: if `s > N/2`, set `s = N - s` and flip the recovery id (because flipping s changes which of the two recoverable points was meant). The `n/2` constant for secp256k1 is `0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0`.

4. **Recovery id (`v`) calculation**: ECDSA yields `(r, s)`. EVM needs `(r, s, v)` where `v ∈ {27, 28}` for personal-sign / ERC-1271 and `v ∈ {0, 1}` (or `chainId*2 + 35 + recovery` per EIP-155) for transactions. KMS does **not** return v. We derive it by trying both `recovery = 0` and `recovery = 1` against the message digest, recovering the public key for each, comparing to the cached KMS public key, and picking the match. If the low-s normalization flipped s, the recovery bit also flips. Concretely: compute `recovery` by recovering and comparing; if `sNormalized !== sOriginal`, set `recovery = recovery ^ 1`. The final v is then `recovery + 27` for the EIP-191 / ERC-1271 path (what `signMessage`/`signTypedData` produce) and `recovery` for the EIP-1559 typed-tx path (with the legacy EIP-155 form computed by the transaction encoder, not by us).

5. **Public-key extraction**: `kms:GetPublicKey` returns a DER-encoded `SubjectPublicKeyInfo` (RFC 5280) — the same wire format X.509 certificates use. The interior `BIT STRING` is the SEC1 uncompressed point: `0x04 ‖ X ‖ Y` (65 bytes). We unwrap the SPKI to the raw point, drop the `0x04` prefix, hash the resulting 64 bytes with keccak-256, take the last 20 bytes — that's the address. The SPKI envelope has variable-length OIDs depending on the curve (and AWS sometimes encodes them as named curves vs parameter-explicit), so we use a real ASN.1 decoder (`@peculiar/asn1-schema` or hand-rolled DER walker) rather than fixed-offset slicing.

6. **chainId binding (EIP-155 / EIP-1559 / EIP-712)**: Different signing surfaces hash differently — EIP-191 (no chainId), ERC-1271 (raw hash; `AgentAccount.sol:464-519` recovers via `ECDSA.tryRecover`), EIP-712 (chainId + verifyingContract in domain), EIP-155 legacy (`v = chainId*2 + 35 + recovery`), EIP-1559 typed (`v = recovery`). K4's `signA2AAction` doesn't pick — the caller does. Current call site at `onchain-redeem.ts:1228` is `signMessage({ message: { raw: userOpHash } })` (EIP-191); the userOpHash also flows into `AgentAccount.isValidSignature` (ERC-1271, raw hash). The **outer** `walletClient.writeContract({ functionName: 'handleOps' })` at `onchain-redeem.ts:1247-1254` is EIP-1559-signed by the master EOA paying gas; the **inner** userOp signature is the session-account ECDSA over `userOpHash`. K4 must handle (a) raw-digest signing for EIP-191/ERC-1271 (the userOp signature path) and (b) full EIP-1559 transaction signing for `handleOps`. The viem `LocalAccount` adapter glues both.

7. **Per-call latency**: `privateKeyToAccount(...).signMessage(...)` is microseconds (in-process scalar mult). `kms:Sign` is ~30–50 ms (KMS HSM round-trip from `us-east-1` to a Vercel function in the same region; cross-region adds 20–80 ms more). At today's volume — three sign points per user action — this is a non-issue. At a future "thousands of sigs per second" hot path it would be catastrophic. We document the budget and flag any hot path that materialises.

8. **Address determinism + rotation**: A KMS asymmetric key's public key is immutable. The address `0x{keccak256(pubkey)[-20:]}` for a given CMK NEVER changes. AWS KMS's automatic rotation only applies to **symmetric** keys (it generates new key material under the same key id; the symmetric envelope is rewrapped transparently). **Asymmetric keys cannot rotate in place.** A rotation is a different CMK with a different public key and a different address. Therefore K4 rotation is an on-chain operation: every smart account that lists the old address as owner must be told about the new address via `addOwner(newAddr)` (an `onlySelf` call requiring a userOp signed by the **old** key). This is the single most operationally consequential property of K4 — Section 9 documents it in detail.

---

## 3. Provider interface — no breaking changes

The optional `signA2AAction` on `A2AKeyProvider` (`packages/sdk/src/key-custody/types.ts:49-55`) is reused verbatim:

```ts
signA2AAction?(input: {
  canonicalPayload: Uint8Array
  accountAddress: string
  chainId: string
  sessionId: string
  actionId: string
}): Promise<{ signature: Uint8Array; keyId: string; signerAddress: string }>
```

The `canonicalPayload` argument is sufficient for the spec-defined "sa:sign:v1" canonical-message binding from KMS-IMPLEMENTATION-PLAN §13. But for K4 to integrate with viem's `signMessage`/`signTypedData`/`signTransaction` — each of which has its **own** authoritative digest function — we need a way to pass the digest directly without re-computing it inside the signer (lossy and bug-prone). We add a **single optional `digest` field**:

```ts
signA2AAction?(input: {
  canonicalPayload: Uint8Array
  accountAddress: string
  chainId: string
  sessionId: string
  actionId: string
  digest?: Uint8Array  // NEW — caller-computed 32-byte digest; takes precedence over canonicalPayload when present
}): Promise<{ signature: Uint8Array; keyId: string; signerAddress: string }>
```

Backwards-compat: the field is optional; the K1 envelope path (which doesn't use `signA2AAction` at all) is unaffected. Existing call patterns that pass only `canonicalPayload` still work — the implementation hashes the canonical message and signs the result. New call patterns that pass `digest` skip the canonical-message construction and sign the bytes directly. This is the **only** interface change in K4, and the reviewer should look hard at it: the question is whether `digest` admits a "sign anything" oracle. Answer: yes by design — the `a2aSigner` wrapper (§5) is the only caller of `signA2AAction` and gates the digest path on an internal allow-list of viem operations (`signMessage`, `signTypedData`, `signTransaction`), each of which produces a digest that is itself cryptographically constrained to a specific shape (EIP-191 prefix, EIP-712 domain hash, transaction RLP). A leaked AWS credential would let the attacker call `kms:Sign` directly on any 32-byte digest regardless — the wrapper is a defense-in-depth, not the security boundary. The security boundary is IAM (§12).

The reviewer should also confirm that `accountAddress` / `chainId` / `sessionId` / `actionId` are emitted for **audit** purposes when the digest path is used (CloudTrail does not see them — they're not part of the KMS call — but the wrapper's structured-log lines do). §5 implementation includes this.

---

## 4. Provider implementation — local-secp256k1 (dev)

**New file**: `packages/sdk/src/key-custody/local-secp256k1-signer.ts`.

Reads `A2A_MASTER_PRIVATE_KEY` (renamed from `A2A_MASTER_EOA_PRIVATE_KEY` — "EOA" was inherited from the env-var era and is misleading for a KMS-resident key that's still an EOA on-chain). Uses `@noble/curves/secp256k1` (already in viem's dep tree — viem 2.21+ depends on `@noble/curves` ^1.6, no new transitive dep) and `@noble/hashes/sha3` for keccak. Refuses to instantiate when `NODE_ENV='production'`.

Shape:

```ts
export function createLocalSecp256k1Signer(env: LocalSecp256k1Env)
  : Pick<A2AKeyProvider, 'signA2AAction'> & { getSignerAddress(): Promise<`0x${string}`> } {
  if (env.NODE_ENV === 'production') throw new Error('refusing local-secp256k1 in production')
  const priv = hexToBytes32(env.A2A_MASTER_PRIVATE_KEY)
  const pubUncompressed = secp256k1.getPublicKey(priv, false)        // 65 bytes; leading 0x04
  const address = '0x' + bytesToHex(keccak_256(pubUncompressed.slice(1)).slice(-20))

  return {
    async getSignerAddress() { return address as `0x${string}` },
    async signA2AAction({ canonicalPayload, accountAddress, chainId, sessionId, actionId, digest }) {
      const msgHash = digest ?? buildCanonicalDigest({ canonicalPayload, accountAddress, chainId, sessionId, actionId })
      if (msgHash.length !== 32) throw new Error('digest must be 32 bytes')
      const sig = secp256k1.sign(msgHash, priv, { lowS: true })   // noble normalizes
      const out = new Uint8Array(65)
      out.set(sig.r.toBytes('be'), 0)
      out.set(sig.s.toBytes('be'), 32)
      out[64] = sig.recovery + 27                                  // EIP-191 / ERC-1271 v
      return { signature: out, keyId: 'local-secp256k1', signerAddress: address as `0x${string}` }
    },
  }
}

// buildCanonicalDigest:
//   keccak256("sa:sign:v1" || sessionId || accountAddress.toLowerCase()
//             || chainId || actionId || keccak256(canonicalPayload))
```

The `Pick<A2AKeyProvider, 'signA2AAction'>` return type matters: this file does NOT implement the envelope-encryption methods. It's a sibling to `local-aes-provider.ts`, not a replacement. Composition into a full `A2AKeyProvider` happens in `apps/a2a-agent/src/auth/key-provider.ts` (§7) — both providers are constructed, their method maps are merged. K3 envelope reads in dev still flow through `local-aes-provider.ts`; K4 signs in dev flow through this file.

The renaming `A2A_MASTER_EOA_PRIVATE_KEY` → `A2A_MASTER_PRIVATE_KEY` happens in PR-1 so PR-5's removal step has a clean target. Sites: `scripts/deploy-local.sh:431-432` and `apps/a2a-agent/.env.example:60`.

---

## 5. Provider implementation — aws-kms-secp256k1 (prod)

**New file**: `packages/sdk/src/key-custody/aws-kms-signer.ts`. Split from the K2 `aws-kms-provider.ts` because (a) IAM permissions differ (`kms:Sign + GetPublicKey` vs `GenerateDataKey + Decrypt`); (b) the two CMKs are different key specs (`ECC_SECG_P256K1` vs `SYMMETRIC_DEFAULT`) and ideally different ARNs under least-privilege; (c) the signer's review surface (DER decode, low-s, recovery-id, viem adapter) is large enough that mixing it with envelope code doubles cognitive load.

### 5.1 Env vars

New env var: `AWS_KMS_SIGNER_KEY_ID` — the KMS asymmetric signing key (ARN, UUID, or alias). Validated by the same `KEY_ID_PATTERN` regex from `aws-kms-provider.ts:89-90`. Separate from `AWS_KMS_KEY_ID` (the K2 symmetric envelope-encryption key).

Reuses unchanged: `AWS_REGION`, `AWS_ROLE_ARN`. The same IAM role assumed via `awsCredentialsProvider({ roleArn })` holds permissions for both keys; the per-key permissions are separated at the IAM policy level (§12), not at the role level.

### 5.2 Construction & public-key caching

Imports: `KMSClient, SignCommand, GetPublicKeyCommand` from `@aws-sdk/client-kms`; `secp256k1` from `@noble/curves/secp256k1`; `keccak_256` from `@noble/hashes/sha3`; `awsCredentialsProvider` from `@vercel/oidc-aws-credentials-provider`.

```ts
const SECP256K1_N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n
const SECP256K1_N_HALF = SECP256K1_N >> 1n

export function createAwsKmsSigner(env: AwsKmsSignerEnv, deps: AwsKmsSignerDeps = {})
  : Pick<A2AKeyProvider, 'signA2AAction'> & { getSignerAddress(): Promise<`0x${string}`> } {
  // env validation: same KEY_ID_PATTERN regex from aws-kms-provider.ts:89-90.
  const client = deps.client ?? new KMSClient({
    region: env.AWS_REGION,
    credentials: awsCredentialsProvider({ roleArn: env.AWS_ROLE_ARN }),
  })
  const timeout = deps.requestTimeoutMs ?? 5000

  let cachedAddress: `0x${string}` | undefined
  let cachedRawPubkey: Uint8Array | undefined  // 64 bytes (X || Y) for recovery-id match

  async function fetchAndCachePubkey() {
    const out = await client.send(
      new GetPublicKeyCommand({ KeyId: env.AWS_KMS_SIGNER_KEY_ID }),
      { abortSignal: AbortSignal.timeout(timeout) })
    if (!out.PublicKey) throw new Error('kms-signer: GetPublicKey returned no key material')
    // PublicKey is DER-encoded SubjectPublicKeyInfo (RFC 5280); unwrap to SEC1 point.
    cachedRawPubkey = extractSec1UncompressedPoint(out.PublicKey)            // 64 bytes
    cachedAddress = ('0x' + bytesToHex(keccak_256(cachedRawPubkey).slice(-20))) as `0x${string}`
  }

  return {
    async getSignerAddress() {
      if (!cachedAddress) await fetchAndCachePubkey()
      return cachedAddress!
    },
    async signA2AAction({ canonicalPayload, accountAddress, chainId, sessionId, actionId, digest }) {
      if (!cachedRawPubkey) await fetchAndCachePubkey()
      const msgHash = digest ?? buildCanonicalDigest({
        canonicalPayload, accountAddress, chainId, sessionId, actionId })
      if (msgHash.length !== 32) throw new Error('digest must be 32 bytes')

      // 1. KMS Sign (DIGEST mode → we pass the already-hashed message)
      const out = await client.send(new SignCommand({
        KeyId: env.AWS_KMS_SIGNER_KEY_ID,
        Message: msgHash,
        MessageType: 'DIGEST',
        SigningAlgorithm: 'ECDSA_SHA_256',
      }), { abortSignal: AbortSignal.timeout(timeout) })
      if (!out.Signature) throw new Error('kms-signer: Sign returned no signature')

      // 2. DER decode → (r, s).      3. low-s normalize.
      const { r, s: sRaw } = derDecodeEcdsaSig(out.Signature)
      const s = sRaw > SECP256K1_N_HALF ? SECP256K1_N - sRaw : sRaw

      // 4. recovery-id: try 0 and 1 against the cached pubkey (post-normalization).
      const recovery = deriveRecoveryId(msgHash, r, s, cachedRawPubkey!)

      // 5. pack r || s || (v = recovery + 27)
      const sig = new Uint8Array(65)
      sig.set(bigIntTo32Bytes(r), 0); sig.set(bigIntTo32Bytes(s), 32); sig[64] = recovery + 27
      return { signature: sig, keyId: env.AWS_KMS_SIGNER_KEY_ID, signerAddress: cachedAddress! }
    },
  }
}
```

Note: we recover against the **normalized** s — the recovery bit that matches the cached pubkey for the post-normalization signature is the v we want. No second-stage flip is needed; the matching loop in `deriveRecoveryId` handles both bits by definition.

### 5.3 DER decoder

`kms:Sign` returns ASN.1 DER, structure `SEQUENCE { r INTEGER, s INTEGER }`. The decoder must handle every well-formed encoding the AWS HSM might produce. There are three edge cases that bit naive decoders:

1. **Leading-zero padding when the high bit is set**: DER requires `INTEGER` values to be encoded as two's-complement big-endian. If the most-significant byte of the integer has its high bit set (≥ `0x80`), DER prepends `0x00` to disambiguate from a negative number. So r and s can each be **33 bytes** in the DER wire form even though they fit in 32 bytes once the prefix is stripped. Strip the leading `0x00` when the length is 33 AND the first byte is `0x00`.

2. **Short integers when the value happens to be small**: if r or s is naturally less than `2^248` (very rare but possible — `~1/256` per byte of leading zero), the DER `INTEGER` length will be < 32. Left-pad back to 32 bytes when packing the EVM signature. The bigint conversion does this for free; the trap is if you write a fixed-offset slicer.

3. **Length encoding**: `SEQUENCE` and `INTEGER` use DER length encoding which is either a single byte (0x00–0x7f) or `0x8X` followed by X length bytes. ECDSA signatures over secp256k1 are always short enough to fit single-byte lengths in practice, but a correct decoder reads the length form rather than assuming.

Concrete implementation (paste-able):

```ts
function derDecodeEcdsaSig(der: Uint8Array): { r: bigint; s: bigint } {
  // Outer: 30 LL ...
  if (der[0] !== 0x30) throw new Error('der: expected SEQUENCE')
  let off = 1
  const seqLen = readDerLen(der, off); off = seqLen.next
  if (seqLen.value !== der.length - seqLen.next) throw new Error('der: seq length mismatch')

  // INTEGER r
  if (der[off] !== 0x02) throw new Error('der: expected INTEGER (r)')
  off++
  const rLen = readDerLen(der, off); off = rLen.next
  const r = bytesToBigInt(stripDerIntegerPad(der.slice(off, off + rLen.value)))
  off += rLen.value

  // INTEGER s
  if (der[off] !== 0x02) throw new Error('der: expected INTEGER (s)')
  off++
  const sLen = readDerLen(der, off); off = sLen.next
  const s = bytesToBigInt(stripDerIntegerPad(der.slice(off, off + sLen.value)))
  off += sLen.value

  if (off !== der.length) throw new Error('der: trailing bytes after signature')
  return { r, s }
}

function readDerLen(buf: Uint8Array, off: number): { value: number; next: number } {
  const b = buf[off]!
  if (b < 0x80) return { value: b, next: off + 1 }
  const n = b & 0x7f
  if (n === 0 || n > 4) throw new Error('der: unsupported length form')
  let v = 0
  for (let i = 0; i < n; i++) v = (v << 8) | buf[off + 1 + i]!
  return { value: v, next: off + 1 + n }
}

function stripDerIntegerPad(b: Uint8Array): Uint8Array {
  // DER prepends 0x00 when the next byte's high bit is set (to keep the
  // integer positive). Strip it. Reject other forms of leading zeros (illegal
  // by DER but tolerated by some encoders).
  if (b.length === 0) throw new Error('der: empty integer')
  if (b[0] === 0x00) {
    if (b.length === 1) return b  // canonical zero
    if ((b[1]! & 0x80) === 0) throw new Error('der: non-minimal integer encoding')
    return b.slice(1)
  }
  return b
}

function bytesToBigInt(b: Uint8Array): bigint {
  let v = 0n
  for (const x of b) v = (v << 8n) | BigInt(x)
  return v
}

function bigIntTo32Bytes(v: bigint): Uint8Array {
  const out = new Uint8Array(32)
  for (let i = 31; i >= 0; i--) { out[i] = Number(v & 0xffn); v >>= 8n }
  if (v !== 0n) throw new Error('integer overflows 32 bytes')
  return out
}
```

### 5.4 Recovery-id derivation

`secp256k1` is a [curve with cofactor 1 and short Weierstrass form](https://www.secg.org/sec2-v2.pdf). For any ECDSA `(r, s)` over a message hash `e`, there are up to four points on the curve whose x-coordinate is congruent to `r` mod n and that satisfy the recovery equation. In practice for secp256k1 they collapse to two — and the `recovery` value of 0 or 1 distinguishes them. (Values 2 and 3 are reserved for the "r overflowed n" case which is statistically negligible — `2^-128` probability.)

`@noble/curves` provides `Signature.recoverPublicKey(hash)` and `Signature.fromCompact(rs).addRecoveryBit(rec)`. We use them:

```ts
import { secp256k1 } from '@noble/curves/secp256k1'

function deriveRecoveryId(
  msgHash: Uint8Array,
  r: bigint,
  s: bigint,           // ALREADY low-s normalized
  expectedRawPubkey: Uint8Array,  // 64 bytes (X || Y)
): 0 | 1 {
  for (const rec of [0, 1] as const) {
    try {
      const sig = new secp256k1.Signature(r, s).addRecoveryBit(rec)
      const recovered = sig.recoverPublicKey(msgHash).toRawBytes(false)  // 65 bytes, 0x04 prefix
      const rawRecovered = recovered.slice(1)                              // 64 bytes
      if (uint8eq(rawRecovered, expectedRawPubkey)) return rec
    } catch { /* recovery failed for this bit; try the other */ }
  }
  throw new Error('kms-signer: neither recovery id matches cached pubkey — KMS returned wrong-key signature?')
}

function uint8eq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
```

The "neither matches" branch is a load-bearing assertion: if it ever fires in production, the KMS key has been swapped, the cached pubkey is stale, or our DER decoder is broken. All three are critical bugs and the right behaviour is to throw, refuse to return a signature, and alarm. (Concrete alarm: `kms-signer: recovery mismatch` log line; CloudWatch metric filter; PagerDuty.)

### 5.5 SPKI → SEC1 uncompressed point extraction

`SubjectPublicKeyInfo ::= SEQUENCE { AlgorithmIdentifier, BIT STRING ec_point }`. Walk:

```ts
function extractSec1UncompressedPoint(spki: Uint8Array): Uint8Array {
  if (spki[0] !== 0x30) throw new Error('spki: expected SEQUENCE')
  let off = 1 + readDerLen(spki, 1).next - 1                 // skip outer len bytes
  if (spki[off] !== 0x30) throw new Error('spki: expected AlgorithmIdentifier SEQUENCE')
  off++
  const algLen = readDerLen(spki, off); off = algLen.next + algLen.value   // skip alg block
  if (spki[off] !== 0x03) throw new Error('spki: expected BIT STRING')
  off++
  const bitLen = readDerLen(spki, off); off = bitLen.next
  if (spki[off] !== 0x00) throw new Error('spki: non-zero unused-bits byte')
  off++
  const point = spki.slice(off, off + bitLen.value - 1)       // 65 bytes
  if (point.length !== 65 || point[0] !== 0x04)
    throw new Error('spki: expected 65-byte SEC1 uncompressed point with 0x04 prefix')
  return point.slice(1)                                       // 64 bytes (X || Y)
}
```

We don't validate the AlgorithmIdentifier OID — AWS returns `1.2.840.10045.2.1 ecPublicKey` + `1.3.132.0.10 secp256k1`; a wrong-curve key is caught implicitly by §5.4 (no recovery bit will match).

### 5.6 Error mapping

Reuse the `mapAwsError` shape from `aws-kms-provider.ts:117-148` with two additions:
- `KMSInvalidSignatureException` (returned when the SigningAlgorithm doesn't match the key spec) → `"kms-signer: invalid algorithm for key"` (this is a deploy misconfiguration; alarm).
- `InvalidKeyUsageException` (key was created with `KeyUsage=ENCRYPT_DECRYPT` instead of `SIGN_VERIFY`) → `"kms-signer: key has wrong KeyUsage (expected SIGN_VERIFY)"` (also a deploy misconfiguration).

---

## 6. Web3 / viem integration — `createKmsAccount`

This is the part that actually ships to app code. viem call sites today look like:

```ts
const masterEoa = privateKeyToAccount(config.A2A_MASTER_EOA_PRIVATE_KEY)
const wallet = createWalletClient({ account: masterEoa, chain: getChain(), transport: http(config.RPC_URL) })
await wallet.writeContract({ /* ... */ })
```

After K4 they should look like:

```ts
const masterEoa = await createKmsAccount(getKeyProvider())  // returns viem.LocalAccount
const wallet = createWalletClient({ account: masterEoa, chain: getChain(), transport: http(config.RPC_URL) })
await wallet.writeContract({ /* ... */ })
```

The only diff is the `account` source. `createKmsAccount` returns a viem `LocalAccount` — same interface as `privateKeyToAccount`'s return value — so every downstream call (`signMessage`, `signTypedData`, `signTransaction`, `writeContract`, `sendTransaction`) flows through unchanged.

**New file**: `packages/sdk/src/key-custody/viem-kms-account.ts`. Built on viem's `toAccount({...})` factory — returns a `LocalAccount` indistinguishable at the type level from `privateKeyToAccount`'s output. Every viem consumer (`walletClient.writeContract`, `sendTransaction`, `signTypedData`, `verifyMessage`) works unchanged.

```ts
export interface KmsAccountBackend {
  signA2AAction: NonNullable<A2AKeyProvider['signA2AAction']>
  getSignerAddress(): Promise<`0x${string}`>
}

export async function createKmsAccount(backend: KmsAccountBackend, opts?: {
  sessionId?: string; chainId?: number
}): Promise<LocalAccount> {
  const address = await backend.getSignerAddress()
  const sessionId = opts?.sessionId ?? 'master-eoa'
  const chainIdStr = String(opts?.chainId ?? 0)

  const sign = async (digest: Uint8Array, actionId: string): Promise<Hex> => {
    const { signature } = await backend.signA2AAction({
      canonicalPayload: new Uint8Array(), accountAddress: address,
      chainId: chainIdStr, sessionId, actionId, digest,
    })
    return ('0x' + bytesToHex(signature)) as Hex   // r || s || (v=recovery+27)
  }

  return toAccount({
    address,
    async signMessage({ message }) {
      return sign(hexToBytes(hashMessage(message)), 'signMessage')      // EIP-191
    },
    async signTypedData(typedData) {
      return sign(hexToBytes(hashTypedData(typedData)), 'signTypedData') // EIP-712
    },
    async signTransaction(tx, { serializer = serializeTransaction } = {}) {
      const unsigned = serializer(tx, undefined)                         // RLP / EIP-2718 pre-image
      const digest = hexToBytes(keccak256(unsigned))
      const sigHex = await sign(digest, 'signTransaction')
      const { r, s, v } = splitHexSig(sigHex)
      return serializer(tx, { r, s, v: BigInt(v) }) as Hex               // viem bakes chainId
    },
  })
}
```

For 1559/2718 transactions viem expects `{r, s, yParity}`; for legacy 155, `{r, s, v=chainId*2+35+recovery}`. We hand viem `{r, s, v=recovery+27}` and viem's serializer normalizes per tx type. The `splitHexSig` helper extracts r (32B), s (32B), v (1B) from the 65-byte signature.

Prior art: `@nomicfoundation/hardhat-ethers` has a community KMS plugin (`@rumblefishdev/hardhat-kms-signer` is the most-starred) that implements the same shape against ethers v6's `AbstractSigner`. viem doesn't ship an official KMS account but its `toAccount` factory is the documented extension point. The integration here is a viem-idiomatic implementation of the same pattern.

**Latency budget**: every method is a single KMS round-trip. Vercel Functions in `us-east-1` calling KMS in `us-east-1` are ~25–40 ms p50, ~70–90 ms p99. Cross-region adds RTT. The current call sites (§7) sign **once per user action**; this is acceptable. Hot-path operations (e.g. a hypothetical "sign 1000 messages per second" loop) would not be — flag them in CI via a lint rule that bans `createKmsAccount` inside a `for`/`map` loop without an explicit `@kms-batched` comment.

---

## 7. App integration — call sites

Grep results from the codebase (relative to `/home/barb/smart-agent/`):

| Call site | Current code | After K4 |
|---|---|---|
| `apps/a2a-agent/src/routes/onchain-redeem.ts:1241` | `const masterEoa = privateKeyToAccount(config.A2A_MASTER_EOA_PRIVATE_KEY)` | `const masterEoa = await createKmsAccount(getMasterSignerBackend())` |
| `apps/a2a-agent/src/config.ts:83` | `A2A_MASTER_EOA_PRIVATE_KEY: env(... '0x000...')` (env loader) | Field deleted in PR-5 (post-30-day soak); replaced by `AWS_KMS_SIGNER_KEY_ID` validation in PR-2 |
| `scripts/deploy-local.sh:431-432` | Writes `A2A_MASTER_EOA_PRIVATE_KEY` to `.env` | Renamed to `A2A_MASTER_PRIVATE_KEY` in PR-1; deleted in PR-5 |
| `apps/a2a-agent/.env.example:60` | `# A2A_MASTER_EOA_PRIVATE_KEY=0x...` | Renamed in PR-1; removed in PR-5 with comment pointing to `AWS_KMS_SIGNER_KEY_ID` |

There is exactly **one runtime call site** (`onchain-redeem.ts:1241`). The other three are configuration plumbing. This makes K4 unusually contained in scope vs the parent KMS migration which touched the entire session-encryption path.

The `getMasterSignerBackend()` helper lives in `apps/a2a-agent/src/auth/a2a-signer.ts` (new file in PR-1), wraps the provider singleton, and exposes the `{ signA2AAction, getSignerAddress }` shape that `createKmsAccount` expects.

`apps/a2a-agent/src/auth/key-provider.ts` (existing, `buildKeyProvider`) gains a sibling export, `buildSignerBackend`, that constructs the K4 signer half. The two halves compose:

```ts
// apps/a2a-agent/src/auth/key-provider.ts (new export)
export function buildSignerBackend(env: KeyProviderEnv): KmsAccountBackend {
  const backend = env.A2A_KMS_BACKEND ?? 'local-aes'
  // Map backends to signer flavors:
  //   local-aes        → local-secp256k1 (dev)
  //   aws-kms          → aws-kms-secp256k1 (prod)
  //   vault-transit    → throw (K4-alt deferred; Vault Transit + secp256k1 unverified)
  switch (backend) {
    case 'local-aes':
      if (!env.A2A_MASTER_PRIVATE_KEY) throw new Error('A2A_MASTER_PRIVATE_KEY required for local-secp256k1 signer')
      return wrapLocalSigner(createLocalSecp256k1Signer({
        A2A_MASTER_PRIVATE_KEY: env.A2A_MASTER_PRIVATE_KEY,
        NODE_ENV: env.NODE_ENV,
      }))
    case 'aws-kms':
      if (!env.AWS_KMS_SIGNER_KEY_ID)
        throw new Error("A2A_KMS_BACKEND='aws-kms' requires AWS_KMS_SIGNER_KEY_ID")
      return createAwsKmsSigner({
        AWS_REGION: env.AWS_REGION!, AWS_ROLE_ARN: env.AWS_ROLE_ARN!,
        AWS_KMS_SIGNER_KEY_ID: env.AWS_KMS_SIGNER_KEY_ID,
      })
    case 'vault-transit':
      throw new Error("K4 vault-transit backend not yet implemented (signer side)")
    default:
      throw new Error(`buildSignerBackend: unknown backend: ${backend}`)
  }
}
```

`wrapLocalSigner` is a tiny adapter that adds `getSignerAddress` (statically derived from the env-loaded private key) so the local backend matches the `KmsAccountBackend` shape.

---

## 8. Public-key fingerprint — operator UX

Before deploying any smart account that lists the master EOA as owner, the operator needs to know the address the new KMS key will produce. Two tools:

### 8.1 CLI script: `scripts/kms-signer-address.ts`

A tsx script that imports `createAwsKmsSigner` from `@smart-agent/sdk/key-custody`, reads `AWS_REGION` / `AWS_ROLE_ARN` / `AWS_KMS_SIGNER_KEY_ID` from env, calls `signer.getSignerAddress()`, and prints the result to stdout. Operator workflow:
1. Create the KMS key in AWS Console: `KeyUsage=SIGN_VERIFY`, `KeySpec=ECC_SECG_P256K1`.
2. Run the script with the new key ARN.
3. Record the address in the deployment runbook (`docs/operations/kms-signer-setup.md`).
4. Pre-fund the address with gas (master EOA pays for `handleOps`).

### 8.2 Startup banner

`apps/a2a-agent/src/index.ts` adds a one-shot startup log:

```
[kms-signer] backend=aws-kms address=0xABC... keyId=arn:aws:kms:us-east-1:...
```

This log line is the single source of truth at runtime. An optional `EXPECTED_KMS_SIGNER_ADDRESS` env var enables an assertion: if set, the boot path asserts the derived address equals the expected value and `process.exit(1)`s on mismatch.

---

## 9. Rotation procedure — on-chain owner migration

The most operationally consequential property of K4. KMS asymmetric keys are immutable — public key and derived address cannot change. Rotation creates a new CMK with a new address; the migration is on-chain.

- **Planned rotation** (annual, post-incident, policy change): procedure below; zero downtime if executed correctly.
- **Emergency rotation** (suspected compromise): same procedure, but step 7's soak collapses to "as soon as the new key works", and the old key's `kms:Disable` is immediate (in-flight signatures fail with `KMSInvalidStateException`, mapped to `kms key unavailable`).

### 9.1 Step-by-step

| Step | Operator action | What happens on-chain | What happens in a2a-agent |
|---|---|---|---|
| 1 | `aws kms create-key --key-spec ECC_SECG_P256K1 --key-usage SIGN_VERIFY ...` (new CMK; do NOT disable the old one) | — | — |
| 2 | `pnpm tsx scripts/kms-signer-address.ts` with the NEW key id | — | Prints new address `0xNEW...` |
| 3 | Pre-fund `0xNEW...` with gas | — | — |
| 4 | From the running a2a-agent (still signing with the OLD key), submit a userOp per smart account that calls `agentAccount.execute(agentAccount, 0, abi.encodeWithSelector(IAgentAccount.addOwner, 0xNEW))` | Every account now has both old + new as owners | a2a-agent uses OLD key to sign |
| 5 | Verify on-chain: `agentAccount.isOwner(0xNEW) == true` for every account | — | — |
| 6 | Update env: `AWS_KMS_SIGNER_KEY_ID=<new>`. Restart a2a-agent | — | a2a-agent reads NEW pubkey on startup; logs `[kms-signer] address=0xNEW...`; signs with NEW key |
| 7 | Observe **24 hours** of clean operation (no signing failures, no userOp reverts attributable to signature mismatch) | — | — |
| 8 | From the now-NEW-keyed a2a-agent, submit a userOp per account: `agentAccount.execute(agentAccount, 0, abi.encodeWithSelector(IAgentAccount.removeOwner, 0xOLD))` | Old address is removed | a2a-agent uses NEW key |
| 9 | `aws kms disable-key --key-id <old>` (or schedule deletion with a 30-day window for paranoia) | — | OLD key now refuses any Sign call |

### 9.2 Critical invariants

- **No "atomic switch" exists.** Between step 4 and step 8, every account has both old and new owners — this is the only safe transition. Trying to swap owners atomically in step 4 (e.g. `removeOwner(old)` + `addOwner(new)` in one execBatch) would brick the account if step 6 fails or the new key's pubkey was extracted incorrectly. The two-key window is mandatory.
- **`addOwner` must be `onlySelf`-callable.** Confirmed at `packages/contracts/src/AgentAccount.sol:548-552`: `addOwner` and `removeOwner` are `onlySelf` (i.e., `msg.sender == address(this)`). The only way to reach them is via the account's own `execute(...)` path, which itself requires an owner-signed userOp. The OLD key is therefore the only entity that can authorize step 4 — and that's correct: rotation must require the live signer.
- **`removeOwner` enforces "at least one signer remains".** `AgentAccount.sol:560-575` checks an invariant on the owner count. Don't try to remove the last owner.
- **Wrong-new-key catastrophe**: if step 2 prints the wrong address (e.g. operator pasted the wrong KeyId), step 4 adds a useless owner. Detection: step 6 logs the runtime address; if it doesn't match the runbook record, abort. Recovery: just don't do step 8. The mistaken owner is dormant and can be removed later from the OLD key.
- **The OLD key is the only thing that can authorize step 4.** If the OLD key is already lost (which is what triggered the rotation), there is no clean rotation — only a recovery procedure via a guardian/passkey path (out of scope for K4; see Hardening §3 on guardian rules).

### 9.3 Rotation in dev (local-secp256k1)

The same procedure applies; step 1 becomes "generate a new hex key", step 6 becomes "edit `.env`". `scripts/fresh-start.sh` short-circuits all of this by wiping all accounts and re-deploying — the dev path doesn't need a rotation drill.

---

## 10. Chain-level integration tests

Senior architects called this out explicitly: K4 must prove that on-chain contracts accept KMS signatures. Three test surfaces:

### 10.1 Foundry: `packages/contracts/test/KmsSigning.t.sol`

Loads a JSON fixture written by the off-chain harness (§10.2). Deploys an `AgentAccount` via `AgentAccountFactory.createAccount(kmsAddress, salt)`. Asserts three things:
- `account.isValidSignature(messageHash, signature) == 0x1626ba7e` (ERC-1271 magic; `AgentAccount.sol:36`).
- `signature.length == 65` and `signature[64] ∈ {27, 28}` (correct v form for ERC-1271 path).
- `s <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0` (low-s normalized).

Fixture format: `{ address: 0x..., messageHash: 0x..., signature: 0x... }`. Written to `packages/contracts/test/fixtures/kms-sig.json` by the test in §10.2.

### 10.2 TypeScript: `apps/a2a-agent/test/kms-signer-integration.test.ts`

The mock-AWS pattern (`aws-sdk-client-mock`) is used at the SigningAlgorithm boundary — we can't mock the actual cryptographic output of `kms:Sign`, so the mock generates a real secp256k1 signature locally via `@noble/curves` (with `lowS: false` to exercise the normalization path), encodes it as DER, and returns it. The K4 SDK code path (DER decode, low-s normalize, recovery id derivation, viem adapter) runs unmodified against this mock.

Test cases:
- `getSignerAddress()` derives the same address as `keccak256(pubkey).slice(-20)` computed locally from the same random key.
- `signMessage('hello')` → `viem.recoverMessageAddress(...)` returns `account.address`.
- `signTypedData({ domain, types, primaryType, message })` → `viem.recoverTypedDataAddress(...)` returns `account.address`. Domain includes chainId + verifyingContract to exercise the EIP-712 path.
- `signTransaction(eip1559Tx)` → `viem.parseTransaction(...)` then `viem.recoverTransactionAddress(...)` returns `account.address`. Repeat for legacy EIP-155.
- Writes the Foundry fixture (§10.1) using `fs.writeFileSync`.

The `buildSpki` helper wraps a 65-byte SEC1 uncompressed point as a DER SubjectPublicKeyInfo with the secp256k1 named-curve OID so `GetPublicKeyCommand` returns realistic bytes.

### 10.3 DER and low-s unit tests

`packages/sdk/test/key-custody/der-decode.test.ts`:
- **Leading-zero pad on high-bit r**: input `30 46 02 21 00 80 FF×31 02 20 11×32` → `r` starts `0x80FF...`, `s` starts `0x1111...`.
- **Non-canonical zero rejection**: input with `0x00` followed by a byte whose high bit is clear → throws `/non-minimal/`.
- **Short integers**: input where `INTEGER` length is < 32 → left-pad to 32 bytes; bigint < `2^248`.
- **Trailing bytes after SEQUENCE**: throws.

`packages/sdk/test/key-custody/low-s.test.ts`:
- Generate a high-s signature locally (`secp256k1.sign(..., { lowS: false })`), encode as DER, feed through the K4 path, assert returned `s <= N/2`.
- Assert `v` flips correctly: noble's signature with `lowS:false` carries a recovery bit; the K4 path's `deriveRecoveryId` against the same pubkey must produce the OTHER bit (because `s` flipped).

### 10.4 Recovery-id matrix

`packages/sdk/test/key-custody/recovery-id.test.ts`: 64 deterministic (seeded) key/message pairs, sign with `lowS: false`, run through `deriveRecoveryId`, assert the recovered address equals the noble-derived address. Seed chosen so both `recovery: 0` and `recovery: 1` appear; the test asserts ≥10 of each.

### 10.5 SPKI extraction

`packages/sdk/test/key-custody/spki-extract.test.ts`: fixture DER strings from `openssl ec -pubout -outform DER` for three known keys; assert `extractSec1UncompressedPoint(...)` returns 64 bytes matching `getPublicKey(priv, false).slice(1)`.

---

## 11. Rollout sequence

Five PRs, ordered for landing safety.

### PR-1: local-secp256k1 signer + viem adapter + a2aSigner wrapper

**Cloud-independent.** No AWS provisioning required. Refactors call sites onto the wrapper but keeps behaviour identical.

Files:
- NEW `packages/sdk/src/key-custody/local-secp256k1-signer.ts` (§4)
- NEW `packages/sdk/src/key-custody/viem-kms-account.ts` (§6)
- EDIT `packages/sdk/src/key-custody/types.ts` — add optional `digest?: Uint8Array` to `signA2AAction` input (§3)
- EDIT `packages/sdk/src/key-custody/index.ts` — re-export new modules
- NEW `apps/a2a-agent/src/auth/a2a-signer.ts` — `getMasterSignerBackend()` singleton
- EDIT `apps/a2a-agent/src/auth/key-provider.ts` — add `buildSignerBackend()`; thread `A2A_MASTER_PRIVATE_KEY` env (renamed from `A2A_MASTER_EOA_PRIVATE_KEY`)
- EDIT `apps/a2a-agent/src/config.ts` — rename `A2A_MASTER_EOA_PRIVATE_KEY` → `A2A_MASTER_PRIVATE_KEY` (keep both readable in env for one PR cycle to avoid breaking running deploys; emit a deprecation warning)
- EDIT `apps/a2a-agent/src/routes/onchain-redeem.ts:1241` — swap `privateKeyToAccount` for `createKmsAccount(getMasterSignerBackend())`
- EDIT `scripts/deploy-local.sh:431-432`, `apps/a2a-agent/.env.example:60` — rename
- NEW `packages/sdk/test/key-custody/local-secp256k1-signer.test.ts` — round-trip vs `privateKeyToAccount`
- NEW `packages/sdk/test/key-custody/viem-kms-account.test.ts` — viem `LocalAccount` shape conformance

Acceptance: `pnpm test` green; `./scripts/fresh-start.sh` succeeds; `onchain-redeem.ts` userOps execute identically.

### PR-2: aws-kms-secp256k1 signer + integration tests

Files:
- NEW `packages/sdk/src/key-custody/aws-kms-signer.ts` (§5)
- EDIT `packages/sdk/src/key-custody/index.ts` — re-export
- EDIT `apps/a2a-agent/src/auth/key-provider.ts` — wire `'aws-kms'` branch in `buildSignerBackend`
- EDIT `apps/a2a-agent/src/config.ts` — read `AWS_KMS_SIGNER_KEY_ID`; validate at boot when `A2A_KMS_BACKEND='aws-kms'`
- NEW `packages/sdk/test/key-custody/der-decode.test.ts`, `low-s.test.ts`, `recovery-id.test.ts`, `spki-extract.test.ts` (§10.3, §10.4)
- NEW `apps/a2a-agent/test/kms-signer-integration.test.ts` (§10.2)
- NEW `packages/contracts/test/KmsSigning.t.sol` (§10.1) + `packages/contracts/test/fixtures/kms-sig.json` (generated)
- NEW `scripts/kms-signer-address.ts` (§8.1)

Acceptance: integration tests pass; the off-chain test writes a fixture; the on-chain Foundry test reads it and `isValidSignature` returns the ERC-1271 magic value.

### PR-3: Operator runbook

Files:
- NEW `docs/operations/kms-signer-setup.md`:
  - AWS Console steps for creating the asymmetric CMK
  - IAM permissions (§12)
  - `kms-signer-address.ts` usage
  - Address pre-funding
  - **Rotation procedure** (§9) — verbatim copy of the table

Acceptance: a reviewer who has never seen K4 can follow the runbook end-to-end.

### PR-4: Production cutover

In Vercel production env: set `A2A_KMS_BACKEND=aws-kms` + `AWS_KMS_SIGNER_KEY_ID=<arn>`. Restart a2a-agent. The startup banner (§8.2) prints the new master EOA address. Operator confirms it matches the runbook. Monitor for 24 hours.

Acceptance: zero signing failures in CloudWatch; userOps execute as before.

### PR-5: Remove legacy env var

After 30-day soak:
- DELETE `A2A_MASTER_PRIVATE_KEY` / `A2A_MASTER_EOA_PRIVATE_KEY` from all env files
- DELETE the field from `apps/a2a-agent/src/config.ts`
- DELETE the rename plumbing from PR-1
- ENFORCE in CI: `scripts/check-no-bypass.sh` greps for `A2A_MASTER_EOA_PRIVATE_KEY` and `A2A_MASTER_PRIVATE_KEY` in any `*.ts` / `*.sh` / `.env*` file and fails

Acceptance: no occurrence of either env name in the repo.

---

## 12. IAM additions

K2 already grants the a2a-agent IAM role: `kms:GenerateDataKey`, `kms:Decrypt`, `kms:DescribeKey` on the symmetric envelope CMK. K4 adds a new statement on the runtime role:

- **Allow** `kms:Sign`, `kms:GetPublicKey`, `kms:DescribeKey`
- **Resource**: `arn:aws:kms:<region>:<account>:key/<signer-key-uuid>` (the K4 signing CMK, separate from the K2 envelope CMK)
- **Condition**: `kms:SigningAlgorithm == ECDSA_SHA_256` AND `kms:MessageType == DIGEST`

The Condition is load-bearing: pinning `MessageType=DIGEST` means an attacker who pops the agent process can ask KMS to sign a 32-byte digest but cannot ask KMS to hash arbitrary input (`MessageType=RAW`), limiting the malicious payloads they can construct. The algorithm pin prevents downgrade to a non-secp256k1 signature shape if the key ever supports multiple.

The signer CMK's **key policy** additionally restricts the same three actions to the a2a-agent role principal. The role's trust policy (Vercel OIDC binding) is shared with K2 — no change.

**Critical**: do NOT add `kms:CreateGrant`, `kms:ScheduleKeyDeletion`, or `kms:DisableKey` to the runtime role. Those operations belong to the deployer role (PR-3 runbook). Runtime agent must not be able to brick or sidestep its own signer.

---

## 13. Senior-architect Q&A

| Question | Answer |
|---|---|
| **KMS Sign latency breaks a hot path?** | Audit of current `A2A_MASTER_EOA_PRIVATE_KEY`: exactly **one** call site (`onchain-redeem.ts:1241`), one userOp per user-initiated chain write. 30–50ms is acceptable. Future hot paths: batch via multicall (one signature for many ops) or move to a session-scoped subordinate signer (K5). No local-key fallback "for performance" — that defeats the blast-radius argument. |
| **What if AWS KMS is down?** | a2a-agent fails closed: 503 on `/session/.../redeem-via-account`. KMS 99.999% multi-AZ exceeds our 99.9% target. 5-second `AbortController` timeout (inherited from K2's `aws-kms-provider.ts:85,196`) bounds failure latency. No local-secp256k1 fallback in prod. |
| **Local backup signer for "emergency only"?** | No. A backup signer with the same authority is the same threat surface as the pre-K4 env var. The rotation procedure (§9) is the DR answer: if KMS is permanently unavailable for the region, rotate to a new key in a different region. |
| **AWS insider tampering with the KMS key?** | Three layers: (1) `GetPublicKey` is cached at startup — swapped material changes the derived address; (2) optional `EXPECTED_KMS_SIGNER_ADDRESS` makes mismatch fail boot; (3) CloudTrail records every `Sign`/`GetPublicKey` call, ingested by Phase 1D. Insider attack requires (a) swap key, (b) suppress CloudTrail, (c) collude across AWS org boundary. We trust AWS at that level; we do not trust env-resident keys at that level. |
| **ERC-1271 from smart accounts (not the master EOA)?** | Out of scope for K4. Smart-account session signatures are per-session keys inside the encrypted session package (K0+K1 envelope). K5 migrates them to KMS via the same interface; no architectural change needed when it lands. |
| **Why `ECDSA_SHA_256` not `ECDSA_SHA_384`?** | With `MessageType=DIGEST` we pass the keccak-256 hash directly and AWS does not re-hash. The "SHA_256" in the algorithm name is misleading per AWS docs ("for DIGEST mode the Message is assumed to be the output of any 32-byte hash, regardless of the name"). `ECDSA_SHA_384` would require a 48-byte digest — breaks the EVM flow. |
| **Address-fingerprint check on production deploy?** | PR-4 step: operator records `scripts/kms-signer-address.ts` output in the runbook; startup banner prints the same address. Setting `EXPECTED_KMS_SIGNER_ADDRESS` makes mismatch fail boot. A pre-cutover Foundry script `script/VerifyKmsAddress.s.sol` calls `account.isOwner(expectedAddr)` against every existing SessionAgentAccount before flipping env. |
| **Compromised a2a-agent process abusing the signer?** | Same as today's risk profile. Defenses: (a) signer wrapper logs every Sign with the binding tuple (sessionId, accountAddress, chainId, actionId); CloudWatch alarm on volume anomalies; (b) IAM Condition pins `MessageType=DIGEST` + `ECDSA_SHA_256` so the attacker can't repurpose for arbitrary signing; (c) langchain-in-sandbox-subprocess (Hardening §4.1) is the structural answer. |
| **MEV / front-running the rotation transactions?** | Step 4's `addOwner` userOps are public, but `addOwner` is `onlySelf` and requires a userOp signed by the existing owner (OLD KMS key). MEV cannot synthesize that signature. The only info leaked is "operator is rotating now" — not a privacy property we depend on. |

---

## 14. Out of scope (explicit)

- **Smart-account session-signer migration to KMS**: K5. Different shape (per-session, ephemeral, high volume) than shared master EOA. `signA2AAction` is portable; K5 reuses it with a per-session `keyVersion`.
- **CloudHSM (FIPS 140-3 Level 3)**: KMS asymmetric keys are already FIPS 140-2 Level 3 backed; CloudHSM adds operational burden (PKCS#11, key ceremonies, HA) for no integrity gain we need.
- **Multi-region KMS replication**: operational concern (regional DR), not architectural. K4 SDK works against single- or multi-region keys identically.
- **Threshold / MPC signatures**: out of scope. Single KMS key + on-chain rotation suffices for the master-EOA threat model.
- **TOOL_EXECUTOR_*_PRIVATE_KEY migration**: K5 (parent §11). **DEPLOYER_PRIVATE_KEY**: K6. **HMAC keys**: K3-extension.

---

## 15. Implementation handoff — PR-1 sub-agent prompt

End-to-end sub-agent prompt for the cloud-independent PR-1 (PR-2's AWS-KMS prompt is structurally identical, dispatched after PR-1 soaks):

> Implement KMS migration **K4 PR-1 — local-secp256k1 signer + viem KMS account adapter + a2aSigner wrapper + call-site swap**. This PR is intentionally cloud-independent: no AWS provisioning, no KMS calls, no new env vars beyond renaming `A2A_MASTER_EOA_PRIVATE_KEY` → `A2A_MASTER_PRIVATE_KEY`. Behaviour-identical to today; only the layering changes. Read `/home/barb/smart-agent/output/K4-IMPLEMENTATION-PLAN.md` first, especially §3 (interface), §4 (local signer), §6 (viem adapter), §7 (call-site swap), §11 PR-1 (scope).
>
> **Scope**:
> 1. `packages/sdk/src/key-custody/types.ts`: add optional `digest?: Uint8Array` to `signA2AAction` input.
> 2. `packages/sdk/src/key-custody/local-secp256k1-signer.ts` (NEW): per §4. `@noble/curves/secp256k1` + `@noble/hashes/sha3` (already transitive viem deps). Refuse `NODE_ENV='production'`.
> 3. `packages/sdk/src/key-custody/viem-kms-account.ts` (NEW): per §6. `createKmsAccount(backend, opts?)` → `viem.LocalAccount` via `toAccount`. Implements `signMessage` (EIP-191), `signTypedData` (EIP-712), `signTransaction` (1559 + legacy 155).
> 4. `packages/sdk/src/key-custody/index.ts`: re-export.
> 5. `apps/a2a-agent/src/auth/a2a-signer.ts` (NEW): `getMasterSignerBackend()` lazy singleton.
> 6. `apps/a2a-agent/src/auth/key-provider.ts`: add `buildSignerBackend(env)`. Three branches per `A2A_KMS_BACKEND`: `'local-aes'` → local-secp256k1, `'aws-kms'` → throw "not yet implemented (K4 PR-2)", `'vault-transit'` → throw.
> 7. `apps/a2a-agent/src/config.ts`: read `A2A_MASTER_PRIVATE_KEY` with fallback to `A2A_MASTER_EOA_PRIVATE_KEY` + deprecation `console.warn`.
> 8. `apps/a2a-agent/src/routes/onchain-redeem.ts:1241`: swap `privateKeyToAccount(...)` → `await createKmsAccount(getMasterSignerBackend())`.
> 9. `scripts/deploy-local.sh:431-432` + `apps/a2a-agent/.env.example:60`: rename, keep old commented for one cycle.
> 10. Tests:
>     - `packages/sdk/test/key-custody/local-secp256k1-signer.test.ts`: address-derivation parity with `privateKeyToAccount`; `recoverMessageAddress` round-trip.
>     - `packages/sdk/test/key-custody/viem-kms-account.test.ts`: `LocalAccount` shape conformance; round-trip `signMessage` / `signTypedData` / `signTransaction` through viem's recover functions. Assert recovered address matches (not raw bytes — low-s normalization may differ from `privateKeyToAccount`).
>     - `apps/a2a-agent/test/a2a-signer.test.ts`: works under `A2A_KMS_BACKEND=local-aes`; throws cleanly under `'aws-kms'`.
> 11. Acceptance: `pnpm test` / `pnpm typecheck` / `pnpm lint` all green; `./scripts/fresh-start.sh` succeeds end-to-end; `onchain-redeem.ts` executes a real userOp via the new path.
>
> **Forbidden in this PR**: any `@aws-sdk/client-kms` import; any change to `A2AKeyProvider.signA2AAction` beyond adding `digest?`; deletion of the legacy env name (PR-5).

---

## Implementation start

PR-1 lands the cloud-independent half of K4 — the layering refactor, the viem adapter, the call-site swap. Acceptance is "fresh-start.sh succeeds + onchain-redeem.ts userOps execute identically to today + tests pass". No AWS provisioning required.

PR-2 (deferred until PR-1 has soaked one week) lands the AWS KMS signer implementation against the interface PR-1 built. PR-2's sub-agent prompt will mirror PR-1's shape — it adds `aws-kms-signer.ts` per §5, fills in the `'aws-kms'` branch of `buildSignerBackend`, adds the DER / low-s / recovery-id / SPKI tests (§10.3, §10.4), wires `AWS_KMS_SIGNER_KEY_ID` through `config.ts`, and writes the Foundry fixture-driven `KmsSigning.t.sol` (§10.1) that proves on-chain ERC-1271 acceptance of KMS-derived signatures.

PR-3 (runbook), PR-4 (production cutover), PR-5 (legacy env removal) follow per §11.

**Dispatch PR-1 next.**
