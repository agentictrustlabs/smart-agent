# O11 — Change Management

> **Status**: DRAFT. **Today the change-management process is "open a
> PR; one approval; merge."** No formal review requirements by risk
> class; no emergency-deploy process; no Change Advisory Board for
> high-risk changes; no record of who approved what for sensitive
> paths.
>
> This document specifies the PR review requirements per risk class,
> the deployment approval workflow, the emergency-deploy procedure,
> and the Change Advisory Board for high-risk changes.
>
> **Effort**: M (1 week to formalise + adopt).
> **Owner**: Director of Engineering.
> **Depends on**: M1 (CODEOWNERS exists), M2 (branch protection enforced),
> O1 (deploy procedure is automated).
> **Unblocks**: regulatory readiness (SOX-adjacent practices); customer-
> contract change-management clauses.

---

## 1. Today's state (honest)

| Aspect | Today |
|---|---|
| PR review | 1 approval required by general convention. No CODEOWNERS rule enforces who must approve. |
| Branch protection | Set up but not formalised; no `master` no-direct-push rule enforced today. |
| Deployment approval | None — `master` push triggers Vercel deploy of `apps/web` automatically. |
| Emergency deploys | Ad-hoc. |
| Change Advisory Board (CAB) | None. |
| Audit trail | Git history + GitHub PR records. No tied "approver attestation". |
| Change-impact assessment | None — high-risk changes treated like trivial ones. |
| Forbidden windows for deploys | None codified. |

If someone merges a one-line "fix" to `apps/a2a-agent/src/auth/key-provider.ts`
today:
- 1 approver greenlights it.
- It lands on `master`.
- It auto-deploys (eventually).
- No record exists of why the change was deemed safe.
- No security reviewer participated.
- If it broke the deployer-key invariant, we'd find out via the
  startup guard or in production.

This is the gap O11 closes.

---

## 2. Goals

1. **Risk-classified PR review.** Sensitive paths require security +
   architecture review; trivial paths only require one engineer.
2. **Deployment approvals are explicit.** Tier 1 deploys require
   operator-on-record sign-off in the deploy workflow.
3. **Emergency deploys are auditable.** A break-glass path exists with
   stricter post-deploy review.
4. **Change Advisory Board** for contract redeploys, mainnet
   transitions, key rotations, and security-sensitive infra changes.
5. **Every approval is durably recorded** beyond GitHub: in the
   immutable audit chain.
6. **Forbidden windows codified.** No Friday-afternoon Tier 1
   deploys without DoE override.

---

## 3. PR review requirements per risk class

### 3.1 Risk classes

Inherits from Spec 007 Phase B's risk-tier annotations + extends to
non-code changes.

| Class | Definition | Examples |
|---|---|---|
| **Low** | Documentation, comments, test-only changes, dev-only scripts. | `docs/`, `tests/`, `scripts/dev-*` |
| **Medium** | Application logic on non-Tier-1 paths. | MCP business logic, UI changes, GraphDB syncing. |
| **High** | Tier 1 surfaces: auth, signing, money movement, on-chain assertions. | `apps/a2a-agent/src/auth/`, `apps/web/src/lib/key-custody/`, `apps/web/src/server-actions/onchain/` |
| **Critical** | Contract source, KMS configuration, audit-chain code, deployer-key code. | `packages/contracts/src/`, `apps/a2a-agent/src/lib/policy-startup.ts`, `apps/a2a-agent/src/audit.ts`, `apps/a2a-agent/src/lib/key-provider.ts` |

### 3.2 Review matrix

| Class | Required approvers | Required status checks |
|---|---|---|
| Low | 1 engineer | CI green |
| Medium | 1 engineer + 1 CODEOWNERS-matched reviewer | CI green |
| High | 1 engineer + 1 CODEOWNERS + 1 Security reviewer | CI green + `check:all` + supply-chain scans |
| Critical | 1 engineer + 1 CODEOWNERS + 1 Security reviewer + 1 Architecture reviewer | All of the above + `forge test` + Slither/Mythril clean |

`CODEOWNERS` (per M1) enforces which paths require which reviewers.
`required_pull_request_reviews` rules in branch protection (per M2)
enforce the approval count.

### 3.3 Mechanical enforcement

- `CODEOWNERS` file routes auto-requested reviewers (M1).
- Branch protection rule `required_pull_request_reviews.required_approving_review_count`
  set per path via repo-wide rule sets (GitHub feature).
- Required status checks (CI workflows) gate merge.
- Auto-merge disabled for High + Critical classes (human pushes the
  merge button).

### 3.4 Override

