# Smart Agent Infrastructure (IaC)

This directory contains Terraform modules that provision the
substrate the runbooks under `docs/security/key-management/` operate
against. Each module is the **source of truth** for its resources;
the K-series runbooks are the procedures an operator runs against
the resources Terraform creates.

```
infra/
  aws/                AWS KMS + IAM + CloudTrail + CloudWatch alarms
  gcp/                GCP Cloud KMS + Workload Identity Federation + audit-log sink
  README.md           This file
  vercel-egress-ranges.json   (operator-maintained per K6 § 3.3.2 — TODO)
```

Spec: `specs/007-architecture-hardening/phase-H-privacy-and-iac.md`.

## Module overview

### `infra/aws`

Provisions, in `var.aws_region`, with a multi-region replica in
`var.aws_replica_region`:

| Resource class | Count | Purpose |
|---|---|---|
| KMS asymmetric signing keys (secp256k1, multi-region) | 3 core + 5 tool-executors = **8** | EVM-compatible signing on FIPS-validated HSMs (K4) |
| KMS symmetric encryption keys | 2 | Session-package envelope KEK; CloudTrail log encryption (separate trust zones) |
| KMS HMAC_256 keys | **8** | One per inter-service pair (a2a-to-person, …, a2a-to-skill) |
| IAM role | 1 | Vercel-OIDC-federated runtime (`sts:AssumeRoleWithWebIdentity`); explicit per-key permissions, no wildcards |
| IAM OIDC provider | 1 | Trust anchor for the Vercel issuer |
| CloudTrail | 1 multi-region trail | Captures KMS data events; log file validation; KMS-encrypted |
| S3 bucket | 1 | Object Lock COMPLIANCE mode, 7-year retention; TLS-only; KMS-encrypted |
| CloudWatch log group | 1 | 90-day real-time mirror of the trail |
| CloudWatch alarms | 9 | R-KMS-1 through R-KMS-9 per K6 § 3.3 |

Total managed key resources: ~18 KMS keys + their aliases + replicas.

### `infra/gcp`

Provisions, in `var.gcp_region`:

| Resource class | Count | Purpose |
|---|---|---|
| Cloud KMS keyring | 1 | Holds every key |
| Cloud KMS asymmetric signing keys (secp256k1, HSM) | 3 core + 5 tool-executors = **8** | K4 § 4.2 mandates `protection_level = "HSM"` |
| Cloud KMS symmetric encryption keys (HSM) | 1 | Session-package envelope (90-day rotation) |
| Cloud KMS MAC keys (HSM_SHA256, HSM) | **8** | One per inter-service pair |
| Workload Identity Pool + Provider | 1 | Vercel OIDC federation |
| Service account | 1 | Impersonated by the federated identity |
| Per-key IAM bindings | per key | `signer`, `cryptoKeyEncrypterDecrypter`, `signerVerifier` scoped to the runtime SA |
| Audit log config | 1 | Enables Data Access logs for `cloudkms.googleapis.com` — **off by default**, K6 § 5.1 |
| Logging sink + GCS bucket | 1 + 1 | 7-year locked retention (`is_locked = true`); ARCHIVE storage class |
| Log-based metrics | 5 | G-KMS-1/4/5/7/8 |
| Alert policies | 4 | G-KMS-4/5/7/8 — high-severity rules |

## Prerequisites

- **Terraform** >= 1.6
- **AWS CLI** with credentials for an operator role that can manage
  KMS, IAM, CloudTrail, S3, CloudWatch in the target account.
- **gcloud CLI** authenticated as a Project Owner / Editor on the
  target GCP project. Application-default credentials via
  `gcloud auth application-default login`.
- Vercel project deployed; the Vercel team slug and project name
  are required inputs.
- For the AWS module: an OIDC issuer thumbprint for Vercel — the
  thumbprint of the TLS certificate served by the Vercel OIDC
  issuer URL. Capture once and supply via tfvars; rotate when
  Vercel rotates the cert. See § "OIDC trust" below.

## Per-environment workspaces

Open question H1 in the spec proposed per-environment workspaces.
Recommended layout:

```
infra/aws/envs/staging/backend.tf
infra/aws/envs/staging/terraform.tfvars
infra/aws/envs/prod/backend.tf
infra/aws/envs/prod/terraform.tfvars
infra/gcp/envs/staging/backend.tf
infra/gcp/envs/prod/backend.tf
```

