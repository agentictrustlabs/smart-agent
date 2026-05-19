# Maintainability Plans — M1..M7

> **Scope**: board-presentable, developer-actionable plans for the
> code-stewardship and supply-chain practices that keep the codebase
> changeable over years. Operations docs (`docs/security/operations/`)
> address running the system; reliability/DR (`docs/security/reliability-
> and-dr/`) addresses keeping it up; maintainability addresses keeping
> it readable, reviewable, and safe-to-change.

## Why this exists

Today the project ships:

- Composite CI workflow (`.github/workflows/ci.yml`) gating
  typecheck + test + `check:all` + forge build/test.
- Convention-based code review (1 reviewer, informal).
- A few documented checks under `scripts/check-*` (route inventory,
  no-bypass guard).
- Spec 007 Phase G plans property tests + further CI guards.
- No formal ownership map, no branch protection rules formalised, no
  ADR practice, no coverage thresholds, no mutation testing, no
  pre-commit hooks, no dependency-update policy.

What it does NOT ship (and what these plans address):

| Gap | Plan |
|---|---|
| No CODEOWNERS file routing reviewers to sensitive paths | M1 |
| No formal branch protection rules; bypass is possible | M2 |
| No ADR practice; architectural decisions are scattered | M3 |
| No coverage thresholds enforced in CI | M4 |
| No mutation testing of critical paths | M5 |
| No pre-commit hooks; everyone runs lint/typecheck by hand | M6 |
| No dependency-update SLA; dependabot is uncalibrated | M7 |

## Reading order

| # | Doc | Effort | Status |
|---|-----|--------|--------|
| M1 | [CODEOWNERS](./M1-codeowners.md) | S | Draft |
| M2 | [Branch Protection](./M2-branch-protection.md) | S | Draft |
| M6 | [Pre-Commit Hooks](./M6-pre-commit-hooks.md) | S | Draft |
| M7 | [Dependency Update Policy](./M7-dependency-update-policy.md) | S | Draft |
| M3 | [ADR Practice](./M3-adr-practice.md) | M | Draft |
| M4 | [Test Coverage Thresholds](./M4-test-coverage-thresholds.md) | M | Draft |
| M5 | [Mutation Testing](./M5-mutation-testing.md) | S | Draft |

Effort tags: **S** = ≤3 days, **M** = 1 week.

## Cross-cutting principles

1. **Substrate independence (P1)**. Where these plans use vendor
   tools (GitHub features for CODEOWNERS + branch protection,
   dependabot, Stryker, husky), the integration is in-repo
   configuration; no runtime dependency.

2. **Convention promoted to rule**. Most current practices are good
   conventions waiting to become enforced rules. Each plan picks one
   convention to lock in as CI-or-tool-enforced.

3. **Dev parity**. Pre-commit hooks (M6) match CI exactly; running
   `pnpm check:all` locally must produce the same result as the CI
   workflow.

4. **No silent fallbacks**. A failed coverage threshold or stale
   dependency surfaces in CI, not in a quarterly cleanup pass.

## Cross-reference

- Operations: `docs/security/operations/` (O1..O11). M2 is wired
  into O11's deploy-approval workflow.
- Reliability and DR: `docs/security/reliability-and-dr/` (DR1..DR7).
- Runtime security: `docs/security/runtime/` (R1..R10).

## Glossary

| Term | Definition |
|---|---|
| **ADR** | Architecture Decision Record. A markdown file recording a significant decision with context, decision, consequences. |
| **CODEOWNERS** | GitHub file mapping paths to required reviewers. |
| **Coverage threshold** | Minimum line / branch coverage CI requires. |
| **Mutation testing** | A test technique that mutates code (changes operators, etc.) to verify the test suite catches the mutation. Score = % of mutations caught. |
| **Pre-commit hook** | Local Git hook that runs checks before allowing a commit. |
| **Conventional Commits** | Commit-message convention (`feat:`, `fix:`, …) we already use; M6 enforces. |
