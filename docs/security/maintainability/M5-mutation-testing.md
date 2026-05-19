# M5 — Mutation Testing

> **Status**: DRAFT. **No mutation testing today.** Coverage gates
> (M4) measure which lines run during tests; they do NOT measure
> whether tests would CATCH a wrong implementation of those lines. A
> codebase can have 95% line coverage and still be brittle if tests
> are weak.
>
> This document specifies the mutation-testing tools, the per-area
> mutation score targets, the cadence, and the CI integration.
>
> **Effort**: S (≤3 days to wire on critical paths; ongoing improvement
> per finding).
> **Owner**: Backend lead + Smart-contracts owner.
> **Depends on**: M4 (coverage is the precondition; mutation testing
> measures the quality of test assertions on top of coverage).
> **Unblocks**: confidence that "the tests pass" actually means
> "the implementation is right."

---

## 1. Today's state (honest)

- No mutation testing of any package.
- A test like `expect(result).toBeDefined()` passes whether `result`
  is the correct value or a stub; coverage records this as "covered."
- A test like `expect(x).toBe(5)` against a function that returns
  `5 + 0` will pass; the test doesn't notice if the function changes
  to `5 - 0`.

In a project where contracts move money and the audit chain is the
auditor's only proof of system behavior, weak assertions are real
risk. Mutation testing surfaces them.

This is the gap M5 closes.

---

## 2. Goals

1. **Mutation score ≥80% on critical paths.** Smart contracts; SDK
   delegation + redemption; a2a-agent auth + audit; spec-005 settlement.
