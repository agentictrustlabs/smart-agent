# P1 — GDPR Article 17: Right to Erasure ("Right to be Forgotten")

> **Document status: DRAFT.**
> **[CONSULT COUNSEL]** marks every clause that requires sign-off from qualified data-protection counsel before customer-facing commitment.
> **Last updated: 2026-05-18.**

## 0. Executive summary (1 page)

GDPR Article 17 grants a data subject the right to obtain "without undue delay" the erasure of personal data concerning them, on any of six enumerated grounds (Art 17(1)(a)–(f)). The controller must comply within one month (Art 12(3)), extensible to three months for complex requests.

**Smart Agent is uniquely constrained**: roughly **40%** of the personal data we touch sits in immutable on-chain registries, while **60%** sits in deletable off-chain stores (person-MCP SQLite + Askar vault, org-MCP SQLite, web Postgres, AWS S3 audit archive, GraphDB mirror).

We resolve this with a **three-tier deletion model**:

| Tier | Locus | Action | Time SLA |
|---|---|---|---|
| **Tier 1: Hard delete** | Off-chain personal data (person-MCP, org-MCP, web Postgres, GraphDB non-on-chain rows, S3 archive) | Cryptographically erase (overwrite + DB-level delete + KMS key destruction for envelope-encrypted columns) | 30 days |
| **Tier 2: Link severance** | On-chain ↔ off-chain identifier binding (`smart_account_address ↔ did:passkey:...`, `agent_name ↔ smart_account`, off-chain profile lookup tables) | Delete the off-chain side; the on-chain side becomes a **pseudonymous orphan** — a 20-byte address no longer associated with any natural person inside our systems | 30 days |
| **Tier 3: On-chain ledger** | Smart account bytecode, delegation records, intent/pledge/vote/attestation assertions | **Cannot erase.** We mark the account inactive (`AgentRegistry.setActive(addr, false)`), revoke all outstanding delegations, and publish a tombstone assertion | 30 days for inactivation; ledger entries persist forever |

**The legal position we take** (subject to **[CONSULT COUNSEL]**) is that Tier-3 on-chain data becomes **non-personal data under Recital 26** once Tier-2 severance is complete and we have no reasonable means to re-link the address to a natural person. This is the **pseudonymization defense**. We back it with three supporting defenses: **public-interest** (Art 17(3)(b)/(c) for AML / fraud / governance records), **operational necessity** (delegations as audit trail), and **legal obligation** (Art 17(3)(b) — US BSA 31 U.S.C. § 5311 et seq., financial-services 5-year retention).

**Residual risk** (§ 11): an attacker with subpoena access to law-enforcement records, plus our archived bootstrapping logs (which we retain for 1 year for security audit), could potentially re-link an address to a name after Tier-2 severance. We disclose this risk at signup (§ 8.1).

## 1. Scope and definitions

### 1.1 What "erasure" means under Article 17

Article 17(1) reads (relevant excerpt):

> The data subject shall have the right to obtain from the controller the erasure of personal data concerning him or her without undue delay and the controller shall have the obligation to erase personal data without undue delay where one of the following grounds applies:
>
> (a) the personal data are no longer necessary in relation to the purposes for which they were collected or otherwise processed;
> (b) the data subject withdraws consent on which the processing is based according to point (a) of Article 6(1) or point (a) of Article 9(2), and where there is no other legal ground for the processing;
> (c) the data subject objects to the processing pursuant to Article 21(1) and there are no overriding legitimate grounds for the processing [...];
> (d) the personal data have been unlawfully processed;
> (e) the personal data have to be erased for compliance with a legal obligation in Union or Member State law to which the controller is subject;
> (f) the personal data have been collected in relation to the offer of information society services referred to in Article 8(1).

Article 17(3) lists **exemptions** — situations where the right does not apply. The three relevant to Smart Agent:

> (b) for compliance with a legal obligation which requires processing by Union or Member State law to which the controller is subject [...];
> (c) for reasons of public interest in the area of public health [...] [or other tasks carried out in the public interest, where applicable];
> (e) for the establishment, exercise or defence of legal claims.

### 1.2 What "personal data" means under Article 4(1) and Recital 26

Article 4(1):

> 'personal data' means any information relating to an identified or identifiable natural person ('data subject'); an identifiable natural person is one who can be identified, directly or indirectly, in particular by reference to an identifier such as a name, an identification number, location data, an online identifier or to one or more factors specific to the physical, physiological, genetic, mental, economic, cultural or social identity of that natural person.

Recital 26 (sentence 5):

> The principles of data protection should therefore not apply to anonymous information, namely information which does not relate to an identified or identifiable natural person or to personal data rendered anonymous in such a manner that the data subject is not or no longer identifiable.

The Article 29 Working Party Opinion 05/2014 on Anonymisation Techniques distinguishes:
- **Anonymization** — irreversible; data subject is no longer identifiable by any means reasonably likely to be used (the test in Recital 26).
- **Pseudonymization** — reversible; data subject is identifiable only with use of additional information held separately.

**Pseudonymization is still personal data**. Anonymization is not. The unresolved question is where on this spectrum a "permanently severed" link sits. We argue (§ 7.1) that with KMS-destroyed off-chain mapping and 1-year + ATL retention windows, the result is **effectively anonymous** for Recital-26 purposes, but **[CONSULT COUNSEL]** — this is the most contested clause in this document.

