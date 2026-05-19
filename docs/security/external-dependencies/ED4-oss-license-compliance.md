# ED4 — OSS License Compliance

> **Status**: Draft. Names approved / forbidden licenses, the CI gate
> that enforces them, and the per-release attribution artefact.
>
> **Effort**: S (CI wiring) + ongoing (per new-dep review).
>
> **Owner**: developer + legal (sign-off on approved list).
>
> **Reading time**: ~15 min.

---

## 1. Goal

Every dependency we ship is licensed compatibly with our distribution
model. New deps with incompatible licenses are blocked at PR time;
the engineering team never has to discover a license problem at
deploy time.

## 2. Distribution model context

Smart Agent ships:

- **A web application** that we operate (apps/web → Vercel). This is the
  most permissive distribution case — most copyleft licenses (GPL, AGPL)
  are *triggered* only on distribution of the binary, and SaaS is not
  generally distribution. **EXCEPT AGPL** which triggers on network use.
- **Open-source SDKs** that we may publish (packages/sdk, packages/discovery,
  etc.). This *is* distribution. Any license restriction on transitive
  deps becomes a restriction on our package's distribution.
- **Smart contracts** that we deploy. Solidity source distribution is
  the same case as SDKs — we publish source and the deployed bytecode is
  derived.
- **Web frontend bundles** (apps/web JS bundles served to browser). This
  is technically distribution; AGPL terms may apply.

`[DECISION]` — for ED4 purposes, **assume distribution**. Every dep we
ship in a runtime package, an SDK, a frontend bundle, or a Solidity
contract source is treated as if we are distributing it. Dev-only deps
(test runners, formatters, linters, build tools) are treated under a
narrower lens — they are not shipped.

## 3. Approved licenses

| License | SPDX id | Notes |
|---|---|---|
| **MIT** | `MIT` | Approved — most common; trivial attribution requirement |
| **Apache 2.0** | `Apache-2.0` | Approved — has explicit patent grant (a plus); includes attribution requirement |
| **BSD 2-Clause** | `BSD-2-Clause` | Approved |
| **BSD 3-Clause** | `BSD-3-Clause` | Approved |
| **ISC** | `ISC` | Approved — functionally MIT |
| **Unlicense / Public Domain** | `Unlicense`, `0BSD`, `CC0-1.0` | Approved |
| **MPL 2.0** | `MPL-2.0` | Approved **with caveat**: file-level copyleft means we cannot modify an MPL-licensed file and keep our changes proprietary. We can use unmodified MPL files freely. Most MPL packages are used unmodified; a review is required if we patch one. |
| **CC-BY 4.0** (for non-code assets — fonts, icons) | `CC-BY-4.0` | Approved with attribution maintained in third-party-notices file |
| **CC-BY-SA 4.0** | `CC-BY-SA-4.0` | Approved with caveat — derivative works must be CC-BY-SA; rarely a problem for icons / fonts |

## 4. Forbidden licenses

| License | SPDX id | Why forbidden |
|---|---|---|
| **GPL 2.0 / 3.0** | `GPL-2.0-only`, `GPL-2.0-or-later`, `GPL-3.0-only`, `GPL-3.0-or-later` | Strong copyleft — derivative works become GPL. Cannot maintain proprietary distribution. |
| **LGPL 2.1 / 3.0** | `LGPL-2.1-*`, `LGPL-3.0-*` | Linking restrictions are problematic for JS bundling and Solidity compilation. Allowed only via case-by-case waiver — see §6.4. |
| **AGPL 3.0** | `AGPL-3.0-only`, `AGPL-3.0-or-later` | Network-use copyleft — *would* require us to publish derivative source of our SaaS deployment. Hard no. |
| **SSPL** | `SSPL-1.0` | Drafted for MongoDB; problematic distribution clauses. Hard no. |
| **BUSL** | `BUSL-1.1` | Source-available, time-bombed to a real license later; behaviour during the bomb period is too uncertain. Hard no without specific waiver. |
| **Unknown / Missing** | (no SPDX id, or "UNLICENSED", or "SEE LICENSE IN <file>") | If we can't tell, we can't approve. Forces a review. |
| **Custom / Proprietary** | (vendor-specific) | Case-by-case review; default forbidden. |

`[DECISION]` — explicit forbid-list above is enforced at PR time.

