# M1 — CODEOWNERS

> **Status**: DRAFT. **No `CODEOWNERS` file exists today.** Review
> assignment is convention-based. Sensitive paths (contract source,
> key custody, auth) are reviewed by whoever the author asks; security-
> class changes can land with one engineer's approval.
>
> This document specifies the `CODEOWNERS` file mapping paths to
> required reviewers, with a focus on sensitive paths that demand
> Security + Architecture sign-off.
>
> **Effort**: S (≤1 day to draft + commit; ongoing per team-change).
> **Owner**: Director of Engineering.
> **Depends on**: O11 (change-management classifies risk; M1 enforces
> the reviewers per class), M2 (branch protection makes CODEOWNERS
> enforcement mandatory).
> **Unblocks**: O11's review matrix; trusted Tier 1 deploys.

---

## 1. Today's state (honest)

- Repo `.github/` exists with workflows, but no `CODEOWNERS`.
- Reviewer assignment: author picks; convention-based.
- Sensitive paths (`apps/a2a-agent/src/auth/`, `packages/contracts/src/`)
  have informal "ping security" practice; not enforced.
- A PR can technically land on `master` with one reviewer regardless
  of the path it touches.

This is the gap M1 closes.

---

## 2. Goals

1. **Every sensitive path has a CODEOWNERS entry.** Security and
   architecture reviewers are auto-requested.
2. **CODEOWNERS is enforced by branch protection.** A PR cannot merge
   without the matched reviewer's approval (M2).
3. **The file is the source of truth** for "who approves what" — no
   parallel docs.
4. **Onboarding-friendly.** New engineers find the file and learn the
   review matrix from one place.

---

## 3. The CODEOWNERS file

`.github/CODEOWNERS`:

```
# CODEOWNERS for smart-agent
#
# Routes auto-requested reviewers to PRs touching sensitive paths.
# Branch protection (M2) requires CODEOWNERS approval for merge.
#
# Order matters: later patterns override earlier ones.
# Username globs must match GitHub identities (case-insensitive).
# Team globs (e.g. @smart-agent/security) require GitHub team setup.

# ─── Default fallback ─────────────────────────────────────────────────
# Any path not matched below requires a generic engineering review.
*                                                @smart-agent/engineering

# ─── Critical paths — Security + Architecture reviewer required ──────

# Smart contracts: source + tests + scripts
/packages/contracts/src/                         @smart-agent/contracts @smart-agent/security
/packages/contracts/test/                        @smart-agent/contracts
/packages/contracts/script/                      @smart-agent/contracts @smart-agent/security

# Key custody — KMS provider factory, env-validators
/apps/a2a-agent/src/auth/                        @smart-agent/security @smart-agent/architecture
/apps/web/src/lib/key-custody/                   @smart-agent/security
/packages/sdk/src/key-custody/                   @smart-agent/security

# Startup invariants (Sprint 5 + Spec 007 hardening)
/apps/a2a-agent/src/lib/policy-startup.ts        @smart-agent/security @smart-agent/architecture

# Audit chain
/apps/a2a-agent/src/audit.ts                     @smart-agent/security
/apps/a2a-agent/src/audit-checkpoint.ts          @smart-agent/security

# Inter-service MAC (Spec 007 G shared canonical MAC)
/packages/sdk/src/auth/canonical-mac-payload.ts  @smart-agent/security @smart-agent/architecture
/apps/a2a-agent/src/middleware/inbound-mac.ts    @smart-agent/security
/apps/*-mcp/src/middleware/inbound-mac.ts        @smart-agent/security

# Delegation + sessions
/apps/a2a-agent/src/routes/session-*.ts          @smart-agent/security
/apps/a2a-agent/src/routes/onchain-redeem.ts     @smart-agent/security
/packages/sdk/src/delegation/                    @smart-agent/security

# ─── High paths — CODEOWNERS-matched reviewer required ────────────────

# Web auth surface
/apps/web/src/app/api/auth/                      @smart-agent/web @smart-agent/security
/apps/web/src/lib/auth/                          @smart-agent/web @smart-agent/security
/apps/web/src/middleware.ts                      @smart-agent/web @smart-agent/security

# SDK public API
/packages/sdk/src/                               @smart-agent/sdk

# Discovery SDK
/packages/discovery/src/                         @smart-agent/backend

# Inter-service edges
/apps/a2a-agent/src/routes/mcp-proxy.ts          @smart-agent/architecture
/apps/a2a-agent/src/middleware/                  @smart-agent/architecture

# ─── Medium paths — domain owners ─────────────────────────────────────

/apps/a2a-agent/                                 @smart-agent/backend
/apps/person-mcp/                                @smart-agent/backend
/apps/org-mcp/                                   @smart-agent/backend
/apps/family-mcp/                                @smart-agent/backend
/apps/geo-mcp/                                   @smart-agent/backend
/apps/verifier-mcp/                              @smart-agent/backend
/apps/skill-mcp/                                 @smart-agent/backend
/apps/people-group-mcp/                          @smart-agent/backend
/apps/hub-mcp/                                   @smart-agent/backend
/apps/web/                                       @smart-agent/web

# ─── Specs + architecture docs ────────────────────────────────────────

/specs/                                          @smart-agent/architecture
/docs/architecture/                              @smart-agent/architecture
/docs/ontology/                                  @smart-agent/ontologist @smart-agent/architecture
/docs/information-architecture/                  @smart-agent/architecture
/docs/adr/                                       @smart-agent/architecture

# ─── Operations + security docs (this set) ────────────────────────────

/docs/security/                                  @smart-agent/security
/docs/security/operations/                       @smart-agent/infra @smart-agent/security
/docs/security/reliability-and-dr/               @smart-agent/infra @smart-agent/security
/docs/security/maintainability/                  @smart-agent/architecture
/docs/security/key-management/                   @smart-agent/security
/docs/security/cryptographic-posture/            @smart-agent/security
/docs/security/runtime/                          @smart-agent/security
/docs/runbooks/                                  @smart-agent/infra @smart-agent/security
/docs/postmortems/                               @smart-agent/engineering
/docs/cab/                                       @smart-agent/architecture @smart-agent/security
/docs/releases/                                  @smart-agent/engineering

# ─── Operational config + infra ───────────────────────────────────────

/.github/                                        @smart-agent/infra
/.github/workflows/                              @smart-agent/infra @smart-agent/security
/.github/CODEOWNERS                              @smart-agent/architecture
/infra/                                          @smart-agent/infra
/infra/terraform/                                @smart-agent/infra @smart-agent/security
/scripts/                                        @smart-agent/infra
/scripts/fresh-start.sh                          @smart-agent/infra
/scripts/deploy-*.sh                             @smart-agent/infra @smart-agent/security

# ─── Test infrastructure ──────────────────────────────────────────────

/test/                                           @smart-agent/engineering
/tools/load-test/                                @smart-agent/infra
/playwright/                                     @smart-agent/web

# ─── Vendored / generated — minimal review ────────────────────────────
# (no owners; falls through to default @smart-agent/engineering)

/packages/contracts/lib/                         @smart-agent/contracts
# (forge submodules — only contracts team need touch)
```

---

## 4. Team setup

The team handles in `CODEOWNERS` reference GitHub teams. Create:

| Team | Members | Purpose |
|---|---|---|
| `@smart-agent/engineering` | every engineer | Default reviewer pool |
| `@smart-agent/security` | Security reviewer + DoE | Security-sensitive path approver |
| `@smart-agent/architecture` | Architecture reviewer + DoE | Spec / IA / ADR approver |
| `@smart-agent/contracts` | Smart contracts owner | Solidity reviewer |
| `@smart-agent/backend` | Backend engineers | Backend services |
| `@smart-agent/web` | Frontend engineers | apps/web |
| `@smart-agent/sdk` | SDK owners | packages/sdk |
| `@smart-agent/ontologist` | Ontology owner | docs/ontology |
| `@smart-agent/infra` | Infra engineers | Infra + scripts |

Teams created at the GitHub org level (`gh api orgs/<org>/teams ...`).

---

## 5. Bootstrapping when the team is small

