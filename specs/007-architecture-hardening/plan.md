# Spec 007 — Architecture Hardening — LOCKED Plan v1

> **Cross-cuts**: this spec is the codification of the project principles in
> `docs/architecture/principles.md`. It is the single owner of the
> "close the gap between stated principles and current implementation"
> initiative. Every other in-flight spec (001/002/003/004/005/006) builds
> on the substrate this spec hardens — no feature spec may regress these
> properties.
>
> - **P1 (substrate independence)** — we build our own contracts, SDK, and
>   wallet substrate. This spec does NOT introduce Safe/Privy/MetaMask DTK
>   dependencies; it hardens our own substrate.
> - **P2 (chain is source of truth)** — every architectural primitive that
>   carries authority must produce an on-chain artifact a third party can
>   verify; off-chain trust boundaries must carry an inbound MAC.
> - **P4 (no MCP→GraphDB direct pipe)** — unchanged by this spec.
> - **P5 (stateless sessions)** — the passkey/SIWE deployer-fallback
>   placeholder is RETIRED by Phase C of this spec.
>
> No code execution starts until the master plan + Phase A are reviewed.

---

## Summary

Spec 007 closes the gap between the project's stated security principles
and the current implementation. Eight phases, dependency-ordered, ~6–10
weeks. **Phase A** re-architects the contract layer (no system-key
co-ownership), **B/C** cascade the change up through A2A and web,
**D/E** close remaining MCP boundary gaps, **F** resolves the storage-
layer scale question, **G** adds property tests + CI guards against
drift, **H** produces IaC and a privacy policy. Every phase produces a
long-term-correct architectural property, not a workaround.

The spec exists because an external senior-architecture review identified
8 P0 + 7 P1 production blockers, and an internal audit (the master-key +
deployer-drift audit at the audit reference cited under § Why now) added
the master-as-co-owner finding (M-1) that the external review missed —
the single highest blast-radius issue in the codebase. The user direction
on 2026-05-18 was explicit: **no deferrals, no quick fixes, every
identified gap is closed before further feature work.**

## The 5 architectural goals (North Star)

These are the load-bearing properties this spec is designed to make true.
Every phase justifies itself in terms of these goals.

1. **No production-runtime use of master/deployer keys for user authority.**
   Master signs envelopes (userOp relay, inter-service MAC,
   session-delegation issuance). Deployer signs ONCE (contract deploy via
   `forge create`). Neither signs user-authored actions, ever.

2. **No co-ownership at the contract level by system keys.** User
   AgentAccounts are owned by user credentials (passkey / MetaMask EOA /
   demo EOA). Master is NOT in `_owners`. Master has separate,
   capability-specific roles (bundler, session-issuer) defined at the
   contract level, NOT via owner-set membership.

3. **No unsigned trust boundaries.** Every service-to-service hop carries
   an inbound MAC. Every CI-detectable invariant has a CI guard. Comments
   that promise behavior must have CI proving the behavior exists.

4. **No silent fallbacks.** Failure of an architectural primitive (KMS
   call, MAC verify, contract write, userOp submit, GraphDB sync) is
   loud — observable in audit, observable in logs, and ideally
   observable in HTTP status. `try { primitive() } catch { console.warn(...) }`
   around required operations is forbidden.

5. **Multi-tenant isolation as a property, not a convention.** Cross-tenant
   data access must be impossible by construction (typed query builders,
   principal-bound contexts), not "we wrote the WHERE clause correctly
   this time." Negative tests assert this property for every tool.

## Why now

- **External senior-architecture review** (May 2026) flagged 8 P0 + 7 P1
  production blockers — covers MCP edge auth gaps (P1-3), generic MCP
  proxy lack of allowlist (P0-4), SQLite single-instance (P0-7), absent
  IaC for KMS+IAM (P1-5), AnonCreds custodial privacy (P1-6), and others.
- **Internal master-key + deployer-drift audit** (the report cited in
  `project_arch_hardening_007.md`) surfaced **M-1**: master signer is a
  co-owner of every AgentAccount minted via `AgentAccountFactory`. Master
  compromise = takeover of every agent + ability to upgrade any account
  to malicious implementation. The external review did NOT identify this;
  internal audit did.
