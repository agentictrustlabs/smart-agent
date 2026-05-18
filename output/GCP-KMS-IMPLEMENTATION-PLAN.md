# GCP Cloud KMS — Sibling Backend Implementation Plan

Status: **PROPOSED** (2026-05-17)
Goal: Add `A2A_KMS_BACKEND=gcp-kms` as a sibling to `aws-kms`, with feature-parity across the four key classes (session-package envelope encryption, asymmetric master-EOA signer, tool-executor signers, inter-service MAC). Production environments choose one backend per deployment via env flip; the app code remains backend-agnostic.

This plan complements `output/KMS-IMPLEMENTATION-PLAN.md` (AWS-primary) and is grounded in the AWS implementation already shipped in `packages/sdk/src/key-custody/`.

---

## G0 — Architectural confirmation (no redesign)

The `A2AKeyProvider`, `KmsAccountBackend`, `ToolExecutorSignerBackend`, and `KmsMacProvider` interfaces are cloud-neutral. The four factory functions in `apps/a2a-agent/src/auth/key-provider.ts` already use a switch on `A2A_KMS_BACKEND`:

```
buildKeyProvider          — A2AKeyProvider
buildSignerBackend        — KmsAccountBackend (master EOA)
buildToolExecutorBackend  — ToolExecutorSignerBackend (per-tool keys)
buildMacProvider          — MacProvider (inter-service)
```

GCP slots in as a fourth `case 'gcp-kms':` arm of each switch. **No interface changes are required.**

### Trust pattern parity
```
AWS:  Vercel OIDC → AWS STS AssumeRoleWithWebIdentity → AWS SDK creds → AWS KMS
GCP:  Vercel OIDC → Google STS Workload Identity Federation
                  → service account impersonation
                  → google-auth-library ExternalAccountClient
                  → Google Cloud KMS
```
Both eliminate static cloud credentials at runtime.

### Implementation deltas (recap)
| Concern | AWS | GCP |
|---|---|---|
| Session DEK origin | `GenerateDataKey` returns plaintext + wrapped | App generates DEK locally; KMS wraps via `encrypt` |
| KMS AAD format | `EncryptionContext: {k:v}` map | `additionalAuthenticatedData: bytes` |
| AAD comparison | Map field-by-field | Canonical byte string |
| secp256k1 signing | `Sign` algorithm `ECDSA_SHA_256` over key `ECC_SECG_P256K1` | `asymmetricSign` algorithm `EC_SIGN_SECP256K1_SHA256` |
| Low-S normalization | Manual | KMS returns lower-S already; still verify |
| MAC | `GenerateMac` / `VerifyMac` | `macSign` / `macVerify` |
| Auth client | `@aws-sdk/client-sts` (web-identity) | `google-auth-library` `ExternalAccountClient` |

---

## G1 — Authentication primitive: `gcp-auth.ts`

**File**: `packages/sdk/src/key-custody/gcp-auth.ts`

Builds an authenticated `GoogleAuth`-shaped client from Vercel's OIDC token. Lazy, request-scoped (per Vercel docs, `getVercelOidcToken()` must not be called at module load inside Vercel Functions).