A "minor edit on Critical-path file" (typo in a comment) does not
require the full Critical review pipeline IF:
- The PR's only diff lines are within `/** … */` comment blocks.
- A CI guard `critical-path-comment-only.test.ts` confirms.
- The PR author marks the PR with the `critical-comment-only` label.

Any code change on a Critical path is full Critical class.

---

## 4. Deployment approval workflow

### 4.1 Sequence

```
PR merged to master
      ▼
.github/workflows/deploy.yml runs CI gates (O1 §4)
      ▼
Risk class determined from PR labels + changed paths
      ▼
For Tier 1 deploys:
   GitHub Deployment created in "waiting" state
      ▼
   CODEOWNERS-matched operator clicks "Approve" in the
   Deployments view (or runs `gh deployment confirm`)
      ▼
   deploy.yml proceeds to canary stage 1 (5%)
      ▼
   Auto-progression OR auto-rollback per O1 §5
```

For Tier 2 + Tier 3 deploys, no manual approval is required —
canary auto-progression + auto-rollback is sufficient gating.

### 4.2 Approval audit

Every approval click writes:
- GitHub deployment audit (native).
- `audit_rows` row via `auditAppend` (mirrors O10's flag-change pattern):
  ```typescript
  await auditAppend({
    rootGrantHash: '',
    sessionId: '',
    sessionPrincipal: operatorPrincipal,
    mcpServer: 'system',
    mcpTool: 'system:deploy-approval',
    executionPath: 'mcp-only',
    status: 'completed',
    errorReason: JSON.stringify({
      deploy_id, commit_sha, tier, approver, reason,
    }),
  })
  ```

This is recoverable from the immutable audit chain forever.

---

## 5. Emergency deploys

A deploy that bypasses the normal cadence (e.g. for a P0 security
fix).

### 5.1 When emergency is justified

- Active P0 incident.
- Security vulnerability disclosed (internal or external CVE).
- Critical bug affecting Tier 1 SLO.
- Key compromise requiring immediate rotation.

NOT justified:
- "I want my feature out before the weekend."
- "Tomorrow's demo."
- Routine bug fixes (those go through normal canary).

### 5.2 Emergency procedure

1. Author opens PR with `emergency` label.
2. Two reviewers (one security, one engineering lead) approve
   synchronously over Zoom / Slack.
3. Author merges to `master`.
4. `deploy.yml` detects the `emergency` label and:
   - Skips the 5% canary stage (goes straight to 25%).
   - Halves the per-stage hold from 10 min to 5 min.
   - Pages DoE on every stage transition.
5. Author + reviewers join a war-room channel for the full deploy
   window.
6. Post-deploy: an emergency-deploy review (mini-postmortem) is
   filed within 48 h in `docs/postmortems/emergency-deploy-YYYY-MM-DD-<slug>.md`.

### 5.3 The 48-hour review

Captures:
- What was the emergency?
- Was the emergency justified?
- What did we skip?
- Did the truncated review catch what it could have?
- Lessons for normal deploys (faster gates? a missing guard?).

---

## 6. Change Advisory Board (CAB)

### 6.1 Scope

CAB review required for:
- Contract redeploys to mainnet.
- KMS key rotations.
- Audit-chain key rotations.
- Database schema changes touching PII columns.
- IAM policy expansions affecting >1 service.
- New external dependencies (vendors / services).
- Changes to `policy-startup.ts` (the startup invariant suite).
- Decommissioning a service.
- Privacy-policy or compliance posture changes.

### 6.2 Membership

Three voting members:
1. Director of Engineering.
2. Security reviewer.
3. Architecture reviewer (Information Architect for IA-affecting; Smart-
   Contracts owner for contract changes).

Plus rotating reviewers per the change topic (e.g. for an Anthropic
contract change, the LLM-API owner attends).

### 6.3 Cadence

- Async-by-default: PR-style. Change author posts in `#cab` Slack
  channel; voting members comment + vote within 3 business days.
- Synchronous fallback: monthly 1-hour standing meeting for any
  CAB-class change that needs discussion.

### 6.4 Decisions

- **Approve**: change proceeds via the relevant pipeline.
- **Approve with conditions**: change proceeds once conditions met.
- **Reject**: change cannot proceed; alternative proposed.

Decisions logged in `docs/cab/YYYY-MM-DD-<change-slug>.md` with
rationale.

### 6.5 Veto

Any one CAB member can veto a change. Veto requires a written
rationale; appeal goes to the founder / CEO. Vetoes are documented in
the same `docs/cab/` directory.

---

## 7. Forbidden windows

Codified in `.github/workflows/deploy.yml` + organisational policy:

| Window | Frozen | Override |
|---|---|---|
| Friday after 14:00 PT through Monday 06:00 PT | Tier 1 + Tier 2 deploys | DoE approval per deploy |
| 24 h before a scheduled board meeting / customer demo | Tier 1 deploys | CEO approval |
| During an active P0 / P1 incident | All deploys except the fix | Incident commander approval |
| Last 3 business days of the fiscal quarter | Tier 1 deploys touching billing-adjacent paths | CFO approval |

Each frozen-window override is logged + reviewed in the next CAB
meeting.

---

## 8. Files to create/change

### New

- `docs/cab/README.md` — CAB overview + index of past decisions.
- `docs/cab/_template.md` — CAB decision template.
- `docs/runbooks/emergency-deploy.md` — emergency-deploy procedure.
- `docs/postmortems/_emergency-deploy-template.md` — 48-h review
  template.
- `.github/PULL_REQUEST_TEMPLATE/critical.md` — variant template for
  Critical-class PRs (forces a "security implications" section).
- `scripts/check-critical-path-comment-only.ts` — CI guard for the
  comment-only override.
- `.github/workflows/freeze-window.yml` — refuses non-override deploys
  during frozen windows.

### Changed

- `CODEOWNERS` (per M1) — paths mapped to risk class.
- Repo branch protection rules — per §3 matrix.
- `.github/workflows/deploy.yml` — emergency-label fast path; freeze-
  window enforcement.
- `docs/security/operations/README.md` — link to O11.

---

## 9. Acceptance criteria

- [ ] Branch protection rule enforces 1 approval for Low, 2 for
      Medium/High (CODEOWNERS-required), 3 for Critical.
- [ ] CODEOWNERS file maps every High and Critical path to the right
      reviewers (per M1).
- [ ] Deploy approval is required for Tier 1; tested by deliberately
      opening a deploy without approval and confirming it stalls.
- [ ] Emergency procedure documented in `docs/runbooks/emergency-deploy.md`.
- [ ] First CAB meeting held; minutes filed in `docs/cab/`.
- [ ] Freeze-window workflow active; Friday-afternoon Tier 1 deploy
      attempt is refused (test by triggering on a Friday after 14:00).
- [ ] Every deploy approval writes an audit row; visible in the audit
      chain query.

---

## 10. Test plan

### 10.1 Branch protection verification

- Open a PR touching `apps/a2a-agent/src/auth/key-provider.ts` with 1
  approval; confirm GitHub refuses to merge (Critical needs 4).
- Open a PR touching only `docs/`; confirm 1 approval is sufficient.

### 10.2 Deploy workflow verification

- Tag a Tier-1 release; confirm the deploy workflow waits for
  approval; confirm the audit-row is written on approval.
- Tag a non-Tier-1 release; confirm auto-progression without approval.

### 10.3 Emergency drill

- Quarterly: simulate an emergency. Open a PR with the `emergency`
  label; walk through the procedure end-to-end. File the 48-h review.

### 10.4 CAB exercise

- Run a sample CAB decision on a low-stakes change (e.g. add a new
  dependency) to validate the cadence + recording. File in
  `docs/cab/`.

---

## 11. Rollback

Process changes can be relaxed by DoE decision. The mechanical
enforcement (branch protection, CODEOWNERS) is reversible. Audit
records of past approvals remain forever.

A specific anti-pattern to AVOID: relaxing review requirements "just
for this PR." If a change is urgent, use the emergency path which
preserves audit + review (just faster). Don't bypass the protection.

---

## 12. Open questions

- **OQ-O11-1**: Should we tier external vendor approvals (a new
  Datadog contract vs a $10/mo SaaS sign-up)? Proposed: yes — anything
  >$500/year or with PII-sharing requires CAB; under that is engineer
  judgement.
- **OQ-O11-2**: Does CAB review every Sprint-end retro? Proposed: no —
  CAB is for changes, not sprints. Engineering retros happen
  independently.
- **OQ-O11-3**: How do we differentiate "feature-flag flip" (low-risk
  if planned) from "feature-flag flip in emergency" (high-risk)?
  Proposed: planned flag flips at 100% rollout-stage transitions are
  Tier-1-deploy class; emergency kill-switch flips bypass the
  approval queue but write an extra-detailed audit row.
- **OQ-O11-4**: Are there changes that should NEVER be permitted
  through emergency? Proposed: yes — contract redeploys cannot be
  emergency (the chain-side delay is irrespective of our review
  speed). KMS key rotations cannot be emergency-bypassed (K1's
  process is the floor).
- **OQ-O11-5**: How do we onboard new engineers into "who's a
  reviewer for X path"? Proposed: CODEOWNERS file is the source of
  truth + a doc `docs/agents/REVIEWERS.md` lists the people behind
  the GitHub usernames.
