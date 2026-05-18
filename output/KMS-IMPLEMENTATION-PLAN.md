# Smart Agent KMS Migration — Phase K0–K7 Implementation Plan

**Synthesis date**: 2026-05-17
**Scope of this document**: Full phase plan K0–K7 with K0–K3 specified in detail; K4–K7 sketched and explicitly deferred to Phase 2.
**Architectural framing**: provider-neutral. The application depends on a single `A2AKeyProvider` interface (K0). It does NOT depend directly on AWS KMS, HCP Vault Transit, GCP KMS, or any other cryptographic substrate. Providers are interchangeable behind the interface seam.
**v1 implementation target**: **AWS KMS via Vercel OIDC federation** is the K2 implementation we are landing. AWS KMS satisfies envelope encryption (`GenerateDataKey` + `Decrypt` with `EncryptionContext`), short-lived federated credentials via `@vercel/oidc-aws-credentials-provider` (one-line integration), audit (CloudTrail), HMAC keys (`GenerateMac`/`VerifyMac` — K3-extension), and EVM-compatible asymmetric signing (`ECC_SECG_P256K1` — K4) on a single backend with minimal operational footprint (one IAM role + one CMK; no separately operated cluster).
**Documented sibling**: HCP Vault Transit (§3.2b) — kept in this spec as the future alternative if/when secp256k1 support lands on Vault Transit in a verifiable form (current official Vault Transit signing key types: ecdsa-p256/p384/p521, ed25519, RSA; secp256k1 for K4 is an open implementation question on Vault and requires verification against the deployed HCP Vault version). The K2-alt switch is a single provider file plus the `'vault-transit'` branch in `apps/a2a-agent/src/auth/key-provider.ts` — zero call-site changes.
**Structural invariant**: no long-lived cloud credentials in env at all. Production runtime carries only routing identifiers (region, role ARN, key ARN); credentials come from short-lived OIDC tokens minted by Vercel and traded for AWS STS temp credentials (or, in the Vault sibling configuration, for Vault session tokens).

References:
- `output/HARDENING-PLAN.md` — Area 10 ("Session package custody") and §4.1 (langchain-in-sandbox-sub-process design — the answer to live runtime compromise).
- `packages/sdk/src/crypto.ts` — existing `encryptPayload` / `decryptPayload` / `buildSessionAAD` (lines 71–162). AAD trip-wire landed under Hardening §1.5 #8 and is the substrate this plan layers on top of.
- `apps/a2a-agent/src/db/schema.ts:35-53` — current `sessions` table.

---

## 1. Architecture summary

Today every session row is sealed with AES-GCM using a single CryptoKey derived (`SHA-256`) from `config.A2A_SESSION_SECRET`, an env var. One leaked env var decrypts the entire `sessions` table. Beyond that, `A2A_MASTER_EOA_PRIVATE_KEY`, the per-MCP HMAC keys, and `DEPLOYER_PRIVATE_KEY` all sit in env vars too — a single env dump is a complete game-over primitive.

This plan eliminates that primitive in eight phases. The K3 deliverable is envelope encryption for the session table: per-session data keys generated/wrapped by a key-management service (AWS KMS in production, an HKDF-based local provider in dev), bound via the KMS's `EncryptionContext` mechanism to the same `(sessionId, accountAddress, chainId, expiresAt, keyVersion)` tuple that already authenticates the AES-GCM ciphertext via AAD. Cipher format and on-disk layout are unchanged except for three additive columns (`encryptedDataKey`, `keyVersion`, `kmsKeyId`).

K4–K7 then walk down the remaining secret list (master EOA, tool-executor keys, HMAC keys, deployer key) until no cryptographic secret survives in runtime env.

Invariants the new system upholds:

- **AAD invariant** (extended in reviewer P0-6): every session row's AES-GCM tag binds `keccak256(sessionId ‖ accountAddress ‖ chainId ‖ expiresAt ‖ keyVersion)` (Hardening §1.5 #8 + P0-6; `packages/sdk/src/crypto.ts:buildSessionAAD`). The `keyVersion` field makes a per-version replay (e.g. `local-v1` → `local-v2`, or any rotation across providers) detectable at the AES-GCM tag layer in addition to the KMS layer.
- **KMS context invariant**: the KMS-side `EncryptionContext` passed to `GenerateDataKey` / `Decrypt` mirrors the AAD tuple verbatim. AWS rejects any `Decrypt` call whose context bytes don't match what was used at `GenerateDataKey` (surfaced as `InvalidCiphertextException`). This is a second, independent trip-wire enforced by AWS rather than by our code. **This invariant applies to symmetric KMS keys only — see §13.**
- **IAM invariant**: only the a2a-agent runtime IAM role holds `kms:Decrypt` on the key ARN; the role is assumable only via OIDC federation from the project's Vercel deployment. Developer roles, the web-app role, MCP roles, and humans are denied. Phase 1D audit rows detect violations.
- **No plaintext leaves a2a-agent**: data keys live only in heap memory, only for the duration of the encrypt/decrypt call, and only inside the privileged a2a process — never on disk, never crossing process boundaries, never logged.
- **No-direct-KMS invariant** (new, architectural): route handlers MUST NOT import `@aws-sdk/client-kms`, `node-vault`, or any other cloud SDK directly. They go through `sessionCrypto`, `a2aSigner`, `serviceAuth` app-layer wrappers, each of which holds the `A2AKeyProvider` reference. Enforced by `scripts/check-no-bypass.sh` (extended).

The change is a layering change. `encryptPayload` / `decryptPayload` in `@smart-agent/sdk` keep their signature and contract; the new `apps/a2a-agent/src/auth/encryption.ts` becomes the only file in a2a that calls them, sourcing the key from the provider rather than from `config.A2A_SESSION_SECRET`.

---

## 2. The eight phases (K0–K7)

| Phase | Deliverable | Scope |
|---|---|---|
| **K0** | `A2AKeyProvider` interface (provider-neutral; cloud-independent) | §2.1 |
| **K1** | Local-dev AES provider (no cloud calls) | §3.1 |
| **K2** | **AWS KMS + Vercel OIDC provider** (v1 prod implementation target) | §3.2a |
| **K2-alt** | HCP Vault Transit sibling (deferred / documented alternative) | §3.2b |
| **K3** | Session-package envelope encryption — **already complete via K0+K1's call-site refactor**; no separate PR | §5, §6, §7 |
| **K4** | AWS KMS asymmetric signer (`ECC_SECG_P256K1`) for A2A master EOA | §11 (sketched) + §16 |
| **K5** | Tool-executor key migration (per-tool sub-delegated path keys) | §11 (sketched) |
| **K6** | Deployer key removal from runtime (CI/CD-only via OIDC) | §11 (sketched) |
| **K7** | Audit, alerts, revocation, replay protection | §11 (sketched) |

K0 + K1 shipped as PR-1. K2 (AWS KMS) is the current standalone PR (this revision). K2-alt (Vault Transit) is the documented sibling — a future PR can land it without touching any call sites because the `A2AKeyProvider` interface is the integration boundary. K4–K7 are deferred to Phase 2 and stay sketched-out, not fully spec'd, in this document.

### 2.1 The A2AKeyProvider interface (K0)

New file: `packages/sdk/src/key-custody/types.ts`. Lives in `@smart-agent/sdk` so org-mcp, person-mcp, hub-mcp can adopt the same pattern in later phases without re-implementing it.

```ts
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

  signA2AAction?(input: {
    canonicalPayload: Uint8Array
    accountAddress: string
    chainId: string
    sessionId: string
    actionId: string
  }): Promise<{ signature: Uint8Array; keyId: string; signerAddress: string }>

  generateMac?(input: {
    canonicalMessage: Uint8Array
    service: string
    audience: string
  }): Promise<{ mac: Uint8Array; keyId: string }>
}
```

The optional `?` on `signA2AAction` and `generateMac` is load-bearing. These arrive in K4 (asymmetric signing) and K3-extension (HMAC via KMS GenerateMac/VerifyMac, see §13) respectively. The K1 local-aes provider implements only the first two methods. The optionality makes per-phase rollout natural: a provider opting into K4 functionality simply starts returning a non-`undefined` `signA2AAction`; nothing in K0/K1/K3 changes shape.

App-layer wrappers — the only thing route handlers may touch directly:
- `sessionCrypto.seal(...)` / `sessionCrypto.open(...)` — wraps `generateSessionDataKey` / `decryptSessionDataKey` plus the AES-GCM layer (§5).
- `a2aSigner.sign(...)` — wraps `signA2AAction` (K4+).
- `serviceAuth.mac(...)` / `serviceAuth.verifyMac(...)` — wraps `generateMac` plus AWS's `kms:VerifyMac` (K3-extension+).

**Architectural invariant**: route handlers MUST NOT call AWS KMS, Vault, or any cloud SDK directly. The bypass-check script (extended in PR-1) greps for `@aws-sdk/client-kms` imports outside `packages/sdk/src/key-custody/` and the `apps/a2a-agent/src/auth/` wrappers and fails CI.

The `aadContext: Record<string, string>` shape lets a single provider service both Vault (where it maps to `context` on Transit) and AWS (where it maps to `EncryptionContext`). For asymmetric and HMAC operations the context is encoded into the canonical message instead (see §13).

---

## 3. Provider implementations

### 3.1 local-aes (K1, dev)

New file: `packages/sdk/src/key-custody/local-aes-provider.ts`. `keyVersion` returned is `'local-v1'`; `keyId` is `'local'`.

**Design**: random salt as the "ciphertextBlob", HKDF over (env secret, salt, context). Rationale:

- Deterministic HKDF over `(secret, context)` alone is brittle. An attacker who learns the env secret can pre-compute every session's data key from the row's metadata, and a chosen-context attack becomes possible. Audit will flag it.
- Adding 16 bytes of fresh randomness per row means the data key is `HKDF-SHA256(ikm=A2A_SESSION_SECRET, salt=randomSalt, info=canonicalize(context))`. Stealing the env secret no longer yields the data keys without also stealing the database — strictly weaker than the AWS path but strictly stronger than today's "one global key derived from one env var".

