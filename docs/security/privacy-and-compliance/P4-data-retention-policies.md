# P4 — Data Retention Policies

> **Document status: DRAFT.**
> **[CONSULT COUNSEL]** marks every clause requiring data-protection counsel sign-off.
> **Last updated: 2026-05-18.**

## 0. Executive summary

GDPR Article 5(1)(e) ("storage limitation") requires that personal data be "kept in a form which permits identification of data subjects for no longer than is necessary for the purposes for which the personal data are processed." Practical compliance is a **per-class retention schedule** with automated enforcement.

Smart Agent's posture: **eight retention classes** spanning 30 days to 7 years, with **automatic purge** via cron jobs, a **legal-hold override**, and an **anti-pattern catalog** of "do not store indefinitely" rules.

| Class | Window | Driven by |
|---|---|---|
| **R1: Session-state** | 90 days after expiry | Operational |
| **R2: Audit (general)** | 1 year | Security operational |
| **R3: Audit (financial)** | 7 years | US BSA / SOX / state |
| **R4: Personal content (active)** | Account-lifetime | User contract |
| **R5: Personal content (post-erasure)** | 30 days backup decay | GDPR-aligned |
| **R6: Marketing / contact** | Until user opt-out + 30 days | GDPR Art 7(3) |
| **R7: Logs (transactional)** | 90 days | Operational |
| **R8: Reference data** | Indefinite | Non-personal |

## 1. Retention principle and lawful bases

The five retention principles we apply:

1. **Necessity** — retain only as long as needed for the documented purpose (Art 5(1)(e)).
2. **Defensibility** — every retention class maps to a lawful basis (Art 6) or a regulatory obligation cited in P1 § 3.3.
3. **Automation** — purge runs automatically; manual purge is exception only.
4. **Auditability** — every purge run logs counts; quarterly Security review.
5. **User notice** — retention windows are disclosed at signup and in the privacy notice.

## 2. Lawful basis per class

| Class | Lawful basis | Citation |
|---|---|---|
| R1 | Art 6(1)(b) contract performance + Art 6(1)(f) legitimate interest in security | Operational |
| R2 | Art 6(1)(f) legitimate interest in security audit; Art 6(1)(c) compliance with security obligations | NIST SP 800-92 |
| R3 | Art 6(1)(c) compliance with legal obligation | US BSA 31 CFR § 1010.430(d) (5 years); SOX 18 U.S.C. § 1519 (7 years for audit-relevant records, where applicable) |
| R4 | Art 6(1)(b) contract performance | Operational |
| R5 | Art 17 — erasure obligation defines the upper bound | GDPR Art 17 |
| R6 | Art 6(1)(a) consent | Art 7(3) — withdrawal is at any time |
| R7 | Art 6(1)(f) legitimate interest in operations | Operational |
| R8 | Not personal data | N/A |

## 3. Per-class detail

### 3.1 R1 — Session state

**Items**: `users.sessions` (web), `a2a.sessions`, `recovery_intents`, `recovery_delegations` (after revocation).

**Retention**: 90 days **after expiry** of the session.

**Rationale**: provides a forensic window for investigating session-hijacking incidents while bounding storage.

**Implementation**:
```
cron: daily at 03:00 UTC, per-service
- DELETE FROM sessions WHERE expires_at < NOW() - INTERVAL '90 days'
- DELETE FROM a2a_sessions WHERE expired_at < NOW() - INTERVAL '90 days'
```

**Code path**: `apps/web/src/lib/jobs/purge-sessions.ts` (to be built — currently no scheduled purge runs).

### 3.2 R2 — Audit (general)

**Items**: `a2a-agent.audit_log`, `ssi_proof_audit`, security-event log streams (auth failures, replay-nonce hits, KMS calls, KMS errors), MCP tool invocation log.

**Retention**: 1 year after creation.

**Rationale**: NIST SP 800-92 (Guide to Computer Security Log Management) suggests 1 year as a default operational window. SOC 2 expectations (P10) align.