## 5. CI gate

### 5.1 Tool — `license-checker` + `license-checker-rseidelsohn`

The original `license-checker` (Dan Davis) is the canonical npm tool:
<https://github.com/davglass/license-checker>. The maintained fork
`license-checker-rseidelsohn` adds pnpm support and is the actual tool we
invoke.

```bash
pnpm dlx license-checker-rseidelsohn \
  --production \
  --json \
  --excludePrivatePackages \
  > docs/security/external-dependencies/license-inventory.json
```

Output is a JSON map: `<package@version>: { licenses: <SPDX>, repository: <url>, ... }`.

### 5.2 Allow-list enforcement

`scripts/check-licenses.ts` (NEW):

1. Reads `license-inventory.json`.
2. Loads `licenses-policy.yaml` (NEW) — the structured form of §3 and
   §4.
3. For each entry:
   - If license matches approved set: pass.
   - If license matches forbidden set: fail with clear message.
   - If license matches "unknown": fail unless waived in `licenses-exceptions.yaml`.
4. Exit non-zero on any failure.

```yaml
# licenses-policy.yaml (NEW)
approved:
  - MIT
  - Apache-2.0
  - BSD-2-Clause
  - BSD-3-Clause
  - ISC
  - Unlicense
  - 0BSD
  - CC0-1.0
  - MPL-2.0           # with §3 caveat
  - CC-BY-4.0
  - CC-BY-SA-4.0
forbidden:
  - GPL-2.0
  - GPL-2.0-only
  - GPL-2.0-or-later
  - GPL-3.0
  - GPL-3.0-only
  - GPL-3.0-or-later
  - AGPL-3.0
  - AGPL-3.0-only
  - AGPL-3.0-or-later
  - SSPL-1.0
  - BUSL-1.1
require_review:
  - LGPL-2.1-only
  - LGPL-2.1-or-later
  - LGPL-3.0-only
  - LGPL-3.0-or-later
```

### 5.3 CI invocation

GitHub Actions step in `lockfile-audit.yml` (next to ED3's lockfile
audit):

```yaml
- name: License check
  run: |
    pnpm dlx license-checker-rseidelsohn --production --json --excludePrivatePackages \
      > /tmp/license-inventory.json
    pnpm tsx scripts/check-licenses.ts /tmp/license-inventory.json
```

Fails the PR on any forbidden license.

### 5.4 Exceptions

`licenses-exceptions.yaml` (NEW) — when a forbidden license is genuinely
unavoidable (e.g. an upstream LGPL package that we use unmodified):

```yaml
- package: example-pkg@1.2.3
  license: LGPL-3.0-only
  reason: "Used unmodified; LGPL linking exception applies for JS"
  reviewer: <github-username>
  expires: 2027-01-01  # forces re-review
```

Adding to exceptions requires a PR to this file; reviewer must be in
the LEGAL-REVIEWERS CODEOWNERS group.

## 6. Solidity license compliance

Foundry deps have their own license metadata in each lib's `LICENSE`
file. There's no canonical pnpm-equivalent for Solidity. We implement a
small script:

### 6.1 Foundry license inventory

`scripts/generate-foundry-license-inventory.ts` (NEW):

```typescript
// Walks packages/contracts/lib/* — reads LICENSE file from each
// submodule HEAD; classifies via SPDX-Identifier matching.
```

Output schema mirrors §5.1's JSON for consistent downstream processing.

### 6.2 Solidity-specific approved licenses

OpenZeppelin is MIT (✅). Account-abstraction is GPL-3.0 — but we use
account-abstraction *only for testing parity*, not in our shipped
contracts. The `forbidden` rule would block it; the exception is:

```yaml
- package: account-abstraction@<sha>
  license: GPL-3.0-only
  reason: "Test-only reference implementation. Not deployed; not in shipped bytecode."
  reviewer: <github>
  expires: 2027-01-01
```

`[OWE-REVIEWER]` — verify the account-abstraction usage is truly
test-only by grepping for imports in `src/` (production source) vs.
`test/`. If any `src/` file imports from `lib/account-abstraction/`,
this exception is invalid and we need to vendor the relevant
interfaces ourselves.

## 7. Attribution file

GitHub repos with redistributed deps typically maintain a
`THIRD_PARTY_NOTICES.md` or `NOTICES` file.