- **User direction** (2026-05-18, captured in `feedback_no_patches_dev_mode.md`):
  no deferrals, no patches, architecture works as designed or we fix the
  architecture. This spec is the formal application of that rule across
  the whole substrate.

## Out of scope

- **Performance / latency plan** — queued separately (memory:
  `project_performance_plan.md`). Sequenced AFTER 007.
- **1claw-inspired features** — `ActionIntent`, MCP inspection,
  credentialRef handles, AccessGrant expiry+maxUses, proposal-lane
  encrypted body + review receipts. Queued separately
  (`project_1claw_plan.md`). AFTER 007.
- **Namera-inspired wallet execution** — policy DSL, ActionBundle + nonce
  lanes, sa CLI, wallet-mcp, passkey approvals. Queued separately
  (`project_namera_plan.md`). AFTER 007.
- **UX overhaul** — `/home/barb/.cursor/plans/funding-ux-audit_*.plan.md`.
  Defer until A2A Phase 6 + demo video are landed.

## Phase summary

| Phase | Owner pipeline | Focus | Est. |
|---|---|---|---|
| **A. Contract role split** | Developer → Tester → Reviewer → Security | Drop `serverSigner` co-ownership. Introduce `bundlerSigner` + `sessionIssuer` as capability-specific (non-owner) roles. Owner-signed upgrades. AgentAccount supports BOTH Variant A (off-chain delegation redeemed via `DelegationManager`) AND Variant B (on-chain delegation registered at session-init). **Contract redeploy required.** | 7–10d |
| **B. A2A signer model** | Developer → Reviewer → Tester | Hybrid session-init: risk-tier-routed Variant A (off-chain caveated delegation, redeemed at action time) vs Variant B (on-chain delegation registered immediately). `onchain-redeem.ts` redeems user delegations; master is bundler-relayer at `handleOps` only. | 5–8d |
| **C. Web K6 migration** | Developer → Reviewer → Security | Sweep `ssi/signer.ts` + ~20 server-actions + onchain-assertion emitters + recovery/passkey flows. Zero runtime `DEPLOYER_PRIVATE_KEY` in `apps/web/src/`. | 7–12d |
| **D. MCP edge closure** | Developer → Security → Tester | Inbound MAC on `people-group-mcp` / `family-mcp` / `geo-mcp` / `verifier-mcp` / `skill-mcp`. Populate `macKeyId` for each in `mcp-proxy.ts`. | 3–5d |
| **E. MCP proxy hardening** | Developer → Security | Per-tool allowlist in `mcp-proxy.ts`. `DISABLE_GENERIC_MCP_PROXY` env kill-switch. Generic proxy is opt-in, not default. | 2–3d |
| **F. Storage layer** | Developer (Infra) → Reviewer | **F.2 (DEFAULT, LOCKED)**: full Postgres migration. Drizzle repointed to Postgres; per-MCP databases; transactional nonce inserts; managed PG in prod; local PG in `fresh-start.sh`. F.1 (single-instance guard) considered and rejected. | 10–14d |
| **G. Isolation + CI guards** | Tester → Developer → Reviewer | Cross-tenant property tests for every MCP tool. CI: comments-match-routes, no-server-only-in-tsx, no-silent-catch-on-primitives, risk-tier-classification lint. Shared SDK canonical MAC. | 5–7d |
| **H. Privacy + IaC** | Infra → Documentarian | Terraform for AWS+GCP KMS/IAM (mirrors runbooks). AnonCreds custodial privacy policy doc + holder-wallet portability acceptance criteria. | 3–5d |
| **H+. Regulatory + legal counsel engagement** | Security → Product → outside counsel | NOT engineering work per se — the engineering-side input is the planning artifacts in `docs/security/regulatory-and-legal/` (README + RL1–RL7). Counsel engagement runs in parallel with H. Gating any of RL1 §2.3/§2.5/§2.6 going to public production. | 4–10 weeks counsel turnaround |

**Total**: ~42–64 person-days sequential. With parallelism on B+D+F: ~7–11
calendar weeks. Phases A→B→C is the critical path (each depends on the
previous); D/E/F/G/H can interleave once A is on chain. F.2 lengthens the
storage track but runs in parallel with C.

## Dependency graph