**Override**: if a log entry is **linked to an open security incident**, retention extends until the incident is closed (P11 § 6).

**Implementation**:
```
cron: weekly Sunday 04:00 UTC, per-service
- DELETE FROM audit_log WHERE created_at < NOW() - INTERVAL '1 year' AND incident_id IS NULL
```

**Hash-chain preservation**: deleting audit rows breaks the prev-hash chain. Strategy: keep a **summary record** for each removed batch — `(batch_id, first_id_removed, last_id_removed, head_hash_before, head_hash_after, count_removed)` — so the chain can be re-anchored at the boundary. Build target: `apps/a2a-agent/src/lib/audit-purge.ts`.

### 3.3 R3 — Audit (financial / regulatory)

**Items**: rows in `disbursements`, `outcome_attestations`, `revenue_reports`, `engagement_tranches`, and audit-log entries that touch financial flows.

**Retention**: **7 years** from creation (or completion of the financial event, whichever is later).

**Rationale**:
- US BSA 31 CFR § 1010.430(d): financial institutions must retain records of every transaction "for a period of five years."
- US SOX 18 U.S.C. § 1519: 7 years for accountant/auditor work papers and records relating to issuer audits.
- GDPR Art 17(3)(b): compliance with legal obligation exempts erasure.
- IRS Pub. 583 (US small business): 7-year retention for tax-relevant records.

**Override**: if the customer is **not** a US-regulated financial institution and **not** subject to SOX, the 7-year window may be reduced. **[CONSULT COUNSEL]** before reducing; default is the safe 7-year posture.

**Implementation**:
- Tables tagged with retention class via a column comment or a side table `retention_overrides`.
- Purge cron skips R3-tagged rows until age > 7 years.
- A **purge approval gate**: financial-record purge requires DPO sign-off before execution (build target: human-in-the-loop step).

### 3.4 R4 — Personal content (active account)

**Items**: every `S` and `B` column in person-MCP and org-MCP for an active account (per P3 §§ 4–6).

**Retention**: **for as long as the account is active**. Counted from `last_login_at` (operational definition of "active").

**Inactive-account purge**: accounts with no login for **2 years** are flagged for purge:
- Day 0 of inactivity: account is "dormant."
- Day 365: warning email sent ("Your account will be deleted in 1 year").
- Day 545 (18-month): second warning.
- Day 700 (~23 months): final warning ("Your account will be deleted in 30 days").
- Day 730 (2 years): purge runs.

**Rationale**: GDPR Art 5(1)(e) limits storage beyond necessity. A user inactive for 2 years has demonstrated no continued need.

**Override**: open financial commitments (open pledge, pending disbursement) keep the account active for retention purposes until commitments close (Art 17(3)(e)).

**Implementation**:
```
cron: daily 02:00 UTC
- SELECT principal FROM users WHERE last_login_at < NOW() - INTERVAL '2 years'
  AND principal NOT IN (SELECT principal FROM open_commitments)
- Apply the P1 § 5.2 erasure cascade
```

### 3.5 R5 — Personal content (post-erasure)

**Items**: any data lingering after a Tier-1 erasure run.

**Retention**: **30 days** maximum in backups; 0 elsewhere.

**Rationale**: GDPR-compliant systems should not preserve personal data in immutable backups indefinitely. We accept the 30-day backup window as operational necessity and disclose it.

**Implementation**:
- Backup retention policy on EFS / RDS: 30 days rolling.
- Backup decryption key (per-tenant KMS DEK for backup) is rotated quarterly; on erasure, the user's data is overwritten in backups within 30 days as new backups age out.
- Cross-region replicas (where enabled): same 30-day window.

### 3.6 R6 — Marketing / contact

**Items**: email addresses on the `invites` table where `acceptedBy IS NULL`; mailing-list subscribers (if added).

**Retention**: until withdrawal of consent + 30 days for residual processing wind-down.

**Rationale**: Art 7(3) — withdrawal must be as easy as giving consent.

