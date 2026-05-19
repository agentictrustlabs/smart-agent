# M7 — Dependency Update Policy

> **Status**: DRAFT. **No formal dependency-update SLA today.**
> Updates happen when somebody notices a vulnerability or when a
> feature needs a newer version. Dependabot is set up but
> uncalibrated; PRs accumulate; major-version bumps aren't reviewed
> consistently.
>
> This document specifies the dependabot configuration, the per-severity
> patching SLA, the major-bump review process, and the deny-list for
> dependencies we won't add.
>
> **Effort**: S (≤1 day to configure; ongoing per-PR review).
> **Owner**: Security reviewer + Backend lead.
> **Depends on**: M1 (security reviewer on dependency PRs), M2 (branch
> protection enforces approvals).
> **Unblocks**: predictable patch latency; audit-ready dependency
> posture.

---

## 1. Today's state (honest)

- `package.json` has dependencies; `pnpm-lock.yaml` exists.
- `.github/workflows/pnpm-audit.yml` exists (referenced in `ci.yml`).
- `dependency-review` workflow exists.
- CodeQL workflow exists.
- Dependabot may or may not be enabled; no `.github/dependabot.yml`
  configuration visible.
- Major bumps require manual review; no documented process.
- No SLA for "how fast we patch a critical vulnerability."

This is the gap M7 closes.

---

## 2. Goals

1. **CVE patches land within SLA.** Critical ≤24 h; High ≤7 days;
   Medium ≤30 days; Low ≤90 days.
2. **Dependabot runs daily for security; weekly grouped for routine.**
   Avoids dependabot fatigue.
3. **Major bumps gated on architecture review.** Most-major versions
   change APIs; review before adoption.
4. **Deny-list for dependencies we won't add.** Substrate-independence
   (P1) implies avoiding certain SDKs.
5. **Visibility of supply-chain health.** Datadog or GitHub Insights
   dashboard.

---

## 3. Dependabot configuration

`.github/dependabot.yml`:

```yaml
version: 2
updates:
  # ─── Security updates: daily, individual PRs ─────────────────────
  # Daily check for SECURITY advisories on every dependency. Each
  # security advisory gets its own PR for fast cherry-pick.
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "daily"
    open-pull-requests-limit: 20
    labels:
      - "dependencies"
      - "security"
    target-branch: "master"
    versioning-strategy: "increase-if-necessary"
    allow:
      - dependency-type: "all"
    # Only security advisories are picked up here; the routine
    # grouped weekly run handles the rest.

  # ─── Routine: weekly, grouped ────────────────────────────────────
  # Weekly PR grouped by ecosystem to reduce noise.
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "06:00"
      timezone: "America/Los_Angeles"
    open-pull-requests-limit: 5
    labels:
      - "dependencies"
    target-branch: "master"
    groups:
      eslint-and-prettier:
        patterns:
          - "eslint*"
          - "prettier*"
          - "@typescript-eslint/*"
      vitest:
        patterns:
          - "vitest"
          - "@vitest/*"
      foundry-related:
        patterns:
          - "@nomicfoundation/*"
      patch-only:
        update-types:
          - "patch"
    ignore:
      # Major version bumps require manual review (architecture
      # implication); dependabot doesn't open PRs for them.
      - dependency-name: "*"
        update-types: ["version-update:semver-major"]

  # ─── GitHub Actions workflows ────────────────────────────────────
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
    labels:
      - "dependencies"
      - "ci"
    open-pull-requests-limit: 3

  # ─── Forge (Solidity) deps ───────────────────────────────────────
  # Foundry submodules are pinned; updates require manual review +
  # forge test + Slither. No automation.
```

---

## 4. Patching SLA

### 4.1 Severity definitions

Map CVE / GitHub advisory severities:

| Severity | Examples | SLA from disclosure → merged-to-master |
|---|---|---|
| **Critical** | RCE; auth bypass; key exposure | **24 hours** |
| **High** | Privilege escalation; DoS at scale | **7 days** |
| **Medium** | XSS in admin UI; partial info leak | **30 days** |
| **Low** | Reflected XSS in low-traffic path; informational | **90 days** |

### 4.2 Escalation

- If the SLA is at risk, the security reviewer escalates to DoE.
- A Critical SLA breach is itself a Sev-1 incident (we're knowingly
  shipping a known-vulnerable system).

### 4.3 Tracking

Every dependabot PR labeled `security` is auto-tracked in a
dashboard. Datadog or GitHub Insights surfaces:
- Open Critical PRs (count + age).
- Open High PRs (count + age).
- SLA-at-risk PRs (>50% of SLA elapsed).
- SLA-breached PRs (count).

---

## 5. Major-version review

### 5.1 Process

Major bumps (e.g. `viem 1.x → 2.x`, `next 14 → 15`) require:

1. The author manually opens a PR (dependabot ignores major bumps
   per §3).
2. PR includes a "Major Version Notes" section in the body:
   - Breaking changes in the new version.
   - Migration steps required.
   - Test coverage of the migration.
3. CODEOWNERS routes to `@smart-agent/architecture` per M1.
4. If the dep is on the deny-list (§6), the PR is rejected.

### 5.2 Cadence

- A bump that's been available <30 days: defer unless there's a
  specific reason. Lets the ecosystem shake out post-release issues.
- A bump that's been available 30-90 days: review for adoption.
- A bump that's been available >90 days AND the current version is
  EOL: prioritise.

---

## 6. Deny-list