```ts
import { ExternalAccountClient } from 'google-auth-library'
import { getVercelOidcToken } from '@vercel/oidc'

export interface GcpAuthEnv {
  GCP_PROJECT_ID: string
  GCP_PROJECT_NUMBER: string
  GCP_WORKLOAD_IDENTITY_POOL_ID: string
  GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: string
  GCP_SERVICE_ACCOUNT_EMAIL: string
}

export function createGcpAuthClient(env: GcpAuthEnv) {
  return ExternalAccountClient.fromJSON({
    type: 'external_account',
    audience:
      `//iam.googleapis.com/projects/${env.GCP_PROJECT_NUMBER}` +
      `/locations/global/workloadIdentityPools/${env.GCP_WORKLOAD_IDENTITY_POOL_ID}` +
      `/providers/${env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID}`,
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    token_url: 'https://sts.googleapis.com/v1/token',
    service_account_impersonation_url:
      `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/` +
      `${env.GCP_SERVICE_ACCOUNT_EMAIL}:generateAccessToken`,
    subject_token_supplier: { getSubjectToken: getVercelOidcToken },
  })
}
```

**Constraints**
- No `GOOGLE_APPLICATION_CREDENTIALS` or service-account-key JSON support. Throw at startup if either env var is set (mirrors AWS K6-style hard-fail).
- Module **must not** call `getVercelOidcToken()` at import time. The returned client is constructed lazily per `buildGcpKms*` call.
- Re-use a single `ExternalAccountClient` across requests where possible (the underlying token-exchange caches; the wrapper does not).

---

## G2 — Session envelope: `gcp-kms-provider.ts`

**File**: `packages/sdk/src/key-custody/gcp-kms-provider.ts`

Implements `A2AKeyProvider`. Uses **local DEK + KMS KEK wrap** (Google's recommended pattern; KMS payload size is limited).

```ts
async generateSessionDataKey({ aadContext }) {
  const plaintextDataKey = crypto.getRandomValues(new Uint8Array(32))
  const aadBytes = canonicalContextBytes(aadContext)
  const kms = await getKmsClient()
  const [resp] = await kms.encrypt({
    name: env.GCP_KMS_SESSION_KEK,           // .../cryptoKeys/<name>
    plaintext: plaintextDataKey,
    plaintextCrc32c: { value: crc32c(plaintextDataKey) },
    additionalAuthenticatedData: aadBytes,
    additionalAuthenticatedDataCrc32c: { value: crc32c(aadBytes) },
  })
  // verify resp.verifiedPlaintextCrc32c && resp.verifiedAdditionalAuthenticatedDataCrc32c
  return {
    plaintextDataKey,
    encryptedDataKey: Buffer.from(resp.ciphertext as Uint8Array),
    keyId: env.GCP_KMS_SESSION_KEK,
    keyVersion: `gcp-kms:${resp.name?.split('/').pop() ?? 'primary'}`,
  }
}

async decryptSessionDataKey({ encryptedDataKey, aadContext, keyId }) {
  const aadBytes = canonicalContextBytes(aadContext)
  const kms = await getKmsClient()
  const [resp] = await kms.decrypt({
    name: keyId,
    ciphertext: encryptedDataKey,
    ciphertextCrc32c: { value: crc32c(encryptedDataKey) },
    additionalAuthenticatedData: aadBytes,
    additionalAuthenticatedDataCrc32c: { value: crc32c(aadBytes) },
  })
  // verify resp.plaintextCrc32c
  return Buffer.from(resp.plaintext as Uint8Array)
}
```

**`canonicalContextBytes`** is already in `packages/sdk/src/key-custody/types.ts` and produces a deterministic byte string from the AAD record. **The exact same bytes** are passed to both Cloud KMS AAD and AES-GCM AAD — same as the AWS path. This is the dual-tripwire (KMS unwrap fails OR AES-GCM tag fails on tamper).

**The aadContext post-P0-6 already binds `key_version` and hashed `session_id_h`** — that work carries over verbatim. No need to re-do.

**CRC32c integrity**: Google KMS exposes CRC32C verification flags on both request and response. Production code must compute + verify; tests must include a "CRC32C mismatch" case.

**Env required**
```
GCP_KMS_SESSION_KEK=projects/<id>/locations/<loc>/keyRings/<ring>/cryptoKeys/a2a-session-kek
```

---

## G3 — Master EOA signer: `gcp-kms-signer.ts`

**File**: `packages/sdk/src/key-custody/gcp-kms-signer.ts`

Implements `KmsAccountBackend` (the same interface `createKmsAccount` / `viem-kms-account.ts` adapts into a viem `LocalAccount`).

```ts
async sign({ digest }) {
  const kms = await getKmsClient()
  const [resp] = await kms.asymmetricSign({
    name: env.GCP_KMS_MASTER_SIGNER_VERSION,  // .../cryptoKeyVersions/N
    digest: { sha256: digest },               // 32-byte digest
    digestCrc32c: { value: crc32c(digest) },
  })
  const der = Buffer.from(resp.signature as Uint8Array)
  // Re-use shared DER decode helper from packages/sdk/src/key-custody/der-utils.ts.
  const { r, s } = decodeDerSignature(der)
  // Google already produces lower-S for secp256k1, but we verify defensively.
  const sLow = normalizeLowS(s)
  // Recovery id derivation: try v=27, v=28; pick the one whose recovered
  // address matches our published public key. Re-use the existing helper
  // from aws-kms-signer.ts (extract it into der-utils.ts if not shared).
  const recovered27 = recoverEvmAddress(r, sLow, 27, digest)
  const v = recovered27 === expectedAddress ? 27 : 28
  return packEvmSignature(r, sLow, v)
}