```
                ┌───────────────────────┐
                │ A. Contract role split│  (foundation — redeploy)
                └───────┬───────────────┘
                        │ new factory + AgentAccount + capability roles
                        ▼
                ┌───────────────────────┐
                │ B. A2A signer model   │  (uses session-key + bundler role)
                └───────┬───────────────┘
                        │ user userOps no longer signed by master
                        ▼
                ┌───────────────────────┐
                │ C. Web K6 migration   │  (passkey/SIWE sign their own ops)
                └───────┬───────────────┘
                        │ no runtime DEPLOYER_PRIVATE_KEY in apps/web
                        │
        ┌───────────────┼──────────────────┬──────────────┐
        ▼               ▼                  ▼              ▼
   ┌─────────┐     ┌──────────┐      ┌──────────┐   ┌──────────┐
   │ D. MCP  │     │ E. MCP   │      │ F. Store │   │ H. Privacy│
   │  edge   │     │  proxy   │      │  layer   │   │  + IaC    │
   └─────────┘     └──────────┘      └──────────┘   └──────────┘
        │               │                  │              │
        └───────┬───────┴───────┬──────────┴──────────────┘
                ▼               ▼
           ┌─────────────────────────┐
           │ G. Isolation + CI guards│  (regression fence)
           └─────────────────────────┘
```

**Sequencing rationale.** Phase A is non-negotiably first: every other
phase's correctness depends on the contract layer having
capability-specific roles instead of system co-ownership. Phase B
inherits A's `bundlerSigner` role. Phase C cannot complete until B
exists — passkey/SIWE flows need a non-deployer signing path which lives
on A's session-issuer role. D/E/F/H are parallelizable once C is in
flight. G lands last because it codifies (as CI) the invariants A–F
established — running it earlier would lock in the current violations.

## Acceptance criteria per phase

Each phase's "done" is defined as an observable system property a
reviewer can verify without trusting commentary.

- **Phase A done when:**
  - `grep -rn 'serverSigner' packages/contracts/src/` returns zero hits.
  - Foundry test `test_MasterCannotSignUserOpsForUser` passes.
  - Foundry test `test_MasterCannotUpgradeAccount` passes.
  - `cast call <any-deployed-account> "isOwner(address)" <bundlerSigner>`
    returns `false`.
  - `fresh-start.sh` boots clean with new factory and seeds the demo
    community.
  - See `phase-A-contract-role-split.md` for the full criterion list.

- **Phase B done when:**
  - `apps/a2a-agent/src/routes/onchain-redeem.ts` no longer calls
    `getMasterSigner()` for the inner `userOp.signature` — the inner
    signature is recovered to a user owner (passkey or EOA) or to a
    session-key registered under the user's authority.
  - `getMasterSigner()` usage in the route is limited to the
    `handleOps(...)` relay tx.
  - **Both Variant A and Variant B are wired**: `session-init` classifies
    incoming `scope` declarations via `classifySessionRiskTier()` and
    routes low/medium tiers to off-chain delegation (Variant A) and
    high/critical tiers to on-chain delegation registration (Variant B).
  - Variant A round-trip integration test passes: user signs caveated
    delegation off-chain → stored in person-mcp session_store → a2a-agent
    redeems via `DelegationManager.redeemDelegation` at action time.
  - Variant B round-trip integration test passes: user signs userOp that
    registers the delegation on-chain at session-init; subsequent session
    actions resolve against the on-chain registration.
  - Risk-tier misclassification adversarial test passes: a Variant A
    session attempting a high-risk action is rejected at redeem time
    (caveat enforcer or policy gate, per Phase A § D2 open question).
  - Integration test: master compromise (rotate `A2A_MASTER_PRIVATE_KEY`
    mid-test) does NOT enable signing for an unrelated user account.

- **Phase C done when:**
  - `grep -rn 'DEPLOYER_PRIVATE_KEY' apps/web/src/` returns only
    documented-dev-divergence sites (`env-guard.ts`, `boot-seed.ts`,
    `check-agent-name`, K6 break-glass guards) — zero `*.action.ts` hits,
    zero `lib/onchain/*Assertion.ts` hits, zero `lib/ssi/*` hits.
  - Passkey + SIWE users can register, vote, propose, pledge, and honor
    without `DEPLOYER_PRIVATE_KEY` set in the environment.
  - CI rule (Phase G) blocks reintroduction.

