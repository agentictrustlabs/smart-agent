# M4 — Test Coverage Thresholds

> **Status**: DRAFT. **No coverage thresholds enforced today.**
> `pnpm test` runs Vitest / Forge tests; coverage may be computed by
> `pnpm --filter @smart-agent/web test:coverage` but no minimum is
> enforced in CI. PRs can land that drop coverage on critical paths.
>
> This document specifies per-package coverage thresholds, the
> measurement tooling, and the CI enforcement.
>
> **Effort**: M (1 week — measure current state, set thresholds, wire
> CI, rectify gaps).
> **Owner**: Backend lead + per-package owner.
> **Depends on**: M2 (branch protection makes coverage a required
> check).
> **Unblocks**: confidence in refactors; M5 (mutation testing builds
> on coverage).

---

## 1. Today's state (honest)

| Package | Test framework | Coverage tool | Threshold |
|---|---|---|---|
| `apps/web` | Vitest | v8 / istanbul (configured ad hoc) | None |
| `apps/a2a-agent` | Vitest | v8 (not in CI) | None |
| `apps/person-mcp` and other MCPs | Vitest | v8 (not in CI) | None |
| `packages/sdk` | Vitest | v8 (not in CI) | None |
| `packages/contracts` | Forge | `forge coverage` | None |
| `packages/discovery` | Vitest | v8 (not in CI) | None |

The current `pnpm test` runs the suites but does not surface coverage
in CI. Coverage drift goes unnoticed.

This is the gap M4 closes.

---

## 2. Goals

1. **Per-package coverage thresholds in CI.** Different stacks have
   different reasonable targets.
2. **Thresholds set by risk tier**, not uniformly.
3. **Coverage report published per PR.** Reviewer can see what new
   lines went uncovered.
4. **Diff coverage gating.** A PR introduces ≥80% coverage on its
   own new lines (separate from the overall threshold).
5. **No "uncoverable" excuses.** Every line is either covered, marked
   `istanbul ignore` with a rationale, or excluded via a documented
   path.

---

## 3. Thresholds

### 3.1 Per-package

| Package | Line | Branch | Function |
|---|---|---|---|
| `packages/contracts` | **95%** | **90%** | 95% |
| `packages/sdk` | **85%** | **75%** | 85% |
| `packages/discovery` | **80%** | **70%** | 80% |
| `apps/a2a-agent` | **85%** | **75%** | 85% |
| `apps/person-mcp` | **80%** | **70%** | 80% |
| `apps/org-mcp` | **80%** | **70%** | 80% |
| Other MCPs | **75%** | **65%** | 75% |
| `apps/web` | **70%** | **60%** | 70% |

Rationale:
- **Contracts** carry the highest risk; coverage MUST be high. Forge
  coverage + Slither / Mythril keep the bar honest.
- **SDK** is the substrate for many callers; refactors must not break
  callers silently.
- **a2a-agent** is Tier 1; auth + signing surfaces demand high coverage.
- **Other MCPs** are domain-specific; 75-80% acceptable.
- **Web** has UI components that are reasonably tested via Playwright
  (separate from unit-coverage); pure JS logic in web should hit 70%.

### 3.2 Diff coverage

Per PR, the diff must hit ≥80% line coverage on its NEW lines.
Implementation: `coverage-diff` tool or codecov.io's diff metric.

This catches the failure mode where coverage of the codebase as a
whole stays at 85% (the threshold) while every NEW commit ships at
50% coverage — the codebase is silently rotting.

---

## 4. Measurement

### 4.1 Tooling

| Stack | Tool | Notes |
|---|---|---|
| TypeScript (Vitest) | v8 native coverage | Built into Node; no extra dep. |
| TypeScript (Jest) | istanbul / nyc | If any service is Jest. |
| Solidity | `forge coverage` | LCOV format. |

`vitest.config.ts` per package:

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'lcov'],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 75,
        statements: 85,
        autoUpdate: false,  // never auto-lower the threshold
      },
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.fixture.ts',
        'src/generated/**',  // ABI types, etc.
      ],
    },
  },
})
```

### 4.2 Forge

`packages/contracts/foundry.toml`:

```toml
[profile.default.coverage]
runs = 256
report = "lcov"
```

`packages/contracts/script/check-coverage.sh`:

```bash
forge coverage --report lcov
genhtml -o coverage/html coverage/lcov.info
# Parse lcov and fail if below thresholds.
awk '/^DA:/ {covered += $2 > 0; total++} END {pct = covered/total*100; if (pct < 95) {print "line coverage", pct, "< 95"; exit 1}}' coverage/lcov.info
```

### 4.3 CI workflow

`.github/workflows/coverage.yml`:

```yaml
name: coverage
on:
  pull_request:
    branches: [master, main]
  push:
    branches: [master, main]

jobs:
  ts-coverage:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9.15.0 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm -r test --coverage
      - uses: codecov/codecov-action@v4
        with:
          flags: typescript
          token: ${{ secrets.CODECOV_TOKEN }}
      - name: Diff coverage
        run: pnpm exec diff-cover coverage/lcov.info --compare-branch=origin/master --fail-under=80

  contracts-coverage:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: packages/contracts } }
    steps:
      - uses: actions/checkout@v4
        with: { submodules: recursive }
      - uses: foundry-rs/foundry-toolchain@v1
        with: { version: nightly }
      - run: forge coverage --report lcov
      - run: bash script/check-coverage.sh
      - uses: codecov/codecov-action@v4
        with:
          flags: contracts
          token: ${{ secrets.CODECOV_TOKEN }}
