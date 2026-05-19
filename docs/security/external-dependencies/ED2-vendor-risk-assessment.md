# ED2 — Vendor Risk Assessment

> **Status**: Draft. Inventory is complete to current production state;
> tiering review needed by procurement + security; first annual review
> cycle pending.
>
> **Effort**: M (initial inventory + tiering) + ongoing (per-vendor
> renewal cadence).
>
> **Owner**: security + procurement (latter often security in disguise
> at our stage).
>
> **Reading time**: ~25 min.

---

## 1. Goals

1. Catalogue every third-party vendor that touches Smart Agent's
   production or sensitive data.
2. Tier each vendor by risk (NIST SP 800-161 Rev. 1 risk-based approach).
3. Set per-tier review cadence and procurement gates.
4. Drive customer security questionnaires from this inventory rather
   than re-deriving each time.

## 2. Inventory

The current inventory. Cells are stated to the level of detail we'd
share with a customer infosec response.

### 2.1 Cloud and infrastructure

| Vendor | Use | Data shared | Contract | SOC 2 | Tier (proposed) |
|---|---|---|---|---|---|
| **Vercel** <https://vercel.com> | Web hosting (apps/web), edge functions, log drains | All web request traffic (incl. user identifiers), application code | Vercel Enterprise (TBD; currently Pro) | SOC 2 Type II, ISO 27001 | **Tier 1** |
| **AWS** <https://aws.amazon.com> | KMS (master / bundler / sessionIssuer keys), S3 (audit anchor), CloudTrail | Encrypted session ciphertexts, audit-anchor objects | AWS Customer Agreement + BAA available | SOC 2 Type II, ISO 27001, FedRAMP High | **Tier 1** |
| **Google Cloud (GCP)** <https://cloud.google.com> | KMS sibling backend (G-PR-1..6), Workload Identity Federation | Same data class as AWS via GCP path | GCP Customer Agreement | SOC 2 Type II, ISO 27001 | **Tier 1** |
| **Cloudflare** <https://cloudflare.com> | (Future) WAF, DDoS protection (per R2) | All web request traffic | Cloudflare Enterprise (TBD) | SOC 2 Type II, ISO 27001, PCI DSS | **Tier 1** |

### 2.2 SaaS / operational

| Vendor | Use | Data shared | Contract | SOC 2 | Tier (proposed) |
|---|---|---|---|---|---|
| **GitHub** <https://github.com> | Code repository, CI (GH Actions), Issues / PRs | Source code (private repo), CI secrets (KMS short-lived OIDC only — no long-lived secrets) | GitHub Enterprise Cloud | SOC 2 Type II, ISO 27001 | **Tier 1** |
| **Datadog** <https://datadoghq.com> | APM, Logs, Security Signals (per A3) | Application logs, log lines may carry hashed user identifiers | Datadog standard MSA + DPA | SOC 2 Type II, ISO 27001, HIPAA-eligible | **Tier 1** |
| **PagerDuty** <https://pagerduty.com> | On-call paging | On-call schedule (employee contact info) | PagerDuty Business | SOC 2 Type II | **Tier 2** |
| **Statuspage** (Atlassian) <https://statuspage.io> | Customer-facing status page | Incident state + customer-facing comms text | Atlassian DPA | SOC 2 Type II, ISO 27001 | **Tier 2** |
| **1Password** <https://1password.com> | Credential vault, IC binder (A6) | Operator credentials, vendor support contacts | 1Password Business | SOC 2 Type II, ISO 27001 | **Tier 1** |

### 2.3 Code dependencies (runtime — direct only)

These show up in the SBOM. ED2 cares about them at the *vendor* level
(who maintains the package and what trust we place in them).

