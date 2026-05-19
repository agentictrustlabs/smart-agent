# Operations Maturity Plans — O1..O11

> **Scope**: board-presentable, SRE-flavored plans to move Smart Agent from
> prototype-quality ops to production-quality ops. Each doc is an
> implementation plan a Director of Engineering can hand to a senior
> on-call engineer with no further unpacking.
>
> These plans assume the Spec 007 contract / signer / storage hardening
> (`specs/007-architecture-hardening/plan.md`) is landing in parallel —
> several docs reference Phase F.2 (Postgres) and Phase G (CI guards) as
> hard preconditions.

## Why this exists

Today the project ships:

- A single dev orchestration script (`scripts/fresh-start.sh`) that boots
  anvil + 9 MCPs + web from zero.
- Some startup invariants (`apps/a2a-agent/src/lib/policy-startup.ts`)
  that hard-fail boot when the policy / key / sink configuration is
  inconsistent.
- A composite CI workflow (`.github/workflows/ci.yml`) covering
  typecheck, test, `pnpm check:all`, forge build/test.

What it does NOT ship (and what these plans address):

| Gap | Plan |
|---|---|
| No deployment procedure — `fresh-start.sh` is a dev tool | O1 |
| `/health` and `/ready` are conflated or absent on most services | O2 |
| SIGTERM kills in-flight userOps | O3 |
| No production backups (Askar vault, Postgres, KMS metadata) | O4 |
| No declared RTO/RPO targets per service tier | O5 |
| No on-call rotation or escalation policy | O6 |
| Alerts exist but most have no linked runbook | O7 |
| No capacity model; no load testing methodology | O8 |
| No per-service cost monitoring or budget alerts | O9 |
| No feature-flag system; behavior changes ship via env vars + redeploy | O10 |
| No change-management process for high-risk merges | O11 |

## Reading order

Pick by area of concern. The recommended dependency order, however, is:

| # | Doc | Effort | Status |
|---|-----|--------|--------|
| O2 | [Deep Health Checks](./O2-deep-health-checks.md) | M | Draft |
| O3 | [Graceful Shutdown](./O3-graceful-shutdown.md) | S | Draft |
| O1 | [Deployment Procedure](./O1-deployment-procedure.md) | L | Draft |
| O4 | [Backup Procedures](./O4-backup-procedures.md) | L | Draft |
| O5 | [DR RTO/RPO Targets](./O5-dr-rto-rpo-targets.md) | M | Draft |
| O11 | [Change Management](./O11-change-management.md) | M | Draft |
| O7 | [Runbook Completeness](./O7-runbook-completeness.md) | M (ongoing) | Draft |
| O6 | [On-Call Rotation](./O6-on-call-rotation.md) | S (setup) + ongoing | Draft |
| O10 | [Feature Flags](./O10-feature-flags.md) | M | Draft |
| O8 | [Capacity Planning](./O8-capacity-planning.md) | M | Draft |
| O9 | [Cost Monitoring](./O9-cost-monitoring.md) | M | Draft |

Effort tags: **S** = ≤3 days, **M** = 1 week, **L** = 2-3 weeks.

## Cross-cutting principles

1. **Substrate independence (P1)**. Where these plans use vendor tools
   (PagerDuty, LaunchDarkly, k6, Datadog), the integration layer is
   in-repo. A vendor outage degrades visibility; it never breaks the
   service. See `docs/architecture/principles.md`.

2. **Dev parity**. The same `/health`, `/ready`, graceful-shutdown,
   feature-flag, and circuit-breaker code paths run in dev. No
   `if (NODE_ENV === 'production')` branches around primitives — the
   only acceptable branches are config values (timeouts, thresholds).

3. **No silent fallbacks**. A failed health probe, expired feature
   flag, or absent runbook is loud. Mirrors `policy-startup.ts` and
   Spec 007 north-star goal #4.

4. **Every alert links to a runbook**. Tracked in O7. A new alert
   without a runbook is a CI-blockable change (O7 §4 introduces the
   `alert-has-runbook.test.ts` guard).

5. **Every primitive is testable end-to-end**. Chaos drills are
   first-class:
   - O3: kill -TERM during a userOp, verify drain.
   - O4: weekly backup-and-restore drill (`DR2`).
   - O5: quarterly DR exercise per service tier.

## Operator handoff

Each plan contains:

- **Files to change** — exhaustive; `git grep` confirms.
- **Vendor + cost** — current per-month rough numbers, vendor URL.
- **Acceptance criteria** — merge gate.
- **Test plan** — QA gate, including chaos drill where applicable.
- **Rollback** — how to revert if the change breaks production.

Open questions are flagged `OQ-O<n>-<m>` and owned by the doc author.

## Glossary

| Term | Definition |
|---|---|
| RTO | Recovery Time Objective — wall-clock time from incident detection to service restoration. |
| RPO | Recovery Point Objective — maximum tolerated data loss measured in wall-clock time. |
| Tier 1 | Money movement, signing, auth — must be online. |
| Tier 2 | Registries, profile reads, governance reads. |
| Tier 3 | GraphDB mirror, analytics, non-critical reads. |
| Canary | Subset of traffic routed to a new build; rollback automatic on metric regression. |
| Blue-green | Two identical environments; cutover by router flip. |
| Synthetic transaction | Scripted end-to-end probe (e.g. simulated pledge → settle) run continuously. |
| Saturation | Resource is at >80% of its hard limit; performance degrades non-linearly past this point. |

## Cross-reference

- Reliability and DR: `docs/security/reliability-and-dr/` (DR1..DR7).
- Maintainability: `docs/security/maintainability/` (M1..M7).
- Runtime security: `docs/security/runtime/` (R1..R10).
- Key management: `docs/security/key-management/` (K1..K4).
- KMS outage: `docs/security/key-management/K3-break-glass-and-kms-outage.md`.
