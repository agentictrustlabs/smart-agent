# P10 — SOC 2 Type 2 Readiness

> **Document status: DRAFT.**
> **Last updated: 2026-05-18.**

## 0. Executive summary

SOC 2 is a voluntary attestation framework administered by the AICPA (American Institute of Certified Public Accountants) under the SSAE 18 standard. A SOC 2 Type 2 report attests to the **operating effectiveness** of an organization's controls against the AICPA Trust Services Criteria (TSC) over an observation period (typically 6–12 months). It is the most common third-party audit enterprise customers ask for.

This document specifies:
1. **Which TSC categories Smart Agent will be in scope for.**
2. **The gap-assessment plan** — pre-audit work to identify and close control gaps.
3. **The auditor selection** — recommended firms, cost estimates.
4. **The 18-month timeline** from kickoff to issued report.
5. **The internal control list** mapped to TSC.

## 1. SOC 2 in 5 minutes

- **SOC 2 Type 1**: attestation of *design* of controls at a point in time. Useful as a milestone; not what enterprise customers want.
- **SOC 2 Type 2**: attestation of *operating effectiveness* over a 3-12 month observation window. The serious version.
- **Trust Services Criteria (TSC 2017 with 2022 Points of Focus revisions)**:
  - **Security** — mandatory. Protection against unauthorized access.
  - **Availability** — optional. System available for operation and use.
  - **Processing Integrity** — optional. Processing complete, valid, accurate, timely, authorized.
  - **Confidentiality** — optional. Confidential information is protected.
  - **Privacy** — optional. Personal information collected, used, retained, disclosed per commitments.

For a SaaS in our space, customers typically expect **Security + Availability + Confidentiality**. Privacy is increasingly added; **Smart Agent should include Privacy** given the load-bearing privacy posture.

## 2. Scope

### 2.1 In-scope systems

Per the system description (a SOC 2 deliverable):

- Web application (`apps/web`)
- A2A agent (`apps/a2a-agent`)
- Person-MCP (`apps/person-mcp`)
- Org-MCP (`apps/org-mcp`)
- Geo-MCP, verifier-MCP (`apps/geo-mcp`, `apps/verifier-mcp`)
- Permissioned EVM chain operations (validator infrastructure)
- KMS infrastructure (AWS + GCP)
- GraphDB integration
- All sub-processors (P9) — referenced as carve-outs (Subservice Organization model)

### 2.2 In-scope categories

| TSC | In scope? | Justification |
|---|---|---|
| Security | Yes (mandatory) | — |
| Availability | Yes | Enterprise customers depend on uptime |
| Processing Integrity | Yes | Smart-account integrity is core to the value proposition |
| Confidentiality | Yes | Custodial vaults and credential material |
| Privacy | Yes | Custodial PII + AnonCreds; GDPR exposure |

### 2.3 Sub-service organizations (carve-out)

Per AICPA Section 320 carve-out method, we list our sub-processors (P9) as Sub-service Organizations. Customer due-diligence then reviews their SOC reports (AWS SOC 2 / SOC 3 publicly available; GCP same; Vercel SOC 2 available; Ontotext — to procure).

## 3. Auditor selection

### 3.1 Top-tier firms

- **Deloitte** — premium pricing; thorough; brand recognition.
- **PwC** — same tier.
- **EY** — same tier.
- **KPMG** — same tier.

For a v1 SaaS, Big-Four is generally overkill. Cost: $80k–$150k for first Type 2.

### 3.2 Specialist firms (recommended for v1)

- **Schellman & Company, LLC** — large specialist; widely accepted by enterprise.
- **A-LIGN** — large specialist; broad coverage.
- **Coalfire** — specialist; strong in tech/cloud.
- **Insight Assurance** — mid-size specialist; flexible.
- **Prescient Assurance** — smaller; agile.
- **Sensiba LLP** (formerly Sensiba San Filippo) — west-coast tech focus.

Typical cost for a SaaS startup first Type 2 with these firms: **$30k–$80k** depending on scope and TSC count.

### 3.3 Recommendation

