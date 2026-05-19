# O10 — Feature Flags

> **Status**: DRAFT. **There is no formal feature-flag system today.**
> Conditional behavior is gated by environment variables read at boot
> (`MARKETPLACE_ENABLED`, `ALLOW_LEGACY_A2A_SESSIONS`,
> `ALLOW_RUNTIME_DEPLOYER_KEY_UNTIL`, see
> `apps/a2a-agent/src/lib/policy-startup.ts`). These are operator
> break-glass / staged-migration knobs, not user-cohort flags.
>
> This document specifies the feature-flag system: vendor choice, flag
> lifecycle, default safety posture, audit, and the cleanup discipline
> that prevents flag rot.
>
> **Effort**: M (1 week to choose + wire vendor; ongoing flag cleanup).
> **Owner**: Backend lead + per-feature owner.
> **Depends on**: O1 (canary deploys use flags for cohort separation),
> Spec 007 (env-var posture is solidified, so feature flags are
> additive — not a replacement).
> **Unblocks**: safer rollouts; instant kill-switches without redeploy.

---

## 1. Today's state (honest)

| Flag mechanism | Today | Limitation |
|---|---|---|
| Env-var boot gates (`MARKETPLACE_ENABLED`, `ALLOW_LEGACY_A2A_SESSIONS`, `ALLOW_RUNTIME_DEPLOYER_KEY_UNTIL`) | Implemented in `apps/a2a-agent/src/lib/policy-startup.ts` | Operator-only; no user cohorting; flips require redeploy |
| `process.env.NODE_ENV` branches | Sprinkled through the codebase | Crude; not a flag |
| `@sa-risk-tier` annotations (Spec 007 Phase B) | Planned | Risk-tier routing, not feature flags |
| Per-user UI features | Not gated | Either everyone has it or nobody |

If a freshly-shipped feature breaks production today, the only mitigation
is auto-rollback (O1) or manual rollback. There is no path to "leave
the code deployed but disable the feature" without a redeploy.

Two real cases from the current codebase that need feature flags:
- **Marketplace**: spec-004 marketplace is gated behind
  `MARKETPLACE_ENABLED`. A user-cohort flag would let us enable for
  test users while the rest of the user base sees the pre-marketplace
  UI.
- **Variant A vs Variant B delegation** (Spec 007 Phase B): risk-tier
  routing decides per-call. A user-cohort flag would let us test the
  rollout with specific user groups.

This is the gap O10 closes.

---

## 2. Goals

1. **Every user-facing change of behavior is gated by a feature flag.**
   Decoupling deploy from release.
2. **Flag evaluation is fast** — <1 ms p99. Hot path quality.
3. **Flag changes are audited.** Who flipped what when, with reason.
4. **Flags expire.** A flag with no owner action for 90 days enters
   the cleanup queue.
5. **Flags fail safe.** When the flag service is unreachable, the
   evaluator returns the configured default — which is the
   conservative (off) value for new features and the established
   (on) value for matured features.
6. **Dev parity.** Same flag system runs in dev. Local override is
   supported via env var (matches the operator-break-glass shape).

---

## 3. Vendor decision

| Option | Pros | Cons | Decision |
|---|---|---|---|
| **LaunchDarkly** | Industry standard; mature SDKs in every language; rich targeting; audit log; great UX. | $0.30/MAU at the Pro tier — expensive at scale. Vendor lock-in. | Strong candidate but $$ at scale. |
| **GrowthBook** | OSS + paid tiers; self-hostable; targeting; Bayesian experimentation. | Less mature ecosystem; smaller community than LaunchDarkly. | **Chosen** as primary. |
| **Unleash** | OSS + paid; self-hostable; clear UX. | Smaller ecosystem; less in-house experimentation tooling. | Acceptable backup. |
| **PostHog Feature Flags** | If we already use PostHog for analytics. | We don't (today). Adds a tool. | Rejected for V1. |
| **In-house env-var-based** | Zero new dependency; full substrate independence. | No user cohorting; no audit log; no targeting; no UI. | Insufficient. |
| **Hybrid: in-house with PG-backed flag store + SDK** | Substrate independence; full control. | Significant engineering for parity with hosted offerings. | Considered; defer. |

### 3.1 Why GrowthBook

