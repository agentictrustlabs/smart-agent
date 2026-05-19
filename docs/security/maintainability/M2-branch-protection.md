# M2 — Branch Protection

> **Status**: DRAFT. **Branch protection is unconfigured today.**
> `master` can be pushed to directly (in principle); PRs can merge
> without required CI checks; admins are not enforced.
>
> This document specifies the branch protection rules for `master`,
> the required status checks, the review requirements, and the
> admin-enforcement posture.
>
> **Effort**: S (≤1 day to configure; ongoing per-checks).
> **Owner**: Director of Engineering.
> **Depends on**: M1 (CODEOWNERS defines who must approve), O1 (deploy
> workflow consumes branch protection state to gate deploys).
> **Unblocks**: O11 risk-classified review matrix; trustworthy
> `master` state for deploys.

---

## 1. Today's state (honest)

Per `docs/operations/ci-setup.md` (which exists), branch protection
configuration is "operator action — see docs/operations/ci-setup.md."
The actual repo settings have not been fully formalised:

- Force-push protection: unknown.
- Direct-push protection: convention.
- Required reviewers: 1 (convention).
- Required status checks: convention (PRs don't merge red, but red
  PRs can technically be merged via admin).
- Admin enforcement: off (admins can bypass; happens in practice).
- Linear history: off.
- Sign-off: not required.

This is the gap M2 closes.

---

## 2. Goals

1. **No direct pushes to `master`.** All changes via PR.
2. **No force pushes to `master`.** History is append-only.
3. **All required CI checks pass before merge.** Enumerated below.
4. **CODEOWNERS approval required.** Routes per M1.
5. **Admins included in restrictions.** No bypass without an
   auditable override.
6. **Linear history (squash-merge or rebase-merge).** Easier to
   bisect.
7. **Signed commits eventually.** Started as a soft requirement; hard
   in v2.

---

## 3. Branch protection rules — `master`

### 3.1 Required pull request reviews

```yaml
required_approving_review_count: 1     # general minimum (Medium-class)
dismiss_stale_reviews: true            # new commits invalidate prior approvals
require_code_owner_reviews: true       # M1 reviewers must approve
require_last_push_approval: true       # the latest commit must have approval
```

For High / Critical paths, M1's CODEOWNERS file forces additional
required reviewers. Combined with `require_code_owner_reviews`, the
effective minimum becomes 2-4 reviewers per the O11 matrix.

### 3.2 Required status checks

Must pass before merge:

```yaml
strict: true                            # branch must be up-to-date with master
contexts:
  # From .github/workflows/ci.yml
  - typescript (typecheck + test + check:all)
  - contracts (forge build + test)
  # Supply chain
  - pnpm-audit
  - codeql
  - secret-scan
  - dependency-review
  - contracts-static                    # Slither/Mythril
  # M-class
  - check-codeowners-coverage (M1)
  - check-coverage-thresholds (M4)
  - check-no-stale-flags (O10)
  - check-runbook-coverage (O7)
  - check-idempotency-coverage (DR7)
  - commitlint (M6)
```

A new required check is added by:
1. Wiring the check into a workflow.
2. Adding it to this rule.
3. Tagging it `required` via the repo settings.

### 3.3 Restrictions

```yaml
restrictions:
  users: []        # nobody can direct-push
  teams: []        # no team-bypass
  apps: []         # no app-bypass
allow_force_pushes: false
allow_deletions: false       # master cannot be deleted
required_linear_history: true # squash- or rebase-merge only
enforce_admins: true         # ADMINS INCLUDED in all the above
```

### 3.4 Signed commits

```yaml
required_signatures: false   # v1 — soft requirement
                              # v2 — flip to true once contributors are
                              # set up with GPG / sigstore
```

v1: signed commits are encouraged but not required. The DoE's commits
ARE always signed as a forcing function on tooling.

v2 timeline: 6 months from v1 launch. Sigstore (`gitsign`) is the
preferred path — short-lived keypairs via OIDC; no GPG-key management.

---

## 4. Branch protection rules — feature branches

Feature branches are unprotected by default. Authors can:
- Force-push (rebase + push).
- Delete the branch when done.
- Merge to their own feature branch.

The only protected branch is `master`.

For long-lived integration branches (rare; e.g. an active Spec 007
integration branch), per-branch protection rules can be applied. The
rules above are the template; copy and apply via the GitHub API.

---

