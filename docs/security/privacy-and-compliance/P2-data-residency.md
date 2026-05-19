# P2 — Data Residency

> **Document status: DRAFT.**
> **[CONSULT COUNSEL]** marks every clause requiring data-protection counsel sign-off.
> **Last updated: 2026-05-18.**

## 0. Executive summary

Data residency answers "where does my data physically sit?" — a question with both regulatory weight (GDPR Chapter V on international transfers; Schrems II; UK adequacy; Togo cross-border rules) and customer-trust weight.

Smart Agent's v1 architecture has five tiers of storage:
1. **Web application code + edges** — Vercel.
2. **Web application data** — SQLite (dev) / Postgres on AWS RDS (prod, Phase F.2).
3. **MCP data (person, org, geo, etc.)** — SQLite + Askar files on the MCP container host (AWS ECS Fargate prod target).
4. **Key material** — AWS KMS (prod default) or GCP KMS (alternative deployment).
5. **Knowledge graph** — Ontotext GraphDB at `graphdb.agentkg.io` (cloud-hosted, EU region — to be verified).
6. **On-chain state** — Permissioned EVM chain; validator nodes geographically distributed.

The **two customer-facing residency commitments** we will support at v1 GA:
- **EU recipe**: data flows stay within EU/EEA (AWS `eu-west-1` Ireland or `eu-central-1` Frankfurt; GCP `europe-west1` Belgium or `europe-west3` Frankfurt; GraphDB instance in EU; Vercel routing to EU edges).
- **US recipe**: data flows stay within US (AWS `us-east-1` Virginia or `us-west-2` Oregon; GCP `us-central1` Iowa; GraphDB instance in US; Vercel routing to US edges).

Multi-region replication is **not** v1; each tenant gets a single region.

## 1. Per-store residency inventory

### 1.1 Vercel (web hosting)

| Concern | v1 commitment |
|---|---|
| Compute regions | Customer-selectable: EU recipe → `fra1` (Frankfurt) + `dub1` (Dublin) only; US recipe → `iad1` (Washington DC) + `sfo1` (San Francisco) only |
| Static asset CDN | Vercel's global edge cache — assets are **non-personal** by design; no PII in static assets (verified by P3 § 4) |
| Function execution | Pin via `vercel.json` `"regions"` config; documented in `infra/vercel/README.md` (to be built) |
| Logs | Vercel log drains routed to region-pinned CloudWatch or Stackdriver; not Vercel's own log retention |
| Sub-processor for Vercel | AWS (Vercel runs on AWS); Vercel's DPA covers this — see P9 § 2 |

**Action required v1**: PR adding `"regions": ["fra1", "dub1"]` to EU-tenant `vercel.json`, US-tenant analog. Currently `vercel.json` has no region pin — meaning Vercel may execute in any region per its default routing. **Gap to close before EU GA.**

### 1.2 Web Postgres (web SQL, post Phase F.2)

| Concern | v1 commitment |
|---|---|
| RDS region | EU recipe: `eu-west-1`. US recipe: `us-east-1` |
| Encryption at rest | KMS-managed; per-tenant DEK if customer requires (see § 4) |
| Backups | Same region; cross-region replicas only with customer opt-in |
| Read replicas | Same region |
| Multi-AZ | Yes (within region) |

**Current state**: Phase F.2 is the migration from SQLite to Postgres. Until Phase F.2 lands, web data is SQLite on the application container — physically wherever the container runs (AWS ECS Fargate target region). This is operationally functional but **not** suitable for EU customer commitments because the SQLite file lives only on container ephemeral storage.

### 1.3 Person-MCP, Org-MCP, Geo-MCP (and any new MCP)

| Concern | v1 commitment |
|---|---|
| Container host region | ECS Fargate, customer-selected region |
| SQLite file path | `/data/<service>/<service>.db` on EFS (Elastic File System) — persistent across container restarts |
| Askar wallet files | `/data/person-mcp/wallets/<principal>.askar` on EFS |
| Backups | EFS automated backups (AWS Backup), same-region |
| EFS encryption | At-rest with KMS key; same key per tenant for cross-MCP consistency or per-MCP key with operator preference |

**MCP-per-tenant boundary** (forward-looking, not v1): each customer organization gets its own MCP container set, isolating data physically by tenant. v1 has a shared person-MCP host across users; isolation is via the `principal` column. This is a **known limitation** and disclosed in P3 § 6.

### 1.4 KMS (AWS or GCP)