Algorithm:
```
generateSessionDataKey({ aadContext }):
    salt = crypto.getRandomValues(new Uint8Array(16))
    info = canonicalContextBytes(aadContext)        // sorted key=value pairs, '\0'-separated
    dataKey = HKDF-SHA256(
        ikm  = utf8(env.A2A_SESSION_SECRET),
        salt = salt,
        info = info,
        len  = 32,
    )
    return {
      plaintextDataKey: dataKey,
      encryptedDataKey: salt,
      keyId: 'local',
      keyVersion: 'local-v1',
    }

decryptSessionDataKey({ encryptedDataKey: salt, aadContext, keyId, keyVersion }):
    assert keyId === 'local' && keyVersion === 'local-v1'
    info = canonicalContextBytes(aadContext)
    return HKDF-SHA256(env.A2A_SESSION_SECRET, salt, info, 32)
```

`canonicalContextBytes` lives in `packages/sdk/src/key-custody/types.ts` and is shared by all providers — the AWS provider only uses it for audit logging (AWS sorts internally), but having a single canonical encoder eliminates a class of context-drift bugs.

Constructor validates `A2A_SESSION_SECRET` is present and ≥32 bytes after hex decode (today's `requireSecret` in `apps/a2a-agent/src/config.ts:25-34` already enforces the length).

### 3.2 Production provider implementations (sibling)

Two production-class providers satisfy the `A2AKeyProvider` contract from §2.1. They are interchangeable behind the interface seam — the K2 PR lands AWS KMS as the v1 implementation; Vault Transit is documented as the sibling alternative for the future. The selector branch in `apps/a2a-agent/src/auth/key-provider.ts` and the env-var table in §14 enumerate both.

### 3.2a aws-kms + Vercel OIDC (v1 implementation target)

New file: `packages/sdk/src/key-custody/aws-kms-provider.ts`. Uses the official `@aws-sdk/client-kms` for `GenerateDataKey` and `Decrypt`, plus `@vercel/oidc-aws-credentials-provider`'s `awsCredentialsProvider({ roleArn })` as the credentials provider — a one-line integration that lazily resolves the Vercel OIDC token on each request and trades it for AWS STS temp credentials via `AssumeRoleWithWebIdentity`.

```ts
import { KMSClient, GenerateDataKeyCommand, DecryptCommand } from '@aws-sdk/client-kms'
import { awsCredentialsProvider } from '@vercel/oidc-aws-credentials-provider'
import type { A2AKeyProvider } from './types'

export interface AwsKmsEnv {
  AWS_REGION: string
  AWS_ROLE_ARN: string
  AWS_KMS_KEY_ID: string
}

export function createAwsKmsProvider(env: AwsKmsEnv): A2AKeyProvider {
  // Constructor validates env shape (region non-empty, role ARN + key ARN
  // match the expected patterns), constructs KMSClient with
  // awsCredentialsProvider({ roleArn }) as the credentials provider, and
  // derives keyVersion synchronously from AWS_KMS_KEY_ID (the key id is
  // embedded in the ARN; rotation produces a new key id detectable via
  // DescribeKey at startup if needed). NO 'pending' placeholder dance.
}
```

Provider responsibilities:

1. **OIDC → STS credential flow**. `awsCredentialsProvider({ roleArn })` registers a credentials provider on the `KMSClient`. On every `client.send(...)` call (from inside the request handler), the helper reads the Vercel OIDC token from request scope, calls `sts:AssumeRoleWithWebIdentity`, and caches the resulting temp credentials in memory until they expire. **`getVercelOidcToken()` cannot run at module-load time** in Vercel Functions (no request context yet); the AWS SDK's lazy credential resolution does the right thing here.

2. **`generateSessionDataKey({ aadContext })`**:
   - Build `EncryptionContext = aadContext` (AWS expects `Record<string, string>`).
   - `GenerateDataKey({ KeyId, KeySpec: 'AES_256', EncryptionContext })`.
   - Return `{ plaintextDataKey: Plaintext, encryptedDataKey: CiphertextBlob, keyId: KeyId, keyVersion: 'aws-kms:<uuid extracted from ARN>' }`.
   - The `keyVersion` is synchronously knowable — the ARN format `arn:aws:kms:<region>:<account>:key/<uuid>` carries the key id; we extract the UUID at construction time and tag every encrypted row with it.

3. **`decryptSessionDataKey({ encryptedDataKey, aadContext, keyId, keyVersion })`**:
   - `Decrypt({ CiphertextBlob: encryptedDataKey, EncryptionContext: aadContext })`.
   - Returns `Plaintext`.
   - `InvalidCiphertextException` is the AWS-side context-mismatch trip-wire — surfaced as `Error('context mismatch (KMS denied decrypt)')`. This is the second of two independent trip-wires (the first is the AES-GCM AAD in `apps/a2a-agent/src/auth/encryption.ts`).

4. **EncryptionContext binding**. The canonical context map (snake_case keys to match the IAM policy ARNs and CloudTrail JSON; sessionId is sha256-hashed per reviewer P0-6 so raw sessionIds never bleed into operator telemetry) is `{ session_id_h, account_address, chain_id, expires_at, key_version }`. AWS embeds this in the cipher's MAC and refuses to decrypt unless every byte matches what was used at `GenerateDataKey` time. The IAM permissions policy (§8.1) additionally enforces that every call carries this exact set of context keys via the `kms:EncryptionContextKeys` and `Null` conditions, so a misuse is caught at the IAM layer before reaching our code.

5. **Error mapping**. Clean messages, no response-body leakage:
   - `InvalidCiphertextException` → `'context mismatch (KMS denied decrypt)'` (the EncryptionContext trip-wire).
   - `AccessDeniedException`, HTTP 403 → `'kms unauthorized'` (no retry; alarm loudly).
   - `ThrottlingException`, `KMSInternalException` → exponential-backoff retry (SDK middleware default; up to 3 attempts).
   - `KMSInvalidStateException`, `DisabledException`, `KeyUnavailableException` → fail-closed; surface as `'kms key unavailable'` → 503 to caller.
   - Network / timeout (5s `AbortController`) → `'kms unreachable'`.

6. **Plaintext lifetime**. The 32-byte plaintext data key lives in heap only for the duration of the encrypt/decrypt call. Zeroising is the CALLER'S responsibility (`apps/a2a-agent/src/auth/encryption.ts` already does this in `finally` per the K0+K1 contract). The provider never caches plaintext keys; AWS STS temp credentials are cached by `awsCredentialsProvider` but contain no key material.

7. **K3-extension / K4 reuse on the same backend**. AWS KMS has dedicated HMAC keys (`KeySpec=HMAC_256` with `GenerateMac`/`VerifyMac`) for the K3-extension service-auth replacement (§13), and asymmetric `ECC_SECG_P256K1` keys with `Sign` for K4 EVM signing (§11, §16). Both extensions stay on the same provider footprint — additional IAM grants, no new substrate. **K4 EVM signing has its own spec** because secp256k1 signatures need DER decode, low-s normalisation, recovery-id derivation, address recovery, and on-chain owner migration — out of scope for this K2 PR.

8. **Constructor validation**. `AWS_REGION` non-empty; `AWS_ROLE_ARN` matches the IAM role ARN pattern (`arn:aws:iam::\d+:role/.+`); `AWS_KMS_KEY_ID` matches the KMS key ARN pattern (`arn:aws:kms:[a-z0-9-]+:\d+:key/.+`) or a bare key id pattern (uuid or alias). Constructor does NOT contact AWS — first-request validation only, so cold-start latency is identical between long-running servers and Vercel Functions.

AWS KMS request rate: one call per `/session/init`, `/session/package`, and per MCP-bound decrypt site. AWS KMS pricing: $1/CMK/mo + $0.03/10k requests; effectively free at our volume. Hot-path latency: `GenerateDataKey` / `Decrypt` p50 ≈ 5ms, p99 ≈ 30ms when colocated with the workload region.

### 3.2b vault-transit + Vercel OIDC (future alternative, documented sibling)

The Vault Transit provider is the documented sibling for future flexibility. The implementation file `packages/sdk/src/key-custody/vault-transit-provider.ts` exists (landed in an earlier iteration) and uses a thin `fetch()`-based client against Vault's HTTP API — **no `@hashicorp/vault-client` or `node-vault` dependency**. The Transit `datakey/plaintext` and `decrypt` endpoints map 1:1 to the `A2AKeyProvider` contract; everything we need is a half-dozen well-documented JSON endpoints.

The selector branch in `apps/a2a-agent/src/auth/key-provider.ts` currently throws "not yet implemented" for `'vault-transit'` — flipping it on is a single-line change once a deployment chooses Vault. No call-site touch.

**Curve / signing gap (verify before adoption)**: Vault Transit's officially documented signing key types at the time of writing are `ecdsa-p256/p384/p521`, `ed25519`, and several RSA variants. Native `secp256k1` support (required for K4 EVM signing without an on-chain owner migration to a non-EVM curve) is an open implementation question on Vault and **must be verified against the specific HCP Vault version** before a K4 implementation can target Vault Transit. This is the primary reason the K2 v1 target is AWS KMS — AWS KMS has documented `ECC_SECG_P256K1` support.

```ts
import { createLocalAesProvider } from './local-aes-provider'
import type { A2AKeyProvider } from './types'

export interface VaultTransitEnv {
  VAULT_ADDR: string                 // e.g. https://<your-cluster>.hashicorp.cloud:8200
  VAULT_NAMESPACE?: string           // HCP requires this (usually 'admin'); self-hosted Vault often does not
  VAULT_TRANSIT_KEY: string          // e.g. "smart-agent-session-encryption"
  VAULT_OIDC_ROLE: string            // Vault role bound to the Vercel OIDC issuer
}

export function createVaultTransitProvider(env: VaultTransitEnv): A2AKeyProvider {
  // Implementation: see packages/sdk/src/key-custody/vault-transit-provider.ts
}
```

Provider responsibilities:

1. **Vercel OIDC token discovery**. The Vercel OIDC token is bound to the request scope (the `x-vercel-oidc-token` header) when running on Vercel Functions, and to the `VERCEL_OIDC_TOKEN` env var in builds and long-running servers. The K2 implementation reads `VERCEL_OIDC_TOKEN` from the process environment as the v1 source; request-scope reading via `@vercel/oidc` is documented as future work for the Vercel-Function deployment case. **Choice rationale**: a2a-agent is a long-running Hono server today, not a Vercel Function — the env-var path is sufficient. Avoiding `@vercel/oidc` keeps the SDK free of a Vercel-specific runtime dependency. If we later deploy a2a-agent AS a Vercel Function, the token-discovery module (`apps/a2a-agent/src/auth/vault-oidc-token-exchange.ts`) is the single place that has to shift to request-scope reading.

2. **Vault session token exchange**. `POST /v1/auth/oidc/login` with `{ "role": VAULT_OIDC_ROLE, "jwt": vercelOidcToken }`. Response includes `auth.client_token` (Vault session token) and `auth.lease_duration` (TTL in seconds). The token is cached in memory and renewed when remaining TTL < 60s. **Never logged, never persisted.** On HCP, every request also carries the `X-Vault-Namespace: <VAULT_NAMESPACE>` header.

3. **Data-key generation**. `POST /v1/transit/datakey/plaintext/{VAULT_TRANSIT_KEY}` with `{ "context": base64(canonicalContextBytes(aadContext)) }`. Response includes `data.plaintext` (base64 of the 32-byte AES key) and `data.ciphertext` (`vault:vN:base64...`). Return `{ plaintextDataKey: base64Decode(data.plaintext), encryptedDataKey: utf8Encode(data.ciphertext), keyId: VAULT_TRANSIT_KEY, keyVersion: parseVersion(data.ciphertext) }`. The `vault:vN:` prefix is parseable — `keyVersion` is a first-class integer, no `'pending'` placeholder dance.

4. **Data-key decrypt**. `POST /v1/transit/decrypt/{VAULT_TRANSIT_KEY}` with `{ "ciphertext": utf8Decode(encryptedDataKey), "context": base64(canonicalContextBytes(aadContext)) }`. Response includes `data.plaintext` (base64 of the 32-byte AES key). Vault refuses the decrypt if the `context` does not match what was used at `datakey/plaintext` time — that is the context-mismatch trip-wire, equivalent in shape to AWS's `InvalidCiphertextException`.

5. **Error mapping**. Clean messages, never leaking response bodies:
   - HTTP 403 → `"vault unauthorized"` (token expired, key not allowed, or context mismatch). On expired-token suspicion the provider re-authenticates once and retries; second 403 surfaces the error.
   - HTTP 404 → `"vault key not found"` (transit key was deleted or never existed).
   - HTTP 5xx → `"vault server error: <status>"`.
   - Network error / timeout → `"vault unreachable"`. All `fetch()` calls run under a 5-second timeout via `AbortSignal.timeout(5000)`.

6. **Plaintext lifetime**. The 32-byte plaintext data key lives in heap only for the duration of the encrypt/decrypt call. Zeroising is the caller's responsibility (`apps/a2a-agent/src/auth/encryption.ts` already does this in `finally` per the K0+K1 contract). The provider never caches plaintext keys.

7. **Constructor validation**. `VAULT_ADDR` must be a valid URL; `VAULT_TRANSIT_KEY` and `VAULT_OIDC_ROLE` must be non-empty. Constructor does NOT contact Vault — first-request validation only, so module-load order in long-running servers and Vercel-Function cold-starts is identical.

Vault request rate (when adopted): one Vault call per `/session/init`, `/session/package`, and per MCP-bound decrypt site. HCP's free dev tier is ≤25k ops/mo. Hot-path latency: Transit p50 ≈ 8ms, p99 ≈ 40ms when colocated with the workload region.

### 3.4 gcp-kms — sketched alternative

A GCP KMS implementation would follow the same shape as §3.2a, with GCP's federated workload-identity token exchange in place of `AssumeRoleWithWebIdentity`. GCP KMS supports `additionalAuthenticatedData` (the AAD analogue for `EncryptionContext`) on `Encrypt`/`Decrypt`. **Same `A2AKeyProvider` interface; only the provider file and the selector branch change.** Out of scope for this plan — re-evaluate if a team adopts GCP as their primary cloud.

### 3.5 Cloudflare Workers — separate design, out of scope for K2

The prior draft implied Cloudflare Workers + Cloudflare Access could do the same OIDC federation to AWS STS (or Vault) as Vercel does. **They cannot, not without a separately designed and tested trust policy.** Specifically:

- **Cloudflare Access JWTs** (`Cf-Access-Jwt-Assertion` header) are documented for **inbound** authentication to Access-protected Workers/origins. They authenticate a user/service hitting a Worker. They are **not** documented as a workload identity token for **outbound** federation to AWS STS, Vault OIDC, or any other KMS-class backend.
- The federation path **Cloudflare Worker → AWS STS `AssumeRoleWithWebIdentity`** (or → Vault OIDC) is not a paved road. It requires (a) configuring the KMS-side OIDC identity provider to trust a Cloudflare-issued token, (b) a role/policy that pins to the specific Cloudflare account + script + environment via `sub`/`aud` claim conditions, and (c) verifying that the token Cloudflare provides for outbound use has the right structure. None of that is built here today.

Until that flow is independently designed, tested, and pen-reviewed, **this spec commits only to Vercel for OIDC federation**. Cloudflare deployment of a2a-agent is out of scope for K2.

If/when CF Workers becomes a deployment target:
- Design the trust policy as a separate workstream.
- The `A2AKeyProvider` interface does not change — a `createCloudflareAwsKmsProvider(env)` factory drops in alongside `createAwsKmsProvider`.
- Verify that the Worker can mint a token suitable for `AssumeRoleWithWebIdentity` (or Vault OIDC login for the sibling) from inside the request handler, with the same lifetime-scoping concerns as Vercel's `getVercelOidcToken()`.

---

## 4. Schema migration (K3 prep)

Three columns added to `sessions` in `apps/a2a-agent/src/db/schema.ts`. Existing columns (`encryptedPackage`, `iv`) keep their meaning — the cipher format is unchanged, only the data key sourcing changes.

```typescript
export const sessions = sqliteTable('sessions', {
  // ... existing columns unchanged through line 53 ...

  /** Base64 of the KMS-wrapped data key (aws-kms) OR the HKDF salt (local-aes).
   *  Null for legacy rows written before the K3 cutover. */
  encryptedDataKey: text('encrypted_data_key'),

  /** Provider tag — e.g. 'aws-kms:<uuid>' or 'local-v1'. 'legacy' means the row
   *  was sealed with the pre-K3 path (single CryptoKey from A2A_SESSION_SECRET).
   *  Drives provider selection on decrypt — see auth/encryption.ts. */
  keyVersion: text('key_version').notNull().default('legacy'),

  /** Informational; the KMS keyId/ARN (or 'local') at encryption time. Passed
   *  back into decryptSessionDataKey so the KMS knows which key to use. */
  kmsKeyId: text('kms_key_id'),
})
```

Idempotent SQL (the Drizzle migration generator emits these; we commit the generated `*.sql` under `apps/a2a-agent/drizzle/`):

```sql
ALTER TABLE sessions ADD COLUMN encrypted_data_key TEXT;
ALTER TABLE sessions ADD COLUMN key_version TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE sessions ADD COLUMN kms_key_id TEXT;
```

SQLite's `ALTER TABLE ADD COLUMN` is idempotent at the migration layer (Drizzle's migrator records applied migrations in `__drizzle_migrations`). The `DEFAULT 'legacy'` guarantees that any session row inserted before the cutover decrypts via the legacy path even after the migration runs.