- **Phase D done when:**
  - Every MCP exposed via the A2A proxy validates an inbound MAC at the
    route boundary.
  - `apps/a2a-agent/src/routes/mcp-proxy.ts` has no `macKeyId: undefined`
    or `macKeyId: 'pending'` entries; each downstream is reachable only
    with a signed inbound header.
  - Property test: posting to any MCP without the inbound MAC returns 401.

- **Phase E done when:**
  - `mcp-proxy.ts` rejects any tool not on the per-downstream allowlist
    with `403 Tool not permitted`.
  - Setting `DISABLE_GENERIC_MCP_PROXY=true` makes every catch-all proxy
    route 404 — the kill-switch is wired and tested.

- **Phase F done when (F.2, LOCKED):**
  - No SQLite in production paths. Every backend (web, a2a-agent, all
    MCPs) connects to Postgres for `sessions`, `inter_service_nonces`,
    `action_nonces`, `revocation_epochs`, `action_counters`, `audit_rows`,
    `credential_metadata`.
  - Drizzle migrations under `drizzle-kit` apply cleanly to a fresh
    Postgres instance; per-MCP databases (or schemas) provisioned at
    boot.
  - `(scope, nonce)` UNIQUE constraint enforced; nonce inserts use
    `ON CONFLICT DO NOTHING` and surface a typed error to the caller.
  - Connection pooling configured (postgres.js or pg-pool); idle/timeout
    settings documented per service.
  - Audit-row writes complete BEFORE the HTTP response returns (no
    async fire-and-forget).
  - Startup guard: production refuses to boot if `*_PG_URL` is missing
    OR resolves to a `sqlite://` URL.
  - `fresh-start.sh` runs Postgres in Docker by default (`postgres:16-alpine`).
  - Phase G CI guard "no SQLite imports in production code paths" passes.

- **Phase G done when:**
  - Property test suite runs in CI: for every MCP tool, "tenant A cannot
    read or write tenant B's data" is enforced and tested.
  - CI guard: `tools-comment-matches-route.test.ts` parses every
    `apps/a2a-agent/src/routes/**/*.ts` and asserts the route's behavior
    matches its leading comment.
  - CI guard: `no-silent-catch-on-primitives.test.ts` lints
    `apps/web/src apps/a2a-agent/src apps/*-mcp/src` for `try { … } catch
    { console.warn(…); return null }` around `signMessage / signTypedData
    / signUserOp / writeContract / kmsClient.sign / fetch(<service>)`.
  - The shared SDK exports a single `canonicalizeMacPayload(payload)`
    used by every MAC sender + verifier (no per-service reimplementation).

- **Phase H done when:**
  - Terraform repo `infra/terraform/{aws,gcp}` provisions the KMS keys
    (master, bundler, session-issuer) + IAM bindings + audit-log routing
    described in `docs/runbooks/aws-kms-setup.md` and the GCP
    counterpart. `terraform plan` is clean on a fresh AWS/GCP account.
  - `docs/privacy/anoncreds-custodial.md` documents the holder-wallet
    custodial relationship, retention, and the holder's portability
    path; reviewed by Security + IA + Documentarian.
  - **Cryptographic posture documents landed under
    `docs/security/cryptographic-posture/`** for external security
    review hand-off:
    - `README.md` — 1-page overview + reading order + glossary.
    - `C1-threat-model.md` — full STRIDE / adversary-class document
      (16 adversary classes + 5 cross-class chains + accepted
      residual risks). Code-cited throughout.
    - `C2-replay-analysis-variant-a.md` — Variant A off-chain
      delegation replay surface; identifies the on-chain revocation
      gap (§ 5) and recommends `MaxActionsPerPeriodEnforcer` +
      `MaxDelegationsPerPeriodEnforcer` (§ 4) as additional caveats.
    - `C3-cryptographic-agility-and-pqc.md` — PQC migration plan;
      AgentAccount signature-type-byte extension to `0x02 = ML-DSA`
      and `0x03 = HYBRID` with three-phase rollout. References NIST
      FIPS 204 (ML-DSA, finalised Aug 2024).
    - `C4-subliminal-channels-ecdsa.md` — confirms local-secp256k1-
      signer is RFC 6979 deterministic; AWS KMS ECDSA is documented-
      randomized (not RFC 6979); GCP status unconfirmed by docs.
      Recommends CI test at `packages/sdk/test/subliminal-channel.test.ts`.
  - External security review (Trail of Bits / Cure53 / NCC Group
    tier) engaged with the four docs above as the briefing package.

