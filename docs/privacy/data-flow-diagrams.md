# Smart Agent — Data Flow Diagrams

> **Document status: DRAFT.**
> **Companion to:** `docs/privacy/anoncreds-custodial-model.md`,
> `docs/security/privacy-and-compliance/P3-pii-classification-per-service.md`.
> **Last updated: 2026-05-18.**

This document visualises the data flow across Smart Agent service
boundaries with the PII classification (per P3) annotated at each
hop, plus the encryption posture in transit and at rest.

The legend uses the P3 five-tier scheme:

- `S` = Strong PII (direct identifier)
- `P` = Pseudonymous (re-identifiable with auxiliary information)
- `B` = Behavior (inferentially sensitive)
- `A` = Aggregate
- `N` = Non-PII

## 1. Authentication: passkey sign-in

```
[ User device ]                  [ Web app (apps/web) ]              [ A2A agent (apps/a2a-agent) ]
       |                                  |                                       |
       |--- passkey assertion ----------->|                                       |
       |    {credentialId, signature,     |                                       |
       |     authenticatorData}           |                                       |
       |    Class: S (credentialId is     |                                       |
       |    a strong identifier)          |                                       |
       |    Transit: TLS 1.3              |                                       |
       |                                  |                                       |
       |                                  |--- verify via on-chain ERC-1271 ---->|
       |                                  |    (no PII transmitted)              |
       |                                  |                                       |
       |                                  |<-- session JWT issuance --------------|
       |                                  |    Class: P (DID + smart account)   |
       |                                  |    Stored client-side only           |
       |                                  |                                       |
       |<-- session cookie ---------------|                                       |
       |    Class: P                      |                                       |
       |    HttpOnly, SameSite=Strict     |                                       |
       |    TLS-only                      |                                       |
```

**At-rest data created at this hop:**
- Web Postgres: **no rows** for passkey users (sessionless flow per
  `project_sessionless_passkey_siwe.md`).
- A2A SQLite `sessions`: row with `encryptedPackage` + AES-GCM AAD
  bound to `(sessionId, accountAddress, chainId, expiresAt,
  keyVersion)`. Data key is wrapped by KMS envelope key.
- Person-MCP: no new rows.

## 2. Profile read

```
[ User device ]      [ Web ]              [ A2A ]                [ Person-MCP ]
      |                |                    |                          |
      |---  GET ------>|                    |                          |
      |  profile       |                    |                          |
      |                |--- A2A action ---->|                          |
      |                |   {actionId,        |                          |
      |                |    sessionId}       |                          |
      |                |   Class: P          |                          |
      |                |   TLS + MAC (KMS    |                          |
      |                |   web-to-a2a key)   |                          |
      |                |                    |                          |
      |                |                    |--- MCP tool call ------->|
      |                |                    |   person:get_profile     |
      |                |                    |   {principal, delegation}|
      |                |                    |   Class: P + B           |
      |                |                    |   TLS + MAC (KMS         |
      |                |                    |   a2a-to-person key)     |
      |                |                    |                          |
      |                |                    |<-- profile JSON ---------|
      |                |                    |   Class: S (name, email, |
      |                |                    |   address, phone, DOB)   |
      |                |                    |   Some columns wrapped   |
      |                |                    |   under per-tenant DEK,  |
      |                |                    |   unwrapped in person-mcp|
      |                |                    |   process memory only    |
      |                |                    |                          |
      |                |<-- profile JSON ---|                          |
      |                |   Class: S         |                          |
      |                |   TLS              |                          |
      |                |                    |                          |
      |<-- HTML render-|                    |                          |
      |   Class: S     |                    |                          |
      |   TLS          |                    |                          |
```

**At-rest data accessed:**
- Person-MCP `profiles` row, decrypted via per-tenant DEK in process.

**Audit trail produced:**
- A2A audit row (`audit.db`): tool invocation, principal,
  delegation hash, timestamp. Class P + B.