2. **Mutation testing runs nightly**, not per-PR (it's expensive).
3. **Per-PR delta**: a PR can't decrease mutation score on a critical
   file. Enforced via stored baseline.
4. **Survived mutations are inspected.** A "survived" mutation =
   the test suite missed it = a real testing gap.

---

## 3. Tooling

### 3.1 TypeScript: Stryker

Stryker-mutator JS is the standard. Vitest-compatible.

```bash
pnpm add -D @stryker-mutator/core @stryker-mutator/vitest-runner @stryker-mutator/typescript-checker
```

`stryker.conf.json` per package (or per critical-area within a package):

```json
{
  "packageManager": "pnpm",
  "testRunner": "vitest",
  "mutate": [
    "src/auth/**/*.ts",
    "src/audit.ts",
    "src/audit-checkpoint.ts",
    "src/lib/policy-startup.ts",
    "src/routes/onchain-redeem.ts",
    "src/routes/session-*.ts"
  ],
  "thresholds": {
    "high": 90,
    "low": 80,
    "break": 80
  },
  "concurrency": 4,
  "timeoutMS": 30000,
  "reporters": ["html", "json", "progress"]
}
```

### 3.2 Solidity: Slither's mutation + manual

Slither doesn't have a turnkey mutation tester, but
[`vertigo-rs`](https://github.com/RareSkills/vertigo) and `gambit`
(Certora's mutation tool) work for Foundry projects. Decision:

| Tool | Pros | Cons | Decision |
|---|---|---|---|
| **gambit** (Certora) | Designed for Foundry. | Beta-quality. | **Chosen** for critical contracts. |
| **vertigo-rs** | Mature. | Hardhat-first; Foundry support uneven. | Backup. |
| **Manual mutation tests** | Reliable. | Slow; doesn't scale. | Used to validate the automated tool. |

`packages/contracts/gambit.conf.json`:

```json
{
  "filename": "src/AgentAccount.sol",
  "num_mutants": 50,
  "mutations": ["binary-op-mutation", "require-mutation", "delete-expression"],
  "outdir": "gambit-out"
}
```

After Gambit runs:

```bash
# For each mutant:
forge test --offline --quiet  # If tests pass, mutation survived.
# Aggregate survival count → mutation score.
```

### 3.3 Critical-path inventory

| Package | Critical files | Why |
|---|---|---|
| `packages/contracts` | `AgentAccount.sol`, `DelegationManager.sol`, every `*Enforcer.sol`, `SmartAgentPaymaster.sol` | Money + delegation; bugs are catastrophic |
| `packages/sdk` | `src/delegation/*.ts`, `src/key-custody/*.ts`, `src/policy/*.ts` | Authority + key handling |
| `apps/a2a-agent` | `src/auth/*.ts`, `src/lib/policy-startup.ts`, `src/audit.ts`, `src/audit-checkpoint.ts`, `src/routes/onchain-redeem.ts`, `src/routes/session-*.ts` | Tier 1 surfaces |

Non-critical paths (UI, GraphDB sync, general MCP CRUD) don't get
mutation-tested in v1. They might in v2 if a real regression class
appears.

---

## 4. Mutation score targets

| Area | Target |
|---|---|
| Smart contracts (critical files) | ≥85% |
| SDK delegation + key-custody | ≥85% |
| a2a-agent auth + audit | ≥80% |
| Other a2a-agent | (not gated) |

A mutation score of 100% is theoretically possible but rarely worth
the engineering cost. The diminishing returns are real. 80-85% on
critical paths is the sweet spot.

---

## 5. Cadence

### 5.1 Nightly full run

GitHub Actions cron `0 4 * * *` (04:00 UTC): runs Stryker + Gambit on
all critical paths. Posts results to:
- Stryker HTML report → S3 + Datadog summary metric.
- Gambit summary → comment on a tracking issue.

Duration: ~30-60 min for Stryker; ~30 min for Gambit. Acceptable
nightly.

### 5.2 Per-PR delta (cheaper)

For PRs touching critical paths, a lightweight Stryker run on the
CHANGED files only. ~5-10 min. Compares against the last nightly
baseline; flags any per-file mutation score regression.

```yaml
# .github/workflows/mutation-pr.yml
on:
  pull_request:
    paths:
      - 'apps/a2a-agent/src/auth/**'
      - 'apps/a2a-agent/src/audit*.ts'
      - 'packages/sdk/src/delegation/**'
      - 'packages/contracts/src/**'

jobs:
  mutation-delta:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm stryker run --mutate "<changed files>"
      - run: scripts/check-mutation-delta.ts
```

`scripts/check-mutation-delta.ts` compares the report against the
stored baseline (`output/mutation-baseline.json`, refreshed nightly)
and refuses merge on regression.

---

## 6. Inspection workflow

A "survived mutation" report needs a human read. For each survived
mutation:

1. The mutation is shown (e.g. `if (x > 0)` → `if (x >= 0)`).
2. The reviewer determines:
   - Test gap? Add a test that catches this mutation.
   - Equivalent mutation? Some mutations are semantically equivalent
     to the original (rare in TypeScript; common in Solidity due to
     gas semantics). Mark with `// mutate: equivalent — <reason>`.
3. The equivalent-mutant comments are themselves reviewed.

Quarterly: the team walks through 20% of survived mutations randomly
to keep the inspection discipline.

---

## 7. Files to create/change

### New

- `stryker.conf.json` per critical-area package.
- `packages/contracts/gambit.conf.json`.
- `packages/contracts/script/mutation-test.sh` — Gambit driver.
- `.github/workflows/mutation-nightly.yml`.
- `.github/workflows/mutation-pr.yml`.
- `scripts/check-mutation-delta.ts`.
- `output/mutation-baseline.json` — nightly artifact.
- `docs/runbooks/mutation-survived.md` — workflow for handling
  survived mutations.

### Changed

- `package.json` per package — `mutation` script.
- `docs/security/maintainability/README.md` — link to M5.

---

## 8. Acceptance criteria

- [ ] Stryker configured + running on critical TS paths.
- [ ] Gambit configured + running on critical Solidity contracts.
- [ ] Nightly run posts results to Datadog + tracking issue.
- [ ] First mutation-score baseline filed at `output/mutation-baseline-
      YYYY-MM.md` for each critical package.
- [ ] Per-PR delta workflow refuses regressions.
- [ ] All critical paths hit their score target in §4 (allow temporary
      lower thresholds with tracking issues, same as M4's bootstrap
      plan).
- [ ] Quarterly inspection review filed.

---

## 9. Test plan

### 9.1 Stryker smoke

- Run Stryker locally on `packages/sdk/src/delegation/`. Confirm it
  produces a report. Confirm at least one survived mutation exists
  (signal that the tool is working — a perfect score is suspicious).

### 9.2 Test-quality verification

- Pick a function with comprehensive tests; verify mutation score
  ≥85%.
- Pick a function with a single `toBeDefined` assertion; verify
  mutation score <50%.

### 9.3 PR-delta verification

- Open a PR that adds a new function to a critical path with weak
  tests; confirm the PR-delta workflow flags the regression.

---

## 10. Cost

| Item | Cost |
|---|---|
| Stryker (OSS) | $0 |
| Gambit (OSS) | $0 |
| GitHub Actions minutes (nightly + PR delta) | ~$10-30/mo |
| Engineering | 2 dev-days initial; few dev-days/quarter for inspection |

Total marginal: ~$10-30/mo.

---

## 11. Rollback

Mutation testing is advisory at first; switching from "blocking" to
"warning" is a config change. Don't lower the targets without a
written justification.

---

## 12. Open questions

- **OQ-M5-1**: Does mutation testing pair well with property-based
  testing (Spec 007 Phase G's `fast-check` property tests)? Proposed:
  yes — property tests are excellent mutation killers because they
  test a behavior, not a specific input. Critical paths should have
  BOTH.
- **OQ-M5-2**: How long is acceptable for the nightly run? Proposed:
  ≤90 min. Above that, reduce mutation count per file or split into
  parallel jobs.
- **OQ-M5-3**: Stryker has runtime cost; do we run against staging
  data? Proposed: no — mutation testing runs against the test suite,
  not against live data. Staging is for load testing (O8).
- **OQ-M5-4**: Gambit vs Vertigo for Solidity — re-check yearly.
  Tooling evolves quickly in the Solidity space.
- **OQ-M5-5**: Should mutation results be reported to customers /
  auditors? Proposed: yes for the contract files at audit time —
  external auditors typically appreciate seeing the mutation report
  as evidence of test rigor.
