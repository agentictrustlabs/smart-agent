# R10 — Dependency Vulnerability Scanning

> **Effort**: S (3 days initial setup) + ongoing weekly review
> **Owner**: developer (initial setup) + infra (ongoing operations) +
> reviewer (security review of vulnerable-package PRs)
> **Status**: ready to assign
> **Dependencies**: none (independent of Spec 007)

## 1. Threat model

Modern apps pull in hundreds-to-thousands of transitive deps. Each is a
potential attack surface:

### 1.1 Vulnerability classes

1. **Known CVEs** — published vulnerabilities in libraries we use
   transitively (e.g. "package X v1.2.3 has remote-code-execution
   via crafted YAML"). These are catalogued in public databases (npm
   advisory, GitHub Advisory Database, OSV).
2. **Supply chain attacks** — a maintainer's account is compromised or
   they go rogue, and they ship a malicious version of an otherwise-
   trusted package (e.g. `event-stream` 2018, `colors.js` 2022,
   `xz-utils` 2024).
3. **Typosquats** — attacker publishes `recat`, `lodahs`, etc., hoping
   for a typo in `package.json`.
4. **Abandoned packages** — no maintainer = no patches = stale risk.
5. **License risk** — a transitive dep includes GPL code, threatening
   our license posture. (Not a vuln per se but tracked in this doc.)
6. **Solidity / Foundry deps** — `foundry-rs/forge-std`,
   `OpenZeppelin/openzeppelin-contracts`, `eth-infinitism/account-
   abstraction`. Less frequent updates but each version-bump
   potentially closes a security finding.

### 1.2 Current state

Our `git status` shows numerous modified files inside `packages/contracts/lib/`
— that's vendored Foundry deps in our submodules. We're tracking them
by git pin, not by automated upgrade.

`package.json` audit: not run today.

**No** automated dependency scanning today.

## 2. Design

### 2.1 Tool selection

| Tool | What it does | Cost | Coverage |
|------|--------------|------|----------|
| **`pnpm audit`** | Local + CI check against npm advisory DB | $0 | npm deps only |
| **GitHub Dependabot** | Daily PR per outdated/vulnerable dep | $0 | npm + GitHub Actions + Docker + Gradle + Maven; no Foundry-native support |
| **Socket.dev** | Supply-chain attack detection (heuristic — new maintainer, code patterns, suspicious post-install scripts) | $0 free tier (10 PRs/mo); $7/dev/mo | npm + pypi + ruby + go |
| **Snyk** | Deeper CVE coverage + container scanning | $0 free for OSS; $25/dev/mo for orgs | npm + containers + IaC |
| **Trivy** | Container + IaC scanner (filesystem mode for npm too) | $0 | container + IaC + npm |
| **`forge update`** | Manual; pinned by git tag | $0 | Foundry deps |
| **OSV-Scanner** (Google) | Reads `package-lock.yaml` + many ecosystems, queries OSV DB | $0 | all OSV-tracked, including Foundry git tags |

**Selected stack**:

1. `pnpm audit` (built-in; CI gate).
2. **Dependabot** (free; auto-PR; daily).
3. **Socket.dev** (free tier; supply-chain detection on PR).
4. **OSV-Scanner** (Foundry submodule coverage).
5. **Trivy** for container scans (when we Dockerize for prod).

Snyk considered and rejected for v1 — Dependabot + Socket.dev + OSV
cover the same ground at lower cost. Re-evaluate if we ever need SOC2.

### 2.2 Severity policy

Aligned with CVSS scores:

| Severity | Definition | SLA |
|----------|------------|-----|
| **Critical** | Active in-the-wild exploit OR CVSS ≥ 9.0 | Patch within **24 hours** (page on-call) |
| **High** | CVSS 7.0-8.9 | Patch within **1 week** |
| **Medium** | CVSS 4.0-6.9 | Patch within **1 month** |
| **Low** | CVSS < 4.0 | Backlog (review quarterly) |

