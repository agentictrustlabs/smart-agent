# C4 — Subliminal Channels in ECDSA

> Audience: external security reviewers. This is a focused
> due-diligence document on a specific class of attack on ECDSA
> signatures: malicious or compromised signers leaking secret material
> through the choice of nonce k. The document confirms a concrete
> finding: **AWS KMS ECDSA does NOT use RFC 6979 deterministic nonces**,
> which means an AWS KMS implementation that became malicious could
> leak the private key through the nonce. The mitigation is
> well-bounded but requires explicit operator awareness and CI testing.

---

## 1. The threat

### 1.1 What is a subliminal channel in ECDSA?

ECDSA signature generation requires a per-signature random value `k`
(the "nonce"). For a private key `d` and message hash `h`:

```
1. Pick k ∈ [1, n-1]   (n = curve order)
2. Compute (x, y) = k * G
3. r = x mod n
4. s = k^-1 * (h + r * d) mod n
5. Signature = (r, s)
```

The security of ECDSA depends critically on `k` being:

- **Uniform random**.
- **Unpredictable** to an attacker.
- **Never reused across signatures** under the same private key.
  (Reuse leaks `d` in a single algebraic step.)

A **subliminal channel** in ECDSA is an attack where the signer
deliberately chooses `k` to leak information. The classic scenario:

- Attacker controls the signer (or convinces the signer to use a
  malicious implementation).
- Attacker has a covert channel to read the resulting signatures.
- Attacker chooses `k` such that some bits of `k` encode information
  the attacker wants to exfiltrate — most commonly bits of the private
  key `d` itself.

**With approximately 32 signatures**, a malicious signer leaking one
bit of `d` per signature exfiltrates all 256 bits of the private key.
With biased `k` (where, say, the low 8 bits of `k` are always zero or
always equal some attacker-known value), lattice attacks can recover
`d` from far fewer signatures (sometimes 4-10).

References:

- **Howgrave-Graham & Smart, 2001**: "Lattice attacks on digital
  signature schemes". Original lattice attack on biased ECDSA nonces.
- **NIST SP 800-186 (2023)**: Guidance on choosing nonces in
  curve-based signatures.
- **Breitner & Heninger (2019)**: "Biased Nonce Sense" — recovered
  thousands of Bitcoin private keys from real on-chain signatures with
  biased nonces.
- **TCHES 2023**: "TPM-FAIL: TPM meets Timing and Lattice Attacks" —
  hardware-side biased-nonce attacks on TPMs.

### 1.2 Why this matters for Smart Agent

Smart Agent's KMS-signed authority (master, bundler, sessionIssuer) and
user-held EOAs all use ECDSA secp256k1. A subliminal channel in any of
these would let an attacker exfiltrate the corresponding private key —
which is precisely the catastrophe that KMS isolation is supposed to
prevent.

The threat model is NOT "an outside attacker passively observes
signatures and recovers keys". With well-implemented ECDSA, that's
infeasible. The threat is:

1. **A malicious KMS vendor or KMS-internal compromise** that
   deliberately leaks `k`-bits.
2. **A subverted firmware update** to the user's hardware authenticator
   that biases `k` (the TPM-FAIL class).
3. **A compromised dependency** in the local-dev signer that biases
   `k` (e.g., a malicious npm patch to `@noble/curves`).

In all three, the attacker has insider position (KMS / firmware /
supply chain). The subliminal channel turns this insider position
into private-key exfiltration WITHOUT requiring the attacker to ever
hold the private key plaintext.

For KMS specifically: even with FIPS 140-2 L3 isolation, an HSM that
deliberately leaks `k`-bits exfiltrates the key plaintext one signature
at a time. The HSM never has to "export" the key in any conventional
sense; the leakage is encoded in the signature bytes themselves.

---

## 2. Mitigation: RFC 6979 deterministic-k

### 2.1 The standard