Each `backend.tf` configures an S3 (AWS) or GCS (GCP) remote state
backend with a per-environment lock table / bucket. NEVER use local
state for production.

Apply pattern (from the env directory):

```bash
cd infra/aws/envs/prod
terraform init
terraform plan -var-file=terraform.tfvars -out=plan.out
# review the plan
terraform apply plan.out
```

## Variables file template

`infra/aws/envs/<env>/terraform.tfvars`:

```hcl
aws_region          = "us-east-1"
aws_replica_region  = "us-west-2"
environment         = "prod"
project_name        = "smart-agent"
vercel_oidc_issuer  = "https://oidc.vercel.com/<team-slug>"
vercel_team_slug    = "<team-slug>"
vercel_project_name = "smart-agent"

# Capture once per cert lifecycle:
#   openssl s_client -showcerts -connect oidc.vercel.com:443 < /dev/null 2>/dev/null \
#     | openssl x509 -fingerprint -sha1 -noout \
#     | tr -d ':' | sed -E 's/^.*=//; s/.*/\L&/'
vercel_oidc_thumbprint = "<sha1-hex>"

# Vercel egress CIDR ranges. Update quarterly per K6 § 3.3.2.
vercel_egress_cidr_ranges = []

# Optional — once PagerDuty is wired, populate.
pagerduty_sns_topic_arn = ""
```

`infra/gcp/envs/<env>/terraform.tfvars`:

```hcl
gcp_project_id         = "<gcp-project-id>"
gcp_region             = "us-east1"
environment            = "prod"
project_name           = "smart-agent"
vercel_oidc_issuer_url = "https://oidc.vercel.com/<team-slug>"
vercel_team_slug       = "<team-slug>"
vercel_project_name    = "smart-agent"
```

## Outputs and Vercel propagation

After apply, capture outputs and write them into the Vercel project
environment. Manual for v1 (operator runs `vercel env add ...`); a
future enhancement can wire this through the Vercel Terraform
provider.

**Required env vars on the Vercel project (AWS deployment):**

| Vercel env var | Terraform output |
|---|---|
| `A2A_KMS_BACKEND` | (literal: `"aws-kms"`) |
| `AWS_REGION` | `var.aws_region` |
| `AWS_ROLE_ARN` | `runtime_role_arn` |
| `AWS_KMS_KEY_ID` (session envelope) | `session_envelope_key_arn` |
| `A2A_MASTER_SIGNER_KEY_ARN` | `master_signer_key_arn` |
| `A2A_BUNDLER_SIGNER_KEY_ARN` | `bundler_signer_key_arn` |
| `A2A_SESSION_ISSUER_KEY_ARN` | `session_issuer_key_arn` |
| `TOOL_EXECUTOR_ROUND_AWARDS_KEY_ARN` | `tool_executor_key_arns["round-awards"]` |
| `TOOL_EXECUTOR_DISBURSEMENT_KEY_ARN` | `tool_executor_key_arns["disbursement"]` |
| `TOOL_EXECUTOR_POOL_LIFECYCLE_KEY_ARN` | `tool_executor_key_arns["pool-lifecycle"]` |
| `TOOL_EXECUTOR_GRANT_AWARDS_KEY_ARN` | `tool_executor_key_arns["grant-awards"]` |
| `TOOL_EXECUTOR_AUTH_BOOTSTRAP_KEY_ARN` | `tool_executor_key_arns["auth-bootstrap"]` |
| `MAC_KEY_A2A_TO_PERSON_ARN` | `mac_key_arns["a2a-to-person"]` |
| `MAC_KEY_A2A_TO_ORG_ARN` | `mac_key_arns["a2a-to-org"]` |
| `MAC_KEY_A2A_TO_HUB_ARN` | `mac_key_arns["a2a-to-hub"]` |
| `MAC_KEY_A2A_TO_PEOPLE_GROUP_ARN` | `mac_key_arns["a2a-to-people-group"]` |
| `MAC_KEY_A2A_TO_FAMILY_ARN` | `mac_key_arns["a2a-to-family"]` |
| `MAC_KEY_A2A_TO_GEO_ARN` | `mac_key_arns["a2a-to-geo"]` |
| `MAC_KEY_A2A_TO_VERIFIER_ARN` | `mac_key_arns["a2a-to-verifier"]` |
| `MAC_KEY_A2A_TO_SKILL_ARN` | `mac_key_arns["a2a-to-skill"]` |

