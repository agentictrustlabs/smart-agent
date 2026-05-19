# Audit and Forensics Plans — A1..A6

> **Audience**: security lead, on-call SRE, board sub-committee, regulator
> intake. Use as the operational + forensic project plan that sits on top
> of Smart Agent's append-only audit chain (`apps/a2a-agent/src/lib/audit.ts`
> + `apps/person-mcp/src/lib/audit-checkpoint.ts`).
>
> Every document here is grounded in real code (cited with `file:line`),
> real vendors (cited with current URLs as of 2026-05-18), and concrete
> dollar figures. Numbers are best-effort — refresh during procurement.

## What lives here

Audit + Forensics is what we say to a regulator, an enterprise customer's
infosec team, or a court that has demanded evidence. The audit chain is
the *primitive*. These docs cover everything that turns the primitive
into a defensible operational programme:

| Doc | Topic | Approx scope | Pre-req |
|---|---|---|---|
| **A1** | External audit anchor | Make the chain tip survive a DB-admin attacker | Sprint 3 S3.1 (✅ landed) |
| **A2** | Log retention policy | What we keep, where, how long, who pays | A1 sink wired |
| **A3** | SIEM integration | Where alerts fire from, who gets paged | A2 retention tiers chosen |
| **A4** | Anomaly detection | Statistical baselines + auto-response | A3 ingestion live |
| **A5** | User-action provenance chain | Trace a click → tx → audit row end-to-end | Correlation id (✅ Phase 1D landed) |
| **A6** | Incident response runbooks | 8 scenario playbooks + tabletop cadence | A1..A5 to feed evidence |

## Reading order

For an engineering manager building the project plan:

1. **A1** — what we need to bolt on to the existing audit chain to give it
   evidentiary value outside our own database.
2. **A2** — the legal + cost picture once A1 makes long-term retention a
   real requirement.
3. **A5** — the trace-id thread that links UI clicks to on-chain
   settlement; needed before A3 + A4 can present a coherent story.
4. **A3** — SIEM vendor choice + ingest plan; depends on A2 retention
   tiers being set.
5. **A4** — detector list + thresholds; runs on top of A3's ingestion.
6. **A6** — runbooks consume the evidence A1..A5 produce.

For a security lead:

1. **A6** sections on Key Compromise + Data Breach + Smart Contract Bug —
   these are the highest-stakes scenarios.
2. **A1** — the cryptographic + economic argument for tip anchoring.
3. **A4** — detection rules; this is where the team's threat model meets
   detection engineering.
4. **A3** + **A2** + **A5** as supporting context.

For a regulator / customer infosec questionnaire:

- Cite **A2** for retention timelines.
- Cite **A1** for tamper-evidence claims.
- Cite **A5** for "given a transaction, can you produce the click that
  authorised it?"
- Cite **A6** for incident response posture.

## Status snapshot (as of 2026-05-18)

| Doc | Status | Owner | Next gate |
|---|---|---|---|
| A1 | Draft, ready for infra impl | infra + security | Land `audit-anchor.ts` + S3 Object Lock bucket |
| A2 | Draft | security + legal | Confirm 7-year financial-transaction class with counsel |
| A3 | Draft | infra | Datadog Security trial activation |
| A4 | Draft | security + data | Choose Watchdog vs. custom; tune false-positive budget |
| A5 | Draft | developer + security | Bind traceId into on-chain event topic |
| A6 | Draft | incident commander (TBD) | Tabletop schedule + on-call rotation activation |

## What is intentionally **not** here

- KMS rotation + outage runbooks — `docs/security/key-management/K1..K6`.
- Smart-contract audit procurement — `docs/security/smart-contracts/SC1`.
- Cryptographic threat model — `docs/security/cryptographic-posture/C1`.
- Sub-processor data-flow privacy notices — `docs/security/external-dependencies/ED5`
  (this directory) handles inventory; user-facing notice lives in product
  docs.

## Glossary

| Term | Meaning |
|---|---|
| **audit chain** | The `execution_audit` table — append-only, hash-chained, signed by master signer (Sprint 3 S3.1). |
| **checkpoint** | A signed snapshot of the chain head emitted on a cadence (`audit-checkpoint.ts`). |
| **sink** | The external HTTP/S3 destination a checkpoint is POSTed to. |
| **anchor** | A stronger sink that an attacker cannot mutate after the fact — S3 Object Lock + a public-chain transaction. |
| **traceId** | W3C `traceparent`-derived correlation id, set at the web edge and propagated to every downstream hop. Synonym in the codebase: `correlationId` (`X-SA-Correlation-Id` header). |
| **provenance chain** | The end-to-end record linking a UI click to its on-chain settlement, surfaced via A5's lookup interface. |
| **incident commander** | Designated lead on a security incident; rotates on-call weekly. |
| **tabletop** | Pen-and-paper rehearsal of a runbook with no live infrastructure changes. |

## Conventions

- `[OWE-REVIEWER]` — a fix the engineering team owes the auditor / reviewer.
- `[DECISION]` — a vendor / dollar / calendar commitment.
- `[OPEN]` — an open question that blocks `[DECISION]`.
- `[COST]` — recurring or one-time spend with a rough range.

Search any tag to surface the action / commitment list in one pass.

---

*Last updated: 2026-05-18. Owner: Security agent. Reviewers pending.*
