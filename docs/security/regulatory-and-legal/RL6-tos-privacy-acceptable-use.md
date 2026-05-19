# RL6 — Terms of Service / Privacy Policy / Acceptable Use

> **NOT LEGAL ADVICE.** This document scopes the legal-document drafting
> for counsel.
>
> Cross-refs: [RL1](./RL1-money-transmitter-license-analysis.md) for
> regulatory disclaimers; [RL2](./RL2-securities-analysis.md) for
> securities disclaimers; [RL5](./RL5-kyc-aml-high-risk-flows.md) for
> identity data handling; [RL7](./RL7-liability-framework.md) for
> liability + indemnity overlap.

## Table of contents

1. [Executive summary](#1-executive-summary)
2. [Document inventory](#2-document-inventory)
3. [Terms of Service (TOS)](#3-terms-of-service-tos)
4. [Privacy Policy](#4-privacy-policy)
5. [Acceptable Use Policy (AUP)](#5-acceptable-use-policy-aup)
6. [Cookie Policy](#6-cookie-policy)
7. [Dispute Resolution Policy](#7-dispute-resolution-policy)
8. [Click-wrap implementation](#8-click-wrap-implementation)
9. [Version + change management](#9-version--change-management)
10. [Counsel engagement](#10-counsel-engagement)
11. [Cost model](#11-cost-model)
12. [Bibliography](#12-bibliography)

---

## 1. Executive summary

Before public launch, Smart Agent needs:

1. **Terms of Service (TOS)** — the master contract between Smart Agent
   (or the operating entity) and each user.
2. **Privacy Policy** — GDPR / CCPA / state-privacy-law-compliant
   disclosure of data practices.
3. **Acceptable Use Policy (AUP)** — what users can and cannot do.
4. **Cookie Policy** — for EU + UK + CA users.
5. **Dispute Resolution Policy** — arbitration clause (optional, with
   class-action waiver where permitted).

These documents must:

- Be drafted by counsel ($5k–$15k initial; $3k–$8k per significant
  revision).
- Be served at signup via click-wrap.
- Re-accept on material changes.
- Be versioned + dated + archived.
- Have an effective-date + last-updated.
- Be accessible from every page (footer links).

Drafted documents go in `apps/web/public/legal/`. The web app serves
them from `/legal/terms`, `/legal/privacy`, `/legal/acceptable-use`,
`/legal/cookies`, `/legal/disputes` — and references the current
version on each signup.

---

## 2. Document inventory

| Doc | Required for | First draft | Format |
|---|---|---|---|
| Terms of Service | all jurisdictions | counsel | Markdown + HTML render |
| Privacy Policy | EU, UK, CA, CO, VA, CT, UT, TX (and more) | counsel + privacy specialist | Markdown + HTML render |
| Acceptable Use Policy | all | engineering can draft; counsel review | Markdown |
| Cookie Policy | EU, UK, CA | engineering can draft; counsel review | Markdown |
| Dispute Resolution | US (recommended) | counsel | Markdown |
| Data Processing Addendum (DPA) | EU B2B users | counsel | PDF |
| Subprocessor List | EU, CA users | engineering maintains | Markdown |
| Donor Receipt template | if 501(c)(3) wrapper | counsel + accountant | PDF template |
| W-9 collection notice | tax | RL3 | Markdown |
| Service-specific addenda | each commercial offer | counsel | Markdown |

---

## 3. Terms of Service (TOS)

### 3.1 Required clauses

A modern fintech / crypto TOS includes:

1. **Definitions** — e.g., "Smart Account," "Pledge," "Pool," "USDC,"
   "User."
2. **Acceptance & Eligibility**.
3. **Account Creation & Authentication** — passkey, SIWE, etc.
4. **Description of Service** — what we do; what we don't.
5. **No Investment Advice + No Financial Service** — securities
   disclaimer.
6. **No Custody Disclaimer** — only after counsel approval; if we
   ARE custodial, this clause is REVERSED.
7. **Fees** — currently $0 to user; document if added.
8. **User Responsibilities** — accuracy of info, key custody, tax
   reporting.
9. **Prohibited Activities** — referenced in AUP.
10. **KYC/AML** — user must comply with tier requirements.
11. **OFAC + sanctions** — user warrants no sanctioned-jurisdiction
    nexus.
12. **Tax** — user responsible for own tax; Smart Agent issues 1099s
    where required.
13. **Pledges & Honor** — what a pledge is; what honor is.
14. **Smart Contract Risk** — chain immutability; bug risk.
15. **Force Majeure** — chain outage, RPC outage, etc.
16. **Intellectual Property** — Smart Agent's marks; user content
    license.
17. **Privacy** — refers to Privacy Policy.
18. **Termination + Suspension** — when we can.
19. **Indemnification** — by user, in favor of Smart Agent.
20. **Disclaimer of Warranties** — AS IS, AS AVAILABLE.
21. **Limitation of Liability** — capped at fees paid or $100.
22. **Governing Law** — choose state (Delaware most common).
23. **Dispute Resolution** — arbitration + class waiver (refers to
    Dispute Resolution Policy).
24. **Changes to Terms** — how we change; user re-accept.
25. **Severability + Entire Agreement**.
26. **Contact + Notices**.

### 3.2 Crypto-specific clauses

Beyond the standard fintech TOS, crypto-specific clauses:

- **No reversibility of on-chain transactions** — Smart Agent cannot
  recover lost funds.
- **Gas costs** — user pays gas via paymaster sponsorship terms.
- **Smart contract version disclosure** — current AgentAccount /
  DelegationManager / etc. addresses.
- **No representation about token value** — applies to USDC + any future
  asset.
- **Chain selection** — Smart Agent operates on chain X; we don't
  guarantee any other chain.
- **Self-custody disclaimer** — user is responsible for their keys
  (post-Spec-007).
- **Recovery options** — what recovery the platform offers
  (passkey, social, none).
- **AnonCreds risks** — credentials are bound to a specific holder
  wallet; loss of holder wallet may impair ability to act in pools.

### 3.3 Charitable / civic clauses

If Smart Agent is positioned as a charitable / civic platform:

- **No guarantee of fund delivery to recipient** — pool stewards decide;
  Smart Agent doesn't.
- **No guarantee of tax deductibility** — depends on pool's 501(c)(3)
  status, user's situation.
- **Donor receipt provision** — Smart Agent will provide a receipt
  where a 501(c)(3) pool exists; otherwise user works with pool.
- **Refund policy** — generally, no refunds of honored pledges; refer
  to recipient pool.
- **Restrictions on solicitation** — user agrees to comply with state
  charitable-solicitation laws (varies by state — see "Unified
  Registration Statement" + state-level charity registration).

### 3.4 Class action waiver + mandatory arbitration

Strong recommendation for US users. Standard structure:

> "Any dispute arising out of or related to these Terms, the Service,
> or your use of the Service shall be resolved through binding
> arbitration in [city, state], administered by JAMS / AAA under their
> Streamlined Arbitration Rules. You waive any right to bring a class
> action."

Caveats:

- Some states (CA, NY) have applied scrutiny; some agreements have
  been invalidated.
- Recent FAA jurisprudence makes class waivers generally enforceable
  but mass arbitration counter-strategy is rising.
- Consider mass-arbitration coordination mechanism in the clause
  (batching, fee shifting).

### 3.5 Choice of law + forum

US: typically Delaware (corporate-friendly) or California (consumer-
friendly varies). For a Delaware C-corp, Delaware law makes sense.

EU: must allow EU consumers to sue in their home country for consumer
disputes (CJEU jurisprudence). Cannot impose mandatory US forum on EU
consumers.

UK: similar — UK consumers retain home-court rights.

### 3.6 Severability + survival

Standard. Critical for litigation outcomes.

### 3.7 No-investment-advice + no-financial-service language

Per RL2:

> "Smart Agent is not an investment adviser, broker-dealer, money
> transmitter, bank, or trust company. We provide software
> infrastructure for users to manage smart accounts, issue and verify
> credentials, and coordinate charitable / civic activities. We do not
> provide legal, tax, accounting, or investment advice. We do not offer
> or sell securities. Pledges and contributions made through the
> Service are charitable / civic commitments, not investments; no
> financial return is offered or implied."

Important: the "money transmitter" sentence cannot be included until
counsel has issued an opinion to that effect (RL1).

### 3.8 Indemnification

Standard user-side indemnification:

> "You agree to indemnify, defend, and hold harmless Smart Agent, its
> affiliates, officers, directors, employees, and agents from any
> claims, damages, losses, liabilities, and expenses (including
> attorneys' fees) arising from (a) your use of the Service, (b) your
> violation of these Terms, (c) your violation of any applicable law,
> regulation, or third-party right, or (d) any content you provide."

### 3.9 Limitation of liability

> "TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL
> SMART AGENT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL,
> CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, REVENUES,
> DATA, OR USE, ARISING OUT OF OR IN CONNECTION WITH THESE TERMS OR THE
> SERVICE. SMART AGENT'S AGGREGATE LIABILITY UNDER OR IN CONNECTION
> WITH THESE TERMS SHALL NOT EXCEED THE GREATER OF (A) THE FEES YOU
> HAVE PAID TO SMART AGENT IN THE TWELVE (12) MONTHS PRECEDING THE
> CLAIM OR (B) ONE HUNDRED U.S. DOLLARS (US$100)."

EU consumers: cannot limit liability for gross negligence or willful
misconduct; member-state-specific caps apply.

UK: similar Unfair Contract Terms Act 1977 constraints.

### 3.10 Sanctions warranty

> "You represent and warrant that (a) you are not located in, organized
> under the laws of, or a resident of any country or territory subject
> to comprehensive U.S. sanctions (including Cuba, Iran, North Korea,
> Syria, and the Crimea, Donetsk, Luhansk, Kherson, and Zaporizhzhia
> regions of Ukraine), (b) you are not on any U.S. or other government
> sanctions list, and (c) you will not use the Service in violation of
> any applicable sanctions law."

---

## 4. Privacy Policy

### 4.1 GDPR-required content (Articles 13 + 14)

- Identity + contact of controller (Smart Agent legal entity).
- DPO contact (if appointed; required if "regular and systematic
  monitoring on a large scale" or "special category data on a large
  scale" — likely YES for Smart Agent at scale).
- Purposes of processing + legal basis (Art. 6).
- Legitimate interests (where applicable).
- Recipients of personal data (subprocessors).
- Third-country transfers + safeguards (e.g., SCCs).
- Retention period (or criteria).
- Data subject rights (access, rectification, erasure, restriction,
  portability, objection, automated-decision-making).
- Right to withdraw consent.
- Right to complain to supervisory authority.
- Whether data provision is statutory / contractual.
- Whether automated decision-making is used (e.g., KYC scoring).

### 4.2 CCPA / CPRA requirements

- Categories of personal information collected.
- Categories of sources.
- Business / commercial purposes.
- Categories of third parties to whom shared.
- Consumer rights: know, delete, correct, opt-out, limit sensitive
  use.
- Sale / sharing disclosure (Smart Agent does NOT sell personal info —
  declared explicitly).
- Sensitive personal information categories.
- Authorized agent procedure.
- Methods to submit requests + verification.

### 4.3 Other state-privacy-law requirements (US)

| State | Statute | Effective | Key requirements |
|---|---|---|---|
| **California** | CCPA + CPRA | 2020 / 2023 | Above |
| **Virginia** | CDPA | 2023 | Right to access, delete, correct, opt-out; DPA |
| **Colorado** | CPA | 2023 | Similar to VA + universal opt-out |
| **Connecticut** | CTDPA | 2023 | Similar |
| **Utah** | UCPA | 2023 | Slimmer |
| **Texas** | TDPSA | 2024 | Similar |
| **Oregon, Montana, Florida, Iowa, Delaware, Tennessee, Indiana, New Jersey, Minnesota, Maryland, Kentucky, New Hampshire, Nebraska, Rhode Island** | various | 2024-2026 | Similar |

By 2026, ~20 US states have comprehensive privacy laws. A consolidated
privacy notice + universal opt-out + GPC support cover most.

### 4.4 Subprocessor list

Maintain `apps/web/public/legal/subprocessors.md`:

| Subprocessor | Purpose | Data | Location |
|---|---|---|---|
| **AWS** | hosting | all server-side data | us-east-1 + EU (if EU users) |
| **GCP** | hosting (alt) | depending on plan | various |
| **Cloudflare** | CDN + DNS | IP, request metadata | global |
| **Persona** | KYC | identity docs | US + EU |
| **Sumsub** | KYC + Travel Rule | identity + tx | EU |
| **TRM Labs** | sanctions screening | addresses + tx | US |
| **Chainalysis** | sanctions screening | addresses + tx | US |
| **Postmark / SES** | email | email content | US |
| **Twilio** | SMS | phone, OTP | US |
| **Track1099 / Sovos** | tax forms | tax info | US |
| **Datadog / Sentry** | monitoring | logs, errors | US/EU |
| **Stripe** (if billing added) | payments | billing | US |
| **GitHub** | source control | source | US |

### 4.5 Cross-border transfer mechanism

For EU → US data transfers:

- **SCCs** (Standard Contractual Clauses) — 2021 EU Commission decision
- **EU-US Data Privacy Framework** — adequacy decision, July 2023
- **Smart Agent operator must self-certify** under DPF for US-based
  hosting

For UK → US:

- **UK extension to the EU-US DPF** (or "UK Data Bridge")
- **UK IDTA** (International Data Transfer Agreement)

Document the mechanism in the Privacy Policy.

### 4.6 Data subject rights workflow

Implement at minimum:

- `POST /privacy/access-request` — user requests their data.
- `POST /privacy/delete-request` — user requests deletion (subject to
  retention exceptions — see RL5 § 9.4).
- `POST /privacy/correct-request` — user requests correction.
- `POST /privacy/opt-out-of-targeted-ads` — N/A (we don't run ads).
- `POST /privacy/limit-sensitive-info` — biometric data limitation.

SLA: 45 days (CCPA) / 1 month (GDPR), extendible to 90 / 3 months.

### 4.7 Children's privacy

US: **COPPA** — no collection from <13. Smart Agent should require 18+
in TOS + Privacy Policy.

EU: **Article 8 GDPR** — age of digital consent is 16 (or as low as
13 per member state). Smart Agent should require 18+.

UK: **Children's Code (Age-Appropriate Design Code)** — applies to
under-18s. Smart Agent's 18+ requirement avoids most obligations.

Implement age-check at signup.

### 4.8 Privacy Policy outline (skeleton)

```markdown
# Smart Agent Privacy Policy

Effective Date: YYYY-MM-DD
Last Updated: YYYY-MM-DD

## 1. Introduction
## 2. Information We Collect
   2.1 Information you provide
   2.2 Information we collect automatically
   2.3 Information from third parties
## 3. How We Use Information
## 4. Sharing of Information
   4.1 Service providers (subprocessors)
   4.2 Compliance (KYC/AML, sanctions, tax)
   4.3 Legal process
   4.4 Business transfers
## 5. Cookies and Similar Technologies (refer to Cookie Policy)
## 6. International Data Transfers
   6.1 SCCs / DPF for EU → US
## 7. Data Retention
## 8. Security
## 9. Your Rights (EU / US states)
## 10. Children's Privacy
## 11. Updates to This Policy
## 12. Contact
   privacy@smart-agent.example
   DPO: [name / address if appointed]
```

---

## 5. Acceptable Use Policy (AUP)

### 5.1 Prohibited activities

```markdown
# Acceptable Use Policy

You may not use the Service to:

1. Violate any applicable law, including but not limited to:
   - Anti-money laundering laws
   - Sanctions (US OFAC, EU, UN, UK)
   - Tax laws
   - Securities laws
   - Anti-fraud laws
2. Move funds for or on behalf of any sanctioned person or entity.
3. Move funds related to terrorism financing, drug trafficking, human
   trafficking, weapons proliferation, child exploitation, organized
   crime, or other criminal activity.
4. Conduct any transaction that you know or should know to be
   structured to evade reporting or screening thresholds.
5. Impersonate any person or entity or misrepresent your affiliation.
6. Use the Service to develop a competing service in violation of our
   rights.
7. Probe, scan, or test the vulnerability of the Service except as
   permitted by our responsible disclosure / security policy.
8. Reverse-engineer, decompile, or disassemble any closed-source
   components.
9. Interfere with or disrupt the integrity or performance of the
   Service.
10. Use any robot, scraper, or other automated means to access the
    Service except via our published APIs.
11. Use the Service in connection with any illegal gambling, escort
    services, multi-level marketing, pyramid schemes, or other
    high-risk activities defined in this AUP.
12. Submit false, misleading, or fraudulent KYC information.
13. Issue or accept credentials that misrepresent the holder's
    eligibility for any role or capacity.
14. Use the Service to spam, harass, or threaten any other user.
15. Upload or transmit malware, exploits, or harmful code.

We may suspend or terminate accounts that violate this AUP.

We may cooperate with law enforcement and regulators investigating
suspected violations.

Last Updated: YYYY-MM-DD
```

### 5.2 Smart-contract-specific prohibitions

- No exploiting bugs (white-hat disclosure encouraged via responsible
  disclosure).
- No griefing (e.g., spam-pledging zero-value pledges to flood pools).
- No reorganizing on-chain identity systems to defraud.

### 5.3 Reporting violations

`abuse@smart-agent.example` for reports. SLA: 24 hours
acknowledgement; 7 days initial response.

---

## 6. Cookie Policy

### 6.1 Cookie categories

| Category | Purpose | User consent? |
|---|---|---|
| **Strictly Necessary** | session, CSRF, auth | no (legitimate interest) |
| **Functional** | language, theme | yes (preference) |
| **Analytics** | usage analytics | yes (consent) |
| **Marketing** | n/a — we don't run ads | n/a |

### 6.2 Consent banner

Required for EU + UK + CA (CPRA "do not sell or share").

Use:

- **Cookiebot** ([https://www.cookiebot.com/](https://www.cookiebot.com/)) — leading consent mgmt
- **OneTrust** ([https://www.onetrust.com/](https://www.onetrust.com/)) — enterprise
- **Termly** ([https://termly.io/](https://termly.io/)) — SMB
- **Iubenda** ([https://www.iubenda.com/en/](https://www.iubenda.com/en/)) — international
- **Self-built** — possible but maintenance burden

Cost: $99–$1,000/mo depending on traffic + scope.

### 6.3 Universal Opt-Out

CCPA + state laws require honoring **Global Privacy Control (GPC)**
signals. Implement at the platform layer:

```typescript
if (request.headers.get('sec-gpc') === '1') {
  setUserPreference(userId, 'optOutOfSale', true);
}
```

---

## 7. Dispute Resolution Policy

### 7.1 Structure

1. **Informal resolution** — 30-day informal period.
2. **Mediation (optional)** — JAMS or AAA mediation.
3. **Binding arbitration** — JAMS or AAA Streamlined Rules.
4. **Class action waiver** — individual basis only.
5. **Carve-outs** — small claims court, IP claims.

### 7.2 Provider

- **JAMS** — [link](https://www.jamsadr.com/)
- **AAA** — [link](https://www.adr.org/)

JAMS Streamlined Rules typically for disputes under $250k.

### 7.3 Costs

Standard JAMS Streamlined arbitration fees: filing $1,500 (paid by
filer), arbitrator fee ~$2k–$10k per case (Smart Agent typically
covers).

For consumer arbitration: per JAMS Consumer Arbitration Minimum
Standards of Procedural Fairness, the consumer pays no more than the
local-court filing fee.

### 7.4 Mass arbitration mitigation

If thousands of users file simultaneously (a "mass arbitration"
strategy), per-case fees would crush Smart Agent. Mitigation:

- Batching language in the agreement.
- Bellwether procedures.
- Fee-shifting based on outcome.

Counsel must draft carefully.

---

## 8. Click-wrap implementation

### 8.1 Enforceability requirements

- **Conspicuous notice** — visible to user before assent.
- **Affirmative assent** — checkbox + button; no auto-checked boxes
  (some courts).
- **Linked documents** — TOS / Privacy / AUP all accessible.
- **Versioned** — record exactly which version the user accepted.
- **Timestamped** — when the user accepted.
- **Replicable** — we can reproduce the exact text the user saw.

### 8.2 Implementation (web app)

```typescript
// apps/web/src/app/signup/page.tsx
<form>
  ...
  <Checkbox required name="agree">
    By creating an account, I agree to the
    {' '}<Link href="/legal/terms?v=2026-05-18">Terms of Service</Link>,
    {' '}<Link href="/legal/privacy?v=2026-05-18">Privacy Policy</Link>, and
    {' '}<Link href="/legal/acceptable-use?v=2026-05-18">Acceptable Use Policy</Link>.
  </Checkbox>
  <button type="submit">Create Account</button>
</form>
```

### 8.3 Record what was accepted

```typescript
interface AcceptanceRecord {
  userId: string;
  documentType: 'tos' | 'privacy' | 'aup' | 'cookies' | 'disputes';
  version: string;       // "2026-05-18"
  acceptedAt: string;    // ISO timestamp
  ipAddress: string;     // for evidentiary purposes
  userAgent: string;
  signature?: string;    // optional cryptographic signature
}
```

Store in `person-mcp` (private) or web SQL (transactional).

### 8.4 Re-accept on material change

When a document version changes materially, force re-accept:

```typescript
if (currentDocVersion > userAcceptedVersion) {
  showReAcceptModal();
  // block actions until re-accept
}
```

"Material" change = anything that affects user rights or obligations.
Typo fixes / formatting do not require re-accept.

---

## 9. Version + change management

### 9.1 Versioning scheme

`YYYY-MM-DD` per document. Each version archived at
`apps/web/public/legal/terms/2026-05-18.md` etc.

### 9.2 Change-log

Maintain `apps/web/public/legal/CHANGELOG.md`:

```markdown
# Legal Document Changelog

## 2026-05-18

- TOS: added § 3.10 sanctions warranty.
- Privacy Policy: added Sumsub as subprocessor.
- Cookie Policy: GPC signal support.

## 2026-02-01

- Initial public version.
```

### 9.3 Notification

For material changes, email all users + show in-product banner. EU
GDPR requires "fair processing" notice — material changes to data
practices require explicit re-consent.

### 9.4 Acceptance audit log

A regulator or auditor can pull the audit log to confirm which version
each user accepted + when.

---

## 10. Counsel engagement

### 10.1 Document drafting counsel

- **Cooley LLP** — tech-transactions practice
- **Wilson Sonsini** — privacy + technology
- **Fenwick & West** — strong fintech + privacy
- **Goodwin Procter** — privacy practice
- **Perkins Coie** — privacy practice
- **Latham & Watkins** — privacy practice
- **DLA Piper** — privacy + GDPR
- **Bird & Bird** (UK + EU)
- **Hunton Andrews Kurth** — privacy specialist

For US TOS / AUP: standard tech-transactions counsel.

For GDPR Privacy Policy: privacy-specialist counsel (CIPP/E credential
preferred).

### 10.2 Engagement scope

```
Smart Agent — Public-Facing Legal Documents Package

Background:
  Smart Agent is preparing for limited public launch. We need standard
  fintech/crypto user-facing legal documents drafted.

Requested deliverables:
  (a) Terms of Service draft (~5,000 words).
  (b) Privacy Policy draft (~3,000 words), GDPR + US-states compliant.
  (c) Acceptable Use Policy draft (~1,500 words).
  (d) Cookie Policy draft (~800 words).
  (e) Dispute Resolution Policy draft (~1,000 words).
  (f) Subprocessor list template + DPA for B2B.
  (g) Review of click-wrap implementation.
  (h) Review of versioning / change-management plan.

Materials we provide:
  - Product description (CLAUDE.md, this directory, Spec 005)
  - RL1–RL5 (for disclaimer scope)
  - Existing product copy

Engagement model: $8k–$25k initial drafting; $2k–$8k per
significant revision; $3k–$10k/yr maintenance retainer.
```

### 10.3 Document-of-record service alternative

For early-stage, an alternative to bespoke counsel:

- **Termly** ([https://termly.io/](https://termly.io/)) — generated TOS / Privacy / Cookie
- **TermsFeed** ([https://www.termsfeed.com/](https://www.termsfeed.com/))
- **Iubenda** ([https://www.iubenda.com/en/](https://www.iubenda.com/en/))
- **Termsly** — generated docs ($30–$200/mo)

These are NOT a substitute for counsel for a crypto / fintech product,
but they can be a STARTING POINT that counsel then customizes for the
crypto-specific clauses. Estimated savings: $5k–$10k vs. ground-up
drafting.

### 10.4 Privacy specialist

Beyond drafting, ongoing privacy work needs a CIPP/E or CIPM
credentialed specialist:

- Data Protection Impact Assessment (DPIA) per Art. 35 GDPR
- Records of Processing Activities (RoPA) per Art. 30 GDPR
- Subprocessor due diligence
- Cross-border transfer reviews
- Annual privacy audit

Cost: $30k–$120k/yr for fractional CIPP/E or in-house DPO.

---

## 11. Cost model

### 11.1 Initial build

| Item | Cost |
|---|---|
| Counsel: TOS + AUP + Disputes | $5k–$15k |
| Counsel: Privacy Policy | $5k–$15k |
| Counsel: Cookie Policy | $2k–$5k |
| Counsel: DPA template | $2k–$5k |
| Engineering: click-wrap + acceptance log | $10k–$25k |
| Engineering: re-accept flow + versioning | $5k–$15k |
| Engineering: data-subject-rights endpoints | $20k–$40k |
| Engineering: cookie consent manager | $5k–$15k |
| **Total build** | **$54k–$135k** |

### 11.2 Ongoing

| Item | Annual cost |
|---|---|
| Counsel retainer (privacy + transactions) | $30k–$120k |
| DPO (fractional or in-house, if appointed) | $50k–$200k |
| Consent management SaaS | $1k–$15k |
| Annual privacy audit | $10k–$30k |
| Data-subject-rights operations | $5k–$30k |
| **Ongoing floor** | **~$96k–$395k/yr** |

---

## 12. Bibliography

### Statutes & regulations

- **EU General Data Protection Regulation (GDPR)** — Regulation (EU)
  2016/679: [link](https://eur-lex.europa.eu/eli/reg/2016/679/oj)
- **California Consumer Privacy Act (CCPA) + CPRA**: California Civil
  Code § 1798.100 et seq.
- **Virginia Consumer Data Protection Act (CDPA)**: Va. Code § 59.1-575
- **Colorado Privacy Act (CPA)**: C.R.S. § 6-1-1301 et seq.
- **Connecticut Data Privacy Act (CTDPA)**
- **Utah Consumer Privacy Act (UCPA)**
- **Texas Data Privacy and Security Act (TDPSA)** — effective 2024
- **Children's Online Privacy Protection Act (COPPA)**: 15 U.S.C. §§
  6501–6506
- **UK Data Protection Act 2018**
- **UK GDPR** (retained EU law)
- **UK Children's Code (Age-Appropriate Design Code)**
- **EU-US Data Privacy Framework** (July 2023)
- **EU SCCs** (Implementing Decision (EU) 2021/914)
- **CAN-SPAM Act** — 15 U.S.C. § 7701 et seq.
- **Telephone Consumer Protection Act (TCPA)** — 47 U.S.C. § 227
- **Federal Arbitration Act (FAA)** — 9 U.S.C. § 1 et seq.

### Privacy guidance

- **EDPB Guidelines** — [link](https://edpb.europa.eu/our-work-tools/general-guidance/guidelines-recommendations-best-practices_en)
- **California Privacy Protection Agency (CPPA)** — [link](https://cppa.ca.gov/)
- **UK ICO** — [link](https://ico.org.uk/)
- **NIST Privacy Framework** — [link](https://www.nist.gov/privacy-framework)

### Cookie + tracking

- **EU ePrivacy Directive (2002/58/EC)** + Cookie Directive (2009/136/EC)
- **CNIL Cookie Guidelines** — [link](https://www.cnil.fr/en/cookies-and-other-tracking-devices)

### Click-wrap case law

- **Specht v. Netscape Commc'ns Corp.**, 306 F.3d 17 (2d Cir. 2002)
- **Nguyen v. Barnes & Noble Inc.**, 763 F.3d 1171 (9th Cir. 2014)
- **Meyer v. Uber Techs., Inc.**, 868 F.3d 66 (2d Cir. 2017)
- **Berman v. Freedom Fin. Network, LLC**, 30 F.4th 849 (9th Cir. 2022)

### Arbitration + class waiver

- **AT&T Mobility LLC v. Concepcion**, 563 U.S. 333 (2011)
- **Epic Systems Corp. v. Lewis**, 138 S. Ct. 1612 (2018)

### Vendors

- **Termly**: [link](https://termly.io/)
- **TermsFeed**: [link](https://www.termsfeed.com/)
- **Iubenda**: [link](https://www.iubenda.com/en/)
- **Cookiebot**: [link](https://www.cookiebot.com/)
- **OneTrust**: [link](https://www.onetrust.com/)
- **JAMS**: [link](https://www.jamsadr.com/)
- **AAA**: [link](https://www.adr.org/)

### Related internal documents

- [`README.md`](./README.md)
- [`RL1-money-transmitter-license-analysis.md`](./RL1-money-transmitter-license-analysis.md) — money-transmitter language
- [`RL2-securities-analysis.md`](./RL2-securities-analysis.md) — securities disclaimers
- [`RL3-tax-reporting-1099-and-international.md`](./RL3-tax-reporting-1099-and-international.md) — tax notices
- [`RL4-ofac-sanctions-screening.md`](./RL4-ofac-sanctions-screening.md) — sanctions warranty
- [`RL5-kyc-aml-high-risk-flows.md`](./RL5-kyc-aml-high-risk-flows.md) — KYC + privacy interaction
- [`RL7-liability-framework.md`](./RL7-liability-framework.md) — liability + indemnity
- `specs/007-architecture-hardening/phase-H-privacy-and-iac.md` —
  AnonCreds custodial privacy posture
