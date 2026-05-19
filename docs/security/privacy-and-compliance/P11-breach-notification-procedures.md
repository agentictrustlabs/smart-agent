# P11 — Breach Notification Procedures

> **Document status: DRAFT.**
> **Last updated: 2026-05-18.**

## 0. Executive summary

GDPR Art 33 requires a controller to notify the competent supervisory authority of a personal-data breach within **72 hours** of becoming aware, where feasible. Art 34 requires notification to data subjects "without undue delay" where the breach is likely to result in a high risk.

US state laws vary: California's Customer Records Act (Civ. Code § 1798.82) requires notification "in the most expedient time possible and without unreasonable delay," with sectoral floors (45 days for the CDPH Medical Data law). New York's SHIELD Act requires "as soon as possible." Some states impose specific day-counts; the longest typically 60 days post-discovery.

For Smart Agent, the **breach-response posture**:
- Pre-defined **on-call rotation** with incident commander.
- **72-hour external clock** starts at "awareness."
- Tiered severity with corresponding notification matrix.
- Annual tabletop exercise.
- Cyber-liability insurance (P10 § 9).

## 1. Definitions

**Personal data breach** (GDPR Art 4(12)):
> a breach of security leading to the accidental or unlawful destruction, loss, alteration, unauthorised disclosure of, or access to, personal data transmitted, stored or otherwise processed.

Three breach categories (EDPB Guidelines 9/2022 on personal-data-breach notification, 2023-03-28):
- **Confidentiality breach** — unauthorized disclosure or access.
- **Integrity breach** — unauthorized alteration.
- **Availability breach** — accidental or unauthorized loss of access or destruction.

A ransomware incident that locks data without exfiltration is an **availability** breach, often combined with **integrity** uncertainty.

## 2. Severity tiers

| Tier | Definition | Notification path |
|---|---|---|
| **SEV-1** | Confirmed exfiltration of `S+` data (link secrets, signing keys, `users.privateKey`); OR exfiltration of `S` data affecting >100 data subjects; OR catastrophic availability (>4h full outage) | Supervisory authority + affected data subjects; press statement; insurer |
| **SEV-2** | Confirmed exfiltration of `S` data affecting ≤100 subjects; OR exfiltration of `P` / `B` data at scale (>1000 subjects); OR partial-availability >2h | Supervisory authority; affected data subjects; insurer |
| **SEV-3** | Near-miss with no confirmed exfiltration; OR limited-impact integrity issues; OR <2h availability | Internal; case-by-case authority/customer notice |
| **SEV-4** | Hardening opportunity discovered without active breach (e.g., vulnerability report) | Internal track + remediate |

**Note**: GDPR notification thresholds and US state thresholds differ. Our **operational** SEV mapping above is the internal escalation; the **legal-notification decision** is made by counsel based on the specific facts.

## 3. The 72-hour clock — when does it start?

Art 33(1) says "after having become aware of it." EDPB Guidelines 9/2022 § 33 clarify: awareness is when the controller has a "reasonable degree of certainty" that a security incident has occurred and that the incident has led to personal data being compromised.

**Smart Agent operational rule**:
- A SEV-2 or SEV-1 trigger event begins the **internal clock at minute 0**.
- The DPO declares "awareness" formally at the point when investigation confirms personal data compromise (or persistent uncertainty rises to "reasonable degree of certainty").
- The **72-hour external clock starts at DPO declaration**.
- The DPO's declaration must follow investigation by no more than 24 hours from initial trigger; further delay requires escalation to legal counsel with rationale.

## 4. Internal escalation matrix

| Trigger | First responder | Within 15 min | Within 1 hour | Within 4 hours |
|---|---|---|---|---|
| Alert on `unauthorized_kms_decrypt_total > 0` | On-call engineer | Page incident commander | Convene IR call | DPO + counsel notified |
| Alert on `replay_nonce_collision_total > X` | On-call | Investigate; assess SEV | Page IC if SEV-2+ | Same |
| User report of unexpected activity | Support → On-call | Triage; classify | If credible → IC | DPO + counsel |
| Third-party vulnerability report (e.g., bug bounty) | Security inbox | Acknowledge | Assess | If SEV-2+, IC + DPO |
| Sub-processor breach notification | Vendor management | Forward to IC | Assess scope | DPO + customers |

## 5. Roles in incident response

| Role | Person/team | Responsibility |
|---|---|---|
| **Incident Commander (IC)** | On-call lead | Owns the incident end-to-end; makes operational calls |
| **Investigator** | Security engineer | Forensics; scope determination |
| **Communicator** | Designated PR / Comms | External notifications; press; customer comms |
| **Counsel** | Outside counsel | Legal-position guidance; notification decisions |
| **DPO** | Per P10 § 4.2 | GDPR-specific notification decisions; supervisory authority interface |
| **Engineering remediator** | Eng lead | Patch; mitigate |
| **Customer success** | CS lead | Direct outreach to affected customer DPOs |
| **Executive sponsor** | CEO/CTO | Sign-off on external statements; financial decisions |