**Implementation**: v1 has no marketing list. The `invites` table holds invitee emails until acceptance or expiry (default 30 days). On expiry: row deleted.

### 3.7 R7 — Operational logs

**Items**: HTTP request logs, error logs, metric logs in CloudWatch / Stackdriver.

**Retention**: **90 days**.

**Rationale**: operationally sufficient for debugging; bounded for storage cost.

**Implementation**:
- CloudWatch: log group retention set to 90 days at creation.
- Stackdriver: log bucket retention set to 90 days.
- Sentry / Datadog (if used): 90-day plan limit.

**PII redaction in logs**: logs MUST not contain personal data per IA 09-privacy-audit § D. We enforce via lint rule (`apps/web/src/lib/lint/no-pii-in-logs.ts` — build target) and CI scan.

### 3.8 R8 — Reference data

**Items**: `training_modules`, T-Box ontology, public contract ABIs, schema definitions, configuration.

**Retention**: indefinite. Not personal data. Not subject to GDPR.

## 4. Retention exceptions catalog

Cases where the default class is overridden:

| Item | Default class | Exception | Reason |
|---|---|---|---|
| Disbursement record | R3 (7 years) | R3+ if SOX customer | SOX retention |
| Vote record (on-chain) | R3 (7 years) | Forever (on-chain) | Immutability + governance audit |
| Outcome attestation | R3 (7 years) | Forever (on-chain) | Same |
| Pledge record (on-chain) | R3 (7 years) | Forever (on-chain) | Same |
| Revenue report | R3 (7 years) | — | Tax / BSA |
| Audit-log row linked to open security incident | R2 (1 year) | Until incident closed + 90 days | P11 |
| User data on hold for legal claim | R4 (active) | Until claim settles | Art 17(3)(e) |
| User data on hold for law-enforcement request | R4 (active) | Until request resolved | Compelled retention |

## 5. The legal-hold override

A **legal hold** is a freeze on automated purge for specified data, triggered by:
- Pending litigation discovery.
- Law-enforcement preservation request.
- Regulatory investigation.

**Implementation**:
- Table: `legal_holds` (build target — currently no table exists)
  - `id`, `kind` (litigation / le-request / regulatory), `subject` (principal or smart-account), `created_at`, `released_at`, `requesting_authority`, `case_reference`, `dpo_sign_off`
- Every purge cron consults `legal_holds`: if a row matches, skip.
- Legal holds are reviewed quarterly; released if no longer needed.

**Disclosure to user**: if a hold prevents the user's erasure request from completing, we disclose the existence of the hold (without revealing the case details if legally restricted).

## 6. On-chain retention

On-chain records are **forever** by construction. The retention question is: do we acknowledge this? Yes.

| Concern | Position |
|---|---|
| GDPR storage-limitation principle vs blockchain | The data on chain is **pseudonymous** after Tier-2 severance (P1 § 7.1). Pseudonymous data is still subject to storage limitation, but the "necessity" purpose persists for the lifetime of the chain (audit, governance, financial). |
| Right to be forgotten on chain | Cannot delete; rely on inactivation + tombstone + linkage severance (P1 § 5.2.4). |
| Customer-facing position | Disclose at signup (P1 § 8.1) and in retention notice. |

## 7. Automated purge mechanisms — implementation spec

### 7.1 Job scheduler

**Build target**: `apps/web/src/lib/jobs/scheduler.ts` — central job runner using node-cron or @vercel/cron; one cron per retention class.

### 7.2 Per-class jobs

```typescript
// apps/web/src/lib/jobs/retention/r1-sessions.ts
export async function purgeR1Sessions(): Promise<PurgeReport> {
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
  const deleted = await db.delete(sessions).where(lt(sessions.expiresAt, cutoff))
  return { class: 'R1', count: deleted.rowCount, runAt: new Date() }
}
```

Similar files for R2, R3 (with gate), R4, R5, R7.

### 7.3 Reporting

Each job emits a metric `retention_purge_<class>_count_total` + writes a row to `purge_audit` (kept under R2).

### 7.4 Failure handling

