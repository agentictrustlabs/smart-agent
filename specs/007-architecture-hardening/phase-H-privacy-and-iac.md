# Phase H — Privacy + IaC

> **Status**: skeleton — design ready for review.
> **Depends on**: A (new KMS keys), C (no DEPLOYER key in runtime),
> D (MAC keys per MCP).
> **Unblocks**: production deploy.

## Summary

External review P1-5 (no Terraform / IaC for KMS+IAM) and P1-6
(AnonCreds custodial privacy policy not documented). Phase H produces
the Terraform repo that mirrors the runbooks AND the privacy/policy
documentation for AnonCreds holder wallets.

> **Companion artefact**: the operational maturity track for KMS lifecycle
> management lives in `docs/security/key-management/` (K1–K6 runbooks).
> Phase H is the IaC layer that PROVISIONS the resources those runbooks
> manage; the K-series docs are the procedures the operator runs against
> those resources. The K-docs identify several requirements that flow
> into Phase H acceptance criteria — see § Concrete deliverables below.

## Goals

1. AWS + GCP KMS keys and IAM bindings are provisioned via Terraform;
   the runbook becomes a reference for the IaC, not the source of
   truth.
2. The holder-wallet custodial relationship is documented: what data
   is retained, for how long, who can revoke, and what the holder's
   portability path is.
3. CI verifies the IaC plan matches the runbook on every infra-touching
   PR.

## Concrete deliverables

### IaC

- `infra/terraform/aws/` — KMS keys (master, bundler, session-issuer),
  IAM roles, OIDC trust policy for ECS tasks, audit-log routing to
  CloudWatch. `terraform plan` clean on a fresh AWS account.
  - **Multi-region by default** (per `docs/security/key-management/K3-break-glass-and-kms-outage.md` § 4):
    every signing-class key has `multi_region = true`; replicas
    provisioned to a secondary region.
  - **FIPS endpoint enforced** (per `K4-hsm-fips-evaluation.md` § 3.3):
    the IAM role's session settings, the SDK config, and the boot-time
    assertion all reference `kms-fips.<region>.amazonaws.com`.
  - **CloudTrail with object-level events** (per `K6-cloudtrail-monitoring-and-alerting.md` § 3.2):
    multi-region trail, log file validation, S3 Object Lock in
    COMPLIANCE mode with 7-year retention.
  - **CloudWatch alarms** for the R-KMS-1..9 rule set in K6 § 3.3.
- `infra/terraform/gcp/` — equivalent: KMS keys + service accounts +
  audit-log routing to Stackdriver.
  - **`protection_level = "HSM"` on every key** (per `K4-hsm-fips-evaluation.md` § 4.2).
  - **Data Access audit logs enabled** for `cloudkms.googleapis.com`
    (per `K6-cloudtrail-monitoring-and-alerting.md` § 5.1).
  - **GCS audit-log sink with WORM retention** (7 years, per K6 § 5.2).
- `infra/terraform/README.md` — runbook → Terraform map; preserves the
  human-readable runbook content but cross-references modules. Also
  cross-references the K-series operator runbooks.
- CI step: on PRs that touch `docs/runbooks/{aws,gcp}-kms-setup.md`
  OR `infra/terraform/**`, run `terraform plan -refresh=false` and
  surface diff. Drift fails CI.
- **K2 CI integration**: `.github/workflows/pre-prod-kms-check.yml` is
  the pre-prod gate that runs `scripts/dry-run-kms-rotation.sh` on
  LocalStack for any PR touching key-custody code (per K2 § 7.1).
- **K2 scheduled drill**: `.github/workflows/scheduled-kms-drill.yml`
  runs quarterly on the 1st of Jan/Apr/Jul/Oct (per K2 § 7.2).

### Privacy policy

- `docs/privacy/anoncreds-custodial.md`:
  - The holder-wallet model: org-mcp custodies AnonCreds presentations
    for stateless users; what data is held, for how long.
  - Retention defaults (90 days for issued credentials, indefinite for
    nullifier hashes since they are unlinkable to identity).
  - Holder's portability path: how a user moves to a non-custodial
    wallet (export the credential blob to the user's device + revoke
    custodial copy).
  - Revocation: how a user revokes a custodial credential.
  - Reviewed by Security + IA + Documentarian.

