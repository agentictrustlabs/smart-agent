# ED3 — Supply Chain Security

> **Status**: Draft. Names the attack surface, the per-vector mitigations,
> the build-attestation strategy, and the detection / response wiring.
>
> **Effort**: M (initial integration) + L (ongoing monitoring + tuning).
>
> **Owner**: infra + security.
>
> **Reading time**: ~25 min.

---

## 1. Threat model

Smart Agent's npm dependency surface is ~3,053 packages (lockfile-derived
count). Solidity dependency surface adds another 4 direct libraries with
deep transitive trees. Build pipeline runs on GitHub Actions and deploys
through Vercel. The threats:

| # | Threat | Reference incident |
|---|---|---|
| T1 | **Malicious package version published** to a legitimate name | event-stream/flatmap-stream Nov 2018; colors.js / faker.js Jan 2022 |
| T2 | **Typosquat / dependency confusion** | `node-ipc` protestware Mar 2022; npm dependency-confusion research |
| T3 | **Maintainer account compromise** | ua-parser-js Oct 2021 |
| T4 | **Compromised CI build secrets** (post-build injection) | Codecov bash uploader Apr 2021 |
| T5 | **Compromised build dependency** (`@types/*`, `eslint-plugin-*`) | esbuild plugins, postinstall hooks history |
| T6 | **Compromised release process** (sigstore-less artifacts) | various Solidity tooling forks |
| T7 | **Foundry / Solidity dep compromise** | hypothetical — limited public precedent but high blast radius |
| T8 | **Compromise of one of OUR packages we publish** | n/a — we publish nothing public-facing yet, but ED3 prepares for that |
| T9 | **Tooling registry compromise** (npm registry itself, GH Actions runners) | npmjs.org incidents 2022; Solarwinds 2020 |
| T10 | **AI-coding-tool injection of malicious code** | growing surface; Cursor / Copilot / Claude Code training-data poisoning research |

NIST SP 800-218 SSDF (Practice PO.3 and PW.4) is our reference framework
for supply-chain controls.

## 2. Defense in depth

The controls form a layered defense. No single control is load-bearing.

| Layer | Control | Threats addressed |
|---|---|---|
| **L1 — pin everything** | `pnpm-lock.yaml` committed, `--frozen-lockfile` in CI, no `^` / `~` range floats unwittingly | T1, T2, T3 |
| **L2 — verify provenance** | npm package provenance enforced for packages that support it; sigstore signatures verified | T1, T3, T6 |
| **L3 — detect runtime threat** | Socket.dev runtime detection on every install + PR | T1, T2, T3, T5 |
| **L4 — review human-readable patch** | dependabot / renovate PR review by humans for any version bump on a Tier 1 dep | T1, T3, T5 |
| **L5 — minimise blast radius** | tight Vercel OIDC IAM scopes; no long-lived secrets in CI; KMS-only access from runtime | T4, T9 |
| **L6 — build attestation** | Vercel build provenance attestation; Foundry forge build attestation; SLSA Level 3 target | T4, T6, T9 |
| **L7 — periodic dep audit** | quarterly manual review of Tier 1 deps' security posture | T7, T10 |
| **L8 — first-party signing** | when we publish, sigstore-sign our packages so consumers can verify upstream | T8 |
| **L9 — vuln scanning feed** | Grype on the SBOM (ED1 §9) | all (after CVE disclosure) |

## 3. L1 — Lockfile hygiene

### 3.1 Committed lockfile

Verify: `pnpm-lock.yaml` is present at repository root (✅ confirmed,
9,650 lines / 3,053 package entries as of 2026-05-18).

### 3.2 Frozen install in CI

`[OWE-REVIEWER]` — every GH Actions workflow MUST run:

```yaml
- run: pnpm install --frozen-lockfile
```

A CI guard (`scripts/check-ci-frozen-lockfile.sh`, NEW) greps the
workflows directory and rejects any install step that lacks the flag.

### 3.3 Lockfile-audit on every PR