| Vendor | Use | Tier (proposed) |
|---|---|---|
| **OpenZeppelin** <https://openzeppelin.com> | `@openzeppelin/contracts` — utility libraries reused in our own contracts | **Tier 2** |
| **eth-infinitism** | `account-abstraction` reference — for testing parity only; we ship our own AA contracts | **Tier 3** |
| **Foundry-rs** | `forge-std` — test utility | **Tier 3** |
| **Wevm** | `viem` — Ethereum client library | **Tier 1** (runtime authority surface) |
| **Honojs** | `hono` — HTTP server framework in a2a-agent | **Tier 2** |
| **Drizzle Team** | `drizzle-orm` — DB ORM | **Tier 2** |
| **Vercel** | `next` — Next.js framework | (already counted in 2.1) |
| **noble-crypto / Paul Miller** | `@noble/curves`, `@noble/hashes` — cryptographic primitives | **Tier 1** |

### 2.4 Cryptographic / blockchain

| Vendor | Use | Tier (proposed) |
|---|---|---|
| **Ethereum mainnet / L2 networks** (no single vendor) | Settlement layer + audit anchor (A1) | **Tier 1** (substrate); risk is not vendor-specific |
| **Etherscan / Blockscout** <https://etherscan.io> | Block explorer used in customer comms + verification | **Tier 3** (informational only; not authority) |
| **GraphDB.agentkg.io** | Knowledge-base SPARQL endpoint | **Tier 2** |

### 2.5 Sub-processors (data processing)

| Vendor | Use | Tier (proposed) |
|---|---|---|
| **OpenAI** <https://openai.com> | (When agent inference uses GPT class) | **Tier 2** — currently NO production use; flagged here pre-emptively for ED5 |
| **Anthropic** <https://anthropic.com> | (Possible future LLM use) | **Tier 2** — same posture |

(Sub-processor-only vendors are also enumerated in ED5 from the
data-processing-agreement angle.)

### 2.6 Explicitly NOT used (substrate independence)

Per P1, we do **NOT** depend on these at runtime — listed here so the
audit trail is clear:

| Vendor | Why we don't use |
|---|---|
| **Safe (Gnosis Safe)** | We build our own ERC-4337 smart account. |
| **Privy** | We build our own passkey + SIWE auth substrate. |
| **MetaMask Delegation Toolkit** | We implement ERC-7710 ourselves. |
| **Aragon / Llama** | Governance is our own; not vendor-controlled. |
| **WalletConnect** | Wallet integration via direct EIP-1193 providers; no WalletConnect SDK in runtime. |

Each is a candidate vendor we evaluated and rejected; ED2 cites them to
record the rejection. If any becomes a runtime dep in future, this row
moves to §2.1–2.5 with the appropriate tier.

## 3. Tiering criteria

`[DECISION]` — three-tier model, matching NIST SP 800-161 Rev. 1 §3:

| Tier | Definition | Risk impact if vendor compromised | Review cadence | Annual due-diligence package |
|---|---|---|---|---|
| **Tier 1 — Critical** | Vendor outage or compromise *directly* affects customer authority, customer funds, or substantial customer data; we cannot operate for > 1 hour without them. | Severe | **Annual** full review + DPA + SOC 2 review + BCM review + on-vendor-incident notice | Required |
| **Tier 2 — Important** | Vendor outage or compromise materially degrades operations but is recoverable in < 24 hr; data exposure is limited to operational metadata or a contained data set. | Moderate | **Annual** lighter review (questionnaire only) | Required |
| **Tier 3 — Informational** | Vendor is convenience only; we can drop them within a sprint with no material disruption; no sensitive data touched. | Low | **One-time vet** at onboarding; review on material change | Optional |

`[OWE-REVIEWER]` — annual review schedule lives in
`docs/security/external-dependencies/reviews/SCHEDULE.md`.

## 4. Per-vendor template

Every Tier 1 + Tier 2 vendor has a file under
`docs/security/external-dependencies/vendors/<slug>.md` with this
template:

```markdown
# Vendor: <name>

| Field | Value |
|---|---|
| Vendor name | <name> |
| URL | <url> |
| Tier | 1 / 2 / 3 |
| Use cases | <what we use them for> |
| Data shared | <data class> |
| Contract type | <Enterprise / Business / Pro / Free> |
| Contract effective date | YYYY-MM-DD |
| Contract renewal date | YYYY-MM-DD |
| DPA signed | yes / no / not applicable (URL to signed doc) |
| DPA version | <vendor's DPA version> |
| Sub-processor list URL | <vendor's published sub-processor list> |
| SOC 2 Type II | yes / no (report URL or "available on request") |
| ISO 27001 | yes / no |
| Other compliance (HIPAA / FedRAMP / etc.) | as applicable |
| Last security questionnaire response | YYYY-MM-DD (link to response doc) |
| Business continuity plan reviewed | YYYY-MM-DD |
| Breach-notification SLA | "X hours from vendor's discovery" |
| Annual review (next due) | YYYY-MM-DD |
| Risk acceptance owner | <named human> |
| Notes | <free text> |
```

## 5. Documentation template — security questionnaire

For each Tier 1 vendor we maintain a completed copy of *their* current
security questionnaire (we are the customer of theirs). When a Tier 1
vendor publishes a new version of their SOC 2 / ISO 27001 / DPA, the
filed copy is updated.

The questionnaire response from us (when customers ask) lives in
`docs/security/responses/<customer-name>-<YYYY-MM>.md`.

`[OWE-REVIEWER]` — first batch of completed vendor questionnaire-responses
captured by 2026-07-01. Maintained quarterly thereafter.

## 6. Renewal cadence

| Tier | Cadence | Trigger |
|---|---|---|
| 1 | Annual + 30-day pre-renewal review | Vendor renewal date − 30 days |
| 1 | Ad-hoc | Vendor's SOC 2 report drops, vendor announces material change, vendor has a public incident |
| 2 | Annual | Vendor renewal date − 14 days |
| 3 | One-time at onboarding | Material change only |

The 30-day pre-renewal window for Tier 1 gives us time to negotiate
contract changes (e.g. shorter breach-notification SLA, tighter
sub-processor cascade clauses).

## 7. Vendor change procedure

Adding a Tier 1 vendor is a security-reviewed decision. Procedure:

1. **Proposer** (developer or infra) opens a PR titled
   `[ED2] Propose vendor: <name>`.
2. PR body: use case, data shared, alternatives considered, why this
   vendor is the choice.
3. Security review: tier proposal, risk acceptance owner named, DPA
   draft attached.
4. Procurement: cost projection, contract negotiation.
5. PR merged: vendor file added under `vendors/`; ED5 DPA inventory
   updated; ED1 SBOM regenerated (if code-dep) within next CI cycle.

Removing a vendor is a 1-week notice procedure with explicit data-deletion
confirmation:

1. PR opens at `T-7d`: states the vendor sunset.
2. Migration completes; cutover confirmed.
3. Vendor data deletion requested (per DPA + GDPR Art 17).
4. Vendor confirms deletion in writing.
5. Vendor file moved to `vendors/retired/`.

## 8. Cost

| Component | Cost |
|---|---|
| Annual review time (3–4 days/yr for security + procurement combined) | $5k–$10k internal effort |
| Vendor's premium-tier upgrade to access SOC 2 (where applicable) | already paid in product cost |
| Outside-counsel review of DPA on negotiation (per vendor change) | $1k–$3k per Tier 1 vendor change |
| **Total annual cost** | **dominated by internal review time** |

No external SaaS tool required at our scale — the inventory file +
schedule + 30-min weekly check-in is enough. Re-evaluate at 20+ vendors
or 100+ employees; vendor-risk SaaS tools (Vanta, Drata, OneTrust) become
worthwhile then.

`[OPEN] ED2-1`: When do we adopt a vendor-risk SaaS? Decision criteria:
≥ 20 vendors in inventory OR ≥ 1 SOC 2 audit with formal vendor-risk
control evidence required.