No data backfill. Sessions are short-lived (medium-tier ≤7 days per `clampSessionTtl`); rolling-out by natural expiry is simpler and reduces blast radius.

---

## 5. The new a2a-side encryption helper (K3)

New file: `apps/a2a-agent/src/auth/encryption.ts`. Single choke point for every encrypt/decrypt of a session package in a2a-agent. Lives next to `inter-service.ts`, `replay-nonce.ts`, `service-auth-web.ts` — same pattern (auth-relevant primitives co-located).

A sibling file `apps/a2a-agent/src/auth/key-provider.ts` is the **only** place that instantiates the provider:

```ts
// apps/a2a-agent/src/auth/key-provider.ts
import type { A2AKeyProvider } from '@smart-agent/sdk/key-custody'
import { createLocalAesProvider, createAwsKmsProvider } from '@smart-agent/sdk/key-custody'

export function buildKeyProvider(env: NodeJS.ProcessEnv): A2AKeyProvider {
  const backend = env.A2A_KMS_BACKEND ?? 'local-aes'
  if (env.NODE_ENV === 'production' && backend === 'local-aes') {
    throw new Error('production requires A2A_KMS_BACKEND != local-aes')
  }
  switch (backend) {
    case 'local-aes':
      return createLocalAesProvider({ A2A_SESSION_SECRET: env.A2A_SESSION_SECRET! })
    case 'aws-kms':
      // K2 v1 implementation target (§3.2a).
      return createAwsKmsProvider({
        AWS_REGION: env.AWS_REGION!,
        AWS_ROLE_ARN: env.AWS_ROLE_ARN!,
        AWS_KMS_KEY_ID: env.AWS_KMS_KEY_ID!,
      })
    case 'vault-transit':
      // K2-alt — documented sibling (§3.2b). Implementation lives in
      // packages/sdk/src/key-custody/vault-transit-provider.ts but the
      // selector branch stays stubbed until a deployment chooses Vault.
      throw new Error('vault-transit provider not yet implemented (K2-alt sibling)')
    default:
      throw new Error(`unknown A2A_KMS_BACKEND: ${backend}`)
  }
}
```

