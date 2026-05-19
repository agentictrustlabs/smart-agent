# External Dependencies — Plans ED1..ED5

> **Audience**: security lead, infrastructure engineer, customer infosec
> response, procurement, legal.
>
> **Scope**: every part of Smart Agent that depends on something we do
> not build ourselves. The runtime dependency graph (npm packages,
> contracts libs), the operational vendor inventory (cloud, SaaS), the
> supply-chain attack surface, the license compatibility surface, and
> the data-processing chain (sub-processors with DPAs).
>
> **Principle context**: this directory sits in tension with the
> "substrate independence" rule (P1, `docs/architecture/principles.md`).
> We *use* third parties; we never *depend* on them at runtime in a
> way that would compromise the substrate-independence claim. ED2 +
> ED3 + ED4 are the discipline that makes that claim auditable.
>
> Every document grounds claims in real files (`pnpm-lock.yaml` is
> 9,650 lines / 3,053 package entries; manifests under `apps/*/package.json`,
> `packages/*/package.json`). Vendors named with current URLs as of
> 2026-05-18.

---

## What lives here

| Doc | Topic | Approx scope | Pre-req |
|---|---|---|---|
| **ED1** | SBOM (Software Bill of Materials) | Generation, storage, customer-facing URL, vuln-scan feed | none |
| **ED2** | Vendor risk assessment | Inventory + tiering + annual review cadence | ED5 (DPA inventory) |
| **ED3** | Supply chain security | Attack scenarios + mitigations (Socket / sigstore / pnpm provenance) | ED1 (SBOM as ground truth) |
| **ED4** | OSS license compliance | Approved / forbidden licenses + CI gate + attribution file | ED1 (SBOM gives the license metadata) |
| **ED5** | Sub-processor DPA inventory | Per-vendor DPA terms, expiry tracking, customer notification | none |

## Reading order

For an engineering manager:

1. **ED1** — the SBOM is the inventory; the other four docs are policies
   *over* the inventory.
2. **ED2** — vendor risk; this is where the real cost / risk decisions
   live.
3. **ED5** — DPAs; tightly linked to ED2 (every tier-1 vendor needs a
   DPA on file).
4. **ED4** — license compliance is the small-effort / high-leverage CI
   gate.
5. **ED3** — supply chain; ongoing programme, longest tail.

For a security lead:

1. **ED3** — supply-chain attack surface is where the highest-leverage
   risk hides for an SDK shop.
2. **ED1** — SBOM as a hard requirement for SOC 2 + customer RFPs.
3. **ED2** — vendor inventory is the foundation for due diligence.
4. **ED5** — same.
5. **ED4** — quick read; mostly a CI gate.

For a customer infosec response:

- Point them at **ED1**'s customer-facing SBOM URL.
- Point them at **ED5**'s subprocessor list for DPA cascading.
- Point them at **ED3**'s detective controls for supply-chain attestation.

## Status snapshot (as of 2026-05-18)

| Doc | Status | Owner | Next gate |
|---|---|---|---|
| ED1 | Draft, ready to wire | infra | First SBOM commit in CI |
| ED2 | Draft, inventory complete; tiering review needed | security + procurement | First annual review cycle |
| ED3 | Draft, ready to wire | infra + security | Socket.dev trial activation |
| ED4 | Draft, ready to wire | developer | license-checker CI gate |
| ED5 | Draft, partial inventory | security + legal | Complete inventory after ED2 finalised |

## Standards cited

- **CISA Minimum Elements for SBOM** (2021):
  <https://www.cisa.gov/sbom>. The seven required fields (author, name,
  version, supplier, dependency relationship, unique identifier,
  timestamp) are CISA-mandated and are reflected in ED1 §3.
- **NIST SP 800-218 SSDF** (Secure Software Development Framework):
  <https://csrc.nist.gov/publications/detail/sp/800-218/final>. ED3
  Practice PO.3 (third-party software) and PW.4 (well-secured components)
  are the references for supply-chain security.
- **NIST SP 800-161 Rev. 1** (Cybersecurity Supply Chain Risk Management):
  <https://csrc.nist.gov/publications/detail/sp/800-161/rev-1/final>.
  ED2 vendor tiering inherits the NIST risk-based approach.
- **SPDX 2.3 specification**:
  <https://spdx.github.io/spdx-spec/v2.3/>. ED1's SBOM format.
- **CycloneDX 1.5 specification**:
  <https://cyclonedx.org/docs/1.5/>. ED1's secondary SBOM format
  (we publish both; tooling consumes one or the other).
- **EO 14028** (May 2021, Improving the Nation's Cybersecurity) requires
  federal vendors to provide SBOMs; we comply proactively even though we
  are not (yet) a federal vendor: <https://www.whitehouse.gov/briefing-room/presidential-actions/2021/05/12/executive-order-on-improving-the-nations-cybersecurity/>.

## Conventions

- `[OWE-REVIEWER]` — fix or follow-up the engineering team owes.
- `[DECISION]` — vendor / dollar / calendar commitment.
- `[OPEN]` — open question blocking decision.
- `[COST]` — recurring or one-time spend.

---

*Last updated: 2026-05-18. Owner: Security agent + Infra agent.*
