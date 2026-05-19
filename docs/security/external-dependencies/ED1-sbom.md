# ED1 — Software Bill of Materials (SBOM)

> **Status**: Draft. Names format choices, generation tooling, storage
> location, customer-facing URL, and the vulnerability-scan feed
> consumer.
>
> **Effort**: S (setup) + ongoing (per-release update).
>
> **Owner**: infra.
>
> **Reading time**: ~15 min.

---

## 1. Why SBOM

A Software Bill of Materials is the structured inventory of every
third-party component in our shipped software. Required by:

- **EO 14028** for federal vendors (we comply proactively).
- **CISA Minimum Elements** for the responsible-disclosure ecosystem.
- **SOC 2 Type II** Common Criterion CC6.1 (logical access)
  documentation evidence.
- Modern enterprise security RFPs uniformly require an SBOM URL.
- Vulnerability scanning (e.g. Grype, Trivy) feeds directly from SBOM.

Without one we cannot answer the basic question: *"Are we affected by
CVE-2026-XXXX in package Y@Z?"*

## 2. Scope

Sources to inventory:

| Surface | Tool | Format | Update cadence |
|---|---|---|---|
| **npm dependencies** (root `pnpm-lock.yaml`, ~3,053 packages) | `cyclonedx-bom-pnpm` (CycloneDX) + `syft` (SPDX) | both | every release |
| **Solidity contracts deps** (Foundry — `packages/contracts/lib/`) | custom SPDX emitter (no standard tool yet) | SPDX | every release |
| **Docker images** (when added — not currently used in prod) | `syft` | both | per image build |
| **System packages** (Vercel runtime — managed by Vercel; SBOM provided by Vercel) | Vercel attestation | provider-supplied | per deploy |
| **First-party packages** (our own `packages/*`) | listed as "first-party" in our SBOM, not as deps | both | every release |

`[OWE-REVIEWER]` — Vercel attestation: confirm Vercel publishes an
attestation for the runtime image; if not, we ship our own runtime
SBOM with the build pipeline.

## 3. CISA Minimum Elements compliance

Each SBOM entry MUST carry these seven fields per CISA:

| # | Field | SPDX 2.3 mapping | CycloneDX 1.5 mapping |
|---|---|---|---|
| 1 | Author of the SBOM | `Creator` field | `metadata.authors` |
| 2 | Component name | `PackageName` | `component.name` |
| 3 | Version of the component | `PackageVersion` | `component.version` |
| 4 | Supplier name | `PackageSupplier` | `component.supplier` |
| 5 | Dependency relationship | `Relationship` (DEPENDS_ON) | `dependencies[]` graph |
| 6 | Unique identifier | `PackageDownloadLocation` + `purl` | `component.purl` |
| 7 | Timestamp | `Created` (in CreationInfo) | `metadata.timestamp` |

Both formats are generated; tooling and customers differ in their
preferences. Costless to ship both.

## 4. Format choice

`[DECISION]` — we publish both **SPDX 2.3** and **CycloneDX 1.5**, on
the same cadence, for the same artefacts. Reasoning:

- SPDX is the original (Linux Foundation, 2010); broader enterprise
  adoption; ISO/IEC 5962:2021 standardised.
- CycloneDX (OWASP, 2018) has richer security metadata (VEX,
  vulnerability statements, formulation/attestation).
- Most downstream tools (Grype, Trivy, Dependency-Track) accept either.
- Generation cost is ~30 s each; storage cost is negligible.

## 5. Tooling

### 5.1 Anchore Syft (for SPDX)

- Tool: `syft` <https://github.com/anchore/syft>
- Pinned version: `0.108.0` (2026-05 LTS; reviewed every 6 months).
- Invocation:
  ```bash
  syft \
    /home/barb/smart-agent \
    --output spdx-json=docs/security/sboms/<git-sha>.spdx.json \
    --source-name smart-agent \
    --source-version $(git rev-parse HEAD)
  ```
- Handles npm + (with caveats) Solidity sources.

### 5.2 CycloneDX-bom-pnpm (for CycloneDX, npm)

- Tool: `@cyclonedx/cyclonedx-npm` (pnpm-aware variant in fork)
- Pinned version: `1.19.0`.
- Invocation:
  ```bash
  pnpm dlx @cyclonedx/cyclonedx-npm \
    --package-lock-only \
    --output-file docs/security/sboms/<git-sha>.cdx.json
  ```

### 5.3 Custom Foundry SPDX emitter

Foundry has no canonical SBOM tool. We implement a minimal emitter:

```typescript
// scripts/generate-foundry-sbom.ts (NEW)
// Walks packages/contracts/lib/* — each is a git submodule with its own
// upstream URL. Emits SPDX 2.3 entries for each library + version.
```

The lib directory currently contains:
- `account-abstraction` (eth-infinitism)
- `forge-std` (foundry-rs)
- `openzeppelin-contracts` (OpenZeppelin)
- (plus nested forge-std under openzeppelin)

Each is resolved to its pinned git SHA via `git -C <lib> rev-parse HEAD`
and emitted as a single SBOM entry per direct lib.

### 5.4 Validation

Every generated SBOM is validated against the canonical schema:

- SPDX: <https://spdx.github.io/spdx-spec/v2.3/> JSON schema.
- CycloneDX: <https://cyclonedx.org/docs/1.5/json/> JSON schema.

CI step: `pnpm dlx ajv-cli validate -s <schema-url> -d <sbom-file>`.

## 6. Storage

```
docs/security/sboms/
├── README.md                          (this directory's index)
├── 2026-05-18-c8d7052.spdx.json       (per release; format: <date>-<sha>.spdx.json)
├── 2026-05-18-c8d7052.cdx.json
├── 2026-05-18-c8d7052.foundry.spdx.json
└── current.json                        (symlink to most recent main SBOM, regenerated by CI)
```

`current.json` is the file served at the customer-facing URL (§7).

## 7. Customer-facing SBOM URL

`[DECISION]` — publish at `https://smart-agent.io/.well-known/sbom.json`
(CycloneDX) and `https://smart-agent.io/.well-known/sbom.spdx.json`
(SPDX). The `.well-known/` prefix follows RFC 8615 conventions for
discoverable service metadata.

Implementation:
- Next.js static file under `apps/web/public/.well-known/sbom*.json`.
- Symlinked from `docs/security/sboms/current.json` at build time.
- Updated on every merge to `master`.
- Served with `Cache-Control: public, max-age=3600` (1 hr) — frequent
  enough to surface a new release within a deploy window.

Bonus discoverability:
- HTTP response header `X-SBOM: /.well-known/sbom.json` on every page
  (one CDN rule).
- `<link rel="sbom" href="/.well-known/sbom.json">` in the HTML `<head>`
  (proposed conventional discovery; not yet a finalised standard but
  zero cost).

## 8. Update cadence

| Trigger | Action |
|---|---|
| Merge to `master` | CI generates new SBOMs; updates `current.json` symlink |
| Tagged release (`v*.*.*`) | CI generates an immutable SBOM copy at `docs/security/sboms/<tag>.spdx.json` |
| Manual `pnpm sbom` | Developer can regenerate locally; output matches CI to the byte |

Each SBOM contains:
- The git SHA the SBOM was built from.
- The build timestamp (UTC).
- The build platform (CI runner OS + Node version).
- The toolchain version (Syft / CycloneDX / Node / pnpm).

## 9. Vulnerability scanning feed

SBOM is half the value; the other half is feeding it into a vuln scanner.

### 9.1 Tool — Grype

- `grype <sbom-file>` reads CycloneDX or SPDX directly.
- Pinned version `0.83.0`.
- Pulls from the Anchore vulnerability database (Anchore's open feed,
  free, updated daily).

### 9.2 CI invocation

```bash
# .github/workflows/sbom-vuln-scan.yml (NEW)
- name: Scan latest SBOM
  run: |
    grype sbom:docs/security/sboms/current.json \
      --fail-on high \
      --output table > sbom-vuln-report.txt
    cat sbom-vuln-report.txt
```

Severity policy:
- **Critical / High** — fail CI; require a fix or a documented exception
  in `docs/security/sboms/exceptions.md`.
- **Medium** — file a GitHub issue auto-tagged `vuln:medium`; do not
  fail CI but escalate within a sprint.
- **Low / Negligible** — quarterly batch review.

### 9.3 Cadence

- On every PR (against current main branch SBOM).
- Daily scheduled scan against the same SBOM (catches newly-published
  CVEs against unchanged dependencies — the most common path to
  "yesterday-OK, today-vulnerable").

### 9.4 Alternatives evaluated

- **Trivy** (Aqua Security) — also free, comparable feature set. Either
  works; chose Grype for tighter alignment with Syft (same vendor).
- **Snyk** — commercial; richer enterprise features but per-developer
  pricing. Re-evaluate when company hits 20+ devs.
