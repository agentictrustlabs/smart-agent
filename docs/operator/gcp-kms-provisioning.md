# GCP Cloud KMS — Operator Provisioning Runbook (G-PR-6)

Operator-facing runbook for provisioning every GCP resource required to run
`A2A_KMS_BACKEND=gcp-kms`. Sibling of `docs/operations/kms-signer-setup.md`
(AWS path); both backends are first-class — pick one cloud per deployment
via the `A2A_KMS_BACKEND` env flip.

Reference specs:

- `output/GCP-KMS-IMPLEMENTATION-PLAN.md` — G0..G11 design (this runbook is § G10).
- `docs/architecture/principles.md` — substrate independence (P1).
- `apps/a2a-agent/src/auth/key-provider.ts` — `assertNoForbiddenStaticKeys`
  (canonical "do NOT set in prod" list).
- `apps/a2a-agent/src/lib/policy-startup.ts:assertGcpEnvComplete` — boot-time
  invariant that lists every missing identifier in one error.
- `scripts/diagnose-gcp-kms.ts` — deploy-time smoke test.

---

## Trust model

```
Vercel OIDC token
  → Google STS Workload Identity Federation
    → service-account impersonation (IAM Credentials API)
      → google-auth-library ExternalAccountClient
        → Google Cloud KMS (encrypt | asymmetricSign | macSign | macVerify)
```

The trust chain eliminates every static cloud credential at runtime. The
service account is impersonated per-request via the Vercel OIDC token bound
to the `aud` / `sub` claims, and Google STS exchanges that for short-lived
GCP access tokens. There is no JSON key file in production.

---

## Key inventory (G2..G5)

| Class | Cloud KMS key purpose | Count | Algorithm |
|---|---|---|---|
| Session envelope KEK (G2) | `ENCRYPT_DECRYPT` (symmetric) | 1 | `GOOGLE_SYMMETRIC_ENCRYPTION` |
| Master EOA signer (G3) | `ASYMMETRIC_SIGN` | 1 (+ versions) | `EC_SIGN_SECP256K1_SHA256` |
| Tool executor signers (G4) | `ASYMMETRIC_SIGN` | 5 (+ versions) | `EC_SIGN_SECP256K1_SHA256` |
| Inter-service MAC (G5) | `MAC` | 10 (+ versions) | `HMAC_SHA256` |

Tool executors (G4): `disbursement`, `round-awards`, `pool-lifecycle`,
`grant-awards`, `auth-bootstrap`. Source of truth: `TOOL_EXECUTOR_IDS` in
`packages/sdk/src/key-custody/tool-executor-signer.ts`.

MAC edges (G5): `web-to-a2a`, `a2a-to-person`, `a2a-to-org`, `a2a-to-hub`,
`a2a-to-family`, `a2a-to-geo`, `a2a-to-skill`, `a2a-to-verifier`,
`a2a-to-people-group`, `oauth-salt`. Source of truth: `MAC_KEY_IDS` in
`packages/sdk/src/key-custody/mac-provider-factory.ts`.

> Note: `a2a-to-hub` is listed for parity with the canonical MAC plan; the
> running `MAC_KEY_IDS` constant currently enumerates the other nine edges.
> Add the corresponding `GCP_KMS_MAC_*_VERSION` env var only for the edges
> active in your deployment — `assertGcpEnvComplete` derives the required
> set from `MAC_KEY_IDS` at boot.

---

## Step 1 — Pick (or create) the GCP project

