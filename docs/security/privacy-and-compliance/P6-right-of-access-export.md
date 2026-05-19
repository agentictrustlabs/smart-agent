# P6 — Right of Access (Data Export)

> **Document status: DRAFT.**
> **Last updated: 2026-05-18.**

## 0. Executive summary

GDPR Article 15 grants the data subject the right to obtain confirmation of whether personal data is being processed and, if so, access to the personal data plus specified information about the processing. The CCPA §§ 1798.110 / 1798.130 grants analogous rights to know and access.

Smart Agent's Right-of-Access SOP: a user makes a request, we verify identity, we generate a comprehensive bundle within **30 days** (GDPR) / **45 days** (CCPA, extensible to 90), we deliver via a signed download URL, and we log the request.

## 1. What Article 15 requires

GDPR Art 15(1) requires the controller to confirm whether processing is happening and, if so, to provide:

- (a) the purposes of processing
- (b) the categories of personal data concerned
- (c) the recipients (or categories of recipient)
- (d) the envisaged retention period (or criteria)
- (e) the existence of the right to rectification, erasure, restriction, objection
- (f) the right to lodge a complaint with a supervisory authority
- (g) where the data is not collected from the data subject, the source
- (h) the existence of automated decision-making, including profiling, with meaningful information about the logic and consequences

Plus Art 15(3) — a copy of the personal data undergoing processing.

CCPA § 1798.110 requires:
- (1) the categories of personal information collected about the consumer
- (2) the categories of sources
- (3) the business purpose
- (4) the categories of third parties shared with
- (5) the specific pieces of personal information collected

Both rights converge on: **"give me a copy of my data + tell me what you do with it."**

## 2. Request channel and intake

Same `privacy@smart-agent.example` mailbox + the in-app surface "Settings → My Data → Export My Data."

**SLA**:
- GDPR: 30 days; extensible to 90 with notification.
- CCPA: 45 days; extensible by 45 with notification.
- Posture: aim for 30-day uniform.

**Case ID format**: `ACCESS-YYYYMMDD-NNN`.

## 3. Identity verification

Same recipe as P1 § 5.1 step 2:

1. **Cryptographic — preferred**: signed challenge via EOA / passkey.
2. **Account-based**: logged-in user clicks "Export my data."
3. **Out-of-band**: government-ID + matching contact channel; DPO review.

Stricter standard than erasure? **No.** GDPR Art 12(6) allows additional information *only when reasonable doubt exists*; CCPA explicitly requires a "verifiable consumer request" but the bar is similar in practice. We apply the same standard to access and erasure.

## 4. Scope of the export

### 4.1 What's included by default

The default bundle includes everything in P3 that is `S` or `B` for the requesting user, plus reference metadata.

| Source | Default content |
|---|---|
| Web Postgres `users` row | id, email, name, walletAddress, did, smartAccountAddress, personAgentAddress, agentName, onboardedAt, createdAt — but NOT `privateKey` |
| Person-MCP `profiles` | All `S` columns: name, email, phone, DOB, gender, language, address, location, preferences |
| Person-MCP `external_identities` | provider, identifier (OAuth subject), verified, metadata |
| Person-MCP `user_preferences` | All |
| Person-MCP `oikos_contacts` | All (with note about third-party data — § 6) |
| Person-MCP `prayers` | All |
| Person-MCP `training_progress` | All |
| Person-MCP `intents`, `needs`, `offerings`, `outcomes` | All |
| Person-MCP `activity_log_entries` | All |
| Person-MCP `notifications` | All |
| Person-MCP `beliefs`, `coaching_notes` (as principal) | All |
| Person-MCP `cross_delegation_grants` (issued and received) | All |
| Person-MCP `received_delegations` | Metadata + delegation hashes (not raw blobs unless requested) |
| Person-MCP `proposal_submissions` | All |
| Person-MCP `engagement_holder_state`, `work_items` | All |
| Person-MCP `ssi_proof_audit` | All (full presentation history) |
| Person-MCP `token_usage` | All |
| Org-MCP rows where user is `submitted_by`, `verified_by`, `created_by`, `created_at_principal` of org | The slice relevant to the user |
| A2A audit log | Rows where `principal = userPrincipal` or `subject_smart_account = userSmartAccount` |
| On-chain | Indexed list of all on-chain actions: agent account deployment, delegations issued / revoked / received, intents asserted, pledges made, votes cast, proposals submitted, geo claims, attestations |
| GraphDB | Triples where subject = user's smart account or agent name (all public on-chain mirror; included for completeness) |
| Consent records (P5) | All consent events |
| Erasure / access request history | All prior requests by this user |