Exceptions tracked in `docs/security/dep-waivers.md` (new) — each
waiver names the CVE, the rationale ("vulnerable function not in our
call graph"), and the expiry date.

### 2.3 Dependabot configuration

`.github/dependabot.yml` (new):

```yaml
version: 2
updates:
  # ─── npm packages ──────────────────────────────────────────────────
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "daily"
      time: "04:00"
      timezone: "Etc/UTC"
    open-pull-requests-limit: 10
    groups:
      patch-and-minor:
        update-types: ["minor", "patch"]
        # Group safe upgrades into one PR; majors get individual PRs.
      types-packages:
        patterns: ["@types/*"]
    versioning-strategy: "increase-if-necessary"
    labels: ["dependencies", "automated"]
    reviewers: ["smart-agent-team/maintainers"]
    commit-message:
      prefix: "chore(deps)"
      include: "scope"

  # ─── GitHub Actions ────────────────────────────────────────────────
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
    labels: ["dependencies", "ci"]

  # ─── Docker (when we Dockerize) ────────────────────────────────────
  # - package-ecosystem: "docker"
  #   directory: "/infra/docker"
  #   schedule:
  #     interval: "weekly"
```

### 2.4 pnpm audit + CI gate

`.github/workflows/security.yml` (new — or extend existing):

```yaml
name: security
on:
  pull_request:
  push:
    branches: [main, master]

jobs:
  pnpm-audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - name: Audit
        # `pnpm audit --audit-level=high` fails the build on high+.
        # Production deps only (skip devDeps to avoid noise).
        run: pnpm audit --audit-level=high --prod
      - name: Audit (dev, report only)
        run: pnpm audit --audit-level=high --dev || true

  osv-scanner:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with: { submodules: recursive }
      - name: Run OSV-Scanner
        uses: google/osv-scanner-action@v2
        with:
          scan-args: |
            --recursive
            --skip-git
            ./
      - name: Output to SARIF
        if: always()
        run: |
          osv-scanner --format sarif --output osv.sarif --recursive . || true
      - name: Upload SARIF to GitHub Code Scanning
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: osv.sarif
        if: always()

  trivy:
    runs-on: ubuntu-latest
    if: false   # Enable when we add a Dockerfile
    steps:
      - uses: actions/checkout@v5
      - run: trivy fs --severity HIGH,CRITICAL --exit-code 1 .
```

### 2.5 Socket.dev integration

GitHub App install at https://socket.dev/. Configuration via
`socket.yaml` at repo root:

```yaml
# socket.yaml
projectIgnorePaths:
  - packages/contracts/lib/**         # vendored Foundry deps
  - **/node_modules/**

issueRules:
  malware: error
  shellAccess: error
  envVars: error
  networkAccess: warn
  usesEval: warn
  filesystemAccess: warn
  hasNativeCode: warn
  installScripts: error
  obfuscatedFile: error
  unmaintained: warn
  troll: error
  typosquat: error
  newAuthor: warn
  longString: warn
```

Socket.dev comments on every PR that adds a dep. PR blocks on `error`-
classified issues.

### 2.6 Foundry submodules

The `packages/contracts/lib/` git submodules:

```
packages/contracts/lib/account-abstraction        eth-infinitism/account-abstraction
packages/contracts/lib/forge-std                  foundry-rs/forge-std
packages/contracts/lib/openzeppelin-contracts     OpenZeppelin/openzeppelin-contracts
```

Quarterly check-up (and on every security advisory):

1. `git submodule update --remote --recursive` to pull updates.
2. `forge test` to verify nothing broke.
3. `osv-scanner --recursive packages/contracts/lib/` confirms no
   known CVEs in the pinned versions.
4. Document the pin bump in `CHANGELOG.md` with rationale.

`scripts/check-submodule-staleness.sh` (new) — runs in CI; warns when
a submodule pin is more than 6 months behind upstream. Doesn't fail
the build (Foundry stability matters more than always-latest), but
emits a warning to the PR description.

### 2.7 SBOM generation

`pnpm sbom --format cyclonedx-json --output sbom.json` (post pnpm 10);
fallback to `@cyclonedx/cyclonedx-npm`. Generated on every release and
uploaded as a GitHub release asset.

SBOM enables external scanning by customers / auditors and is required
for SOC2 / CMMC.

### 2.8 Manual weekly review

A 30-minute calendared meeting (or async task per
`.claude/CLAUDE.md` task lifecycle):

- Triage open Dependabot PRs (merge or reject).
- Review Socket.dev findings.
- Check OSV-Scanner SARIF results in GitHub Code Scanning.
- Update `docs/security/dep-waivers.md`.
- Sweep `docs/security/runtime/R10-dep-vuln-log.md` (the running log).

### 2.9 Lockfile integrity

Currently we have `pnpm-lock.yaml`. CI must reject PRs that:

- Modify `pnpm-lock.yaml` without matching `package.json` changes
  (script: `scripts/check-lockfile-sync.sh`).
- Include packages from registries other than `https://registry.
  npmjs.org/` (custom registries are an exfil vector — see
  npmjs.org/security/typosquats).

## 3. Files to create / change

```
.github/
├── dependabot.yml                         NEW
└── workflows/
    └── security.yml                       NEW

socket.yaml                                NEW — Socket.dev config

scripts/
├── check-submodule-staleness.sh           NEW
├── check-lockfile-sync.sh                 NEW
└── generate-sbom.sh                       NEW

docs/security/
├── dep-waivers.md                         NEW — CVE waivers
├── runtime/
│   ├── R10-dep-vuln-log.md                NEW — running log
│   └── R10-foundry-pin-history.md         NEW — submodule bump history
└── compliance/
    └── sbom-template.json                 NEW — example
```

## 4. Implementation steps

| Day | Task |
|-----|------|
| 1 | Land `.github/dependabot.yml`; verify Dependabot opens PRs for stale deps; tune labels + reviewers. |
| 2 | Land `.github/workflows/security.yml` with pnpm-audit + OSV-Scanner. Install Socket.dev app. |
| 3 | Write the three scripts (submodule staleness, lockfile sync, sbom). Document weekly review in `docs/operations/dep-review.md`. |
| 4 | First manual triage pass: clear all existing high+ vulns. Establish baseline. |

## 5. Test plan

### 5.1 Verify each tool fires

- **Dependabot**: temporarily downgrade `viem` to an older version
  with a known advisory; push branch; expect Dependabot to open a PR.
- **pnpm audit**: same; expect CI to fail.
- **OSV-Scanner**: same; expect SARIF entry in GitHub Code Scanning.
- **Socket.dev**: add a known-malicious test package
  (`@socket.dev/test-malware-package`); expect comment on PR.

### 5.2 SLA-tracking dashboard

Grafana panel reads from GitHub Issues with `label:vulnerability`:

- Time-to-fix per severity.
- Open vs closed over time.
- SLA breaches highlighted.

### 5.3 Quarterly Foundry submodule check

Calendar event; output to `R10-foundry-pin-history.md`.

## 6. Acceptance criteria

- [ ] `.github/dependabot.yml` exists and Dependabot opens at least
      one test PR.
- [ ] `pnpm audit --audit-level=high --prod` in CI; currently zero
      high+ findings.
- [ ] OSV-Scanner runs in CI; SARIF appears in GitHub Code Scanning.
- [ ] Socket.dev app installed and commenting on PRs.
- [ ] Severity policy documented; first weekly review held; minutes in
      `R10-dep-vuln-log.md`.
- [ ] SBOM generation script works; one SBOM published to a tagged
      release as a smoke test.
- [ ] `scripts/check-submodule-staleness.sh` wired into CI as a warning.

## 7. Vendor references

- pnpm audit: https://pnpm.io/cli/audit
- GitHub Dependabot: https://docs.github.com/en/code-security/dependabot
- Dependabot configuration: https://docs.github.com/en/code-security/dependabot/dependabot-version-updates/configuration-options-for-the-dependabot.yml-file
- Socket.dev: https://docs.socket.dev/docs/github-integration
- OSV-Scanner: https://google.github.io/osv-scanner/
- OSV database: https://osv.dev/
- Trivy: https://aquasecurity.github.io/trivy/
- CycloneDX SBOM: https://cyclonedx.org/
- NIST CVSS: https://nvd.nist.gov/vuln-metrics/cvss
- npm security advisories: https://docs.npmjs.com/auditing-package-dependencies-for-security-vulnerabilities
- Foundry dependency management: https://book.getfoundry.sh/projects/dependencies

## 8. Open questions

- **OQ-R10-1**: Should Dependabot auto-merge patch updates? Safer
  posture: no — every dep update is a supply-chain risk surface.
  Proposal: manual review for everything; the daily PR queue is the
  cost of safety.
- **OQ-R10-2**: Snyk vs Socket.dev for supply-chain coverage? Socket
  is cheaper and focused on supply-chain attack detection; Snyk is
  broader but also focused on CVEs (already covered by Dependabot +
  OSV). Proposal: Socket.dev v1; reassess at SOC2 milestone.
- **OQ-R10-3**: Container scanning when? We don't ship Docker images
  today. When we do (per Spec 007 Phase F.2 dev tooling already
  proposes Postgres in Docker), Trivy fires on every image build.
- **OQ-R10-4**: Should Solidity-specific tools like Slither or Mythril
  be in this doc? They're complementary to dependency scanning but
  cover a different layer (smart-contract analysis). Proposal: track
  in `docs/security/smart-contracts/` (different doc tree).
- **OQ-R10-5**: Private packages in our pnpm workspace — do we trust
  them as much as third-party? Yes — same review process applies.
  Document in `docs/security/dep-waivers.md`.

## 9. Effort summary

| Stream | Days |
|--------|------|
| Tool setup (Dependabot, audit, OSV, Socket) | 1.5 |
| Scripts (submodule staleness, lockfile sync, SBOM) | 1 |
| Baseline triage of current vulns | 1 |
| Documentation + weekly review setup | 0.5 |
| Code review | 0.5 |
| **Total** | **4.5 days (S) + ongoing 30 min/week** |

## 10. Ongoing operating cost

| Activity | Frequency | Owner | Time |
|----------|-----------|-------|------|
| Triage Dependabot PRs | weekly | developer | 30 min |
| Review Socket.dev findings | weekly | developer | 10 min |
| Verify OSV scan SARIF | weekly | developer | 10 min |
| Foundry submodule bump check | quarterly | developer | 1 hour |
| Severity-policy review | annually | reviewer | 2 hours |
| SBOM publication | per release | infra | 5 min |
