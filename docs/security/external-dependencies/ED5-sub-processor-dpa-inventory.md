# ED5 — Sub-Processor DPA Inventory

> **Status**: Draft. Names the per-processor DPA tracking schema, the
> customer-notification mechanism on sub-processor change, the
> cross-border transfer mechanism per processor, and the DPA-expiry
> tracking.
>
> **Effort**: M (initial inventory + DPA confirmation) + ongoing (per
> renewal + per new vendor).
>
> **Owner**: security + legal.
>
> **Reading time**: ~15 min.

---

## 1. Goal

Maintain a complete, accurate, customer-facing list of every third-party
data processor and the Data Processing Agreement (DPA) governing each.
Required by GDPR Art 28 + Art 30 (records of processing activities). Most
modern enterprise customer DPAs require us to maintain such a list and
notify them before changes.

## 2. Relationship to ED2

ED2 catalogues *all* vendors at the contractual level. ED5 catalogues
the *subset that processes customer personal data*. The two overlap but
are not identical:

| Vendor | In ED2? | In ED5? |
|---|---|---|
| Vercel | yes (Tier 1 cloud) | yes (processes user IP, session cookies, request bodies) |
| AWS KMS | yes (Tier 1 crypto) | yes (encryption operations on session ciphertexts — debatable whether this is "personal data processing"; conservative classification: YES because EncryptionContext can include `session_id_h` derived from session) |
| GCP KMS | yes | yes (same posture) |
| Datadog | yes | yes (logs include hashed user identifiers and request bodies) |
| GitHub | yes | yes (source code may contain personal-data field names) — debatable; standard practice is to include because GitHub *could* see PII in commits |
| PagerDuty | yes | no — only employee data, not customer PII |
| Statuspage | yes | no — only operational data |
| 1Password | yes | no — employee creds only |
| OpenZeppelin / eth-infinitism / Foundry | yes | no — pure code dep, no data processing |
| Cloudflare | yes (Tier 1) | yes (processes IP, request headers) |
| OpenAI | yes (planned) | yes (would process prompt text including PII) |

`[OWE-REVIEWER]` — the "debatable" entries (AWS KMS as data processor,
GitHub) follow the conservative interpretation: if in doubt, treat as
a sub-processor. This protects us in customer reviews even if a
narrower legal interpretation would exclude.

## 3. Sub-processor inventory schema