The encryption helper itself:

```typescript
/**
 * Session-package envelope encryption. The ONLY module in a2a-agent that
 * calls @smart-agent/sdk's encryptPayload / decryptPayload. Every other
 * file in this app gets here via `encryptSessionPackage` / `decryptSessionPackage`.
 *
 * Invariants:
 *   1. Every encrypt uses a freshly-generated data key (no caching).
 *   2. Every decrypt rebuilds the aadContext from sessionMeta and passes it to
 *      BOTH the KMS provider (KMS-side AAD / EncryptionContext) and AES-GCM
 *      (cipher-side AAD). Either mismatch trips a failure.
 *   3. Plaintext data keys live in heap only for the duration of the call;
 *      we zeroise them in a finally block.
 *   4. Audit row written on every call (success or failure) — fed into
 *      executionAudit by Phase 1D.
 */
import { encryptPayload, decryptPayload, buildSessionAAD } from '@smart-agent/sdk'
import type { A2AKeyProvider } from '@smart-agent/sdk/key-custody'
import { buildKeyProvider } from './key-provider'

const provider: A2AKeyProvider = buildKeyProvider(process.env)

export interface SessionMeta {
  sessionId: string
  accountAddress: string
  chainId: number
  expiresAt: string
}

export interface EncryptedRow {
  ciphertext: string            // base64url — sessions.encrypted_package
  iv: string                    // base64url — sessions.iv
  encryptedDataKey: string      // base64 of provider.encryptedDataKey
  keyVersion: string            // sessions.key_version
  kmsKeyId: string              // sessions.kms_key_id
}

function buildAadContext(meta: SessionMeta, keyVersion: string): Record<string, string> {
  // Reviewer P0-6 — keys are snake_case (matches IAM policy ARNs in §8.1),
  // sessionId is hashed (KMS EncryptionContext appears in CloudTrail).
  return {
    session_id_h: sha256(meta.sessionId).slice(0, 32),
    account_address: meta.accountAddress.toLowerCase(),
    chain_id: String(meta.chainId),
    expires_at: meta.expiresAt,
    key_version: keyVersion,
  }
}

function zeroise(buf: Uint8Array): void { for (let i = 0; i < buf.length; i++) buf[i] = 0 }
function toB64(b: Uint8Array): string { let s=''; for (const x of b) s+=String.fromCharCode(x); return btoa(s) }
function fromB64(s: string): Uint8Array { const bin=atob(s); const o=new Uint8Array(bin.length); for (let i=0;i<bin.length;i++) o[i]=bin.charCodeAt(i); return o }

export async function encryptSessionPackage<T>(payload: T, meta: SessionMeta): Promise<EncryptedRow> {
  // P0-6 — `keyVersion` is synchronously knowable from the provider, so we
  // build the aadContext BEFORE GenerateDataKey (AWS KMS requires the
  // EncryptionContext at GenerateDataKey time — it embeds it in the MAC).
  const keyVersion = provider.keyVersion
  const aadContext = buildAadContext(meta, keyVersion)
  const dk = await provider.generateSessionDataKey({ aadContext })
  try {
    // buildSessionAAD now binds keyVersion too (P0-6).
    const aesAad = buildSessionAAD({ ...meta, keyVersion })
    const dataKeyHex = Array.from(dk.plaintextDataKey).map(b => b.toString(16).padStart(2,'0')).join('')
    const enc = await encryptPayload(payload, dataKeyHex, aesAad)
    return {
      ciphertext: enc.ciphertext,
      iv: enc.iv,
      encryptedDataKey: toB64(dk.encryptedDataKey),
      keyVersion: dk.keyVersion,
      kmsKeyId: dk.keyId,
    }
  } finally {
    zeroise(dk.plaintextDataKey)
  }
}

export async function decryptSessionPackage<T>(
  row: {
    encryptedPackage: string | null
    iv: string | null
    encryptedDataKey: string | null
    keyVersion: string
    kmsKeyId: string | null
  },
  meta: SessionMeta,
): Promise<T> {
  if (!row.encryptedPackage || !row.iv) throw new Error('session row missing ciphertext')

  if (row.keyVersion === 'legacy') {
    return decryptLegacy<T>(row, meta)
  }

  if (!row.encryptedDataKey || !row.kmsKeyId) throw new Error('session row missing encryptedDataKey/kmsKeyId')

  const aadContext = buildAadContext(meta, row.keyVersion)
  const dataKey = await provider.decryptSessionDataKey({
    encryptedDataKey: fromB64(row.encryptedDataKey),
    aadContext,
    keyId: row.kmsKeyId,
    keyVersion: row.keyVersion,
  })
  try {
    // buildSessionAAD now binds row.keyVersion too (P0-6).
    const aesAad = buildSessionAAD({ ...meta, keyVersion: row.keyVersion })
    const dataKeyHex = Array.from(dataKey).map(b => b.toString(16).padStart(2,'0')).join('')
    return await decryptPayload<T>(
      { ciphertext: row.encryptedPackage, iv: row.iv },
      dataKeyHex,
      aesAad,
    )
  } finally {
    zeroise(dataKey)
  }
}

async function decryptLegacy<T>(
  row: { encryptedPackage: string | null; iv: string | null },
  meta: SessionMeta,
): Promise<T> {
  const { config } = await import('../config')
  const aad = buildSessionAAD({ ...meta, keyVersion: 'legacy' })
  return decryptPayload<T>(
    { ciphertext: row.encryptedPackage!, iv: row.iv! },
    config.A2A_SESSION_SECRET,
    aad,
  )
}
```

Why pass a hex string into `encryptPayload` rather than rewriting it to accept a raw key? The SDK function is stable API; changing its signature ripples into every test and every other call site. Passing the 32-byte data key as 64 hex chars means `deriveKey` in `crypto.ts:28-39` SHA-256s 64 ASCII bytes — deterministic, the same key material every time, indistinguishable from today's "secret" path. If we later want to skip the SHA-256 step and import the raw 32 bytes directly, that's a single change in `crypto.ts` with no callers affected.

---

## 6. Call-site migration (K3)

Every `decryptPayload<StoredSessionPackage>(...)` call across `apps/a2a-agent/src/routes/` replaces 4 lines (the AAD build + the decrypt) with 1 (`decryptSessionPackage(row, meta)`). The session metadata is already constructed at each site — no new data to thread through.

| Site | Today (file:line) | After | Lines changed |
|---|---|---|---|
| `routes/session.ts:69-73` — `/session/init` encrypt | `encryptPayload(..., config.A2A_SESSION_SECRET, aad)` | `encryptSessionPackage(payload, meta)` + persist `encryptedDataKey/keyVersion/kmsKeyId` to row | ~10 |
| `routes/session.ts:239-243` — `/session/package` decrypt (pending) | `decryptPayload(..., config.A2A_SESSION_SECRET, aad)` | `decryptSessionPackage(row, meta)` | ~5 |
| `routes/session.ts:254` — `/session/package` re-encrypt (active) | same as init encrypt | `encryptSessionPackage(...)` + update the three new columns in the same `UPDATE` | ~6 |
| `routes/mcp-proxy.ts:63-74` — `callMcpTool` decrypt | `buildSessionAAD(...)` + `decryptPayload(...)` | `decryptSessionPackage(active, meta)` | ~8 |
| `routes/profile.ts:51-61` — `callMcpTool` decrypt | same | same | ~8 |
| `routes/delegation.ts:57-67` — `/delegation/mint` decrypt | same | same | ~8 |
| `routes/onchain-redeem.ts:210-213` — `loadActiveSessionPackage` | `decryptPayload(..., config.A2A_SESSION_SECRET)` **(no AAD today — see note)** | `decryptSessionPackage(row, meta)` | ~6 |
| `routes/session-meta.ts:89-94` — `/session/:id/status` rootGrantHash recovery | `decryptPayload(..., config.A2A_SESSION_SECRET)` **(no AAD today)** | `decryptSessionPackage(row, meta)` inside the same try/catch | ~7 |

**Note on `onchain-redeem.ts:210` and `session-meta.ts:91`**: both currently call `decryptPayload` without AAD — they predate the Hardening §1.5 #8 fix on the other paths. Routing them through `decryptSessionPackage` *closes the AAD gap as a side effect of the KMS migration*. The new helper always builds and passes the AAD; there is no path through it that decrypts without context binding. Mention this in the K3 PR description — it's a quiet defense-in-depth win.

Total lines touched across all six route files: ~60. The encryption logic itself is concentrated in the new ~120-line `auth/encryption.ts` (helper + provider selector + zeroising).

---

## 7. Migration / cutover

**Strategy: invalidate-on-cutover** with a bounded legacy decrypt path. Same pattern as Stream C's AAD migration (Hardening §1.5 #8 — pre-AAD rows simply expire and re-issue). The `keyVersion` column extends that pattern by carrying the provenance tag explicitly rather than letting it be implicit.

Mechanics:
1. **K3 cutover PR** lands the schema migration, the helper, and the call-site swaps. Newly inserted sessions get `keyVersion='local-v1'` (or `'aws-kms:...'` in prod after K2 is enabled). Existing sessions remain `keyVersion='legacy'` until they expire.
2. **Legacy rollback hatch**: `decryptLegacy()` in `auth/encryption.ts` routes any row with `keyVersion='legacy'` through `config.A2A_SESSION_SECRET` directly. This path stays alive for 30 days post-cutover.
3. **Removal**: T+30 days PR deletes `decryptLegacy` and changes the helper to reject `keyVersion='legacy'` with `error: 'session sealed under retired key — please re-authenticate'`. Add a CI assertion in `scripts/check-no-bypass.sh` that the helper has no `decryptLegacy` fallback after this PR.