## Migration + rollout

- **Fresh-start re-seeds with new contracts.** Phase A redeploys
  `AgentAccountFactory` + `AgentAccount` implementation. Counterfactual
  addresses change (new constructor params alter the init hash). There
  are no existing prod accounts; demo accounts are re-seeded by
  `scripts/fresh-start.sh`. The script already obeys the
  SERVICES / WIPE_PATHS / `seed_after_deploy()` pattern (memory:
  `reference_fresh_start.md`); extend each for new env vars and KMS
  provisioning.
- **New env vars** propagated through `deploy-local.sh`:
  - `BUNDLER_SIGNER_ADDRESS` (derived from KMS key `BUNDLER_KMS_KEY_ID`).
  - `SESSION_ISSUER_ADDRESS` (derived from KMS key
    `SESSION_ISSUER_KMS_KEY_ID`).
  - `A2A_MASTER_*` vars retain their existing role (envelope relay + MAC).
- **LocalStack KMS provisioning** (`provision-localstack-kms.sh`) creates
  the additional keys at fresh-start time. AWS + GCP runbooks updated.
- **No backwards-compat.** Per project rule: fresh-start re-seeds. No
  migration path for old factory addresses.

## Risk register

| # | Risk | Mitigation |
|---|---|---|
| 1 | Phase A introduces a regression in ERC-4337 `validateUserOp` flow that bricks the bundler path. | Foundry adversarial tests written FIRST (`test_BundlerCanSubmitButCannotAuthor`, `test_RawUserSignaturePathStillWorks`); integration smoke on anvil before any web/a2a phase starts. |
| 2 | Session-issuer authorization model (Variant A vs Variant B in Phase A § D2) ends up locking out passkey users in dev (no upstream user signature to mint a session against). | Phase A resolves the model explicitly as a hybrid: Variant A (off-chain caveated delegation) is the default; Variant B (on-chain delegation registration) is triggered by risk-tier classification. Demo seed pre-mints ONE Variant A session per demo user during fresh-start; no pre-minted Variant B sessions (avoids stale on-chain state). |
| 3 | Phase C scope creep — ~20 server-actions migrating to passkey/EOA signing requires UX support (passkey prompts at the right moments). | Phase B lands the session-issuer flow first; Phase C reuses it. The migration table in `phase-C-web-k6-migration.md` enumerates every file + its target shape; no file is migrated speculatively. |
| 4 | **Hybrid model misclassification**: a high-stakes action (money movement, treasury admin, grant award finalization, org ownership change, long-lived automation) is mis-tagged as `low` and routed through Variant A → silent loss of on-chain audit trail at session-bootstrap time, and the action lands without an authoritative on-chain delegation registration. | Defense in depth: (a) per-route `@sa-risk-tier` annotation linted in CI (Phase G) — every route MUST declare a tier; (b) test suite covers every route's classification; (c) caveat enforcer rejects high-risk selectors when the delegation does not carry the high-tier marker, so a misclassified Variant A redemption still fails at the contract layer; (d) `apps/a2a-agent/src/lib/risk-tiers.ts` is the single source of truth, derived from route annotations at build time. |
| 5 | Phase F.2 (full Postgres) blows past estimate due to integration tests writing to SQLite assumptions. | Migration is scoped per-MCP and gated on tests passing for each; SQLite kept as `local-dev` opt-in only during the migration window. Drizzle's dialect abstraction limits the per-file blast radius. If any track stalls > 3 days, that MCP's Postgres conversion ships as a follow-on PR while the rest of F.2 proceeds. |
| 6 | KMS provisioning IaC drift between LocalStack / AWS / GCP causes "works in dev, fails in prod" deploys. | Phase H provisions IaC from day one; `provision-localstack-kms.sh` is the canonical dev script and its output is asserted against the Terraform plan in a CI step. |