GH Actions workflow `lockfile-audit.yml` (NEW):
- On every PR that modifies `pnpm-lock.yaml`, run `pnpm audit --audit-level high`.
- Fails on any High / Critical advisory.
- Posts an inline PR comment with the changed package list (diff against base).

### 3.4 Float prevention

Engineering norm — no `^X.Y.Z` in `dependencies` unless waivered:

- Default `pnpm install <package>` is configured (via `.npmrc`
  `save-prefix=""`) to write exact versions.
- A CI guard (`scripts/check-no-float-versions.ts`, NEW) parses every
  `package.json` and fails if any non-dev dependency uses `^` or `~`.
- Justified exceptions go in `.float-exceptions.json`.

`[OPEN] ED3-1`: Pin dev-deps strictly too? Pros: reproducibility; Cons:
maintenance burden on minor versions. Defer to a developer-experience
review.

## 4. L2 — npm provenance

npm publish provenance launched April 2023:
- Source repo + commit + build instructions signed in the package
  manifest.
- Sigstore Rekor transparency log.
- Verifiable via `npm audit signatures`.

### 4.1 Verification on install

Add to CI:

```yaml
- run: pnpm audit signatures
  continue-on-error: true   # signal-only initially; promote to fail after baseline
```

Currently a minority of npm packages publish provenance — `viem`, `next`,
and most large modern packages do. `continue-on-error: true` initially
because failing on packages that simply haven't enabled provenance yet
is too aggressive.

`[OWE-REVIEWER]` — quarterly review: count how many of our top-50 deps
publish provenance. Push for adoption upstream.

### 4.2 Provenance enforcement policy

Once > 80% of top-100 deps publish provenance, promote `continue-on-error`
to `false`. Estimated date based on industry adoption curve: 2027 Q1.

### 4.3 npm publish for OUR packages

When we publish (currently only workspace packages; first public release
TBD):

```json
// package.json
"publishConfig": {
  "provenance": true
}
```

And in the publish workflow:

```yaml
- run: pnpm publish --provenance --access public
```

`[DECISION]` — every public Smart Agent package publishes with
provenance. Verified by CI in the publish workflow.

## 5. L3 — Socket.dev runtime detection

Socket.dev <https://socket.dev> analyses every npm package for malicious
behaviour (post-install scripts, network calls, filesystem access,
obfuscated code) and flags suspicious changes.

### 5.1 Integration

- GitHub App installation on the repo.
- Socket comments on every PR that touches `pnpm-lock.yaml` with the
  per-package risk delta.
- Blocking severities (Critical / High supply-chain risk) configured as
  required status checks on protected branches.

### 5.2 Cost

- Free tier supports our repo size for now.
- Paid tier (~$50/mo) adds private slice queries + Slack integration.
- Adopt paid tier once we're at 5+ engineers actively touching deps
  weekly.

### 5.3 Alternative — Snyk

Snyk has overlapping capability (with stronger CVE coverage) but Socket
is purpose-built for supply-chain *behavioural* detection, which is the
gap we're filling here. Snyk's CVE coverage is filled by Grype (ED1 §9).

## 6. L4 — Human review of bumps

### 6.1 Dependabot configuration

`.github/dependabot.yml` (NEW):

```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
    open-pull-requests-limit: 10
    labels: ["deps", "dependabot"]
    groups:
      dev-dependencies:
        dependency-type: "development"
      tier-1-runtime:
        patterns:
          - "viem"
          - "@noble/*"
          - "next"
          - "hono"
          - "drizzle-orm"
          - "@aws-sdk/*"
          - "@google-cloud/*"
```

### 6.2 Review policy

| Dep class | Reviewer | Merge gate |
|---|---|---|
| **Tier 1 runtime** (viem, noble, next, hono, drizzle-orm, AWS/GCP SDKs) | security + developer | Manual approval after release-notes review |
| **Other runtime** | developer | CI green + 24-hr soak on preview |
| **Dev deps** | developer | CI green |
| **Patch versions** (everything) | bot-auto-merge after CI + Socket green | n/a |

The CODEOWNERS file (NEW) routes `package.json` + `pnpm-lock.yaml` PRs to
the security team automatically.