- OSS-first; self-hostable on our own infra (Docker container backed
  by Postgres).
- TypeScript SDK is solid.
- Bayesian-experiment support if/when we want statistical rollouts.
- Cost: free at OSS tier (we self-host); $20/seat/mo on cloud tier.

Substrate-independence check (P1): GrowthBook publishes a Docker
image. We can self-host. The SDK reads from a public JSON manifest
which can be cached or even Git-committed in a worst case. We are not
runtime-dependent on GrowthBook's cloud.

### 3.2 Why not LaunchDarkly

The architecture is similar; LaunchDarkly is excellent technically.
The decision is cost: at 10,000 MAU, LaunchDarkly Pro is $3,000/mo;
GrowthBook self-hosted is ~$50/mo (Docker compute + Postgres). For a
project explicitly committed to substrate independence (P1), the
self-hostable OSS option wins.

---

## 4. Flag categories

### 4.1 Release flags

Newly-shipped features, default off. Rollout: internal → beta cohort
→ 10% → 50% → 100%. Once at 100% for 30 days with no rollback,
candidate for cleanup.

### 4.2 Operational flags (kill-switches)

Always present, default on. Examples:
- `marketplace_enabled` (replaces the current env var, evolves it).
- `paymaster_sponsorship_enabled`.
- `graphdb_read_enabled` (for DR3 — degrade discovery cleanly when
  GraphDB is down).

Operational flags rarely get cleaned up — they're the production
kill-switches.

### 4.3 Experiment flags

A/B tests for UX or product decisions. Time-boxed; statistical end
date; results recorded in PRD.

### 4.4 Permission flags

Per-user gating of preview features. E.g. "beta tester sees the new
proposal-lane UI." Cleaned up when feature graduates.

---

## 5. Flag lifecycle

```
proposed → created → testing → rolling out → at 100% → cleanup → removed
   (PRD)     (PR)     (10%)      (10-100%)   (review)   (PR)     (-)
```

### 5.1 Created

A flag is created when the PR adding it lands. The PR must include:
- Flag key (snake_case, prefixed with category: `release_`, `op_`,
  `exp_`, `perm_`).
- Description (1 paragraph).
- Owner (a person, not "the team").
- Default value (off for `release_`; on for `op_`).
- Removal date (90 days from create; reviewable but a real date).
- Test plan (how to validate before flipping).

The PR template enforces these via a section in
`.github/PULL_REQUEST_TEMPLATE.md`.

### 5.2 Testing

Feature is gated behind the flag. Internal team flips ON for their
own users; validates. Bugs filed; flag stays at internal-only.

### 5.3 Rolling out

| Stage | Cohort | Duration |
|---|---|---|
| Internal | team accounts only | until "feels right" — at least 1 week |
| Beta | opt-in via `?beta=1` URL param OR specifically-tagged beta users | at least 2 weeks |
| 10% | 10% of MAU (rolling cohort) | 1 week minimum |
| 50% | 50% of MAU | 1 week minimum |
| 100% | all users | 30 days before cleanup eligibility |

At any stage, the owner can rollback to a previous stage with a
single click. Rollback emits an audit row + Slack notification.

### 5.4 Cleanup

90 days after 100% rollout (60 days at minimum):
- Remove the flag check from the codebase.
- Remove the flag from GrowthBook.
- Delete the PR template section.

CI guard `no-stale-flags.test.ts` (in Phase G or as a separate guard):
parses the codebase for `flag(release_*)` calls; cross-references the
GrowthBook flag list; flags any code reference to a removed flag, and
any flag in GrowthBook that's not referenced in code.

### 5.5 The 90-day cleanup deadline

Set on every `release_` flag. Flag-store metadata holds the deadline;
a daily cron alerts the owner at 60 / 30 / 7 days remaining. After
90 days, the flag is marked "in cleanup queue" — the owner has 2
weeks to land the cleanup PR or escalate to DoE.

This prevents the failure mode where a flag stays in the codebase
years after the feature shipped, doubling the cyclomatic complexity
of every code path it touches.

---

## 6. Default safety posture

### 6.1 Off-by-default for new features

```typescript
const enabled = await growthbook.isFeatureEnabled(
  'release_proposal_v2',
  { fallback: false },  // off-by-default
)
```