**Rollback procedure if a KMS misconfiguration blocks production decrypts**:
1. Cannot fall back to `A2A_KMS_BACKEND=local-aes` post-K2, because (a) in production the startup check refuses it, and (b) even if forced, sessions written with `keyVersion='aws-kms:...'` will fail to decrypt because the provider mismatch is enforced by `decryptSessionPackage` and by the local-aes provider's keyVersion assertion. This is by design — silent provider fall-through is the failure mode we are eliminating.
2. Roll forward by fixing the KMS issue (OIDC trust policy, IAM grant, key state, region mismatch). The Vercel project's OIDC issuer URL and the AWS IAM identity provider's thumbprint are the two most common failure points; document both in the runbook.
3. If KMS is unrecoverable, set the `sessions` table's `status='revoked'` for every `keyVersion LIKE 'aws-kms:%'` row and force re-authentication. The session-package data is small and re-derivable from a fresh `/session/init` + `/session/package` round-trip; no user data is lost (user data lives in MCP stores, not in the session package).
4. Documented in `docs/architecture/runbooks/kms-rollback.md` (created during K2 rollout).

**Why not dual-key parallel decrypt?** It defeats the IAM invariant: a config that can decrypt both `legacy` and `aws-kms` rows would have to hold both `A2A_SESSION_SECRET` and `kms:Decrypt` access simultaneously, doubling the blast radius during the window. The 30-day expiry is short enough that "invalidate and re-issue" is operationally cheaper.

---

## 8. Authorization template

The a2a-agent runtime principal is assumed only via OIDC federation from the project's Vercel deployment. Trust binding pins the role/policy to specific `sub` and `aud` claims so a leaked role/policy identifier is useless without the signed OIDC token.

### 8.1 AWS IAM template (primary — K2 v1 prod target)

The AWS KMS setup is three artifacts: a **role trust policy** that gates `AssumeRoleWithWebIdentity`, a **role permissions policy** that gates the KMS operations, and a **key policy** on the CMK that authorises the role. All three are required — AWS evaluates IAM identity policies AND key policies for KMS operations.

#### Role trust policy

The trust policy MUST bind the role to the Vercel OIDC issuer with `sub` and `aud` claim conditions — a leaked role ARN is then useless without a signed Vercel JWT whose claims match.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "VercelOidcFederation",
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::111122223333:oidc-provider/oidc.vercel.com/<TEAM_SLUG>"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "oidc.vercel.com/<TEAM_SLUG>:aud": "https://vercel.com/<TEAM_SLUG>",
          "oidc.vercel.com/<TEAM_SLUG>:sub": "owner:<TEAM_SLUG>:project:<PROJECT_ID>:environment:production"
        }
      }
    }
  ]
}
```

`MaxSessionDuration` on the role is set to 900 (15 min) — the minimum AWS supports for `AssumeRoleWithWebIdentity` and the floor we adopt across providers.

#### Role permissions policy

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "A2AAgentSessionKeyOps",
      "Effect": "Allow",
      "Action": [
        "kms:GenerateDataKey",
        "kms:Decrypt",
        "kms:DescribeKey"
      ],
      "Resource": "arn:aws:kms:us-east-1:111122223333:key/9a8b7c6d-1234-5678-90ab-cdef01234567",
      "Condition": {
        "ForAnyValue:StringEquals": {
          "kms:EncryptionContextKeys": [
            "session_id_h",
            "account_address",
            "chain_id",
            "expires_at",
            "key_version"
          ]
        },
        "Null": {
          "kms:EncryptionContext:session_id_h": "false",
          "kms:EncryptionContext:account_address": "false",
          "kms:EncryptionContext:chain_id": "false",
          "kms:EncryptionContext:expires_at": "false",
          "kms:EncryptionContext:key_version": "false"
        }
      }
    },
    {
      "Sid": "DenyKeyMaterialExfiltration",
      "Effect": "Deny",
      "Action": [
        "kms:GetParametersForImport",
        "kms:ImportKeyMaterial",
        "kms:DeleteImportedKeyMaterial",
        "kms:ScheduleKeyDeletion",
        "kms:DisableKey",
        "kms:PutKeyPolicy"
      ],
      "Resource": "*"
    }
  ]
}
```

#### Key policy on the CMK

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "EnableRootAccountForKeyAdmin",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::111122223333:root" },
      "Action": "kms:*",
      "Resource": "*"
    },
    {
      "Sid": "AllowA2AAgentRuntimeOnly",
      "Effect": "Allow",
      "Principal": { "AWS": "arn:aws:iam::111122223333:role/a2a-agent-runtime" },
      "Action": [ "kms:GenerateDataKey", "kms:Decrypt", "kms:DescribeKey" ],
      "Resource": "*"
    },
    {
      "Sid": "DenyAllOtherPrincipals",
      "Effect": "Deny",
      "NotPrincipal": {
        "AWS": [
          "arn:aws:iam::111122223333:role/a2a-agent-runtime",
          "arn:aws:iam::111122223333:root"
        ]
      },
      "Action": [ "kms:Decrypt", "kms:GenerateDataKey", "kms:ReEncrypt*" ],
      "Resource": "*"
    }
  ]
}
```

The `Null` condition on `kms:EncryptionContext:*` forces every key-relevant operation to include the five context keys — a call without them is denied at the IAM layer before it reaches our code's verification.

CloudTrail logs every `kms:Decrypt` call with the full `EncryptionContext`; Phase 1D wires those events to the unified audit pipeline.

### 8.2 Vault ACL policy (sibling — for the future Vault Transit alternative)

If a deployment later chooses Vault Transit over AWS KMS (§3.2b), the equivalent Vault setup is two artifacts: an **ACL policy** that gates the Transit operations, and an **OIDC role** that the Vercel-issued JWT exchanges into. Both live under HCP Vault's `admin` namespace.

#### Vault ACL policy `smart-agent-a2a`

```hcl
# Datakey + decrypt for the session-encryption transit key.
path "transit/datakey/plaintext/smart-agent-session-encryption" {
  capabilities = ["update"]
}
path "transit/decrypt/smart-agent-session-encryption" {
  capabilities = ["update"]
}

# Future K4 asymmetric signing target. NOTE: Vault Transit's native secp256k1
# support is unverified at the time of writing — the K4 implementation may
# require a different curve plus on-chain owner migration when targeting Vault.
# path "transit/sign/smart-agent-master-eoa-<curve>" {
#   capabilities = ["update"]
# }