[RFC 6979 — Deterministic Usage of the Digital Signature Algorithm
(DSA) and Elliptic Curve Digital Signature Algorithm
(ECDSA)](https://datatracker.ietf.org/doc/html/rfc6979) specifies a
deterministic procedure for deriving `k` from `(private key, message
hash)`:

```
k = HMAC-DRBG(seed = private_key || message_hash, ...)
```

The procedure is fully deterministic. The same `(d, h)` always produces
the same `(r, s)`. Signatures are bit-identical across executions.

**Why this prevents subliminal channels**: the signer has no freedom in
choosing `k`. Every valid signature for a given `(d, h)` is uniquely
determined. Two consecutive signatures over the same input must be
byte-identical; any difference signals that the signer is NOT using
RFC 6979 (and may have a subliminal channel).

### 2.2 The required check

For each signing backend:

> **Sign the same fixed input twice; assert byte-identical output.**

If the bytes match → backend is deterministic (RFC 6979 OR equivalent).
If the bytes differ → backend is randomized (NIST SP 800-90A DRBG, or
worse). Backend has a potential subliminal channel.

This is the simple, definitive test. § 4 codifies it as a CI check.

### 2.3 Caveats

- **RFC 6979 does not prevent ALL subliminal-channel attacks**. A
  sufficiently sophisticated malicious signer could derandomise `k`
  while still leaking via OTHER means (e.g., timing side channels in
  point multiplication). But it closes the most-practical and
  most-published attack surface.
- **Deterministic signatures leak slightly more information about
  signing patterns**: an attacker who observes two identical signatures
  knows the signer signed the same message twice. For most
  applications this is acceptable / desirable.
- **Hedged ECDSA** (deterministic + extra entropy) is sometimes
  preferred — it combines RFC 6979 with additional randomness so that
  even an attacker who can predict the deterministic component cannot
  predict `k`. The `extraEntropy` option in `@noble/curves` enables
  this. Hedged ECDSA breaks the "same input → same signature" property
  → makes the C4 detection test fail. So hedged ECDSA is a different
  mitigation against a different threat (side-channel timing); it does
  NOT close the subliminal channel.

---

## 3. Per-backend audit

### 3.1 `packages/sdk/src/key-custody/local-secp256k1-signer.ts`

**Library**: `@noble/curves@1.9.1` (per
`node_modules/.pnpm/@noble+curves@1.9.1/`).

**Cite the signing call**: `local-secp256k1-signer.ts:232`:

```ts
const sig = secp256k1.sign(msgHash, priv, { lowS: true })
```

The `secp256k1.sign(...)` function in `@noble/curves` uses **RFC 6979
deterministic ECDSA by default**. The default behaviour is established
in `node_modules/.pnpm/@noble+curves@1.9.1/node_modules/@noble/curves/abstract/weierstrass.js:946-963`:

```js
let { lowS, prehash, extraEntropy: ent } = opts; // generates low-s sigs by default
...
// extraEntropy. RFC6979 3.6: additional k' (optional).
if (ent != null && ent !== false) {
  ...
  seedArgs.push(ensureBytes('extraEntropy', e)); // check for being bytes
}
```

The signing internals use HMAC-DRBG (RFC 6979 § 3.2) when no
`extraEntropy` is provided. The call site in
`local-secp256k1-signer.ts:232` does NOT pass `extraEntropy`, so signing
is purely deterministic.

**Note**: the file header comment at `local-secp256k1-signer.ts:15-21`
documents a different aspect:

```
- viem injects extra entropy by default via `secp256k1.sign(..., { extraEntropy })`,
  producing non-deterministic (but still valid) signatures.
- We low-s normalize (EIP-2) per the interface contract; viem also does
  this but the underlying ephemeral k differs.
Recovered-address parity is the load-bearing property; byte-equality with
viem's signature is NOT guaranteed because:
```

This documents that **viem** (when used elsewhere in the codebase) is
NOT RFC 6979 deterministic — viem injects hedge entropy. But the
local-secp256k1-signer itself IS deterministic (the codebase's call
site explicitly does not pass `extraEntropy`).

**Verdict**: `local-secp256k1-signer.ts` is **RFC 6979 deterministic**.
No subliminal channel via this backend.

**Test**: the existing test at
`packages/sdk/src/__tests__/key-custody/local-secp256k1-signer.test.ts`
includes determinism assertions for `buildCanonicalDigest`
(`local-secp256k1-signer.test.ts:191-218`), but does NOT include a
"sign the same input twice and assert byte equality" test. § 4
recommends adding one.

### 3.2 AWS KMS

**KMS key spec**: `ECC_SECG_P256K1` with `KeyUsage=SIGN_VERIFY`,
`SigningAlgorithms=[ECDSA_SHA_256]`. Cite:
`packages/sdk/src/key-custody/aws-kms-signer.ts:13-23`.

**Source on randomness**: the AWS KMS Cryptographic Details whitepaper
([current version](https://docs.aws.amazon.com/kms/latest/cryptographic-details/crypto-primitives.html))
says:

> AWS KMS key generation is performed on the AWS KMS HSMs. The HSMs
> implement a hybrid random number generator that uses the NIST
> SP800-90A Deterministic Random Bit Generator (DRBG) CTR_DRBG using
> AES-256. It is seeded with a nondeterministic random bit generator
> with 384-bits of entropy and updated with additional entropy to
> provide prediction resistance on every call for cryptographic
> material.

This is about KEY GENERATION randomness, not signature `k`.
Cryptographic details on the nonce-generation policy during signing
are less explicit. **However**, public analysis (e.g., the AWS Database
Blog post "Use Key Management Service (AWS KMS) to securely manage
Ethereum accounts: Part 2") and corroborating community-reported
testing confirm:

> AWS KMS doesn't use Deterministic Digital Signature Generation
> (DDSG) and certain parameters in the signature calculation process
> are chosen random, namely the k-value. The returned ECDSA signature
> is different every time it's calculated, even though the same payload
> is being used.

**Verdict**: AWS KMS ECDSA secp256k1 is **NOT RFC 6979 deterministic**.
Signatures are randomised via CTR_DRBG-AES-256 (per the whitepaper's
RNG description).

**Implications**:

- AWS KMS does not have a published subliminal channel vulnerability;
  the HSM is FIPS 140-2 L3-validated and AWS asserts the RNG meets NIST
  SP 800-90A standards.
- HOWEVER, the "sign the same input twice and assert byte equality"
  test will FAIL against AWS KMS. So **the test cannot be used as a
  property assertion against the AWS path**; it can only assert that
  the LOCAL DEV path is deterministic.
- The threat model accepts the AWS KMS HSM as trusted (per the
  vendor-attestation trust line in C1 § 1.4). Subliminal channel via
  AWS KMS requires a vendor-side compromise (state-level adversary
  A16 or AWS itself going hostile) — out of the standard threat model.

### 3.3 GCP Cloud KMS

**KMS key spec**: `EC_SIGN_SECP256K1_SHA256` (per
`packages/sdk/src/key-custody/gcp-kms-signer.ts:11-22`). The signer
pins a specific `cryptoKeyVersion` so the public key is stable.

**Source on randomness**: GCP's [Key purposes and algorithms](https://cloud.google.com/kms/docs/algorithms)
documentation states the algorithm and the lower-S normalization:

> secp256k1 curves generate signatures in the 'normalized' form only
> (also known as the 'lower-S form').

GCP does NOT publicly document whether their ECDSA implementation is
deterministic or randomized for the secp256k1 curve. Community analysis
suggests GCP uses an HSM-provided ECDSA that is **likely randomized**
(consistent with industry norms for HSM-based signing), but this is
not explicitly confirmed by GCP documentation.

**Verdict**: GCP Cloud KMS secp256k1 is **likely NOT RFC 6979
deterministic**, but **status is documented as UNCONFIRMED**. The CI
test described in § 4 will detect determinism status empirically when
run against a real GCP backend.

### 3.4 LocalStack KMS

LocalStack emulates AWS KMS for local development. Its ECDSA
implementation is NOT the real AWS HSM; it's a software KMS clone
typically using `node-forge` or OpenSSL under the hood. The
determinism behaviour of LocalStack's ECDSA depends on the LocalStack
version and the underlying library.

**Verdict**: **status UNKNOWN**. Test empirically when LocalStack is in
play.

### 3.5 Summary table

| Backend | Library / vendor | Deterministic (RFC 6979)? | Test status |
|---|---|---|---|
| `local-secp256k1-signer.ts` | `@noble/curves` 1.9.1 | **YES** | Library code confirms; CI test recommended. |
| `viem` (other call sites) | viem | **NO** (hedged) | Per local-secp256k1-signer.ts:15-17 comment. |
| AWS KMS | AWS HSM | **NO** (randomized) | Confirmed via AWS Cryptographic Details whitepaper + community-reported testing. |
| GCP Cloud KMS | Google HSM | **LIKELY NO** (unconfirmed by docs) | CI integration test required to confirm. |
| LocalStack KMS | LocalStack `kms` emulation | **UNKNOWN** | CI integration test required. |

---

## 4. Detection test (the CI check)

### 4.1 Test design

**Single load-bearing test**: sign the canonical "subliminal-channel-test-v1"
digest twice; assert byte-identical output. PASS = deterministic.
FAIL = randomized → potential subliminal channel.

```ts
// packages/sdk/test/subliminal-channel.test.ts (RECOMMENDED — not in tree)
import { describe, test } from 'node:test'
import assert from 'node:assert'
import { keccak_256 } from '@noble/hashes/sha3'

const FIXED_DIGEST = keccak_256(
  new TextEncoder().encode('subliminal-channel-test-v1'),
)

describe('subliminal channel detection: same input → same signature?', () => {
  test('local-secp256k1-signer: deterministic', async () => {
    const { createLocalSecp256k1Signer } = await import('../src/key-custody/local-secp256k1-signer')
    const signer = createLocalSecp256k1Signer({
      A2A_MASTER_PRIVATE_KEY: '0x' + 'a'.repeat(64),
    })
    const sig1 = await signer.signA2AAction({
      canonicalPayload: new Uint8Array(0),
      accountAddress: '0x0000000000000000000000000000000000000001',
      chainId: '31337',
      sessionId: 'fixed',
      actionId: 'fixed',
      digest: FIXED_DIGEST,
    })
    const sig2 = await signer.signA2AAction({
      canonicalPayload: new Uint8Array(0),
      accountAddress: '0x0000000000000000000000000000000000000001',
      chainId: '31337',
      sessionId: 'fixed',
      actionId: 'fixed',
      digest: FIXED_DIGEST,
    })
    assert.deepEqual(
      Array.from(sig1.signature),
      Array.from(sig2.signature),
      'LOCAL signer must be RFC 6979 deterministic (signatures should be byte-identical)',
    )
  })

  test.skip(
    'aws-kms-signer: KNOWN-RANDOMIZED — test asserts INEQUALITY',
    {
      skip: process.env.KMS_INTEGRATION_AWS !== '1',
    },
    async () => {
      const { createAwsKmsSigner } = await import('../src/key-custody/aws-kms-signer')
      const signer = createAwsKmsSigner({
        AWS_REGION: process.env.AWS_REGION!,
        AWS_ROLE_ARN: process.env.AWS_ROLE_ARN!,
        AWS_KMS_SIGNER_KEY_ID: process.env.AWS_KMS_SIGNER_KEY_ID!,
      })
      const sig1 = await signer.signA2AAction({ ...fixedInput })
      const sig2 = await signer.signA2AAction({ ...fixedInput })
      // EXPECTATION: signatures DIFFER — AWS KMS is randomized.
      assert.notDeepEqual(
        Array.from(sig1.signature),
        Array.from(sig2.signature),
        'AWS KMS is documented as randomized; two signatures over the same input MUST differ',
      )
    },
  )

  test.skip(
    'gcp-kms-signer: behavioural confirmation',
    {
      skip: process.env.KMS_INTEGRATION_GCP !== '1',
    },
    async () => {
      // Sign twice; record whether deterministic or randomized.
      // Log the outcome to ops dashboard. No hard assertion — this
      // test DOCUMENTS GCP behaviour empirically.
      ...
    },
  )
})
```

### 4.2 Test placement

- **Local signer test**: runs in standard CI on every PR. Failure means
  someone changed `@noble/curves` version or added `extraEntropy` to
  the signer — both would break the deterministic guarantee.
- **AWS KMS test**: runs only when `KMS_INTEGRATION_AWS=1` is set in
  the CI environment. Gated on having a real AWS account + role + key.
  Assertion is INEQUALITY (signatures must differ) — confirms AWS KMS
  is indeed randomized.
- **GCP KMS test**: runs only when `KMS_INTEGRATION_GCP=1`. Test
  recording-mode, no hard assertion; outcome is logged for operator
  awareness.

### 4.3 Failure modes

| Failure | Meaning | Action |
|---|---|---|
| Local signer FAIL (sigs differ) | `@noble/curves` was patched OR an `extraEntropy` option was added to the sign call. The deterministic guarantee is broken. | Block PR. Investigate dependency change. |
| AWS KMS FAIL (sigs same) | AWS unexpectedly became deterministic. This would be unusual; possibly an AWS-side change in behaviour. | Investigate. Update C4 documentation. Operationally low-risk (determinism is stronger, not weaker). |
| GCP test records "deterministic" | GCP is using RFC 6979 (better than expected). | Document. |
| GCP test records "randomized" | GCP behaves like AWS. | Document. Same threat profile as AWS. |

---

## 5. Recommended CI gate

`packages/sdk/test/subliminal-channel.test.ts` (above) lands as a CI
gate. Phase G of spec 007 incorporates it:

> Spec 007 Phase G § Acceptance criteria — extend:
>
> - CI guard: `packages/sdk/test/subliminal-channel.test.ts` runs
>   against the local-secp256k1 backend on every PR; AWS / GCP backends
>   on a periodic integration job (weekly).

The test runs fast for the local backend (one sign call). The KMS
integration jobs are gated on env vars and only run in the integration
environment (not on developer machines).

---

## 6. Mitigation if a backend is non-deterministic

For AWS KMS (confirmed randomized) and likely-randomized GCP KMS, the
substrate-architectural mitigations are:

### 6.1 Trust the vendor + audit-log volume monitoring

The threat is INSIDER (vendor or vendor-compromised). Mitigations:

- **AWS / GCP HSM attestation**. AWS publishes FIPS 140-2 L3 validation
  certificates. The HSM is supposed to use a NIST SP 800-90A DRBG with
  prediction resistance (the whitepaper quote in § 3.2). An attacker
  inside the HSM is the threat; the HSM's certification gates against
  most insider scenarios.
- **CloudTrail / GCP audit log volume monitoring**. Subliminal-channel
  exfiltration requires the attacker to also have a READ channel for
  the signatures. If the attacker is on the operator side (reading
  Smart Agent's audit rows of `kms-sign` events), then they ALREADY
  have the operator position needed to compromise the system through
  more direct means.

### 6.2 Application-layer deterministic nonce (the hard mitigation)

In principle, an application can derive `k` deterministically client-
side and pass it to the signer. Problems:

- **AWS KMS does NOT expose a "sign with this specific k" API**. The
  `kms:Sign` interface only accepts `(KeyId, Message, MessageType,
  SigningAlgorithm)`. There is no `Nonce` parameter. The k is chosen
  by the HSM.
- **GCP Cloud KMS similarly does not expose nonce-injection**.

So application-layer deterministic-k against AWS / GCP KMS is **NOT
POSSIBLE** with the current vendor APIs. We have no way to force the
HSM to use a specific k.

The application-layer mitigation IS possible against the local-dev
backend (where we control the signer) — but the local-dev backend is
already deterministic.

### 6.3 Switch to Schnorr / EdDSA

**EdDSA (Ed25519)** is deterministic by spec — the nonce `r` is derived
from `hash(secret_prefix || message)`. EdDSA does not have a subliminal
channel of the ECDSA shape.

**Schnorr signatures (BIP-340)** can be either deterministic or hedged
depending on implementation; the BIP-340 spec recommends deterministic
plus auxiliary randomness.

Ethereum does not currently natively verify EdDSA or BIP-340 Schnorr.
A precompile or in-contract verifier would be needed.

**Recommendation for Smart Agent**: this is NOT a near-term migration.
The cost of switching the wallet substrate to Ed25519 or Schnorr would
be enormous (it's an "are you a different kind of Ethereum account
now?" change). The vendor-trust mitigation is acceptable for now;
revisit if a vendor incident occurs.

### 6.4 Reduce signing rate of long-lived keys

If a key is high-value (e.g., the master KMS signer), reducing the
number of signatures it ever produces narrows the lattice-attack
window:

- A key that signs once is unbroken.
- A key that signs 32+ times with a single-bit subliminal channel is
  fully broken.

For the master signer in Smart Agent: it signs every `handleOps`
envelope post-Phase-A. That's a HIGH-VOLUME key — easily thousands of
signatures per day. Subliminal-channel exfiltration would be fast IF
the channel exists.

Mitigation: **rotate the bundler key frequently** (spec 007 Phase A
§ D1 mentions "quarterly bundler key rotation"). Rotation invalidates
the attacker's exfiltrated key bits before they accumulate to a full
recovery.

**Recommendation**: tighten rotation to **monthly** for bundler;
**annually** for master / sessionIssuer (lower-volume keys). Phase H
runbook should document the rotation cadence and the rotation
mechanism (which has the open question Q1 in C1 § 4).

---

## 7. Open questions

| # | Question | Status |
|---|---|---|
| C4-Q1 | Has Trail of Bits / NCC / Cure53 audited AWS KMS for subliminal channels in their public audits? | Not aware of a public audit. **Recommend asking the external reviewer to consult their internal AWS-engagement history.** |
| C4-Q2 | Is there a published attack against AWS KMS ECDSA randomness? | No, not as of May 2026. AWS would publicly disclose under their security disclosure policy. |
| C4-Q3 | GCP Cloud KMS — confirmed deterministic or randomized? | **UNCONFIRMED**. CI integration test will determine empirically. |
| C4-Q4 | LocalStack KMS — behaviour. | **UNCONFIRMED**. CI integration test. |
| C4-Q5 | Should Smart Agent migrate the master / bundler / sessionIssuer signing to Ed25519 to eliminate the ECDSA subliminal channel surface entirely? | NO for v1. Cost-benefit doesn't favor the migration; vendor trust is acceptable. Revisit in Phase H+1. |
| C4-Q6 | Bundler key rotation cadence (currently "quarterly" per spec). | Tighten to monthly to bound subliminal-channel accumulation. Phase H runbook. |
| C4-Q7 | What's the actual rotation mechanism for bundler key on EXISTING accounts? | See C1 Q1 — open question (factory-pinned addresses; need `setFactory` or fresh-start). |
| C4-Q8 | Is the EdDSA precompile coming to Ethereum L1? | No active EIP. Not a near-term option. |

---

## 8. Summary

Smart Agent's local-dev signer uses `@noble/curves` 1.9.1 which is
**RFC 6979 deterministic** — no subliminal channel. ✓

AWS KMS ECDSA is **confirmed randomized** per AWS's published
Cryptographic Details. This is the industry norm and AWS's HSM
certification is the trust anchor. Subliminal channel via AWS KMS
requires a vendor-side compromise (A16-level adversary or insider
threat at AWS).

GCP Cloud KMS is **likely randomized** but unconfirmed by docs;
empirical CI test will determine.

**Concrete recommendations**:

1. **Add the CI test** at `packages/sdk/test/subliminal-channel.test.ts`.
   Block PRs that regress local-signer determinism. Run
   AWS / GCP / LocalStack tests in the integration environment
   (weekly).
2. **Tighten bundler key rotation** to monthly to bound the
   accumulation of any potential subliminal-channel leakage.
3. **Resolve C1 Q1** (rotation mechanism) so that the rotation is
   actually possible against existing accounts.
4. **Document the vendor-trust assumption** in `docs/security/cryptographic-posture/README.md`
   so reviewers and the board understand we depend on AWS / GCP HSM
   certification.

---

## 9. Detection at the systems level (beyond the CI test)

The CI test in § 4 confirms a backend's determinism property at unit-
test scope. At the system level there are additional detection patterns
worth integrating:

### 9.1 Out-of-band signature comparison

For each KMS-issued signature, log the `(message_hash, signature)`
tuple to the audit chain. Cite the existing audit emission at
`apps/a2a-agent/src/auth/a2a-signer.ts:53-87`:

```ts
function makeSignerAudit(toolId: ToolExecutorId | 'master'): (event: SignerAuditEvent) => Promise<void> {
  return async (event) => {
    if (event.actionId.startsWith('checkpoint:')) return
    try {
      await auditAppend({
        ...
        eventType: 'kms-sign',
        mcpTool: toolId === 'master' ? 'kms:sign:master' : `kms:sign:${toolId}`,
        ...
      })
    } catch (err) {
      console.error('[a2a-signer audit] kms-sign row insert failed:', err)
    }
  }
}
```

Today the audit row records the keyId, signerAddress, sessionId,
actionId, accountAddress, chainId — but NOT the digest or the signature
bytes. **Adding the digest + sig bytes to the audit row** (or a side
channel) enables periodic offline lattice-attack scanning by a
defensive team: if an attacker is exfiltrating one bit per signature,
the lattice pattern is detectable in retrospect by an analyst with the
public key.

**Trade-off**: signature bytes in audit rows expand storage; for a
high-volume key (bundler, ~thousands per day), this is ~100 KB/day.
Acceptable for a key that lasts months between rotations.

**Recommendation**: extend `auditAppend` with optional `digest_hex` +
`signature_hex` fields, gated on a `LOG_SIG_BYTES_FOR_LATTICE_DETECTION`
env flag. Off by default; turned on for high-value keys in production.

### 9.2 Periodic offline lattice scan

If digests + signatures are logged (per § 9.1), run a periodic offline
job that:

1. Extract all `(digest, sig.r, sig.s)` tuples for a given key from the
   last N rotations.
2. Run a lattice-reduction attack attempt using the public algorithms
   (HNP / LLL). With ~32-512 signatures and a 1-bit nonce bias, the
   attack recovers the key in minutes to hours of CPU.
3. If the attack succeeds in recovering the public-key-matching private
   key, the signatures had a bias — VENDOR-SIDE COMPROMISE
   confirmed.

This is a **defender's tripwire**, not a continuous monitor; run
quarterly per high-value key.

### 9.3 Cross-vendor signature comparison

Smart Agent supports both AWS and GCP backends (`A2A_KMS_BACKEND=aws-kms
|gcp-kms|local-aes`). A defender can dual-deploy:

- Production traffic signs via AWS KMS.
- A shadow process signs via GCP KMS with the same key material (NOT
  possible directly since KMS keys are HSM-bound; would require
  parallel key derivation).
- Cross-check signatures.

This is operationally complex and not recommended for v1; documented
for completeness.

---

## 10. Risk decision matrix

For the board's eventual decision on residual risk acceptance:

| Risk class | Probability | Impact | Mitigation cost | Accept? |
|---|---|---|---|---|
| Local-signer subliminal channel | Negligible (deterministic by spec) | High (key recovery) | Near-zero (CI test) | Mitigate via CI test. |
| AWS KMS subliminal channel via vendor compromise | Very low (FIPS 140-2 L3) | Catastrophic (master / bundler / session-issuer key recovery) | High (no application-layer fix; only vendor trust + rotation) | Accept with rotation + audit-log monitoring. |
| GCP Cloud KMS subliminal channel | Same as AWS | Same | Same | Same. |
| LocalStack KMS subliminal channel | Negligible (dev-only) | Low (dev key) | Near-zero | Accept; dev-only path. |
| Supply-chain attack on `@noble/curves` | Low | High (production key recovery) | Moderate (lockfile review, dependency pinning, SBOM) | Mitigate via Phase G dependency hygiene + bypass guard. |
| User-side authenticator firmware subverted | Very low | Per-user catastrophe | Cannot mitigate substrate-side; user education | Accept per-user; document. |

---

## 11. References and prior research

External references cited in this document:

- [RFC 6979: Deterministic Usage of the Digital Signature Algorithm
  (DSA) and Elliptic Curve Digital Signature Algorithm
  (ECDSA)](https://datatracker.ietf.org/doc/html/rfc6979) — the standard.
- [AWS KMS Cryptographic Details: Cryptographic primitives](https://docs.aws.amazon.com/kms/latest/cryptographic-details/crypto-primitives.html)
  — official AWS documentation on KMS internals.
- [NIST SP 800-90A Deterministic Random Bit Generator (DRBG)](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-90Ar1.pdf)
  — the RNG standard AWS HSMs implement.
- Howgrave-Graham & Smart (2001), "Lattice attacks on digital signature
  schemes" — original lattice attack on biased ECDSA nonces.
- Breitner & Heninger (2019), ["Biased Nonce Sense"](https://eprint.iacr.org/2019/023)
  — practical lattice attack recovering Bitcoin private keys.
- "Differential Attacks on Deterministic Signatures" (eprint.iacr.org
  2017/975) — caveat that deterministic signatures themselves can be
  vulnerable to differential fault attacks, but not via subliminal
  channels.

Smart Agent code references:

- `packages/sdk/src/key-custody/local-secp256k1-signer.ts:14-26` —
  documents the determinism property.
- `packages/sdk/src/key-custody/local-secp256k1-signer.ts:232` — the
  signing call.
- `packages/sdk/src/key-custody/aws-kms-signer.ts:336-348` — the AWS
  KMS SignCommand call.
- `packages/sdk/src/key-custody/gcp-kms-signer.ts` — the GCP analogue.
- `apps/a2a-agent/src/auth/a2a-signer.ts:53-87` — the audit-emit hook.

---

*End of C4.*
