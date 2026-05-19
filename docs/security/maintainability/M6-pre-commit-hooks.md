# M6 — Pre-Commit Hooks

> **Status**: DRAFT. **No pre-commit hooks installed today.**
> Engineers run `pnpm lint` and `pnpm typecheck` by hand (or don't);
> commits that fail CI lint roundtrip through GitHub. The first time
> a typo gets caught is in CI, ~3-5 min after the commit.
>
> This document specifies the pre-commit hook stack: tool (husky vs
> lefthook), what runs, the bypass policy, and the audit posture for
> bypasses.
>
> **Effort**: S (≤1 day to install + wire).
> **Owner**: Backend lead.
> **Depends on**: Spec 007 Phase G (CI guards exist locally), M1
> (CODEOWNERS knows who reviews bypasses).
> **Unblocks**: faster developer feedback; cleaner CI signal.

---

## 1. Today's state (honest)

| Practice | Today |
|---|---|
| Pre-commit hooks | None installed |
| Lint roundtrip | Engineer fixes in CI |
| Commit-message format | Convention (Conventional Commits) but unenforced |
| `--no-verify` use | N/A (no hooks to skip) |

Common dev-time pain: 5-min CI run reveals a 1-second-to-fix Prettier
issue. Engineer pushes again; another 5 min. Twice in a row, the dev
context-switches.

This is the gap M6 closes.

---

## 2. Goals

1. **Fast local feedback.** Pre-commit hook runs in <5 s for the
   common case (small commit; staged-only checks).
2. **Match CI exactly.** A passing pre-commit matches a passing CI.
   No drift.
3. **Bypass is allowed but audited.** `--no-verify` works for genuine
   emergencies; the next push attaches an audit comment.
4. **No mandatory testing in pre-commit.** Tests run in CI;
   pre-commit is lint + typecheck + format-staged-only.

---

## 3. Tooling decision

| Tool | Pros | Cons | Decision |
|---|---|---|---|
| **husky** | Most popular Node Git hook tool; well-documented. | Configuration in `package.json` or `.husky/`; lots of small files. | **Chosen.** |
| **lefthook** | Faster (Go); single YAML config. | Less widespread; fewer existing examples. | Strong backup. |
| **pre-commit (Python framework)** | Polyglot. | Adds a Python dependency. | Rejected. |
| **Hand-rolled Git hooks** | Zero deps. | Has to be installed per developer; doesn't survive `git clone`. | Rejected. |

### 3.1 Why husky

We're already a Node monorepo; husky installs via `pnpm` and
self-installs hooks on `pnpm install` via `prepare` script.
Substrate-independence check: husky is a thin wrapper around Git's
native hooks. We can swap to lefthook or hand-rolled with no
runtime impact.

`packages/contracts/lib/openzeppelin-contracts/.husky/pre-commit`
already exists from a vendored OpenZeppelin submodule — confirming
husky is the lingua franca.

---

## 4. The hook stack

### 4.1 pre-commit

`.husky/pre-commit`:

```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

# Run lint-staged: ESLint + Prettier + per-file checks on staged
# files only. Fast (<5s typical).
pnpm exec lint-staged

# Typecheck the affected packages. tsc is incremental, so this is
# typically <10s on a warm cache.
pnpm exec pnpm-affected --action=typecheck

# Quick CI guards relevant to local dev.
pnpm check:bypass
```

`package.json` (root):

```json
{
  "lint-staged": {
    "*.{ts,tsx}": [
      "prettier --write",
      "eslint --fix --max-warnings=0"
    ],
    "*.{json,md,css}": [
      "prettier --write"
    ],
    "packages/contracts/**/*.sol": [
      "forge fmt"
    ]
  }
}
```

### 4.2 commit-msg

`.husky/commit-msg`:

```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

# Conventional Commits enforcement.
pnpm exec commitlint --edit "$1"
```

`.commitlintrc.json`:

```json
{
  "extends": ["@commitlint/config-conventional"],
  "rules": {
    "type-enum": [2, "always", [
      "feat", "fix", "chore", "test", "docs", "refactor", "perf",
      "ci", "build", "style", "revert"
    ]],
    "subject-case": [2, "always", ["lower-case", "sentence-case", "start-case"]],
    "subject-empty": [2, "never"],
    "subject-max-length": [2, "always", 100]
  }
}
```

### 4.3 pre-push (light)

`.husky/pre-push`:

```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

# Run the SAME 'check:all' that CI runs. Catches issues before push.
# Skipped on `git push --no-verify`.
pnpm check:all
```

Pre-push is more expensive (full repo check); ~30 s typical.
Engineers can `git push --no-verify` if they truly need to push
work-in-progress (e.g. backup, share with a colleague).

### 4.4 Forge tests

NOT in pre-commit. Forge tests take 10-30 s and would slow down
trivial Solidity edits. Tests run in CI.

### 4.5 Coverage / mutation

NOT in pre-commit. These run nightly (M5) and in CI on PR (M4).

---

## 5. Bypass policy

### 5.1 Allowed bypasses

- `git commit --no-verify` is allowed but logged.
- `git push --no-verify` is allowed but logged.

Use cases:
- Work-in-progress backup.
- Genuine emergency.
- Tool malfunction (rare).

### 5.2 Audit

A post-commit hook (`.husky/post-commit`):

```bash
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

# If the commit lacks a `pre-commit-checks-passed: true` trailer
# (which the pre-commit hook adds), warn the committer.
if ! git log -1 --format=%B | grep -q "pre-commit-checks-passed: true"; then
  echo "[husky] WARNING: this commit was made with --no-verify."
  echo "[husky] If unintentional, run 'pnpm check:all' before pushing."
fi
```

The pre-commit hook adds a `pre-commit-checks-passed: true` trailer to
the commit message via `git commit --trailer`. A `--no-verify`
commit lacks this trailer.

### 5.3 PR-level audit

A required CI check `pre-commit-checks-passed.yml` parses every
commit in the PR's range and counts how many bypassed pre-commit.
If >0, the PR shows a warning comment from a bot:

> ⚠ This PR contains N commits that bypassed pre-commit checks
> (`--no-verify`). Confirm CI is fully green and consider squashing.

Not a hard block — engineers occasionally `--no-verify` for legit
reasons (e.g. committing a WIP that doesn't lint yet because they're
mid-refactor). The squash usually cleans this up.

---

## 6. Installation

The hook stack installs automatically via husky's `prepare` script:

```json
// package.json (root)
{
  "scripts": {
    "prepare": "husky install"
  }
}
```

On `pnpm install`, husky writes the hooks to `.git/hooks/`. New
contributors get the hooks on their first install.

For CI environments (where the hook would slow things down), `husky
install` is a no-op when `CI=true`.

---

## 7. Files to create/change

### New

- `.husky/pre-commit`
- `.husky/commit-msg`
- `.husky/pre-push`
- `.husky/post-commit`
- `.commitlintrc.json`
- `package.json` — `lint-staged` config + `prepare` script
- `.github/workflows/commit-trailer-check.yml` — PR-level bypass
  audit.

### Changed

- `package.json` — add dev deps for husky + lint-staged + commitlint.
- `docs/security/maintainability/README.md` — link to M6.

---

## 8. Acceptance criteria

- [ ] `pnpm install` installs the hooks.
- [ ] `git commit` runs lint-staged + typecheck + check-bypass.
- [ ] `git commit` rejects a commit with a non-Conventional message.
- [ ] `git commit --no-verify` skips hooks; the commit lacks the
      pre-commit trailer.
- [ ] PR with a no-verify commit shows the bot warning.
- [ ] Hook stack works on macOS, Linux, WSL.

---

## 9. Test plan

### 9.1 Hook installation

- Fresh clone; `pnpm install`; verify `.git/hooks/pre-commit` exists.

### 9.2 Hook behaviour

- Commit a file with a Prettier violation; verify the hook reformats
  + commits.
- Commit with a non-Conventional message (`update stuff`); verify
  rejection.
- Commit with `--no-verify`; verify success + missing trailer.

### 9.3 Cross-platform

- Reproduce the setup on Linux + macOS + Windows (WSL); confirm
  identical behavior.

---

## 10. Cost

| Item | Cost |
|---|---|
| husky + lint-staged + commitlint | $0 (OSS) |
| Engineering | 1 dev-day |

---

## 11. Rollback

Hooks can be uninstalled via `rm -rf .git/hooks/*` (per repo).
Disabling the `prepare` script in `package.json` skips future
auto-install.

Don't roll back without a written justification.

---

## 12. Open questions

- **OQ-M6-1**: Should we run a smoke-subset of tests in pre-commit?
  Proposed: no — pre-commit must stay <10 s. Tests are CI's job.
- **OQ-M6-2**: Lefthook over husky? Proposed: stay with husky for
  ecosystem familiarity; revisit if performance becomes an issue.
- **OQ-M6-3**: How do we onboard the first engineer who hasn't seen
  husky before? Proposed: `docs/onboarding.md` includes a section on
  the hook stack. The hooks themselves print helpful error messages.
- **OQ-M6-4**: Pre-commit on a 1000-file change? Proposed: lint-
  staged runs only on staged files; a 1000-file change still lints
  each. If this becomes a real bottleneck, the engineer can split the
  commit.
- **OQ-M6-5**: Do we want `--no-verify` to require an env var
  acknowledgment (e.g. `SMART_AGENT_NO_VERIFY=1`)? Proposed: no —
  too friction-heavy. The PR-level audit (§5.3) is sufficient.