**For GCP deployment:** the analogous list with `GCP_KMS_*` env vars
maps to the `gcp` module outputs. See `apps/a2a-agent/.env.example`
for the canonical env-var schema.

## FIPS endpoint enforcement (K4)

The runtime SDK in `packages/sdk/src/key-custody/aws-kms-client-config.ts`
sets `useFipsEndpoint: true` whenever `NODE_ENV === 'production'`
(K4-A1). The boot-time assertion in
`apps/a2a-agent/src/lib/policy-startup.ts` resolves the in-use
endpoint and refuses to boot if it is not `kms-fips.<region>.amazonaws.com`
(K4-A2). The Terraform module produces the keys; FIPS enforcement is
in the client layer.

## OIDC trust

The Vercel OIDC issuer's TLS-cert thumbprint is required to
configure the IAM OIDC provider. Capture procedure:

```bash
openssl s_client -showcerts -connect oidc.vercel.com:443 < /dev/null 2>/dev/null \
  | openssl x509 -fingerprint -sha1 -noout \
  | tr -d ':' | sed -E 's/^.*=//; s/.*/\L&/'
```

Pass to Terraform as `vercel_oidc_thumbprint`. Rotate when Vercel
rotates the cert (re-run the capture).

## Vercel egress CIDR ranges (K6 § 3.3.2)

R-KMS-2 alarms when a KMS call from our runtime role originates
outside the Vercel egress range. The range list is documented at:

  https://vercel.com/docs/concepts/projects/overview/security

Maintain `infra/vercel-egress-ranges.json` quarterly. The
`vercel_egress_cidr_ranges` variable feeds the alarm condition.

For v1, the R-KMS-2 alarm is provisioned with a placeholder
threshold (1,000,000) — set to a real threshold once the Lambda
subscription that performs CIDR matching is wired (TODO; tracked
in spec 007).

## How to apply

```bash
# AWS, prod
cd infra/aws
terraform init -backend-config=envs/prod/backend.tf
terraform plan -var-file=envs/prod/terraform.tfvars -out=plan.out
terraform apply plan.out

# GCP, prod (separate run)
cd infra/gcp
terraform init -backend-config=envs/prod/backend.tf
terraform plan -var-file=envs/prod/terraform.tfvars -out=plan.out
terraform apply plan.out
```

## CI plan-drift check (Phase H acceptance criterion)

A GitHub Action that:

1. On every PR that touches `infra/**` or
   `docs/security/key-management/**`, runs
   `terraform plan -refresh=false` against a staging account.
2. Posts the plan as a PR comment.
3. Fails if the plan is non-empty (drift) or if the plan shape
   doesn't match the K6 alarm catalogue.

See `.github/workflows/iac-plan.yml` (TODO — Phase H acceptance
criterion not yet landed).

## Cross-references

| K-series runbook | Module piece |
|---|---|
| K1 — rotation procedure | `kms.tf` lifecycle blocks (`prevent_destroy`); rotation is operator-manual against the provisioned keys |
| K2 — rotation dry-run evidence | `.github/workflows/pre-prod-kms-check.yml` (Phase H acceptance, TODO) |
| K3 — break-glass and KMS outage | `aws_kms_replica_key.*` multi-region; the failover path uses the replica ARN |
| K4 — HSM / FIPS evaluation | `multi_region = true`; `customer_master_key_spec`; GCP `protection_level = "HSM"`; FIPS endpoint enforced in client (K4-A1/A2), NOT IaC |
| K5 — key escrow / account loss recovery | Out of scope for IaC; operator-procedural |
| K6 — CloudTrail monitoring | `cloudtrail.tf`; `cloudwatch-alarms.tf`; `audit-logs.tf` (GCP) |
| P-series — privacy docs | Cross-reference only; no resource provisioning |
| Phase A — contract role split | Per-key IAM uses the role split (master / bundler / session-issuer / tool-executors), one key per role |
| Phase B — A2A signer model | Each signer maps to a KMS key ARN |
| Phase F — storage layer | (separate plan; not provisioned here) |

## Open questions (from spec § 9)

- **H1**: per-environment workspaces — addressed above (recommended).
- **H2**: holder-wallet self-custody — out of scope; covered in the
  privacy doc set.
- **H3**: audit retention — 7 years selected per K6 § 7. Override
  via `audit_log_retention_days` if Security signs off on a lower
  number for staging.