- **Privacy & compliance document set** —
  `docs/security/privacy-and-compliance/` (added 2026-05-18):
  - `README.md` — reading order, glossary, cross-cutting themes.
  - `P1-gdpr-article-17-right-to-erasure.md` — three-tier deletion
    model; on-chain pseudonymization defense; concrete SOP.
  - `P2-data-residency.md` — EU vs US recipes; SCC / DPF posture.
  - `P3-pii-classification-per-service.md` — per-column classification
    across every store; envelope-encryption requirements.
  - `P4-data-retention-policies.md` — eight retention classes;
    automated purge spec; legal-hold override.
  - `P5-consent-ux-for-delegation-grants.md` — pre-signature
    disclosure components; high-risk action gates; on-chain/off-chain
    variant distinction.
  - `P6-right-of-access-export.md` — GDPR Art 15 / CCPA SOP and
    bundle implementation.
  - `P7-portability-did-credential-export.md` — Art 20; DID + VC
    export; AnonCreds link-secret portability.
  - `P8-data-minimization-audit.md` — quarterly audit cadence and
    register format.
  - `P9-sub-processor-inventory.md` — AWS, GCP, Vercel, Ontotext, etc.
  - `P10-soc2-type2-readiness.md` — auditor selection, timeline, cost.
  - `P11-breach-notification-procedures.md` — 72-hour SLA, SEV tiers,
    tabletop cadence.
  - `P12-special-categories-and-hipaa.md` — Art 9 religious-belief
    posture; HIPAA / COPPA applicability.

  All docs are DRAFT pending counsel review. Every clause requiring
  qualified-counsel sign-off is marked [CONSULT COUNSEL] in the text.
  The custodial AnonCreds policy in `docs/privacy/anoncreds-custodial.md`
  (this phase's existing deliverable above) sits underneath this set
  as the AnonCreds-specific drill-down.

## Acceptance criteria

- [ ] `terraform plan` runs clean against a fresh AWS account using only
      `infra/terraform/aws/`.
- [ ] `terraform plan` runs clean against a fresh GCP project using only
      `infra/terraform/gcp/`.
- [ ] Runbooks updated to cross-reference the Terraform modules.
- [ ] `docs/privacy/anoncreds-custodial.md` exists, reviewed by 3 roles.
- [ ] `docs/security/privacy-and-compliance/` set (P1–P12 + README) exists
      and is queued for external-counsel review (added 2026-05-18).
- [ ] CI plan-drift check is wired and tested with a deliberate drift.
- [ ] **K1–K6 requirements landed**:
  - [ ] Multi-region replication enabled on every AWS signing-class
        key (K3 § 4 / M1+M2).
  - [ ] FIPS endpoint enforced in prod via SDK + boot assertion
        (K4 § 3.3 / K4-A1+A2).
  - [ ] GCP keys are HSM-protected (K4 § 4.2 / K4-A3+A4).
  - [ ] CloudTrail data events captured for KMS; 7-year WORM
        retention (K6 § 3.2).
  - [ ] Cloud Audit Logs Data Access enabled for cloudkms; 7-year
        WORM retention (K6 § 5.1+5.2).
  - [ ] CloudWatch alarms R-KMS-1..9 wired (K6 § 3.3).
  - [ ] Cloud Logging alert policies G-KMS-1..8 wired (K6 § 5.3).
  - [ ] `scripts/dry-run-kms-rotation.sh` exists and is wired into
        pre-prod CI (K2 § 7.1).

## Open questions

- **H1**: Single Terraform monolith vs per-environment workspaces?
  Proposed: per-environment workspaces (dev / staging / prod) with a
  shared module library.
- **H2**: Holder wallet self-custody — is it a v1 deliverable or
  deferred? Proposed: deferred; this phase documents the custodial
  shape and the portability path, not the self-custody flow itself.
  A follow-on spec (009?) covers self-custody.
- **H3**: Audit-log retention — 90 days, 1 year, indefinite? Proposed:
  1 year for security audit logs; 90 days for proxy denials; lock
  with Security.
