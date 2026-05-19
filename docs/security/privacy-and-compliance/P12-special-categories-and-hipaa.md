# P12 — Special Categories and HIPAA

> **Document status: DRAFT.**
> **[CONSULT COUNSEL]** marks clauses requiring sign-off.
> **Last updated: 2026-05-18.**

## 0. Executive summary

GDPR Article 9 prohibits processing of "special categories" of personal data (racial / ethnic origin, political opinions, religious or philosophical beliefs, trade-union membership, genetic data, biometric data identifying a natural person, data concerning health, sex life, sexual orientation) **unless** one of ten enumerated grounds applies.

Smart Agent's primary intended use cases — church discipleship, oikos / personal-evangelism networks, faith-based grants — implicate at least:
- **Religious or philosophical beliefs** (the most relevant; affects most of person-MCP).
- Potentially **racial or ethnic origin** (if granted/profile fields capture this; we currently do not).
- Potentially **sexual orientation** if `profiles.gender` is interpreted broadly.

HIPAA (45 CFR §§ 160, 162, 164) applies to **covered entities** and **business associates** processing protected health information (PHI). Smart Agent has **no health-care delivery use case in v1**, but a customer using Smart Agent in a health-adjacent context (e.g., faith-based recovery program tracking) could implicate PHI.

COPPA (15 U.S.C. §§ 6501–6506; 16 CFR § 312) applies to operators of online services directed at children under 13 or with actual knowledge of collecting data from such children.

This document specifies:
1. **What categories Smart Agent processes** (and does not).
2. **Legal basis for processing special categories** (Art 9(2) ground selection).
3. **UI and storage gates** for special-category data.
4. **HIPAA applicability assessment**.
5. **COPPA applicability assessment**.

## 1. Categories explicitly in scope

### 1.1 Religious or philosophical beliefs

**Definition** (GDPR Art 9(1) — narrative): personal data revealing religious or philosophical beliefs.

**Where it appears in Smart Agent**:
- `profiles.preferences` (may contain religious affiliation)
- `user_preferences.home_church` — explicit
- `prayers.title`, `prayers.content`, `prayers.tags`
- `oikos_contacts.spiritual_response_state`, `oikos_contacts.proximity` (gospel-engagement categories), `oikos_contacts.notes`
- `training_progress.module_key` (training modules are explicitly Christian discipleship: "411", "BDC", "COC", etc.)
- `beliefs.statement`, `beliefs.tags`
- `coaching_notes.content` (when interpreted as religious mentorship notes)
- `activity_log_entries` (when kind = prayer / service / discipleship)
- Org metadata for faith-based orgs (publicly on chain — see § 2.3)

**Legal basis under Art 9(2)**:

The applicable grounds:
- **(a) Explicit consent** — Art 9(2)(a). Requires "explicit" consent, distinct from regular Art 6(1)(a) consent. EDPB Guidelines 05/2020 § 93 elaborate: explicit means an express statement (not just an opt-in checkbox; ideally written / signed / two-step confirmation).
- **(d) Processing carried out in the course of legitimate activities** — Art 9(2)(d). Allows churches and other not-for-profit bodies with a political, philosophical, religious or trade-union aim to process special-category data of their members or former members **without external disclosure**.
- **(e) Data manifestly made public by the data subject** — Art 9(2)(e). Applies to org-level public assertions on chain.

**Smart Agent posture**:
- For end-user processing in person-MCP, rely on **Art 9(2)(a) — explicit consent**, captured at signup with a discrete additional confirmation. Disclosed in the consent UI per P5 § 5.
- For org-level processing within faith-based orgs, **Art 9(2)(d)** may apply for those orgs that qualify (membership-based faith communities); Smart Agent is the processor.
- For publicly anchored on-chain assertions, **Art 9(2)(e)** — the user manifestly made it public; the act of publishing satisfies "manifestly made public."