### 4.2 What's NOT included by default (opt-in)

| Item | Why opt-in | How to request |
|---|---|---|
| Raw AnonCreds credential blobs | These are intended for presentation; raw export is a sensitive operation that could enable misuse | Explicit checkbox: "Include raw credential blobs (advanced)" |
| Encrypted backups | Not personal data per se, just artifacts | Not exportable; not personal data the user has a right to |
| `users.privateKey` (dev only) | Critical material; export is itself a security risk | Refused; user retrieves via separate "recovery" flow (passkey rotation) |
| Third-party data IN oikos contacts and similar | Third-party PII | Included only if it's data ABOUT the requesting user (it isn't typically); see § 6 |

### 4.3 What's NEVER included

| Item | Reason |
|---|---|
| Other users' data | Not the user's personal data |
| Internal system metrics, anonymized telemetry | Not personal data |
| KMS key material | Not personal data; security risk |
| Source code, configuration | Not personal data |

## 5. Bundle format

### 5.1 Machine-readable JSON-LD

Primary format: **JSON-LD** with `@context` references to W3C and Smart Agent ontology. Structure:

```json
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://smart-agent.example/contexts/v1"
  ],
  "@type": "DataSubjectExport",
  "exportedAt": "2026-05-20T10:00:00Z",
  "caseId": "ACCESS-20260518-001",
  "dataSubject": {
    "@id": "did:passkey:1:0xAB60...3f8d",
    "smartAccountAddress": "0xAB60...3f8d"
  },
  "categories": {
    "profile": { ... },
    "externalIdentities": [ ... ],
    "preferences": { ... },
    "oikosContacts": [ ... ],
    "prayers": [ ... ],
    "trainingProgress": [ ... ],
    "intents": [ ... ],
    "activityLog": [ ... ],
    "notifications": [ ... ],
    "delegations": {
      "issued": [ ... ],
      "received": [ ... ]
    },
    "consents": [ ... ],
    "onChain": {
      "agentAccountDeployment": { ... },
      "delegations": [ ... ],
      "pledges": [ ... ],
      "votes": [ ... ],
      "proposals": [ ... ]
    }
  },
  "processingInfo": {
    "purposes": [...],
    "recipients": [...],
    "retentionPolicies": [...],
    "rights": [...]
  }
}
```

### 5.2 PDF human-readable summary

A 5-10 page summary covering:
1. Account identity (DID, addresses, account creation date)
2. Profile contents (with redactions for the `privateKey` column)
3. Activity summary (counts per category)
4. Active delegations (issued + received)
5. Active commitments (pledges, proposals, votes)
6. Recent activity log
7. Processing information (per § 1)
8. How to exercise rights

Generated via headless Chrome rendering of an HTML template; signed PDF (PAdES) for tamper-evidence.

### 5.3 ZIP packaging

Final deliverable:
```
ACCESS-20260518-001.zip
├── README.txt              (explanation of the bundle)
├── export.json             (machine-readable per § 5.1)
├── summary.pdf             (human-readable per § 5.2)
├── on-chain-history.json   (full on-chain event index)
└── attachments/            (any binary blobs the user opted to include)
```

Total size typical: 100KB-5MB depending on activity volume.

## 6. Third-party data in exports

Per P3 § 11, an export contains rows authored by the user but ABOUT third parties (oikos contacts, coaching notes, witnessed activities).

**Policy**:
- These rows are included in the export because they are the user's "personal data" in the sense of GDPR Recital 49 — data subjects have access to data they created, even if it concerns others.
- A clear disclaimer is included in the export:
  > "Some sections of this export contain notes you created about other people. Those people are also data subjects under privacy law. Please use this information responsibly. Do not share or republish without consent."