For v1: **Schellman or A-LIGN** — both have strong reputations with enterprise buyers and reasonable pricing. Conduct an RFP with 3 firms; choose based on responsiveness + price.

## 4. Internal organization

### 4.1 Roles

| Role | Responsibility |
|---|---|
| **Sponsor** | Executive ownership; signs off on scope and budget |
| **SOC 2 program lead** | Day-to-day coordination; auditor liaison |
| **Data Protection Officer (DPO)** | Privacy TSC; per Art 37–39 if also EU-required |
| **Security lead** | Security TSC |
| **Engineering lead** | Confidentiality + Processing Integrity TSC |
| **Operations lead** | Availability TSC |
| **HR / People** | Personnel controls (background checks, training) |

### 4.2 DPO appointment

GDPR Art 37 mandates DPO appointment for controllers and processors whose core activities consist of:
- Regular and systematic monitoring of data subjects on a large scale (Art 37(1)(b)), OR
- Large-scale processing of special-category data (Art 37(1)(c)).

Smart Agent processes religious belief data (a special category) on a large scale once we scale. **Recommendation**: appoint a DPO before EU GA, even if interpretation of "large scale" is borderline at v1. The DPO is also the natural owner of the Privacy TSC in SOC 2.

## 5. Pre-audit gap assessment (4-6 weeks)

The gap assessment is the **delta** between current controls and SOC 2 requirements. Performed either internally (free, slower, less rigorous) or by the chosen audit firm pre-engagement (paid, faster, sets a baseline relationship).

### 5.1 Recommendation

Pay the audit firm $10k-$20k for a 4-week gap assessment. The output:
- Per-control gap document.
- Remediation roadmap with effort estimates.
- Updated systems description.

### 5.2 Common gaps for a v1 startup

| Gap | Typical remediation effort |
|---|---|
| No formal security policies | 1-2 weeks: write, review, sign |
| No employee onboarding/offboarding checklist | 1 week |
| No access-review cadence | 1 week to define; ongoing operations |
| No vendor-risk-assessment process | 1-2 weeks to define; ongoing |
| No change-management workflow | Often partial; formalize via PR template + CODEOWNERS |
| No incident-response plan | 2 weeks; tabletop exercise |
| No business-continuity / DR plan | 2-3 weeks |
| No log retention policy | 1 week — see P4 |
| No background-check policy | 1 week |
| No security-awareness training | Vendor (KnowBe4, Curricula); 1 week to procure |
| No penetration testing | 4-8 weeks for first pen test |

## 6. Control list per TSC

Detailed control mapping. Each control has an ID (`CC1.1` etc. for Common Criteria), description, evidence, owner.

### 6.1 Common Criteria (mandatory for Security TSC)

**CC1 — Control Environment**

- CC1.1 — The entity demonstrates a commitment to integrity and ethical values. *Evidence*: Code of Conduct policy; new-hire acknowledgement.
- CC1.2 — The board of directors demonstrates independence from management and exercises oversight. *Evidence*: Board charter; meeting minutes addressing security.
- CC1.3 — Management establishes structure, reporting lines, authorities, and responsibilities. *Evidence*: Org chart; security RACI matrix.
- CC1.4 — The entity demonstrates a commitment to attract, develop, retain competent individuals. *Evidence*: Hiring criteria for security-impacting roles.
- CC1.5 — The entity holds individuals accountable for their internal control responsibilities. *Evidence*: Performance reviews; security KPIs.

**CC2 — Communication and Information**

- CC2.1 — Internal communication of objectives and responsibilities for internal control. *Evidence*: Security policies published internally; acknowledgements.
- CC2.2 — Communications with external parties. *Evidence*: Privacy notice (P5); breach notification process (P11).
- CC2.3 — Information needed to support functioning of internal control. *Evidence*: Logging + monitoring (CloudWatch / Stackdriver per P4).

**CC3 — Risk Assessment**