**[CONSULT COUNSEL]** on:
- Whether the church-discipleship UX qualifies as a "religious aim" under Art 9(2)(d).
- Whether explicit consent at signup, combined with per-feature granularity, satisfies the "specific" prong for Art 9 purposes (which is stricter than Art 6).
- Local-law derogations under Art 9(4) — some member states impose additional restrictions on religious-data processing.

### 1.2 Sexual orientation (potentially)

**Where it could appear**:
- `profiles.gender` — if interpreted broadly (e.g., "gay male"); we currently expect simple gender values but free-form input is permitted.

**Posture**:
- Default UI offers limited enum options (male / female / non-binary / prefer-not-to-say).
- Custom free-form responses are stored but flagged via a content-type heuristic during writes.
- Treated as Art 9 special category for all retention / encryption / consent purposes.

### 1.3 Health data — minimized; gated

**Where it could appear**:
- `prayers.content` if a user writes about their own or another's illness.
- `oikos_contacts.notes` if a user writes about another's illness.
- `coaching_notes.content` if a coach writes about a disciple's health.
- `activity_log_entries.notes` if the activity touches on health (e.g., counseling).

**Posture**:
- Smart Agent **does not have a structured health-data field**. We do not invite health data; we cannot prevent free-text entry of it.
- UI tooltip on free-text fields: "Avoid recording sensitive health, legal, or financial information about yourself or others unless necessary."
- If a customer's intended use case involves health-data tracking (e.g., recovery-program logs), they must engage Smart Agent for a HIPAA-aware deployment (§ 3).

### 1.4 Racial or ethnic origin — not collected

**Posture**: no field collects this. Free-text fields may incidentally contain such information; treated as Art 9 if discovered.

### 1.5 Political opinions, trade-union membership — not collected

**Posture**: no field collects these.

### 1.6 Genetic data, biometric data — not collected

**Posture**: passkey credentials use biometrics on the user's device for authentication but **the biometric is never transmitted to Smart Agent**. WebAuthn's design keeps biometric data on the authenticator. Smart Agent stores only the public key, not the biometric.

## 2. Storage and processing gates

### 2.1 At signup

For each Art 9 category processed:

> ☐ I consent to processing of my **religious belief** information (e.g., prayer notes, oikos contacts, training progress) as necessary to provide the Smart Agent service. I understand:
> - This information is stored encrypted on Smart Agent's servers.
> - Only I and parties I explicitly authorize (e.g., a coach I grant access to) can read it.
> - I can withdraw consent at any time, which will result in deletion of this information.

Required explicit consent (Art 9(2)(a) standard) — uncheckable by default; user must affirmatively check; logged with version of the consent text (P5 § 7).

### 2.2 In the database

Art 9 columns get the **stricter encryption profile**:
- Per-tenant DEK (envelope-encrypted) — P3 § 13.
- KDF for the wrapping passphrase uses Argon2id with target 1s computation.
- Access log on every read (column-level audit — P3 § 14).

### 2.3 In on-chain assertions

A user can manifestly make religious data public by signing an on-chain assertion (e.g., publicly listing themselves as a member of a faith-based org). This is Art 9(2)(e) — manifestly made public.

**UI gate**: before signing such an assertion, the disclosure UI (P5 § 3.8 Variant B) MUST include:
> ⚠️ You are about to publish a religious-affiliation record permanently on the blockchain. Anyone will be able to see that you are affiliated with this organization. You cannot delete this record later — only mark it as inactive.

### 2.4 In AnonCreds presentations

Selective disclosure of religious-affiliation credentials lets a user present "I am a member of X church" to a verifier without revealing other affiliations. This is the **strongest privacy posture** for special-category data in our system.

UI guidance: where a user is about to present a credential that includes religious affiliation, the disclosure UI (P5 § 6.1) calls out the special-category nature.

## 3. HIPAA applicability

### 3.1 Default posture: NOT a covered entity, NOT a business associate

Smart Agent v1 does NOT serve health-care providers, health plans, or health-care clearinghouses in their primary HIPAA-regulated functions. The platform is not designed for storage or transmission of Protected Health Information (PHI).

