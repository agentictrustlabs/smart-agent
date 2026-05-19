# P3 — PII Classification per Service

> **Document status: DRAFT.**
> **Last updated: 2026-05-18.**

## 0. Executive summary

This document classifies every persistent data field across the Smart Agent system. The classification drives:
- **Retention** (P4): different classes have different retention windows.
- **Encryption-at-rest required?** Strong-PII gets per-tenant envelope encryption beyond the database-level KMS key.
- **AnonCreds-protectable?** Whether the field could be expressed as an AnonCreds attribute and disclosed via predicate-proof.
- **Exportable?** (P6 right of access)
- **Deletable?** (P1 right of erasure)
- **Cross-border restriction?** (P2)

## 1. Classification taxonomy

We adopt a five-tier scheme. Some PII is more equal than others.

| Class | Symbol | Meaning |
|---|---|---|
| **PII-Strong** | `S` | Direct identifiers; data subject is identifiable without auxiliary information. Names, email, phone, postal address, DOB, gov ID, biometric, precise location, financial-account numbers. Maps to GDPR Art 4(1) "personal data" plain reading, CCPA "personal information" (PI), and (for special categories) GDPR Art 9. |
| **PII-Pseudonymous** | `P` | Identifiers usable to single out an individual when combined with mapping info Smart Agent or a third party may hold. Smart account addresses, EOA addresses, DIDs, AnonCreds credential IDs, OAuth subjects, passkey credentialIds. Per *Breyer* (CJEU C-582/14, 2016), this is personal data so long as some path to re-identification exists. |
| **Behavior** | `B` | Activity records that may individually identify when correlated. Oikos contacts, prayer requests, intents, activity logs, training progress. Often inferentially sensitive even when no explicit identifier is present. |
| **Aggregate** | `A` | Counts, sums, averages, hashes derived from `S` / `P` / `B` data. Generally non-personal once sufficiently aggregated, but k-anonymity considerations apply for low-cardinality buckets. |
| **Non-PII** | `N` | Reference data, schema definitions, public configuration. Training-module catalog, T-Box ontology terms, public contract addresses, ENS domain mappings. Not personal data. |

A row may contain mixed classes (e.g., a profile row has `S` email + `S` name + `N` `created_at`). We classify **per column** and roll up to the most-restrictive class per row for retention purposes.

## 2. Service map (reminder)

| Service | Path | Owner-MCP / persistence |
|---|---|---|
| Web app | `apps/web/` | Postgres / SQLite |
| A2A agent | `apps/a2a-agent/` | SQLite (audit log + session state) |
| Person-MCP | `apps/person-mcp/` | SQLite + Askar vault |
| Org-MCP | `apps/org-mcp/` | SQLite |
| Geo-MCP | `apps/geo-mcp/` | SQLite |
| Verifier-MCP | `apps/verifier-mcp/` | SQLite (verifier policies) |
| GraphDB | `graphdb.agentkg.io` | RDF triplestore (mirror only) |

## 3. Web app (`apps/web/src/db/schema.ts`)

Post-Phase-F.2, the schema is **thin** — most private data has migrated out (see memory `project_data_store_consolidation.md`). Five tables remain:

### 3.1 `users` (demo + Google OAuth flows only — passkey/SIWE are sessionless)