async getPublicKey() {
  // GetPublicKey returns a PEM-encoded SubjectPublicKeyInfo.
  // Re-use SPKI extraction from der-utils.ts (already used by AWS path).
  // Cache the address per process lifetime.
}
```

**Env required**
```
GCP_KMS_MASTER_SIGNER_VERSION=projects/.../cryptoKeyVersions/N
```

**Rotation note**: like AWS, signer keys are pinned to a specific version. Rotation = create a new version, update env, redeploy. The DER decode + recovery-id derivation logic is identical to the AWS implementation — refactor shared helpers into `der-utils.ts` before adding GCP if needed.

---

## G4 — Tool executor signers (GCP variant)

`tool-executor-signer.ts` already has a `'aws-kms'` / `'local-aes'` switch. Add a third arm reading per-tool key-version env:

```
GCP_KMS_TOOL_EXECUTOR_DISBURSEMENT_VERSION=projects/.../cryptoKeys/tool-disbursement/cryptoKeyVersions/N
GCP_KMS_TOOL_EXECUTOR_ROUND_AWARDS_VERSION=projects/.../cryptoKeyVersions/N
GCP_KMS_TOOL_EXECUTOR_POOL_LIFECYCLE_VERSION=projects/.../cryptoKeyVersions/N
GCP_KMS_TOOL_EXECUTOR_GRANT_AWARDS_VERSION=projects/.../cryptoKeyVersions/N
GCP_KMS_TOOL_EXECUTOR_AUTH_BOOTSTRAP_VERSION=projects/.../cryptoKeyVersions/N
```

Implementation re-uses the same `asymmetricSign` + DER-decode + recovery-id pipeline as G3; only the env mapping differs.

The existing `TOOL_EXECUTOR_IDS` constant in `tool-executor-signer.ts` enumerates the canonical tool families. The `toolEnvKeyName(toolId, backend)` helper gains a `'gcp-kms'` branch.

---

## G5 — Inter-service MAC: `gcp-kms-mac.ts`

**File**: `packages/sdk/src/key-custody/gcp-kms-mac.ts`

Implements `MacProvider`. The interface is `generateMac({ canonicalMessage }) → { mac }` and `verifyMac({ canonicalMessage, mac }) → { valid }`.

```ts
async generateMac({ canonicalMessage }) {
  const kms = await getKmsClient()
  const [resp] = await kms.macSign({
    name: env[envKey],                         // GCP_KMS_MAC_<KEY_ID>_VERSION
    data: canonicalMessage,
    dataCrc32c: { value: crc32c(canonicalMessage) },
  })
  return { mac: Buffer.from(resp.mac as Uint8Array) }
}

