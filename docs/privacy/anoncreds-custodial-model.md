# Smart Agent Custodial Wallet Model — Privacy Policy

> **Document status: DRAFT.**
> **[CONSULT COUNSEL] markers** indicate clauses that MUST be
> reviewed by qualified data-protection counsel before any
> customer-facing publication. Nothing in this document constitutes
> legal advice; the substantive legal positions taken are working
> drafts for review.
> **Audience: board, privacy counsel, security reviewers.**
> **Companion documents:** `docs/security/privacy-and-compliance/`
> (P1–P12) for the full privacy & compliance set; `docs/privacy/data-flow-diagrams.md`
> for visual data flow.
> **Last updated: 2026-05-18.**

## Executive summary

Smart Agent operates a **custodial wallet model** for the data and
cryptographic material that represent a user's verifiable-credential
identity. Specifically, our `person-mcp` service holds, on behalf of
each user:

- The user's **AnonCreds credential vault** (issued credentials, in
  the Hyperledger Aries / AnonCreds-RS format).
- The user's **AnonCreds link secret** (the 256-bit scalar that
  anchors zero-knowledge proofs to a specific holder).
- The user's **signed delegations** at rest (off-chain delegation
  bodies; on-chain delegations are public on the ledger).
- The user's **profile metadata** (names, contacts, oikos
  relationships, prayers, training progress — see P3 for the full
  classification).

This document is the **plain-language explanation of that custodial
relationship**: what we hold, what we do not hold, what user rights
attach, and what trade-offs and residual risks the user accepts at
signup.

It is meant to be reviewable by counsel for inclusion (in whole or
in summary form) in the customer-facing privacy policy.

## 1. Why custodial

Smart Agent designs for users who do not want to hold their own
private keys. Concretely, the custodial model enables:

- **Always-available delegations.** A user's session can be
  re-established from any device with passkey or SIWE authentication;
  the link secret and credentials are server-side. Non-custodial
  alternatives require the user to manage a device-local vault
  (loss = irrecoverable identity).
- **Cross-device signing.** A user can issue a delegation from their
  phone after starting a session on their laptop. Non-custodial
  alternatives require either device-to-device key sync or
  per-device enrollment.
- **Server-side credential issuance (OID4VCI).** Issuers (e.g., a
  church issuing a discipleship credential, a steward issuing a
  pool-stewardship credential) write to our holder vault on the
  user's behalf via authenticated delegation. The user does not
  need to be online to receive a credential.
- **Operational simplicity for non-technical users.** A user with no
  understanding of cryptography can join, hold credentials, and
  present them — the substrate is invisible.

The custodial trade-off is **user trust in our infrastructure**: a
compromise of our servers exposes the credentials and link secrets
of every user whose vault is hosted. We mitigate this with KMS-backed
encryption (see § 6), audit logging (K6), incident-response
procedures (P11), and per-user vault encryption.

A **non-custodial mode** — where the user holds the link secret and
credential vault on their own device — is on our roadmap, but is
NOT available in v1. See § 9.

## 2. What we hold

The complete inventory, by store:

### 2.1 `person-mcp` SQLite database

Per-principal rows covering:

- **Profile metadata** — display name, email, phone, postal
  address, date of birth, gender, language, preferences. Stored in
  the `profiles` table. Strong PII (`S` per P3 § 4.4); encrypted at
  rest under a KMS-wrapped per-tenant DEK for the high-sensitivity
  columns.
- **OAuth / passkey identifiers** — `external_identities` table;
  links the user's principal to their Google subject or WebAuthn
  credentialId.
- **AnonCreds presentation audit** — `ssi_proof_audit`; every
  credential presentation made on the user's behalf. **Strong PII**
  (`S`), including revealed attributes per presentation.
- **Activity records** — intents, needs, offerings, outcomes, work
  items, chat history, prayer requests, oikos contacts, coaching
  notes, training progress. Behavior data (`B`).
- **Delegation records** — `cross_delegation_grants`,
  `received_delegations`. The off-chain bodies of delegations the
  user has issued or received.

Full per-column classification in
`docs/security/privacy-and-compliance/P3-pii-classification-per-service.md`
§ 4.

### 2.2 `person-mcp` Askar vault

One vault file per principal at `apps/person-mcp/wallets/<principal>.askar`.
Contents:

- **AnonCreds link secret** — the 256-bit scalar that proves
  "the holder of this credential set is the same person across
  presentations" via zero-knowledge. The most sensitive cryptographic
  material in the user's identity envelope.
- **AnonCreds credentials** — credential blobs issued by issuers
  (e.g., the church's member credential, the steward's role
  credential).