# Future K3-extension HMAC target.
# path "transit/hmac/smart-agent-service-auth" {
#   capabilities = ["update"]
# }
```

#### Vault OIDC role `smart-agent-a2a`

```json
{
  "user_claim": "sub",
  "allowed_redirect_uris": [],
  "bound_audiences": ["smart-agent-prod"],
  "bound_subject": "owner:<your-vercel-team>:project:<your-project>:environment:production",
  "token_policies": ["smart-agent-a2a"],
  "token_ttl": "900",
  "token_max_ttl": "900"
}
```

The `bound_subject` and `bound_audiences` are the load-bearing security controls — same shape as the AWS IAM `StringEquals` conditions in §8.1. Token TTL is capped at 900 seconds (15 min) — the same floor we keep on AWS for consistency.

---

## 9. Tests

Test files are colocated next to the code they cover, matching existing conventions in `packages/sdk/src/__tests__/`.

### 9.1 local-aes provider unit tests (K1)
`packages/sdk/src/__tests__/key-custody/local-aes.test.ts`:
- Round-trip: generate → decrypt with matching context returns same 32 bytes.
- Context mismatch rejects: generate with `{accountAddress:'0xA...'}`, decrypt with `{accountAddress:'0xB...'}` → recovered key bytes differ; downstream AES-GCM tag fails.
- Salt determinism: same context + same salt → same data key.
- keyVersion stable: returns `'local-v1'` across instances.
- Empty `A2A_SESSION_SECRET` rejected at construction.

### 9.2 aws-kms provider unit tests (K2)
`apps/a2a-agent/test/aws-kms-provider.test.ts` using `aws-sdk-client-mock`. Tests live in a2a-agent/test/ rather than sdk/__tests__/ so the test-only `aws-sdk-client-mock` devDependency stays out of the sdk package — the sdk publishes only the implementation; the mocking is co-located with the integration code that wires it. Coverage:
- Round-trip: `GenerateDataKey` happy path returns matching `Plaintext` + `CiphertextBlob`; `Decrypt` happy path returns original `Plaintext`.
- `EncryptionContext` forwarded verbatim on both commands (spy on command input).
- `InvalidCiphertextException` on `Decrypt` → mapped to `Error('context mismatch (KMS denied decrypt)')`.
- `ThrottlingException` once then success → SDK middleware retries; no custom loop in the provider.
- Network / abort → mapped to `Error('kms unreachable')`.
- `keyVersion` derived synchronously from the key ARN UUID suffix; consistent across encrypt/decrypt.
- Provider rejects missing or malformed `AWS_REGION` / `AWS_ROLE_ARN` / `AWS_KMS_KEY_ID` at construction.

### 9.3 Encryption helper unit tests (K3)
`apps/a2a-agent/src/__tests__/auth/encryption.test.ts`:
- Round-trip with local-aes; round-trip with mocked aws-kms.
- Legacy decrypt path returns original payload.
- keyVersion mismatch rejected.
- Plaintext data key zeroised (assert `Buffer.compare(buf, Buffer.alloc(32)) === 0`).

### 9.4 Integration tests (K3)
`apps/a2a-agent/src/__tests__/integration/session-kms.test.ts`:
- Full round trip with local-aes: init → package → mcp tool call. Assert `sessions.key_version='local-v1'`.
- Tamper `key_version` → 401 + audit row.
- Tamper `account_address` → 401 (AAD trip-wire).
- Tamper `expires_at` → 401.
- Tamper `encrypted_data_key` → 401.
- Legacy row decryptable during the 30-day window; inverted after T+30d removal.

### 9.5 Negative: missing env
`apps/a2a-agent/src/__tests__/integration/kms-config.test.ts`:
- `NODE_ENV='production'` + `A2A_KMS_BACKEND='local-aes'` → process exits at startup.

---

## 10. Rollout sequence

K0+K1 has already landed; the new ordering is below. K3 is **already complete** as a side effect of K0+K1's call-site refactor — the encryption helper plus the `keyVersion`-driven routing in `decryptSessionPackage` is exactly the K3 deliverable; no separate PR is required to "do K3". K4–K7 are flagged Phase 2 and not budgeted here.

### PR-1: K0 + K1 (interface + local-aes + schema migration + helper + call-site swap) — **LANDED**
Cloud-independent. Lands the entire dev-mode story.

- New files:
  - `packages/sdk/src/key-custody/types.ts` — `A2AKeyProvider` interface from §2.1.
  - `packages/sdk/src/key-custody/local-aes-provider.ts` — §3.1.
  - `packages/sdk/src/key-custody/index.ts` — barrel.
  - `apps/a2a-agent/src/auth/key-provider.ts` — selector from §5.
  - `apps/a2a-agent/src/auth/encryption.ts` — §5.
  - `apps/a2a-agent/drizzle/00XX_kms_columns.sql` — §4.
- Behaviour: identical to today for any new session (HKDF-derived key over the same env secret). Old sessions decrypt via `keyVersion='legacy'` branch.

### PR-2: K2 (AWS KMS + Vercel OIDC provider) — **THIS PR**
- New files:
  - `packages/sdk/src/key-custody/aws-kms-provider.ts` — §3.2a.
  - `apps/a2a-agent/test/aws-kms-provider.test.ts` — mock-AWS unit tests via `aws-sdk-client-mock` (devDependency of a2a-agent, not the sdk).
- Modified files:
  - `apps/a2a-agent/src/auth/key-provider.ts` — wires the `'aws-kms'` branch; keeps `'vault-transit'` throwing "not yet implemented (K2-alt sibling)".
  - `packages/sdk/package.json` — adds `@aws-sdk/client-kms` and `@vercel/oidc-aws-credentials-provider` dependencies.
  - `packages/sdk/src/key-custody/index.ts` — barrel adds `createAwsKmsProvider` + `AwsKmsEnv`.
  - `packages/sdk/src/index.ts` — adds the same to the main SDK re-exports.
  - `apps/a2a-agent/package.json` — adds `aws-sdk-client-mock` as devDependency.
  - `apps/a2a-agent/.env.example` — AWS env-var placeholders.
  - `apps/a2a-agent/src/config.ts` — fail-fast validation when `A2A_KMS_BACKEND=aws-kms`.
  - `docs/architecture/01-web-a2a-mcp-flows.md` — note that `packages/sdk/src/key-custody/aws-kms-provider.ts` is the only file allowed to import `@aws-sdk/client-kms` (cross-checked by the generalized `check:bypass` guard).
- Behaviour: behind the `A2A_KMS_BACKEND='aws-kms'` flag; CI tests still run against `local-aes`. CI gets a mock-AWS test suite only (no real AWS account).
- Exit criterion: `pnpm -r typecheck`, `pnpm check:bypass`, `pnpm --filter @smart-agent/sdk test`, and `pnpm --filter @smart-agent/a2a-agent test` all pass; a manual `staging` deploy on Vercel can roundtrip a session through real AWS KMS via OIDC federation.

### PR-3: AWS infra setup + runbook
- New files:
  - `infra/aws/kms-key.tf` (Terraform — creates the CMK with the §8.1 key policy).
  - `infra/aws/oidc-role.tf` (Terraform — creates the IAM role + trust policy + permissions policy from §8.1).
  - `infra/aws/oidc-provider.tf` (Terraform — registers the Vercel OIDC issuer as an IAM Identity Provider).
  - `docs/architecture/runbooks/kms-rollback.md`.
- Tests: an integration test that asserts the Terraform-rendered IAM policy matches §8.1 (golden-file diff).
- Exit criterion: a fresh AWS account stood up entirely from Terraform produces a working a2a-agent with `A2A_KMS_BACKEND='aws-kms'` and no static AWS credentials in env.

### PR-4: Production cutover (K2 enabled in prod)
- Single-config change in production env: `A2A_KMS_BACKEND=aws-kms`, `AWS_REGION=us-east-1`, `AWS_ROLE_ARN=arn:aws:iam::...`, `AWS_KMS_KEY_ID=arn:aws:kms:...`. **Remove** `A2A_SESSION_SECRET` from prod env after the 30-day legacy window closes.
- Monitor for 30 days:
  - CloudTrail filtered to the KMS CMK, alerting on any `AccessDenied` event.
  - `executionAudit` query: kms-prefixed denials should be 0.
  - p99 latency on `/session/package` < 200ms when colocated with the KMS region.

### PR-5 (T+30 days): remove legacy decrypt branch
- Delete `decryptLegacy` from `apps/a2a-agent/src/auth/encryption.ts`.
- Invert the legacy integration test to assert rejection.
- Extend `scripts/check-no-bypass.sh` to fail CI if `decryptLegacy` is referenced anywhere in `apps/a2a-agent/src/`.

### K2-alt (deferred — only if a team adopts Vault Transit)
- Existing file: `packages/sdk/src/key-custody/vault-transit-provider.ts` (already in tree from an earlier iteration; documented sibling).
- Existing file: `apps/a2a-agent/src/auth/vault-oidc-token-exchange.ts` (Vercel OIDC token discovery; mirrors the AWS path).
- Modified file: `apps/a2a-agent/src/auth/key-provider.ts` — flip the `'vault-transit'` branch from "not yet implemented" to `return createVaultTransitProvider(...)`.
- Verify secp256k1 support on the deployed Vault Transit version before targeting K4 to Vault.
- Same call sites; same `A2AKeyProvider` contract. Zero changes outside the provider file and the selector.

### Phase 2 PRs (K4–K7) — deferred, sketched in §11. The K4 prompt is in §16.

---

## 11. What this does NOT do (Phase 2 work: K4–K7)

K0–K3 are a custody-of-the-data-key change. They do **not** address:

- **K4 — Master EOA private key custody**: `config.A2A_MASTER_EOA_PRIVATE_KEY` (`apps/a2a-agent/src/config.ts:70`) is still loaded as a hex env var and used to sign ERC-4337 `handleOps` in `onchain-redeem.ts:1226`. K4 replaces it with an asymmetric KMS-backed signer via the optional `signA2AAction` method on `A2AKeyProvider`. AWS KMS asymmetric `Sign` with `KeySpec=ECC_SECG_P256K1` is the implementation; the canonical message that gets signed must include all binding metadata (see §13) because KMS does not support encryption context on asymmetric operations.

- **K5 — Tool-executor key custody**: per-tool sub-delegated path keys live in env today (`TOOL_EXECUTOR_*_PRIVATE_KEY`). K5 migrates them to either (a) KMS-wrapped envelope encryption like the session table, or (b) direct asymmetric `kms:Sign` if the tool's signing surface is narrow. Decision per-tool.

- **K6 — Deployer key removal from runtime**: `DEPLOYER_PRIVATE_KEY` should never be in a runtime env. K6 removes it entirely. Forge deploys move to CI/CD only and use the same OIDC federation pattern: GitHub Actions OIDC → AWS STS → role with `kms:Sign` on a deployer asymmetric key. Runtime env carries no deployer credential at all.

- **K7 — Audit, alerts, revocation, replay protection**: end-to-end visibility plus emergency stop buttons. (a) Phase 1D's `executionAudit` ingests CloudTrail `kms:Decrypt` / `kms:Sign` events keyed by correlationId. (b) CloudWatch alarm on `AccessDenied` events. (c) Revocation surface: the role's permission policy can be tightened or the CMK disabled via Terraform within seconds. (d) Replay protection: the `replay-nonce.ts` table already exists for service-auth; K7 extends it to cover `signA2AAction` calls — each action carries a JTI; duplicate JTIs within the TTL window are rejected.

- **In-process compromise**: an attacker who pops the a2a-agent process can still ask KMS to decrypt any session row or sign any UserOp. The KMS layer does not stop this. **The langchain-in-a2a sandbox sub-process design from HARDENING-PLAN §4.1 is the answer to live runtime compromise.** KMS + OIDC alone does not defend a pwned a2a-process from invoking permitted crypto operations; the process boundary does.

- **Cross-service KMS**: org-mcp, person-mcp, hub-mcp each hold service-auth HMAC secrets and (eventually) their own at-rest data. The `A2AKeyProvider` interface is portable; rolling it out to MCPs is a Phase 2 task with the same shape but independent IAM grants.

Frame these as "the threats KMS *alone* does not address" — not as gaps in this plan. The K4–K7 sequence plus the langchain-sandbox design completes the picture.

---

## 12. Senior-architect Q&A

| Question | Answer |
|---|---|
| **Does the app depend on AWS KMS?** | No. The app depends on the `A2AKeyProvider` interface (§2.1). AWS KMS is the v1 implementation that satisfies the interface; HCP Vault Transit is a documented sibling alternative that would satisfy it equally. The framing is provider-neutral; the binding to AWS lives in one file (`packages/sdk/src/key-custody/aws-kms-provider.ts`) and one selector branch (`apps/a2a-agent/src/auth/key-provider.ts`). |
| **Why AWS KMS over Vault Transit as the v1 implementation?** | Five concrete reasons: (1) **Vercel SDK integration is a one-liner** — `awsCredentialsProvider({ roleArn })` from `@vercel/oidc-aws-credentials-provider` handles the OIDC→STS exchange with no boilerplate. (2) **secp256k1 native** — AWS KMS supports `KeySpec=ECC_SECG_P256K1` for K4 EVM signing; Vault Transit's secp256k1 support is unverified at the time of writing (official documented signing curves: ecdsa-p256/p384/p521/ed25519/RSA), so adopting Vault for K4 would risk an on-chain owner migration to a non-EVM curve. (3) **Dedicated HMAC keys** — AWS KMS supports `KeySpec=HMAC_256` with `GenerateMac`/`VerifyMac` for the K3-extension service-auth replacement, no AES-GCM workaround needed. (4) **Audit / review fluency** — every senior architect on the review chain has signed off on AWS KMS production deployments before; Vault Transit is less familiar surface for our review process. (5) **Lower operational footprint** — one IAM role + one CMK, no separately operated cluster or namespace, free at our request volume. |
| **Can we switch to Vault Transit later?** | Yes — that's exactly the layering payoff of K0. The `A2AKeyProvider` interface is the integration boundary. Only `buildKeyProvider`'s `'vault-transit'` branch flips from `throw 'not yet implemented'` to `return createVaultTransitProvider(...)`. The provider file already exists (§3.2b). **No call-site changes.** The migration cutover plan in §7 (invalidate-on-cutover) applies symmetrically. |
| **What if AWS KMS is down?** | a2a-agent fails closed: 503 on new `/session/init` and on existing session reads. `local-aes` fallback is NOT permitted in production — the startup check in `buildKeyProvider` refuses it. AWS KMS multi-AZ SLA (99.999%) exceeds our app's SLA (99.9% target); KMS being down strictly implies a region-level AWS outage which is the same shape as "Postgres is down". The 5-second `AbortController` timeout in the provider bounds the failure latency. |
| **Why envelope rather than KMS-encrypts-payload?** | AWS KMS direct `Encrypt` has a 4 KB payload limit; session packages can exceed it. Envelope keeps the AES-GCM ciphertext on disk and only the wrapped data key transits the KMS, shrinking the oracle surface. One backend call per session lifecycle, amortised across reads/writes. Same argument applies to Vault Transit. |
| **Why not HSM directly?** | AWS KMS is backed by FIPS 140-2 Level 3 HSMs we don't have to operate. Self-running an HSM means key ceremonies, PKCS#11, keystore HA. The managed-KMS abstraction is the right level; the interface seam at §2.1 means a future HSM swap is a single provider file. |
| **What if a2a-agent process is compromised?** | Out of scope for K0–K3. The attacker holds the STS-derived AWS credentials' identity so KMS operations succeed for the configured CMK. Mitigations: short session TTLs, caveats (target/method/value), CloudTrail anomaly detection, sandbox sub-process for langchain (Hardening §4.1), unified audit (Phase 1D). |
| **What if a leaked .env decrypts production data?** | A leaked .env should not contain cryptographic secrets or static credentials. It may reveal routing identifiers (`AWS_REGION`, `AWS_ROLE_ARN`, `AWS_KMS_KEY_ID`). The real controls are: strict OIDC trust binding (IAM role's `sub` + `aud` `StringEquals` conditions scoped to this Vercel project + environment), least-privilege IAM permissions with the `kms:EncryptionContextKeys` + `Null` conditions enforcing AAD presence at the IAM layer, and short-lived STS credentials (`MaxSessionDuration: 900`). |
| **What if `AWS_ROLE_ARN` leaks?** | It's an identifier, not a secret. The IAM role MUST be conditioned on `oidc.vercel.com/<team>:sub` matching `owner:<team>:project:<project>:environment:production` and on `oidc.vercel.com/<team>:aud` matching the configured Vercel audience. Without those claim bindings, the role is useless — `AssumeRoleWithWebIdentity` requires a signed Vercel JWT whose claims match the trust policy's conditions. |
| **Why not Cloudflare Workers + Workers KV-encrypted secrets?** | Workers KV is secret storage, not envelope encryption with per-record key derivation. It has no per-key access policy, no audit log keyed to operations, no context-binding analogue. The CF Worker path is viable only by federating to a real KMS (AWS or Vault), and that federation requires a verified trust policy we haven't built yet — so Vercel is the v1 deployment target. (See §3.5.) |
| **Why not rotate the data key on every read?** | Re-wrapping requires plaintext — same threat profile as decrypt. Rotation is bounded by session TTL (≤7 days medium-tier). AWS KMS supports automatic annual rotation on symmetric CMKs; we will enable it post-K7. New writes pick up the new key material automatically; old ciphertexts continue to decrypt because AWS tracks rotation versions internally and identifies the version from `CiphertextBlob`. |
| **What about replay of context?** | The context includes `sessionId` (UUID), `expiresAt`, `keyVersion`. Replaying an old context against a different row's ciphertext gets `InvalidCiphertextException` from KMS (context mismatch). Within-row replay is the legitimate flow. |
| **Why include `keyVersion` in the context if `keyId` already identifies the key?** | `keyId` is informational; `keyVersion` is the provider tag for decrypt routing. Binding it means an attacker swapping a `local-v1` row into an `aws-kms:<uuid>` slot (or vice-versa) gets a KMS rejection rather than silent fall-through. |
| **Is the local-aes provider a backdoor?** | No. Production startup refuses it (§9.5). The `'local-v1'` keyVersion tag is visible in every audit row. |

---

## 13. Encryption-context applies to symmetric encryption ONLY

This section is the critical caveat that bears on K2 (envelope encryption) versus K4 (asymmetric signing) versus K3-extension (HMAC).

**AWS KMS `EncryptionContext` (and HCP Vault Transit's equivalent `context`) bind a context tuple to ciphertext on symmetric encryption operations only.** The binding is cryptographic (it appears in the cipher's MAC) and verified at decrypt time — the backend refuses to decrypt unless the context bytes match what was used at encrypt time. The context itself is **non-secret** (it appears in plaintext in audit logs) and **non-confidential** — its job is authentication binding, not concealment.

**Neither backend supports context binding on asymmetric operations** (`kms:Sign`/`Verify`) **or on HMAC operations** (`kms:GenerateMac`/`VerifyMac`). Trying to pass a context on those operations is rejected by the API.

Consequences for each phase:

### K3 session envelope encryption — symmetric, context binding applies
The data key is a 256-bit AES-256 symmetric key generated by `kms:GenerateDataKey` (AWS — primary) or `transit/datakey/plaintext` (Vault — sibling). The data key itself is wrapped under the CMK / transit symmetric key. Both backends accept an `EncryptionContext` (AWS) / `context` (Vault) parameter on datakey-generation and decrypt. We use the tuple `{sessionId, accountAddress, chainId, expiresAt, keyVersion}` and bind it on both layers:
- KMS layer: `EncryptionContext` on the wrapping symmetric key (AWS); `context` (Vault sibling).
- AES-GCM layer: same tuple via `buildSessionAAD` → `additionalData` on the AES key (`packages/sdk/src/crypto.ts:71-99`).

Tampering with any of the five fields breaks both layers independently. Two trip-wires.

### K4 asymmetric signer — encryption context not available
The master EOA signer (and tool-executor signers in K5) use asymmetric KMS keys with `KeySpec=ECC_SECG_P256K1` for secp256k1 ECDSA. `kms:Sign` does **not** accept `EncryptionContext`. Instead, the message being signed MUST include all binding metadata in its canonical form, and the verifier MUST verify both the signature AND that the canonical metadata matches the expected operation.

Canonical message shape:
```
canonicalPayload =
  'sa:sign:v1' || domain || sessionId || accountAddress || chainId || actionId || keccak256(opPayload)
