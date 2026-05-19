# O7 — Runbook Completeness

> **Status**: DRAFT. **Runbooks exist for some flows but not all.** A
> handful live under `docs/operations/` (`kms-signer-setup.md`,
> `kms-signer-localstack.md`, `ci-setup.md`); spec 007 references
> `docs/runbooks/postgres-prod.md` as a new doc. There is no inventory,
> no ownership, no quarterly review, and no CI guard that an alert has
> a linked runbook.
>
> This document specifies the runbook inventory, the alert-to-runbook
> mapping, the gap-tracking process, and the CI guard that prevents
> shipping a new alert without one.
>
> **Effort**: M (1 week to inventory + write missing critical runbooks);
> ongoing (quarterly review + new runbooks as alerts are added).
> **Owner**: Director of Engineering + per-area owner.
> **Depends on**: O6 (defines who consumes runbooks).
> **Unblocks**: meaningful Tier 1 RTO 15 min (O5) — without a runbook,
> the on-call wastes the first 5 min of the budget reading code.

---

## 1. Today's state (honest)

| Runbook | Owner | Status |
|---|---|---|
| `docs/operations/ci-setup.md` | Infra | Exists; current. |
| `docs/operations/kms-signer-setup.md` | Security | Exists; current. |
| `docs/operations/kms-signer-localstack.md` | Infra | Exists; dev-only. |
| `docs/runbooks/postgres-prod.md` | Infra | DOES NOT EXIST (referenced in Spec 007 F.2 §production deployment). |
| Deploy failure | Infra | DOES NOT EXIST (O1 will create). |
| Rollback | Infra | DOES NOT EXIST (O1 will create). |
| Postgres restore | Infra | DOES NOT EXIST (O4 will create). |
| Askar restore | Backend | DOES NOT EXIST (O4 will create). |
| KMS outage | Security | Partial: `docs/security/key-management/K3-break-glass-and-kms-outage.md` is a plan, not an actionable runbook. |
| Audit-sink failure | Security | DOES NOT EXIST. |
| GraphDB outage | Backend | DOES NOT EXIST (DR3 will create). |
| Paymaster underfunded | Infra | DOES NOT EXIST. |
| Rate-limit breach | Backend | DOES NOT EXIST. |
| Contract redeploy | Smart-contracts | DOES NOT EXIST. |
| Mainnet transition | Smart-contracts | DOES NOT EXIST (DR4 will create). |
| Session cookie loss | Frontend | DOES NOT EXIST. |
| User-reported "stuck pledge" | Backend | DOES NOT EXIST. |
| Cross-tenant data leak | Security | DOES NOT EXIST. |