| Column | Class | Encryption | Exportable | Deletable | Notes |
|---|---|---|---|---|---|
| `id` | `P` | DB-level KMS | Yes (P6) | Tier-1 (P1 § 5.2.1) | Demo key like `cat-001` or did `did:google:<sub>` |
| `email` | `S` | DB-level KMS | Yes | Tier-1 | Direct identifier |
| `name` | `S` | DB-level KMS | Yes | Tier-1 | Direct identifier |
| `walletAddress` | `P` | DB-level KMS | Yes | Tier-2 (link severance) | EOA — after Tier-1 of profile, this becomes orphan on chain |
| `did` | `P` | DB-level KMS | Yes | Tier-1 | Decentralized identifier per W3C DID-core |
| `privateKey` | `S+` | **Per-tenant DEK + KMS-wrapped** | **NEVER** (export refuses) | Tier-1 | Demo-only; production passkey/SIWE flows have no private key in DB. See § 9 |
| `smartAccountAddress` | `P` | DB-level KMS | Yes | Tier-2 | 4337 smart account |
| `personAgentAddress` | `P` | DB-level KMS | Yes | Tier-2 | |
| `agentName` | `S` (handle is public on chain) | DB-level KMS | Yes | Tier-2 (on-chain mapping is permanent; we sever the lookup) | Public on chain via `AgentNameResolver`. Disclosure required at signup (P1 § 8.3) |
| `onboardedAt` | `B` | DB-level KMS | Yes | Tier-1 | Timestamp |
| `accountSaltRotation` | `A` | DB-level KMS | Yes | Tier-1 | Counter |
| `createdAt` | `B` | DB-level KMS | Yes | Tier-1 | Timestamp |

**Row-class rollup**: `S` (strongest column wins).
**AnonCreds-protectable**: name and email could theoretically be expressed as AnonCreds attributes if we issued an "identity" credential. We do not; this is for future considerations.
**Special note** (`privateKey` row): the column is **dev-only**. Production deployments MUST remove this column or refuse to seed (per project_sessionless_passkey_siwe.md, passkey + SIWE flows do not insert a `users` row at all). For demo deployments, this column is the highest-impact field in the entire system — compromise of it lets an attacker impersonate users on chain. See § 9.

### 3.2 `recovery_delegations`

| Column | Class | Notes |
|---|---|---|
| `id` | `P` | |
| `userId` | `P` | FK to `users.id` |
| `passkeyId` | `S` | WebAuthn credentialId; uniquely identifies a passkey-authenticator pairing |
| `publicKey` | `P` | WebAuthn public key (COSE format) |
| `signCount` | `A` | Counter |
| `createdAt` | `B` | |

**Row-class rollup**: `S`.

### 3.3 `recovery_intents`

| Column | Class | Notes |
|---|---|---|
| `id` | `P` | |
| `userId` | `P` | |
| `recoveryEmail` | `S` | Out-of-band recovery contact |
| `verifiedAt` | `B` | |
| `expiresAt` | `B` | |

**Row-class rollup**: `S`.

### 3.4 `invites`

| Column | Class | Notes |
|---|---|---|
| `id` | `P` | Invite code |
| `orgPrincipal` | `P` | Org address — public on chain anyway |
| `createdBy` | `P` (since project_sessionless_passkey_siwe.md: loose text column, may be a DID without DB row) | |
| `acceptedBy` | `P` | |
| `email` (target email) | `S` | Personal data of the *invitee*, not the inviter |
| `role` | `N` | Reference enum |
| `createdAt`, `acceptedAt`, `expiresAt` | `B` | |

**Row-class rollup**: `S`.
**Note**: the invitee is a data subject before they sign up. We process their email under Art 6(1)(f) (legitimate interest) with the disclosed purpose of org-invitation; we must offer them an Art 21 objection path even though they have no account yet. **[CONSULT COUNSEL]**

### 3.5 `training_modules`

| Column | Class | Notes |
|---|---|---|
| `key`, `title`, `description`, `track`, `program`, `version` | `N` | Reference catalog content |
| `lastUpdated` | `N` | |

**Row-class rollup**: `N` — non-personal reference data.

## 4. Person-MCP (`apps/person-mcp/src/db/schema.ts`)

