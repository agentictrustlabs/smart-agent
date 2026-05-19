# O1 — Deployment Procedure

> **Status**: DRAFT. **No production deployment procedure exists today.**
> `scripts/fresh-start.sh` is a dev orchestration tool — it wipes anvil,
> rebuilds local SQLite databases, redeploys contracts to a local chain,
> and reseeds demo data. It is explicitly NOT a production deployment
> procedure (and the file's preamble says so).
>
> This document is the production deployment procedure plan: pre-deploy
> gates, deploy modes, post-deploy verification, rollback, release notes,
> and cadence.
>
> **Effort**: L (2–3 weeks for the full pipeline; ~1 week minimum viable).
> **Owner**: Director of Engineering with Infra lead.
> **Depends on**: O2 (deep health checks), O3 (graceful shutdown), O11
> (change management), M2 (branch protection), Spec 007 Phase F.2
> (Postgres + migration tooling), Spec 007 Phase H (Terraform).

---

## 1. Today's state (honest)

| Layer | Today |
|---|---|
| Production deployment script | None. There is no production deployment. |
| Dev orchestration | `scripts/fresh-start.sh` — anvil + 9 MCPs + web; takes ~5min minimal, ~60min full seed. |
| Vercel deploy (web only) | Auto-deploy from `master` via Vercel's GitHub integration. No pre-deploy gate beyond the CI workflow. |
| Contract deploys | `scripts/deploy-local.sh` deploys to local anvil. No testnet or mainnet path exists. |
| Rollback | None. `vercel rollback <deployment-url>` works for web but is undocumented. |
| Release notes | Manual `git log` reading. |
| Post-deploy verification | None. |

If a bad commit lands on `master` today:
1. Vercel auto-deploys `apps/web` within ~3 min.
2. Backend MCPs (when they exist on real infra) have no path to update.
3. Nothing checks the deploy succeeded.
4. The first user request surfaces the failure.

This is an unacceptable posture for production. O1 fixes it.

---

## 2. Goals

1. **Every production deploy is verified before traffic flows.** Synthetic
   probes against the deployed-but-isolated environment pass; only then
   does the router cut over.

2. **Rollback is one command.** Operator types `pnpm deploy:rollback` and
   traffic returns to the previous version in ≤2 minutes.

3. **Pre-deploy gates are CI-enforced.** A deploy from a non-green commit
   is impossible — there is no human bypass.

4. **Release notes are automatic.** Generated from Conventional Commits
   (`feat:`, `fix:`, `chore:` …); the deploy pipeline blocks on missing
   `feat:`/`fix:` body when the version bumps.

5. **Deploy cadence is regular and predictable.** Weekly canary; on-demand
   hotfix; never on Friday afternoon without explicit operator override.

---

## 3. Deploy mode decision

### 3.1 Options considered

| Mode | Description | Pros | Cons |
|---|---|---|---|
| **Recreate** | Stop v1, start v2. | Simplest. | Downtime per deploy. Unacceptable for Tier 1 services. |
| **Rolling** | Replace pods one at a time; both versions serve traffic during the window. | No downtime; gradual ramp. | Both versions must be wire-compatible (DB schema, API). Bad commit affects 100% of users in tens of seconds. |
| **Blue-green** | Two identical environments; router flips between them. | Instant rollback (re-flip). Pre-cutover synthetic probe runs against the new env. | 2× infra cost during the cutover window. |
| **Canary** | Route 5% / 25% / 100% over a ~30min window; auto-rollback on metric regression. | Bad commit affects only the canary cohort. Auto-rollback. | Requires per-cohort metric isolation; more complex routing. |

### 3.2 Decision

**Canary for `apps/web` and `apps/a2a-agent`. Blue-green for MCPs.**

Rationale:

- `apps/web` and `apps/a2a-agent` are the user-facing surfaces. Canary
  catches regressions affecting real-user metrics (auth success, userOp
  throughput) before they hit 100% of traffic.
- MCPs are smaller, internal, and easier to put behind a router flip.
  Blue-green is operationally simpler; canary's added complexity isn't
  worth it.
- Contract deploys are inherently blue-green (a new address is a new
  contract; the old one still exists). Migration to the new address
  goes through the existing on-chain registry pattern (e.g.
  `AgentNameResolver` namespace switches).

**Canary cohort sizes**: 5% → 25% → 50% → 100%, 10 min between stages.
Total cutover: 30–40 min. Auto-rollback on any of:
- Error rate >0.5% above baseline.
- p99 latency >2× baseline.
- Auth-success rate <baseline – 1pp.
- Synthetic-transaction failure rate >0.

**Blue-green cutover window**: 5 min. Synthetic probe runs against the
inactive (green) environment for the full 5 min. Router flip is atomic.
Old (blue) environment remains warm for 24 h for instant re-flip.

---

## 4. Pre-deploy gates

A deploy is blocked unless ALL of the following are green on the candidate
commit:

### 4.1 CI gates (existing — `.github/workflows/ci.yml`)

- `typescript` job: `pnpm -r typecheck` + `pnpm -r test` + `pnpm check:all`.
- `contracts` job: `forge build --sizes` + `forge test -vvv`.

### 4.2 Supply-chain gates (`.github/workflows/*`)

- `pnpm-audit` workflow: `pnpm audit --prod --audit-level=high` returns 0.
- `codeql` workflow: no new HIGH or CRITICAL findings.
- `secret-scan` workflow: no leaked credentials.
- `dependency-review` workflow: no new licenses outside the allowlist.
- `contracts-static` workflow: Slither + Mythril clean (high severity).

### 4.3 Deploy-only gates (new — `.github/workflows/deploy.yml`)

These run only on the deploy workflow (not every PR), to avoid burning CI
budget on every commit:

- **Smoke test against the new build**: `pnpm test:smoke` runs a 30-test
  end-to-end suite against an ephemeral env. Covers:
  - Catalyst hub seed + boot-seed completes within 60 s.
  - Maria can pledge $50 (Variant A delegation path).
  - Pastor David can mark the pledge paid (Variant B path).
  - GraphDB sync reflects both events within 30 s.
- **Migration dry-run**: `drizzle-kit migrate --dry-run` against a
  production-cloned Postgres snapshot. Asserts the migration is
  idempotent (re-running is a no-op) and reversible (a generated
  `down.sql` exists for each forward migration).
- **Contract address compatibility**: when `packages/contracts` changes,
  the deploy workflow runs `scripts/contract-compat-check.ts` (new) that
  walks every on-chain registry referenced by the SDK and asserts the
  new build is wire-compatible (ABI signatures unchanged for read
  methods; if write methods changed, the change is annotated with
  `@sa-contract-breaking` and a separate sign-off is required).

### 4.4 Human sign-off (Tier 1 only)

For Tier 1 changes (auth, signing, money movement, contract redeploy),
a deploy is blocked until the operator-on-record approves the GitHub
deployment via `gh deployment confirm`. The CODEOWNERS file (`M1`)
identifies who counts as operator-on-record for which path.

---

## 5. Deploy procedure (canary — apps/web + apps/a2a-agent)

### 5.1 Step-by-step

```bash
# 1. Tag the release. CI runs the deploy workflow on tag push.
git tag -s v0.2.4 -m "v0.2.4 — Spec 005 Rail B settled-by-org settlement"
git push origin v0.2.4

# 2. The deploy workflow:
#    - Runs §4.3 gates.
#    - Builds new images: ghcr.io/smart-agent/web:v0.2.4 + a2a-agent:v0.2.4.
#    - Pushes to canary cohort (5% of traffic).
#    - Polls /ready (O2) and synthetic-transaction success for 10 min.
#    - Ramps to 25%, 50%, 100% with 10-min holds between each stage.

# 3. At any stage, if metrics regress:
#    - Auto-rollback fires.
#    - Cohort returns to previous version within 60 s.
#    - Slack alert posted to #ops-deploys; PagerDuty page sent to on-call.

# 4. Once at 100% for 1 h with no regression, the deploy is marked
#    `stable`. The previous version's containers can be terminated
#    after the 24-h re-flip window.
```

### 5.2 Manual override

The operator-on-record can `pnpm deploy:advance-stage` or
`pnpm deploy:hold` from `scripts/deploy-control.ts`. Every override
writes an audit row to the production audit log (mirroring the
`auditAppend` shape used in `apps/a2a-agent/src/audit.ts` for the
break-glass posture).

---

## 6. Deploy procedure (blue-green — MCPs + contracts)

### 6.1 MCP blue-green

Each MCP has two deployment slots: `<service>-blue` and `<service>-green`.
The router (Vercel Edge Function or AWS ALB rule) directs traffic to one
slot based on `<service>-active` parameter (Vercel Edge Config or AWS
Parameter Store).

```bash
# Deploy v0.2.4 to the inactive slot.
pnpm deploy:mcp person-mcp v0.2.4 --slot=green

# Run synthetic probe against the green slot directly.
pnpm deploy:probe person-mcp --slot=green --timeout=5m

# Atomic router flip.
pnpm deploy:cutover person-mcp --to=green

# Keep blue warm for 24 h for instant re-flip.
# After 24 h, blue is reclaimed automatically.
```

### 6.2 Contract redeploy

Contract deploys are inherently blue-green: the new contract has a new
address. The migration is:

1. Deploy new contract to mainnet/testnet via
   `forge script script/Deploy.s.sol`.
2. Update the on-chain `AgentNameResolver` namespace entries to point at
   the new address (this is itself a userOp signed by the deployer key).
3. SDK is bumped to read the new address from the env var
   (`*_REGISTRY_ADDRESS`).
4. Web + a2a-agent pick up the new env var on their next deploy.

Old contract remains on-chain forever (immutable). Storage migration
from old to new (if any) is a separate, named operation; not part of
the normal deploy flow.

---

## 7. Post-deploy verification

The deploy workflow does NOT mark the deploy stable until ALL of these
pass against the new build:

### 7.1 Synthetic transactions

Scripts in `scripts/synthetic/`:

| Probe | Asserts | Tier |
|---|---|---|
| `synth-userop.ts` | A2A agent can build, sign, and submit a userOp end-to-end. | 1 |
| `synth-pledge.ts` | Maria can pledge $50 via Spec 005 Rail A. | 1 |
| `synth-settle.ts` | Pastor David can mark Maria's pledge paid via Rail B. | 1 |
| `synth-graphdb-sync.ts` | On-chain assertion appears in GraphDB within 30 s. | 2 |
| `synth-passkey.ts` | Passkey + SIWE auth round-trip completes. | 1 |

Each probe is a Node script invoked from the GitHub Actions runner; it
uses a dedicated `synthetic-user@smart-agent` account whose private
data is preserved across deploys for stability.

### 7.2 SLO probes (existing dashboard)

The deploy workflow checks the SLO dashboard (Grafana or Datadog) for the
last 10 min:

- 5xx rate <0.5%.
- p99 latency for `/api/auth/session/init` <500 ms.
- p99 latency for `/api/pool/*` <1500 ms.
- userOp inclusion rate >99.9% (excluding intentional reverts).

Failure of any SLO probe holds the canary at its current stage; no auto-
progression until green. After 30 min of red, auto-rollback fires.

### 7.3 Audit-log emission

The deploy workflow asserts the new build is emitting audit rows:

```bash
curl -fsS https://audit.smart-agent.io/checkpoint/latest | jq .ts
# Must be within the last 60 s.
```

If audit emission stops, the deploy is held even if SLO probes are green.
Audit silence is a sentinel for the entire boot-seed path having failed.

---

## 8. Rollback

### 8.1 Auto-rollback

Triggered by canary's per-stage gate failure (§5.1). Wall-clock budget
from regression-detected → rollback-complete: ≤60 s.

### 8.2 Manual rollback

```bash
# Roll back the most recent canary stage. Returns traffic to the previous
# version. Logs an audit row.
pnpm deploy:rollback

# Roll back to a specific version (last-known-good).
pnpm deploy:rollback --to=v0.2.3
```

Wall-clock budget: ≤2 min (driven by container restart + DNS propagation).

### 8.3 Contract rollback

Contracts are immutable; rollback means re-pointing the namespace
registry at the previous version. The previous version remains
deployed (deletion is impossible), so this is a single userOp.

If the new contract has already written state that the old contract
won't understand, the rollback requires a more complex migration —
this is the case M-1 in Spec 007 Phase A (which is why Phase A pre-
commits the contract role split rather than backporting it later).

---

## 9. Release notes

### 9.1 Automatic generation

`scripts/release-notes.ts` (new) generates the release notes from
Conventional Commits between two tags:

```bash
pnpm release:notes --from=v0.2.3 --to=v0.2.4
```

Output (rendered to `docs/releases/v0.2.4.md`):

```markdown
# v0.2.4 — 2026-05-18

## Features (5)
- feat(spec-005): Rail B settled-by-org settlement (#142)
- feat(person-mcp): credential renewal flow (#138)
- ...

## Fixes (3)
- fix(a2a): rate-limit on /session/init raised to 600/min (#140)
- ...

## Breaking changes (0)

## Contract changes (1)
- PledgeRegistry redeployed (new address: 0xabcd...). Migration: namespace switch via AgentNameResolver.
```

### 9.2 Required content

A commit lacking a Conventional Commit prefix is blocked at PR-merge
time by the commitlint pre-commit (`M6`). The CI workflow re-runs
commitlint on every PR; a non-conforming title or body fails CI.

`feat:` and `fix:` commits MUST include a body explaining the user-
facing impact. The release-notes generator surfaces the body verbatim.

### 9.3 Distribution

Release notes are published to:
- `docs/releases/<version>.md` (in-repo, indexed by `docs/releases/README.md`).
- GitHub Releases (via `gh release create v0.2.4 --notes-file ...`).
- The in-app changelog (`apps/web/src/app/changelog/page.tsx`) — pulls
  from `docs/releases/` at build time.

---

## 10. Deploy cadence

### 10.1 Scheduled

| Cadence | Trigger | Window | Audience |
|---|---|---|---|
| **Weekly canary** | Every Tuesday 10:00 PT | 10:00–11:00 PT | All `master` commits since last Tuesday. |
| **Bi-weekly mainnet** | Every other Thursday 14:00 PT | 14:00–16:00 PT | Contract redeploys + breaking changes. |

### 10.2 On-demand

| Type | Trigger | Approval |
|---|---|---|
| **Hotfix** | P0 / P1 incident | On-call + 1 reviewer; CODEOWNERS sign-off if path is sensitive. |
| **Security fix** | CVE in deps, key compromise, etc. | Security reviewer + Director of Engineering. |

### 10.3 Forbidden windows

- Fridays after 14:00 PT — no scheduled or on-demand deploys without
  Director of Engineering override.
- 24 h before a planned demo, board meeting, or customer event — Tier 1
  changes blocked.
- During an active P0 or P1 incident — frozen except for the fix itself.

---

## 11. Files to create/change

### New

- `.github/workflows/deploy.yml` — the deploy workflow described above.
- `scripts/deploy-control.ts` — operator CLI (advance, hold, rollback).
- `scripts/synthetic/synth-userop.ts` — userOp synthetic.
- `scripts/synthetic/synth-pledge.ts` — Rail A synthetic.
- `scripts/synthetic/synth-settle.ts` — Rail B synthetic.
- `scripts/synthetic/synth-graphdb-sync.ts` — sync synthetic.
- `scripts/synthetic/synth-passkey.ts` — passkey synthetic.
- `scripts/contract-compat-check.ts` — ABI compat check.
- `scripts/release-notes.ts` — release notes generator.
- `docs/releases/README.md` — release index.
- `docs/runbooks/deploy-failure.md` — incident response when a deploy goes red.
- `docs/runbooks/rollback.md` — rollback walkthrough.

### Changed

- `package.json` — add `deploy:*`, `release:notes`, `test:smoke` scripts.
- `.github/workflows/ci.yml` — add commitlint job.
- `apps/web/src/app/changelog/page.tsx` — render `docs/releases/*`.
- `CLAUDE.md` — link to deploy runbook in the Commands section.

### Removed (eventually)

- `scripts/fresh-start.sh` is NOT removed; it remains the canonical dev
  reset. But it MUST never be invoked from a production environment.
  Phase G CI guard `no-fresh-start-in-deploy.test.ts` greps deploy
  manifests for `fresh-start` and fails CI on any hit.

---

## 12. Vendor + cost

| Vendor | Use | Cost |
|---|---|---|
| GitHub Actions | CI + deploy workflow | $4/user/mo + minutes |
| Vercel | Edge runtime, canary routing for `apps/web` | $20/user/mo + bandwidth |
| AWS ALB + Lambda (canary controller) | A2A canary routing | ~$50/mo |
| Datadog | Synthetic monitoring + SLO dashboards | $7.5/host/mo + synthetic tests at $5/10k runs |
| PagerDuty | Auto-rollback paging | $21/user/mo (Business) |

Total marginal cost over the existing CI bill: ~$150–250/mo for a small
team. Per O9 this is well below the budget envelope.

---

## 13. Acceptance criteria

- [ ] `pnpm deploy:rollback` returns Tier 1 services to the previous
      version in ≤2 min (measured by synthetic-probe success time).
- [ ] Canary auto-rollback fires within 60 s of a 1% error-rate
      regression in a chaos test that intentionally returns 500 from a
      health-check handler.
- [ ] `.github/workflows/deploy.yml` blocks deploys from non-green
      commits. Test: deliberately fail a typecheck on a deploy branch
      and confirm the workflow refuses to advance.
- [ ] Synthetic transactions run against every deploy and gate
      progression. Test: introduce a latency spike in the synthetic env
      and confirm the deploy is held.
- [ ] Release notes are generated automatically from Conventional
      Commits. Test: tag a release and confirm `docs/releases/<tag>.md`
      and the GitHub release are populated within 5 min.
- [ ] CODEOWNERS approval is required for Tier 1 deploys. Test: open a
      deploy on a Tier 1 path without the owner's approval; confirm the
      workflow refuses.

---

## 14. Test plan

### 14.1 Unit / integration

- `test/deploy/canary-controller.test.ts` — exercises the canary
  controller against a mock router. Asserts auto-rollback fires on each
  of the three regression signals.
- `test/deploy/release-notes.test.ts` — exercises the release-notes
  generator against fixture commits.

### 14.2 Chaos drills

Quarterly. Documented in `docs/runbooks/chaos-deploy-failure.md`:

1. Deploy a deliberately-broken build (returns 500 from `/health`).
2. Confirm the deploy workflow holds at the 5% canary stage.
3. Confirm auto-rollback fires within 60 s.
4. Confirm an audit row was written for the rollback.

### 14.3 GameDay

Annual. The full team exercises a contract redeploy + rollback over a
4-hour window. Documented in `docs/runbooks/gameday-contract-redeploy.md`.

---

## 15. Rollback (of THIS plan)

If the deploy workflow itself misbehaves:

1. Disable `.github/workflows/deploy.yml` by renaming to `.disabled`.
2. Hand-deploy via the pre-O1 path: Vercel auto-deploys web; backend
   MCPs deploy via direct `kubectl` / `docker push`.
3. Re-enable once the workflow is fixed.

This rollback is intentional: O1 is a process, not a primitive. A bug
in O1 cannot be allowed to brick production.

---

## 16. Open questions

- **OQ-O1-1**: Should the canary cohort be based on user-cohort
  (specific test users always hit the canary) or randomised (5% of
  every user's requests)? Proposed: randomised at the edge with a
  cookie-pinned cohort assignment so user experience is consistent
  within a session. Test users opt in via `?cohort=canary` query param.
- **OQ-O1-2**: Are the four auto-rollback signals (§3.2) sufficient, or
  do we need a fifth (e.g. memory exhaustion, container restart count)?
  Proposed: ship the four; add a fifth only if a chaos drill surfaces a
  scenario the four miss.
- **OQ-O1-3**: Where does the 24-h re-flip window live in cost terms —
  is doubling capacity for one day worth it vs. one hour? Proposed: 24 h
  initially; tighten to 4 h after the first 6 months of production
  operation prove no rollback need exceeds that.
- **OQ-O1-4**: Should hotfix deploys skip the 5% canary stage and go
  straight to 25%? Proposed: yes for security fixes, no for normal
  hotfixes. Requires Director of Engineering sign-off either way.