### 1.3 Smart Agent-specific terminology

| Term | Meaning |
|---|---|
| **Off-chain personal data** | Anything stored in person-MCP, org-MCP, web Postgres, GraphDB cache rows that are not mirrors of on-chain assertions, S3 audit archives, application logs. |
| **On-chain personal data** | EVM-state writes: contract storage and event logs in `AgentAccount`, `AgentNameResolver`, `AgentRegistry`, `AgentRelationship`, `DelegationManager`, `GeoClaimRegistry`, `PledgeRegistry`, `VoteRegistry`, `GrantProposalRegistry`, `MatchInitiationRegistry`. |
| **Link** | An off-chain row that maps a natural-person identifier (email, name, OAuth subject, passkey credentialId) to an on-chain address (smart account, agent name, person agent). |
| **Tombstone assertion** | An on-chain event we emit on inactivation (§ 5.2.4) — opaque to anyone without off-chain context, public on chain, useful for verifying inactivation. |

## 2. Data inventory: deletable vs immutable

Cross-reference to **P3 — PII Classification per Service** for full field-level detail. This section gives the inventory at controller-grain.

### 2.1 Deletable stores (Tier 1)

| Store | Path | Contents | Deletion method |
|---|---|---|---|
| Web Postgres (post-Phase-F.2) | RDS instance | `users` (demo/Google only), `recovery_delegations`, `recovery_intents`, `invites`, `training_modules` reference catalog | `DELETE FROM users WHERE id = $1` + KMS key destruction for any envelope-encrypted columns |
| Person-MCP SQLite | `apps/person-mcp/person-mcp.db` | `accounts`, `external_identities`, `profiles`, `chat_threads`, `chat_messages`, `user_preferences`, `oikos_contacts`, `prayers`, `training_progress`, `pinned_items`, `notifications`, `beliefs`, `coaching_notes`, `cross_delegation_grants`, `received_delegations`, `intents`, `needs`, `offerings`, `outcomes`, `activity_log_entries`, `work_items`, `proposal_submissions`, `engagement_holder_state`, `token_usage`, `ssi_proof_audit` | `DELETE FROM <table> WHERE principal = $1` (per-table cascade) — see § 5.2.2 |
| Person-MCP Askar vault | `apps/person-mcp/wallets/<principal>.askar` | AnonCreds link secret, credential records, key material for SSI operations | Vault-level `wallet.delete()` + secure-erase of underlying file (overwrite with random + unlink) — see § 5.2.3 |
| Org-MCP SQLite | `apps/org-mcp/org-private.db`, `apps/org-mcp/oid4vci.db` | `org_profiles_private`, `detached_members`, `revenue_reports`, `org_activity_log_entries`, `org_intents`, `org_needs`, `org_offerings`, `org_outcomes`, `org_work_items`, `org_notifications`, `org_beliefs`, `org_cross_delegation_grants`, `disbursements`, `outcome_attestations`, `engagement_provider_state`, `engagement_sessions`, `engagement_tranches`, `engagement_policies`, `policy_signers`, `org_token_usage` | Per-row delete keyed on `org_principal`; for members on a deleted user, scrub rows mentioning the user's address |
| Geo-MCP SQLite | `apps/geo-mcp/geo-mcp.db` | Private geo claims (precise GPS coordinates predicate-bound to publishable cells) | Per-principal cascade |
| A2A audit log SQLite | `apps/a2a-agent/data/audit.db` | Tool invocation history, delegation issuance, session state | Per-principal cascade; preserve hash chain via tombstone (§ 5.2.5) |
| GraphDB (private cache rows only) | `https://graphdb.agentkg.io/repositories/SmartAgents/data` named graph `<sa:DataGraph>` | Only on-chain mirror; **no off-chain personal data here by design (IA P4)** | If any cache row exists, `DELETE WHERE { <subj> ?p ?o }` on the mirror graph |
| S3 audit archive | `s3://smart-agent-audit-prod/checkpoints/` | Hash-chain checkpoints (no raw PII, but hash links may reveal pattern) | Object lifecycle policy + retention purge after legal hold expires |
| Application logs | `tmp/logs/web.log`, `tmp/logs/person-mcp.log`, etc. (dev); CloudWatch + Stackdriver (prod) | Should never contain PII per § 5.2.6, but operationally do today (see IA 09-privacy-audit § D) | Retention purge per P4 § 3.4 (90 days standard); identity-correlated lines redacted on request |

### 2.2 Immutable stores (Tier 3)

| Store | Contract / location | Contents | Why immutable |
|---|---|---|---|
| EVM contract storage | `AgentAccount`, `AgentNameResolver`, `AgentRegistry`, `AgentRelationship`, `DelegationManager`, `GeoClaimRegistry`, etc. | Smart account proxies, name mappings, trust edges, delegation records, geo claims | EVM state is append-only by consensus; even on a permissioned chain we choose, removing a state entry would require a coordinated rollback across all validators — not a per-user remedy |
| EVM event logs | Same contracts | `IntentAssertion`, `PledgeRecorded`, `VoteCast`, `ProposalSubmitted`, `MatchInitiated`, `OutcomeAttested` events | Event log is part of canonical chain history; cannot be edited without consensus rewrite |
| AnonCreds revocation registry | `revocation_registry/v1` | AnonCreds revocation list updates | Cryptographic accumulator; "removing" entries would invalidate prior proofs |