**Therefore**: HIPAA does not apply by default.

### 3.2 When HIPAA could apply

A customer who is a covered entity (e.g., a faith-based health clinic using Smart Agent for member tracking) could push PHI into our system. We must NOT receive PHI without:

1. A **Business Associate Agreement (BAA)** signed between Smart Agent and the customer (45 CFR § 164.504(e)).
2. **HIPAA-aware deployment configuration** including:
   - All AWS / GCP services on the HIPAA-eligible list ([AWS HIPAA-eligible services](https://aws.amazon.com/compliance/hipaa-eligible-services-reference/)).
   - Encryption at rest + in transit verified.
   - Access logging at the HIPAA standard.
   - Breach notification SLA aligned with HIPAA (60 days; HHS OCR).
3. **Workforce training** on HIPAA — for any Smart Agent employee who would access the customer's PHI-containing tenant.

### 3.3 Default contractual posture

Smart Agent's **Terms of Service** prohibit PHI from being uploaded without a signed BAA:
> Customer represents that it will not submit, store, or transmit Protected Health Information (as defined under HIPAA) through the Service unless Customer has executed a Business Associate Agreement with Smart Agent. Submission of PHI in violation of this provision constitutes a material breach.

### 3.4 BAA template

`docs/security/privacy-and-compliance/templates/baa.md` (build target) — based on HHS-published model BAA, customized for cloud-hosted SaaS.

## 4. COPPA applicability

### 4.1 Default posture: NOT directed at children under 13

Smart Agent v1's primary persona is adult disciples / org administrators. Demo content does not target children. The platform does NOT advertise to children.

### 4.2 Edge cases

Smart Agent COULD be used to track relationships involving minors:
- An oikos contact may be a child.
- A coaching relationship may involve a youth ministry context.
- Training programs may include youth tracks.

**Per COPPA**: third-party data about minors stored by an adult user is not directly COPPA's primary concern (COPPA targets *operators* directing services at children, not adult users' personal records about children).

**But**: if a child under 13 attempts to sign up directly, COPPA applies. Mitigations:
1. Terms of Service require users to be 13 years or older (15 for stricter EU markets — GDPR Art 8 default is 16, member-state-derogated to 13 in some).
2. Signup form requires confirmation of age.
3. If actual knowledge of an under-13 user is acquired, immediate account suspension + parental contact + data deletion per COPPA Rule.

### 4.3 GDPR Art 8 (information society services to children)

GDPR Art 8 requires parental consent for processing of children's data in offers of information-society services. Default age: 16; member states can lower to 13.

**Smart Agent posture**: same as COPPA — minimum age 13–16 depending on jurisdiction; verified by self-declaration at signup; immediate response on actual-knowledge discovery.

## 5. UI gates per category

### 5.1 Profile signup form

| Field | Treatment |
|---|---|
| Age (if requested) | Drop-down with minimum 13 (or 16 per jurisdiction); birthday optional + AnonCreds-friendly alternative |
| Gender | Limited enum + "prefer not to say" + Art 9 explicit-consent toggle if filled in |
| Religious affiliation | Art 9 explicit-consent toggle; warning about on-chain exposure if user publishes |
| Address | Postal-code-only by default; full address only when needed for a specific feature |
| Health-related fields | None |

### 5.2 Prayer / oikos / coaching content entry

Tooltip on free-text fields:
> Tip: avoid recording sensitive health, legal, financial, or identifying information about other people unless necessary for your prayer / discipleship workflow. People you record about have data protection rights too.

### 5.3 Org profile (admin-facing)

For org admins creating org profiles:
- "Religious aim" field — if checked, org-level processing relies on Art 9(2)(d) for its members.
- Admin confirms membership-based vs open-public org type.

## 6. Cross-cutting recommendations

### 6.1 Explicit policy: what we NEVER store

We commit, in customer-facing privacy notice and ToS:

> ### Categories We Do Not Collect
>
> Smart Agent **does not** collect, store, or process the following categories of personal data:
> - Government-issued ID numbers (Social Security Number, Tax ID, Passport Number).
> - Bank account numbers or credit card numbers (financial transactions use blockchain tokens, not banking rails).
> - Biometric data (passkey biometrics stay on your device; we never receive them).
> - Health records (Protected Health Information).
> - Children's data (we do not accept users under 13; users between 13-15 require parental consent where required by local law).
> - Genetic data.
> - Racial or ethnic origin (as a structured field).
> - Political opinions.
> - Trade-union membership.

This is a **contractual commitment**. Adding a new collection of any of these categories requires:
1. Material privacy-notice update.
2. New consent flow (Art 9(2)(a) standard if applicable).
3. DPO review.
4. **[CONSULT COUNSEL]**.

### 6.2 Data-protection impact assessment (DPIA)

GDPR Art 35 requires a DPIA for processing "likely to result in a high risk to the rights and freedoms of natural persons," including "processing on a large scale of special categories" (Art 35(3)(b)).

**Smart Agent**: religious-belief data processing at scale triggers DPIA. Build target: `docs/security/privacy-and-compliance/dpia/v1-religious-data.md` — assesses risks and mitigations.

### 6.3 Special-category opt-out

A user can refuse to consent to special-category processing and still use the core platform with a reduced feature set:
- No prayer journal.
- No oikos tracking.
- No discipleship-training progress.
- Standard intent-marketplace + delegation features still available.

This satisfies the "freely given" prong of Art 9(2)(a) consent — the service is not bundled to require it.

## 7. Open items

| ID | Item | Owner |
|---|---|---|
| SC1 | Build the explicit Art 9 consent flow at signup | UX + Security |
| SC2 | Build Art 9 column encryption profile (Argon2id-wrapped DEK) | Developer |
| SC3 | Build column-level access log | Developer |
| SC4 | Author DPIA for religious-belief data processing | Security + Legal |
| SC5 | Build BAA template (if HIPAA scope materializes) | Legal |
| SC6 | Build age-verification at signup | UX |
| SC7 | Build "categories we do not collect" disclosure page | Documentarian |
| SC8 | Build content-type heuristic warning on free-text writes | Developer + Security |

## 8. Residual risk

1. **Free-text overflow**: a user can type anything into a `notes` field, including Art 9 special-category data we did not anticipate. Mitigation: UI warning; content classifier (if added, raises its own privacy concerns — see § 8.2).

2. **Inference from non-Art-9 fields**: `training_progress.module_key` alone reveals religious belief via the catalog. We treat as Art 9 (P3 § 4.9). A determined adversary could similarly infer political opinion from `intents` content. Mitigation: treat inferred-Art-9 the same as declared-Art-9 in retention and access control.

3. **Customer pushes PHI without BAA**: a customer's user logs medical details in prayer notes. The customer is in breach of ToS but Smart Agent now holds PHI it shouldn't. Mitigation: contractual disclaimer + suspended HIPAA-equivalent treatment of any tenant where PHI is suspected.

4. **Minor user evades age gate**: a 12-year-old lies about their age at signup. Mitigation: COPPA-style response on actual-knowledge discovery; periodic review of accounts whose patterns suggest minor users.

5. **Cross-jurisdictional Art 9 disagreement**: some member states (e.g., Germany) impose stricter requirements on religious-data processing under Art 9(4) derogations. Mitigation: per-jurisdiction analysis at scale; **[CONSULT COUNSEL]**.

6. **Coercion challenge to "explicit consent"**: a church organization could coerce members to consent. The "freely given" prong is at risk. Mitigation: Art 9(2)(d) "legitimate activities of religious bodies" may apply alternatively, but only for true membership-based bodies; we should not rely solely on member consent for org-level processing.

## 9. Change log

| Date | Author | Change |
|---|---|---|
| 2026-05-18 | Security agent | Initial draft. |

---

**End of P12.**