- **GitHub Dependabot Alerts** — kept *in addition to* Grype; Dependabot
  is best-in-class for known-CVE-to-dep mapping in the npm ecosystem.
  No-cost. Re-evaluate the overlap quarterly.

## 10. Cost

| Component | Cost |
|---|---|
| Syft + Grype | $0 (open source) |
| CycloneDX-bom-pnpm | $0 |
| Custom Foundry emitter | one-time dev cost ~1 day |
| CI runner minutes (per release SBOM scan + daily scan ≈ 10 min/day) | ~$0.50/mo on GH Actions |
| Storage of historical SBOMs (~50 KB each × 100 releases/yr) | negligible |
| **Total recurring** | **~$1/mo** |

`[COST]` — cheapest, highest-leverage doc in this directory.

## 11. Customer requests we routinely receive

### 11.1 "Provide an SBOM"

Answer: <https://smart-agent.io/.well-known/sbom.json> (CycloneDX) or
`.spdx.json` (SPDX). Both updated within 1 hr of every production
deploy.

### 11.2 "Are you affected by CVE-XXXX-YYYY?"

Answer:
1. SBOM is the inventory.
2. We grep CVE → CPE → package via the standard NVD mapping (or just
   open the latest Grype report).
3. If yes: timeline for patch.
4. If no: cite specific package list confirming absence.

The standard turnaround is 24 hr for confirmation, 7 days for any
required patch — committed in the customer-facing security FAQ.

### 11.3 "VEX statements?"

VEX (Vulnerability Exploitability eXchange) is the structured way to say
"we have CVE-X in component Y but it is not exploitable in our context."

`[OPEN] ED1-1` — VEX adoption decision: we don't generate VEX statements
in v1 because every "not-exploitable" claim requires a security review.
Revisit when we have ≥ 5 quarterly "yes / dependency / not exploitable"
findings, each of which would justify a VEX statement.

## 12. Implementation tasks

| # | Task | Owner | Effort |
|---|---|---|---|
| ED1-T1 | `pnpm sbom` script in root package.json | infra | S |
| ED1-T2 | `scripts/generate-foundry-sbom.ts` | infra | S |
| ED1-T3 | GH Actions workflow `sbom-on-merge.yml` | infra | S |
| ED1-T4 | GH Actions workflow `sbom-vuln-scan.yml` (daily cron + PR) | infra | S |
| ED1-T5 | `apps/web/public/.well-known/sbom.json` route + symlink wiring | developer + infra | S |
| ED1-T6 | `docs/security/sboms/README.md` + `exceptions.md` skeleton | security | S |
| ED1-T7 | Customer security FAQ entry citing the SBOM URL | comms + security | S |

## 13. Acceptance criteria

- [ ] Both SBOMs generated on merge to `master`
- [ ] Grype scan green on master (no Critical / High unaddressed)
- [ ] `https://smart-agent.io/.well-known/sbom.json` returns a valid
      CycloneDX document
- [ ] `https://smart-agent.io/.well-known/sbom.spdx.json` returns a valid
      SPDX document
- [ ] SBOM contains all 7 CISA Minimum Elements per entry
- [ ] Daily scheduled scan creates an issue on a newly-published Critical
      CVE
- [ ] Customer security FAQ links to the SBOM URL

## 14. Open questions

- `[OPEN] ED1-1`: VEX adoption (see §11.3).
- `[OPEN] ED1-2`: Should we sign SBOMs (sigstore cosign)? Adds
  authenticity but ~5 min build cost. Defer to ED3.
- `[OPEN] ED1-3`: SBOM diffing — surface "what changed since last
  release" as a customer-facing artefact? Cheap; add when first customer
  asks.

## 15. Cross-references

- ED2 — vendor inventory is partly derived from the SBOM (every supplier
  in the SBOM is a candidate vendor for ED2's risk tier).
- ED3 — supply-chain detective controls feed off the SBOM.
- ED4 — license metadata is one column of every SBOM entry.
- ED5 — sub-processor inventory is *not* derived from SBOM (different
  scope: data-processing vendors, not code dependencies).

## 16. Glossary

- **SBOM** — Software Bill of Materials.
- **SPDX** — Software Package Data Exchange; ISO/IEC 5962:2021 standard.
- **CycloneDX** — OWASP SBOM standard.
- **purl** — Package URL <https://github.com/package-url/purl-spec> — a
  unique identifier scheme for software packages.
- **VEX** — Vulnerability Exploitability eXchange.
- **CISA Minimum Elements** — the seven required fields per US CISA
  guidance.

---

*Last updated: 2026-05-18. Owner: Infra agent + Security agent.*