```

Both jobs are required-status-checks per M2.

---

## 5. Publishing reports

### 5.1 Codecov

Codecov.io integration:
- Per-PR comment with coverage delta.
- Per-file coverage view.
- Diff coverage highlight in PR view.

Free tier supports OSS. Pricing for private repos: ~$10/user/mo.

### 5.2 In-repo summary

`scripts/coverage-summary.ts` (new) emits a per-package coverage
table to a `coverage/SUMMARY.md` file at CI time. Helpful when
codecov is unreachable.

---

## 6. Exclusions

Some code is legitimately untestable or test-redundant. The
`istanbul ignore next` / `c8 ignore` mechanism marks these. Every
ignore comment MUST include a rationale:

```typescript
/* c8 ignore next 3 — process.exit branch in startup guard;
   tested via integration test that spawns a subprocess */
if (assertionFailed) {
  process.exit(1)
}
```

Reviewers reject ignore comments lacking rationale. A CI guard
(`check-ignore-comments.ts`) parses ignore comments and requires the
rationale phrase.

---

## 7. Acceptance of new code

When a PR introduces a new file under, say, `apps/a2a-agent/src/`:

- The file's coverage must be ≥85% (its package's threshold).
- The diff (the new file is entirely diff) must be ≥80% covered.
- If the file is harder to test than 85%, the PR includes a
  follow-up issue + a rationale comment.

A PR that drops `apps/a2a-agent` coverage below 85% is REFUSED merge.

---

## 8. Bootstrap plan

Today's coverage is unknown. Phase 1:

1. Run coverage on every package; record the current numbers in
   `output/coverage-baseline-2026-05.md`.
2. Compare to the target thresholds in §3.
3. For each gap (current < target):
   - If gap is <5pp: write tests to close.
   - If gap is >5pp: set a temporary lower threshold + GitHub issue
     to ramp to target over the next 4 weeks.
4. Wire the (temporary) thresholds into CI. NEVER lower thresholds
   from there; only raise.

Each temporary lower threshold has an associated GitHub issue with
a deadline. The CI guard cross-references issues and fails when an
issue blocks a threshold raise.

---

## 9. Files to create/change

### New

- `vitest.config.ts` per package (or root with package overrides) —
  threshold config.
- `packages/contracts/script/check-coverage.sh`
- `.github/workflows/coverage.yml`
- `scripts/coverage-summary.ts`
- `scripts/check-ignore-comments.ts`
- `output/coverage-baseline-2026-05.md` — first measurement.

### Changed

- `package.json` root — `test:coverage` script runs coverage across
  packages.
- M2 branch protection — `coverage` jobs become required status
  checks.

---

## 10. Acceptance criteria

- [ ] Coverage tooling configured per package.
- [ ] CI workflow `.github/workflows/coverage.yml` running on every
      PR.
- [ ] Codecov.io integration live; PR comments visible.
- [ ] Thresholds set per §3 (with documented temporary lower bounds
      where current state requires).
- [ ] Diff coverage ≥80% enforced.
- [ ] CI guard `check-ignore-comments` green.
- [ ] Coverage baseline filed in `output/coverage-baseline-2026-05.md`.
- [ ] All temporary lower thresholds have associated issues with
      deadlines.

---

## 11. Test plan

### 11.1 Threshold enforcement

- Deliberately add a 50-line function with no tests to `packages/sdk`.
  Confirm CI fails with the line-coverage threshold message.

### 11.2 Diff enforcement

- Add a new 50-line function with 10 lines tested. Confirm diff
  coverage gating fails.

### 11.3 Ignore-rationale enforcement

- Add `/* c8 ignore next */` without a rationale; confirm CI fails.
  Add the rationale; confirm CI passes.

---

## 12. Cost

| Item | Cost |
|---|---|
| Codecov private-repo | $10/user/mo (5 seats initially = $50/mo) |
| Coverage compute time | adds ~30% to CI test phase |
| Engineering | 1 dev-week to wire + 1 dev-week to close gaps |

Total marginal: ~$50/mo.

---

## 13. Rollback

Thresholds can be lowered via a config change (and a written
justification in PR). The DoE owns these decisions. Lowering is
visible in Git history and the codecov UI.

A failure mode to AVOID: silently disabling the coverage workflow.
M2's required-status-check ensures the workflow MUST run; can't
silently skip.

---

## 14. Open questions

- **OQ-M4-1**: Per-file vs per-package thresholds? Proposed: per-
  package primary; per-file via `vitest`'s file-level threshold for
  truly critical files (`packages/sdk/src/delegation/redeem.ts` at
  95% line). Use sparingly.
- **OQ-M4-2**: Branch coverage is harder to hit; do we want it at all
  for `apps/web`? Proposed: yes — 60% is a low bar that catches the
  obvious gaps without being onerous.
- **OQ-M4-3**: Snapshot tests count toward coverage but aren't always
  meaningful. Proposed: snapshot tests OK; mutation testing (M5)
  catches the "covered but un-asserted" cases.
- **OQ-M4-4**: Coverage on generated code (ABI types, OpenAPI)?
  Proposed: exclude. Generated code's correctness is verified by
  generation, not test.
- **OQ-M4-5**: How do we avoid the trap of "test for coverage, not
  correctness"? Proposed: M5 (mutation testing) is the discipline
  that prevents this. Coverage thresholds without mutation testing
  invite test-bloat-without-value.