`fallback` is what we return if GrowthBook is unreachable. For
`release_` flags, fallback MUST be `false` (the conservative path,
matches "feature didn't ship") so a GrowthBook outage doesn't
expose half-baked features.

### 6.2 On-by-default for operational kill-switches

```typescript
const sponsoring = await growthbook.isFeatureEnabled(
  'op_paymaster_sponsorship',
  { fallback: true },
)
```

For `op_` flags, fallback MUST match the historical production
posture so a GrowthBook outage doesn't surprise users with disabled
core flows.

### 6.3 Cache + offline behavior

The SDK is configured with:
- **Local cache** (10 s TTL) — the flag value at last fetch.
- **On-disk cache** (10 min TTL) — survives process restart.
- **Configured fallback** — used when cache + on-disk both expired
  and GrowthBook is unreachable.

A flag flip can take up to 10 s to propagate to instances. Acceptable
for non-critical flags; for kill-switches (`op_*`), the SDK is
configured with `streaming: true` which uses server-sent events for
sub-second propagation.

---

## 7. Operator-break-glass flags (existing env-vars)

The env-var flags in `policy-startup.ts` are NOT replaced by
GrowthBook. They cover a different class of behavior:

| Env var | Class | Why env-only |
|---|---|---|
| `MARKETPLACE_ENABLED` | Operational boot gate | Boot-time hardening; absence of selector tables refuses boot. Not a per-user flag. |
| `ALLOW_LEGACY_A2A_SESSIONS` | Break-glass | Operator-controlled escape hatch in production. Per-user flipping would be a security regression. |
| `ALLOW_RUNTIME_DEPLOYER_KEY_UNTIL` | Break-glass with deadline | Same. |
| `AUDIT_CHECKPOINT_SINK_URL` | Config | Not behavior — connection string. |

Rule: **a flag is a feature flag if and only if a user could observe
different behavior**. Operational boot gates and break-glass posture
flags are not user-observable in their flipped form (they grant or
deny operator capability); those stay as env vars.

The new feature flag SDK uses GrowthBook for user-observable behavior.
A `release_marketplace_v2_ui` flag could co-exist with the env-var
`MARKETPLACE_ENABLED`: the env var must be true for the chain interaction
to work; the flag controls which UI variant a user sees.

---

## 8. Targeting

GrowthBook supports targeting on:
- User ID (account address or person agent ID).
- User attribute (e.g. `org_id`, `beta_tester=true`, `risk_tier`).
- Random percentage.
- Geographic (IP-derived).

We use:
- **User ID** for known beta-testers (`docs/agents/user.md`'s test
  accounts).
- **Attribute `beta_tester`** for general beta cohort.
- **Random percentage** for incremental rollouts (10%, 50%).

We do NOT use:
- Geographic targeting (no current use case).
- Real-time experimentation on Tier 1 money paths (too risky;
  experiment elsewhere).

---

## 9. Audit

Every flag change writes:
- GrowthBook's native audit log (who, when, before/after, reason).
- An audit row to our `audit_rows` table via `apps/a2a-agent/src/audit.ts`:
  ```typescript
  await auditAppend({
    rootGrantHash: '',
    sessionId: '',
    sessionPrincipal: '',
    mcpServer: 'system',
    mcpTool: 'system:flag-change',
    executionPath: 'mcp-only',
    status: 'completed',
    errorReason: JSON.stringify({ flag, before, after, by, reason }),
  })
  ```

The audit row is hash-chained into the audit chain (Sprint 5 P1-5).
A flag change in production is forever attributable.

---

## 10. Files to create/change

### New

- `packages/sdk/src/flags/client.ts` — GrowthBook SDK wrapper. Exposes
  `useFlag(key, fallback)` for React and `flag(key, ctx)` for server.
- `packages/sdk/src/flags/audit.ts` — bridges GrowthBook webhook →
  `auditAppend`.
- `infra/growthbook/docker-compose.yml` — self-hosted instance.
- `infra/growthbook/postgres-schema.sql` — backing DB.
- `infra/datadog/monitors/growthbook-down.yaml` — alert if GrowthBook
  unreachable for >2 min (caching mitigates user impact but ops needs
  to know).