| | |
|---|---|
| **Prerequisite** | A billing-enabled Google Cloud organisation; operator has `resourcemanager.projects.create` (or an existing project you'll re-use). |
| **Action** | `gcloud projects create smart-agent-prod --name="Smart Agent Prod"` (or pick an existing project id). Record the numeric project number: `gcloud projects describe smart-agent-prod --format='value(projectNumber)'`. |
| **Verification** | `gcloud config set project smart-agent-prod && gcloud projects describe smart-agent-prod` succeeds and prints both id and number. |
| **Failure mode** | If the project id is wrong, every later step fails with `PERMISSION_DENIED` or `NOT_FOUND`. `assertGcpEnvComplete` will surface the missing `GCP_PROJECT_ID` / `GCP_PROJECT_NUMBER` at boot. |

---

## Step 2 — Enable required APIs

| | |
|---|---|
| **Prerequisite** | Step 1 complete; you can `gcloud config set project ...`. |
| **Action** | `gcloud services enable cloudkms.googleapis.com iamcredentials.googleapis.com cloudresourcemanager.googleapis.com sts.googleapis.com iam.googleapis.com` |
| **Verification** | `gcloud services list --enabled` lists all five. |
| **Failure mode** | Cloud KMS calls return `SERVICE_DISABLED`. The diagnose script (`scripts/diagnose-gcp-kms.ts`) surfaces this as `IAM denied`. |

---

## Step 3 — Create the key ring

| | |
|---|---|
| **Prerequisite** | APIs enabled (Step 2). Decide on a region (e.g. `us-east1`) — every key in this runbook MUST live in the same key ring / location. |
| **Action** | `gcloud kms keyrings create smart-agent --location=us-east1` |
| **Verification** | `gcloud kms keyrings list --location=us-east1` lists `smart-agent`. |
| **Failure mode** | If you re-use a wrong region later in env vars, the runtime gets `NOT_FOUND` on every call. The diagnose script surfaces this as `key not found`. |

---

## Step 4 — Create the session envelope KEK (G2)

| | |
|---|---|
| **Prerequisite** | Key ring exists (Step 3). |
| **Action** | `gcloud kms keys create a2a-session-kek --keyring=smart-agent --location=us-east1 --purpose=encryption --rotation-period=90d --next-rotation-time=$(date -u -d '+90 days' +%Y-%m-%dT%H:%M:%SZ)` |
| **Verification** | `gcloud kms keys describe a2a-session-kek --keyring=smart-agent --location=us-east1 --format='value(purpose,versionTemplate.algorithm)'` prints `ENCRYPT_DECRYPT GOOGLE_SYMMETRIC_ENCRYPTION`. |
| **Failure mode** | Wrong purpose (`ASYMMETRIC_SIGN`) → `kms.encrypt` rejects with `FAILED_PRECONDITION`. The provider throws "GCP KMS encrypt failed" on every session-package mint. |

Resource path for `GCP_KMS_SESSION_KEK`:
```
projects/smart-agent-prod/locations/us-east1/keyRings/smart-agent/cryptoKeys/a2a-session-kek
```

---

## Step 5 — Create the master EOA signer key + version (G3)

| | |
|---|---|
| **Prerequisite** | Key ring exists (Step 3). |
| **Action** | `gcloud kms keys create master-eoa-signer --keyring=smart-agent --location=us-east1 --purpose=asymmetric-signing --default-algorithm=ec-sign-secp256k1-sha256` |
| **Verification** | `gcloud kms keys versions list --key=master-eoa-signer --keyring=smart-agent --location=us-east1` shows version `1` in `ENABLED` state. Derive the on-chain EVM address (run the diagnose script in `--verify-master-address` mode after env wiring; documented in §G10). |
| **Failure mode** | Wrong algorithm (`EC_SIGN_P256_SHA256`) → wrong curve. The signer throws at first `asymmetricSign` because the DER-decoded `r,s` won't recover to a valid secp256k1 address. |

Resource path for `GCP_KMS_MASTER_SIGNER_VERSION` (pin the SPECIFIC version, not the parent key):
```
projects/smart-agent-prod/locations/us-east1/keyRings/smart-agent/cryptoKeys/master-eoa-signer/cryptoKeyVersions/1
```

---

## Step 6 — Create the five tool executor signer keys + versions (G4)

| | |
|---|---|
| **Prerequisite** | Key ring exists (Step 3). |
| **Action** | For each `TOOL` in `disbursement round-awards pool-lifecycle grant-awards auth-bootstrap`: <br>`gcloud kms keys create tool-${TOOL} --keyring=smart-agent --location=us-east1 --purpose=asymmetric-signing --default-algorithm=ec-sign-secp256k1-sha256` |
| **Verification** | `gcloud kms keys list --keyring=smart-agent --location=us-east1 --filter='name~tool-'` lists all five. |
| **Failure mode** | A missing tool key → `assertGcpEnvComplete` lists the missing `GCP_KMS_TOOL_EXECUTOR_<TOOL>_VERSION` at boot. Wrong algorithm → first `redeem-via-account` of that tool family fails with a signature-recovery error. |

Each tool family has its own KMS key for defense in depth — a compromised
key for one family cannot sign for another. The service account's IAM
binding adds one `roles/cloudkms.signer` entry per tool key (Step 10).

Resource paths for the five env vars (one per tool):
```
GCP_KMS_TOOL_EXECUTOR_DISBURSEMENT_VERSION
GCP_KMS_TOOL_EXECUTOR_ROUND_AWARDS_VERSION
GCP_KMS_TOOL_EXECUTOR_POOL_LIFECYCLE_VERSION
GCP_KMS_TOOL_EXECUTOR_GRANT_AWARDS_VERSION
GCP_KMS_TOOL_EXECUTOR_AUTH_BOOTSTRAP_VERSION
```

---

## Step 7 — Create the inter-service MAC keys + versions (G5)

| | |
|---|---|
| **Prerequisite** | Key ring exists (Step 3). |
| **Action** | For each `EDGE` in the canonical `MAC_KEY_IDS` list (see § Key inventory): <br>`gcloud kms keys create mac-${EDGE} --keyring=smart-agent --location=us-east1 --purpose=mac --default-algorithm=hmac-sha256` |
| **Verification** | `gcloud kms keys list --keyring=smart-agent --location=us-east1 --filter='name~mac-'` shows every edge. |
| **Failure mode** | Missing edge → `assertGcpEnvComplete` lists the missing `GCP_KMS_MAC_<EDGE>_VERSION`. Wrong algorithm (`HMAC_SHA512`) → `macSign` fails at runtime with `FAILED_PRECONDITION`. |

Important: `macSign` requires the IAM role `roles/cloudkms.signer`;
`macVerify` requires `roles/cloudkms.signerVerifier`. The a2a-agent is on
BOTH sides of every MAC edge (it signs outbound and verifies inbound), so
the service account binding needs `signerVerifier` on every MAC version —
which is a superset of `signer`. See Step 10.

Env var names follow `GCP_KMS_MAC_<EDGE_UPPER>_VERSION` (where the edge
upper-cases hyphens to underscores). Full mapping is in
`envKeyForMacKeyId(macKeyId)` in `packages/sdk/src/key-custody/mac-provider-factory.ts`.

---

## Step 8 — Create the Workload Identity Pool + Vercel OIDC provider

| | |
|---|---|
| **Prerequisite** | Vercel team slug known; IAM Credentials API enabled (Step 2). |
| **Action** | <br>`gcloud iam workload-identity-pools create vercel-pool --location=global --display-name="Vercel OIDC"` <br>`gcloud iam workload-identity-pools providers create-oidc vercel-oidc --location=global --workload-identity-pool=vercel-pool --issuer-uri="https://oidc.vercel.com/<team-slug>" --allowed-audiences="https://vercel.com/<team-slug>" --attribute-mapping="google.subject=assertion.sub"` |
| **Verification** | `gcloud iam workload-identity-pools providers describe vercel-oidc --location=global --workload-identity-pool=vercel-pool --format='value(oidc.issuerUri)'` prints the Vercel issuer URL. |
| **Failure mode** | Wrong issuer / audience → STS token exchange returns `INVALID_ARGUMENT`. The diagnose script surfaces this as an auth-env error before any KMS call is made. |

`google.subject = assertion.sub` is load-bearing: the binding in Step 11
pins the principal by the Vercel `sub` claim, which encodes the project +
environment.

---

## Step 9 — Create the runtime service account

| | |
|---|---|
| **Prerequisite** | Project exists (Step 1). |
| **Action** | `gcloud iam service-accounts create smart-agent-a2a-prod --display-name="Smart Agent A2A (prod)"` |
| **Verification** | `gcloud iam service-accounts list --filter='email~smart-agent-a2a-prod'` lists the account. |
| **Failure mode** | If the email is wrong in env vars, the `service_account_impersonation_url` returns `404` on every token exchange. The diagnose script surfaces this as an auth-env failure. |

Resource email for `GCP_SERVICE_ACCOUNT_EMAIL`:
```
smart-agent-a2a-prod@smart-agent-prod.iam.gserviceaccount.com
```

---

## Step 10 — Grant per-key IAM roles to the service account

| | |
|---|---|
| **Prerequisite** | Steps 4–9 complete. |
| **Action** | (per-key, replace `<sa>` with the service account email): <br><br>**Session KEK** — `gcloud kms keys add-iam-policy-binding a2a-session-kek --keyring=smart-agent --location=us-east1 --member="serviceAccount:<sa>" --role="roles/cloudkms.cryptoKeyEncrypterDecrypter"` <br><br>**Master + tool executor signers** — `gcloud kms keys add-iam-policy-binding <KEY> --keyring=smart-agent --location=us-east1 --member="serviceAccount:<sa>" --role="roles/cloudkms.signer"` for each of `master-eoa-signer` + the five `tool-*` keys. <br><br>**MAC keys** — `gcloud kms keys add-iam-policy-binding <KEY> --keyring=smart-agent --location=us-east1 --member="serviceAccount:<sa>" --role="roles/cloudkms.signerVerifier"` for each `mac-*` key. <br><br>`roles/cloudkms.signerVerifier` is a superset of `roles/cloudkms.signer` for `macSign`; the a2a-agent is on both sides of every MAC edge (it signs outbound and verifies inbound), so granting only `signer` here will break `macVerify` at runtime. |
| **Verification** | `gcloud kms keys get-iam-policy <KEY> --keyring=smart-agent --location=us-east1` lists the expected role + member. |
| **Failure mode** | A missing binding → the diagnose script reports `IAM denied` for that exact key. At runtime, the first MAC/sign/encrypt call against that key returns `PERMISSION_DENIED` and the request is rejected with an audit-deny row. |

---

## Step 11 — Bind the Workload Identity Pool principal to the service account

| | |
|---|---|
| **Prerequisite** | Pool + provider (Step 8) and service account (Step 9) exist. |
| **Action** | `gcloud iam service-accounts add-iam-policy-binding <sa> --role="roles/iam.workloadIdentityUser" --member="principal://iam.googleapis.com/projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/vercel-pool/subject/owner:<team-slug>:project:<project-id>:environment:production"` |
| **Verification** | `gcloud iam service-accounts get-iam-policy <sa>` lists the `workloadIdentityUser` role bound to the expected principal. |
| **Failure mode** | The Vercel OIDC token is rejected at STS with `UNAUTHENTICATED`. The diagnose script reports an auth-env failure. The principal MUST match the `sub` claim Vercel emits for the production deployment — if you have multiple Vercel projects, each needs its own binding. |

The `subject/...` shape encodes the exact Vercel project + environment.
Preview deployments use a different `sub` claim and will NOT be able to
impersonate the prod service account unless you bind a second principal.

---

## Step 12 — Set Vercel env vars (identifiers only)

In the Vercel project dashboard → Settings → Environment Variables. Set
for the Production environment (and Preview if you want preview deploys
to exercise the prod path).

| Variable | Value |
|---|---|
| `A2A_KMS_BACKEND` | `gcp-kms` |
| `GCP_PROJECT_ID` | `smart-agent-prod` |
| `GCP_PROJECT_NUMBER` | `<numeric, from Step 1>` |
| `GCP_WORKLOAD_IDENTITY_POOL_ID` | `vercel-pool` |
| `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID` | `vercel-oidc` |
| `GCP_SERVICE_ACCOUNT_EMAIL` | `smart-agent-a2a-prod@smart-agent-prod.iam.gserviceaccount.com` |
| `GCP_KMS_SESSION_KEK` | `projects/.../cryptoKeys/a2a-session-kek` |
| `GCP_KMS_MASTER_SIGNER_VERSION` | `projects/.../cryptoKeyVersions/1` |
| `GCP_KMS_TOOL_EXECUTOR_DISBURSEMENT_VERSION` | `projects/.../tool-disbursement/cryptoKeyVersions/1` |
| `GCP_KMS_TOOL_EXECUTOR_ROUND_AWARDS_VERSION` | `projects/.../tool-round-awards/cryptoKeyVersions/1` |
| `GCP_KMS_TOOL_EXECUTOR_POOL_LIFECYCLE_VERSION` | `projects/.../tool-pool-lifecycle/cryptoKeyVersions/1` |
| `GCP_KMS_TOOL_EXECUTOR_GRANT_AWARDS_VERSION` | `projects/.../tool-grant-awards/cryptoKeyVersions/1` |
| `GCP_KMS_TOOL_EXECUTOR_AUTH_BOOTSTRAP_VERSION` | `projects/.../tool-auth-bootstrap/cryptoKeyVersions/1` |
| `GCP_KMS_MAC_<EDGE>_VERSION` | `projects/.../cryptoKeyVersions/1` (one per `MAC_KEY_IDS` entry — see Step 7) |

After saving, run the diagnose script (see § Smoke test) BEFORE redeploying.
If diagnose is green, the redeploy is trusted to boot — `assertGcpEnvComplete`
is the second-layer gate at process start.

---

## Smoke test — `scripts/diagnose-gcp-kms.ts`

After Step 12, run from any workstation with the same env loaded:

```bash
pnpm tsx scripts/diagnose-gcp-kms.ts
```

The script:

1. Reports presence + format of every `GCP_*` env var (without printing values).
2. Calls `createGcpAuthClient(env)` and surfaces any auth-env error.
3. Per key class (session/master/tool-executors/MAC) iterates the canonical id
   lists and reports `OK` / `missing env` / `IAM denied` / `key not found`.
4. Returns exit `0` if every active key class is OK; non-zero otherwise.

This is a deploy-time smoke test, not a runtime gate. The runtime gate is
`assertGcpEnvComplete(env)` in `apps/a2a-agent/src/lib/policy-startup.ts`,
which runs at boot inside `runAsyncStartupInvariants` and refuses to start
the agent if any required identifier is missing — in a SINGLE error
message that names every missing var.

Run `pnpm tsx scripts/diagnose-gcp-kms.ts --help` for usage details.

---

## Rollback / rotate

KMS asymmetric keys + MAC keys are pinned to a specific version in the
env. Rotation = create a new version, update env, redeploy. Old versions
remain usable until the env is flipped, so there is zero-downtime
rotation.

### Single-key rotate

1. **Create the new version**:
   `gcloud kms keys versions create --key=<KEY> --keyring=smart-agent --location=us-east1`
   (returns `cryptoKeyVersions/<n+1>`).
2. **Update the matching env var** in Vercel to the new version path.
3. **Redeploy.** The new deploy boots against version `<n+1>`; the old
   deploy continues against version `<n>` until rotated out.
4. **Disable the old version** when all traffic is on the new deploy:
   `gcloud kms keys versions disable <n> --key=<KEY> --keyring=smart-agent --location=us-east1`.
   Disable only — DO NOT destroy. Destroy is a separate scheduled
   operation (24h delay by default) and only after audit retention has
   covered every signature that referenced it.

### Cross-cloud rollback

`A2A_KMS_BACKEND=aws-kms` is the sibling backend; flipping the env var +
redeploying rolls back to the AWS path provided the AWS resources are
provisioned (see `docs/operations/kms-signer-setup.md`).

---

## Operator eyes-only — what NOT to set in production

When `A2A_KMS_BACKEND='gcp-kms'` AND `NODE_ENV='production'`, the
production guard in `apps/a2a-agent/src/auth/key-provider.ts`
(`assertNoForbiddenStaticKeys`) REFUSES TO START if any of the
following env vars are set:

**Shared (forbidden under both AWS and GCP backends):**

- `A2A_SESSION_SECRET`
- `A2A_MASTER_EOA_PRIVATE_KEY`
- `WEB_TO_A2A_HMAC_KEY`
- Any `TOOL_EXECUTOR_*_PRIVATE_KEY` (pattern match)
- Any `A2A_INTERSERVICE_HMAC_KEY_*` (pattern match)

**GCP-specific:**

- `GOOGLE_APPLICATION_CREDENTIALS`
- `GCP_SERVICE_ACCOUNT_KEY_JSON`

These are forensics-liability env vars with no operational value under a
managed-KMS backend: every signing / HMAC / decrypt operation goes
through Cloud KMS via Workload Identity Federation. A static credential
in the deploy env defeats the entire trust model and is refused at boot
with an error naming every offending variable.

`DEPLOYER_PRIVATE_KEY` is gated separately by `assertDeployerKeyPolicy`
(see `docs/operations/kms-signer-setup.md` § "Deployer key (K6 — CI/CD
only)") with a time-boxed break-glass via `ALLOW_RUNTIME_DEPLOYER_KEY_UNTIL`.

---

## Cross-references

- AWS sibling runbook: `docs/operations/kms-signer-setup.md`
- Plan: `output/GCP-KMS-IMPLEMENTATION-PLAN.md` (§ G10, G11 are this PR; § G2..G5 are the providers)
- Boot invariant: `apps/a2a-agent/src/lib/policy-startup.ts:assertGcpEnvComplete`
- Diagnose CLI: `scripts/diagnose-gcp-kms.ts`
- Bypass guard: `scripts/check-no-bypass.sh` (rejects `@google-cloud/kms` /
  `google-auth-library` imports outside `packages/sdk/src/key-custody/`).
