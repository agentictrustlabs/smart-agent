# Smart Agent — Key Management Lifecycle (Operator Runbooks)

> Audience: SRE / Security operator who is on call for the production
> Smart Agent deployment AFTER spec 007 lands. Companion to (but
> distinct from) `docs/security/cryptographic-posture/` — the
> cryptographic-posture docs explain WHAT the cryptography is doing;
> these docs explain HOW the operator keeps it running.

## What this directory is

Spec 007 (`specs/007-architecture-hardening/plan.md`) Phase A introduces
three KMS-resident keys with distinct capability scopes:

| Key | Purpose | Created in |
|---|---|---|
| **master** | Inter-service MAC, envelope encryption for session-package storage, ERC-4337 bundler-envelope signing on relay tx (NOT user authority). | Spec 004 / K2 / K4 |
| **bundlerSigner** | EOA recognised by `AgentAccount.executeFromBundler` as the bundler-envelope authoriser. Submits userOps but cannot author them. | Spec 007 Phase A |
| **sessionIssuer** | EOA that co-signs Variant B `SessionAuthorization` envelopes. Co-signer only — user-side authorization is still required. | Spec 007 Phase A |

This directory holds the operational artefacts the on-call needs in
order to rotate, retire, and recover those three keys without taking the
system down — or, where the procedure inherently disrupts the system,
documenting precisely what disruption looks like and what the rollback
window is.

## Reading order

| # | Doc | Status | Read it when... |
|---|---|---|---|
| K1 | [Rotation procedure](./K1-rotation-procedure.md) | DRAFT | You are rotating a key on calendar, on a vendor advisory, or on a suspected-compromise trigger. **THE operator runbook.** |
| K2 | [Rotation dry-run evidence](./K2-rotation-dry-run-evidence.md) | DRAFT | You are about to execute K1 in production for the first time, or quarterly to validate the procedure still works. |
| K3 | [Break-glass and KMS outage](./K3-break-glass-and-kms-outage.md) | DRAFT | A KMS region is unreachable, an AWS account is suspended, or you need to invoke offline signing. |
| K4 | [HSM / FIPS evaluation](./K4-hsm-fips-evaluation.md) | DRAFT | You are responding to a customer compliance ask (healthcare / finance / government), preparing for a SOC 2 or FedRAMP audit, or evaluating the FIPS posture of the underlying KMS service. |
| K5 | [Key escrow and account-loss recovery](./K5-key-escrow-and-account-loss-recovery.md) | DRAFT | An AWS root account is compromised, a GCP project is deleted, or you are designing the recovery plan for the upgrade-authority key (a separate concern from the three runtime keys). |
| K6 | [CloudTrail monitoring and alerting](./K6-cloudtrail-monitoring-and-alerting.md) | DRAFT | You are wiring detection on KMS API activity, sampling audit records for the quarterly review, or responding to a paged alert. |

## Status disclosure (honest)

| Doc | Implementation status |
|---|---|
| K1 | **DRAFT — operator-testable on LocalStack today.** AWS / GCP paths are documented but have not been executed against a real account because no real account is yet live for prod. |
| K2 | **DRAFT — LocalStack dry-run script proposed (`scripts/dry-run-kms-rotation.sh`); not yet written.** This doc specifies the script's contract. |
| K3 | **DRAFT — none of the mitigations exist today.** Doc identifies the gap and prioritises which mitigations to build. |
| K4 | **DRAFT — applies once production AWS/GCP KMS is live.** Currently the system runs on LocalStack KMS, which is NOT FIPS-validated. |
| K5 | **DRAFT — no escrow exists today.** Per Phase A, master-key loss does NOT brick user accounts (master is no longer a co-owner). The doc explains why this is a smaller blast radius than pre-Phase-A and what residual losses still require an escrow story. |
| K6 | **DRAFT — alerting rules specified; not yet wired in CloudWatch / Cloud Logging.** Wiring is part of Phase H (Terraform). |

## Glossary

| Term | Meaning |
|---|---|
| **master** | The KMS key historically referenced by `A2A_KMS_BACKEND` as `MASTER_SIGNER`. Post-Phase-A it signs MAC + bundler-relay envelopes; it does NOT sign user authority. |
| **bundlerSigner** | New Phase A KMS key. Address recorded immutably on every `AgentAccount` proxy at deploy time. Submits userOps via `executeFromBundler`. |
| **sessionIssuer** | New Phase A KMS key. Address recorded immutably on every `AgentAccount` proxy at deploy time. Co-signs Variant B `SessionAuthorization`. |
| **rotation** | Creating a new KMS key version and pointing the runtime at it. Does NOT delete the old version. |
| **retirement** | Disabling an old key version after all signatures it produced have aged past the longest expected redemption window. |
| **destruction** | Scheduling KMS-side deletion. Default 30-day delay on AWS, 24-hour delay on GCP. Irreversible after the window expires. |
| **break-glass** | A pre-authorised but rarely-invoked procedure used when the normal KMS path is unavailable; every invocation produces an audit artefact reviewed within 24h. |
| **CMK** | Customer Managed Key (AWS terminology). The unit of access control. |
| **CryptoKeyVersion** | GCP equivalent of an AWS KMS key version. Pinned per-resource in env. |
| **HNDL** | Harvest-Now-Decrypt-Later. Adversary captures KMS ciphertext today, decrypts after CRQC. Considered in K1's retirement window. |

## Cross-references

- `specs/007-architecture-hardening/plan.md` — overall hardening initiative.
- `specs/007-architecture-hardening/phase-A-contract-role-split.md` — defines the three keys.
- `specs/007-architecture-hardening/phase-H-privacy-and-iac.md` — Terraform / IaC track; K6 alerting wiring lives there.
- `docs/operations/kms-signer-setup.md` — AWS KMS operator runbook (provisioning); K1 layers rotation on top.
- `docs/operations/kms-signer-localstack.md` — LocalStack runbook; K1 / K2 dev-mode parity.
- `docs/operator/gcp-kms-provisioning.md` — GCP KMS operator runbook (provisioning); K1 layers rotation on top.
- `docs/security/cryptographic-posture/` — what the keys are doing cryptographically.
- `output/KMS-IMPLEMENTATION-PLAN.md`, `output/GCP-KMS-IMPLEMENTATION-PLAN.md` — canonical migration plans.

---

*Last updated: 2026-05-18. Owner: Security + Infra agents. Reviewers
pending.*