- **Wallet-internal indices and key material** — needed by Aries
  Askar to manage the vault.

The Askar vault file is encrypted at rest. The vault key is derived
from a per-tenant seed; the seed is wrapped by our KMS (see § 6).

### 2.3 KMS-managed cryptographic material

Held in AWS KMS or GCP Cloud KMS, never on our application disks:

- **Session-envelope KEK** — encrypts session packages.
- **Master, bundler-envelope, session-issuer signers** — secp256k1
  signing keys for system-level operations.
- **Tool-executor signers** — secp256k1 signing keys for the
  round-awards, disbursement, pool-lifecycle, grant-awards, and
  auth-bootstrap executors.
- **Inter-service MAC keys** — HMAC keys for service-pair
  authentication.

The user does not have direct access to these. They are the
substrate that mediates server-side operations on the user's
behalf.

## 3. What we do NOT hold

This list is at least as important as § 2. We intentionally do NOT
hold:

- **The user's passkey private key.** WebAuthn private keys live in
  the user's device's authenticator (TPM, Secure Enclave, hardware
  key). We see only the public key and per-authentication
  signatures.
- **The user's signing intent.** Every WalletAction the user
  initiates requires their affirmative action — a passkey assertion,
  an EOA signature, or a server-issued delegation that the user
  granted under § 4 consent rules. We do not silently sign on the
  user's behalf for high-risk actions; see
  `docs/security/privacy-and-compliance/P5-consent-ux-for-delegation-grants.md`
  § 5 for the high-risk threshold list.
- **The user's biometric data.** Passkey authentication uses
  biometric verification ON the user's device; the biometric never
  crosses the wire. We see only the authenticator's attestation.
- **Government-issued ID documents.** Smart Agent's v1 onboarding
  does NOT collect government ID. KYC-required products may layer
  on top in a future release — that is a separate consent and a
  separate sub-processor.
- **The user's email/SMS content from any source** beyond what they
  explicitly enter into their Smart Agent profile or chat history.
  We do not scrape inboxes, contact lists, or social graphs from
  other services.

## 4. The custodial trade-off (plain language)

A user signing up for Smart Agent is asking us to be the steward of
the cryptographic envelope that represents their verifiable-credential
identity. In exchange for the operational properties in § 1, the
user accepts:

| Trade-off | What it means |
|---|---|
| **Server compromise risk** | If our servers (or a sub-processor's) are compromised, the user's vault contents are at risk. We mitigate with KMS-backed encryption, audit logging, incident response, and per-user encryption — but the residual risk is real. |
| **Reduced unlinkability** | AnonCreds is designed so two verifiers cannot correlate the same user's presentations cryptographically. In the custodial model, **we, the custodian, CAN correlate** because we generate the presentations. This is disclosed at signup. |
| **Government compelled disclosure** | A subpoena to Smart Agent for user records is enforceable; we will comply with valid legal process. In a non-custodial model, the user is the only party able to disclose. We minimize the exposure window via short retention (P4), encrypted backups with destroyable KMS keys (P1 § 5.2.1), and a transparency report (P10 §) once we have any government requests to disclose. |
| **Sub-processor cascade** | KMS providers (AWS, GCP), Vercel, Ontotext (GraphDB), application hosting providers — each is a sub-processor. Their access scope is documented in P9. |

[CONSULT COUNSEL] — the "compelled disclosure" framing should be
reviewed for jurisdictional accuracy. US, EU, and Togo each have
distinct legal-process regimes and our transparency commitments may
need to be jurisdiction-scoped.

## 5. User rights

A custodial user has the same rights as any data subject under GDPR,
CCPA / CPRA, and the other US state laws inventoried in P1 § 9. We
specifically commit to operationalizing:

### 5.1 Right of access (Art 15, CCPA § 1798.110)

A user can request a complete bundle of every piece of personal
data we hold about them, in a portable format. SOP: P6.

Bundle includes:
- Profile fields (decrypted server-side; re-encrypted under the
  user's portable key for transit).
- AnonCreds credential blobs in their canonical AnonCreds-RS
  serialization.
- Link secret in a portable wrapped form.
- Delegation records (off-chain bodies + on-chain transaction
  hashes for cross-reference).
- Audit records of every presentation we performed on the user's
  behalf.

SLA: 30 days per GDPR Art 12(3).

### 5.2 Right to portability (Art 20)

A user can export their AnonCreds vault to a non-custodial wallet of
their choice. SOP: P7.

The export process:
1. User requests portability bundle.
2. We package vault + link secret + credentials in
   AnonCreds-RS-compatible format under encryption to a user-supplied
   public key.
3. User imports into their target wallet (e.g., a device-local
   Aries-compatible wallet) using the matching private key.
4. **Optional simultaneous revocation** of the custodial copy. The
   user chooses whether to keep both (e.g., for fallback) or
   remove the custodial copy.

### 5.3 Right to erasure (Art 17, CCPA § 1798.105)

A user can request complete deletion of their custodial vault and
all linked off-chain data. SOP: P1.

Three-tier model:
1. **Tier 1 — Off-chain data**: hard delete from person-MCP SQLite
   + Askar vault destruction (overwrite + unlink) + KMS DEK
   destruction.
2. **Tier 2 — Link severance**: delete the off-chain mapping from
   the user's smart-account address to their name/email. After
   this, the on-chain address is a pseudonymous orphan in our
   systems.
3. **Tier 3 — On-chain inactivation**: revoke outstanding
   delegations, mark the account inactive, publish a tombstone
   assertion. The on-chain ledger entries themselves cannot be
   deleted; the legal-pseudonymization argument applies.

SLA: 30 days.

Edge cases (open pledges, pending votes, etc.) trigger a wind-down
period — see P1 § 4 and § 5.3.

### 5.4 Consent transparency (P5)

Before any delegation is signed on the user's behalf, the user
sees the eight pre-signature disclosure components (plain summary,
scope, target, time, value, technical detail, revocation mechanism,
on-chain vs off-chain). The user must take an affirmative action
(passkey assertion, type-to-confirm) — never an implicit consent.

High-risk thresholds (single tx > $1,000 USDC, total > $10,000 over
delegation lifetime, duration > 30 days, no caps) trigger stricter
confirmation flows.

Every active delegation is visible in Settings → Delegations with
single-click revocation.

### 5.5 Right to object (Art 21)

For processing on a legitimate-interest basis (e.g., security audit
logging), the user may object. We will balance the user's interest
against the controller's; for security audit, the legitimate
interest is high (operational integrity, regulatory requirement
under § 5(2) accountability), so we expect to refuse most
objections in this class. Each objection is reviewed case-by-case
by the DPO.

## 6. Encryption posture

### 6.1 Vault encryption

Every Askar vault is encrypted at rest with a per-tenant key. The
per-tenant key is derived from a vault seed that is:

- **Generated**: at user signup, by the server, using
  `crypto.randomBytes(32)`.
- **Wrapped**: under our KMS envelope key (AWS KMS or GCP Cloud KMS)
  using `GenerateDataKey` with EncryptionContext bound to the
  user's principal.
- **Stored**: the wrapped form in the user's `accounts` row; the
  plaintext form NEVER persists, lives only in memory for the
  duration of vault operations.

[CONSULT COUNSEL] — the per-tenant DEK approach is the standard
mitigation for the "single key compromise = total compromise" risk.
A regulator may ask for evidence of the wrapping flow; the
implementation lives in `apps/person-mcp/src/lib/vault-crypto.ts`
(to be cross-referenced once the wrapping flow is fully landed).

### 6.2 In-transit encryption

Every hop is TLS 1.3 minimum:
- User browser → Smart Agent web app (HTTPS via Vercel certificates)
- Web app → A2A agent (HTTPS internal, MAC-authenticated)
- A2A agent → Person-MCP (HTTPS internal, MAC-authenticated; the
  MAC key is one of the inter-service KMS HMAC keys)
- A2A agent → GraphDB (HTTPS, basic-auth, on the GraphDB hub)

The MAC layer is independent of TLS — see C1 § threat model. A TLS
break does not authenticate a malicious request: the MAC layer would
still reject it.

### 6.3 KMS-based key custody

All cryptographic keys live in the cloud KMS provider's HSM:

- AWS KMS keys: HSM-backed (Origin = AWS_KMS), accessed via FIPS
  endpoints in production (`kms-fips.<region>.amazonaws.com`).
- GCP Cloud KMS keys: `protection_level = HSM` on every key
  version.

No long-lived cloud credentials in environment variables — the
runtime federates via Vercel OIDC to AWS STS or GCP Workload
Identity. See K2 and the IaC modules in `infra/aws/` and
`infra/gcp/`.

### 6.4 Encrypted backups with destroyable keys

Where we hold backups of vaults or session state, the backup is
encrypted under a KMS key that we can DESTROY. A user requesting
deletion triggers KMS `ScheduleKeyDeletion` on the per-tenant DEK;
after the 7-day window, the backup ciphertext is permanently
unreadable.

## 7. Retention

| Data class | Retention | Reference |
|---|---|---|
| Profile metadata | While account active; 30 days after deletion request | P4 § 3.1 |
| AnonCreds credentials | While account active; 90 days after issuance for unaccepted offers | P4 § 3.3 |
| Link secret | While account active; destroyed at deletion | P4 § 3.3 |
| Presentation audit | 90 days (rolling window) | P4 § 3.4 |
| Chat history | 1 year default, user-configurable | P4 § 3.2 |
| Activity logs | 90 days | P4 § 3.4 |
| Application logs | 90 days (operations) | P4 § 3.4 |
| Inter-service audit (KMS calls) | 7 years (WORM) | K6 § 7 |

The retention floor (7 years on audit) is driven by SOX and other
financial-records regulations applicable to the financial-action
subset of our operations. The bulk of personal data is on shorter
windows.

## 8. Data residency

For v1, Smart Agent operates in a single region (`us-east-1` on AWS
or `us-east1` on GCP). All user data is stored in that region;
backups replicate to a secondary region (`us-west-2` / `us-west1`)
for disaster recovery.

EU users: the v1 posture means EU user data crosses to the US. We
operate under the EU-US Data Privacy Framework (DPF) — Smart Agent
will self-certify under the DPF before EU launch — and use the
appropriate SCCs with sub-processors. See P2 for the full data
residency story.

[CONSULT COUNSEL] — DPF self-certification is a board-level
decision; this clause documents the intent.

A future v2 EU region (Frankfurt or Dublin on AWS, europe-west on
GCP) is on the roadmap; no committed timeline.

## 9. Non-custodial roadmap

A non-custodial mode where the user holds their own link secret
and credential vault on their device is on our roadmap. The shape:

- Vault file lives on user's device, possibly in a passkey-locked
  encrypted container.
- Smart Agent's role narrows to a presentation proxy: the server
  presents on behalf of the user only AFTER the user has signed
  the presentation request from their device.
- The custodial-mode privacy posture would NOT apply; the user
  becomes the controller of their own credential vault.

No committed timeline. Spec 009 (TODO) will own the design when it
opens.

## 10. Sub-processor cascade

Every party that may, in the course of providing the service, gain
access to user data:

| Sub-processor | Role | Data accessed | Region |
|---|---|---|---|
| **AWS** | KMS, S3 (audit logs), CloudWatch | Ciphertext only (envelope-wrapped) — KMS itself never sees plaintext PII | us-east-1 (primary), us-west-2 (replica) |
| **GCP** | Alternative KMS / WIF substrate | Same as AWS — ciphertext only | us-east1 (primary) |
| **Vercel** | Web application + serverless hosting | User session state in transit; profile data in process memory | Global edge; US primary |
| **Ontotext** | GraphDB (knowledge base) | On-chain mirror only — no off-chain PII per IA P4 | Self-hosted by Smart Agent on cloud infra (region TBD) |
| **PagerDuty (or Opsgenie)** | Incident alerting | Alarm metadata — KMS principal, IP, method names. NOT data plaintext | Vendor's region |
| **Email transactional provider** | Notification email delivery | User email address; message content for transactional notifications | Vendor's region |

Full list with sub-processor agreements and DPA references in
`docs/security/privacy-and-compliance/P9-sub-processor-inventory.md`.

## 11. Breach notification

If we discover a compromise affecting user data:

- **72-hour rule (GDPR Art 33)**: notify the supervisory authority
  within 72 hours of becoming aware of the breach, where
  reasonably possible.
- **User notification (Art 34)**: notify affected users without
  undue delay when the breach is "likely to result in a high risk"
  to their rights and freedoms.
- **Severity tiers**: see `docs/security/privacy-and-compliance/P11-breach-notification-procedures.md`.
- **Tabletop cadence**: quarterly internal breach drill, per P11
  § 5.

The IaC modules (`infra/aws/` and `infra/gcp/`) provide the
detection substrate — every KMS call is in the audit trail; the
nine R-KMS-* and four G-KMS-* alarms route to PagerDuty. From the
moment a finding fires, our breach clock starts.

[CONSULT COUNSEL] — the 72-hour clock and the notification
threshold ("high risk") are jurisdiction-specific; counsel review
is required before any external commitment.

## 12. Residual risk (honest disclosure)

We are honest about what this posture does NOT solve:

1. **Custody compromise.** A compromise of our KMS principal or
   our person-mcp infrastructure exposes vault contents. Mitigated
   but not eliminated by KMS HSM, audit, per-user DEKs.

2. **Linkability via custodial visibility.** Because we generate
   presentations server-side, we can correlate them across
   verifiers. AnonCreds' cryptographic unlinkability is preserved
   FROM THE VERIFIER, not from us. The non-custodial roadmap (§ 9)
   is the long-term fix.

3. **Sub-processor compromise.** A breach at AWS, GCP, Vercel, or
   any other sub-processor (P9) propagates. We can rotate keys,
   re-encrypt backups, and notify users; we cannot prevent the
   initial breach.

4. **Compelled disclosure.** A valid subpoena to Smart Agent is
   enforceable. Mitigated by short retention (P4), destroyable-key
   backups (P1 § 5.2.1), and minimization (we collect what we need,
   not more).

5. **Insider misuse.** A Smart Agent insider with KMS access could
   in principle decrypt vaults. Mitigated by:
   - IAM principle-of-least-privilege (only the runtime role has
     `kms:Decrypt`; human admins do NOT).
   - Audit logging of every KMS call.
   - PagerDuty alerts on unexpected principal access (R-KMS-4 /
     G-KMS-4).
   - Quarterly KMS audit review (K6 § 6).
   - The IAM `kms:EncryptionContextKeys` condition that requires
     the canonical context tuple to be present on every Decrypt.

6. **Counterparty holders of issued credentials.** Once a user has
   issued an AnonCreds credential to another party (e.g., a coach
   issued a coaching credential to a disciple), that credential
   exists in the recipient's vault. If the user later deletes their
   account, we delete THEIR vault, but the recipient's credential
   remains valid against the on-chain credential definition. We
   document this at deletion confirmation; the issuer can update
   the AnonCreds revocation registry to invalidate the recipient's
   future use.

## 13. Cross-references

| Document | Purpose |
|---|---|
| `docs/security/privacy-and-compliance/P1-gdpr-article-17-right-to-erasure.md` | Erasure SOP — three-tier deletion model |
| `docs/security/privacy-and-compliance/P2-data-residency.md` | EU vs US recipes; SCC / DPF |
| `docs/security/privacy-and-compliance/P3-pii-classification-per-service.md` | Per-column classification across stores |
| `docs/security/privacy-and-compliance/P4-data-retention-policies.md` | Eight retention classes; automated purge |
| `docs/security/privacy-and-compliance/P5-consent-ux-for-delegation-grants.md` | Pre-signature disclosure; high-risk gates |
| `docs/security/privacy-and-compliance/P6-right-of-access-export.md` | Art 15 / CCPA export SOP |
| `docs/security/privacy-and-compliance/P7-portability-did-credential-export.md` | Art 20 portability; AnonCreds export |
| `docs/security/privacy-and-compliance/P8-data-minimization-audit.md` | Quarterly minimization audit |
| `docs/security/privacy-and-compliance/P9-sub-processor-inventory.md` | Sub-processor cascade |
| `docs/security/privacy-and-compliance/P10-soc2-type2-readiness.md` | SOC 2 Type II posture |
| `docs/security/privacy-and-compliance/P11-breach-notification-procedures.md` | 72-hour SLA, SEV tiers, tabletops |
| `docs/security/privacy-and-compliance/P12-special-categories-and-hipaa.md` | Art 9 special categories; HIPAA / COPPA applicability |
| `docs/security/key-management/K6-cloudtrail-monitoring-and-alerting.md` | Audit log substrate, alarms |
| `docs/security/key-management/K4-hsm-fips-evaluation.md` | FIPS posture (HSM-backed keys, FIPS endpoint) |
| `docs/security/cryptographic-posture/C3-cryptographic-agility-and-pqc.md` | PQC migration — applies to AnonCreds primitives |
| `infra/aws/` + `infra/gcp/` | The Terraform that provisions the KMS substrate above |
| `docs/privacy/data-flow-diagrams.md` | Visual data flows for this custodial model |

## 14. Sign-off

This document is a DRAFT pending:

- [ ] **Security agent** review (custodial-substrate threat model)
- [ ] **Information Architect** review (classification accuracy)
- [ ] **Documentarian** review (prose quality, user-comprehensibility)
- [ ] **External counsel** review (every `[CONSULT COUNSEL]` clause)
- [ ] **Board** review (custodial trade-off framing, residual risk
      acceptance)

Once sign-offs land, customer-facing extracts go into the
publication-ready privacy policy under
`apps/web/src/app/(legal)/privacy/page.tsx` (or analogous path).
This document remains the internal source of truth.

## 15. Change log

| Date | Author | Change |
|---|---|---|
| 2026-05-18 | Phase H execution | Initial draft. |