```

Where:
- `'sa:sign:v1'` is a domain-separation prefix (replace if we ever change the canonicalization).
- `domain` is the EIP-712 domain hash (chainId + verifying contract + name + version) for the account.
- `sessionId`, `accountAddress`, `chainId`, `actionId` are the binding tuple.
- `opPayload` is the UserOp / call-data being signed.

The verifier (in our code path: the on-chain `validateUserOp` or off-chain `recoverSigner` plus the caveat chain) reconstructs `canonicalPayload` from the operation context and checks the recovered signer against the expected master EOA address.

Defense-in-depth surfaces (instead of EncryptionContext):
- **IAM**: `kms:Sign` on the master signer key restricted to the a2a-agent role only, with action conditions on `kms:RequestAlias` or `kms:ResourceAliases` matching the expected key alias.
- **Signer-service policy**: a thin `a2aSigner.sign()` wrapper in `apps/a2a-agent/src/auth/` is the only caller of `signA2AAction`. It refuses to sign any payload whose `'sa:sign:v1'` prefix is absent or whose `actionId` is missing.
- **Audit**: every `kms:Sign` call lands in CloudTrail with the full request envelope (KeyId, MessageType, SigningAlgorithm); Phase 1D ingests these by correlationId.
- **Per-key allowlists**: separate KMS keys per signing role (master EOA, per-tool executors). Compromising one key does not pivot to another.

### K3-extension HMAC via KMS — encryption context not available
KMS HMAC keys (`KeySpec=HMAC_256`, etc.) are the documented replacement for `WEB_TO_A2A_HMAC_KEY`, `A2A_INTERSERVICE_HMAC_KEY_*` env vars. `kms:GenerateMac` does **not** accept `EncryptionContext`. The canonical MAC message MUST include the binding tuple:
```
canonicalMessage =
  timestamp || nonce/JTI || audience || route || method || sha256(body)