This is the largest concentration of `S` and `B` data in the system. Each table is keyed on `principal` (a string identifier matching the user's session principal — typically `person_<did>` or similar). The cross-table foreign key is `principal`, not a `users.id` join.

### 4.1 `ssi_proof_audit`

Audit log of every AnonCreds proof presentation.

| Column | Class | Encryption | Export | Delete | Notes |
|---|---|---|---|---|---|
| `id` | `P` | KMS | Yes | Tier-1 | |
| `principal` | `P` | KMS | Yes | Tier-1 | |
| `wallet_context` | `P` | KMS | Yes | Tier-1 | Vault context label |
| `holder_wallet_ref` | `P` | KMS | Yes | Tier-1 | |
| `verifier_id` | `P` | KMS | Yes | Tier-1 | |
| `purpose` | `B` | KMS | Yes | Tier-1 | "Why was the proof requested?" |
| `revealed_attrs` | `S` | **Per-tenant DEK** | Yes (P6) | Tier-1 | The revealed attributes may include name, DOB, etc. depending on what the verifier asked for |
| `predicates` | `B` | KMS | Yes | Tier-1 | Predicate expressions (`age >= 18`) |
| `action_nonce` | `P` | KMS | Yes | Tier-1 | Replay-protection nonce |
| `pairwise_handle` | `P` | KMS | Yes | Tier-1 | Per-verifier pseudonym (anti-correlation) |
| `holder_binding_included` | `A` | KMS | Yes | Tier-1 | |
| `result` | `B` | KMS | Yes | Tier-1 | ok / denied |
| `created_at` | `B` | KMS | Yes | Tier-1 | |

**Row-class rollup**: `S`.
**Custodial-model note**: this log inherently reveals every verifier the user presented to. The "unlinkability" of AnonCreds across verifiers is preserved at the cryptographic level (each presentation is unlinkable to the verifier without our help), **but we, the custodian, see the linkage**. Disclosure required (P5 + signup disclosure).

### 4.2 `accounts`

| Column | Class |
|---|---|
| `id`, `principal`, `account_address`, `chain_id` | `P` |
| `label` | `S` (free-text — user may put their name in it) |
| `created_at` | `B` |

**Row-class rollup**: `S`.

### 4.3 `external_identities`

| Column | Class | Notes |
|---|---|---|
| `id`, `principal`, `provider` | `P`, `P`, `N` | provider = google / passkey / siwe |
| `identifier` | `S` | OAuth subject / WebAuthn credentialId — typically a unique identifier issued by the IdP |
| `verified`, `created_at` | `A`, `B` | |
| `metadata` (JSON) | `S` (may contain email, name from OAuth payload) | |

**Row-class rollup**: `S`.

### 4.4 `profiles` — the core PII repository

| Column | Class | Encryption | Export | Delete |
|---|---|---|---|---|
| `id`, `principal` | `P`, `P` | KMS | Yes | T1 |
| `display_name` | `S` | KMS | Yes | T1 |
| `bio` | `S` (free text — may contain other identifiers) | KMS | Yes | T1 |
| `avatar_url` | `P` (URL may resolve to a face photo on third-party storage) | KMS | Yes | T1 |
| `email` | `S` | **Per-tenant DEK** | Yes | T1 |
| `phone` | `S` | **Per-tenant DEK** | Yes | T1 |
| `date_of_birth` | `S` (Art 9 if minor; otherwise standard PII) | **Per-tenant DEK** | Yes | T1 |
| `gender` | `S` (Art 9 special category — see P12) | **Per-tenant DEK** | Yes (with extra confirmation) | T1 |
| `language` | `S` (low-sensitivity but identifying in combination) | KMS | Yes | T1 |
| `address_line1`, `address_line2`, `city`, `state_province`, `postal_code`, `country` | `S` | **Per-tenant DEK** | Yes | T1 |
| `location` (legacy freeform) | `S` | **Per-tenant DEK** | Yes | T1 |
| `preferences` (JSON) | `B` | KMS | Yes | T1 |
| `created_at`, `updated_at` | `B` | KMS | Yes | T1 |

**Row-class rollup**: `S`.
**AnonCreds protection**: `date_of_birth` is the canonical use case for predicate proofs (`age >= 18`). Recommended for any high-risk flow. See P5 § 6.
**Art 9 special category**: `gender` may be a special category under Art 9 if interpreted as sex life / sexual orientation depending on local guidance. For Smart Agent (a church-discipleship context), additional categories may apply — see P12.

### 4.5 `chat_threads` + `chat_messages`

Free-text content between user and AI assistant.

| `chat_threads.title` | `S` (free text) |
| `chat_messages.content` | `S` (free text) |
| `metadata` | `B` |

**Row-class rollup**: `S`.
**Storage volume warning**: AI chat tends to grow unbounded. P4 § 3.2 sets a default 1-year retention for chat content; user-configurable.

### 4.6 `user_preferences`

| Column | Class |
|---|---|
| `language`, `home_church` | `S` (church = special category religious data, Art 9 — see P12) |
| `location` | `S` |
| `theme` | `B` |
| `notifications` (JSON) | `B` |

**Row-class rollup**: `S` (Art 9 special-category status).

### 4.7 `oikos_contacts`

| Column | Class |
|---|---|
| `id`, `principal` | `P`, `P` |
| `person_name` | `S` (this is a THIRD party's name — see § 11) |
| `proximity`, `spiritual_response_state` | `S` (religious data — Art 9) |
| `last_contact_at`, `planned_conversation` | `B` |
| `notes` | `S` (free text re a third party) |
| `tags` | `B` |
| `created_at`, `updated_at` | `B` |

**Row-class rollup**: `S` + Art 9.
**Third-party data warning**: these rows are about people who may not be Smart Agent users. We process the third-party data under Art 6(1)(f) (legitimate interest in helping a believer track their oikos) but those third parties have Article 15/16/17/21 rights they may exercise. See § 11.

### 4.8 `prayers`

| Column | Class |
|---|---|
| `title`, `content` | `S` (religious data — Art 9) |
| `linked_oikos_contact_id` | `P` |
| `tags` | `B` |

**Row-class rollup**: `S` + Art 9.

### 4.9 `training_progress`

| Column | Class |
|---|---|
| `module_key`, `program_key`, `track` | `B` (links to public catalog; combination reveals user's spiritual-growth journey, Art 9) |
| `status`, `completed_at`, `hours_logged` | `B` |

**Row-class rollup**: `B` (escalates to `S` under Art 9 because of religious-context inference).

### 4.10 `pinned_items`

| Column | Class |
|---|---|
| `item_type`, `item_ref`, `display_order` | `P`, `P`, `A` |

**Row-class rollup**: `P`.

### 4.11 `notifications`

| Column | Class |
|---|---|
| `kind`, `payload` | `N`, `S` (payload may template in names per IA 09 audit) |

**Row-class rollup**: `S`.

### 4.12 `beliefs`

| Column | Class |
|---|---|
| `statement` | `S` + Art 9 (religious belief) |
| `tags`, `informs_intent_id`, `visibility` | `B`, `P`, `B` |

**Row-class rollup**: `S` + Art 9.

### 4.13 `coaching_notes`

| Column | Class |
|---|---|
| `subject_agent` | `P` (the disciple's address) |
| `content` | `S` + Art 9 (notes ABOUT another person's spiritual journey) |

**Row-class rollup**: `S` + Art 9.
**Special**: subject_agent is a third-party address. See § 11.

### 4.14 `cross_delegation_grants`

| Column | Class |
|---|---|
| `grantee_agent` | `P` |
| `scope`, `caveat_terms` | `B` |
| Other | `B` |

**Row-class rollup**: `P`.

### 4.15 `received_delegations`

Holder-side store; signed delegation blobs received from other principals.

| Column | Class |
|---|---|
| `delegator_principal`, `audience`, `kind`, `subject_label`, `delegation_json`, `delegation_hash` | `P`, `P`, `N`, `S` (label may contain name), `P`, `P` |

**Row-class rollup**: `S`.

### 4.16 `intents` (and projections `needs`, `offerings`, `outcomes`)

| Column | Class |
|---|---|
| `direction`, `kind`, `addressed_to`, `summary`, `context`, `status`, `priority` | `N`, `N`, `P`, `S` (summary may contain identifying detail), `B`, `B`, `B` |
| `visibility` | `B` |
| `on_chain_assertion_id` | `P` (publicly anchored) |

**Row-class rollup**: `S` (because of free-text summary/context).

### 4.17 `activity_log_entries`

| Column | Class |
|---|---|
| `kind`, `performed_at`, `duration_min`, `geo`, `witnesses`, `payload`, `evidence_uri` | `N`, `B`, `A`, `S` (precise geo), `S` (witnesses = third-party names), `S`, `P` |

**Row-class rollup**: `S` (geo + witnesses).
**Special note**: precise geo coordinates are PII-Strong under GDPR Art 4(1) and CCPA "precise geolocation." Use predicate-proofs via geo-MCP for low-fidelity disclosure (cell-level, not point-level).

### 4.18 `work_items`

| Column | Class |
|---|---|
| `entitlement_id`, `title`, `description`, `due_at`, `status` | `P`, `S`, `S`, `B`, `B` |

**Row-class rollup**: `S`.

### 4.19 `proposal_submissions`

| Column | Class |
|---|---|
| `round_id`, `fund_mandate_id`, `based_on_intent_id` | `P`, `P`, `P` |
| `budget`, `plan`, `milestones`, `desired_outcomes`, `reporting_obligations`, `organisational_background` | `S` (mixed; may contain names, financial details) |
| `submitted_at`, `version`, `last_edited_at`, `status`, `withdrawn_at`, `cloned_from_proposal_id`, `basis`, `visibility` | `B`, `A`, `B`, `B`, `B`, `P`, `B`, `B` |

**Row-class rollup**: `S`.
**SHACL note**: `proposal_submissions.visibility` is constrained to `'private'` by SHACL shape `sa:GrantProposalAlwaysPrivateShape` — never anchored on chain or mirrored to GraphDB.

### 4.20 `engagement_holder_state`

| Column | Class |
|---|---|
| `entitlement_id`, `capacity_consumed`, `holder_outcome_notes`, `last_activity_id` | `P`, `A`, `S`, `P` |

**Row-class rollup**: `S`.

### 4.21 `token_usage`

| Column | Class |
|---|---|
| `jti`, `principal`, `usage_count`, `usage_limit`, `first_used_at`, `last_used_at` | `P`, `P`, `A`, `A`, `B`, `B` |

**Row-class rollup**: `P`.

## 5. Askar wallet vault (`apps/person-mcp/wallets/<principal>.askar`)

Not relational; encrypted Hyperledger Aries Askar SQLite database. Contents:

| Item | Class | Notes |
|---|---|---|
| Link secret (master) | `S+` | Cryptographic root; compromise = total identity compromise |
| Credential records | `S` | Issued AnonCreds — content varies by credential type |
| Key material (per-DID, per-credential) | `S+` | |
| Credential proofs cache | `B` | |

**Row-class rollup**: `S+` (the highest-impact data in the entire system after `users.privateKey`).
**Encryption-at-rest**: Askar's own encryption (Argon2id + ChaCha20-Poly1305) — the wallet passphrase derives the encryption key. The passphrase is stored as a KMS-wrapped secret per principal in person-MCP config (see `apps/person-mcp/src/ssi/storage/`).
**Backup policy**: nightly EFS snapshot. KMS key for the snapshot encrypts; destruction of the KMS key destroys readable backups (P1 § 5.2.1).

## 6. Org-MCP (`apps/org-mcp/src/db/schema.ts`)

Each row keyed on `org_principal` (the org agent's smart account address).

### 6.1 `org_profiles_private`

| Column | Class |
|---|---|
| `internal_contact_email`, `internal_contact_phone` | `S` |
| `financial_contacts` (JSON) | `S` |
| `internal_notes` | `S` (free text re internal operations / individual employees) |
| `updated_at` | `B` |

**Row-class rollup**: `S`. Contains data about org employees (third-party data subjects) — see § 11.

### 6.2 `detached_members`

People tracked by the org but not yet on chain.

| Column | Class |
|---|---|
| `display_name`, `contact_info_encrypted`, `tracked_since`, `notes`, `role` | `S`, `S` (encrypted), `B`, `S`, `B` |
| `assigned_node_id` | `P` |

**Row-class rollup**: `S`. **Third-party data warning** (§ 11).

### 6.3 `revenue_reports`

| Column | Class |
|---|---|
| `period`, `gross_revenue`, `expenses`, `net_revenue`, `share_payment` | `N`, `S` (financial), `S`, `S`, `S` |
| `currency`, `notes`, `evidence_uri`, `status` | `N`, `S`, `P`, `B` |
| `submitted_by`, `submitted_at`, `verified_by`, `verified_at` | `P`, `B`, `P`, `B` |

**Row-class rollup**: `S`.

### 6.4 `org_activity_log_entries` — analogous to person `activity_log_entries`

Same classifications as § 4.17.

### 6.5 `org_intents`, `org_needs`, `org_offerings`, `org_outcomes` — analogous to person § 4.16

Same classifications.

### 6.6 `org_work_items`, `org_notifications`, `org_beliefs`, `org_cross_delegation_grants` — analogous to person § 4.18, 4.11, 4.12, 4.14

Same classifications.

### 6.7 `disbursements`

| Column | Class |
|---|---|
| `proposal_id`, `round_id`, `tranche_label`, `amount`, `unit`, `recipient_agent_id` | `P`, `P`, `N`, `S` (financial), `N`, `P` |
| `status`, `claimed_at`, `paid_at`, `tx_hash`, `notes` | `B`, `B`, `B`, `P`, `S` |

**Row-class rollup**: `S` (financial).

### 6.8 `outcome_attestations`

| Column | Class |
|---|---|
| `proposal_id`, `milestone_label`, `validator_agent_id`, `status`, `evidence`, `attested_at` | `P`, `N`, `P`, `B`, `S` (free text, may contain names), `B` |

**Row-class rollup**: `S`.

### 6.9 Engagement tables (`engagement_provider_state`, `engagement_sessions`, `engagement_tranches`, `engagement_policies`, `policy_signers`)

| `engagement_sessions.notes` | `S` |
| `engagement_tranches.amount_cents`, `currency`, `gated_on_report_id` | `S`, `N`, `P` |
| `engagement_policies.document_uri`, `version` | `P`, `N` |
| `policy_signers.signer_agent`, `signed_at` | `P`, `B` |

**Row-class rollup**: `S` (financial + free text).

### 6.10 `org_token_usage` — analogous to person § 4.21

Same classifications.

## 7. A2A-agent (`apps/a2a-agent/`)

The A2A agent runs sessions, signs delegations, and maintains a hash-chained audit log. Tables (from `apps/a2a-agent/src/db/` — verify against current schema):

| Table | Highest-class contents | Notes |
|---|---|---|
| `audit_log` | `S` | Tool invocations may reference any principal/agent address + free-text args |
| `sessions` | `S+` | Session keys are signing-capable material; protect like `users.privateKey` |
| `delegations_issued` | `P` | Mirror of on-chain delegations |
| `replay_nonces` | `P` | |
| `checkpoint_hashes` | `A` | Hash-chain external anchor |

**Row-class rollup**: `S+` for `sessions`; `S` elsewhere.
**Special encryption**: session signing material per the KMS migration (`apps/a2a-agent/src/auth/key-provider.ts`) routes through `A2AKeyProvider`. Verify that no raw session keys hit disk; if they must, envelope-encrypt with KMS.

## 8. Geo-MCP

Per project memories, geo-MCP holds private precise geo claims that are predicate-bound to publishable coarse cells.

| Table (representative) | Highest-class | Notes |
|---|---|---|
| `geo_claims_private` | `S` | Precise lat/lng |
| `geo_publications` | `P` | Cell-level coarse claims published on chain |

**Row-class rollup**: `S`. Precise geo is one of the most sensitive `S` items in the system.

## 9. The dev-only `privateKey` column

`apps/web/src/db/schema.ts` declares `users.privateKey` for demo flows (see `/api/demo-login/route.ts:55`). This is the **single highest-impact field in the entire codebase** for dev deployments.

**Required v1 mitigations**:
1. Production builds MUST refuse to seed this column. Enforcement: env-gate (`requireDev()` already gates the route) + CI test asserting `users.privateKey IS NULL` in production database snapshots.
2. The column must be `NULL` for any non-demo user. Schema-level CHECK constraint candidate.
3. The column should be envelope-encrypted with a per-tenant DEK even in dev, to make backups safer.
4. Long-term: remove the column entirely in production by hard-coding the demo seed path to refuse to run.

## 10. GraphDB (`graphdb.agentkg.io`)

By IA P4, GraphDB only mirrors on-chain data. Contents:

| Triple subject | Class | Notes |
|---|---|---|
| Agent address (smart account) | `P` | Pseudonymous identifier |
| `sa:displayName`, `sa:description` of orgs | `S` (org chooses to publish; once published, it's public regardless) | |
| `sa:primaryName` (agent handle) | `S` (user-chosen; should not be legal name per signup discipline) | |
| Trust edges between addresses | `P` + `B` | |
| Public assertions (intent / pledge / proposal where visibility=public) | `S` | Inherits class of source |
| Geo claims (coarse, public) | `P` | |
| Counters and aggregates | `A` | |

**Row-class rollup**: `S` for publish-visible content; `P` for relationship graph.
**No off-chain personal data**: enforced by `apps/web/src/lib/ontology/` — emit functions read only `client.readContract()`, never MCP databases (IA 09-audit § E).

## 11. Third-party data subjects

A persistent challenge: oikos_contacts, coaching_notes, detached_members, and similar rows are about people who may not be Smart Agent users themselves. They are nonetheless data subjects with full GDPR rights.

**Policy** (subject to **[CONSULT COUNSEL]**):

1. **Lawful basis**: Art 6(1)(f) legitimate interest. We balance against the third party's expectations: a user's private record of who they pray for is a low-risk personal note, comparable to a Christian's prayer journal in a paper notebook.

2. **Disclosure obligation (Art 14)**: where personal data is obtained from a source other than the data subject, the controller must inform the data subject within one month of obtaining the data UNLESS:
   - Providing the information proves impossible or would involve disproportionate effort (Art 14(5)(b)).
   - Disclosure would compromise the rights of others.

   For oikos contacts, individual notification would be impossible at scale and would itself harm the data subject's relationship with their oikos. We argue Art 14(5)(b) applies. **[CONSULT COUNSEL]**

3. **Data subject rights**: a third party who learns we have data about them can exercise:
   - **Article 15 (access)** — we provide it via the same DSAR flow (P6), keyed on whatever identifier they can give us (their name, email if used).
   - **Article 16 (rectification)** — we correct via the recording user (the only one with edit access).
   - **Article 17 (erasure)** — we delete the row, with notice to the recording user.
   - **Article 21 (objection)** — we delete or otherwise cease processing.

4. **Implementation gap**: we do not currently have a self-serve flow for non-users to file requests. **Build target**: `apps/web/src/app/api/third-party-request/route.ts` — anonymous form + manual verification.

## 12. Class summary by service

| Service | `S+` | `S` | `P` | `B` | `A` | `N` |
|---|---|---|---|---|---|---|
| Web Postgres | 1 (privateKey, dev) | several | many | several | few | several |
| Person-MCP SQLite | 0 | many | many | many | few | few |
| Person-MCP Askar | many | many | several | few | 0 | 0 |
| Org-MCP SQLite | 0 | many | many | several | few | several |
| Geo-MCP SQLite | 0 | several | several | 0 | 0 | 0 |
| A2A-agent SQLite | several (sessions) | many | many | few | several | few |
| GraphDB | 0 | several (when published) | many | several | many | many |

## 13. Envelope encryption requirements

For columns marked **"Per-tenant DEK"** in §§ 3–9, the encryption recipe:

1. Customer tenant has a KMS master key (CMK) in their region.
2. Per principal (user / org), Smart Agent generates a Data Encryption Key (DEK) wrapped by the CMK.
3. Sensitive columns are encrypted with the DEK before write; ciphertext stored alongside a key reference.
4. On read, the wrapped DEK is unwrapped via the CMK, then used to decrypt.
5. On erasure (Tier 1), the wrapped DEK is destroyed; ciphertext becomes irrecoverable.

**Performance**: per-row decrypt adds ~1-2 ms latency on AWS KMS (with KMS data-key caching). For hot reads, cache unwrapped DEKs in memory with a 5-minute TTL.

**Build status**: per-tenant DEK envelope is **not yet implemented** for the `S` columns in person-MCP. Currently those columns sit in plaintext SQLite on encrypted-at-rest EFS — single-layer encryption. **Gap**: build per-tenant envelope encryption as part of Phase F.3 (post-Postgres migration).

## 14. Audit and access logging

Every read of a column class `S`, `S+`, or Art 9 special category MUST be logged. Implementation:

- Person-MCP: tool-level audit log (`ssi_proof_audit` for credential operations); column-level access log not yet present — **build target**.
- Org-MCP: tool-level audit log; column-level access log not yet present — **build target**.
- Web Postgres: RDS audit logging enabled for the `users` table.

## 15. Open items

| ID | Item | Owner |
|---|---|---|
| C1 | Per-tenant DEK envelope encryption for S-class columns | Developer |
| C2 | Column-level access log in MCPs | Security |
| C3 | Production refusal to seed `users.privateKey` | Infra |
| C4 | Third-party data request form (Art 14/15 path) | Developer + UX |
| C5 | Art 9 special-category gate on profile signup form (P12) | UX |
| C6 | Quarterly classification audit (P8) | Security |

## 16. Residual risk

1. **Single-tenant MCP host**: v1 person-MCP and org-MCP share a host across tenants; row-level isolation via `principal` column is software-enforced. A SQL-injection bug, an off-by-one, or a logical error could leak across tenants. Mitigation: parameterized queries (verified by SCA), per-tenant test coverage. **Future**: per-tenant container isolation.

2. **Third-party data exposure on user export**: if a user exports their oikos contacts, that export contains other people's names. Under Art 15 the user is entitled to this, but disclosure to the user *of* the user's *records about other people* could be argued to be onward disclosure of those other people's PII. Mitigation: include disclaimer in export bundle; **[CONSULT COUNSEL]**.

3. **Free-text columns**: `notes`, `bio`, `description` fields cannot be auto-classified — users may write anything, including third-party PII, regulated content (medical, financial), or special-category data. We rely on the user; we do not scan free text for PII at write time (which would itself be invasive). Mitigation: surface a write-time tooltip warning users about sensitive content.

4. **Inferential PII**: `training_progress` is `B` per the cell-level classification, but in combination it reveals a religious-context spiritual journey. We treat the row as Art 9 special category in retention but not in encryption — a sophisticated adversary with read access to person-MCP could infer Art 9 status from `B` columns. Mitigation: limit access to person-MCP at the host level; per-tenant DEK on the AnonCreds vault.

## 17. Change log

| Date | Author | Change |
|---|---|---|
| 2026-05-18 | Security agent | Initial draft. |

---

**End of P3.**
