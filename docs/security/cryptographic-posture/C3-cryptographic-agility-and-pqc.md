# C3 — Cryptographic Agility & Post-Quantum Migration

> Audience: external security reviewers + board sub-committee
> evaluating the multi-year viability of Smart Agent's substrate. This
> document inventories every cryptographic primitive in use, classifies
> quantum vulnerability, and lays out a migration plan per primitive.
> The plan is realistic about the dependencies we don't own
> (Ethereum L1 cryptography, WebAuthn ecosystem, AnonCreds research
> frontier, KMS vendor PQC roadmaps).

---

## 1. Current cryptographic inventory

Every place in the substrate where a cryptographic primitive is
invoked. The "where used" column cites a representative file:line; in
practice each primitive has many call sites.

| # | Primitive | Algorithm | Where used | Library | Quantum-vulnerable? |
|---|---|---|---|---|---|
| 1 | Signature (userOp, owner) | ECDSA secp256k1 | `packages/contracts/src/AgentAccount.sol:764-773` (`_verifyEcdsa`), every `validateUserOp` path | OZ ECDSA + Yul native | **YES** (Shor's algorithm) |
| 2 | Signature (delegation EIP-712) | ECDSA secp256k1 | `packages/contracts/src/DelegationManager.sol:225-240` | OZ ECDSA | **YES** |
| 3 | Signature (bundler envelope) | ECDSA secp256k1 | `packages/contracts/src/AgentAccount.sol:779-789` (`_verifySignerEcdsa`) | OZ ECDSA | **YES** |
| 4 | Signature (KMS master signer) | ECDSA secp256k1 | `packages/sdk/src/key-custody/aws-kms-signer.ts:326-407`; `gcp-kms-signer.ts` (analogue) | AWS KMS / GCP KMS asymmetric ECC | **YES** |
| 5 | Signature (local-dev master signer) | ECDSA secp256k1 | `packages/sdk/src/key-custody/local-secp256k1-signer.ts:217-265` (`secp256k1.sign(..., {lowS: true})`) | `@noble/curves@1.9.1` (RFC 6979 by default) | **YES** |
| 6 | Signature (passkey WebAuthn) | ECDSA P-256 (secp256r1) | `packages/contracts/src/AgentAccount.sol:791-797`; uses `WebAuthnLib`; on-chain verification via `DaimoP256Verifier.sol` (cite directory listing) | DaimoP256 Yul + WebAuthn browser API | **YES** |
| 7 | Signature (SIWE) | ECDSA secp256k1 (whatever the user's wallet signs) | Indirect: SIWE message signed by user's wallet; verified server-side via ECDSA recovery | viem / wagmi clients | **YES** |
| 8 | Hashing | Keccak-256 | Every EIP-712 (`DelegationManager.sol:121`), every owner-set lookup digest, every canonical `sa:sign:v1` digest (`local-secp256k1-signer.ts:122-152`) | `@noble/hashes@1.8.0` `keccak_256`; Solidity `keccak256` opcode | NO (Grover gives quadratic speedup; effective ~128-bit security still strong) |
| 9 | Hashing | SHA-256 | Inter-service canonical body hash (`apps/a2a-agent/src/auth/inter-service.ts:84-86`); KMS digest type byte (`aws-kms-signer.ts:341-346` `SigningAlgorithm: 'ECDSA_SHA_256'`) | Node `crypto.createHash('sha256')`; AWS / GCP KMS internal | NO (Grover halves; effective 128-bit) |
| 10 | Hashing | SHA-384 | AWS KMS internal service entity comms (per AWS Cryptographic Details whitepaper, August 2024 version) | AWS KMS HSM internal | NO |
| 11 | Symmetric encryption | AES-256-GCM | Session-package envelope encryption (`apps/a2a-agent/src/auth/encryption.ts:30-36`); `@smart-agent/sdk` `encryptPayload` / `decryptPayload` | `@noble/ciphers@1.3.0` + AWS / GCP KMS GenerateDataKey | NO (Grover halves; effective 128-bit, still acceptable) |
| 12 | MAC | HMAC-SHA-256 | Inter-service auth dev path (`packages/sdk/src/key-custody/local-hmac.ts`); per-MCP MAC verify in `apps/a2a-agent/src/auth/inter-service.ts:216-219` | Node `crypto.createHmac` | NO (Grover halves) |
| 13 | MAC (prod) | KMS HMAC | `kms:GenerateMac` / `kms:VerifyMac` against `KeySpec=HMAC_256` (`packages/sdk/src/key-custody/aws-kms-mac.ts`; `gcp-kms-mac.ts`) | AWS / GCP KMS HMAC | NO |
| 14 | KDF (envelope key derivation) | HKDF-SHA-256 (via OZ patterns) and KMS internal CTR-DRBG-AES-256 (per AWS whitepaper) | Session envelope key derivation; canonical aadContext build (`apps/a2a-agent/src/auth/encryption.ts:80-100`) | `@noble/hashes` HKDF + KMS internal | NO |
| 15 | AnonCreds — credential signing | CL signatures over RSA-2048 (issuer key); BBS+ over BLS12-381 (W3C BBS+ profile, where used) | `apps/verifier-mcp` (issuer); `apps/person-mcp` Askar wallet (holder) | Hyperledger Indy / Anoncreds-RS via Askar | **YES (catastrophically)** |
| 16 | AnonCreds — link secret | Random 256-bit scalar; used in zero-knowledge proofs | Askar wallet in person-mcp | NA (the secret itself is symmetric-secure, but the ZK proof system around it relies on quantum-vulnerable primitives) |
| 17 | AnonCreds — nullifier | keccak256 hash commitment (`packages/sdk/src/anoncreds/nullifier.ts:4`) | nullifier emit + verify | `@noble/hashes` keccak | NO (the hash is fine; the broader ZK protocol is the issue) |
| 18 | TLS | ECDHE + ECDSA P-256 / P-384 (RSA-2048 RSASSA-PKCS1 for some certs) | Every HTTP hop (browser → web, web → a2a, a2a → mcp, web → graphdb) | Node TLS / browser TLS | **YES** (ECDH and ECDSA in classical TLS are quantum-vulnerable) |
| 19 | OIDC | RS256 (RSA-2048 + SHA-256) for Vercel OIDC; ES256 (ECDSA P-256 + SHA-256) for GCP WIF | `packages/sdk/src/key-custody/gcp-auth.ts`; AWS STS federation | google-auth-library, @vercel/oidc | **YES** |
| 20 | KMS keys themselves | AWS KMS: HSM-managed AES-256 wrapping (envelope), HSM-internal CTR-DRBG-AES-256 (randomness). GCP Cloud HSM: similar. | All KMS calls | AWS / GCP HSM | Vendor-dependent; see § 8 |
| 21 | UUID / nonce generation | `crypto.randomBytes(N)` | Inter-service nonce (`apps/a2a-agent/src/auth/replay-nonce.ts`); session salts; AnonCreds nullifiers | Node `node:crypto` | NO (symmetric; Grover halves) |

### 1.1 Where each primitive's failure breaks the system

Reviewer's exercise: for each of #1-21, what's the worst-case outcome
if the primitive is broken tomorrow?

- #1, #2, #3 broken (secp256k1 signatures forgeable) → any owner-set
  member's authority can be forged by anyone. Every userOp can be
  signed by an attacker. Every delegation can be forged. **End of
  authentication for the system.**
- #4, #5 broken → KMS signer's master / bundler / session-issuer
  signatures forgeable. But user-authority is on user-held secp256k1
  keys (also #1/#2/#3 vulnerable), so this isn't an INDEPENDENT failure
  — secp256k1 break is a single failure across all of #1-7.
- #6 broken (P-256 forgeable) → passkey signatures forgeable. Same
  failure mode as #1 but for the WebAuthn-credentialed users.
- #8, #9, #10, #14 broken (collision / preimage) → EIP-712 binding
  fails (two messages could share a digest); HMAC fails. SHA-256 /
  Keccak-256 second-preimage breaks would require a fundamental
  cryptographic discovery. Grover gives only a quadratic speedup, so
  with 256-bit hashes we still have ~128-bit quantum security.
- #11 broken → encrypted session packages decryptable in flight. PII
  exfiltration. But AES-256 against Grover still gives ~128-bit
  effective security, which is acceptable for the foreseeable future.
- #12, #13 broken → inter-service MAC forgeable. Equivalent of A3
  + bundler-key compromise — see C1 § C-chain-1.
- #15, #16, #17 broken → AnonCreds privacy guarantees fail.
  Credentials are linkable across uses, holder's pseudonymity is broken,
  any historical proof can be linked to a holder. **End of
  unlinkability**; the credentials still authenticate, just less
  privately.
- #18 broken (TLS) → confidentiality of every wire payload. PII
  exposure. Cookie session exfiltration (A15 mechanic). Authority
  forgery NOT enabled because authority is gated by MACs and signatures
  that are independently bound.

### 1.2 The HNDL question

**Harvest-Now-Decrypt-Later (HNDL)**: an adversary records ciphertext
today and decrypts when a Cryptographically Relevant Quantum Computer
(CRQC) is available. Smart Agent's data with long-term confidentiality
requirements:

- **PII in person-mcp** (names, relationships, contact info). Likely
  10-20 year confidentiality requirement (regulatory + ethical).
- **AnonCreds link secrets** in person-mcp Askar wallet. If exposed
  later, every credential ever issued to that holder is linkable.
  Long-term.
- **AnonCreds historical proofs** in verifier-mcp's proof archive (if
  retained). Same.
- **Encrypted session packages**: short-lived (≤ 1 hour for Variant A,
  ≤ session-validUntil for Variant B). HNDL risk is bounded by the
  fact that the packages are only useful within their validUntil
  window — even if decrypted later, the delegations they carry will
  have expired. The session-key private key is still usable IF the
  attacker can forge a delegation signature, but that requires the
  separate secp256k1 break (#1-7).

**Conclusion**: HNDL is a real risk for PII and AnonCreds link
secrets. Mitigation requires re-encrypting historical data under a PQC
scheme BEFORE CRQC arrival. This is a Phase-H+1 follow-on item.

---

## 2. Quantum threat timeline

### 2.1 NIST PQC standardisation status

Finalised standards (US National Institute of Standards and Technology):

- **FIPS 203 — ML-KEM (Module-Lattice Key-Encapsulation Mechanism)**.
  Derived from CRYSTALS-Kyber. Finalised 2024-08-13, effective
  2024-08-14. (Source: Federal Register notice 2024-17956.)
- **FIPS 204 — ML-DSA (Module-Lattice Digital Signature Algorithm)**.
  Derived from CRYSTALS-Dilithium. Finalised 2024-08-13. Three
  parameter sets: ML-DSA-44, ML-DSA-65, ML-DSA-87.
- **FIPS 205 — SLH-DSA (Stateless Hash-Based Digital Signature
  Algorithm)**. Derived from SPHINCS+. Hash-based; quantum-resistant
  by virtue of relying on hash function preimage / collision
  resistance (which Grover only halves). Finalised 2024-08-13.

Cite: [NIST press release, 2024-08-13](https://www.nist.gov/news-events/news/2024/08/nist-releases-first-3-finalized-post-quantum-encryption-standards).
Cite: [Federal Register issuance](https://www.federalregister.gov/documents/2024/08/14/2024-17956).

NIST IR 8547 (initial public draft, 2024-11) lays out the **transition
timeline**: NIST encourages migration to begin "as soon as possible".
NSA's CNSA 2.0 (Commercial National Security Algorithm Suite 2.0)
mandates PQC for national-security systems by 2030-2033 depending on
system class.

### 2.2 CRQC projections

A "Cryptographically Relevant Quantum Computer" — capable of running
Shor's algorithm at a scale that breaks ECDSA-256 / RSA-2048 — is not
expected in the immediate future, but published estimates vary widely:

- **Mosca's inequality**: if `(time to migrate + time data needs
  protection)` ≥ `time to CRQC`, the data is already at risk via HNDL.
  Smart Agent's PII has 10-20 year protection requirements; CRQC
  arrival of 2035-2040 puts us **already in the at-risk window**.
- **Expert survey (Mosca et al., 2024)**: 1-in-3 probability of CRQC
  within 15 years (i.e., by 2040); 1-in-2 by 2030 for some experts.
- **NSA CNSA 2.0**: federal systems must complete migration by 2033
  for the most sensitive categories. This is policy-stated, not a
  technical-CRQC-prediction, but signals "the US government expects
  CRQC within the planning horizon".
- **IBM, Google quantum roadmaps**: physical qubit counts are growing
  but error-correction overhead means *logical* qubits at the scale
  needed for RSA-2048 break (~1 million logical qubits per recent
  estimates) is still 10-20 years out.

**Smart Agent's planning assumption**: migrate to PQC-hybrid signing
by 2030 for all primitives that we own (#1-3, #4-7, #11-14). For
primitives we don't own (#18 TLS, #19 OIDC, #15-17 AnonCreds), track
the upstream ecosystem and migrate when standards land.

### 2.3 What the substrate-independence rule (P1) means for this timeline

`docs/architecture/principles.md` § P1 says we build our own contracts,
own SDK, own wallet substrate. This is **good for PQC migration**: we
control the upgrade cadence for our own primitives. We don't need to
wait for MetaMask DT or Safe to ship PQC support.

The downside: we own the migration cost ourselves. There's no vendor
PQC-upgrade button to press.

---

## 3. Migration plan per primitive

### 3.1 ECDSA secp256k1 (userOp signing, #1)

**Status**: ECDSA secp256k1 verification is hard-coded into the
Ethereum protocol (the `ecrecover` precompile is at address `0x01`).
The protocol does not provide a PQC verify precompile today.

**Migration paths**:

**a. Wait for Ethereum L1 PQC precompile**. The Ethereum research
community is tracking PQC; informal discussions at devcon /
ethresearch.ch surface ML-DSA verify as a candidate future precompile.
No EIP is in motion as of May 2026 (search check during this doc's
preparation; reviewer should verify). **This is the long path** and
isn't reliable to plan against.

**b. Account-abstraction custom validator with PQC verify**. The
ERC-4337 `validateUserOp` path runs arbitrary contract code. We can
extend `AgentAccount._validateSig` (`AgentAccount.sol:741-762`) with a
new signature-type byte (e.g., `0x02 = ML-DSA`) that decodes an
ML-DSA signature and verifies it via either:
- An on-chain ML-DSA verifier contract (~tens of thousands of gas; see § 6).
- An off-chain attestation that the signature is valid, with an
  on-chain check of the attester's signature (a quantum-resistant
  bootstrapping problem — circular).

The on-chain ML-DSA verifier is the practical path.

**c. Hybrid signature**: every userOp carries BOTH a secp256k1 sig AND
an ML-DSA sig. Both must verify. During the transition, the system
accepts hybrid sigs OR secp256k1-only sigs (config-flagged); after
CRQC arrival the secp256k1 path is disabled.

Cite for the signature-type-byte routing already present:
`AgentAccount.sol:736-762` shows the dispatch on `sigType` (currently
`0x00 = ECDSA`, `0x01 = WebAuthn`). Adding `0x02 = ML-DSA` is the
natural extension.

**Recommended approach**: **(c) hybrid**, with the migration sequence
in § 4.

### 3.2 ECDSA secp256k1 (delegation EIP-712, #2)

`DelegationManager._validateSignature` (`DelegationManager.sol:225-240`)
recovers ECDSA from the digest. To add PQC:

1. Extend the `Delegation` struct's `signature` field to be a wrapped
   form: `bytes = sigType(1) || sigBody(N)` where `sigType = 0x00` is
   ECDSA and `sigType = 0x02` is ML-DSA. Backward compat: a bare
   65-byte `signature` is treated as ECDSA (current behaviour).
2. ERC-1271 path (`DelegationManager.sol:231-235`) already delegates
   to `AgentAccount.isValidSignature`, which would route on the
   signature-type byte as in § 3.1.

**Storage layout**: the `Delegation` struct's `signature` field is
already `bytes`, so no layout change is needed.

**Test plan**: extend `packages/contracts/test/Delegation*.t.sol` to
include ML-DSA-signed delegations once a verifier contract exists.

### 3.3 ECDSA secp256k1 (bundler envelope, #3)

`AgentAccount.executeFromBundler` calls `_verifySignerEcdsa`
(`AgentAccount.sol:779-789`). The bundler key lives in KMS; the choice
of signature algorithm is determined by the KMS key spec
(`ECC_SECG_P256K1` today).

To migrate:

1. KMS introduces an asymmetric ML-DSA key type. **AWS announced
   ML-DSA support in the August 2024 Cryptographic Details whitepaper
   revision** — they list `ML_DSA_44`, `ML_DSA_65`, `ML_DSA_87` key
   sizes. (Cite: AWS KMS Cryptographic Details, "Asymmetric key
   operations" section.) GCP's PQC roadmap is less explicit publicly
   but likely tracking NIST FIPS 204.
2. Smart Agent's `aws-kms-signer.ts` adds a parallel
   `createAwsKmsMlDsaSigner(...)` that calls `kms:Sign` with
   `SigningAlgorithm: 'ML_DSA_*'`.
3. `AgentAccount.executeFromBundler` is extended with a signature-type
   byte for the bundler envelope.

**Cite the existing AWS shape**: `aws-kms-signer.ts:336-348`:

```ts
const out = await client.send(
  new SignCommand({
    KeyId: env.AWS_KMS_SIGNER_KEY_ID,
    Message: msgHash,
    MessageType: 'DIGEST',
    SigningAlgorithm: 'ECDSA_SHA_256',
  }),
)
```

The `SigningAlgorithm` parameter is the migration knob. AWS supports
both ECDSA and ML-DSA via the same `SignCommand` API.

### 3.4 ECDSA secp256k1 (KMS master signer, #4) and local-dev signer (#5)

Same as § 3.3 — KMS-side support is the bottleneck. AWS already
supports ML-DSA (per § 3.3); migration is a code change.

For the local-dev signer (`local-secp256k1-signer.ts`), `@noble/curves`
has post-quantum primitives in `@noble/curves/post-quantum.js`
(`noble-curves` 1.9+; verify in `node_modules/@noble/curves/`). The
local-dev path can mirror the KMS path with a Noble ML-DSA
implementation.

### 3.5 ECDSA P-256 (WebAuthn, #6)

The WebAuthn ecosystem is **the slowest of the user-credential paths**
to migrate because it depends on:

- **Authenticator firmware** (Apple Secure Enclave, Android Keystore,
  YubiKey, etc.) supporting a PQC algorithm.
- **The FIDO Alliance** standardising a PQC WebAuthn flow.
- **Browsers** implementing the new flow.

Status as of May 2026 (verify via FIDO Alliance announcements):

- FIDO Alliance has an active "PQC WebAuthn" working group; no
  finalised spec yet.
- A hybrid registration path (P-256 + PQC) is the likely first
  deployment.
- Authenticator firmware updates lag spec finalisation by 1-3 years.

**Smart Agent's migration**:

1. The `_verifyWebAuthn` path (`AgentAccount.sol:791-797`,
   `WebAuthnLib.verify`) decodes a `WebAuthnLib.Assertion` containing
   the P-256 signature. To support PQC, add a new assertion type that
   carries an ML-DSA signature + the SHA-384 / SHA-512 hash of
   `clientDataJSON || authenticatorData` (the WebAuthn assertion
   binding).
2. Add an ML-DSA on-chain verifier (separate contract; similar to
   `DaimoP256Verifier` shape).
3. Per-passkey storage in `PasskeyEntry` (`AgentAccount.sol:847-850`)
   currently stores `(x, y)` for P-256. Extend to store a `pubkeyType`
   discriminator + algorithm-appropriate public-key bytes (ML-DSA
   public keys are ~2.5 KB).

This is a multi-month migration once FIDO finalises.

**Recommendation**: track FIDO Alliance status quarterly; reserve
contract storage layout for PQC passkey support in the v3 AgentAccount
implementation.

### 3.6 ECDSA secp256k1 (SIWE, #7)

SIWE migrates with the user's wallet. If the user's MetaMask /
Rabby / Frame wallet upgrades to PQC, the SIWE message signature is
PQC-signed. Verification is the recipient's responsibility; since SIWE
is verified server-side, we can extend our verifier to handle PQC sigs
when wallets support them.

**No immediate Smart Agent action**; track wallet ecosystem.

### 3.7 AES-256-GCM (#11)

Grover's algorithm reduces effective AES security by half: AES-256
becomes ~128-bit quantum-secure. **128-bit symmetric security is still
considered adequate** for the foreseeable future per NIST guidance.

**No migration needed.** Optionally, AES-256 can be doubled to
AES-512-GCM via two-key cascade, but this is overkill given the
combined HNDL risk for our short-lived session packages.

### 3.8 HMAC-SHA-256 (#12), KMS HMAC (#13)

Same as #11 — Grover halves to ~128-bit. Adequate.

### 3.9 Keccak-256, SHA-256, SHA-384 (#8-10)

Hash primitives. Grover reduces preimage / collision resistance
quadratically. SHA-256 keeps ~128-bit security; Keccak-256 same. **No
migration needed.**

For very-long-term confidentiality (>20 years), consider upgrading to
SHA-512 / SHA3-512 for new domain separators. Not urgent.

### 3.10 AnonCreds (#15-17) — most affected, most uncertain

**Hyperledger AnonCreds** uses:

- **CL signatures** (Camenisch-Lysyanskaya) over RSA-2048 / RSA-3072
  — the issuer's key. Quantum-vulnerable.
- **Pedersen commitments** over secp256k1 — for blinded attribute
  values. Quantum-vulnerable.
- **BLS12-381 pairing** — in the BBS+ variant for selective disclosure.
  Quantum-vulnerable.

**Post-quantum anonymous credentials** are an active research area, not
a standardised technology:

- **Lattice-based credentials** (e.g., Crypto-Dilithium-style anonymous
  credentials) — research-stage. Several papers; no production-ready
  library.
- **Hash-based credentials** (Picnic-based, SPHINCS+-extended) —
  research-stage. Signature sizes are large (tens of KB), prover
  computation is heavy.
- **Falcon-based credentials** — research-stage.

**No NIST-finalised standard exists for PQC anonymous credentials.**
This is the most uncertain migration path in the whole inventory.

**Smart Agent's position**:

1. **Track the W3C VC Data Model 2.0 + IETF JOSE-COSE-PQ work** — when
   a PQC anonymous credential standard emerges, we adopt it.
2. **Holder-wallet portability** (per spec 007 Phase H deliverable on
   AnonCreds custodial policy) eases credential reissuance — if we
   need to reissue every credential under a new scheme, holders can
   take their existing custodial state and migrate.
3. **Pseudonymity is the most likely casualty**. The credentials still
   authenticate but become linkable to a holder once CRQC arrives.
   This is a privacy regression, not an authentication failure.

**Time horizon**: 5-10 years before a viable PQC anonymous credential
substrate exists. Plan accordingly.

### 3.11 TLS (#18), OIDC (#19)

Ecosystem-provided:

- **TLS PQC**: NIST has working groups for hybrid TLS (X25519 +
  ML-KEM). Chrome, Firefox, Cloudflare have rolled out experimental
  hybrid key exchange. By the time we need it, TLS will be PQC-hybrid
  by default in major browsers.
- **OIDC**: depends on the IdP. Vercel OIDC and Google OIDC will
  follow industry standards.

**No immediate Smart Agent action.**

### 3.12 KMS keys themselves (#20)

Both AWS KMS and GCP Cloud KMS announce PQC support timelines. AWS
has shipped ML-DSA key types (per § 3.3); GCP's roadmap is less
explicit. Migration is a code change at our end + a key-rotation
operation at the operator's end.

---

## 4. Hybrid signing scheme

### 4.1 Why hybrid

A pure-PQC migration risks **cryptographic apocalypse** if a flaw is
discovered in the chosen PQC algorithm post-deployment. Hybrid
signatures (sign with BOTH algorithms; verifier requires both) provide
defence-in-depth: an attacker must break BOTH algorithms to forge.

NIST's FIPS 204 publication notes that hybrid is an acceptable
deployment pattern during transition.

### 4.2 Concrete proposal for AgentAccount

Extend the signature-type byte routing in `_validateSig`
(`AgentAccount.sol:741-762`):

```solidity
uint8 internal constant SIG_TYPE_ECDSA      = 0x00;
uint8 internal constant SIG_TYPE_WEBAUTHN   = 0x01;
uint8 internal constant SIG_TYPE_ML_DSA     = 0x02;  // NEW
uint8 internal constant SIG_TYPE_HYBRID     = 0x03;  // NEW — ECDSA + ML-DSA
```

For `SIG_TYPE_HYBRID`, the signature payload is:

```
0x03 || ecdsaSigLen(uint16) || ecdsaSig || mlDsaSigLen(uint32) || mlDsaSig
```

Verify both; require both pass. `_verifyEcdsa` and `_verifyMlDsa`
(new) both check the signer is in `_owners` against algorithm-
appropriate public keys.

**Storage**: `_owners` mapping currently holds `address` keys (the
20-byte keccak256 of the secp256k1 pubkey). For ML-DSA, the "address"
analogue is the hash of the ML-DSA public key. Two approaches:

- **Separate mapping**: `mapping(bytes32 => bool) private _mlDsaOwners`
  (keys = keccak256 of ML-DSA pubkey).
- **Polymorphic key**: extend `_owners` to take `bytes32` keys with a
  type-tag prefix.

The separate mapping is simpler and avoids storage layout migration
risk. Recommended.

### 4.3 Migration sequence

**Phase 1 (now — May 2026)**: HYBRID CAPABLE but not active.

- Land the contract changes for SIG_TYPE_HYBRID + ML-DSA verifier in
  v3 AgentAccount implementation.
- KMS keys remain ECDSA secp256k1 only. No ML-DSA keys provisioned.
- The hybrid sig type is accepted by the contract but not exercised by
  any signing path. Test fixtures verify the parser + verifier code
  works.

**Phase 2 (2028-2030 — when NIST mandates PQC for non-NSS or earlier
upon CRQC signal)**: MANDATORY DUAL-SIGN.

- All KMS keys gain an ML-DSA sibling. Master / bundler / sessionIssuer
  each have an ECDSA key + an ML-DSA key.
- Web client signing flows produce hybrid signatures (ECDSA + ML-DSA).
- Variant A delegations carry hybrid signatures.
- Variant B on-chain delegations carry hybrid signatures.
- Existing ECDSA-only delegations remain redeemable until validUntil
  expires; no forced re-sign.

**Phase 3 (post-CRQC, when ECDSA is broken in the wild)**: PURE ML-DSA.

- Disable SIG_TYPE_ECDSA acceptance via a contract upgrade
  (`upgradeToWithAuthorization`).
- Cut over to pure ML-DSA.
- Historical ECDSA delegations become unredeemable. (Practically all
  expired by then.)

### 4.4 Test plan

```solidity
// packages/contracts/test/HybridSig.t.sol (future)
function test_HybridSigAcceptedWhenBothValid() { ... }
function test_HybridSigRejectedWhenEcdsaInvalid() { ... }
function test_HybridSigRejectedWhenMlDsaInvalid() { ... }
function test_PureEcdsaStillAcceptedDuringTransition() { ... }
function test_PureMlDsaAcceptedPostTransition() { ... }
function test_StorageLayoutBackwardCompatible() {
  // Deploy v2 with ECDSA owners, upgrade to v3, owners still authorised.
}
```

---

## 5. Smart account upgrade path

`AgentAccount` is UUPS proxy — implementation swappable via
`upgradeToWithAuthorization` (post-Phase-A; `AgentAccount.sol:216-232`).

### 5.1 Storage layout compatibility

ERC-7201 namespaced storage slots already in use:
- Passkey storage: slot `0x3b3ffcf51a0a9bcb...` (`AgentAccount.sol:844-846`).
- Module storage: slot `0x1f14a6accceab237...` (`AgentAccount.sol:413-414`).

For PQC migration, add a new ERC-7201 slot for ML-DSA owner mapping:
```solidity
bytes32 private constant ML_DSA_STORAGE_SLOT =
    keccak256("smart-agent.agent-account.ml-dsa.v1") - 1;  // (anded with mask per ERC-7201)
```

This avoids any collision with existing storage. Existing
`_owners`, `_ownerCount`, `_delegationManager`, `_factory`,
`_acceptedSessionDelegations` slots (`AgentAccount.sol:52-73`) are
unchanged.

### 5.2 User-consented upgrade

Per `upgradeToWithAuthorization` (`AgentAccount.sol:216-232`), the
user owner must sign the upgrade digest. PQC migration is per-account
user-opt-in:

1. The PQC-capable implementation (`AgentAccountV3`) is deployed by the
   project team.
2. The web app prompts users to upgrade their account when they next
   sign in. Users sign the upgrade authorisation; the upgrade tx is
   submitted via paymaster.
3. Users who don't sign continue on V2 (ECDSA-only). They lose access
   when CRQC arrives, OR they remain in a smaller-population secp256k1
   pool that's vulnerable.

This is a **decentralised migration** — no global upgrade authority.
Acceptable for v1; possibly an issue for v2 mainnet deploy if users
are sluggish to upgrade.

### 5.3 Migration test plan

```solidity
// packages/contracts/test/PqcUpgrade.t.sol (future)
function test_DeployV2_UpgradeToV3_OwnersPreserved() { ... }
function test_AfterUpgrade_ExistingDelegationsStillRedeemable() { ... }
function test_AfterUpgrade_NewHybridSigSupported() { ... }
function test_UpgradeDigestCannotBeReplayedAcrossAccounts() {
  // The UPGRADE digest binds address(this), so a captured upgrade
  // digest from Maria's account cannot upgrade Bob's account.
}
```

---

## 6. Ethereum L1 considerations

### 6.1 EIP-7212 / EIP-7951 status

**EIP-7212** ([Precompile for secp256r1 Curve Support](https://eips.ethereum.org/EIPS/eip-7212))
proposed in 2023. Originally not included in Pectra (May 2025). Cited
search result: "The secp256r1 precompile was not included in the Pectra
upgrade (May 2025). Instead, on December 3, 2025, Ethereum activated
Fusaka, its 17th major upgrade, on mainnet. EIP-7212 (secp256r1
precompile) expands signature curve support" — included in Fusaka.

The successor **EIP-7951** addresses critical security issues from
RIP-7212 while maintaining interface compatibility.

**Smart Agent implication**: passkey (P-256) verification today
requires `DaimoP256Verifier.sol` (Yul-based; ~330k gas per verify).
Post-Fusaka, the precompile at `0x0100` (RIP-7212) provides P-256
verify at ~3.5k gas. **Significant gas reduction for every passkey
userOp**.

Action: Phase B+ should swap `DaimoP256Verifier` calls for the
precompile when deploying to a Fusaka-enabled chain. Backwards-compat:
keep DaimoP256Verifier as a fallback for chains that don't have the
precompile.

### 6.2 PQC verify precompile (hypothetical)

No EIP is currently in motion for an ML-DSA verify precompile. Without
a precompile, on-chain ML-DSA verification costs estimated:

- **ML-DSA-44**: signature 2420 bytes, pubkey 1312 bytes. Verify
  involves a few thousand polynomial multiplications. Naive Solidity
  implementation: ~150-300k gas (estimate; benchmark needed).
- **ML-DSA-65**: signature 3293 bytes, pubkey 1952 bytes. Verify ~300-500k
  gas.
- **SLH-DSA-SHA2-128s**: signature 7856 bytes. Verify is hash-only,
  could be cheaper (~50-150k gas).

**Until a precompile lands**, on-chain PQC verification is expensive
but feasible. Off-chain attestation patterns (verify off-chain, prove
on-chain via attester signature) are CIRCULAR — the attester needs a
quantum-resistant signature too.

### 6.3 Account abstraction custom validators

Per ERC-4337, `validateUserOp` runs arbitrary contract code. Smart
Agent can deploy PQC verifiers ahead of L1 standardisation — this is
exactly the substrate-independence advantage (P1). We don't wait for
Ethereum core to ship PQC; we ship it ourselves in our own validators.

The trade-off: gas costs. Until a precompile lands, every PQC userOp
is expensive. Mitigation: Variant A's session-key indirection means
the session-key (ECDSA, cheap) handles the hot path; the user only
PQC-signs at session-init (cold path, infrequent). For the
1-PQC-sig-per-session model, gas cost is bearable.

---

## 7. Backward compatibility

### 7.1 Existing ECDSA delegations during transition

During the hybrid phase (Phase 2 above):

- A user's ECDSA-only owner credentials continue to work.
- New delegations are issued as hybrid.
- Existing pre-transition ECDSA delegations remain redeemable until
  `validUntil` expires.

There is no forced re-sign window. The migration is opportunistic:
users naturally re-issue delegations as their sessions roll over.

### 7.2 Hard / soft / forced deadlines

Recommend three milestones:

| Milestone | Date | Behaviour |
|---|---|---|
| **Hybrid available** | Phase 1 landing (target 2027) | v3 contract deployed; KMS PQC keys provisioned; web client offers hybrid signing. |
| **Hybrid default** | 2030 (post NIST IR 8547 final) | New sessions are always hybrid; ECDSA-only paths emit deprecation warnings. |
| **ECDSA disabled** | Triggered by CRQC signal OR 2035 (whichever is earlier) | Contract upgrade removes ECDSA-only signature acceptance. Existing ECDSA delegations are dead. |

The "CRQC signal" is operational: when major cryptographers publicly
demonstrate Shor's algorithm at a scale that threatens secp256k1
(thousands of logical qubits), the migration accelerates.

---

## 8. Open questions

| # | Question | Status / recommendation |
|---|---|---|
| C3-Q1 | AnonCreds PQC migration path. | No standard exists. Track research; prepare holder-wallet portability so credentials can be re-issued under a new scheme when one lands. |
| C3-Q2 | FIDO PQC WebAuthn timeline. | FIDO Alliance has an active WG; no public spec finalisation date. Reserve storage layout in v3 AgentAccount for PQC passkey support. |
| C3-Q3 | KMS vendor PQC support timeline (GCP). | AWS supports ML-DSA per their Aug 2024 whitepaper. GCP's roadmap is less explicit publicly. Confirm with GCP account rep before committing to GCP-only deploy. |
| C3-Q4 | On-chain ML-DSA verify gas cost benchmark. | Implement a reference verifier in Solidity; benchmark on anvil + sepolia. Estimate 150-500k gas per verify. |
| C3-Q5 | Hybrid signature wire format — endorsement of the `0x03 || ecdsaLen || ecdsaSig || mlDsaLen || mlDsaSig` shape. | Compare against IETF draft-ietf-lamps-pq-composite-sigs (composite signatures); align with the IETF format if possible. |
| C3-Q6 | Smart Agent's CRQC signal — what triggers Phase 3? | Operational decision. Recommend: a published academic / industry demonstration of Shor at >2000 logical qubits, OR a NIST / NSA mandate. |
| C3-Q7 | HNDL re-encryption of historical PII / link secrets. | Phase H+1 follow-on: re-encrypt person-mcp's historical data under a hybrid scheme (AES-256-GCM under a PQC-KEM-wrapped key) before CRQC arrival. |
| C3-Q8 | Public key sizes for ML-DSA (kilobytes) — storage cost on-chain. | Per-account storage of an ML-DSA pubkey ~1.3-2 KB. Storing in ERC-7201 namespaced storage is feasible but each owner-key write costs ~20k gas per slot. Acceptable for a one-time-per-account upgrade. |
| C3-Q9 | EIP-7212 / 7951 deployment on Smart Agent's target chain. | Fusaka (Dec 2025) added the secp256r1 precompile to mainnet. Verify deployment target supports it; if not, retain DaimoP256Verifier. |
| C3-Q10 | Hybrid signing in KMS — does AWS / GCP have a "sign with both algorithms atomically" API? | NO. The hybrid sig is composed client-side: separate `kms:Sign` calls to the ECDSA key and the ML-DSA key, then concatenated. This introduces a TOCTOU window where one sig is captured before the other is requested — mitigated by binding both sigs to the same digest. |

---

## 9. Summary for board

Smart Agent's cryptographic substrate is comprehensively
quantum-vulnerable at the asymmetric primitives (ECDSA secp256k1 +
P-256 + RSA + BLS) but comprehensively quantum-acceptable at the
symmetric primitives (AES-256-GCM, HMAC-SHA-256, Keccak-256).

The migration plan:

1. **Phase 1 (now-2027)**: deploy hybrid-capable v3 AgentAccount. KMS
   PQC keys provisioned alongside ECDSA. No mandatory PQC yet.
2. **Phase 2 (2028-2030)**: hybrid becomes the default. New sessions
   are dual-signed. Old ECDSA delegations decay naturally.
3. **Phase 3 (post-CRQC or 2035)**: pure ML-DSA. ECDSA disabled.

The substrate-independence rule (P1) is an advantage here: we own the
upgrade cadence and don't depend on third-party wallets / SDKs to ship
PQC.

The hardest part of the migration is AnonCreds — no NIST-finalised
PQC anonymous credential standard exists, so the privacy guarantee
(unlinkability) will likely regress before it can be re-restored. The
authentication guarantee survives via the holder's PQC key in their
wallet.

**Recommendations for the board**:

1. Fund the Phase 1 contract work in 2027.
2. Allocate engineering bandwidth for AnonCreds research-tracking.
3. Plan a privacy-impact communication for AnonCreds users in
   Phase 2-3.
4. Sponsor cross-organisation PQC-credential research collaboration
   (CASA / W3C Verifiable Credentials WG / IETF SPICE).

---

## 10. Detailed migration cost & risk analysis (per primitive)

Each migration has an engineering cost and a risk-of-regression. This
section gives the board a quantitative picture.

### 10.1 ECDSA → Hybrid (userOp signing)

| Item | Estimate | Risk |
|---|---|---|
| New ML-DSA verifier contract (Solidity) | 4-8 weeks (write + audit) | New contract — needs full security review. Verifier must be constant-time over secret-dependent branches (none in ML-DSA verify since no secret material is involved in verify) — easier than constant-time signer. |
| Extend `AgentAccount._validateSig` signature-type routing | 1 week | Small change to existing dispatcher; low risk. |
| KMS-side: provision ML-DSA keys | 1 day per cloud, gated on vendor support | AWS supports today (per § 3.3); GCP behind. |
| Client-side: produce hybrid signatures in apps/web | 1-2 weeks | Need WebAuthn-style "two simultaneous signing prompts" UX if the user is signing both ECDSA + ML-DSA themselves. For session-key signing (Variant A redemption hot path) the hybrid is server-side and invisible to user. |
| Foundry tests for hybrid | 1 week | Standard test surface. |
| Integration tests + dev-flow validation | 2 weeks | Need test fixtures with both key types per user. |
| **Total engineering** | **8-14 weeks** | Moderate |

### 10.2 ECDSA → Hybrid (delegation EIP-712)

| Item | Estimate | Risk |
|---|---|---|
| Extend `DelegationManager._validateSignature` to route on sig-type | 1 week | Small dispatcher change. |
| ERC-1271 path already handles routing via `AgentAccount.isValidSignature` | 0 | Reuses 10.1's work. |
| Tests | 1 week | Standard. |
| **Total engineering** | **2 weeks** | Low |

### 10.3 Passkey (P-256 / WebAuthn) → PQC

Dependent on FIDO Alliance spec finalisation. Smart Agent's
contribution is the verifier + storage layout work.

| Item | Estimate | Risk |
|---|---|---|
| FIDO PQC spec finalised | UNKNOWN — gating | External. |
| Authenticator support | 1-3 years post-spec | External. |
| New verifier contract for PQC WebAuthn payload | 4-8 weeks | Custom verifier code. |
| Storage layout for PQC public keys (~1.3-2.5 KB each) | 1-2 weeks | Storage cost analysis; per-account upgrade flow. |
| **Total engineering, after upstream lands** | **6-10 weeks** | Moderate |

### 10.4 AnonCreds → PQC anonymous credentials

NO finalised standard. Smart Agent's options:

- **Track and adopt**: 0 engineering today; ~6-12 months engineering
  when a standard lands.
- **Build proprietary**: not aligned with substrate-independence (P1)
  for an attestation primitive; rejected.
- **Drop unlinkability** (use a non-anonymous PQC credential like
  ML-DSA-signed VCs): privacy regression but trivial engineering. Could
  be a stopgap.

Recommendation: maintain the ability to issue both anonymous-credential
and direct-PQC-VC forms; users opt into the trade-off.

### 10.5 TLS / OIDC → PQC

External. Browsers + IdPs ship hybrid TLS / hybrid OIDC; Smart Agent
benefits passively. Engineering cost: 0 for adoption, possibly 1-2
weeks for verifying our deployed TLS stack accepts the new ciphers.

### 10.6 Total program cost

Realistic Phase 1 (hybrid-capable, 2026-2027) estimate:

- 8-14 weeks for ECDSA→Hybrid userOp + delegation work
- 2 weeks for storage-layout reserve in v3 implementation
- 4 weeks for ML-DSA verifier audit (external auditor)
- 2 weeks for CI / test surface
- **Total**: ~16-22 engineering-weeks (one engineer ~4-5 months;
  parallelisable to ~3 months with two engineers)

Realistic Phase 2 (hybrid default, 2028-2030):

- Re-deploy v3 → v3.1 with hybrid-default flag.
- Migrate all KMS keys to add ML-DSA siblings.
- User UX changes (extra signing step).
- **Total**: ~8-12 engineering-weeks plus user-facing rollout work.

Phase 3 (ECDSA disabled) is a flag flip + contract upgrade; ~2 weeks.

---

## 11. Hash function migration detail

Hash functions are LESS urgent than asymmetric primitives but deserve
their own analysis because some hash-based protocols (Merkle proofs,
commitments) are quantum-affected even though the hash itself isn't
broken.

### 11.1 Keccak-256 (Solidity native)

- Used in every EIP-712 digest.
- Used in `_revoked[dHash]` mapping keys
  (`DelegationManager.sol:50`).
- Used in CREATE2 address derivation
  (`AgentAccountFactory.sol:113-128`).
- Used in passkey credentialIdDigest.

**Quantum impact**: Grover halves preimage resistance from 256 to 128
bits. **128-bit security is still considered secure** per NIST.

**Migration**: not needed. SHA3-512 / Keccak-512 are options for
high-paranoia deployments; not recommended for general use.

### 11.2 SHA-256 (canonical-v2 MAC body hash)

- Used in `apps/a2a-agent/src/auth/inter-service.ts:84-86` (`sha256Hex`).
- Used in WebAuthn `clientDataJSON` hash (browser-side).

**Quantum impact**: Grover halves to 128-bit. Acceptable.

**Migration**: optional upgrade to SHA-384 / SHA3-512 for long-term
data integrity. The canonical-v2 protocol could absorb a hash
algorithm bump via a version byte.

### 11.3 Merkle proof commitments

The AnonCreds nullifier
(`packages/sdk/src/anoncreds/nullifier.ts:4`) is keccak256-based. The
commitment scheme itself is quantum-resistant (preimage-bound) but
the surrounding ZK protocol is the issue (§ 3.10).

---

## 12. Test surface for cryptographic agility

Phase G CI guards should include:

| Test | Purpose |
|---|---|
| `signature-type-byte-routing.test.ts` | Assert every signature-type byte dispatch in `AgentAccount._validateSig` is exercised by a fixture. New types (PQC) added later land with new fixtures. |
| `hash-function-version-roundtrip.test.ts` | Assert hashing across encode / decode round-trips is byte-stable across versions. Prevents accidental hash algorithm drift. |
| `delegation-eip712-domain-stable.test.ts` | Assert the EIP-712 DOMAIN_SEPARATOR is stable across deploys (regression: don't accidentally change `name` or `version` and invalidate every prior signature). |
| `kms-pqc-roadmap.test.ts` | A documentation-only test: lists the KMS keys + their algorithms; fails if an unexpected algorithm appears (force human review when KMS key inventory changes). |

---

## 13. Cross-references to vendor PQC roadmaps

This section is intentionally maintained "as of date" so the board can
see the current state at signoff time.

### 13.1 AWS KMS PQC roadmap (as of May 2026)

- **Asymmetric signing**: ML-DSA support shipped per Aug 2024
  Cryptographic Details whitepaper update. Key types `ML_DSA_44`,
  `ML_DSA_65`, `ML_DSA_87`. Cite: AWS docs.
- **Asymmetric encryption (PQC KEM)**: ML-KEM not yet available as a
  KMS key type at public docs review.
- **Symmetric keys**: no quantum-resistance issue.
- **HMAC keys**: no quantum-resistance issue.

### 13.2 GCP Cloud KMS PQC roadmap

- Less explicit public roadmap. Some PQC-related blog posts but no
  publicly-available "we support ML-DSA today" announcement at docs
  review time.
- **Operator action**: confirm with GCP account rep before committing
  to GCP-only deployment.

### 13.3 Cloudflare PQC roadmap (TLS)

- Hybrid X25519MLKEM768 shipped for TLS 1.3 in production traffic
  (per Cloudflare blog 2024+).
- Smart Agent benefits automatically when serving via Cloudflare /
  fronting infrastructure.

### 13.4 FIDO Alliance PQC WebAuthn

- Working group active; no finalised spec as of May 2026.
- Hybrid registration is the expected first deployment pattern.
- Authenticator firmware updates lag spec.

### 13.5 Apple Secure Enclave PQC

- Apple introduced PQ3 (post-quantum hybrid) for iMessage in early
  2024. Secure Enclave hardware capabilities for PQC user-credentials
  are not publicly documented.

### 13.6 Yubico PQC

- YubiKey 5 series: no PQC. YubiKey 5+ / future generations: PQC roadmap
  pending FIDO standardisation.

---

## 14. The "what if we're wrong about the timeline" sensitivity

A pessimistic CRQC arrival (say 2030 instead of 2035) compresses the
migration window. Sensitivity analysis:

| CRQC arrival | Smart Agent posture | Action |
|---|---|---|
| 2030 | Phase 1 complete by 2027, Phase 2 by 2029, Phase 3 forced in 2030. Tight but feasible. | Plan Phase 1 NOW. |
| 2035 (mid estimate) | Phase 1 by 2027, Phase 2 by 2030, Phase 3 in 2035 — comfortable margin. | Same plan. |
| 2040+ (optimistic) | Plenty of time. | Same plan; no rush. |

The plan is INSENSITIVE to CRQC arrival date as long as we start Phase
1 by 2027. **The board's decision is when to fund Phase 1, not which
year to target for CRQC.**

---

*End of C3.*