## 6. External notification matrix

### 6.1 GDPR supervisory authorities

For EU customers, notification goes to the lead supervisory authority (LSA) under the GDPR one-stop-shop. The LSA is determined by the location of the controller's main establishment.

**For Smart Agent as a processor**, we notify our customer (the controller) without undue delay (Art 33(2)), and assist them with their authority notification.

**For Smart Agent as a controller** (e.g., for our own employees' data, or for data subjects we contracted directly with), we notify our LSA. Default LSA: TBD based on Smart Agent's legal entity location. **[CONSULT COUNSEL]**

### 6.2 US state attorneys general / regulators

Notification thresholds vary; Schreiber et al. maintain a state-by-state breach-notification chart (Baker Hostetler, latest 2024).

Generally:
- **California** — notify CA AG if >500 California residents affected (Civ. Code § 1798.82(f)).
- **New York** — notify NY AG if any NY residents affected (Gen. Bus. Law § 899-aa) per the 2019 SHIELD Act.
- **Texas, Virginia, others** — variable thresholds; generally notify state AG if >500 residents.
- **Sectoral**: HIPAA breaches notify HHS OCR (P12); GLBA breaches notify primary functional regulator.

### 6.3 Data subject notification (Art 34)

Required when the breach is "likely to result in a high risk to the rights and freedoms of natural persons."

Exemptions (Art 34(3)):
- (a) Appropriate technical / organizational measures applied to the affected data (encryption / pseudonymization) rendered it unintelligible to unauthorized persons.
- (b) Subsequent measures ensure that the high risk is no longer likely to materialize.
- (c) Disproportionate effort — in which case a public communication or similar measure suffices.

**Smart Agent posture**: pseudonymization-defense (P1 § 7.1) may qualify under Art 34(3)(a) for some breaches involving on-chain data, but does NOT apply to off-chain personal data exfiltration. Off-chain breaches presumptively require Art 34 notification.

### 6.4 Customer notification

Contractual obligations to customers (in the DPA we sign with each):
- Notify within **24 hours** of confirmed personal data breach affecting their data.
- Provide an initial impact assessment within 48 hours.
- Provide a full post-incident report within 30 days.

### 6.5 Press / public

For SEV-1, a press statement may be necessary even where not legally required:
- Pre-empt rumor.
- Set the narrative.
- Direct affected parties to authoritative information.

Press statement template kept in `docs/security/privacy-and-compliance/breach-templates/press.md` (build target).

## 7. Notification content (Art 33(3))

Each authority notification must include at least:

- (a) Description of the nature of the breach including categories and approximate number of data subjects and records concerned.
- (b) Name and contact details of the DPO or contact point.
- (c) Description of the likely consequences.
- (d) Description of measures taken or proposed to be taken to address the breach and mitigate possible adverse effects.

**Phased notification is allowed**: if all information cannot be provided within 72 hours, an initial notification can be made followed by updates "without further undue delay."

## 8. Notification templates

Maintained in `docs/security/privacy-and-compliance/breach-templates/`:

| Template | Recipients |
|---|---|
| `authority-en.md` | EU LSA |
| `authority-state-ag-us.md` | US state AGs |
| `customer-dpo.md` | Customer DPOs (B2B contractual) |
| `data-subject-email.md` | Affected end users |
| `data-subject-public.md` | If Art 34(3)(c) public-notice path |
| `press.md` | Press statement |
| `internal-statusupdate.md` | Internal employees |

Each template has placeholders for: incident summary, date of discovery, data categories affected, number of subjects, mitigation, contact for questions.

## 9. Tabletop exercise

### 9.1 Cadence

**Annual minimum**; SEV-1 should also trigger a post-incident review that doubles as a tabletop.

### 9.2 Scenarios

Maintain a library; rotate annually:

1. **"AWS key compromise"** — IAM credentials of a service role leaked via a misconfigured GitHub Action. What detection? What response?
2. **"AnonCreds vault exfiltration"** — Askar file copied off the EFS by an insider with shell access. What recovery? What user impact?
3. **"Smart-contract bug enabling unauthorized delegation"** — a CVE in a `DelegationManager` upgrade allowing forgery. What revocation? What user comms?
4. **"GraphDB SQL injection (SPARQL)"** — leak of pseudonymous addresses correlated to public on-chain assertions. What impact assessment? What disclosure?
5. **"Sub-processor breach"** — Vercel reports a vulnerability that affects our customer log streams. What customer comms cascade?
6. **"Insider — disgruntled employee"** — privileged employee exfiltrates data on the way out. What containment? What legal action?
7. **"Ransomware"** — primary RDS encrypted with ransom demand. What restoration? What customer comms?

### 9.3 Format

- 2-hour facilitated session.
- Cross-functional attendance (IC, DPO, counsel, eng lead, exec sponsor).
- Real-time, role-played; injects every 15 minutes.
- Output: lessons-learned doc + remediation tickets.

## 10. Forensic capability

Pre-incident, build:
- **Log preservation** — when an incident is declared, automatically snapshot logs into an immutable bucket (`s3://smart-agent-incidents-prod/<case-id>/`) with object-lock.
- **Forensic image capability** — ability to take a point-in-time snapshot of EFS volumes (built into AWS Backup).
- **Network packet capture** — VPC Flow Logs always-on; pcap on-demand via VPC Traffic Mirroring if needed.
- **Forensics retainer** — pre-arranged contract with a forensics firm (CrowdStrike Services, Mandiant, Kroll). Activate within 1 hour of SEV-1.

## 11. Cyber-liability insurance

**Recommendation**: carry cyber-liability coverage with at minimum:
- $5M per incident / $10M aggregate (raise as customer base grows).
- Breach-response coverage (forensics, legal, comms).
- Regulatory-defense coverage.
- Privacy-liability coverage (third-party claims).
- Business-interruption coverage.
- Cyber-extortion coverage.

**Notable carriers**: Beazley, Chubb, AIG, Travelers, Coalition (cyber-native).

**Approximate annual premium** for a v1 SaaS with our risk profile: **$10k–$30k**.

**Notification requirement**: most policies require notice within 24-48 hours of awareness to preserve coverage.

## 12. Recordkeeping (Art 33(5))

Even breaches that do NOT meet the notification threshold must be documented internally.

`docs/security/privacy-and-compliance/breach-register.md` (build target) — append-only:

| Date | Case ID | Type | SEV | Authority notified? | Subjects notified? | Resolved |
|---|---|---|---|---|---|---|

Retention: indefinite (Art 5(2) accountability principle).

## 13. Post-incident review

Within 30 days of incident closure:

1. **What happened** — timeline.
2. **Detection** — what caught it; what didn't.
3. **Response** — what worked; what didn't.
4. **Impact** — confirmed; estimated.
5. **Root cause** — technical + organizational.
6. **Remediation** — tickets opened; deadlines.
7. **Lessons learned** — for the team; for the tabletop library.
8. **Disclosure track** — to whom; when; outcome.

## 14. Customer DPA breach clauses (what we promise)

Excerpt for customer DPAs:

> Processor shall notify Controller of any Personal Data Breach affecting Controller's data within twenty-four (24) hours of becoming aware. Notification shall include, to the extent then known:
> (a) the nature of the breach, including the categories and approximate number of data subjects and records;
> (b) the likely consequences of the breach;
> (c) measures taken or proposed to address the breach.
> Processor shall provide additional information as it becomes available and shall provide a full post-incident report within thirty (30) days of incident closure.
> Processor shall assist Controller in fulfilling Controller's notification obligations under Articles 33 and 34 GDPR.

## 15. Open items

| ID | Item | Owner |
|---|---|---|
| BR1 | Build breach-templates library | Security + Legal |
| BR2 | Build automated incident-log snapshot | Infra |
| BR3 | Procure forensics retainer | Security + Procurement |
| BR4 | Procure cyber-liability insurance | CFO + Security |
| BR5 | Schedule first tabletop exercise | Security |
| BR6 | Build breach register | Security + Documentarian |
| BR7 | Define LSA based on legal-entity location | Counsel |
| BR8 | Train all engineers on the IR playbook | Security + HR |

## 16. Residual risk

1. **Awareness latency**: silent compromise (no detection for weeks/months) prevents the 72-hour clock from being meaningful. Mitigation: defense-in-depth detection (CloudWatch + anomaly detection + dedicated SIEM at scale + bug bounty).

2. **Misclassification at the SEV gate**: under-triaging a SEV-2 as SEV-3 delays notification, exposing GDPR liability. Mitigation: error toward over-classification; periodic auditor review of SEV decisions.

3. **Sub-processor breach lag**: AWS / Vercel may identify a breach in their system before they notify us. Mitigation: contractual notification clauses; subscribe to their status pages; participate in vendor advisory programs.

4. **Multiple-jurisdiction conflict**: GDPR 72-hour SLA vs longer US state SLA — we follow the strictest applicable. But if regulator-specific content requirements conflict (e.g., one requires inclusion of PII categories another forbids), counsel decides.

5. **Communication-error in disclosure content**: a poorly-worded data-subject email could amplify rather than mitigate panic. Mitigation: templates reviewed by counsel and comms; rehearsed in tabletops.

6. **Forensics evidence gaps**: if logs were not collected at the time of incident, post-hoc forensics is harder. Mitigation: continuous logging at SOC 2 standard (P10).

## 17. Change log

| Date | Author | Change |
|---|---|---|
| 2026-05-18 | Security agent | Initial draft. |

---

**End of P11.**