## Cross-references

- **Project memory** (`/home/barb/.claude/projects/-home-barb-smart-agent/memory/`):
  - `project_arch_hardening_007.md` — spec entry (this spec).
  - `feedback_no_patches_dev_mode.md` — the founding directive.
  - `project_substrate_independence.md` — P1 rule; this spec hardens our
    substrate, does not import an external one.
  - `project_sessionless_passkey_siwe.md` — Phase C retires the
    deployer-fallback placeholder.
  - `project_seed_as_self.md` — seed callers already comply; Phase C
    completes the runtime side.
  - `project_mcp_onchain_auth.md` — Phase D extends inbound MAC to every
    MCP edge.
  - `project_kms_initiative.md` — Phase A adds two new key IDs;
    Phase H provisions them via Terraform.
  - `project_sprint5_complete.md` — context on prior hardening pass.
- **Prior specs**: 001/002/003/004/005/006 — each consumes the substrate
  this spec hardens. None of them changes; their contracts simply mint
  user authority from a non-co-owned `AgentAccount`.
- **Canonical principles**: `docs/architecture/principles.md`.
- **Audit reference**: master-key + deployer-drift audit (cited in
  `project_arch_hardening_007.md`). File:line inventory in
  `phase-C-web-k6-migration.md` migration table.
- **Regulatory + legal planning** (Phase H+ — separate counsel
  engagement, not engineering work; runs in parallel with Phase H):
  - `docs/security/regulatory-and-legal/README.md` — counsel
    engagement plan + reading order.
  - `docs/security/regulatory-and-legal/RL1-money-transmitter-license-analysis.md` —
    **product-existential**; gates any public deployment of the money-
    movement paths inventoried in RL1 § 2 (Spec 005 honor + disbursement
    + treasury-to-treasury). Counsel opinion required BEFORE production.
  - `docs/security/regulatory-and-legal/RL2-securities-analysis.md` —
    pool / treasury / proposal / credential securities posture.
  - `docs/security/regulatory-and-legal/RL3-tax-reporting-1099-and-international.md` —
    1099 + DAC8 + CARF readiness; TIN collection at recipient
    onboarding.
  - `docs/security/regulatory-and-legal/RL4-ofac-sanctions-screening.md` —
    Chainalysis / TRM Labs integration; fail-closed posture aligned
    with Spec 007 goal #4 (no silent fallbacks).
  - `docs/security/regulatory-and-legal/RL5-kyc-aml-high-risk-flows.md` —
    tiered KYC; Persona / Sumsub vendor selection; Travel Rule.
  - `docs/security/regulatory-and-legal/RL6-tos-privacy-acceptable-use.md` —
    TOS / Privacy / AUP / Cookie / Disputes drafting.
  - `docs/security/regulatory-and-legal/RL7-liability-framework.md` —
    contractual limits + cyber / E&O / D&O insurance.
  - Phase 007 Phase A landing materially improves RL1's non-custodial
    argument; the legal docs explicitly call out that gate.

## Open questions resolved here vs. deferred to per-phase docs

- **Resolved in this master plan**:
  - Eight phases, ordering, dependency graph, acceptance criteria
    framed as observable properties.
  - Fresh-start re-seed strategy (no backwards-compat).
  - **F.2 (full Postgres) chosen as the spec deliverable**; F.1
    (single-instance guard) considered and rejected on long-term-correct
    grounds (see `phase-F-storage-layer.md`).
- **Resolved in `phase-A-contract-role-split.md`**:
  - bundlerSigner vs sessionIssuer — same EOA or different (different).
  - Session-issuer authorization model: **hybrid Variant A + Variant B
    routed by risk tier** (see § D2).
  - ERC-4337 entry-point integration semantics; `executeFromBundler` as
    defense-in-depth wrapper alongside the standard `validateUserOp`.
- **Resolved in `phase-C-web-k6-migration.md`**:
  - Per-file conversion table.
  - Passkey UX prompts during multi-step flows.
- **Deferred to v2** (explicit out-of-scope):
  - Holder-wallet self-custody migration path (Phase H documents
    custodial; non-custodial is a follow-on spec).
  - Cross-chain master-key separation (one master per chain vs shared
    master) — current substrate is single-chain.