- CC3.1 — Specifies suitable objectives. *Evidence*: Annual risk-assessment exercise; documented in `docs/security/risk-register.md` (build target).
- CC3.2 — Identifies and analyzes risk. *Evidence*: Threat model `docs/architecture/11-production-threat-model.md`.
- CC3.3 — Considers fraud risk. *Evidence*: Fraud-risk section of threat model.
- CC3.4 — Identifies and assesses changes that could significantly impact the system of internal control. *Evidence*: Change-management process; SOC 2-impacting changes flagged.

**CC4 — Monitoring Activities**

- CC4.1 — Selects, develops, and performs ongoing/separate evaluations. *Evidence*: Continuous monitoring of CloudWatch alarms; quarterly internal audit.
- CC4.2 — Evaluates and communicates internal-control deficiencies. *Evidence*: Quarterly security report to leadership.

**CC5 — Control Activities**

- CC5.1 — Develops control activities. *Evidence*: This document set + adjacent security docs.
- CC5.2 — Develops general control activities over technology. *Evidence*: KMS (P2); access controls; encryption.
- CC5.3 — Deploys control activities through policies + procedures. *Evidence*: Policy library.

**CC6 — Logical and Physical Access Controls**

- CC6.1 — Implements logical access security software, infrastructure, and architecture. *Evidence*: IAM policies; SSO (build target for internal staff); MFA-mandatory; key custody per `packages/sdk/src/key-custody/`.
- CC6.2 — Manages user identities and credentials. *Evidence*: Joiner-mover-leaver process; offboarding checklist.
- CC6.3 — Authorizes, modifies, removes access. *Evidence*: Access-review cadence; PR-based access changes.
- CC6.4 — Restricts physical access. *Evidence*: All servers are cloud-managed (AWS / GCP); no Smart Agent physical data center.
- CC6.5 — Discontinues logical/physical protection over assets only after authorization. *Evidence*: Decommissioning checklist.
- CC6.6 — Implements logical access security measures to protect against threats. *Evidence*: WAF (Cloudflare or AWS WAF); rate limiting; replay-nonce; etc.
- CC6.7 — Restricts transmission and movement of information. *Evidence*: TLS 1.3 enforced; region-pinning per P2.
- CC6.8 — Prevents or detects and acts upon the introduction of unauthorized or malicious software. *Evidence*: Dependency scanning; CI security checks.

**CC7 — System Operations**

- CC7.1 — Detects and monitors known vulnerabilities. *Evidence*: Snyk / Dependabot; CVE feeds.
- CC7.2 — Monitors components for anomalies. *Evidence*: CloudWatch anomaly detection; SIEM alerts.
- CC7.3 — Evaluates security events to determine response. *Evidence*: Incident-response procedures (P11).
- CC7.4 — Responds to identified security incidents. *Evidence*: IR playbook + post-incident review.
- CC7.5 — Implements activities to recover from identified security incidents. *Evidence*: Recovery procedures; tabletop exercises.

**CC8 — Change Management**

- CC8.1 — Authorizes, designs, develops, configures, documents, tests, approves, implements changes. *Evidence*: GitHub PR workflow; CODEOWNERS; CI gates; release procedures.

**CC9 — Risk Mitigation**

- CC9.1 — Identifies, selects, and develops risk-mitigation activities. *Evidence*: Risk register.
- CC9.2 — Assesses and manages risks associated with vendors and business partners. *Evidence*: Vendor-risk process; P9.

### 6.2 Availability (A1)

- A1.1 — Maintains capacity to meet processing demands. *Evidence*: Capacity planning; autoscaling.
- A1.2 — Authorizes, designs, implements environmental protections (backup, recovery). *Evidence*: Backup schedule per P4; RTO/RPO documented in `docs/architecture/10-operational-architecture.md`.
- A1.3 — Tests recovery procedures. *Evidence*: Annual DR test.

### 6.3 Processing Integrity (PI1)

- PI1.1 — Obtains, generates, uses relevant, quality information. *Evidence*: Input validation everywhere.
- PI1.2 — Processing inputs are complete, accurate, timely, authorized. *Evidence*: Schema validation (Zod); signature verification on every on-chain interaction.
- PI1.3 — Output is complete, accurate, timely. *Evidence*: Test coverage.
- PI1.4 — Stored data is complete, accurate, timely, authorized. *Evidence*: Database constraints; transactional integrity.
- PI1.5 — Modifies processing as needed. *Evidence*: Change-management.