```

Verifier reconstructs `canonicalMessage` from request fields and calls `kms:VerifyMac` (which compares constant-time on the KMS side). The existing `hmacVerify` helper in `packages/sdk/src/crypto.ts:197-206` becomes a thin wrapper over `kms:VerifyMac` for service-auth routes.

Defense-in-depth surfaces:
- IAM: separate KMS HMAC keys per service pair (`web↔a2a`, `a2a↔person-mcp`, …), each scoped to two principals.
- Replay nonce cache (already specced in Hardening §1.5 #10): JTI + timestamp window prevent replay even if the MAC verifies.
- Audit on every `kms:GenerateMac` and `kms:VerifyMac` call via CloudTrail.

The takeaway: **EncryptionContext is a symmetric-encryption convenience. For sign/verify and HMAC operations, all binding metadata must live inside the message itself, and IAM + audit + per-key separation do the rest.**

---

## 14. Production target — env-var table (canonical)

This is the shape of production env at end-of-K7. Anything marked REMOVED must not appear in any runtime env file; CI fails the deploy if it does.

```
A2A_SESSION_SECRET           [REMOVED in prod; replaced by KMS data-key generation]
AWS_ACCESS_KEY_ID            [NEVER PRESENT; OIDC federation provides creds via STS]
AWS_SECRET_ACCESS_KEY        [NEVER PRESENT; OIDC federation provides creds via STS]
A2A_MASTER_EOA_PRIVATE_KEY   [REMOVED; replaced by KMS asymmetric sign in K4]
DEPLOYER_PRIVATE_KEY         [DEPLOY-TIME ONLY; never in runtime env; CI/CD via OIDC]
TOOL_EXECUTOR_*_PRIVATE_KEY  [REMOVED in K5; KMS-wrapped or asymmetric sign]
A2A_INTERSERVICE_HMAC_KEY_*  [REMOVED in K3-ext; kms:GenerateMac]
WEB_TO_A2A_HMAC_KEY          [same as above]

KEPT in prod — v1 (AWS KMS, all non-secret identifiers):
A2A_KMS_BACKEND=aws-kms         [v1 prod; or local-aes / vault-transit (future)]
AWS_REGION                      [routing; e.g. us-east-1]
AWS_ROLE_ARN                    [trust identifier, not a secret — see §12]
AWS_KMS_KEY_ID                  [key ARN, not a secret]
VERCEL_OIDC_TOKEN               [auto-injected by Vercel at request scope]

KEPT in prod — sibling (only when A2A_KMS_BACKEND=vault-transit, see §3.2b):
VAULT_ADDR                      [URL; e.g. https://<cluster>.hashicorp.cloud:8200]
VAULT_NAMESPACE                 [HCP namespace; usually 'admin']
VAULT_TRANSIT_KEY               [transit key name; e.g. 'smart-agent-session-encryption']
VAULT_OIDC_ROLE                 [Vault role name; e.g. 'smart-agent-a2a']
```

Between phases the table is partial: at end-of-K3 only `A2A_SESSION_SECRET` is removed (the rest still live in env). At end-of-K4 `A2A_MASTER_EOA_PRIVATE_KEY` joins the REMOVED list. Etc. The final state is the table above.

A leaked .env at any phase reveals only what is in the KEPT section: routing identifiers. The OIDC trust policy and IAM permissions policy are the real security boundary.

---

## 15. Summary of changes vs prior version

This revision flips the framing from "Vault Transit primary, AWS sibling" to **provider-neutral with AWS KMS as v1 implementation target, Vault Transit as documented sibling**. The K0 `A2AKeyProvider` interface is unchanged — the substrate decision is contained to one provider file and one selector branch.

1. **Framing — provider-neutral**: the application now formally depends on the `A2AKeyProvider` interface, not on any specific KMS backend. The header and §1 explicitly state: AWS KMS is the v1 implementation chosen because it satisfies envelope encryption + OIDC federation + HMAC + EVM-compatible asymmetric signing with the smallest operational footprint. Vault Transit remains a documented sibling for future flexibility. (§3.2 parent header; §3.2a primary; §3.2b sibling.)
2. **K2 v1 implementation target is AWS KMS**: §3.2a is now AWS KMS + Vercel OIDC; §3.2b is Vault Transit + Vercel OIDC marked "future / alternative" with the explicit curve-gap caveat (Vault Transit's secp256k1 support for K4 is unverified at the time of writing).
3. **AWS-primary motivation**: §3.2a and the §12 Q&A lay out the five concrete reasons — Vercel SDK one-liner, secp256k1 native, dedicated HMAC keys, audit/review fluency, lower operational footprint.
4. **§8 reordering**: §8.1 is now the AWS IAM template (primary); §8.2 is the Vault ACL policy (sibling). Both stay in the spec — the substrate change requires only swapping which one a deployment uses.
5. **§14 env-var table**: AWS as the primary KEPT block (`A2A_KMS_BACKEND=aws-kms`, `AWS_REGION`, `AWS_ROLE_ARN`, `AWS_KMS_KEY_ID`, `VERCEL_OIDC_TOKEN`); Vault as the sibling KEPT block (only when `A2A_KMS_BACKEND=vault-transit`).
6. **§10 rollout**: PR-2 is the AWS KMS provider (this PR). PR-3 is AWS Terraform infra. K2-alt is the Vault Transit branch flip, deferred / documented. K3 is already complete via K0+K1's call-site refactor.
7. **§12 Q&A**: replaced the "Why Vault over AWS?" question with "Does the app depend on AWS KMS?" (no — provider-neutral) and "Why AWS KMS over Vault Transit as the v1 implementation?" (five reasons). All operational Q&A points are re-framed against AWS KMS terminology (CloudTrail, STS, `InvalidCiphertextException`, `AssumeRoleWithWebIdentity`).
8. **§13 encryption-context stratification**: unchanged in substance — context binding still applies to symmetric encryption only; K4 asymmetric and K3-extension HMAC still need binding metadata in the canonical message.
9. **§16 next prompt**: replaced the K2 (Vault) implementation prompt with a K4 (AWS KMS asymmetric signing) sketched prompt — the next significant phase after K2 lands. Full K4 specification is deferred to its own document because EVM signing complexity (DER decode, low-s norm, recovery id, address derivation, chainId binding, on-chain owner migration) warrants dedicated treatment.

The §2.1 interface, the AAD design, the schema migration shape, and the legacy-rollback hatch are unchanged from the prior revision. This is a substrate re-targeting with provider-neutral framing, not a rewrite.

---

## 16. Next implementation step — sub-agent prompt for K4 (AWS KMS asymmetric signing)

K0+K1+K2 have landed; the K3 call-site refactor was merged into K0+K1. The next significant phase is **K4 — AWS KMS asymmetric signing for the A2A master EOA**, replacing `config.A2A_MASTER_EOA_PRIVATE_KEY` with a `kms:Sign` call against an `ECC_SECG_P256K1` CMK. **This sketch is intentionally minimal**: K4 needs its own full spec document because EVM signing has multiple non-trivial complexity surfaces.

Sketched prompt:

> Implement KMS migration **K4 — AWS KMS asymmetric signer for the A2A master EOA**. Read `/home/barb/smart-agent/output/KMS-IMPLEMENTATION-PLAN.md` §11 and §13 first, then the dedicated K4 spec at `output/K4-EVM-SIGNING-SPEC.md` (to be authored before this prompt is executed — DO NOT proceed without it).
>
> **Scope (sketched — full spec needed)**:
>
> 1. Add the optional `signA2AAction` method to `packages/sdk/src/key-custody/aws-kms-provider.ts`. It calls `kms:Sign` with `SigningAlgorithm: 'ECDSA_SHA_256'` against an asymmetric CMK with `KeySpec: 'ECC_SECG_P256K1'`.
> 2. Wrap the raw DER-encoded signature output: decode DER, normalise s to low-s form (EVM requires `s <= n/2`), recover the v byte (recovery id 0 or 1 — try both, recover the address, compare to the expected master signer address derived from the public key).
> 3. Derive the master EOA address from the KMS public key at startup via `kms:GetPublicKey` + keccak-256 of the uncompressed public key (drop the 0x04 prefix, hash, take last 20 bytes). Cache the address — it does not change without a CMK rotation.
> 4. Wire the signer wrapper at `apps/a2a-agent/src/auth/a2a-signer.ts` that holds the `A2AKeyProvider` reference and exposes `signUserOp(op: PackedUserOperation)`. The wrapper is the ONLY caller of `provider.signA2AAction`.
> 5. Update `apps/a2a-agent/src/routes/onchain-redeem.ts` to call `a2aSigner.signUserOp(...)` instead of `signMessage({ privateKey: config.A2A_MASTER_EOA_PRIVATE_KEY })`.
> 6. On-chain owner migration: the SessionAgentAccount's owner address must equal the KMS-derived address. New deployments use it from the start. Existing deployments need a one-time `transferOwnership` (or its analogue on AgentAccount) signed by the old EOA, after which the old EOA private key can be discarded.
> 7. Remove `A2A_MASTER_EOA_PRIVATE_KEY` from the canonical env (§14) after the migration completes.
>
> **K4 spec must address before this prompt is run**:
> - DER signature decoding edge cases (leading-zero handling).
> - Low-s normalisation: `if (s > n/2) s = n - s; flip v`.
> - Recovery-id derivation when KMS doesn't return v: try both 0 and 1, recover the address, pick the one matching the cached master address.
> - EIP-712 typed-data vs personal_sign domain separation: which one does the UserOp validator expect?
> - chainId binding: does the validator EIP-712 domain hash include chainId? (Yes for AgentAccount; verify.)
> - On-chain owner migration procedure: who initiates it, who signs it, what's the rollback if the new public key derivation is wrong?
> - Public-key derivation: `kms:GetPublicKey` returns DER-encoded SEC1 uncompressed point; decode to raw 64 bytes (drop 0x04), keccak256, take last 20 bytes as the address.
> - IAM grant: separate the existing CMK from the signing CMK — `kms:Sign` requires its own KMS key, not the envelope-encryption one.
> - K4 IAM permissions policy: `kms:Sign`, `kms:GetPublicKey`, `kms:DescribeKey` on the master-signer CMK ARN only.
> - K4 trust policy: identical Vercel OIDC binding as the §8.1 envelope-encryption role; reuse the same role or split per principle of least privilege.
>
> **Out of scope for the K4 sub-agent**: K5 tool-executor keys (separate phase); K6 deployer key removal; K7 audit / alerts / revocation.
