# A6 — Incident Response Runbooks

> **Status**: Draft. Eight scenario runbooks + the common framework that
> wraps them + the tabletop / lessons-learned cadence.
>
> **Audience**: on-call SRE, incident commander, comms lead, legal
> liaison, executive sponsor. Each scenario is written so a person who
> has *never* seen this scenario before can execute it under stress.
>
> **Effort**: M (initial runbook authorship) + S (tabletop scheduling) +
> ongoing (post-incident updates).
>
> **Owner**: security lead (Incident Commander rotation).
>
> **Reading time**: ~60 min cover-to-cover; each runbook ~10 min.

---

## 1. Roles and decision authority

Every incident is run by four roles. Smaller incidents collapse roles
onto fewer people; the four roles still exist conceptually.

| Role | Responsibilities | Decision authority |
|---|---|---|
| **Incident Commander (IC)** | Owns the response. Drives the decisions. Calls the start / end of an incident. Allocates the other roles. The IC is on-call rotation; whoever pages first when a P1 fires *becomes* IC unless they hand off. | Containment actions, recovery actions, scope declaration, comms approval. |
| **Comms Lead** | External comms (status page, customer email, regulator) and internal comms (Slack #incident-<id>, exec briefings). | Drafts; IC approves before publishing. |
| **Tech Lead** | Drives the technical investigation. Runs queries, executes containment scripts, coordinates with developer / infra on-call. | Technical containment / eradication actions (the actual `kubectl`, `aws`, `pnpm tsx` commands). Reports to IC. |
| **Legal Liaison** | Regulatory notification clock; preservation order receipt; outside counsel coordination. | Triggers legal hold (A2 §7) and regulator notice deadlines. |

The IC role rotates weekly. Pager schedule lives in PagerDuty
(`infra/pagerduty/`).

`[OWE-REVIEWER]` — the IC binder lives in a shared, access-controlled
location (1Password vault `incident-response`). Contains: vendor support
hotlines, regulator contact list, outside counsel contact list, status-
page admin credentials, customer-comms template doc.

## 2. Common framework

Every runbook below follows the same five-section structure:

| Section | Question it answers |
|---|---|
| **Detection** | "How do we know this is happening?" — the alert, the signal, the customer report, the anomaly. |
| **Containment** | "What do we do in the next 15 minutes to stop the bleeding?" — immediate mitigations, even at the cost of degraded service. |
| **Eradication** | "What is the root cause and how do we permanently fix it?" — the slower, root-cause-driven work. |
| **Recovery** | "How do we return to normal?" — restore service, lift any temporary restrictions, validate end-to-end. |
| **Post-mortem** | "What did we learn?" — blameless write-up, action items into Linear/GitHub, update this doc. |

### 2.1 Severity matrix

| Severity | Definition | Page? | Status page? | Exec notice? | Reg notice clock? |
|---|---|---|---|---|---|
| **P1** | Active customer-data exposure, active fund loss, total outage. | Yes — phone | Yes within 30 min | Yes within 30 min | Yes (varies; see 4.4 / 5.4) |
| **P2** | Confirmed compromise without active loss; degraded service to majority of users. | Yes — Slack + SMS | Yes within 1 hr | Yes within 2 hr | Maybe |
| **P3** | Confirmed compromise, contained; minor service impact. | Yes — Slack | Optional | Yes within 1 day | No |
| **P4** | Anomaly under investigation; not yet confirmed. | No — ticket only | No | No | No |

## 3. Scenario 1 — Key compromise

Covers four sub-cases: master / bundler / sessionIssuer / user-account
private-key exposure. Each has a different blast radius and response.

### 3.1 Detection

- **K6 alert** — CloudTrail signals unusual KMS API activity (use from
  an unexpected role, off-hours decrypt burst, KMS:Sign by an actionId
  not seen before).
- **A4 detector 3.6** — KMS Decrypt rate above per-principal baseline.
- **External report** — security researcher / customer / exchange flags
  abnormal signing.
- **Manual discovery** — incident response team finds a key fingerprint
  in a leaked credential dump.

Severity: **P1** for master, bundler, or sessionIssuer. **P2** for a
single user-account private key (blast radius is bounded by that account
+ its delegations).

### 3.2 Containment

**For master / bundler / sessionIssuer (system keys)**:

1. **Within 5 minutes — IC paged.** IC opens `#incident-<id>` Slack
   channel, declares scope.
2. **Within 10 minutes — rotate the compromised key**. Tech Lead executes
   `K1-rotation-procedure.md`'s emergency path:
   - `pnpm tsx scripts/kms-emergency-rotate.ts --key <name> --reason "<incident-id>"`
   - The script provisions a new KMS version, updates the runtime
     pointer, and emits an audit row.
3. **Within 15 minutes — invalidate all live sessions** signed by the
   compromised key (a2a-agent `/admin/sessions/revoke-all` endpoint;
   requires IC token). Users will see a "please sign in again" UI.
4. **Within 20 minutes — pause new delegation issuance** to prevent the
   attacker from creating delegations under the rotated key for any
   sessions they still control. `pnpm tsx scripts/marketplace-feature-flag.ts --disable`
   (or the equivalent for delegation-mint flow).
5. **Within 30 minutes — Comms Lead publishes status page** at P1
   severity. Initial copy is intentionally brief: "We are investigating
   a security event affecting authentication. New sessions are
   temporarily disabled. More information within the hour."

**For user-account private key (passkey-only users are not affected;
this is for the EOA-co-owner edge case)**:

1. IC contacted; severity **P2**.
2. Tech Lead identifies the affected user(s) via key fingerprint.
3. Operator runs `pnpm tsx scripts/suspend-user.ts --subject <userId>
   --reason "key-compromise-<incident-id>"` (A4 §5.1 override path).
4. Comms Lead emails affected users individually with steps to rotate
   their own credentials.

### 3.3 Eradication

1. **Root cause analysis**. Tech Lead enumerates:
   - Source of compromise (leaked credential, insider, CI exposure, KMS
     IAM mis-config).
   - Time window of unauthorised use.
   - Every audit row signed by the compromised key in that window.
2. **Patch the vector**. Examples:
   - Revoke the IAM role that leaked.
   - Tighten the KMS policy.
   - Rotate any other credentials the attacker may have lateral access to.
3. **Update K6 + A4 detectors** to catch the same vector earlier next
   time.

### 3.4 Recovery

1. Validate the rotated key produces signatures that verify (run
   `scripts/verify-audit-chain.ts` end-to-end).
2. Re-enable new sessions; users sign in again with their normal flow.
3. Re-enable delegation issuance.
4. Status page closed; "all clear" comms.
5. Audit chain head verified against the L4 anchor — if the anchor is
   intact, attacker did not forge new audit history.

### 3.5 Post-mortem

- **48-hour deadline** for the blameless write-up.
- Posted in `docs/security/postmortems/<YYYY-MM-DD>-key-compromise-<id>.md`.
- Action items filed in GitHub with the `incident:<id>` label.
- This doc updated if the runbook missed anything.

### 3.6 Regulatory clock

If user account data was exposed (even indirectly, through key-derived
session access), the GDPR Art 33 72-hour clock starts at the *moment we
suspected* the breach. Legal Liaison engages outside counsel within 2 hr
of P1 declaration.

## 4. Scenario 2 — Smart contract bug discovered

A vulnerability is reported in a deployed contract — by a security
researcher, an audit firm follow-up, a chain-fuzzer, or an active exploit.

### 4.1 Detection

- **External report via bug bounty** (SC3 channel — `security@smart-agent`
  inbox).
- **A4 detector 3.8** — anomalous treasury withdrawal rate.
- **On-chain monitoring** — Tenderly / Forta alert on a known-exploit
  signature.
- **Internal discovery** by a developer / auditor.

Severity: **P1** if active exploitation; **P2** if reported but no active
exploitation observed.

### 4.2 Containment

1. **Within 10 minutes — IC paged.** Open `#incident-<id>`.
2. **Within 15 minutes — pause withdrawals if possible**. AgentAccount
   has a `pauseExecution()` function reachable by the bundler-signer
   multisig (see SC4). IC instructs Tech Lead to invoke it.
3. **If pause is not possible** (e.g. the bug is in a path that bypasses
   the pause):
   - Disable the relevant feature flag in a2a-agent so the UI cannot
     issue userOps targeting the vulnerable selector.
   - Front-run with our own protective transactions if economically
     viable (whitehat rescue of remaining funds to a holding multisig).
   - Brief external researcher with a public PSA so users self-exit if
     possible.
4. **Within 30 minutes — status page**: "Smart contract advisory.
   Withdrawals temporarily paused while we investigate. Funds are
   reachable; no funds have been lost (or: funds estimated at $X have
   been compromised; we are working with [law enforcement / chain
   analytics])."

### 4.3 Eradication

1. Reproduce the bug in a test on `packages/contracts/test/`.
2. Develop a patch contract.
3. Audit the patch contract with the bug bounty reporter (or with the
   SC1 firm on retainer) — fast-tracked review (24–72 hr).
4. Deploy patched implementation via SC4 governance multisig.
5. Migrate affected accounts via the standard upgrade path.

### 4.4 Recovery

1. Validate patched contracts on testnet for 24 hr.
2. Re-enable feature flags.
3. Status page closed.
4. Comms Lead drafts the public write-up after legal review (see 4.5).

### 4.5 Regulatory + comms

- **If funds lost**: 24 hr public disclosure (industry norm via @samczsun
  precedent; not a hard regulatory requirement but expected by the
  ecosystem).
- **Customer notification** to affected users within 48 hr including
  reimbursement plan (if any).
- **Insurance claim** filed if the bug-bounty reporter is owed payout
  per SC3.
- **Outside counsel** on the wire — securities law angle if treasury
  involved.

### 4.6 Post-mortem

- 7-day deadline for the public write-up (post-fix, post-comms).
- Update SC2 (formal verification) to add the proof of correctness for
  the patched function.
- Update SC5 (reentrancy / external call audit) with the lesson.

## 5. Scenario 3 — Data breach (PII)

Customer PII has been exposed — leaked to an unauthorised party.

### 5.1 Detection

- **A3 RULE-A3-TENANT-01** — cross-tenant SELECT attempt detected.
- **A4 detector 3.7** — anomalous session creation rate (could indicate
  credential stuffing leading to PII access).
- **Customer report** — user sees their data on someone else's screen,
  or in a public location.
- **Researcher report** — public-facing endpoint leaks data without
  authentication.
- **Internal discovery** by a developer or auditor.

Severity: **P1**.

### 5.2 Containment

1. **Within 5 minutes — IC paged.**
2. **Within 15 minutes — stop the leak**. If the cause is an
   endpoint mis-configuration, push a hot-fix (the relevant route is
   `return Response.json({ error: 'temporarily unavailable' }, { status: 503 })`).
3. **Within 20 minutes — preserve evidence**. Legal Liaison invokes
   legal hold (A2 §7) on the relevant log sources for the suspected
   exposure window.
4. **Within 30 minutes — quantify scope**. Tech Lead runs:
   - `lookupProvenance(...)` per A5 against the audit rows from the
     exposure window.
   - The output gives the IC the list of users whose data was accessed.

### 5.3 Eradication

1. Root cause analysis. Examples:
   - Authorisation check missing on a new route.
   - Cross-tenant query lacking `WHERE tenant_id = ?`.
   - Caching layer keyed without tenant id.
2. Patch.
3. Add a property test to G-phase coverage that catches the same class
   of bug.
4. Add a Datadog detector (A3) that catches a similar regression.

### 5.4 Recovery

1. Patched code deployed; lift the 503.
2. Status page updated.
3. **Customer notification**:
   - GDPR Art 34 — notify *each affected data subject* "without undue
     delay" *if the breach is likely to result in high risk to their
     rights and freedoms*. For PII breach, assume yes.
   - CCPA — similar requirement.
   - SOC2 BCM — required if certified.
4. **Regulator notification**:
   - GDPR Art 33 — 72-hour clock to the relevant Data Protection
     Authority.
   - State AGs (US) per state breach-notification laws.
   - Other jurisdictions as our customer footprint dictates (Legal
     Liaison owns the mapping).

### 5.5 Post-mortem

- 7-day deadline.
- The post-mortem itself is reviewed for what it can and cannot say
  publicly (some details remain confidential for customer protection).
- Action items include: G-phase property test, A3 detector, and any
  contractual remedies owed to affected customers.

## 6. Scenario 4 — DDoS attack

Sustained traffic that overwhelms web edge / a2a-agent / MCPs.

### 6.1 Detection

- **R2 WAF alerts** — sustained 429 / 503 rate from the edge.
- **A4 detector 3.4** — audit-row growth rate spike (legitimate user
  activity from the attack? probably not, but cross-check).
- **PagerDuty** from synthetic monitoring (status check fails).

Severity: **P2** if service is degraded but reachable; **P1** if total
outage.

### 6.2 Containment

1. **Within 5 minutes — IC paged.**
2. **Within 10 minutes — Cloudflare "Under Attack Mode"** enabled (per
   R2). Triggers JavaScript challenge for every visitor; eliminates
   90%+ of bot traffic.
3. **Within 15 minutes — rate limits tightened** at the edge. R5 already
   has the policy; under-attack mode pushes thresholds 5× lower.
4. **Within 30 minutes — status page**: "We are mitigating a denial-of-
   service attempt. The site may be slow or temporarily unreachable.
   No customer data is affected."

### 6.3 Eradication

1. Identify attack signature (botnet IPs, attack pattern, target endpoint).
2. Implement permanent WAF rules.
3. Coordinate with upstream provider (Cloudflare, Vercel) on filtering
   at their edge.

### 6.4 Recovery

1. Once attack subsides, dial back Under Attack Mode (1 hr cool-off).
2. Status page closed.

### 6.5 Post-mortem

- 7-day deadline.
- Customers do NOT typically need direct notification for DDoS — the
  status page suffices. Legal Liaison confirms.

## 7. Scenario 5 — Insider threat

A current or former employee is suspected of malicious activity.

### 7.1 Detection

- **A3 RULE-A3-KMS-01** + A4 detector 3.6 — anomalous KMS activity by an
  authorised principal.
- **HR signal** — a departing employee, an HR escalation, a credible
  whistleblower report.
- **A4 detector 3.10** — abnormal manager dispatch rate.

Severity: **P2** unless active exfil; **P1** if active.

### 7.2 Containment

1. **IC paged.** **HR + Legal on-bridge from minute zero** — this is a
   personnel matter as much as a technical one.
2. **Within 30 minutes — revoke the employee's access** (`pnpm tsx
   scripts/access-revoke.ts --user <id> --all-systems`). Triggers:
   - SSO disable
   - GitHub access revoke
   - AWS / GCP IAM disable
   - PagerDuty / Slack / 1Password access revoke
3. **Within 1 hr — preserve evidence**. Legal Liaison invokes legal
   hold on:
   - All audit chain rows attributable to the employee's identity
   - All Datadog logs for the relevant period
   - All git activity in the relevant repos
   - All AWS / GCP CloudTrail events under the employee's IAM identity
4. **Within 2 hr — scope assessment**. Provenance lookup (A5) across all
   actions taken by the employee in the suspect window.

### 7.3 Eradication

1. Determine if the employee actually performed the suspected actions
   (not all signals are confirmed; HR review of the human side runs in
   parallel with the technical investigation).
2. Rotate any credentials the employee had touched (assume worst case
   even if some signals are unconfirmed).
3. Audit any code merged by the employee in the suspect window.

### 7.4 Recovery

1. If confirmed false positive: re-grant access; document the cleanup.
2. If confirmed insider threat: outside counsel engaged; criminal
   referral if warranted; civil action; insurance claim if applicable.

### 7.5 Post-mortem

- The post-mortem is *partially confidential* — the technical findings
  are recorded; the HR / legal proceedings are not. The IC writes both
  the technical and the redacted external versions.

## 8. Scenario 6 — Cloud provider outage

AWS region down, GCP project suspended, Vercel deploy pipeline broken.

### 8.1 Detection

- **PagerDuty** from synthetic monitoring.
- **Provider status page** confirms.

Severity: **P1** if customer-visible.

### 8.2 Containment

1. **IC paged.**
2. **Within 10 minutes — confirm scope** with the provider's status page.
   Is it the whole region? A specific service?
3. **Within 30 minutes — failover if available**:
   - A2A KMS dual-backend (AWS + GCP) — if AWS is the outage, switch to
     GCP path via `A2A_KMS_BACKEND=gcp-kms`. The provider memory captures
     this dual-backend posture.
   - If Vercel is the outage and we have a backup deploy target (TBD
     Phase H), failover.
   - If we have no failover for the affected service, status page the
     outage and wait.
4. **Status page** with affected components named.

### 8.3 Eradication

1. Outside our control — provider works the outage.
2. We work the *recovery* side: data consistency checks, any operations
   that need replay.

### 8.4 Recovery

1. Confirm provider service restored.
2. Run reconciliation scripts to validate state consistency.
3. Status page closed.

### 8.5 Post-mortem

- Provider's post-mortem received (typically 1–2 weeks later).
- Our post-mortem focuses on what *our* mitigations did and didn't do.
- Action items typically: improve failover, improve detection, improve
  customer-comms latency.

## 9. Scenario 7 — GraphDB corruption / poisoning

The agentic-trust ontology data store is corrupted, deliberately
poisoned, or returns incorrect SPARQL results.

### 9.1 Detection

- **A4 detector 3.11** — live-ack count discrepancy.
- **Customer report** — agent discovery returning wrong results.
- **Internal discovery** by an ontologist.

Severity: **P2** in most cases (GraphDB is the discovery substrate; not
direct authority).

### 9.2 Containment

1. **IC paged.**
2. **Within 30 minutes — snapshot the current state** (S3 export of all
   named graphs) for forensics.
3. **Within 1 hr — switch discovery to a read-only replica or to the
   last known-good snapshot**.
4. Status page: "Agent discovery may show stale results while we
   investigate a data quality issue."

### 9.3 Eradication

1. Identify the source of the bad data (a misbehaving sync job, a
   malicious A-Box write, a software bug).
2. Patch the source.
3. Restore from the on-chain → GraphDB sync (the on-chain assertions are
   the source of truth; GraphDB is the mirror per IA P4). The mirror
   can be fully rebuilt from on-chain events.

### 9.4 Recovery

1. Full re-sync from on-chain.
2. Validate sample queries match pre-incident output.
3. Status page closed.

### 9.5 Post-mortem

- Update IA documents and the sync job to detect this class of corruption
  earlier.

## 10. Scenario 8 — Sub-processor breach

A third party we depend on has a breach affecting our data.

### 10.1 Detection

- **Sub-processor's incident notification** (per their DPA — typically
  72 hr from their discovery).
- **Public news** of a major provider breach (AWS S3, OpenAI, etc.).

Severity: **P2** initially; escalate based on assessment.

### 10.2 Containment

1. **IC paged.**
2. **Within 1 hr — assess our exposure**:
   - Which data did we entrust to this sub-processor?
   - Was it encrypted at rest with keys they don't hold?
   - Was the breach in the specific service we use, or a different
     service?
3. **Within 2 hr — rotate any credentials shared with the sub-processor**.
4. **Within 4 hr — internal exec briefing** with assessment.

### 10.3 Eradication

1. If our data was exposed: invoke our own breach-notification path
   (Scenario 3) for any of our customers affected.
2. If only credentials were exposed: rotate, monitor for misuse, ED3
   detective controls active.
3. Re-evaluate the sub-processor's risk tier (ED2). May trigger contract
   re-negotiation or vendor change.

### 10.4 Recovery

1. Sub-processor confirms remediation.
2. We confirm no lingering exposure.
3. Update ED2 vendor risk file.

### 10.5 Post-mortem

- Heavy emphasis on whether ED2 risk tiering was correct.
- Whether ED3 supply-chain controls would have caught it earlier.
- Whether ED5 DPA terms gave us adequate notice latency (if not, push
  for shorter notice clauses on next renewal).

## 11. Tabletop exercise programme

### 11.1 Cadence

- **Quarterly**: 2-hr tabletop, one of the eight scenarios above. Roll
  through the eight on a 2-year cycle so each is exercised every 6 months.
- **Annually**: a half-day cross-scenario exercise (e.g. key compromise
  *and* DDoS simultaneously — common adversary pattern).
- **Ad-hoc**: after any P1 incident, a 1-hr "what would we do
  differently" review (technically a retro, not a tabletop, but logged
  in the same cadence).

### 11.2 Format

1. **Pre-read** (1 week before): scenario + relevant runbook sections.
2. **Tabletop** (2 hr): facilitator reads scenario, participants walk
   through Detection → Containment → Eradication → Recovery → Post-mortem.
   Hot-seat: a different person plays IC each time.
3. **Debrief** (within 7 days): written summary in
   `docs/security/tabletops/<YYYY-MM-DD>-<scenario>.md`. Action items
   filed.

### 11.3 Scoring

Three measures per tabletop:

1. **Time to first containment action** (target: < 15 min from page).
2. **Correctness of decisions** (peer review post-exercise).
3. **Coverage of runbook** (did the participants reach the post-mortem
   section, or did they get stuck mid-containment?).

Failure modes are NOT scored against the individual playing IC; they
are scored against the *runbook clarity*. If the IC got stuck, the
runbook needs a fix.

### 11.4 Calendar

`[OWE-REVIEWER]` — the next 8 quarters' tabletop schedule lives in
`docs/security/tabletops/SCHEDULE.md`. Maintained by the security lead.

## 12. Lessons-learned log

Every incident or tabletop produces a row in
`docs/security/lessons-learned.md`:

| Date | Trigger | Lesson | Action item | Owner | Status |
|---|---|---|---|---|---|
| 2026-MM-DD | (incident or tabletop id) | (one-line lesson) | (one-line action) | (person) | (in-progress / done) |

Reviewed quarterly during the tabletop cadence. Stale "in-progress" rows
are escalated.

## 13. Implementation tasks

| # | Task | Owner | Effort |
|---|---|---|---|
| A6-T1 | Provision PagerDuty schedules (primary + secondary) | infra | S |
| A6-T2 | IC binder set up in 1Password vault `incident-response` | security | S |
| A6-T3 | `scripts/kms-emergency-rotate.ts` written + tested | developer | M |
| A6-T4 | `scripts/access-revoke.ts` written + tested | developer + infra | M |
| A6-T5 | `scripts/suspend-user.ts` (also used by A4) — confirm | developer | S |
| A6-T6 | `scripts/marketplace-feature-flag.ts` for emergency disable | developer | S |
| A6-T7 | Status page provider chosen + provisioned (Statuspage.io / Atlassian Statuspage) | infra | S |
| A6-T8 | Customer-comms templates per scenario reviewed by legal | comms + legal | M |
| A6-T9 | `docs/security/tabletops/SCHEDULE.md` populated 8 quarters ahead | security | S |
| A6-T10 | `docs/security/lessons-learned.md` skeleton + first quarterly review on the calendar | security | S |
| A6-T11 | First tabletop run (suggested: Scenario 3 PII breach) | security + IC | M |
| A6-T12 | Outside-counsel + regulator contact list documented | legal | S |

## 14. Acceptance criteria

- [ ] All 12 implementation tasks completed
- [ ] First quarterly tabletop run + debrief published
- [ ] Time-to-first-containment metric < 15 min observed in tabletop
- [ ] Each runbook section reviewed by the role that would execute it
- [ ] IC binder vault access tested by every named IC
- [ ] Status page templates reviewed by legal

## 15. Open questions

- `[OPEN] A6-1`: Pre-positioning of customer-comms templates — do we
  pre-draft customer notification emails for each scenario, or improvise?
  Recommendation: pre-draft, gated for legal review at incident time.
- `[OPEN] A6-2`: How do we handle the case where the IC is the compromised
  party (e.g. insider threat where the on-call human is implicated)?
  Need an explicit "no-confidence" hand-off path. Defer to a security
  programme review.
- `[OPEN] A6-3`: External incident communications — do we use Twitter /
  X / Mastodon? At what severity? Comms Lead owns the per-channel policy.
- `[OPEN] A6-4`: Bug-bounty payout coordination during a live incident —
  the bounty programme's normal payout cadence is decoupled from incident
  comms. Confirm with SC3.

## 16. Cross-references

- A1 — audit chain anchor verification appears in §3.4 (key compromise
  recovery)
- A2 — legal hold mechanism per §5.2 / §7.2
- A3 — every Critical / High signal cross-references the relevant
  runbook section
- A4 — auto-suspend mechanism preempts some Containment steps
- A5 — provenance lookup is the primary scoping tool in §3.3 / §5.2
- K1 — KMS rotation procedure invoked by §3.2
- K6 — CloudTrail detection feeds §3.1 / §7.1
- SC3 — bug bounty intake feeds §4.1
- R2 — WAF "Under Attack Mode" invoked by §6.2
- ED2 — vendor risk tiering feeds §10.3
- ED5 — sub-processor DPA terms feed §10.2 / §10.3

## 17. Glossary

- **IC** — Incident Commander.
- **Page** — paging a human via PagerDuty for immediate response.
- **Containment** — short-term action that stops harm, even at the cost
  of degraded service.
- **Eradication** — root-cause-driven permanent fix.
- **Recovery** — return to normal service after eradication.
- **Post-mortem** — blameless write-up; aims to improve systems, not
  punish individuals.
- **Tabletop** — pen-and-paper rehearsal of a runbook without live
  infrastructure changes.

---

*Last updated: 2026-05-18. Owner: Security lead (Incident Commander
rotation).*