## 7. L5 — Build secret minimisation

We have already eliminated most long-lived secrets via the KMS initiative
(see `project_kms_initiative` memory). The supply-chain-relevant
consequences:

- **No `AWS_ACCESS_KEY_ID` in GH Actions or Vercel env**: federated via
  OIDC; short-lived tokens only.
- **No `GOOGLE_APPLICATION_CREDENTIALS` or service-account JSON** in
  the same path.
- **No master signer / bundler signer / sessionIssuer private keys** in
  any env (refused at boot per K0-K7 + Sprint 5 hardening).
- **GitHub Actions OIDC** federates to KMS roles for any short-lived
  signing in CI.
- **npm publish token** (if/when we publish) — fine-grained, time-bound,
  rotated quarterly.

A compromised CI build *cannot* exfiltrate runtime keys because runtime
keys aren't in CI's reach.

## 8. L6 — Build attestation

### 8.1 GitHub Artifact Attestations

GitHub now natively supports build attestations (since 2024):
<https://docs.github.com/en/actions/security-guides/using-artifact-attestations-to-establish-provenance-for-builds>.

Wiring:

```yaml
permissions:
  id-token: write
  contents: read
  attestations: write

steps:
  - uses: actions/attest-build-provenance@v1
    with:
      subject-path: 'apps/web/.next/**/*.js'
```

Generates a signed SLSA provenance statement bound to the workflow run.

### 8.2 Vercel build attestation

Vercel has its own build provenance (per their security FAQ). We confirm
the attestation is published per deploy.

`[OWE-REVIEWER]` — quarterly: pull the Vercel build attestation for the
current production deploy and archive in `docs/security/sboms/attestations/`.

### 8.3 Foundry build attestation

Foundry compilations are reproducible given pinned solc + lib SHAs. We:

- Pin the solc version in `foundry.toml` (already done — version 0.8.28).
- Pin all submodules in `packages/contracts/lib/` to specific git SHAs
  (already done; verify in CI).
- Generate a Foundry build manifest at release time:
  `forge build --json > docs/security/sboms/<sha>.foundry-build.json`.
- The manifest includes per-contract bytecode hash + source hash, signed
  via GitHub Artifact Attestations.

### 8.4 SLSA target