## 9. Customer-visible artefacts

What we publish vs. what we share on request:

| Artefact | Public | On NDA |
|---|---|---|
| Sub-processor list (ED5) | yes — `https://smart-agent.io/.well-known/sub-processors.json` | (full version with internal details) |
| List of cloud providers (Tier 1) | yes | — |
| Per-vendor risk file | no | yes for Tier 1 |
| Filled vendor security questionnaire responses | no | yes selectively |
| DPA terms | no (vendor's published terms only) | yes — our DPA with customer is template `docs/security/dpa-template.md` |

`[OWE-REVIEWER]` — the customer DPA template lives separately, not in
this directory.

## 10. Open questions

- `[OPEN] ED2-1`: Vendor-risk SaaS adoption trigger (§8).
- `[OPEN] ED2-2`: We list Cloudflare / future-WAF in §2.1 as Tier 1
  before it's deployed; should the inventory cover *planned* vendors?
  Recommendation: yes, mark them `status: planned` so the procurement
  cycle starts before we depend on them.
- `[OPEN] ED2-3`: Sub-processor cascade — Datadog uses AWS under the hood.
  Do we surface AWS-via-Datadog separately or roll up? Roll up: the
  primary vendor is responsible for sub-processor cascade per their DPA.
- `[OPEN] ED2-4`: Do we negotiate Datadog Enterprise terms (BCM
  artefact, dedicated CSAM)? Trigger: Datadog spend > $2k/mo.

## 11. Implementation tasks

| # | Task | Owner | Effort |
|---|---|---|---|
| ED2-T1 | Create `vendors/` directory + one file per Tier 1 + Tier 2 vendor (§2) | security | M |
| ED2-T2 | `reviews/SCHEDULE.md` populated 2 yrs ahead | security | S |
| ED2-T3 | `responses/` skeleton for customer security questionnaires | security | S |
| ED2-T4 | DPA verification: every Tier 1 vendor has a signed DPA filed | legal + security | M |
| ED2-T5 | Customer-facing sub-processor list (`.well-known/sub-processors.json`) — same wiring pattern as ED1 SBOM | infra | S |
| ED2-T6 | First annual review cycle — schedule on the calendar | security | S |
| ED2-T7 | Negotiation playbook for each Tier 1 vendor (specific clauses we want at renewal) | legal + security | M |

## 12. Acceptance criteria

- [ ] Inventory complete in `vendors/` for every Tier 1 + Tier 2 vendor
- [ ] DPAs on file for every Tier 1 vendor
- [ ] First annual review cycle scheduled
- [ ] Sub-processor JSON file served at `.well-known/sub-processors.json`
- [ ] Procurement gate: any new Tier 1 vendor blocked at merge time
      without security sign-off
- [ ] Customer security questionnaire turnaround SLA documented (~7 business days)

## 13. Cross-references

- ED1 — SBOM is the technical inventory; ED2 is the contractual inventory
- ED3 — supply-chain controls apply to code-dep vendors specifically
- ED5 — DPA inventory is the data-processing slice of this vendor list
- A2 §7 — legal-hold mechanism may compel vendor-side preservation; this
  inventory tells us who to contact
- A6 §10 — sub-processor breach scenario uses this list for scope

## 14. Glossary

- **Tier 1 / 2 / 3** — vendor-risk tiers; see §3.
- **DPA** — Data Processing Agreement (GDPR Art 28 instrument).
- **Sub-processor** — a third party that a vendor uses to process our
  data on our behalf.
- **BCM** — Business Continuity Management plan.
- **CSAM** — Customer Security Account Manager (vendor-side contact).
- **Risk acceptance owner** — named human who signs off that the
  residual risk after controls is acceptable.

---

*Last updated: 2026-05-18. Owner: Security agent + Procurement (TBD).*