### 6.4 Confidentiality (C1)

- C1.1 — Identifies and maintains confidential information. *Evidence*: PII classification (P3).
- C1.2 — Disposes of confidential information. *Evidence*: Erasure SOP (P1); retention purge (P4).

### 6.5 Privacy (P1–P8)

The AICPA Privacy TSC has its own internal numbering P1–P8 (not to be confused with this document set's P1–P12).

- AICPA P1 — Notice and communication of objectives. *Evidence*: Privacy notice; signup disclosures (P1 § 8).
- AICPA P2 — Choice and consent. *Evidence*: Consent UX (this set's P5).
- AICPA P3 — Collection. *Evidence*: Data minimization (this set's P8).
- AICPA P4 — Use, retention, disposal. *Evidence*: Retention policies (this set's P4); erasure (this set's P1).
- AICPA P5 — Access. *Evidence*: Right of access (this set's P6).
- AICPA P6 — Disclosure and notification. *Evidence*: Sub-processor inventory (this set's P9); breach notification (this set's P11).
- AICPA P7 — Quality. *Evidence*: Rectification process (informal v1; formalize for SOC 2).
- AICPA P8 — Monitoring and enforcement. *Evidence*: Quarterly compliance review.

## 7. Evidence collection

For Type 2, evidence must be collected **throughout the observation window**. The auditor samples — they don't review every event, but they review enough to attest to operating effectiveness.

### 7.1 Evidence types

| Type | Examples |
|---|---|
| **Configuration evidence** | IAM policies, KMS key policies, firewall rules, S3 bucket policies |
| **Process evidence** | PR reviews, change-management tickets, incident-response cases |
| **Monitoring evidence** | CloudWatch dashboards, alert history, on-call response records |
| **Training evidence** | Employee training completion records |
| **Personnel evidence** | Background-check records, offboarding tickets |
| **Vendor evidence** | DPAs, sub-processor SOC reports |

### 7.2 Continuous monitoring tooling

Compliance automation tools collect evidence continuously:

- **Drata** — purpose-built; common for SaaS startups; $15k–$50k/year.
- **Vanta** — same category.
- **Secureframe** — same category.
- **Thoropass** (formerly Laika) — same.

**Recommendation**: invest in Drata or Vanta from the start of the gap assessment. Pays back in auditor hours saved.

## 8. Timeline (18 months from start)

| Month | Activity |
|---|---|
| M0 | Sponsor commitment; budget approved; DPO appointed |
| M1 | Gap assessment with chosen auditor |
| M2–M4 | Remediation work; policies written; tooling deployed (Drata/Vanta); pen test (first) |
| M5 | Internal readiness review |
| M6 | Observation window starts (6-month minimum for Type 2; 12-month preferred) |
| M6–M12 | Continuous evidence collection; quarterly internal audits; quarterly auditor check-ins |
| M12 | Auditor begins formal Type 2 fieldwork |
| M14 | Report drafted |
| M15 | Report issued |
| M16+ | Annual surveillance audit cycle begins |

**Compressed alternative (12 months)**: 6-month observation window instead of 12. Acceptable to most enterprise buyers but a longer window builds stronger evidence.

## 9. Cost summary

| Item | Range |
|---|---|
| Gap assessment | $10k–$20k |
| Audit (first Type 2) | $30k–$80k (Schellman / A-LIGN tier) |
| Pen test (first) | $15k–$30k |
| Pen test (annual recurring) | $10k–$25k |
| Compliance automation tool | $15k–$50k/year |
| Security-awareness training | $1k–$5k/year |
| Insurance (cyber liability) — see P11 | $5k–$30k/year |
| Internal time | ~0.5 FTE-quarter total for the lead, plus ~0.1 FTE-quarter for cross-functional contributors |
| **Total 18-month** | **~$75k–$200k** |

## 10. SOC 2 vs ISO 27001 vs CSA STAR

| Framework | Region | Common adoption | Recommendation |
|---|---|---|---|
| SOC 2 | US-leaning, increasingly global | High among US enterprise | **Pursue first** |
| ISO 27001 | EU-leaning, global | High among EU enterprise | Pursue after SOC 2 |
| CSA STAR | Cloud-focused, global | Niche but increasing | After ISO 27001 |
| HITRUST | US healthcare | Only if HIPAA scope materializes | Conditional (P12) |

SOC 2 attestation maps with significant overlap to ISO 27001 — pursuing both incrementally is cost-efficient.

## 11. Continuous compliance (post first audit)

Annual surveillance audits maintain attestation. Steady-state activities:

- Quarterly internal audit against control list.
- Annual pen test.
- Annual policy review.
- Quarterly access review.
- Annual DR test.
- Annual security-awareness training refresh.
- Continuous monitoring via Drata/Vanta.

## 12. Audit readiness self-assessment (current state, 2026-05-18)

| Area | Current state | Gap |
|---|---|---|
| Security policies | Partial (`docs/security/principles.md` etc.) | Need formal policy documents per SOC 2 |
| Access controls | Strong (IAM, KMS, PR-based) | Need formal joiner-mover-leaver |
| Logging | Strong (CloudWatch + structured logs) | Need SIEM-style aggregation + alerts |
| Backup / DR | Partial (snapshots) | Need documented RTO/RPO + tested DR |
| Change management | Strong (GitHub PR + CI) | Formalize change classification |
| Incident response | Document exists (P11) | Need tabletop + playbook artifacts |
| Vendor management | Partial (P9) | Need formal vendor-risk process |
| Personnel | Minimal | Need policies, training, background checks |
| Risk assessment | Partial (threat model exists) | Annual cadence needed |
| Privacy controls | Documented (this set) | Need operating evidence |

**Estimated effort to remediate**: 3-4 months full-time for one program lead + 0.2-0.4 FTE from engineering and operations.

## 13. Customer-facing messaging

We do NOT claim SOC 2 status until the report is issued. Pre-report:

> "We are pursuing SOC 2 Type 2 attestation. Our observation window starts {date}. We expect the report to be available {date+12mo}. In the meantime, we can share our security posture documentation under NDA."

Post-report:

> "Smart Agent is SOC 2 Type 2 attested across Security, Availability, Processing Integrity, Confidentiality, and Privacy. Our most recent report covers {start} to {end}. Request a copy of the report (under NDA) at security@smart-agent.example."

## 14. Open items

| ID | Item | Owner |
|---|---|---|
| SOC1 | Executive sponsor + budget approval | Leadership |
| SOC2 | DPO appointment | Leadership |
| SOC3 | Auditor selection (RFP 3 firms) | Security lead |
| SOC4 | Gap assessment kickoff | Security lead |
| SOC5 | Policy library — first draft | Security + HR |
| SOC6 | Compliance-automation tool selection (Drata/Vanta) | Security |
| SOC7 | Pen test scheduling | Security + Infra |
| SOC8 | DR test scheduling | Infra |
| SOC9 | Security-awareness training vendor | HR + Security |

## 15. Residual risk

1. **Pre-attestation deal blocks**: enterprise customers may decline to sign without an in-flight or completed SOC 2. Mitigation: share interim posture under NDA; provide reference customers; share `docs/security/` openly.

2. **Type 1 as bridge**: a Type 1 report could be obtained in ~3 months as a bridge before Type 2 is ready. Often acceptable to a buyer needing immediate evidence. Cost ~$15k.

3. **Scope creep during audit**: auditors may identify new in-scope systems mid-engagement. Mitigation: rigorous boundary definition in the systems description; carve-outs for sub-processors.

4. **Operating-effectiveness failures**: a single missed access review, an un-patched CVE, or a forgotten background check during the observation window can produce a qualified opinion. Mitigation: compliance-automation tool flags drift in real time.

5. **Audit firm dependency**: switching auditors mid-cycle is expensive. Choose carefully.

## 16. Change log

| Date | Author | Change |
|---|---|---|
| 2026-05-18 | Security agent | Initial draft. |

---

**End of P10.**