- Person-MCP `activity_log_entries`: action recorded. Class B.
- KMS CloudTrail: `Decrypt` event for the per-tenant DEK unwrap;
  `GenerateMac`/`VerifyMac` events for the inter-service MAC.

## 3. AnonCreds presentation (custodial path)

```
[ User device ]   [ Web ]    [ A2A ]    [ Person-MCP ]    [ Verifier-MCP ]   [ Verifier site ]
      |              |          |             |                 |                   |
      |--- request -->|          |             |                 |                   |
      |  "verify age >=18 to    |             |                 |                   |
      |   join Council pool"    |             |                 |                   |
      |              |          |             |                 |                   |
      |              |  ----- A2A action ---->|                 |                   |
      |              |     {actionId, intent: |                 |                   |
      |              |      "present-age"}    |                 |                   |
      |              |     Class: B           |                 |                   |
      |              |                        |                 |                   |
      |              |                        |--- challenge -->|                   |
      |              |                        |   from verifier:                    |
      |              |                        |   "prove age>=18"                   |
      |              |                        |   Class: N                          |
      |              |                        |                 |                   |
      |              |                        |--- person:    ->|                   |
      |              |                        |   present_proof | (built by person- |
      |              |                        |   {challenge,    |  mcp using user's|
      |              |                        |    delegation}   |  link secret +   |
      |              |                        |                  |  credential)     |
      |              |                        |                 |                   |
      |              |                        |<-- proof object --                  |
      |              |                        |   Class: S (revealed attrs may      |
      |              |                        |   include DOB partial; predicates   |
      |              |                        |   reveal age >= 18)                 |
      |              |                        |                 |                   |
      |              |                        |--- submit proof ----------->        |
      |              |                        |   Class: S (revealed attrs) -->     |
      |              |                        |                 |                   |
      |              |                        |                 |--- verify ------->|
      |              |                        |                 |                   |
      |              |                        |                 |<-- ok ------------|
      |              |                        |<-- ok ----------|                   |
      |              |<-- joined --|          |                 |                   |
      |<-- joined ----|             |          |                 |                   |
```

**At-rest data updated:**
- Person-MCP `ssi_proof_audit`: full record with revealed attrs.
  Class S. Wrapped under per-tenant DEK.
- Person-MCP `pairwise_handle`: per-verifier pseudonym to maintain
  AnonCreds anti-correlation FROM THE VERIFIER. Class P.
- Verifier-MCP: verifier-side audit of the proof verification.
  Class S (revealed attrs in archive — same caveats).

**Custodial visibility:** Person-MCP sees the link secret AND the
proof contents at construction time. Verifier-MCP sees the proof
output. The two MCPs do not share state by design; cross-correlation
requires Smart Agent operator action.

**[CONSULT COUNSEL]** — this is the "reduced unlinkability"
clause from the custodial-model doc § 4.

## 4. Delegation issuance (on-chain variant)

```
[ User device ]    [ Web ]              [ A2A ]            [ Person-MCP ]      [ EVM chain ]
      |               |                   |                      |                   |
      |--- "Authorize Coach to read       |                      |                   |
      |     coaching notes" ------------->|                      |                   |
      |     (after P5 consent UX) -------->                      |                   |
      |                                   |                      |                   |
      |                                   |--- build delegation--|                   |
      |                                   |   (EIP-712 typed     |                   |
      |                                   |    data) ----------->|                   |
      |                                   |                      |                   |
      |                                   |<-- delegation hash --|                   |
      |                                   |                      |                   |
      |<-- "Sign this with passkey" ------|                      |                   |
      |                                   |                      |                   |
      |--- passkey signature ------------>|                      |                   |
      |   over EIP-712 digest             |                      |                   |
      |   Class: P                        |                      |                   |
      |                                   |                      |                   |
      |                                   |--- DelegationManager.acceptDelegation -->|
      |                                   |   {delegation, sig}                       |
      |                                   |   Class: P + N (public on chain)         |
      |                                   |                                          |
      |                                   |<-- event log ----------------------------|
      |                                   |   DelegationIssued                       |
      |                                   |                                          |
      |                                   |--- store off-chain body --->|             |
      |                                   |   in cross_delegation_grants            |
      |                                   |   Class: P + B                          |
      |<-- "Done" ------------------------|                      |                   |
```