### 2.3 Mapping tables (Tier 2 — the severance surface)

These are the off-chain rows whose deletion converts on-chain personal data into pseudonymous orphans:

| Mapping | Stored where | Severance effect |
|---|---|---|
| `did:demo:* / did:google:* → smart_account_address` | `users` table (web Postgres) | After deletion, the smart account address is unlinkable to the legal name / email |
| `did:passkey:<chainId>:<smartAccount> → name + email` | Session JWT claims (in-flight only; never persisted server-side per project_sessionless_passkey_siwe.md) | Passkey users already pseudonymous on chain; legal name is volatile in session only |
| `did:ethr:<chainId>:<eoa> → ...` | Same as passkey | Same |
| `agent_name → smart_account_address` | `AgentNameResolver` (on-chain) + GraphDB mirror | We can reassign the name on chain but the original mapping is in event history. Mitigation: never use legal names as agent names (only handles) — see § 8.3 |
| `external_identities.identifier → principal` (person-MCP) | Person-MCP SQLite | OAuth subject / email link to principal |
| `Askar wallet file name → principal` | File system | One file per principal; rename / delete to sever |

## 3. The four defenses

Smart Agent's posture relies on a layered legal-technical defense. Each defense addresses on-chain Tier-3 data; they are **cumulative**, not alternative.

### 3.1 Pseudonymization defense (primary)

**Claim**: After Tier-2 link severance, the on-chain addresses associated with a deleted user are pseudonymous data **with no reasonable means** of re-identification by Smart Agent or any party we can compel. Per Recital 26, this data is therefore not personal data, and the Article 17 obligation does not apply to it.

**Supporting facts**:
- After Tier 2, no off-chain Smart Agent system holds a mapping from address to name.
- The address itself reveals nothing beyond on-chain activity (which is technically public on any blockchain).
- KMS-destroyed encryption keys ensure that even archived backups of the mapping cannot be decrypted (P2 § 4 — backup encryption uses per-tenant KMS keys; key destruction renders backups unreadable).