| Concern | v1 commitment |
|---|---|
| Region | Same region as the host service (`eu-west-1` ↔ Frankfurt KMS) |
| Multi-region keys | AWS multi-region keys ([docs.aws.amazon.com/kms/latest/developerguide/multi-region-keys-overview.html](https://docs.aws.amazon.com/kms/latest/developerguide/multi-region-keys-overview.html)) NOT used in v1 — single-region keys only |
| Key rotation | Annual automatic rotation; explicit rotation on suspected compromise |
| Key access policy | Service-linked roles only; no human IAM users have direct decrypt permission |
| Sub-processor | AWS or Google Cloud — see P9 |

**KMS migration progress**: per memory `project_kms_initiative.md`, K0–K7 + Sprint 5 W1+W2 done; GCP G-PR-1..5 done, G-PR-6 in flight. Canonical plans at `output/KMS-IMPLEMENTATION-PLAN.md` (AWS) and `output/GCP-KMS-IMPLEMENTATION-PLAN.md` (GCP). Reference these for the current deployment architecture.

### 1.5 GraphDB (knowledge graph)

| Concern | v1 commitment |
|---|---|
| Endpoint | `https://graphdb.agentkg.io/` |
| Region | **TO VERIFY** — assumed EU (Ontotext is a Bulgarian company; EU-hosted is likely; the operator must confirm) |
| Contents | On-chain mirror only (no off-chain personal data, per IA P4) — but the on-chain mirror *can* contain pseudonymous addresses + assertions, so it is still subject to GDPR territorial scope |
| Backups | Operator-managed; we do not control |
| Access | Service account from web app via SPARQL endpoint |

**Action required v1**: signed DPA with Ontotext (the GraphDB operator). Confirm hosting region. If hosting is non-EU and EU customers are present, layer SCCs (§ 5). If a self-hosted GraphDB option is on the table for EU customers, prefer it.

### 1.6 On-chain (permissioned EVM)

| Concern | v1 commitment |
|---|---|
| Validators | Operator-controlled; nodes geographically distributed |
| Chain data | Replicated to all validators (and any RPC nodes) |
| RPC endpoints | Customer-selectable: EU-only RPC pool for EU recipe, US-only for US recipe |
| Block explorer | Operator-controlled or third-party Etherscan-like service; subject to its own DPA |

**Important**: blockchain data replication across validators is a **transfer** under GDPR Chapter V if validators are in third countries. Operationally, we restrict the validator set per customer region. If a customer requires "no data in country X," we exclude validators in that country. **[CONSULT COUNSEL]** — is operator-controlled validator distribution a sufficient Chapter V mechanism, or does it require an SCC analog between validators?

### 1.7 Application logs

| Concern | v1 commitment |
|---|---|
| Aggregator | CloudWatch (AWS) or Stackdriver (GCP) — same region as the emitting service |
| Retention | 90 days standard (P4 § 3.4) |
| Personal data in logs | **Should be zero** per IA 09-privacy-audit § D; verified by lint rule + CI scan (build: `apps/web/src/lib/ops/log-scanner.ts`) |

### 1.8 Email (transactional + privacy notices)

| Concern | v1 commitment |
|---|---|
| Provider | SES (AWS) for AWS deployment; SendGrid or Postmark for GCP |
| Region | Same as primary deployment |
| DPA | Yes — see P9 |
| Content | Transactional only (verification codes, erasure acknowledgements); no marketing in v1 |

### 1.9 Backups

| Concern | v1 commitment |
|---|---|
| Storage | S3 (AWS) or GCS (GCP), same region |
| Retention | 30 days rolling for operational backups; 7 years for SOX-applicable audit archives |
| Encryption | KMS-managed; backup-specific key per tenant |
| Cross-region copy | Disabled by default; enabled only with customer opt-in (DR-grade tier) |

## 2. Recipes

### 2.1 EU recipe (data stays in EU/EEA)

```
Vercel:        regions = ["fra1", "dub1"]
RDS:           region = "eu-west-1"
ECS Fargate:   region = "eu-west-1"
EFS:           region = "eu-west-1"
AWS KMS:       region = "eu-west-1"
S3 (audit):    region = "eu-west-1"
CloudWatch:    region = "eu-west-1"
GraphDB:       eu-hosted Ontotext instance (require contract clause)
Validator pool: EU-only validators
SES:           region = "eu-west-1"
```

**Cross-border transfer mechanisms required**: only if any of the AWS managed services have backend operations outside EU. AWS publishes its data-processing locations; for `eu-west-1` workloads, primary processing is EU. Some control-plane operations (IAM management, billing) traverse US; these are **operational metadata**, not customer data. AWS includes SCCs in their DPA covering any such transfer.

**Vercel**: Vercel Pro and Enterprise plans support region pinning. Their DPA covers EU transfers via SCCs.

**Counsel review required**:
- AWS DPA (current version: 2023-10) — confirm coverage of all in-use services.
- GCP DPA (if dual-deployed).
- Vercel DPA.
- Ontotext DPA.

### 2.2 US recipe (data stays in US)

```
Vercel:        regions = ["iad1", "sfo1"]
RDS:           region = "us-east-1"
ECS Fargate:   region = "us-east-1"
EFS:           region = "us-east-1"
AWS KMS:       region = "us-east-1"
S3 (audit):    region = "us-east-1"
CloudWatch:    region = "us-east-1"
GraphDB:       us-hosted Ontotext instance (or self-hosted on AWS us-east-1)
Validator pool: US-only validators
SES:           region = "us-east-1"
```

**Cross-border concerns**: minimal. Some marketing / billing data may traverse to other countries via AWS/Vercel/Ontotext control planes; not personal data of the user.

### 2.3 Multi-region tenancy (future, not v1)

Not supported at v1. Documented here for forward planning:
- A tenant requiring multi-region read replicas would need RDS cross-region replication, KMS multi-region keys, and a strategy for which region's law governs writes — often deferred to a customer-specific addendum.

## 3. Published data-residency page (customer-facing)

We commit to publishing at `smart-agent.example/privacy/data-residency`:

> ### Data Residency
>
> When you sign up for Smart Agent, your data is stored and processed in **one of two regions**, depending on which tenant you sign up to:
>
> - **European Union** — primary region: AWS Frankfurt (`eu-central-1`) / Dublin (`eu-west-1`). All personal data stays within the EU/EEA.
> - **United States** — primary region: AWS Virginia (`us-east-1`). Personal data stays within the US.
>
> **What this covers:**
> - Your profile, prayers, oikos contacts, intents, credentials, and other private data — stays in your region.
> - Your encrypted backups — stay in your region.
> - The knowledge graph that powers discovery — stays in your region.
>
> **What it does not cover:**
> - The permissioned blockchain where we record certain immutable facts (smart account deployment, delegations, pledges) — this is replicated across our validator nodes. Validators are in your region's geography. **However, blockchain data is fundamentally a public ledger and we cannot prevent third parties from reading it.**
> - Operational metadata (billing, account management) that our infrastructure providers (AWS, Vercel) process — typically minimal and covered by their data-processing agreements.
>
> **Cross-border transfers**: when transfers occur (e.g., AWS control plane), we rely on Standard Contractual Clauses (SCCs) approved by the European Commission (Decision 2021/914) for EU transfers and Standard Privacy Clauses + UK IDTA for UK transfers.
>
> If you need a more specific residency commitment (e.g., "data must not touch any AWS service"), contact us — we can configure a single-tenant deployment for enterprise customers.

## 4. Per-tenant encryption keys (BYOK / HYOK considerations)

For customers requiring stronger control over the EU/US recipe:

| Tier | Description |
|---|---|
| **Standard** | Smart Agent operates KMS keys; customer trusts the operator |
| **BYOK (Bring Your Own Key)** | Customer creates the KMS key in their account; grants Smart Agent IAM principal access. Customer can revoke access (which would render their data unreadable, breaking the service) |
| **HYOK (Hold Your Own Key)** | Customer holds the master key on-prem or in their HSM; Smart Agent calls a customer-operated KMS endpoint for unwrap operations. Not v1; requires significant engineering |

v1 ships **Standard** only. BYOK is a 2026-H2 candidate. HYOK is not on the v1 or v1.1 roadmap.

## 5. Cross-border transfer mechanisms (legal underpinning)

### 5.1 EU → US transfers

After Schrems II (CJEU C-311/18, 2020-07-16) invalidated Privacy Shield, US transfers required SCCs (Commission Decision 2021/914 of 2021-06-04) + supplementary measures.

The EU-US Data Privacy Framework (DPF) adequacy decision (2023-07-10, Commission Decision (EU) 2023/1795) provides a path for transfers to DPF-certified US recipients. As of 2024-2025, AWS, Google Cloud, and Vercel are DPF-certified.

**Smart Agent posture**: where EU data crosses to US (which we minimize via the EU recipe), we rely on **DPF adequacy** for DPF-certified recipients (AWS, GCP, Vercel) and **SCCs** for non-DPF recipients. We monitor the DPF for legal challenges (e.g., the la Quadrature du Net challenge in *La Quadrature du Net v Commission*, T-553/23, pending) — if DPF is invalidated, we fall back to SCCs.

### 5.2 UK transfers

UK has its own adequacy framework (UK DPF as of 2023-10-12) and the UK International Data Transfer Agreement (IDTA, March 2022). For UK-only customers, we use UK IDTA + supplementary measures.

### 5.3 Togo / West Africa transfers

Togo Law 2019-014 (Art 13–14) restricts transfers to non-adequate countries; the Togolese Personal Data Protection Authority (IPDCP) maintains an adequacy list. EU is generally treated as adequate. US is not on the list as of 2026; transfers from Togo to US must rely on contractual safeguards similar to SCCs. **[CONSULT COUNSEL]** specifically on the IPDCP-approved transfer mechanism — this is a niche area with limited published practice.

### 5.4 Operationally-feasible posture

For v1 launch:
- **EU customer → EU storage** — no cross-border issue for primary data.
- **EU customer → US KMS / sub-processor** — rely on DPF (AWS / GCP / Vercel) or SCCs.
- **UK customer → UK or EU storage** — UK adequacy with EU; otherwise UK DPF / UK IDTA.
- **US customer → US storage** — no cross-border issue.
- **Togo customer → EU storage** (no Togo region in v1) — relies on IPDCP-approved transfer mechanism; **[CONSULT COUNSEL]**.

## 6. Verification and monitoring

### 6.1 At-deployment verification

CI/CD pipeline includes:
- `infra/terraform/validate-region.sh` — fails if any resource is created outside the declared tenant region.
- `vercel.json` lint — fails if no `"regions"` key for production.
- `apps/web/src/lib/ops/region-probe.ts` — runtime probe verifies each external dependency's resolved IP geolocates to the expected region (best-effort; geolocation is approximate).

### 6.2 Runtime monitoring

CloudWatch alarms / Stackdriver alerts:
- `data_transfer_cross_region_bytes` > 0 — alert on unexpected cross-region traffic.
- `kms_decrypt_other_region_total` > 0 — alert on cross-region key use.
- `s3_cross_region_replication_lag` — monitor when (rare) replication is enabled.

### 6.3 Periodic audit

Quarterly: Security agent walks the residency map and produces a residency-attestation report (sign-off by Security + Infra agents).

## 7. Customer-facing data flow diagrams

To accompany the residency page, we publish two diagrams (to be built; Mermaid source in `docs/security/privacy-and-compliance/diagrams/`):

### 7.1 EU recipe — diagram outline (text)

```
[Browser, EU IP]
    │
    │ HTTPS
    ▼
[Vercel edge fra1 / dub1]
    │
    │ Function invocation
    ▼
[Next.js App / Vercel fra1]
    │
    ├──> [RDS Postgres / eu-west-1]
    │
    ├──> [Person-MCP / ECS Fargate eu-west-1]
    │        └──> [EFS / eu-west-1]
    │             └──> SQLite + Askar
    │
    ├──> [Org-MCP / ECS Fargate eu-west-1]
    │        └──> [EFS / eu-west-1]
    │
    ├──> [A2A-Agent / ECS Fargate eu-west-1]
    │        ├──> [AWS KMS / eu-west-1]
    │        └──> [Permissioned EVM RPC / EU pool]
    │
    └──> [GraphDB / EU instance]
              └──> SPARQL endpoint
```

### 7.2 US recipe — diagram outline

Mirrors 7.1 with `us-east-1` substituted throughout and Vercel regions `iad1` / `sfo1`.

## 8. Open issues

| ID | Issue | Owner | Target resolution |
|---|---|---|---|
| R1 | Confirm GraphDB hosting region with Ontotext; sign region-specific DPA | Infra | Pre-GA |
| R2 | Vercel `vercel.json` region pinning landed | Developer | Pre-EU-GA |
| R3 | Validator-pool region restriction operationally validated | Infra | Pre-GA |
| R4 | Togo transfer mechanism with IPDCP — counsel review | Security + counsel | Pre-Togo-GA |
| R5 | BYOK feasibility study | Security | 2026-H2 |
| R6 | Multi-region tenant architecture spec | Infra + Security | 2027 |

## 9. Residual risk

1. **DPF invalidation risk**: if the EU-US Data Privacy Framework is invalidated by CJEU (pending challenges), we fall back to SCCs immediately. We have not contracted any deeper "data localization" guarantee that would bind us to expensive supplementary measures.
2. **AWS control-plane transfer**: even with `eu-west-1` workloads, AWS control plane processes some metadata in the US. This is covered by AWS's DPA and DPF certification, but a hostile regulator could challenge it.
3. **Vercel global edge cache**: static assets (JS bundles) hit Vercel's global cache. We verify (§ 1.1) no PII is in static assets; this risk is therefore residual only for adversarial CDN-bypass scenarios.
4. **Subpoena risk**: a US subpoena to AWS could compel disclosure of EU customer data. The SCC supplementary-measures requirement post-Schrems II is intended to address this; AWS's encryption-by-default mitigates but does not eliminate.

## 10. Change log

| Date | Author | Change |
|---|---|---|
| 2026-05-18 | Security agent | Initial draft. |

---

**End of P2.**
