# P9 — Sub-Processor Inventory

> **Document status: DRAFT.**
> **Last updated: 2026-05-18.**

## 0. Executive summary

GDPR Art 28 requires controllers to use only processors providing "sufficient guarantees" of compliant processing, executed via a written contract (Data Processing Agreement / DPA). Where a processor engages a sub-processor, the original processor remains liable to the controller for the sub-processor's compliance.

For Smart Agent, the **controllers** are the customer organizations who deploy Smart Agent for their members. Smart Agent operates as a **processor** for those customer organizations and engages **sub-processors** (AWS, Vercel, etc.) downstream.

This document inventories the sub-processors, their roles, their DPA status, and the customer-facing transparency commitment.

## 1. Sub-processor list (current)

### 1.1 Amazon Web Services (AWS)

| Service | Used for | PII processed? |
|---|---|---|
| RDS Postgres | Web app database (post Phase F.2) | Yes — `users` table |
| ECS Fargate | Container runtime for web app + MCPs + a2a-agent | Yes — at-rest on EFS |
| EFS | Persistent storage for MCP SQLite + Askar | Yes |
| KMS | Cryptographic key management | Yes (envelope-encryption of `S` data) |
| S3 | Audit-archive storage; bundle delivery for P6/P7 exports | Yes |
| CloudWatch | Log aggregation | Should be no PII; gap-monitored (P3 § 7) |
| SES | Transactional email | Yes — email addresses |
| IAM | Identity / role management | No PII |
| VPC, NAT, ELB | Network plumbing | No PII (metadata only) |
| ACM | TLS certificates | No PII |

**DPA**: AWS GDPR DPA (current as of 2024-09); SCCs incorporated. DPF certification verified 2024-10. Cross-reference: https://aws.amazon.com/compliance/gdpr-center/

**Sub-processor cascade**: AWS uses its own sub-processors for some services (e.g., third-party network providers in specific regions). The AWS Sub-Processor List is published; Smart Agent monitors for changes.

**Region pin**: per P2 § 2, all customer-facing AWS resources are pinned to the customer's region (EU recipe: `eu-west-1`; US recipe: `us-east-1`).

### 1.2 Google Cloud Platform (GCP) — alternative deployment

For customers preferring GCP-hosted (some EU customers prefer Frankfurt GCP over Frankfurt AWS):

| Service | Used for | PII processed? |
|---|---|---|
| Cloud SQL Postgres | Web app database | Yes |
| Cloud Run / GKE | Container runtime | Yes (at-rest) |
| Filestore | Persistent storage | Yes |
| Cloud KMS | Cryptographic key management | Yes |
| Cloud Storage | Audit archive; export bundles | Yes |
| Cloud Logging | Logs | Should be no PII |
| Cloud DNS | Network | No |

**DPA**: Google Cloud Platform DPA (current as of 2024-09). DPF certification verified.

### 1.3 Vercel

| Service | Used for | PII processed? |
|---|---|---|
| Vercel Edge | Static asset CDN | No (assets are non-PII) |
| Vercel Functions | Server-side Next.js rendering | Yes (in-flight; not persisted by Vercel) |
| Vercel Log Drains | Forward logs to CloudWatch / Stackdriver | Pass-through only |
| Vercel Analytics | Anonymous usage metrics | No PII (IP truncated, no user identifiers) |

**DPA**: Vercel GDPR DPA (current as of 2024-10). DPF certification verified.

**Sub-processor**: Vercel runs on AWS — AWS is a Vercel sub-processor. Documented in Vercel's sub-processor list.

### 1.4 Ontotext GraphDB (`graphdb.agentkg.io`)

| Service | Used for | PII processed? |
|---|---|---|
| GraphDB SaaS | Knowledge graph triplestore | Yes — pseudonymous addresses + public on-chain mirror |

**Status**: cloud-hosted (region to be confirmed — see P2 § 1.5). **DPA: required pre-GA.** Currently operating on a verbal arrangement; signed DPA outstanding.

**Action**: Security agent to procure signed DPA from Ontotext before GA. **Highest-priority sub-processor task.**

### 1.5 OpenAI (text-to-speech for demo narration)

| Service | Used for | PII processed? |
|---|---|---|
| OpenAI TTS API | Demo video narration generation | No (only public demo script text) |

**Verification**: the narration scripts (in `output/` per demo-video assets) do not contain user PII. Only demo-persona text. The TTS API processes the text in transit; OpenAI's data-handling policy retains for 30 days for abuse monitoring.

**DPA**: OpenAI Enterprise DPA (current). Per OpenAI's API usage policy, content submitted via API is NOT used for model training by default.

