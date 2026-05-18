# CI Setup — Supply-Chain Checks (Sprint 3 S3.5)

This document is the operator runbook for the supply-chain CI added in
Sprint 3 S3.5. It covers:

1. What each workflow does and what failures mean.
2. The recommended local pre-commit hook.
3. The branch-protection settings the operator must enable
   post-merge (the workflows do not enable themselves).

## Workflows

All workflows live under `.github/workflows/`. They run on every pull
request targeting `master` (and most run on direct push too).

| Workflow                | File                                | Gates on                                          |
|-------------------------|-------------------------------------|---------------------------------------------------|
| `ci`                    | `ci.yml`                            | typecheck, test, `check:all`, forge build + test |
| `pnpm-audit`            | `pnpm-audit.yml`                    | `pnpm audit` HIGH / CRITICAL advisories          |
| `codeql`                | `codeql.yml`                        | CodeQL TS+JS analysis (security-extended)        |
| `secret-scan`           | `secret-scan.yml`                   | gitleaks against the diff                        |
| `dependency-review`     | `dependency-review.yml`             | new deps: HIGH vulns + license outside allowlist |
| `contracts-static`      | `contracts-static.yml`              | Slither HIGH severity (path-filtered to .sol)    |

### `ci` — language-level quality gate

Composite required-check workflow. Runs:

- `pnpm -r typecheck` — TypeScript strict; no `any`, no `@ts-ignore`.
- `pnpm -r test` — every package's test suite.
- `pnpm check:all` — bypass scanner + route classification + route inventory.
- `forge build --sizes` — Solidity must compile under the 24 KB limit.
- `forge test -vvv` — Foundry tests.

**Failure mode**: fix the code; this is the day-to-day developer feedback
loop. If a test is flaky, mark it `skip` with a TODO + ticket — don't
disable the workflow.

### `pnpm-audit` — npm advisory database

Runs `pnpm audit --audit-level=high`. Exit code is nonzero if any
HIGH or CRITICAL advisory affects the lockfile. MODERATE and LOW
are reported in a PR comment but do not gate merge.

**Failure mode**:

1. `pnpm audit --json` locally to identify the offending package.
2. `pnpm up <pkg>` or, if upstream has not patched, add a
   `pnpm.overrides` entry in the root `package.json` pinning a known-safe
   version, with a comment linking the advisory.
3. If the advisory is unreachable from our code paths, the Security
   role may approve a temporary `.pnpm-audit-ignore` waiver — record the
   advisory ID, the reachability analysis, and the expiry in the PR.

### `codeql` — semantic static analysis

GitHub-hosted CodeQL. Default queries + `security-extended` pack.
Also runs on a weekly schedule (Mondays 06:17 UTC) to catch new
queries that land in the CodeQL DB.

**Failure mode**: open the Code Scanning tab on the PR. Each alert
links to the offending location + the query that fired. Either fix
or dismiss with a `false positive` / `won't fix` reason — dismissals
are audited.

### `secret-scan` — gitleaks

Scans the PR diff (not just the latest commit) for known secret patterns:
AWS keys, GitHub PATs, private keys, etc. Fails on any detection.

**Failure mode**:

1. **If the secret is live**, ROTATE IT immediately. The git history
   is public the moment the push lands.
2. Remove the secret from the file. `git commit --amend` or new commit.
3. If the history must be sanitized, use `git filter-repo` and force-push
   (only with Security review).

### `dependency-review` — license + vulnerability gate

GitHub-native action that diffs `pnpm-lock.yaml` between the base branch
and the PR. Fails if any *new* dependency:

- has a HIGH severity vulnerability, or
- has a license outside `MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC`.

**Failure mode**: pick a different dep, or if no alternative exists,
file a license-waiver PR that adds the license to the allowlist in
`.github/workflows/dependency-review.yml` with reasoning. License
expansions require Security + Information-Architect sign-off.

### `contracts-static` — Slither

Static analysis of Solidity sources in `packages/contracts/`.
Path-filtered: only runs when `.sol` files, `foundry.toml`, or
`remappings.txt` change.

Detector tuning lives in `packages/contracts/.slither.json`. The
`detectors_to_exclude` list MUST have an inline note explaining
why each detector is suppressed (known false-positive family,
intentional pattern, etc.). New suppressions require a Reviewer
+ Security review.

**Failure mode**:

1. Read the Slither output for the file + finding.
2. Fix the issue (preferred) or, if confirmed false positive,
   add a `// slither-disable-next-line <detector>` comment with
   a one-line justification. Do NOT silently broaden
   `.slither.json` — it should remain narrow.

## Local pre-commit hook

`.github/hooks/pre-commit` runs the fast guardrails locally so you
catch them before pushing. It is **opt-in** — not auto-installed.

To install (one-time, per clone):

```bash
git config core.hooksPath .github/hooks
chmod +x .github/hooks/pre-commit
```

To verify:

```bash
.github/hooks/pre-commit
```

The hook intentionally only runs `pnpm check:bypass` +
`pnpm check:route-classification`. Slow checks (full test, forge test,
CodeQL) belong in CI — running them on every commit kills flow.

## Branch protection (operator action)

The workflows above run, but GitHub will not *require* them by default.
The operator must enable branch protection on `master`:

1. Repo settings → Branches → Branch protection rules → Add rule.
2. Branch name pattern: `master` (and `main` if it exists).
3. Enable "Require status checks to pass before merging".
4. Enable "Require branches to be up to date before merging".
5. Add required checks:
   - `typescript (typecheck + test + check:all)` (from `ci`)
   - `contracts (forge build + test)` (from `ci`)
   - `pnpm audit (high+critical)`
   - `Analyze javascript-typescript` (from `codeql`)
   - `gitleaks`
   - `dependency-review`
   - `slither` (only fails if Solidity changes — but should still be required)
6. Enable "Require pull request reviews before merging" (at least 1).
7. Enable "Require signed commits" if the team is set up for it.

Until step 5 is done, the workflows are *informational only*. The
workflows themselves cannot self-promote to required.

## How each failure mode rolls up

| Severity              | Action                                           |
|-----------------------|--------------------------------------------------|
| Secret detected       | Rotate + remove + Security review                |
| HIGH vuln (audit/dep) | Block merge; update dep or pin override          |
| HIGH Slither finding  | Block merge; fix or document false positive      |
| CodeQL HIGH alert     | Block merge; fix or document dismissal          |
| MODERATE vuln         | Informational; track in security backlog         |
| LOW vuln              | Informational; sweep quarterly                   |

## Out of scope (Sprint 3 S3.5)

These are tracked separately and are NOT in this sprint:

- SBOM generation (CycloneDX / SPDX).
- Sigstore artifact signing.
- Reusable workflow templates across the org.
- Dependabot / Renovate auto-update wiring.