If the team has fewer engineers than reviewer slots demand, two
options:

### 5.1 Single-engineer wears multiple hats

A single person can be on `@smart-agent/security` + `@smart-agent/
architecture` + `@smart-agent/contracts`. CODEOWNERS still
auto-requests them; they have multiple required-approval slots.

Drawback: same person reviews multiple times for one PR. Practically
this means one approval click; GitHub treats the same user's approval
as satisfying multiple CODEOWNERS lines.

### 5.2 Reduce critical-path strictness temporarily

In the early team-size case (≤3 engineers), require ONE security-team
member instead of one-each-of-{security, architecture}. As the team
grows, tighten the requirements.

This relaxation is documented in `M2` branch protection settings and
re-evaluated quarterly by the DoE.

---

## 6. The /docs/agents/REVIEWERS.md companion

A sister doc listing the people behind the team handles, with their
expertise areas + availability:

```markdown
# Reviewers

## @smart-agent/security
- Richard Pedersen (`@rpedersen`) — primary; KMS + audit + delegation.

## @smart-agent/architecture
- Richard Pedersen (`@rpedersen`) — interim, until dedicated
  architect joins.

## @smart-agent/contracts
- Richard Pedersen (`@rpedersen`) — primary; ERC-4337 + delegation.

## @smart-agent/backend
- ...
```

Lets a new engineer figure out who they're routing review to.

---

## 7. Files to create/change

### New

- `.github/CODEOWNERS` — the file above.
- `docs/agents/REVIEWERS.md` — humans-behind-handles doc.

### Changed

- Repo settings (GitHub UI; not in Git) — enable "Require review from
  Code Owners" in branch protection per M2.

### CI guards

- `scripts/check-codeowners-coverage.ts` (new) — walks the file tree;
  asserts every directory listed in §3 has a CODEOWNERS line. Catches
  drift if a directory is added without an entry.

---

## 8. Acceptance criteria

- [ ] `.github/CODEOWNERS` file committed.
- [ ] GitHub teams (`@smart-agent/security`, etc.) created.
- [ ] Branch protection settings updated to require CODEOWNERS review
      (per M2).
- [ ] CI guard `scripts/check-codeowners-coverage.ts` green.
- [ ] First test PR touching `apps/a2a-agent/src/auth/` auto-requests
      `@smart-agent/security` reviewers.
- [ ] First test PR touching `packages/contracts/src/` auto-requests
      `@smart-agent/contracts` + `@smart-agent/security`.

---

## 9. Test plan

- Open a draft PR touching each of the sensitive paths in §3. Verify
  the GitHub UI shows the expected reviewer auto-request.
- Open a draft PR touching only `docs/`; verify only
  `@smart-agent/engineering` is auto-requested.

---

## 10. Rollback

CODEOWNERS can be relaxed by removing entries. Don't.

The fallback: if a CODEOWNERS-mandated reviewer is unavailable for
>24h on an urgent PR, the DoE has admin-bypass authority (logged in
the audit chain via the deploy-approval row in O11 §4.2).

---

## 11. Open questions

- **OQ-M1-1**: How fine-grained do we make rules? Proposed: file-
  level for `policy-startup.ts` + the audit-chain files; directory-
  level for everything else. Keeps the file manageable.
- **OQ-M1-2**: Should CODEOWNERS gate auto-merge? Yes — already
  required by GitHub branch protection. Auto-merge is OFF for
  CODEOWNERS-mandated paths (human pushes the merge button after the
  required reviewer approves).
- **OQ-M1-3**: What about hot-path files inside a sensitive directory
  (e.g. a typo fix to a comment in `policy-startup.ts`)? Proposed:
  the file-level rule still applies; the security reviewer approves
  trivially. No exception path for "small changes" — small changes to
  security-sensitive files are still security-sensitive.
- **OQ-M1-4**: How do we keep the file fresh as the codebase moves?
  Proposed: quarterly review tied to O7's runbook review. The check
  guard catches new top-level directories.
- **OQ-M1-5**: Should non-code paths (e.g. `output/`, generated SDK
  types) have CODEOWNERS? Proposed: no — they don't typically receive
  PRs.