**Counter-arguments** (we acknowledge):
- The EDPB Opinion 28/2024 (2024-12-04) on data processing in AI models clarified that pseudonymous data **remains personal data** so long as **anyone, anywhere** has the additional information to re-identify, not just the controller. If a counterparty (e.g., the user's bank, a merchant the user transacted with) retains the off-chain mapping, the address is still personal data from that counterparty's perspective.
- The CJEU in *Breyer v. Bundesrepublik Deutschland* (C-582/14, 2016) held that an IP address is personal data when **legal means** to obtain additional identification exist (e.g., compelling an ISP). The same reasoning could apply to on-chain addresses if subpoena routes to KYC providers exist.

**Mitigation of counter-arguments**:
- We do not share the off-chain mapping with counterparties; only delegated, scoped views (see P5 consent UX).
- We log all access to the mapping (audit log per P3 § 8).
- We disclose at signup (§ 8.1) that on-chain records are permanent and pseudonymous, not anonymous, so the user understands the residual link via counterparty knowledge.

**[CONSULT COUNSEL]** — This is the most contestable interpretation in the entire document set. We expect a credible challenge from a sophisticated regulator. Our fallback is the public-interest defense (§ 3.2).

### 3.2 Public-interest defense (secondary, narrow)

**Claim**: Certain on-chain records are processed in the public interest under Art 6(1)(e) and the exemption in Art 17(3)(b)/(c) applies.

**Applicable to**:
- **Financial-record subsets** — pledges, disbursements, votes that constitute financial-services activity subject to AML / BSA / KYC retention obligations (P4 § 3.3).
- **Governance records** — votes and proposals that constitute the public action of a chartered legal entity (where the org agent is a registered org); akin to corporate meeting minutes, which under US Model Business Corporation Act § 16.01 must be retained "permanently" or "during the corporation's existence."

**Not applicable to**:
- Personal intents, prayers, oikos contacts, training progress — these are off-chain and Tier 1 deletes apply normally.
- Trust relationships and delegations between individuals — not "public interest" in the regulatory sense.

### 3.3 Legal-obligation defense (sectoral)

**Claim**: Where applicable law mandates retention of records that touch on-chain artifacts, Art 17(3)(b) exempts those records from erasure.

**Examples**:
- **US BSA 31 CFR § 1010.430** — financial-institution records 5 years.
- **US SOX 18 U.S.C. § 1519** — audit records 7 years (where Smart Agent customers are SOX-regulated entities).
- **GDPR Art 6(1)(c)** — processing necessary for compliance with a legal obligation.

We **publish a retention exception list** (P4 § 4) so a user filing an erasure request gets a clear "what we retain and why" disclosure.

### 3.4 Establishment-of-legal-claims defense (Art 17(3)(e))

**Claim**: Where a user has an unfulfilled commitment (open delegation, pending pledge, disputed grant outcome), retention is necessary for "the establishment, exercise or defence of legal claims."

**Concrete cases**:
- User pledged $5,000 USDC to a pool but funds have not yet been disbursed. Erasing the pledge could leave the recipient with a phantom obligation or a phantom credit.
- User issued a delegation that another party is currently relying on (open session key).
- User is the subject of a delivered grant; outcome attestations are in dispute window.

**Procedure**: a Tier-3 inactivation request **does not** revoke a pending pledge. We notify the user that their request triggers a **wind-down period** (§ 5.3) during which open commitments must settle (or be cancelled) before inactivation can proceed.

## 4. Edge cases: user wants to delete but has open commitments

This is the most operationally complex scenario. Decision matrix:

| Open commitment | User action | Smart Agent response |
|---|---|---|
| Open delegation (session key still valid) | Erasure request | Revoke delegation immediately (`DelegationManager.revokeDelegation`); proceed with Tier 1 + Tier 2 deletion |
| Pending pledge (funds committed, not disbursed) | Erasure request | Two options offered: **(a)** withdraw pledge (if pool rules allow); **(b)** retain user record under Art 17(3)(e) until pledge settles. UI default: (a). If user refuses to withdraw, Smart Agent retains the linkage and notifies the recipient pool |
| Pending grant proposal as proposer | Erasure request | Withdraw proposal; proceed |
| Outcome attestation in dispute window | Erasure request | Retain under Art 17(3)(e) until dispute window closes (default 14 days per spec 003); then proceed |
| User is a member of an org with `ROLE_OWNER` and is the sole owner | Erasure request | Org cannot be ownerless. Notify user; require either ownership transfer or org deactivation before proceeding |
| User is the subject of a coaching relationship with cross-delegation granting them visibility | Erasure request | Revoke the cross-delegation; notify the other party that the relationship is severed; proceed |
| User has issued AnonCreds credentials to other parties | Erasure request | We cannot revoke credentials we issued only with the user's link secret — but we can delete the user's holder vault. The credentials in counterparty holders remain valid against the on-chain credential definition. Disclosure to user required at deletion confirmation step |

**[CONSULT COUNSEL]** — option (b) above (retain user record over user's objection) is legally fraught. The withdrawal-and-disclose path (a) should be the strong default; only invoke (b) when concrete and material legal claims exist.

## 5. The deletion SOP (standard operating procedure)

### 5.1 Receipt and validation

**Channel**: `privacy@smart-agent.example` (production) — monitored mailbox routing to the DPO (Data Protection Officer; see P10 § 4.2).

**SLA**: acknowledge within 72 hours; complete within 30 days (extensible to 90 days for complex requests per Art 12(3); user is notified of the extension within the first 30).

**Step 1: Intake (Day 0)**
- Log the request in the privacy-request system (production tool TBD; see P10 § 5.4).
- Generate a case ID: `ERASURE-YYYYMMDD-NNN`.
- Acknowledge by email within 72 hours; cite the case ID.

**Step 2: Identity verification (Day 0–3)**
- **Verification methods, in priority order**:
  1. **Cryptographic — preferred**: the requester signs a challenge with the EOA / passkey credentialId associated with the account. Implementation: a route `apps/web/src/app/api/account/erasure-challenge/route.ts` issues a nonce; user signs; backend verifies via `ERC-1271` on the smart account.
  2. **Account-based**: requester logs in via the normal auth flow (passkey, SIWE, OAuth, demo) and clicks "Delete my account" — proves possession of the live session.
  3. **Out-of-band — fallback**: government-issued ID + matching contact channel (email or phone on file). Used only when (1) and (2) fail. Logged with elevated audit detail; reviewed by DPO before action.
- **GDPR Recital 64** allows reasonable verification but cautions against demanding excessive data. We log the verification method used and the data we processed solely for verification — that data is itself deleted after the verification window (30 days).

**Step 3: Scope determination (Day 3–5)**
- Run `apps/web/src/app/api/account/erasure-scope/route.ts` (to be built; spec'd in § 6) — produces a JSON manifest of every store containing data linked to the requester, separated by tier.
- Identify open commitments (§ 4). Notify user of any wind-down required.
- Document any legal-obligation retentions (§ 3.3). Notify user.

### 5.2 Execution (Day 5–30)

#### 5.2.1 Web Postgres deletion (Tier 1)

```
BEGIN;
DELETE FROM recovery_delegations WHERE user_id = $userId;
DELETE FROM recovery_intents WHERE user_id = $userId;
DELETE FROM invites WHERE created_by = $userId OR accepted_by = $userId;
DELETE FROM users WHERE id = $userId;
COMMIT;
```

After commit, schedule a **VACUUM FULL** on `users` to physically reclaim space (in dev SQLite; in prod Postgres use `pg_repack` or `VACUUM FULL` during off-peak window).

**KMS key destruction**: any column encrypted with a per-tenant DEK (currently none in `users`, but if added later — e.g., for stored OAuth tokens) — destroy the DEK via `aws kms schedule-key-deletion --pending-window-in-days 7` (minimum allowed). After the 7-day window, the encrypted ciphertext is permanently unreadable.

#### 5.2.2 Person-MCP SQLite cascade (Tier 1)

Person-MCP exposes a system-only tool `person:erase_principal` (to be built per § 6). The cascade order:

```
1. ssi_proof_audit       WHERE principal = $principal
2. token_usage            WHERE principal = $principal
3. activity_log_entries   WHERE principal = $principal
4. work_items             WHERE principal = $principal
5. engagement_holder_state WHERE principal = $principal
6. needs / offerings / outcomes WHERE principal = $principal
7. proposal_submissions   WHERE principal = $principal
8. intents                WHERE principal = $principal
9. beliefs                WHERE principal = $principal
10. coaching_notes        WHERE principal = $principal OR subject_agent = $principal_address
11. cross_delegation_grants WHERE principal = $principal OR grantee_agent = $principal_address
12. received_delegations  WHERE holder_principal = $principal OR delegator_principal = $principal_address
13. notifications         WHERE principal = $principal
14. pinned_items          WHERE principal = $principal
15. training_progress     WHERE principal = $principal
16. prayers               WHERE principal = $principal
17. oikos_contacts        WHERE principal = $principal
18. user_preferences      WHERE principal = $principal
19. chat_messages         WHERE principal = $principal
20. chat_threads          WHERE principal = $principal
21. profiles              WHERE principal = $principal
22. external_identities   WHERE principal = $principal
23. accounts              WHERE principal = $principal
```

After the cascade, **VACUUM** to reclaim space and overwrite slack pages.

**Cross-principal mention scrubbing**: rows in other principals' data may still reference the deleted user's `principal` or smart-account address. Examples:
- `oikos_contacts.person_name` of OTHER users may contain the deleted user's legal name as a third-party reference.
- `chat_messages.content` may quote the deleted user.

**Policy**: we **do not scrub** third-party mentions by default. The deleted user is the data subject for *their own* data; other users' free-text fields are those other users' personal data (or no one's, if generic). Forced scrubbing would be over-broad and could itself be an Article 5(1)(c) violation. **[CONSULT COUNSEL]**

**Exception**: if the deleted user explicitly identifies a specific row in another user's store as containing their PII (e.g., "Alice has my home address in her oikos notes"), we scrub that specific row with notice to the other user. This is an Art 17(1)(b) request — withdrawal of any implicit consent for one's name to appear in others' notes.

#### 5.2.3 Askar vault destruction (Tier 1)

```
1. Locate vault file: apps/person-mcp/wallets/<principal>.askar
2. Open the vault, call wallet.delete_wallet() to clear internal records
3. Close the vault
4. Secure-erase the file: overwrite with random bytes (3 passes per US DoD 5220.22-M historical guidance; modern SSD wear-leveling makes this best-effort) then unlink
5. On encrypted-at-rest filesystem (LUKS / EBS gp3 with kms key), KMS-destroy the per-tenant key if one was used; otherwise rely on TRIM + the next file allocation overwriting blocks
6. Log: vault file destroyed, principal=<principal>, timestamp=<iso8601>
```

#### 5.2.4 On-chain inactivation (Tier 3 — link severance support)

We do NOT and CANNOT delete on-chain records. We do publish three transactions that establish severance:

**Transaction 1: Revoke all outstanding delegations**

For each delegation `d` in `DelegationManager` where `d.delegator == userSmartAccount`:
```solidity
DelegationManager.revokeDelegation(d.delegationHash)
```

**Transaction 2: Mark account inactive**

```solidity
AgentRegistry.setActive(userSmartAccount, false)
```

This causes downstream readers (Discovery service, marketplace UI) to filter the account out by default. The account remains technically operable for transactions the user signs themselves — we cannot prevent that on a permissionless EVM — but our UIs hide it.

**Transaction 3: Tombstone assertion**

```solidity
AssertionRegistry.assertOpaque(
    subject=userSmartAccount,
    predicateUri="sa:erasureCompleted",
    objectHash=keccak256("ERASURE-" || caseId)
)
```

This emits an event that confirms erasure to any third party who reads the chain. It contains no personal data — only a hash of the case ID.

#### 5.2.5 A2A audit log scrub (Tier 1, hash-chain-preserving)

The a2a-agent maintains a hash-chained audit log. Deleting rows would invalidate the chain. Strategy:

- For each row in `audit_log` where `principal = $principal` or `subject_smart_account = $userAccount`:
  - Replace `payload_json` with `{"erased": true, "case_id": "<caseId>"}`.
  - Recompute `payload_hash` to match the new payload.
  - Chain integrity is preserved because each row's `prev_hash` references the previous row's row-level hash, not the previous payload directly. We rotate the row's hash forward.

This is **redaction-in-place**, not deletion — but the personal data content is destroyed. **[CONSULT COUNSEL]** — confirm this satisfies Art 17 given the chain reference remains.

Alternative considered: full row deletion + chain re-anchor with a notice marker. Rejected because it complicates downstream audit verification.

#### 5.2.6 GraphDB cache row removal (Tier 1)

GraphDB only holds on-chain mirror. After Tier 3, the next sync run (cron job `apps/web/src/lib/ontology/kb-sync.ts`) will pick up the `setActive(addr, false)` and the tombstone assertion. No manual GraphDB action needed; verify next sync ran successfully (typically within 5 minutes per the sync interval).

#### 5.2.7 S3 audit archive purge (Tier 1 with deferred component)

S3 hash-chain checkpoints contain only hashes, not raw PII. They are retained for security-audit purposes (P4 § 3.4 — 1 year). On erasure:
- Mark the case ID in a tombstone object `s3://smart-agent-audit-prod/erasures/<caseId>.json`.
- Allow lifecycle policy to expire the underlying checkpoints at the 1-year boundary.
- No new checkpoints reference the erased principal after Tier 1 completion.

#### 5.2.8 Application log redaction (Tier 1)

- For CloudWatch / Stackdriver: queries the log streams for `principal=<principal>` or `smartAccount=<addr>` patterns; redacts matching lines to `<redacted-erasure-CASE_ID>`.
- For files (dev only): not applicable to production erasure.
- Tooling: `apps/web/src/lib/ops/log-redactor.ts` (to be built; see § 6 build plan).

### 5.3 Wind-down period

For users with open commitments (§ 4), a **30-day wind-down** period starts on the erasure-request acknowledgement date.

During wind-down:
- User can cancel open pledges, withdraw proposals, transfer org ownership.
- We send weekly reminders (day 7, day 14, day 21, day 28).
- At day 30: any remaining commitments trigger either (a) automatic resolution per pool/round rules or (b) hold-open under Art 17(3)(e) with quarterly review until commitment closes.

### 5.4 Confirmation and record-keeping (Day 30)

The DPO (or designated privacy lead) signs off on:
1. Completion of Tier 1 across every store (manifest checklist).
2. Completion of Tier 2 link severance.
3. Completion of Tier 3 on-chain transactions (with transaction hashes).
4. Any retention exceptions and their legal basis.

The user is notified by email with the case ID and a copy of the retention-exception list (if any).

**Record retention**: we retain a record of the erasure request and its completion **indefinitely** under Art 30 (record of processing activities) and Art 5(2) (accountability). This record contains:
- Case ID
- Hash of the requester's identity verification artifact (not the artifact itself)
- Date of request, date of completion
- Stores affected
- Retention exceptions (if any) and their legal basis
- DPO sign-off

This record is the controller's evidence of compliance. The data subject can request a copy under Art 15 (P6).

## 6. Implementation: what to build

This section turns the SOP into concrete development work.

### 6.1 Backend routes (web app)

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `apps/web/src/app/api/account/erasure-challenge/route.ts` | POST | None (issues nonce) | Issues a sign-this-nonce challenge for cryptographic identity verification |
| `apps/web/src/app/api/account/erasure-request/route.ts` | POST | Session JWT or signed challenge response | Creates an erasure case; returns case ID; emails acknowledgement |
| `apps/web/src/app/api/account/erasure-scope/route.ts` | GET | Case ID + verification token | Returns the manifest of stores affected |
| `apps/web/src/app/api/account/erasure-execute/route.ts` | POST | Internal (DPO sign-off) | Triggers the cascade across stores |
| `apps/web/src/app/api/account/erasure-status/route.ts` | GET | Case ID + verification token | Returns case progress; user-visible |

### 6.2 MCP tools

| Tool | Server | Purpose |
|---|---|---|
| `person:erase_principal` | person-MCP | Tier-1 cascade for the given principal |
| `org:scrub_member_references` | org-MCP | Remove references to a deleted user across org-MCP rows |
| `geo:erase_principal` | geo-MCP | Tier-1 cascade for geo claims |

These tools are **service-only** (no user-facing surface); HMAC-authenticated by the a2a-agent acting on behalf of the DPO action.

### 6.3 Smart-contract additions

| Contract | Function | Purpose |
|---|---|---|
| `AgentRegistry` | `setActive(addr, false)` — **already exists** | Mark inactive |
| `AssertionRegistry` | `assertOpaque(subject, predicateUri, objectHash)` — **build this** | Tombstone publication |
| `DelegationManager` | `revokeDelegationsByDelegator(delegator)` — **build this** convenience bulk-revoke | Tier-3 revocation in one tx |

### 6.4 Audit / operations tooling

- `apps/web/src/lib/ops/log-redactor.ts` — redacts CloudWatch / Stackdriver lines matching erasure case patterns.
- `apps/web/src/lib/ops/erasure-manifest.ts` — generates the scope JSON across all stores.
- `apps/web/src/lib/ops/dpo-dashboard/` — internal-only UI for case management.

### 6.5 Test coverage

| Test | Where | Verifies |
|---|---|---|
| `tests/privacy/erasure-cascade.test.ts` | Integration | Tier-1 cascade across person-MCP correctly removes every row keyed on `principal` |
| `tests/privacy/erasure-onchain.test.ts` | Foundry | Tier-3 transactions emit expected events and produce expected state |
| `tests/privacy/erasure-confirmation.test.ts` | E2E | Full flow: request → verify → execute → confirmation email |
| `tests/privacy/wind-down.test.ts` | Integration | Open commitments trigger wind-down; reminders sent on schedule |

## 7. Legal-position drill-downs

### 7.1 Pseudonymization vs anonymization (long-form)

Article 4(5) defines pseudonymization:

> 'pseudonymisation' means the processing of personal data in such a manner that the personal data can no longer be attributed to a specific data subject without the use of additional information, provided that such additional information is kept separately and is subject to technical and organisational measures to ensure that the personal data are not attributed to an identified or identifiable natural person.

A pseudonymized record is still personal data. The "additional information" can be:
- Held by the controller in another database.
- Held by a third party.
- Reconstructed by inference (e.g., from on-chain transaction patterns).

For Smart Agent's on-chain addresses, after Tier 2:
- We destroy the off-chain mapping. ✓ (no Smart Agent system has the link)
- We destroy the KMS keys that encrypted any backups of the mapping. ✓ (no backup is recoverable)
- Third parties may still hold mappings: KYC providers (where used), counterparties the user transacted with, exchanges that processed funds in or out. ✗ (this is the residual)
- Inference from on-chain patterns: possible in principle (chain analytics firms), more or less feasible depending on user behavior. ✗ (this is the residual)

The CJEU in *Breyer* (C-582/14, 2016) and *SRB v EDPS* (T-557/20, 2023) suggest that personal-data status depends on whether **legally and practically reasonable means** of re-identification exist for **any** party who may foreseeably obtain the data. The EDPB Opinion 28/2024 reinforces this for AI training data: pseudonymized data fed to a model is still personal data so long as **someone, somewhere** can re-link.

For on-chain data, the realistic re-linkage paths are:
1. Subpoena to a KYC provider (if one exists in the user's flow).
2. Subpoena to a counterparty exchange.
3. Chain-analytics inference (probabilistic, not deterministic).

**Our position**: paths (1) and (2) are not under our control; we have no contractual relationship granting us the ability to compel disclosure. Path (3) is probabilistic, not "reasonable means" under any reading of Recital 26 we are aware of. We therefore argue Tier 3 is **functionally anonymous from Smart Agent's perspective**, with disclosed counterparty residual risk.

**[CONSULT COUNSEL]** specifically on whether the existence of KYC paths under counterparty control is sufficient to keep the address personal-data-from-our-perspective.

### 7.2 Why we cannot fall back on Art 11

Article 11 ("Processing which does not require identification") allows a controller to escape some obligations if the controller is no longer in a position to identify the data subject. We **cannot** rely on Art 11 here because:
- Article 11(2) requires that we **demonstrate** we cannot identify the subject AND informs the subject of this when collecting the data.
- We do collect identifying data at signup; we then go through deliberate severance. This is not the Art 11 scenario.

### 7.3 Why "blockchain-as-storage" is not an Art 17(3)(b) exemption

A bare "blockchain is immutable" argument under Art 17(3)(b) does **not** work. Art 17(3)(b) requires a *legal obligation* compelling retention. The fact that a controller voluntarily chose immutable storage does not satisfy the requirement — choice of architecture cannot defeat a data-subject right. The CNIL (French DPA) guidance "Blockchain et RGPD" (2018-09-24) explicitly addresses this.

What works under Art 17(3)(b) is: **on top of** the chain-based architecture, layer specific data classes that ARE subject to legal retention (financial-services 5-year, audit 7-year), and apply the exemption only to those classes. We do this in P4 § 4.

### 7.4 CCPA / CPRA right-to-delete comparison

CCPA § 1798.105 grants a similar right with material differences:
- 45-day SLA (vs GDPR 30 days).
- Verification standard explicitly permitted (§ 1798.140(s) "verifiable consumer request").
- Exemptions enumerated in § 1798.105(d) include: complete the transaction, detect security incidents, debug, exercise free speech, comply with the CalECPA / a legal obligation, conduct internal use reasonably aligned with consumer's expectations.

Our SOP satisfies CCPA by being stricter (30-day vs 45-day SLA, same verification standard). CCPA does not require us to also notify recipients of corrections (GDPR Art 17(2) does — see § 7.5). Where CCPA-only customers are involved, we apply the GDPR-equivalent process.

### 7.5 Art 17(2) — notification of recipients

> Where the controller has made the personal data public and is obliged pursuant to paragraph 1 to erase the personal data, the controller, taking account of available technology and the cost of implementation, shall take reasonable steps, including technical measures, to inform controllers which are processing the personal data that the data subject has requested the erasure by such controllers of any links to, or copy or replication of, those personal data.

For Smart Agent: any time we publish an on-chain assertion (e.g., a `MatchInitiation` event), we are arguably making data public. Per Art 17(2), on erasure, we must inform downstream processors. Implementation:
- The on-chain tombstone (§ 5.2.4) serves as the notification — any sync layer reading the chain will see the inactivation event.
- We additionally publish a documented "erasure event feed" at `/api/erasures.json` (build-list in § 6.1) so non-blockchain readers can subscribe.

## 8. Disclosures required at signup

To make our erasure posture lawful under Art 5(1)(a) (lawfulness and transparency), we must disclose at signup. Specific text drafts (to be reviewed by counsel):

### 8.1 On-chain permanence disclosure

> **Important: Some of your activity creates a permanent public record on a blockchain.**
>
> When you do any of the following on Smart Agent:
> - Deploy your smart account
> - Issue a delegation
> - Make a pledge to a pool
> - Submit a grant proposal
> - Cast a vote
> - Publish a geo claim
> - Establish a trust relationship with another agent
>
> a record of that action is written to a permanent ledger and **cannot be deleted by anyone, including us**.
>
> The records on the ledger identify you by a randomly-generated address (a "smart account address"), not by your name or email. We separately keep a mapping from your name/email to your address. If you ask us to delete your account, we delete that mapping along with your profile, prayers, oikos contacts, and other private data. After we do so, the ledger record still exists, but it points to an address with no connection to your name or email **in any system we control**.
>
> **Residual risk**: parties you've transacted with may keep records of their own, and chain-analytics firms may be able to make probabilistic guesses about which address belongs to which person based on transaction patterns. We cannot prevent that.
>
> By signing up, you acknowledge this trade-off.

### 8.2 Custodial wallet disclosure

> **Important: We hold your credentials and your signing keys.**
>
> Smart Agent operates a **custodial wallet** model. We hold the cryptographic material that represents your identity (your "link secret" and your AnonCreds credential vault) on servers under our control.
>
> Benefits: you can use Smart Agent from any device without managing private keys yourself.
>
> Trade-offs:
> - If our servers are compromised, your credentials could be misused.
> - We can see every credential presentation you make (because we generate the presentations on your behalf).
> - The "unlinkability" property of AnonCreds — the design feature that lets you present a credential to two different verifiers in a way they cannot correlate — is **reduced** in the custodial model, because we can correlate the presentations internally.
>
> We do not sell, share, or use this data for advertising. We log access for security audit. You can request that we delete your vault as part of an account deletion.
>
> A non-custodial mode (where you hold your own keys on your device) is on our roadmap but not available in v1.

### 8.3 Agent name disclosure (handle-only)

> Your "agent name" (e.g., `alice.agent`) is published on the blockchain as a public mapping to your address. **Do not put your legal name in your agent name** — once published, the name → address mapping is permanent.

UI enforcement: signup form validates agent names against a pattern that prefers handles over legal names. We also lint against common-name patterns at form time.

## 9. Per-jurisdiction quick reference

| Jurisdiction | Right | Statute | SLA | Verification standard |
|---|---|---|---|---|
| EU | Erasure | GDPR Art 17 | 30 days, +60 extensible | Reasonable (Recital 64) |
| UK | Erasure | UK GDPR Art 17 + DPA 2018 | 30 days, +60 extensible | Reasonable |
| Cal. (US) | Deletion | CCPA § 1798.105 / CPRA | 45 days, +45 extensible | "Verifiable consumer request" |
| Virginia (US) | Deletion | VCDPA § 59.1-577 | 45 days, +45 extensible | Authentication |
| Colorado (US) | Deletion | CPA § 6-1-1306 | 45 days, +45 extensible | Authentication |
| Connecticut (US) | Deletion | CTDPA § 42-518 | 45 days, +45 extensible | Authentication |
| Utah (US) | Deletion | UCPA § 13-61-201 | 45 days, +45 extensible | Authentication |
| Texas (US, 2024-07-01) | Deletion | TDPSA | 45 days, +45 extensible | Authentication |
| Oregon (US, 2024-07-01) | Deletion | OCPA | 45 days, +45 extensible | Authentication |
| Montana (US, 2024-10-01) | Deletion | MTCDPA | 45 days, +45 extensible | Authentication |
| Delaware (US, 2025-01-01) | Deletion | DPDPA | 45 days, +45 extensible | Authentication |
| Togo | Right to rectification/erasure | Loi 2019-014 Art 13 | "Reasonable delay" | Reasonable |

Posture: apply the **30-day GDPR SLA** uniformly. Apply the **GDPR verification standard** uniformly except where statute requires stronger (e.g., CCPA's "verifiable consumer request" is stricter than GDPR's "reasonable," but our cryptographic-signature method satisfies both).

## 10. Operational metrics

We will track and publish (at least internally; subject to counsel review for external publication):

| Metric | Definition |
|---|---|
| `erasure_requests_received_total` | Count, by jurisdiction |
| `erasure_requests_completed_within_sla` | Count |
| `erasure_requests_extended` | Count |
| `erasure_requests_partially_refused` | Count, by exemption ground |
| `erasure_wind_down_days_p50` / `_p95` | Distribution |
| `erasure_onchain_tx_cost_total` | Sum of gas paid for revocations + inactivations |

Target: 100% within SLA for the first 12 months; report quarterly to board.

## 11. Residual risk

We are honest about what this posture does not solve:

1. **Counterparty re-identification.** If you transacted with a known counterparty (e.g., bought USDC via a KYC'd exchange), they can re-identify you regardless of what we do. We do not undertake to compel them. The signup disclosure (§ 8.1) covers this.

2. **Chain analytics.** Firms like Chainalysis, TRM Labs, Elliptic apply heuristic and graph-based methods to de-anonymize on-chain addresses. We cannot prevent this. The signup disclosure (§ 8.1) covers this.

3. **Compelled disclosure.** If law enforcement subpoenas us **before** we delete the off-chain mapping, we must comply. We minimize the window (30-day SLA) and we destroy KMS keys for backups (§ 5.2.1) so post-deletion subpoenas come back empty.

4. **Counterparty holders of issued credentials.** If a user issued an AnonCreds credential to another party (e.g., a coach issued a coaching-status credential to a disciple), that credential remains valid in the recipient's vault after the issuer's account is erased. We cannot reach into recipient vaults. We disclose at deletion (§ 4) and offer revocation-registry updates as the remediation.

5. **Permissioned-chain rollback.** If catastrophic privacy regulation required forced rollback of on-chain state, the permissioned-chain operator (us) could in theory coordinate validators to roll back. We do not plan to use this path; we treat it as a break-glass option only on regulator-of-last-resort order. **[CONSULT COUNSEL]**

6. **The pseudonymization-vs-anonymization legal interpretation is contested** (§ 7.1). If a regulator rules against our interpretation, the immediate impact is that on-chain addresses remain personal data after Tier 2, and we may be ordered to take additional measures we cannot technically perform. Contingency: documented escalation to permissioned-chain rollback (#5) as the last-resort remedy; otherwise, conditional acceptance of a fine.

## 12. Out-of-scope (for this document)

- **Data export under Art 15 / Art 20** — see P6 and P7.
- **Consent management for processing** — see P5.
- **Retention windows for non-deleted users** — see P4.
- **Breach notification** — see P11.

## 13. Change log

| Date | Author | Change |
|---|---|---|
| 2026-05-18 | Security agent (draft) | Initial draft for counsel review. |

---

**End of P1.**