- We do NOT include rows other users authored that mention the requesting user (those are the authoring user's data; if the requesting user wants them, they file a third-party access request).

**[CONSULT COUNSEL]** — this is a subtle area; some DPAs may take a stricter view on third-party-data-in-export.

## 7. Implementation

### 7.1 Routes

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `apps/web/src/app/api/account/export/request/route.ts` | POST | Session | Create export case |
| `apps/web/src/app/api/account/export/status/route.ts` | GET | Session + caseId | Status of case |
| `apps/web/src/app/api/account/export/download/route.ts` | GET | Signed URL | Bundle download |

### 7.2 Job

Background job triggered by `/request` endpoint:
1. Validate identity (per § 3).
2. Generate manifest (re-using `apps/web/src/lib/ops/erasure-manifest.ts` logic from P1 § 6.4; rename to `data-manifest.ts`).
3. For each source, dispatch a system-only MCP read call that returns the user's slice.
4. Compose `export.json`.
5. Render `summary.pdf`.
6. Index on-chain events (via DiscoveryService + direct chain reads).
7. ZIP bundle.
8. Sign ZIP with operational key (proves authenticity; not the user's key).
9. Upload to S3 with **24-hour signed URL**.
10. Email user with download link.

### 7.3 Signed download URL

- Format: AWS S3 presigned URL.
- TTL: 24 hours.
- Single-use: log download; revoke URL after first successful download.
- Re-request: user can request a new URL up to 3 times within 30 days.

### 7.4 MCP tool

| Tool | Server | Purpose |
|---|---|---|
| `person:export_for_principal` | person-MCP | Return all rows for the principal |
| `org:export_member_slice` | org-MCP | Return rows for the principal as member |
| `geo:export_for_principal` | geo-MCP | Return geo data |

Service-only HMAC; called by the export job.

## 8. CCPA-specific additions

CCPA § 1798.115 ("right to know") requires additional disclosures:

- **Sources of personal information** — we add a `sources` field per category in `export.json`:
  - "Profile data: collected from you (signup form)."
  - "OAuth identifiers: collected from {Google} via OAuth authorization."
  - "On-chain addresses: derived from cryptographic key generation on your device or our servers."
- **Categories of third parties** — we add a `recipients` field listing categories (cross-reference to P9 sub-processors).
- **Sale or sharing**: we declare NO sale or sharing in v1. The export includes "Sale/Share: None."

## 9. Right to know — without verification

CCPA § 1798.130(a)(2) allows a consumer to make a non-verifiable request for the *categories* of personal information collected (not the specific pieces). Our public privacy notice provides this as a static page; no request needed.

## 10. Operational metrics

| Metric | Definition |
|---|---|
| `access_requests_received_total` | Count |
| `access_requests_completed_within_sla` | Count |
| `access_request_p50_completion_days` | Distribution |
| `access_request_p95_completion_days` | Distribution |
| `access_request_extension_count` | Count of requests that needed extension |

## 11. Operational logging of the access request

Every access request is logged in the `compliance_requests` table (build target):
- `case_id`, `kind = 'access'`, `principal`, `created_at`, `completed_at`, `verification_method`, `dpo_sign_off`

This is itself processing of the user's data; we disclose in the privacy notice.

## 12. Open items

| ID | Item | Owner |
|---|---|---|
| AC1 | Build `/api/account/export/*` routes | Developer |
| AC2 | Build per-MCP `export_for_principal` tools | Developer |
| AC3 | Build PDF summary template + renderer | UX + Developer |
| AC4 | Build on-chain history indexer for user-scope | Developer |
| AC5 | Define JSON-LD `@context` schema | Ontologist |
| AC6 | Build the public "Categories We Collect" privacy notice page (§ 9) | Documentarian + Security |

## 13. Residual risk

1. **Bundle leakage**: a signed URL could be intercepted, copied, replayed. Mitigations: single-use enforcement, TTL = 24h, IP-anchored URL (if feasible), audit log of every download.

2. **Bundle size**: a highly active user could generate a 100MB+ bundle. Mitigations: chunked export, multiple bundles, streaming format option (NDJSON instead of JSON).

3. **Lengthy export delays for high-volume users**: Indexing on-chain history for a user with thousands of events could take hours. Mitigations: parallel indexing per registry; cache the index; if the job times out, hand off to a longer-running queue.

4. **Stateless passkey users with no profile**: per project_sessionless_passkey_siwe.md, passkey users have no `users` row. Their personal data is in person-MCP only. Export is shorter but works the same way.

5. **PDF rendering of free-text content with rich Unicode**: emoji, RTL text, mixed scripts. Mitigations: test corpus with these inputs; fall back to plaintext attachment if PDF rendering fails.

6. **Third-party data inclusion (§ 6) regulatory challenge**: a strict regulator may require us to redact third-party data from exports, complicating both the export logic and the user's expectation that they get back what they wrote. We bias toward inclusion + disclaimer; reverse if directed.

## 14. Change log

| Date | Author | Change |
|---|---|---|
| 2026-05-18 | Security agent | Initial draft. |

---

**End of P6.**