**Risk**: low for v1; we keep this listed to ensure if any flow ever pipes user content to OpenAI we add the appropriate gate.

### 1.6 Auth0 / Auth provider (if used)

Currently: NO third-party auth provider. Auth is sessionless passkey + SIWE + demo + Google OAuth (per project_sessionless_passkey_siwe.md). Google OAuth flows do touch Google but Google's data handling is governed by user's Google account, not by us; we receive only the OAuth subject + email.

If we add Auth0 / Clerk / similar later, add to this list with DPA.

### 1.7 Email delivery — Postmark / SendGrid / Mailgun

For non-AWS-SES deployments. Choice TBD; currently using AWS SES (§ 1.1).

### 1.8 Error tracking — Sentry (if used)

| Service | Used for | PII processed? |
|---|---|---|
| Sentry SaaS | Application error tracking | Could be — stack traces may contain PII in arg values |

**Status**: not currently in use. If added, requires (a) DPA, (b) `beforeSend` hook to strip PII from breadcrumbs, (c) data-scrubbing rules configured.

### 1.9 Observability — Datadog (if used)

| Service | Used for | PII processed? |
|---|---|---|
| Datadog APM / logs / metrics | Application performance monitoring | Could be — log forwards may carry PII |

**Status**: not currently in use. If added, requires DPA + region-specific instance (EU customer → Datadog EU region).

### 1.10 Cyber-liability insurance carrier

Treated as recipient of incident data (P11). Their DPA covers limited processing for claim handling.

### 1.11 Customer-support tooling — Intercom / Zendesk / Front (if used)

| Service | Used for | PII processed? |
|---|---|---|
| Support inbox | Customer inquiries | Yes — user emails + content |

**Status**: not currently in v1; manual `privacy@` mailbox routed to Gmail / standard mail. **Plan**: move to a tooled inbox with DPA before scaling.

### 1.12 Sub-processor for permissioned-chain operators

If the permissioned chain is operated by a third party (e.g., a chain-as-a-service provider), they are a sub-processor for the on-chain data. Smart Agent currently runs its own validator nodes; this row is informational.

## 2. Sub-processor summary table

| Sub-processor | Service category | DPA signed | DPF | SCCs | Region pinned | Priority for customer disclosure |
|---|---|---|---|---|---|---|
| AWS | Infrastructure | Yes | Yes (2024-10) | Yes (in DPA) | Yes | Always |
| GCP | Infrastructure | Yes | Yes | Yes | Yes | When used |
| Vercel | Hosting | Yes | Yes | Yes | Yes | Always |
| Ontotext GraphDB | Knowledge graph | **Pending** | TBD | Per DPA | TBD | Always |
| OpenAI | TTS | Yes | Yes | Yes | N/A | Demo-only |
| Google (OAuth) | Identity | N/A — user's relationship | N/A | N/A | N/A | When user opts to use Google sign-in |
| Sentry | Error tracking | Not used | — | — | — | Future |
| Datadog | Observability | Not used | — | — | — | Future |
| Postmark/SendGrid | Email (alt to SES) | Not used | — | — | — | Future |
| Intercom/Zendesk | Support | Not used | — | — | — | Future |

## 3. Sub-processor change notification

GDPR Art 28(2): a processor must "inform the controller in advance of any intended changes concerning the addition or replacement of sub-processors, thereby giving the controller the opportunity to object."