**At-rest data created:**
- Person-MCP `cross_delegation_grants`: row with delegation body,
  caveats, target. Class P + B.
- EVM contract storage (`DelegationManager`): immutable record of
  the delegation. Class P (the addresses are pseudonymous; legal
  treatment per P1).
- GraphDB: mirrors the on-chain record on the next sync cycle.

**Disclosure surface:** the delegation is PUBLIC on the EVM ledger.
The user must have been shown the on-chain disclosure (P5 § 3.8
Variant B) before signing.

## 5. Pledge / disbursement (financial)

```
[ User ]   [ Web ]   [ A2A ]    [ EVM (PledgeRegistry, USDC) ]   [ Org-MCP ]
   |          |        |                  |                          |
   |--- pledge $X to Pool Y -------------->|                          |
   |          |        |                  |                          |
   |          |--- A2A action ---->        |                          |
   |          |   {pledgeIntent}           |                          |
   |          |   Class: B + financial    |                          |
   |          |                            |                          |
   |          |        |--- build USDC.transfer userOp                |
   |          |        |   + PledgeRegistry.recordPledge              |
   |          |        |                                              |
   |          |        |--- redeem session delegation ----->          |
   |          |        |   via DelegationManager + EntryPoint         |
   |          |        |                  |                           |
   |          |        |                  |--- emit PledgeRecorded -->|
   |          |        |                  |                           |
   |          |        |<-- tx receipt ---|                           |
   |          |        |                                              |
   |          |        |--- notify org-mcp via MCP tool -----------> |
   |          |        |   org:record_pledge_offchain                |
   |          |        |                                              |
   |          |<-- "Pledge recorded" ------|                          |
   |<-- ack --|        |                                              |
```

**At-rest data created:**
- EVM PledgeRegistry: row with `(donor, pool, amount, timestamp)`.
  Class P + financial.
- EVM USDC: ERC-20 balance transferred from donor smart account
  to pool. Class P + financial.
- Org-MCP `disbursements` / `engagement_tranches`: off-chain
  record of the financial event for the pool's internal books.
  Class P + financial.

**Retention floor:** financial records are subject to the
seven-year retention class (SOX / BSA) — see P4 § 3.3 and P1 § 3.3.

## 6. End-to-end PII transit summary

```
Browser ────TLS 1.3────► Vercel edge ────TLS────► Web app (Server Component)
                                                      │
                                                      ▼
                            TLS 1.3 + MAC (KMS HMAC web-to-a2a)
                                                      │
                                                      ▼
                                                A2A agent
                                                      │
                  ┌───────────────────────────────────┼───────────────────────┐
                  │                                   │                       │
                  ▼                                   ▼                       ▼
        TLS + MAC (a2a-to-person)         TLS + MAC (a2a-to-org)     TLS to EVM RPC
                  │                                   │
                  ▼                                   ▼
            Person-MCP                            Org-MCP
                  │                                   │
                  ▼                                   ▼
         SQLite (KMS-wrapped DEK             SQLite (KMS-wrapped
         per-tenant for S columns)           DEK per-tenant)
         + Askar vault (encrypted)
```

**Encryption at rest:**

- SQLite tables: TLE / file-system level encryption (EBS gp3 with
  KMS); high-sensitivity columns ADDITIONALLY wrapped under
  per-tenant DEK so a hot-backup leak does not expose plaintext
  without KMS access.
- Askar vault: per-vault encryption with key derived from per-tenant
  KMS-wrapped seed.