## 5. Admin enforcement + override

`enforce_admins: true` means admins MUST follow the rules. A DoE
needing to bypass:

### 5.1 Documented break-glass

The DoE can temporarily disable `enforce_admins` via the repo settings
to merge an emergency-class PR. The action is:

1. DoE flags the PR with `emergency-bypass` label.
2. DoE disables `enforce_admins` (one click).
3. DoE merges the PR.
4. DoE re-enables `enforce_admins`.
5. CI workflow `.github/workflows/post-bypass-audit.yml` detects the
   merge-without-required-checks AND writes an audit row to the
   production audit chain (via the `auditAppend` shape in O11 §4.2).
6. The next CAB meeting reviews every `emergency-bypass`.

### 5.2 Lower-friction alternative

The CAB (O11) can pre-approve a class of bypass for specific recurring
needs (e.g. quarterly auto-generated dependency bump PRs that come
from dependabot). These are NOT bypasses — they're additional
CODEOWNERS rules that route dependabot PRs to a lighter review path.

---

## 6. Files to create/change

### New

- `.github/branch-protection.yaml` — declarative description (since
  GitHub doesn't expose protection rules in Git natively, this is for
  documentation + manual replay).
- `scripts/apply-branch-protection.sh` — uses GitHub API to apply the
  rules from the YAML. Idempotent.
- `.github/workflows/post-bypass-audit.yml` — detects bypass merges
  and writes the audit row.
- `docs/operations/branch-protection.md` — operator runbook for
  changing rules.

### Changed

- `docs/operations/ci-setup.md` — refer to the new branch-protection
  doc instead of being the source of truth.

---

## 7. Acceptance criteria

- [ ] `master` cannot be force-pushed (test: attempt `git push -f origin
      master` from a non-admin account; confirm rejection).
- [ ] `master` cannot be deleted.
- [ ] PR with red CI cannot be merged (test).
- [ ] PR without CODEOWNERS approval cannot be merged (test).
- [ ] PR without 1 general approval cannot be merged (test).
- [ ] Admins cannot bypass without disabling `enforce_admins`
      explicitly.
- [ ] Disabling `enforce_admins` and merging emits the audit row.
- [ ] `.github/branch-protection.yaml` matches actual rules (test:
      `scripts/apply-branch-protection.sh --check` returns 0).

---

## 8. Test plan

### 8.1 Setup verification

- Run `scripts/apply-branch-protection.sh` to write the rules.
- Run `scripts/apply-branch-protection.sh --check` to verify.
- Manually inspect via GitHub UI.

### 8.2 Negative tests

- `git push -f origin master` from a non-admin: rejected.
- Open a PR; deliberately fail typecheck; attempt to merge: refused.
- Open a PR touching `apps/a2a-agent/src/auth/`; have only a backend
  engineer approve; attempt to merge: refused.

### 8.3 Bypass test

- DoE simulates an emergency: disable `enforce_admins`; merge an
  emergency-labelled PR; re-enable.
- Confirm the post-bypass-audit workflow ran and wrote the audit row.

---

## 9. Cost

Free (GitHub feature included in Team plan).

---

## 10. Rollback

The rules can be relaxed via repo settings or the YAML. Don't,
without CAB approval (O11). Each relaxation makes the codebase less
trustworthy for the next deploy.

---

## 11. Open questions

- **OQ-M2-1**: Strict status checks (`strict: true` — branch must be
  up to date) increases rebase pressure on slow-moving PRs. Worth it?
  Proposed: yes — keeps CI signal meaningful. Slow-moving PRs are a
  signal of stale work; rebasing is cheap.
- **OQ-M2-2**: Squash vs rebase merge? Proposed: squash for general
  PRs (clean linear history); rebase for big feature branches where
  individual commits tell a story.
- **OQ-M2-3**: Should bots (dependabot) be in the restrictions list?
  Proposed: dependabot PRs go through the normal flow — CODEOWNERS
  for security team must approve dependency bumps per M7.
- **OQ-M2-4**: How do we handle the "I need to push a single typo
  fix" speed friction? Proposed: still requires a PR; the typo PR is
  trivially-approved. The friction is worth the auditability.
- **OQ-M2-5**: Production hotfix during an active P0 — wait for
  CODEOWNERS or self-approve? Proposed: never self-approve; reach a
  second human via PagerDuty escalation. If truly nobody is
  reachable, the bypass procedure (§5.1) exists.