async verifyMac({ canonicalMessage, mac }) {
  const kms = await getKmsClient()
  const [resp] = await kms.macVerify({
    name: env[envKey],
    data: canonicalMessage,
    dataCrc32c: { value: crc32c(canonicalMessage) },
    mac,
    macCrc32c: { value: crc32c(mac) },
  })
  return { valid: !!resp.success }
}
```

**Per-key env mapping** (mirrors AWS `AWS_KMS_MAC_KEY_ID_*`):
```
GCP_KMS_MAC_WEB_TO_A2A_VERSION
GCP_KMS_MAC_A2A_TO_PERSON_VERSION
GCP_KMS_MAC_A2A_TO_ORG_VERSION
GCP_KMS_MAC_A2A_TO_HUB_VERSION
GCP_KMS_MAC_A2A_TO_FAMILY_VERSION
GCP_KMS_MAC_A2A_TO_GEO_VERSION
GCP_KMS_MAC_A2A_TO_SKILL_VERSION
GCP_KMS_MAC_A2A_TO_VERIFIER_VERSION
GCP_KMS_MAC_A2A_TO_PEOPLE_GROUP_VERSION
GCP_KMS_MAC_OAUTH_SALT_VERSION
```

**Crucially**: the canonical message format MUST remain the canonical-v2 shipped by Sprint 5 P0-3 (`${ts}|${nonce}|${path}|${sha256(body)}`). Cloud-side MAC does not change application-side replay-resistance requirements.

The existing `MAC_KEY_IDS` + `MCP_TO_MAC_KEY_ID` constants in `mac-provider-factory.ts` are reused; the `envKeyForMacKeyId(macKeyId, backend)` helper gains a `'gcp-kms'` branch.

---

## G6 — Factory wiring

Add `case 'gcp-kms':` to each of the four factories in `apps/a2a-agent/src/auth/key-provider.ts`:

```ts
case 'gcp-kms': {
  if (!env.GCP_PROJECT_ID) throw new Error(...)
  if (!env.GCP_PROJECT_NUMBER) throw new Error(...)
  if (!env.GCP_WORKLOAD_IDENTITY_POOL_ID) throw new Error(...)
  if (!env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID) throw new Error(...)
  if (!env.GCP_SERVICE_ACCOUNT_EMAIL) throw new Error(...)
  if (!env.GCP_KMS_SESSION_KEK) throw new Error(...)  // for buildKeyProvider only
  return createGcpKmsProvider(env)
}
```

Also: remove the existing `'vault-transit'` deferred-stub case (or keep it — orchestrator decision; the user has indicated AWS+GCP coverage is the goal).

---

## G7 — Production startup invariants

`apps/a2a-agent/src/lib/policy-startup.ts` already enforces "no static secrets in prod when `A2A_KMS_BACKEND=aws-kms`". Extend to symmetric `'gcp-kms'` checks:

When `NODE_ENV=production` AND `A2A_KMS_BACKEND=gcp-kms`, **refuse to start** if any of these are set:
- `GOOGLE_APPLICATION_CREDENTIALS`
- `GCP_SERVICE_ACCOUNT_KEY_JSON`
- `A2A_SESSION_SECRET`
- `A2A_MASTER_EOA_PRIVATE_KEY`
- `TOOL_EXECUTOR_*_PRIVATE_KEY` (pattern)
- `WEB_TO_A2A_HMAC_KEY`
- `A2A_INTERSERVICE_HMAC_KEY_*` (pattern)

And **require** all of:
- `GCP_PROJECT_ID`, `GCP_PROJECT_NUMBER`, `GCP_SERVICE_ACCOUNT_EMAIL`
- `GCP_WORKLOAD_IDENTITY_POOL_ID`, `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID`
- `GCP_KMS_SESSION_KEK`
- `GCP_KMS_MASTER_SIGNER_VERSION`
- `GCP_KMS_MAC_*_VERSION` (per MAC key in use)
- `GCP_KMS_TOOL_EXECUTOR_*_VERSION` (per tool in use)

Mirror the AWS production-invariants test suite (`apps/a2a-agent/test/policy-startup.test.ts`).

---

## G8 — Bypass-guard updates

`scripts/check-no-bypass.sh`:
- Existing rule "no `@aws-sdk/client-kms` import outside `packages/sdk/src/key-custody/`" → add symmetric rule for `@google-cloud/kms`, `google-auth-library`.
- The invariants already enforced (no direct DEPLOYER, no direct-MCP fetch, append-only audit) stay backend-agnostic.

---

## G9 — Testing strategy

Mirror the AWS test surface. For each new file:

**`gcp-kms-provider.test.ts`** — patterned after `aws-kms-provider.test.ts`:
- `provider exposes a sync keyVersion property`
- `EncryptionContext (AAD bytes) with key_version + session_id_h forwarded verbatim`
- `cross-version tamper triggers AES-GCM tag failure`
- `aadContext byte-identical between encrypt and decrypt`
- `CRC32C mismatch on plaintext is rejected` (new — GCP-specific tripwire)
- `CRC32C mismatch on ciphertext on decrypt is rejected`
- `KMS unwrap with tampered AAD bytes → decrypt fails before AES-GCM`

**`gcp-kms-signer.test.ts`** — patterned after `aws-kms-signer.test.ts`:
- `signs a digest and recovers to the expected EVM address`
- `low-S normalization: GCP already returns lower-S; signer trusts but verifies`
- `getPublicKey extracts secp256k1 SPKI → EVM address`
- `recovery-id derivation picks v=27 when address matches, v=28 otherwise`

**`gcp-kms-mac.test.ts`** — patterned after `aws-kms-mac.test.ts`:
- `macSign + macVerify round-trip across canonical-v2 message`
- `verifyMac soft-fails to { valid: false } on tampered MAC`
- `verifyMac soft-fails on tampered canonical message`
- `CRC32C mismatch on data is rejected`

**Mocked SDK**: `@google-cloud/kms` Node client is mockable via constructor injection or interface seam — same approach as `AwsKmsDeps` already used in the AWS tests. Do **not** call the real Google API in unit tests.

**Integration smoke** (optional, gated by `RUN_GCP_KMS_INTEGRATION=1`): one round-trip per primitive against a real GCP project. Skipped in CI by default.

---

## G10 — IAM + provisioning runbook

Add `docs/operator/gcp-kms-provisioning.md` (sibling of any existing AWS operator runbook):

1. Create GCP project.
2. Enable Cloud KMS, IAM Credentials API, Cloud Resource Manager API.
3. Create key ring.
4. Create one symmetric KEK for session envelope (`a2a-session-kek`).
5. Create one asymmetric secp256k1 key + version for master EOA signer.
6. Create one asymmetric secp256k1 key + version per tool executor.
7. Create one MAC key (HMAC_SHA256) + version per inter-service edge.
8. Create Workload Identity Pool + Vercel OIDC provider per Vercel docs.
9. Create service account; grant per-key IAM roles:
   - `roles/cloudkms.cryptoKeyEncrypterDecrypter` on session KEK
   - `roles/cloudkms.signer` on master + tool executor versions
   - `roles/cloudkms.signerVerifier` on MAC versions
10. Bind Workload Identity Pool principal to service account via
    `roles/iam.workloadIdentityUser`.
11. Set Vercel env vars (identifiers only; no JSON keys).
12. Verify with `pnpm tsx scripts/diagnose-gcp-kms.ts` (sibling of any existing diagnose-aws script).

---

## G11 — Phased delivery

| Phase | Scope | PRs |
|---|---|---|
| G-PR-1 | `gcp-auth.ts` + production guard + factory case throwing "not yet implemented" | 1 |
| G-PR-2 | `gcp-kms-provider.ts` (session envelope) + tests + factory wired | 1 |
| G-PR-3 | `gcp-kms-signer.ts` + `viem-kms-account` integration + tests + factory wired | 1 |
| G-PR-4 | Tool-executor GCP arm + tests | 1 |
| G-PR-5 | `gcp-kms-mac.ts` + tests + factory wired | 1 |
| G-PR-6 | Production startup invariants + bypass-guard rules + operator runbook | 1 |

Sequencing rule: each PR is independently shippable and adds one provider arm. The factory throws "GCP backend not yet ready for <X>" until that arm lands. This mirrors how the AWS PRs (K2 → K4 PR-1 → K4 PR-2 → K5 → K3-ext) shipped.

---

## Sequencing against Sprint 5

Sprint 5 Wave 1 (P0-3 + P0-5 + P0-6) touches `inter-service.ts` canonical format, audit chain shape, and `buildSessionAAD` `key_version` binding. None of these block GCP work, **but**:

- **G2 depends on Sprint 5 P0-6 having landed** — the AAD canonical format with `key_version` + `session_id_h` is what GCP's KEK-wrap binds. ✅ P0-6 already complete (2026-05-17).
- **G5 depends on Sprint 5 P0-3 having landed** — the canonical-v2 MAC format is what GCP MAC signs over. ⏳ In flight.
- **G6/G7** are mechanical and depend only on the providers being implemented.

**Recommendation**: queue GCP work to begin after Sprint 5 Wave 1 lands and merges. The first GCP PR (G-PR-1) can land in parallel with Sprint 5 Wave 2 since it only adds `gcp-auth.ts` + factory stubs.

---

## What this plan does NOT do

- Does not remove the AWS backend. Both stay supported; `A2A_KMS_BACKEND` chooses one per deployment.
- Does not change the `A2AKeyProvider` / `KmsAccountBackend` / `KmsMacProvider` interfaces.
- Does not unify the AAD shape across clouds — `EncryptionContext` (AWS map) and `additionalAuthenticatedData` (GCP bytes) both derive from the same `canonicalContextBytes(aadContext)` source of truth, so security parity is preserved without abstracting away the API surface differences.
- Does not pre-commit to GCP. The user picks one cloud operationally; the codebase supports either.

---

## Open decisions for the orchestrator

1. **Vault-transit case**: keep, delete, or fold into the same effort? The factory currently has a stub. If the goal is AWS + GCP only, delete the stub.
2. **Default backend in dev**: stays `local-aes`. No change.
3. **CI matrix**: should CI run the AWS *and* GCP unit-test suites against both mocked SDKs? Recommended yes (cheap; catches drift).
4. **Operator preference**: does the user want to actually deploy a GCP project to validate G-PR-2 end-to-end, or is mocked-SDK coverage sufficient until a real GCP deployment is needed?