- S3 audit logs: KMS-encrypted with the cloudtrail-encryption KEK
  (separate from operational keys).

**Encryption in transit:**

- Every wire hop: TLS 1.3 minimum (TLS 1.2 fallback for compat with
  older browsers, but server preferences upgrade to 1.3 wherever
  possible).
- Inter-service hops ADDITIONALLY MAC-authenticated using KMS HMAC
  keys (one key per service pair). A TLS break does not
  authenticate a malicious request.

**Key custody:**

- All cryptographic keys live in AWS KMS or GCP Cloud KMS HSMs.
- Runtime federates via Vercel OIDC; no long-lived cloud
  credentials in env vars.
- Per-key IAM grants the runtime principal a narrow action set
  (Sign / GenerateDataKey / Decrypt / GenerateMac / VerifyMac) on
  EXPLICITLY named key ARNs; no wildcards.

## 7. The "no MCP → GraphDB" rule (IA P4)

```
On-chain assertion (e.g., MatchInitiated) ────► EVM event log
                                                      │
                                                      ▼
                                          GraphDB sync (apps/web/src/lib/ontology)
                                                      │
                                                      ▼
                                               GraphDB triplestore
                                            (PUBLIC mirror only)


  Person-MCP private data ─── X ───► GraphDB
                              ▲
                          FORBIDDEN
                          (IA P4 invariant)
```

GraphDB is a public-mirror-only triplestore. It NEVER receives data
from an MCP directly. The on-chain layer is the only path:

1. User initiates an action.
2. A public on-chain assertion is emitted (e.g., `MatchInitiated`).
3. The GraphDB sync cron job reads the event from the EVM log and
   writes the corresponding RDF triples.

This invariant matters for the erasure SOP (P1 § 5.2.6): we delete
private MCP data; GraphDB updates via the next sync after the
on-chain `setActive(addr, false)` and tombstone publication. We
NEVER have to scrub GraphDB rows directly because those rows are
all derivable from on-chain state.

## 8. Audit-trail data flow

```
Every KMS API call ──► AWS CloudTrail / GCP Cloud Audit Logs
                                │
                                ▼
                      Event selector (data events on KMS keys)
                                │
                                ▼
                  CloudWatch Logs (90-day real-time mirror) ───► Metric filters ───► Alarms ───► PagerDuty
                                │
                                ▼
                  S3 audit bucket (7-year WORM, Object-Lock COMPLIANCE)
                  GCS audit bucket (7-year locked retention)
```

**Per K6:**
- Every Sign, Decrypt, GenerateMac, VerifyMac is logged with
  principal, IP, EncryptionContext keys, timestamp.
- Alarms fire on the nine R-KMS rules (AWS) / G-KMS rules (GCP).
- The audit trail itself is encrypted under a SEPARATE KMS key
  (`cloudtrail_encryption`) — compromise of operational keys does
  NOT compromise the audit log.

**Per Phase H IaC:**
- `infra/aws/cloudtrail.tf` provisions the trail.
- `infra/aws/cloudwatch-alarms.tf` provisions the alarms.
- `infra/gcp/audit-logs.tf` provisions the GCP equivalent.

## 9. Cross-references

| Document | Coverage |
|---|---|
| `docs/privacy/anoncreds-custodial-model.md` | Custodial wallet model, plain language |
| `docs/security/privacy-and-compliance/P3-pii-classification-per-service.md` | Per-column classification (the legend used here) |
| `docs/architecture/00-system-map.md` | High-level service topology |
| `docs/architecture/01-web-a2a-mcp-flows.md` | Service interaction flows |
| `docs/architecture/02-auth-session-delegation.md` | Auth + delegation deep-dive |
| `docs/architecture/04-graphdb-knowledge-sync.md` | GraphDB sync architecture |
| `docs/security/key-management/K6-cloudtrail-monitoring-and-alerting.md` | Audit substrate |
| `infra/aws/` + `infra/gcp/` | The IaC that provisions all of the above |