Of ~25 known operationally-relevant scenarios, ~3 have runbooks today.
Of the alerts O5 §7.3 specifies, **0** have linked runbooks today
(because the alerts themselves don't exist yet).

This is the gap O7 closes.

---

## 2. Goals

1. **Every alert that pages a human has a linked runbook.** Enforced
   by CI guard (§5).
2. **Every runbook follows a uniform structure** so on-call doesn't
   waste time decoding format.
3. **Every runbook has a named owner.** Owners are responsible for
   keeping the runbook accurate.
4. **Quarterly review.** Every runbook is reviewed at least once per
   quarter; stale runbooks are flagged.
5. **Gap tracking is visible.** Missing runbooks are GitHub issues
   labeled `missing-runbook`; the count is visible on a dashboard.

---

## 3. Runbook structure

Every runbook MUST follow this structure. Templated at
`docs/runbooks/_template.md`:

```markdown
# <Runbook Title>

> **Owner**: <person or team>
> **Last reviewed**: YYYY-MM-DD
> **Sev**: 1 | 2 | 3
> **Alert(s)**: <list of monitor names that route here>

## Symptom
What the alert says. What the user sees. Direct quote of the alert
payload where possible.

## Diagnose
The first 3 commands or queries to run. ≤5 min budget.

```bash
# Example
kubectl get pods -n smart-agent | grep a2a-agent
kubectl logs -n smart-agent <pod> --tail=200
curl -fsS https://api.smart-agent.io/ready | jq .
```

## Mitigate
The fastest known mitigation. May not be the root-cause fix. ≤5 min
budget.

## Resolve
Root-cause investigation + permanent fix. May exceed RTO budget; once
mitigated the incident is no longer Sev-1.

## Verify
How to confirm the alert won't re-fire. Concrete checks.

## Escalate
When to bring in secondary / DoE / vendor support.

## Postmortem trigger
Was this Sev-1 OR did it consume >25% of an error budget? If so,
postmortem required.

## Related
- Other runbooks
- Architecture docs
- Past postmortems
```

### 3.1 Why this structure

- **Symptom first** because the on-call already saw the alert; they
  need to confirm they're in the right runbook.
- **Diagnose before Mitigate** because the wrong mitigation in the
  wrong situation makes things worse.
- **Mitigate before Resolve** because the budget is "stop the
  bleeding" not "fully fix it."
- **Verify** because flapping alerts are worse than no alerts.
- **Escalate** because the on-call should never wonder "is it time to
  wake the DoE?"

---

## 4. Runbook inventory

The full set, organised by the alert / scenario they support.

### 4.1 Tier 1 alerts (must page)

| Alert | Runbook | Owner | Status |
|---|---|---|---|
| Tier 1 availability <99.9% | `docs/runbooks/tier-1-availability.md` | DoE | TODO |
| Tier 1 p99 latency 2× target | `docs/runbooks/tier-1-latency-regression.md` | Backend | TODO |
| Tier 1 synthetic failure | `docs/runbooks/synthetic-failure.md` | Backend | TODO |
| Postgres failover | `docs/runbooks/postgres-failover.md` | Infra | TODO |
| KMS quota >80% | `docs/runbooks/kms-quota.md` | Security | TODO |
| Audit-sink unreachable >5 min | `docs/runbooks/audit-sink-down.md` | Security | TODO |
| RPO drift Tier 1 >2 min | `docs/runbooks/rpo-drift.md` | Infra | TODO |
| Backup failed twice | `docs/runbooks/backup-failed.md` | Infra | TODO |
| DR2 restore-verify failed | `docs/runbooks/dr2-restore-failure.md` | Infra | TODO |
| Paymaster underfunded | `docs/runbooks/paymaster-deposit.md` | Infra | TODO |
| Auto-rollback fired | `docs/runbooks/auto-rollback.md` | Infra | TODO |

### 4.2 Tier 2 alerts (page during business hours)

| Alert | Runbook | Owner | Status |
|---|---|---|---|
| Tier 2 service down | `docs/runbooks/tier-2-service-down.md` | Backend | TODO |
| GraphDB outage | `docs/runbooks/graphdb-outage.md` | Backend | TODO |
| KMS quota 50-80% | `docs/runbooks/kms-quota.md` (shared) | Security | TODO |
| RPO drift Tier 2 >30 min | `docs/runbooks/rpo-drift.md` (shared) | Infra | TODO |
| Single backup failure | `docs/runbooks/backup-failed.md` (shared) | Infra | TODO |
| CodeQL HIGH on master | `docs/runbooks/codeql-finding.md` | Security | TODO |

### 4.3 Operational procedures (non-alerting)

| Procedure | Runbook | Owner | Status |
|---|---|---|---|
| Production deploy | `docs/runbooks/deploy.md` | Infra | TODO (O1) |
| Rollback | `docs/runbooks/rollback.md` | Infra | TODO (O1) |
| Postgres restore | `docs/runbooks/restore-postgres.md` | Infra | TODO (O4) |
| Askar restore | `docs/runbooks/restore-askar.md` | Backend | TODO (O4) |
| Full disaster restore | `docs/runbooks/restore-from-disaster.md` | DoE | TODO (O4) |
| KMS key rotation | (exists, K1) | Security | DONE |
| Contract redeploy | `docs/runbooks/contract-redeploy.md` | Smart-contracts | TODO |
| Mainnet transition | `docs/runbooks/mainnet-transition.md` | DoE | TODO (DR4) |
| On-call handoff | `docs/runbooks/oncall-handoff.md` | DoE | TODO (O6) |
| Incident war room | `docs/runbooks/incident-war-room.md` | DoE | TODO (O6) |
| DR drill Q1 (Postgres failover) | `docs/runbooks/dr-drill-q1-postgres-failover.md` | Infra | TODO (O5) |
| DR drill Q2 (KMS regional outage) | `docs/runbooks/dr-drill-q2-kms-regional-outage.md` | Security | TODO (O5) |
| DR drill Q3 (bad deploy) | `docs/runbooks/dr-drill-q3-bad-deploy.md` | Infra | TODO (O5) |
| DR drill Q4 (full restore) | `docs/runbooks/dr-drill-q4-full-restore.md` | DoE | TODO (O5) |

### 4.4 Incident-class scenarios

| Scenario | Runbook | Owner | Status |
|---|---|---|---|
| User-reported stuck pledge | `docs/runbooks/stuck-pledge.md` | Backend | TODO |
| User-reported session loss | `docs/runbooks/session-loss.md` | Backend | TODO |
| Cross-tenant data leak suspected | `docs/runbooks/cross-tenant-leak.md` | Security | TODO |
| Key compromise suspected | `docs/runbooks/key-compromise.md` | Security | TODO |
| Bad on-chain assertion | `docs/runbooks/bad-onchain-assertion.md` | Smart-contracts | TODO |
| GraphDB out-of-sync | `docs/runbooks/graphdb-sync-drift.md` | Backend | TODO |

**Total runbooks**: ~30. Of those, ~3 exist; ~27 are gaps.

---

## 5. CI guard: alert-has-runbook

`scripts/check-alert-has-runbook.ts` (new). Wired into `pnpm check:all`.

```typescript
// scripts/check-alert-has-runbook.ts
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'

const monitorsDir = 'infra/datadog/monitors'
const runbookDir = 'docs/runbooks'

const missing: string[] = []

for (const file of readdirSync(monitorsDir)) {
  if (!file.endsWith('.yaml')) continue
  const monitor = parseYaml(readFileSync(join(monitorsDir, file), 'utf8'))
  const runbookRef = monitor.options?.notifications?.runbook
  if (!runbookRef) {
    missing.push(`${file}: no runbook reference`)
    continue
  }
  // Resolve relative to repo root.
  try {
    readFileSync(join(runbookDir, runbookRef + '.md'), 'utf8')
  } catch {
    missing.push(`${file}: runbook ${runbookRef}.md not found`)
  }
}

if (missing.length > 0) {
  console.error('Missing or unresolved runbooks:')
  for (const m of missing) console.error('  ' + m)
  process.exit(1)
}
console.log('All monitors have a resolvable runbook.')
```

Each Datadog monitor YAML carries:

```yaml
name: tier-1-availability
type: query alert
query: 'sum(last_5m):...'
options:
  notifications:
    runbook: tier-1-availability
    sev: 1
```

The CI guard runs on every PR. A new monitor without a runbook fails
CI with a clear message pointing at the missing file.

### 5.1 Reverse direction: orphan runbooks

A secondary check flags runbooks not referenced by any monitor or by
any other doc. Orphans become candidates for deletion or for "this
is an operational procedure, not an alert response" reclassification.

```typescript
// part of scripts/check-alert-has-runbook.ts
const monitorRefs = new Set<string>()
for (const file of readdirSync(monitorsDir)) { /* collect refs */ }
const docRefs = new Set<string>()
// grep docs/ for `runbooks/foo` references
for (const runbook of readdirSync(runbookDir)) {
  const slug = runbook.replace(/\.md$/, '')
  if (slug === '_template' || slug === 'README') continue
  if (!monitorRefs.has(slug) && !docRefs.has(slug)) {
    console.warn(`orphan runbook: ${runbook} (no monitor or doc references it)`)
  }
}
```

Orphans are warnings, not failures — they may be legitimately
operational (e.g. `restore-postgres.md` is invoked from runbook indices,
not from a Datadog monitor).

---

## 6. Quarterly review

The Director of Engineering schedules a quarterly runbook review. For
each runbook:

1. **Owner check**: is the named owner still on the team?
2. **Accuracy check**: when was this runbook last invoked? Did the
   steps work? Are the URLs / queries still valid?
3. **Coverage check**: any new alerts since last quarter that lack a
   runbook?
4. **Gaps**: file `missing-runbook` GitHub issues for any new gaps.

Review notes filed in `output/runbook-review-YYYY-QN.md`. Past reviews
are public.

---

## 7. Files to create/change

### New

- `docs/runbooks/_template.md` — runbook template (§3).
- `docs/runbooks/README.md` — index of all runbooks + ownership.
- `docs/runbooks/<each runbook in §4>` — ~27 files (initial; some are
  one-pagers, some are walkthroughs).
- `scripts/check-alert-has-runbook.ts` — CI guard.
- `infra/datadog/monitors/_schema.json` — JSON schema for monitor
  YAMLs (catches schema drift in PR).

### Changed

- `package.json` — `check:all` includes `check:runbook-coverage`.
- `docs/security/operations/README.md` — link to O7.

### CI

- Add `check:runbook-coverage` to `pnpm check:all`.
- Phase G `alert-has-runbook.test.ts` exists as the runtime equivalent
  for unit-level monitor objects.

---

## 8. Acceptance criteria

- [ ] Template exists at `docs/runbooks/_template.md`.
- [ ] Index exists at `docs/runbooks/README.md` listing every runbook
      + owner + last-reviewed date.
- [ ] Every alert in O5 §7.3 (Tier 1 + Tier 2 alerts) has a runbook
      that follows the template.
- [ ] CI guard `scripts/check-alert-has-runbook.ts` is wired and
      green. Deliberately introducing a monitor without a runbook
      breaks CI.
- [ ] Orphan-runbook warning runs and is acted on.
- [ ] First quarterly review completes and is filed in `output/`.
- [ ] DoE has a recurring calendar event for the review.

---

## 9. Test plan

### 9.1 CI guard exercise

- `test/runbook-coverage.test.ts` — exercises the guard against
  fixture monitor + runbook directories. Asserts:
  - All-green case passes.
  - Missing runbook in a monitor fails CI.
  - Misspelled runbook path fails CI.
  - Orphan runbook produces a warning.

### 9.2 Practice exercise

Once the runbooks exist, every quarter the DoE picks one Tier 1
runbook and asks a NEW team member (not the owner) to walk through it
against a synthetic incident. Measures: can they complete the Diagnose
+ Mitigate phases in <10 min using only the runbook?

---

## 10. Rollback

The guard can be downgraded from "fail CI" to "warn" in a transition
window if too many monitors land without runbooks. This is a
temporary state — the long-term posture is fail-CI.

---

## 11. Open questions

- **OQ-O7-1**: Should runbooks live in the main repo or a separate
  "ops" repo? Proposed: main repo — keeps runbooks alongside the
  code they reference; PR review can update both atomically.
- **OQ-O7-2**: Markdown vs an interactive notebook (Notion / runbook-
  as-code platforms like Squadcast)? Proposed: Markdown — substrate-
  independence (P1). A vendor outage cannot deny us access to our own
  runbooks.
- **OQ-O7-3**: How do we keep runbook URLs / queries from drifting as
  the code changes? Proposed: a per-runbook "last invoked" timestamp
  + a `last-tested` field; quarterly review uses these to prioritise.
- **OQ-O7-4**: Do we publish runbooks externally (for customer
  transparency)? Proposed: no for v1 — they may contain sensitive
  diagnostic queries. A subset (the public-facing status page narrative)
  is OK.
- **OQ-O7-5**: When does a runbook get retired? Proposed: once 4
  consecutive quarterly reviews mark it "not invoked," consider
  retirement OR re-classify as an operational procedure that's
  manually triggered.