### 7.1 Generation

`scripts/generate-attribution.ts` (NEW):

1. Reads `license-inventory.json`.
2. For each package: emit "name@version — license — repository URL".
3. Concatenates with each package's notice file (if present).
4. Writes to `docs/security/external-dependencies/THIRD_PARTY_NOTICES.md`.

### 7.2 Cadence

Regenerated on every release. Committed to the repo so it's visible.

### 7.3 Frontend bundle

For web bundles, modern Next.js automatically includes license info via
the `next-license-checker` plugin; we additionally inline the attribution
file as a static page at `/legal/third-party-notices`.

## 8. License of OUR code

Smart Agent's first-party code license is `[OPEN] ED4-1`:

- **Apache-2.0** — strong patent grant; encourages broad adoption;
  proven model for protocol+SDK projects.
- **BSL 1.1 + Change to Apache-2.0 after N years** — popular for
  commercial open-core projects.
- **Custom Source-Available** — full control; smaller community.

`[OWE-REVIEWER]` — license selection is a business + legal decision,
not pure engineering. Decision required before public SDK release.

## 9. Cost

| Component | Cost |
|---|---|
| license-checker (CLI) | $0 |
| Custom scripts | one-time dev cost ~1 day |
| CI runtime (~30 s per PR) | negligible |
| Legal review of approved list update (per change) | $1k–$2k |
| **Total recurring** | **~$0/mo** |

## 10. Cross-references

- ED1 — SBOM carries license metadata as one column; ED4 enforces over
  the same surface
- ED3 — supply-chain controls + license controls share the
  `lockfile-audit.yml` workflow
- ED5 — DPA inventory is separate from license; ED4 is about IP rights,
  ED5 is about data-processing rights

## 11. Implementation tasks

| # | Task | Owner | Effort |
|---|---|---|---|
| ED4-T1 | `licenses-policy.yaml` per §5.2 | security + legal | S |
| ED4-T2 | `licenses-exceptions.yaml` skeleton + current-state entries | developer | S |
| ED4-T3 | `scripts/check-licenses.ts` | developer | S |
| ED4-T4 | `scripts/generate-foundry-license-inventory.ts` | developer | S |
| ED4-T5 | CI step in `lockfile-audit.yml` running the check | infra | S |
| ED4-T6 | `scripts/generate-attribution.ts` | developer | S |
| ED4-T7 | `docs/security/external-dependencies/THIRD_PARTY_NOTICES.md` generated + committed | developer | S |
| ED4-T8 | `/legal/third-party-notices` static page in apps/web | developer | S |
| ED4-T9 | First-party license decision (§8) | exec + legal | M |

## 12. Acceptance criteria

- [ ] License inventory generated on every CI run
- [ ] Forbidden license fails PR (verified with a synthetic test)
- [ ] Approved list reviewed by legal
- [ ] First baseline run on current `pnpm-lock.yaml` passes (or each
      flagged dep has a documented exception)
- [ ] Attribution file present at repo root and in the deployed
      `/legal/third-party-notices` page
- [ ] Foundry license inventory generated; account-abstraction exception
      verified test-only

## 13. Open questions

- `[OPEN] ED4-1`: First-party license selection (§8).
- `[OPEN] ED4-2`: Do we maintain a public-facing license-inventory URL
  similar to ED1's SBOM URL? Recommendation: yes, at
  `https://smart-agent.io/.well-known/licenses.json` — small effort,
  high transparency value.
- `[OPEN] ED4-3`: Multi-license packages (e.g. "MIT OR Apache-2.0") —
  policy is "we choose the more permissive of the offered licenses";
  document this explicitly in `licenses-policy.yaml`.

## 14. Glossary

- **SPDX identifier** — canonical license identifier; `MIT`, `Apache-2.0`, etc.
- **Copyleft** — license that requires derivative works to use the same
  license (e.g. GPL).
- **Network-use copyleft** — license that treats network-accessible use
  as triggering the copyleft requirement (AGPL).
- **License compatibility** — the property that two licenses can be
  combined without violating either.
- **Attribution file** — `THIRD_PARTY_NOTICES.md` or equivalent listing
  every redistributed dep + its license + author.

---

*Last updated: 2026-05-18. Owner: Developer agent + Legal liaison.*