**Smart Agent commitment** (in customer DPAs):
- Notify of new sub-processors at least **30 days** in advance via the customer-facing sub-processor page (§ 4) plus an email to the customer's DPO of record.
- Customer has 30 days to object.
- If the customer objects and the change is material to their compliance, we negotiate (alternative sub-processor, exclusion from that customer's deployment) or, in the worst case, the customer's right to terminate without penalty.

## 4. Customer-facing sub-processor page

Publish at `smart-agent.example/privacy/sub-processors`:

```markdown
# Sub-Processors

This page lists every third party that processes personal data on behalf of Smart Agent customers. We update this page within 30 days when a sub-processor changes.

| Sub-Processor | Purpose | Location | DPF | DPA |
|---|---|---|---|---|
| Amazon Web Services, Inc. | Cloud hosting (compute, storage, KMS, email) | Customer's region | Yes | Signed |
| Google LLC | Alternative cloud hosting (compute, storage, KMS) | Customer's region | Yes | Signed |
| Vercel, Inc. | Web hosting + edge runtime | Customer's region (pinned) | Yes | Signed |
| Ontotext AD | Knowledge graph hosting | EU | TBD | Signed |
| OpenAI, LLC | Demo narration (no customer content processed) | US | Yes | Signed |

Customers can subscribe to changes via [link]. To object to a sub-processor change, email privacy@smart-agent.example.

Last updated: YYYY-MM-DD
```

## 5. Internal sub-processor governance

| Process | Owner |
|---|---|
| Add new sub-processor | Procurement + Security + Counsel review; DPA signed before any data flows |
| Renew DPA | Annual review; calendar reminder; counsel re-reviews if material change |
| Monitor DPF certification | Quarterly check on US-recipient DPF status |
| Monitor sub-processor's own sub-processors | Subscribe to each sub-processor's update feed (AWS, Vercel publish lists) |
| Annual sub-processor audit | Security agent reviews each sub-processor's SOC 2 report (or equivalent) |
| Incident notification cascade | When a sub-processor reports a breach affecting our data, P11 § 4 applies |

## 6. Sub-processor risk tiers

| Tier | Definition | Examples | Review cadence |
|---|---|---|---|
| **Tier 1** | Processes `S+` or `S` data; could compromise users at scale | AWS, GCP, Vercel, GraphDB | Quarterly review |
| **Tier 2** | Processes `S` data but in limited volume | Email provider, support tooling (when added) | Semi-annual |
| **Tier 3** | Processes `P` / `B` only; or `S` only transiently | Sentry, Datadog, OpenAI for demo TTS | Annual |

## 7. DPA quality checklist

Each sub-processor DPA must:
- [ ] Identify the sub-processor and the parties to the contract.
- [ ] Specify the subject matter, duration, nature, purpose, type of personal data, and categories of data subjects (GDPR Art 28(3)).
- [ ] Bind the sub-processor to written instructions only (Art 28(3)(a)).
- [ ] Bind to confidentiality (Art 28(3)(b)).
- [ ] Bind to security measures (Art 28(3)(c) + Art 32).
- [ ] Address engagement of further sub-processors (Art 28(3)(d)).
- [ ] Provide assistance with data subject rights requests (Art 28(3)(e)).
- [ ] Provide assistance with security, breach notification, DPIA, prior consultation (Art 28(3)(f)).
- [ ] Specify deletion / return of data at end of services (Art 28(3)(g)).
- [ ] Provide audit rights (Art 28(3)(h)).
- [ ] Include EU SCCs (Module 2 — controller-to-processor) or be DPF-certified for EU→US transfers.
- [ ] Include UK IDTA for UK transfers.

Tracked in `docs/security/privacy-and-compliance/dpa-tracker.md` (build target — currently this README + § 2 table only).

## 8. Sub-processor failure scenarios

What if a sub-processor:

- **Suffers a breach**: P11 § 4 cascade. Smart Agent must notify its customers and (where applicable) supervisory authorities.
- **Loses DPF certification**: fall back to SCCs only; assess transfer impact; notify customers of the status change.
- **Discontinues a service we depend on**: emergency migration plan. Each tier-1 sub-processor has a fallback documented in `docs/architecture/12-production-boundary-change-plan.md`.
- **Refuses to renew DPA**: terminate engagement; migrate data; notify customers.

## 9. Open items

| ID | Item | Owner |
|---|---|---|
| SP1 | Procure Ontotext GraphDB signed DPA | Security + Procurement |
| SP2 | Confirm Ontotext hosting region | Infra |
| SP3 | Build `dpa-tracker.md` | Documentarian |
| SP4 | Build sub-processor change-notification email pipeline | Developer |
| SP5 | Build public sub-processor page | Documentarian + UX |
| SP6 | Configure Datadog / Sentry data-scrubbing rules BEFORE either is enabled in production | Developer + Security |

## 10. Residual risk

1. **Ontotext DPA pending**: until signed, EU customer engagement with the GraphDB sub-processor is not formalized. **Pre-GA blocker**.
2. **AWS sub-processor cascade**: AWS uses its own sub-processors that we cannot directly contract with. We inherit their compliance via AWS's own audits. Reliant on AWS's SOC 2 and ISO 27001 certifications.
3. **DPF instability**: EU-US Data Privacy Framework remains subject to legal challenge. We monitor; fallback is SCC-only mode.
4. **Hidden third-party calls**: a future SDK update could introduce a network call to a third party not on this list. Mitigation: CI check that fails if `package.json` adds a dependency with known network behaviors (heuristic; not perfect).
5. **Sub-processor's sub-processors**: we have visibility one level deep; deeper-level sub-processors are governed by our direct sub-processors. Mitigation: contract clauses requiring tier-1 sub-processors to maintain GDPR-compliant cascades.

## 11. Change log

| Date | Author | Change |
|---|---|---|
| 2026-05-18 | Security + Infra | Initial draft. |

---

**End of P9.**