Substrate-independence (P1) implies certain dependencies we won't
add. Listed for clarity:

| Dep | Reason | Reference |
|---|---|---|
| Any vendor lock-in for ERC-4337 (e.g. proprietary Safe SDK) | Substrate independence — we build our own contracts | `docs/architecture/principles.md` |
| Any closed-source signing service | KMS only via standard SDKs | K3 |
| Any non-OSS database driver | Postgres only via OSS drivers | Spec 007 F.2 |
| Any framework that takes ownership of routing AND data (e.g. all-in-one BaaS) | Architecture principles | `docs/architecture/principles.md` |

The deny-list itself lives in `.github/dependency-denylist.yaml` and
is checked by a CI guard.

### 6.1 Adding to the deny-list

CAB (O11) decision required to add or remove a dep from the deny-list.
Rationale logged in `docs/cab/`.

---

## 7. Supply-chain monitoring

Existing workflows (per Sprint-3 S3.5):
- `pnpm-audit.yml` — runs `pnpm audit` per PR.
- `codeql.yml` — CodeQL static analysis.
- `secret-scan.yml` — no leaked credentials.
- `dependency-review.yml` — incoming dep license + CVE check.
- `contracts-static.yml` — Slither + Mythril.

M7 adds:
- `osv-scanner.yml` (new) — OSV (Open Source Vulnerabilities)
  database scanner; catches advisories before they land in
  GitHub's advisory database. Runs daily on `master`.
- `dependency-denylist-check.yml` (new) — fails if a new dep matches
  the deny-list.

---

## 8. Manual review process for dependabot PRs

For non-major dependabot PRs:

1. CI runs (typecheck, test, check:all, supply-chain).
2. Security reviewer approves if:
   - The diff is what dependabot says it is (no surprise content).
   - The new version's changelog has been read.
   - For a security advisory: the advisory is real and the patch is
     correct.
3. Merge.

For grouped dependabot PRs (weekly bundle):

1. Same as above, but for ≥1 dep in the group.
2. If any one dep raises a concern, split the PR.

Approval cadence: same-day for Critical, within-week for routine.
Lagging PR queue = SLA breach.

---

## 9. Files to create/change

### New

- `.github/dependabot.yml`
- `.github/workflows/osv-scanner.yml`
- `.github/workflows/dependency-denylist-check.yml`
- `.github/dependency-denylist.yaml`
- `scripts/check-dependency-denylist.ts`
- `docs/runbooks/dependency-critical-cve.md` — runbook for a
  Critical CVE landing.
- `infra/datadog/dashboards/dependency-health.json`.

### Changed

- M1 CODEOWNERS — dependabot PRs auto-routed to `@smart-agent/security`
  (and `@smart-agent/contracts` for `packages/contracts/lib/` changes).

---

## 10. Acceptance criteria

- [ ] `.github/dependabot.yml` committed; first daily security run
      executes.
- [ ] First weekly grouped run produces grouped PRs.
- [ ] Deny-list file + CI guard active. Test: open a PR adding a
      deny-listed dep; confirm CI refuses.
- [ ] OSV-scanner workflow active.
- [ ] Dashboard live; SLA metrics visible.
- [ ] First Critical CVE that lands is patched within 24 h (record in
      `output/dependency-sla-YYYY-MM.md`).

---

## 11. Test plan

### 11.1 Dependabot exercise

- Wait for the first weekly run. Verify PRs are grouped per §3.
- Verify a major bump is NOT auto-PR'd.

### 11.2 Deny-list

- Open a PR adding a deny-listed dep. Confirm `dependency-denylist-
  check` fails.

### 11.3 SLA tracking

- Manually mark a dependabot PR as "Critical" (via label). Confirm
  the dashboard counts it. Manually delay merge by 25 h. Confirm
  SLA-breach alert fires.

---

## 12. Cost

| Item | Cost |
|---|---|
| Dependabot | $0 (GitHub feature) |
| OSV scanner | $0 (Google-hosted; OSS) |
| CodeQL | $0 (private repos free; OSS too) |
| Engineering | 1 dev-day for setup + ongoing review |

---

## 13. Rollback

Disabling dependabot is one config change. Don't. The cost of
NOT patching is a known-vulnerable system.

If dependabot becomes too noisy, tighten grouping rules (§3) or
extend the ignore list to truly-non-actionable dependencies (e.g.
pinned vendor dependencies).

---

## 14. Open questions

- **OQ-M7-1**: Does this apply to `packages/contracts/lib/` (Forge
  submodules)? Proposed: yes — but those updates are manual + require
  forge test + Slither. Dependabot doesn't handle Forge submodules.
- **OQ-M7-2**: Auto-merge for trivial patches? Proposed: NO. Even
  patches can be malicious (e.g. supply-chain compromise via owner
  takeover). Always human-eyed.
- **OQ-M7-3**: How do we handle a dep that's gone unmaintained
  (e.g. last release 2 years ago, no responses to issues)? Proposed:
  CAB-class decision to remove + replace. Track in
  `docs/security/external-dependencies/`.
- **OQ-M7-4**: Do we mirror critical deps to our own registry for
  supply-chain resilience? Proposed: not in v1; revisit if a
  registry-side incident affects us.
- **OQ-M7-5**: SBOM (Software Bill of Materials) generation? Proposed:
  yes — `pnpm` 9 supports SBOM via `pnpm cms`; generate on every
  release and attach to GitHub Release. Customer compliance asks for
  this.