`[DECISION]` — target SLSA Level 3 (<https://slsa.dev/spec/v1.0/levels#level-3>):

- L1: provenance exists (✅ via GH attestations)
- L2: provenance signed (✅ via sigstore inside GH attestations)
- L3: hardened build platform; build run in non-interactive isolated
  environments; non-tamperable provenance generation (✅ via GH Actions
  with the attestation action)
- L4 (informational only; full reproducibility): out of scope for v1

## 9. L7 — Quarterly dep audit

Quarterly task assigned to security:

1. Top-50 deps by transitive usage count.
2. For each: verify maintainer is still active (recent commits), check
   for governance changes (new maintainers, transferred ownership),
   review GitHub issues for security-flavoured discussion.
3. File a `dep-audit-<YYYY-QQ>.md` write-up.
4. Action items: bump, replace, fork, vendor (in the substrate-
   independence sense).

`[OWE-REVIEWER]` — schedule lives in
`docs/security/external-dependencies/audits/SCHEDULE.md`.

## 10. L8 — First-party signing

When we publish public packages (timeline: spec 007 wraps + we open
substrate to integration partners), every release is signed:

- npm provenance enabled (§4.3).
- GitHub Artifact Attestations on the release tag.
- Sigstore signature on the published tarball, verifiable via
  `cosign verify-blob`.
- Public key material rotated annually.

Consumers verify with:

```bash
# Verify npm provenance
npm audit signatures

# Verify our cosign signature
cosign verify-blob \
  --certificate-identity-regexp "https://github.com/smart-agent/.*" \
  --signature smart-agent-sdk-1.0.0.tgz.sig \
  --certificate smart-agent-sdk-1.0.0.tgz.crt \
  smart-agent-sdk-1.0.0.tgz
```

## 11. L9 — Vuln scanning feed

Already specified in ED1 §9 — Grype on the SBOM, daily cron, fail-CI on
High/Critical. Not duplicated here; cross-reference only.

## 12. T7 — Foundry / Solidity-specific controls

The Solidity dep surface is smaller (4 direct libs) but the blast radius
is higher (compromised library means compromised contracts at deploy).

### 12.1 Pin to SHA, not version

All `packages/contracts/lib/*` are git submodules pinned to specific
SHAs. Re-pinning requires a PR; the PR reviewer must:

- Read the upstream changelog between old SHA and new SHA.
- Skim the diff for anything that looks like authority surface or
  validation bypass.
- Confirm the SC1 audit firm (if engaged) is OK with the bump.

### 12.2 Compile-time verification

`forge build` in CI verifies bytecode is reproducible from source. Any
deviation between local + CI bytecode is a fatal CI failure (currently
not wired; gap noted below).

`[OWE-REVIEWER]` — add `forge build --check-output-hash` (or equivalent;
verify Foundry has this) to CI.

### 12.3 No remote compilation

`solc` is the compiler used; not `solcjs` (which would download
JavaScript at compile time). Foundry's solc binary is pinned via
`foundry.toml`.

### 12.4 Deploy-time signing

Contract deployments are signed by the deployer EOA (eventually replaced
by the KMS-backed signer per spec 007 Phase A.5). The deployment
artefacts (address + bytecode hash + constructor args) are archived per
release in `docs/security/sboms/deployments/<chain>-<sha>.json`.

## 13. T10 — AI-coding-tool considerations

Increasingly, code is suggested by AI tools (Cursor, Claude Code, Copilot).

`[DECISION]` — current policy:

- Every AI-suggested change is reviewed by a human before commit.
- AI tools never have direct access to runtime secrets.
- AI tools never commit to `master` without human sign-off.
- The standard PR review process catches AI-introduced supply-chain
  surface (e.g. an AI suggesting a new dep).

`[OPEN] ED3-2`: Do we adopt a stricter AI-coding hygiene policy
(`AI_USED` commit trailer, audit log of AI-touched files)? Defer to a
developer-experience + security joint review; not load-bearing for v1
because the standard review process catches issues.

## 14. Detection wiring

The detection rules below land in Datadog Security per A3:

| Rule | Source | Detection |
|---|---|---|
| RULE-A3-SUPPLY-01 | `pnpm-lock.yaml` modification outside the dependabot bot identity | unusual lockfile edit |
| RULE-A3-SUPPLY-02 | Socket.dev critical-severity webhook | malicious package detected |
| RULE-A3-SUPPLY-03 | npm registry tarball hash mismatch (post-install verification) | tampered package |
| RULE-A3-SUPPLY-04 | GH Action artifact attestation verification failure on PROD deploy | broken build chain |
| RULE-A3-SUPPLY-05 | Daily Grype scan finds new Critical CVE | known-vuln dependency |

## 15. Response wiring

| Scenario | Runbook |
|---|---|
| Socket flags a critical malicious package | revert the PR; investigate transitive impact; quarantine via `.npmrc` if necessary; A6 §1 (key compromise) escalation if there's evidence of exfil |
| Grype flags a Critical CVE in production dependency | hotfix path; if no patch available, accept risk in `docs/security/sboms/exceptions.md` with reviewer sign-off |
| Build attestation verification fails | block deploy; investigate the build pipeline; A6 §1 escalation if attestation was forged rather than missing |
| Unusual lockfile change outside dependabot | review the PR; revert if unauthorised |

## 16. Cost

| Component | Cost |
|---|---|
| Socket.dev (free tier initially; paid $50/mo at scale) | $0–$50/mo |
| Sigstore / cosign (CLI; verification cost is local) | $0 |
| GH Artifact Attestations (included in GH Actions) | $0 |
| Grype + Syft (covered in ED1) | $0 |
| Dependabot + Socket review overhead (dev time) | ~1 hr/wk security review |
| Quarterly dep audit (security time) | ~1 day/qtr |
| **Total recurring** | **~$50/mo + ~5 hr/mo internal effort** |

## 17. Cross-references

- ED1 — SBOM is the inventory ED3 controls operate over
- ED2 — vendor tier informs the review depth in §6
- ED4 — license compliance is a separate check on the same dep flow
- ED5 — sub-processor DPA is the contractual side
- A3 RULE-A3-SUPPLY-* — detection wiring
- A6 §1 — incident response for supply-chain-originated compromise
- R10 — runtime dependency vuln scanning (substantial overlap with §11;
  R10 is the *runtime* posture, ED3 is the *build-time + supply-chain*
  posture; the docs cross-reference and avoid duplicate effort)

`[OWE-REVIEWER]` — coordinate R10 + ED3 § overlap; R10 owns "what
attackers do post-install"; ED3 owns "what attackers do pre-install + at
build". One PR can re-base the overlapping section once both docs land.

## 18. Implementation tasks

| # | Task | Owner | Effort |
|---|---|---|---|
| ED3-T1 | `scripts/check-ci-frozen-lockfile.sh` + CI guard | infra | S |
| ED3-T2 | `scripts/check-no-float-versions.ts` + CI guard | developer | S |
| ED3-T3 | `lockfile-audit.yml` GH Action | infra | S |
| ED3-T4 | `pnpm audit signatures` step in CI (continue-on-error initially) | infra | S |
| ED3-T5 | Socket.dev integration (GitHub App + protected-branch check) | security + infra | S |
| ED3-T6 | `.github/dependabot.yml` per §6.1 | infra | S |
| ED3-T7 | CODEOWNERS file routing dep PRs to security | infra | S |
| ED3-T8 | GH Artifact Attestations on production builds | infra | M |
| ED3-T9 | Foundry build manifest + attestation generation | developer + infra | M |
| ED3-T10 | Quarterly dep-audit schedule + first audit | security | M |
| ED3-T11 | `.float-exceptions.json` with current state + cleanup PRs | developer | M |
| ED3-T12 | A3 detection rules RULE-A3-SUPPLY-* deployed | security + infra | S |

## 19. Acceptance criteria

- [ ] `pnpm-lock.yaml` committed; CI guard verifies `--frozen-lockfile`
- [ ] Socket.dev posting on every dep PR
- [ ] Dependabot weekly PR cadence active
- [ ] CODEOWNERS routes dep PRs to security
- [ ] GH Artifact Attestation generated on every production build; verified
- [ ] First quarterly dep audit complete
- [ ] `.well-known/sub-processors.json` (ED2 §5) + SBOM (ED1) + attestation
      together compose the customer-facing supply-chain story
- [ ] A3 supply-chain detection rules deployed

## 20. Open questions

- `[OPEN] ED3-1`: Pin dev-deps too? (§3.4)
- `[OPEN] ED3-2`: AI-coding hygiene policy stricter than baseline? (§13)
- `[OPEN] ED3-3`: Do we adopt `npm-package-arg`-style integrity hash
  verification on top of pnpm's lockfile? pnpm's lockfile already
  contains integrity hashes; the addition would be a CI step that
  refuses installs if the lockfile's hashes don't match what npm registry
  serves. Probably yes; small effort. Add to next sprint.
- `[OPEN] ED3-4`: SLSA L4 (full reproducibility) — defer indefinitely;
  diminishing returns over L3.

## 21. Glossary

- **SLSA** — Supply-chain Levels for Software Artifacts.
  <https://slsa.dev>.
- **Sigstore** — open-source signing infrastructure (cosign, fulcio,
  rekor).
- **npm provenance** — npm-side adoption of build-attestation tied to
  the source repo + workflow.
- **Lockfile** — `pnpm-lock.yaml`; exact version + integrity-hash record.
- **Float** — semver `^X.Y.Z` or `~X.Y.Z` ranges that allow automatic
  upgrade on install.
- **Build attestation** — signed statement of "this artifact was built
  by this workflow from this source at this time".
- **VEX** — Vulnerability Exploitability eXchange (ED1 §11.3).

---

*Last updated: 2026-05-18. Owner: Infra agent + Security agent.*