- `.github/PULL_REQUEST_TEMPLATE.md` — adds the flag metadata block.
- `docs/runbooks/feature-flag-rollback.md` — how to roll back a flag.
- `docs/runbooks/feature-flag-cleanup.md` — cleanup steps.

### Changed

- Service `src/index.ts` files — initialise GrowthBook client at boot.
- `apps/web/src/app/layout.tsx` — provides GrowthBook React context.
- `docs/security/operations/README.md` — link to O10.
- `package.json` — add `check:no-stale-flags` script.

### CI guards

- `scripts/check-no-stale-flags.ts` — cross-references code references
  to flag keys with the GrowthBook flag list. Fails CI if either side
  has orphans.
- `pr-template-includes-flag-metadata.test.ts` — when a PR's diff
  contains `growthbook.isFeatureEnabled('release_*')`, the PR body
  must include the flag metadata block.

---

## 11. Acceptance criteria

- [ ] Self-hosted GrowthBook reachable from every service via
      `GROWTHBOOK_URL`.
- [ ] SDK wrapper exists in `@smart-agent/sdk` and is imported by all
      services that gate behavior.
- [ ] First feature is gated by a release flag end-to-end (e.g.
      `release_proposal_v2`).
- [ ] PR template enforces flag metadata.
- [ ] `check:no-stale-flags` runs in CI and is green.
- [ ] Flag change emits both GrowthBook audit log + `audit_rows` entry.
- [ ] Fallback behavior verified: kill GrowthBook in dev; confirm SDK
      returns configured fallback.
- [ ] Cleanup queue dashboard surfaces flags overdue for removal.

---

## 12. Test plan

### 12.1 Unit

- `test/flags/client.test.ts` — fallback semantics, cache TTLs,
  streaming updates.
- `test/flags/audit.test.ts` — webhook → audit row mapping.

### 12.2 Integration

- `test/integration/flag-rollback.test.ts` — start with flag on; flip
  off; assert subsequent requests see the off variant within 10 s.

### 12.3 Operational drill

- Quarterly: deliberately flip a non-critical operational flag (e.g.
  toggle the `op_graphdb_read_enabled` to false for 5 min); confirm
  the system gracefully degrades; confirm audit row appears.

---

## 13. Cost

| Item | Cost |
|---|---|
| GrowthBook self-hosted (Docker on EKS) | ~$30/mo compute |
| Postgres for GrowthBook backing | ~$15/mo (small RDS or shared) |
| Engineering time | 1 dev-week to wire |

Total marginal: ~$50/mo for full feature-flag capability.

---

## 14. Rollback

Removing GrowthBook entirely: not realistic once features are flag-
gated. The mitigation for a broken flag service is the SDK's
fallback + on-disk cache (§6.3). If GrowthBook is permanently down,
all flags lock to their fallback value, which is the conservative
posture by construction.

If GrowthBook is corrupting flag state (worst case): the env-var
break-glass override:

```bash
SMART_AGENT_FLAG_OVERRIDE='release_proposal_v2=false,op_paymaster_sponsorship=true'
```

The SDK reads this env var first; GrowthBook is bypassed. Operator-
only; logged at WARN; written to audit chain.

---

## 15. Open questions

- **OQ-O10-1**: Do we want client-side or server-side flag evaluation
  for `apps/web`? Proposed: server-side (Next.js server components)
  for SSR consistency; client-side only for purely-UX flags.
- **OQ-O10-2**: How do we handle flags that affect on-chain state?
  Proposed: never. A flag must not change on-chain semantics — that's
  a contract upgrade or namespace migration, not a flag flip.
- **OQ-O10-3**: Can a session-scoped delegation respect flag state?
  E.g. a user with delegation X cannot exercise it if the gating
  flag is off? Proposed: yes — flag evaluation happens at policy
  enforcement (apps/a2a-agent/src/auth/policy.ts), so a denied flag
  is a 403.
- **OQ-O10-4**: How do we test flag-on and flag-off in the same CI
  run? Proposed: parameterise integration tests over flag combos.
  Specific to risk-tier rollout (Spec 007 Phase B); not all tests
  need both.
- **OQ-O10-5**: How does flag state interact with the immutable audit
  chain? Proposed: include the resolved flag values for the request in
  the audit row body (under a `flags` field). Lets a reviewer
  reconstruct the user's exact experience at a specific moment.
