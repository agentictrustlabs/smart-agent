# P8 — Data Minimization Audit

> **Document status: DRAFT.**
> **Last updated: 2026-05-18.**

## 0. Executive summary

GDPR Art 5(1)(c) ("data minimisation") requires that personal data be "adequate, relevant and limited to what is necessary in relation to the purposes for which they are processed." Compliance is not a one-time audit — it is a cadence.

This document defines:
1. **The audit method** — how to trace each persisted field to its read sites and decide whether it earns its place.
2. **The initial punch list** — fields we suspect violate minimization, to be confirmed in the first audit run.
3. **The quarterly cadence** — when audits run, who signs off, how findings are tracked.

## 1. The audit method (per-field walk)

For each column in every schema (per P3), the auditor produces a row in the **field justification register**:

| Field | Where | Use sites (code path) | Used for what purpose | Decision |
|---|---|---|---|---|
| `profiles.gender` | person-MCP | (search for read sites) | Display in profile UI; gender-specific recommendations | Keep / Drop / Make optional |

**Use-site discovery procedure**:
1. **Static grep**: search the codebase for the column name (`grep -r "\.gender" apps/ packages/`).
2. **Type-anchored search**: for typed reads (`profile.gender`), use TypeScript LSP "find references."
3. **SQL inspection**: search for SELECT projections that include the column.
4. **Cross-MCP**: search org-MCP, web, A2A for any cross-service reads.
5. **GraphDB**: confirm no SPARQL CONSTRUCT or SELECT emits the column to GraphDB (should be zero per IA P4).

**Decision tree**:

| Outcome of walk | Decision |
|---|---|
| No read sites at all | **Drop** — field is dead weight |
| Reads exist but for a now-deprecated feature | **Drop** with feature removal |
| Reads exist for a feature, but the feature could use a coarser representation | **Reduce granularity** (e.g., precise lat/lng → cell, full DOB → year-only or predicate) |
| Reads exist for a feature, all users use the feature | **Keep** |
| Reads exist for a feature, only some users use the feature | **Make optional** — collect only when the user opts in |
| Reads exist but the data subject's expectation does not align (e.g., we use it for ranking but the user didn't know) | **Disclose better** + Keep / Drop based on disclosure |

## 2. Initial punch list (PLACEHOLDER — needs real code walk)

The following is a **hypothesis** list — fields we suspect may not earn their place. **The first audit run must walk each item.**

| Field | Hypothesis | Counterargument |
|---|---|---|
| `profiles.gender` | Used only in display; user could express in `bio` if they want it shown | Some features may use it for filtering / matching |
| `profiles.date_of_birth` (full date) | Most uses are age-bracket checks; could use AnonCreds predicate proof | Birthday notifications, anniversaries |
| `profiles.phone` | Used for SMS notifications; if user disables SMS, drop | Recovery flow |
| `profiles.address_*` (full address) | Used for "find a nearby church / org"; could use cell / postal-code prefix | Direct mailing (paper) — unused in v1 |
| `oikos_contacts.last_contact_at` | Used for "stale relationship" surfacing; could be derived from activity log | Direct UI display |
| `activity_log_entries.geo` (precise) | Used for activity-location display; could use cell | Verification / fraud-prevention |
| `activity_log_entries.witnesses` (free text names) | Used for verification "X attested to Y's activity"; could be agent-address references | Free text allows non-agent witnesses |
| `ssi_proof_audit.revealed_attrs` | Audit trail for compliance; necessary | — |
| `chat_messages.content` (long-term storage) | Used for chat-history view; older messages rarely accessed | Conversation continuity over months |
| `notifications.payload` (free text) | Used for inbox display; sometimes contains other users' names | Read once and dismissed; could be truncated after 30 days |
| `revenue_reports.notes` (free text) | Used during dispute resolution; rarely | — |
| `users.privateKey` (dev only) | Dev-only; production refuses to seed | Must be enforced (P3 § 9) |
| `external_identities.metadata` (full OAuth payload) | Used at sign-in only; full payload is overkill | Reduce to required fields (subject, email) |
| `engagement_sessions.notes` | Used in session-detail UI | — |

**Outcome of first audit (TODO after walk)**: each row resolves to a Decision.

## 3. Audit cadence

| Cadence | Activity |
|---|---|
| **Quarterly** | Full per-field walk. Security agent produces the register. IA agent reviews. PRs land for Drop / Make-optional decisions. |
| **At schema change** | When a new column is added in any MCP / web schema, the IA agent reviews the justification at PR time (gate: a `data-minimization-rationale` field in the schema migration PR description). |
| **At feature deprecation** | When a feature is removed, an audit task is auto-created to identify orphaned columns. |
| **At incident** | A breach (P11) or near-miss triggers an ad-hoc audit of the affected fields. |

## 4. Audit register format

Stored at `docs/security/privacy-and-compliance/audit-runs/<YYYY-QN>.md`:

```markdown
# Q3 2026 Data Minimization Audit

Auditor: <name>
Date range: 2026-07-01 to 2026-09-30
Review sign-off: Security <name>, IA <name>

## Register

| Field | Use sites | Decision | PR |
|---|---|---|---|
| profiles.gender | apps/web/src/app/profile/page.tsx (display only); apps/person-mcp/src/tools/profile.ts (CRUD) | Make optional | #1234 |
| ... | ... | ... | ... |

## Summary
- Fields kept: N
- Fields dropped: M
- Fields made optional: K
- Granularity reduced: L

## Net effect
- Estimated storage reduction: X%
- Estimated PII surface reduction: described qualitatively
```

## 5. Enforcement gates

### 5.1 PR-level gate

A new database column requires:
1. **Rationale paragraph** in the PR description.
2. **Classification** per P3 (Strong / Pseudonymous / Behavior / Aggregate / Non-PII).
3. **Retention class** per P4.
4. **Optional-by-default toggle** if the field is `S` or carries Art 9 risk.
5. **IA agent approval** on the PR.

### 5.2 CI-level gate

We add a CI check `scripts/check-schema-rationale.sh` that:
- Parses schema migration files.
- For each new column, requires a comment annotation `@minimization: <decision-id>` linking to an audit register entry.
- Fails if missing.

### 5.3 Runtime metric

A metric `field_writes_total{schema, table, column}` from each MCP — over time, an unused column shows zero writes and surfaces in the audit.

## 6. Special-category gate

Any column that could carry Art 9 special-category data (religion, health, sex life, political opinion, racial/ethnic) requires additional sign-off from the DPO (P12).

For Smart Agent, the candidates are:
- `profiles.gender` (potentially Art 9 if interpreted as sex life / sexual orientation).
- `user_preferences.home_church` (religious belief).
- `prayers.*` (religious belief).
- `beliefs.*` (philosophical / religious belief).
- `coaching_notes.*` (religious belief by context).

These get explicit P12 review beyond the standard audit.

## 7. Minimization in code (build-target patterns)

Beyond storage, minimization extends to:

### 7.1 Query projection

When reading from a table, project only the columns needed for the immediate operation. Avoid `SELECT *`.

**Lint rule (build target)**: `apps/web/src/lib/lint/no-select-star.ts` — flag any `db.select().from(table)` without `.columns({...})`.

### 7.2 Logging

Logs should never contain `S`-class fields. Per IA 09-privacy-audit § D.

**Lint rule (build target)**: `apps/web/src/lib/lint/no-pii-in-logs.ts`.

### 7.3 Tool returns

MCP tools should return only the fields the caller needs. We add per-tool **return schemas** (in `inputSchema` / `outputSchema`) and a lint rule that returns extra fields fail tests.

### 7.4 API responses

Same principle — APIs return DTOs scoped to the caller's permission, not raw rows.

## 8. Reporting

Per audit run, we produce:
- **Internal report** (the register, § 4).
- **Board summary** (1-page roll-up: items dropped, items made optional, granularity reductions).
- **External-facing transparency line** in the privacy notice: "We perform a quarterly data-minimization audit, last performed: YYYY-MM. See our policy at ..."

## 9. Open items

| ID | Item | Owner |
|---|---|---|
| DM1 | Run the first full audit (covers § 2 punch list + every other column) | Security + IA |
| DM2 | Build the PR-level rationale template | Documentarian |
| DM3 | Build CI schema-rationale check | Developer + Infra |
| DM4 | Build no-select-star lint | Developer |
| DM5 | Build no-pii-in-logs lint | Developer |
| DM6 | Build `field_writes_total` metric in MCP tools | Developer |

## 10. Residual risk

1. **Audit incompleteness**: a quarterly cadence is fast for a moving codebase but slow enough that 3 months of drift can accumulate. Mitigation: PR-level rationale gate (§ 5.1) catches new fields at write time; quarterly is for evolving-use-cases.

2. **False positives**: a field that looks unused via grep may be used via a code path the auditor missed. Mitigation: cross-check static analysis with runtime metrics (§ 5.3); err on Keep when uncertain and re-audit next quarter.

3. **User-perceived minimization mismatch**: a user may consider a "kept" field unnecessary even though we have a justified use case. Mitigation: P5 consent UX surfaces what we collect and why; user can opt out where the field is optional.

4. **Punch-list staleness**: § 2 is a hypothesis-list; the actual punch list may diverge significantly after the first walk. Mitigation: replace § 2 with audit results after first run.

5. **Free-text inference**: `notes`, `bio`, `description` columns can be over-collected by the user themselves. We can advise (UI tooltip) but cannot enforce.

## 11. Change log

| Date | Author | Change |
|---|---|---|
| 2026-05-18 | Security agent | Initial draft with hypothesis punch list (§ 2). |

---

**End of P8.**