If a purge job fails, the operator is notified (PagerDuty / on-call rotation per P11). Retries with backoff; alert if 3 consecutive failures.

## 8. Backup retention

Cross-cutting with P2:

| Backup type | Window |
|---|---|
| RDS automated snapshot | 30 days |
| EFS daily snapshot | 30 days |
| S3 audit archive (R3 financial subset) | 7 years with object-lock |
| KMS key versions | Indefinite (cannot delete a KMS key version on AWS without affecting all data encrypted with it) |

**KMS-key-destruction-as-erasure**: the 30-day backup window is what enables our P1 § 5.2.1 model — we don't physically scrub backup tapes, we destroy the encryption key.

## 9. User-facing retention notice (privacy notice excerpt)

> ### How long we keep your data
>
> **While your account is active**, we keep your profile, prayers, oikos contacts, intents, and other personal data so the service can function.
>
> **If you delete your account**, we delete this data within **30 days**, except for:
> - **Financial records** (pledges, disbursements, revenue reports) — kept for **7 years** because US law requires it.
> - **Audit-log entries** — kept for **1 year** for security investigation.
> - **On-chain records** — permanent and cannot be deleted (see [signup disclosure](./signup-disclosures)).
>
> **If your account is inactive for 2 years**, we will warn you and then delete your data on the same schedule as above.
>
> **Session and operational logs** are kept for **90 days**.
>
> **Reference data** (the training-module catalog, the ontology, system configuration) is not about you and is kept indefinitely.

## 10. Monitoring

| Metric | Alarm threshold |
|---|---|
| `retention_purge_skipped_total` (legal hold) | Inform |
| `retention_purge_failure_total` | > 3 in 24h → page |
| `inactive_accounts_pending_purge` | Inform weekly |
| `users_no_purge_in_class_R1_30d` | > 0 in steady-state means cron is broken |
| `kms_key_destruction_pending_total` | Inform |

## 11. Open items

| ID | Item | Owner |
|---|---|---|
| RT1 | Build `apps/web/src/lib/jobs/scheduler.ts` | Developer |
| RT2 | Build per-class purge jobs (R1–R7) | Developer |
| RT3 | Build `legal_holds` table + DPO-controlled UI | Developer + Security |
| RT4 | Build hash-chain preserving audit purge | Security |
| RT5 | Inactive-account warning email pipeline | Developer + UX |
| RT6 | SOX-customer detection: how do we know which customers are SOX-regulated? | Security + counsel |
| RT7 | Publish customer-facing retention notice | UX + Documentarian |

## 12. Residual risk

1. **No purge runs today**: at v1 GA, retention enforcement is documentary but not automated. **Highest-priority build target**. Until cron exists, every retention claim in this doc is aspirational.

2. **KMS-key destruction does not retroactively scrub WAL / temp files**: SQLite WAL files, Postgres temp files, OS-level swap may contain plaintext. Mitigation: WAL checkpoint + VACUUM after batch deletes; disable swap or encrypt swap (LUKS, EBS gp3 encrypted-by-default).

3. **Distributed audit logs may slip through**: if a copy of an audit log was exported to a third-party SIEM (Datadog, Splunk), our purge does not reach there. Mitigation: contract-level requirement that SIEM partners honor our retention windows. Verify via P9.

4. **Backup window granularity**: a Tier-1 erasure executed within 1 day of a backup means the backup still has the user data for up to 29 days. This is the "30-day backup decay" we disclose. Sophisticated regulators may push for shorter (e.g., the Hamburg DPA's 2024 ruling on a fintech-backup case suggested 7 days). **[CONSULT COUNSEL]** on whether the 30-day window is defensible across our jurisdictions.

5. **Cross-region replicas extend the decay window**: if a customer opts into DR-grade cross-region replication, the backup decay may be 60 days. Disclosed in the DR-tier addendum.

## 13. Change log

| Date | Author | Change |
|---|---|---|
| 2026-05-18 | Security agent | Initial draft. |

---

**End of P4.**