Every entry under `vendors/<slug>.md` (ED2's vendor files) carries a
`sub-processor` section:

```markdown
## Sub-processor section

| Field | Value |
|---|---|
| Sub-processor name | <vendor> |
| Role | Sub-processor (or "Processor" if we're the controller and they're the processor) |
| Data class | session metadata / request bodies / encrypted ciphertexts / hashed identifiers / etc. |
| Processing purpose | hosting / KMS / observability / etc. |
| Location of data | us-east-1 / eu-west-1 / multi-region / etc. |
| DPA signed date | YYYY-MM-DD |
| DPA version (vendor's) | vX.Y |
| DPA URL (vendor's public version) | <url> |
| Signed-DPA archive | docs/security/dpas/<vendor>-<YYYY-MM-DD>.pdf |
| DPA effective date | YYYY-MM-DD |
| DPA renewal date | YYYY-MM-DD (or "automatic with vendor MSA") |
| Cross-border transfer mechanism | SCCs / Adequacy decision / BCRs / DPF / N/A (data stays in customer's region) |
| Vendor's sub-processor list URL | <url> |
| Breach-notification SLA | "X hours from vendor's discovery" |
| Right to audit | yes / no / vendor's SOC 2 report suffices |
| Last review date | YYYY-MM-DD |
```

## 4. Cross-border transfer mechanisms

Where each vendor processes our data matters under GDPR Ch. V.

### 4.1 Mechanism options

| Mechanism | When used |
|---|---|
| **Adequacy decision** (Art 45) | Data goes to a jurisdiction the EU Commission has declared adequate (UK, Switzerland, Japan, etc.). No additional measures needed. |
| **Standard Contractual Clauses (SCCs)** (Art 46) | Default for transfers to the US and most non-adequacy jurisdictions. The 2021 SCC modules apply per the controller/processor relationship. |
| **Binding Corporate Rules (BCRs)** (Art 47) | For intra-corporate-group transfers. Doesn't apply to us yet. |
| **EU-US Data Privacy Framework (DPF)** | New (Jul 2023). Replaces invalidated Privacy Shield. Vendors that self-certify to DPF can be relied on for US transfers. |
| **Derogations** (Art 49) | Last-resort for one-off transfers. Not used here. |

### 4.2 Per-vendor mechanism

| Vendor | Region | Mechanism |
|---|---|---|
| Vercel | US-east default; EU regions available | SCCs (2021 module 2 — controller-to-processor) + DPF |
| AWS | per-region (we use us-east-1 today; eu regions for EU customers) | AWS DPA includes SCCs; AWS is DPF-certified |
| GCP | per-region | Google DPA includes SCCs; Google is DPF-certified |
| Cloudflare | global edge | Cloudflare DPA includes SCCs; Cloudflare is DPF-certified |
| Datadog | US-region default; EU available | Datadog DPA includes SCCs; DPF-certified |
| GitHub | US (Microsoft) | MS Online Services DPA includes SCCs; DPF-certified |
| OpenAI (planned) | US | OpenAI DPA includes SCCs; DPF-certified |

`[OWE-REVIEWER]` — verify each vendor's DPF self-certification status at
quarterly review via the official DPF list:
<https://www.dataprivacyframework.gov/list>.

### 4.3 Multi-region posture

For EU customer data:

`[DECISION]` — when a customer in the EU is onboarded with EU-residency
requirements, we route their:
- Web traffic to Vercel EU edge region.
- KMS operations to `eu-west-1` (AWS) or `europe-west1` (GCP).
- Datadog ingest to the EU Datadog site (`datadoghq.eu`).

The routing is per-customer config; document in customer-onboarding
checklist `docs/operations/customer-onboarding.md` (TBD).

`[OPEN] ED5-1`: When do we offer EU-residency as a contractual term?
Trigger: first EU enterprise customer.

## 5. Customer-facing sub-processor list

`[DECISION]` — publish a customer-readable sub-processor list at
`https://smart-agent.io/.well-known/sub-processors.json` and as a
human-readable page at `https://smart-agent.io/legal/sub-processors`.

### 5.1 Schema (JSON)

```json
{
  "version": "1.0",
  "lastUpdated": "2026-05-18T00:00:00Z",
  "subProcessors": [
    {
      "name": "Amazon Web Services",
      "purpose": "Cloud hosting; key management (KMS); object storage (S3 audit anchor)",
      "dataClasses": ["encrypted session ciphertexts", "audit anchor objects", "hashed identifiers in EncryptionContext"],
      "location": "us-east-1 (default); regional options for EU customers",
      "transferMechanism": "SCCs + DPF",
      "vendorDpaUrl": "https://d1.awsstatic.com/legal/aws-gdpr/AWS_GDPR_DPA.pdf"
    },
    {
      "name": "Vercel",
      "purpose": "Web hosting (apps/web); edge functions; log drains",
      "dataClasses": ["request bodies", "user identifiers", "session cookies"],
      "location": "Multi-region edge; primary us-east",
      "transferMechanism": "SCCs + DPF",
      "vendorDpaUrl": "https://vercel.com/legal/dpa"
    }
  ]
}
```

### 5.2 Static page

Human-readable at `/legal/sub-processors`. Same data, prose-formatted,
with a "subscribe to changes" link (§6).

## 6. Customer notification on change

### 6.1 The mechanism

When we add, remove, or materially change a sub-processor:

1. The change goes through the ED2 §7 procedure (security + procurement
   PR review).
2. Once approved, the `.well-known/sub-processors.json` file updates
   AND a notification is emitted.

### 6.2 Notification channels

- **RSS feed** at `https://smart-agent.io/.well-known/sub-processors.rss`
  — preferred by enterprise customers' procurement teams who subscribe
  to dozens of vendor feeds.
- **Email** to customers who opted into sub-processor notifications at
  contract time. Email is sent **30 days BEFORE the change takes effect**
  per Art 28(2) "prior specific written authorisation" customer-objection
  windows.
- **In-app banner** (apps/web) on the admin dashboard for paid customers.

### 6.3 Customer objection process

Per most enterprise DPAs, the customer has the right to object to a new
sub-processor:

1. Customer objects within the 30-day window.
2. We acknowledge within 5 business days.
3. We work with the customer to find an alternative arrangement.
4. If no resolution, customer has termination right per their DPA.

`[OWE-REVIEWER]` — process documented in
`docs/security/external-dependencies/sub-processor-objection-procedure.md`.

## 7. DPA expiry tracking

DPAs are typically tied to the underlying MSA — they renew automatically.
But we track them anyway because:

- Vendor's DPA *version* changes (vendor publishes a new template).
- Cross-border transfer mechanism changes (e.g. DPF replaces Privacy
  Shield).
- Vendor's sub-processor list changes (cascades to our customers).

### 7.1 Tracking table

`docs/security/external-dependencies/dpa-tracking.md` (NEW):

| Vendor | DPA Version | Effective | Next Review | Owner |
|---|---|---|---|---|
| AWS | 2023.06 | 2023-06-15 | 2026-06-15 | security |
| Vercel | 2024.01 | 2024-01-10 | 2027-01-10 | security |
| GCP | 2023.09 | 2023-09-20 | 2026-09-20 | security |
| Cloudflare | TBD on adoption | TBD | TBD + 1yr | security |
| Datadog | 2024.03 | 2024-03-01 | 2027-03-01 | security |
| GitHub (Microsoft) | 2024.10 | 2024-10-15 | 2027-10-15 | security |

A scheduled GitHub Action `dpa-renewal-check.yml` runs weekly and opens
an issue 90 days before any `Next Review` date.

### 7.2 Renewal procedure

1. 90 days out — issue auto-opens.
2. Security checks vendor's DPA page for a newer version.
3. If new version published: review against current version (legal
   liaison engaged).
4. Approve / negotiate / sign.
5. Update tracking table; update `.well-known/sub-processors.json` if
   any field changed (data classes, transfer mechanism, sub-processor
   cascade); trigger §6 customer notification if material.

## 8. Per-processor terms we care about

Beyond the standard GDPR Art 28 boilerplate, certain clauses matter
operationally:

- **Notice of subpoena / law-enforcement request** — vendor must notify
  us unless legally prohibited. Tracked per vendor.
- **Breach notification SLA** — vendor must tell us within X hours of
  *their* discovery. Industry norm: 72 hr; we push for 48 hr at
  renewal.
- **Sub-processor cascade** — vendor must tell us before adding their
  own sub-processors. Industry norm: 30 days.
- **Right to audit** — typically waived in exchange for vendor's SOC 2
  Type II report. We accept the SOC 2 for Tier 2; we want true audit
  rights for Tier 1 (rare to secure; document where denied).
- **Data deletion on termination** — vendor must delete or return our
  data within X days. Industry norm: 90 days. We push for 30 days at
  renewal.

`[OWE-REVIEWER]` — per-vendor breakdown of these clauses lives in
`vendors/<slug>.md`.

## 9. Cost

| Component | Cost |
|---|---|
| Legal review per new DPA (one-time per vendor) | $1k–$3k |
| Annual review (per Tier 1 vendor DPA, light-touch) | $300–$500 |
| Customer notification (RSS + email + banner) — infra | one-time S |
| DPA tracking workflow | one-time S |
| Sub-processor JSON publishing | one-time S (covered by ED1/ED2 wiring) |
| **Recurring** | **~$2k–$5k/yr legal + ~$0 infra** |

## 10. Cross-references

- ED2 — vendor inventory + risk tiers; ED5 is the data-processing slice
- A2 §7 — legal-hold mechanism may compel sub-processor preservation
- A6 §10 — sub-processor breach scenario
- ED1 — SBOM is code-deps, separate from data-processors
- (Future) P3 / P9 — privacy and compliance documents in
  `docs/security/privacy-and-compliance/` (TBD); the customer-facing
  privacy notice will cite this list

## 11. Implementation tasks

| # | Task | Owner | Effort |
|---|---|---|---|
| ED5-T1 | `dpa-tracking.md` populated for current §7.1 vendors | security + legal | M |
| ED5-T2 | `dpa-renewal-check.yml` GH Action — weekly cron, opens issues 90 days out | infra | S |
| ED5-T3 | `.well-known/sub-processors.json` static file + Next.js route | developer + infra | S |
| ED5-T4 | `/legal/sub-processors` static page | developer + comms | S |
| ED5-T5 | `.well-known/sub-processors.rss` feed generation | developer | S |
| ED5-T6 | `sub-processor-objection-procedure.md` documented | legal + security | S |
| ED5-T7 | Customer onboarding checklist updated with EU-residency option | comms + ops | M |
| ED5-T8 | `docs/security/dpas/` directory populated with signed-DPA archive per Tier 1 vendor | security + legal | M |

## 12. Acceptance criteria

- [ ] All Tier 1 vendor DPAs filed under `docs/security/dpas/`
- [ ] `dpa-tracking.md` accurate as of latest review
- [ ] `.well-known/sub-processors.json` serving valid JSON
- [ ] RSS feed valid (W3C feed validator)
- [ ] Legal review confirmed cross-border transfer mechanisms (§4.2)
- [ ] Customer onboarding checklist references sub-processor list
- [ ] First DPA renewal cycle exercised (any vendor with 2026 review)

## 13. Open questions

- `[OPEN] ED5-1`: When to offer EU-residency contractually (§4.3).
- `[OPEN] ED5-2`: Customer-objection process when we cannot accommodate —
  reduced-functionality offering vs. termination. Default: termination
  right; case-by-case workarounds.
- `[OPEN] ED5-3`: AI-vendor (OpenAI / Anthropic) — should we use them at
  all given the prompt-data-as-training-data risk? If yes, with what
  contractual carve-outs? Defer until product needs them concretely.
- `[OPEN] ED5-4`: Do we offer customers a way to download the latest
  signed sub-processor list as a PDF for their own DPA-attached files?
  Recommendation: yes; cheap and reduces customer-onboarding friction.

## 14. Glossary

- **Sub-processor** — a third party that processes personal data on
  behalf of a processor (us). The full GDPR Art 28 chain is:
  Data Subject → Controller (customer) → Processor (us) → Sub-processor
  (the vendor in this list).
- **DPA** — Data Processing Agreement; the Art 28 instrument.
- **SCC** — Standard Contractual Clauses; EU-approved transfer
  mechanism.
- **DPF** — EU-US Data Privacy Framework; replaced Privacy Shield
  Jul 2023.
- **BCR** — Binding Corporate Rules; intra-group transfer mechanism.
- **Adequacy decision** — EU declaration that a third country's data
  protection is adequate.

---

*Last updated: 2026-05-18. Owner: Security agent + Legal liaison.*
