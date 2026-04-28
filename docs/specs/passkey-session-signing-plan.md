# PM Plan: Passkey-Rooted Delegated Session Signing

> **Status**: post-audit. All Critical and High findings from
> [`../architecture/passkey-session-signing-review.md`](../architecture/passkey-session-signing-review.md)
> are resolved in the design doc and reflected in the milestone
> deliverables below.
>
> **Sister design doc**: [`../architecture/passkey-session-signing.md`](../architecture/passkey-session-signing.md).
> This file owns scope, milestones, decisions, and risk register.
> Architecture rationale lives in the design doc; don't duplicate it
> here.
>
> **No backward compatibility constraint.** The codebase has no
> production users and `scripts/fresh-start.sh` resets all on-chain
> and DB state. Each milestone deletes the code it replaces in the
> same merge sequence that adds the new code. No feature flags, no
> parallel runs, no migration windows.

## Outcomes

| Dimension | Today | After |
| --- | --- | --- |
| **Signup prompts** | 3 (create + A2A + wallet) | 2 (create + grant) |
| **Sign-in prompts** | 2 (3 first-time) | 1 |
| **Normal action prompts** (Discover Agents, Test verification, Get credential) | 1 per action | 0 |
| **High-risk action prompts** (add/remove passkey, recovery, broad delegation, on-chain value) | 1 per action | 1 per action (unchanged, with context modal) |
| **Threat model** | Per-action passkey root | Capability-bounded session signer + passkey root for high-risk |
| **Revocation latency** | n/a (no session) | <1 second (revocation epoch) |
| **Auditability** | No per-action log | Append-only audit log per account |

## Milestone breakdown

Four milestones plus a stretch backlog. Each milestone deletes the
code it replaces; nothing carries forward as a fallback. After every
milestone, run `./scripts/fresh-start.sh` and exercise the demo
end-to-end before moving on.

### M1 — Schemas, verifier, and grant-issuance ceremony

Goal: land the data shapes, the verification function, and the
sign-in ceremony that produces a `SessionGrant`. After M1, sign-in
already costs only one passkey ceremony — but app actions are still
brokered the old way (we tear that down in M2).

**Deliverables**
- `packages/privacy-creds/src/session-grant/`
  - `types.ts` — `SessionGrantV1`, `WalletActionV1`, `SessionRecord`,
    `AuditLogEntry`, `ActorEnvelope` per design doc §4.
  - `canonicalize.ts` — RFC 8785 JSON-c14n + sha256.
  - `derive-challenge.ts` — WebAuthn challenge derivation per
    design doc §8.2.
  - `risk-classifier.ts` — **shared** `classifyRisk(actionType)` with a
    hard-coded table mapping every supported `WalletAction.type` to
    `'low' | 'medium' | 'high'`. Imported by both web (dispatch) and
    person-mcp (verifier). Resolves audit C2 + C4.
- `apps/web/src/lib/key-custody/` — single environment-wide KMS
  master key + HKDF derivation. Implementations:
  - `dev-pepper` (local; master IKM derived from `SERVER_PEPPER`).
  - `aws-kms` / `gcp-kms` for production.
  Resolves audit H1.
- `apps/web/src/lib/auth/session-cookie.ts` — `SESSION_COOKIE_NAME`
  switches between `__Host-session` (production) and `session`
  (dev). Resolves audit C7.
- `apps/web/src/app/api/auth/session-grant/start/route.ts` —
  builds the grant, derives WebAuthn challenge, returns
  `{ grant, challenge, sessionId }`.
- `apps/web/src/app/api/auth/session-grant/finalize/route.ts` —
  receives the WebAuthn assertion, verifies via ERC-1271 on
  AgentAccount **once**, persists `SessionRecord` including
  `verifiedPasskeyPubkey`. Replaces the legacy `passkey-verify`
  route (audit C3).
- `apps/person-mcp/src/auth/verify-delegated-action.ts` —
  `verifyDelegatedWalletAction(input, ctx)` per design doc §5.
  No on-chain calls per action — reads `SessionRecord` only.
  Resolves audit C1.
- `apps/person-mcp/src/audit/log.ts` — append-only audit store
  with `prevEntryHash` chain + `INSERT`-only IAM. Includes
  `/audit/append` endpoint that `apps/web` posts events to.
  Resolves audit C6.
- `apps/web/src/app/api/auth/recovery/finalize/route.ts` (extended)
  — calls `revocationStore.bumpEpoch(smartAccountAddress)` in the
  same transaction as the on-chain passkey rotation. Resolves
  audit H7.
- Sign-in flow refactored: single-ceremony per design doc §3.2,
  with `userVerification: 'required'` (audit H3) and pre-prompt
  approval banner (§10).
- Unit tests for every reject path in `verifyDelegatedWalletAction`
  (~30 cases per design doc §5 + §7).

**Acceptance**
- Sign-in is exactly **one** WebAuthn ceremony — verified by the
  per-flow prompt count not the goal copy.
- Zero on-chain calls per action — verified by stubbing the chain
  RPC and confirming verifier still works.
- Risk classifier lives in one file; web and person-mcp both import
  from `@smart-agent/privacy-creds/session-grant/risk-classifier`.
- Cookie name varies by env; dev runs on HTTP localhost without
  cookie issues.
- `SessionRecord` carries `verifiedPasskeyPubkey`; verifier reads it
  rather than re-running ERC-1271.
- Recovery flow bumps `revocationEpoch`; existing sessions denied on
  next request (regression test).
- After fresh-start, demo + passkey users sign in cleanly with one
  ceremony.

**Effort**: ~7 engineer-days (was 5; +2 for resolved audit findings).

### M2 — Replace per-action passkey with session signing (SSI low/medium-risk)

Goal: every low/medium-risk SSI action now signs through the session
signer. The old `signWalletActionClient` browser path is **deleted**
for these actions in the same PR sequence.

**Action coverage in M2**:
- `MatchAgainstPublicSet` — trust search.
- `ProvisionHolderWallet` — wallet provisioning (now part of the
  one-shot signin grant, not a separate ceremony).
- `ssi_list_my_credentials`, `ssi_get_credential_details`.
- `AcceptCredentialOffer` — credential issuance.

`CreatePresentation` and other privacy-sensitive actions stay on the
direct-passkey path; they move to the session in M3 with caveats.

**Deliverables**
- `apps/web/src/lib/wallet-action/dispatch.ts` — single entry point.
  Imports `classifyRisk` from
  `@smart-agent/privacy-creds/session-grant/risk-classifier` (the
  same module the verifier uses — no per-app duplicate). Routes:
  - low/medium + scope match → server-side session signer.
  - high → browser passkey ceremony (the existing
    `signWalletActionClient` path stays for high-risk only).
- person-mcp adds the delegated endpoint that wraps `ssi_*` tools
  behind `verifyDelegatedWalletAction(input, { serviceName: 'person-mcp' })`.
- Rate-limit store + per-session counter (resolves audit M4):
  enforces `scope.maxActions` and `scope.maxActionsPerMinute`.
- `ActorEnvelope` propagation (audit H6): the dispatch layer attaches
  `{ sub, act, aud, scope, sessionId }` when calling person-mcp; the
  verifier validates via re-load of SessionRecord.
- **Delete** the per-action passkey-prompt code paths in:
  - `apps/web/src/components/trust/AgentTrustSearch.tsx`
  - `apps/web/src/components/org/HeldCredentialsPanel.tsx` (the
    test-verification ceremony, only for known-verifier path)
  - `apps/web/src/components/profile/AddGeoClaimPanel.tsx` (the
    issuance ceremony — ProvisionHolderWallet ceremony moves to
    sign-in grant)
  - `apps/web/src/lib/credentials/IssueCredentialDialog.tsx`
    (issuance acceptance ceremony)
- Update `signWalletActionClient` to be **only** the high-risk
  path; rename to `signWalletActionPasskey` to make this explicit.

**Acceptance**
- Discover Agents, Get credential, ProvisionHolderWallet: 0 prompts.
- Test verification (Trusted Auditor): still 1 prompt — moves to 0
  in M3.
- High-risk actions (add passkey, recovery) still prompt.
- Audit log shows `decision: allowed` for every session-routed
  action.
- p99 latency for session-signed actions ≤ 100ms.

**Effort**: ~5 engineer-days.

### M3 — Verifier allowlist + presentation through session

Goal: presentation creation moves to the session path when the
verifier is known and no raw attribute reveal is requested.

**Deliverables**
- `apps/verifier-mcp/src/registry.ts` — verifier allowlist with the
  Trusted Auditor as the seed entry. Adding a verifier requires a
  documented PR.
- `enforceVerifierPolicy`, `enforceCredentialPolicy`,
  `enforceRevealPolicy` in `verifyDelegatedWalletAction`.
- Dispatch layer detects session-eligible vs high-risk presentation
  and routes accordingly.

**Acceptance**
- Test verification (Trusted Auditor, no reveal): 0 prompts.
- Presenting to an unknown verifier or with raw reveal: passkey
  ceremony with the §10 high-risk context modal.
- Audit log shows verifier DID for every presentation decision.

**Effort**: ~3 engineer-days.

### M4 — A2A consumes the unified session (delete the old A2A session)

Goal: A2A becomes a consumer of the unified `SessionRecord`. The
parallel session-EOA machinery is **deleted**, not deprecated.

**Deliverables**
- Refactor `apps/a2a-agent/src/routes/delegation.ts` to read the
  session signer's keyref from the shared `SessionRecord` store.
- `mintDelegationToken` in `packages/sdk/src/delegation-token.ts`
  becomes a thin wrapper that derives a per-call JWT from the
  unified `SessionGrant.v1`. JWT carries `sub / act / aud / scope /
  grantId` (RFC 8693 shape).
- **Delete**:
  - `packages/sdk/src/session.ts` (`createAgentSession`).
  - `apps/a2a-agent/src/routes/session.ts` (A2A's session-EOA
    minting route).
  - All callers of `createAgentSession` updated to use the unified
    sign-in grant path.
- Audit log entries from A2A and SSI share one append-only store.

**Acceptance**
- One `SessionRecord` per (user, device) governs both A2A and SSI.
- `revocationEpoch` mismatch denies both A2A and SSI on the same
  request.
- "Active sessions" Settings view shows one row per device with
  combined scope.
- After fresh-start: end-to-end demo passes (signup, A2A bootstrap,
  SSI ops, presentation, sign out everywhere).
- `git grep -E 'createAgentSession|sessionPrivateKey'` returns zero
  hits in `apps/` and `packages/sdk/`.

**Effort**: ~4 engineer-days.

### M5 — Settings UX, observability, and pen-test prep

Goal: make sessions a first-class user-facing concept and confirm
the security posture before declaring done.

**Deliverables**
- Settings → Active sessions: list with last-use time, IP/UA,
  scope summary, per-session revoke.
- Settings → Recent activity: tail of audit log entries scoped to
  the current account.
- "Sign out everywhere" → bumps `revocationEpoch`.
- Observability dashboards: prompts-per-session,
  actions-by-risk-tier, denials-by-reason, KMS rotation cadence.
- Anomaly rules: foreign-IP delta within session, rate spike,
  off-hours soft alert.
- Pen-test scenarios documented and run:
  - stolen cookie + replay (different IP),
  - scope inflation attempt,
  - forged audience (unknown service name),
  - expired grant,
  - revocation epoch mismatch,
  - **LLM-injection via A2A endpoint** that crafts a
    high-risk WalletAction payload — verifier rejects on
    server-side risk classification (audit M8 + C2),
  - **chain RPC outage** during normal operation — session-signed
    actions continue to work (audit C1),
  - **per-action ECDSA tampering** — modified action body fails
    signature check.

**Acceptance**
- Settings page renders sessions + activity for any signed-in user.
- "Sign out everywhere" invalidates all sessions in <1 second.
- Dashboards wired with alerting thresholds.
- Pen-test report attached to this doc with all scenarios passing.

**Effort**: ~4 engineer-days + 1 day pen-test.

### Backlog (post-M5)

- Automated session-signer key rotation on every sign-in (one
  signer per session, never reused). Already implied by short TTL
  + new signer at sign-in; backlog item is the audit log integrity
  check + rotation telemetry.
- Per-tool fine-grained scope (today scope is by
  `WalletAction.type`; future adds per-tool caveats).
- ERC-7710 / ERC-7715 alignment so the same grant could be
  redeemable on chain in the future.
- Optional on-chain verifier validator-module pathway (ERC-7579).

## Decision points

The audit review locked the architectural decisions (audit H1–H7;
recorded in design doc §16). The remaining product/operational
decisions:

1. **Risk classification list** (design doc §6) — confirm low/medium/
   high split. Particular concern: **"Get geo credential"** — is it
   low-risk, or always-passkey? My read of the demo: low-risk (it's
   just receiving a vault credential).

2. **Session lifetime** — proposed default is **8 hours hard TTL**
   with **30 minute idle timeout** (design doc §3.7). Acceptable,
   or shorter (1h hard)?

3. **Verifier allowlist scope (M3)** — currently `verifier-mcp`
   Trusted Auditor is the only entry. Should the allowlist be:
   (a) global; (b) per-hub; (c) per-user. Recommendation: (a) for
   v1, revisit if hubs need divergent policies.

4. **Production KMS provider** — AWS KMS / GCP KMS / Azure Key Vault /
   TEE for the single environment-wide master key (design doc §8.4).
   Dev runs on `SERVER_PEPPER`-derived; this decision only blocks
   production cutover.

5. **Audit-log retention** — 30 days hot, 1 year cold? Compliance
   answer needed before M5.

6. **High-risk policy ceiling for value transfers** — for any future
   on-chain write of value, do we want a **second** always-prompt
   tier that even passkey-with-recent-ceremony can't satisfy without
   a fresh prompt? Recommendation: yes, design for this in M1 schema
   even if no action requires it yet.

## Risk register (project / engineering risks)

| Risk | Likelihood | Severity | Mitigation |
| --- | --- | --- | --- |
| KMS provider unavailable in target environments | Med | High | Ship dev-encrypted-db first; KMS abstraction makes production swap a config change. |
| Refactoring `signWalletActionClient` callsites at scale | Low | Med | Single dispatch entry point in M2. Touch list is bounded (4 components). |
| Conditional UI / WebAuthn quirks differ across browsers | Med | Low | Already handled in current conditional-UI sign-in. Same matrix applies. |
| Scope creep: adding actions to whitelist without review | High (organizationally) | High | Written change-control: every scope schema change requires a doc PR + security sign-off. |
| Cookie / CSRF / XSS gaps | Med | Critical | M1 lands `__Host-` cookies, strict CSP, per-request CSRF tokens. Pen-test in M5 covers these. |
| Time skew between web app and person-mcp | Low | Med | Server clock from one source; NTP-synced fleet; verifier uses its own clock. |
| Audit log fills up | Med | Low | Async write queue with backpressure; 30-day hot + cold archive. |
| Old A2A session code lingers after M4 (zombie deps) | Med | Med | M4 acceptance includes `git grep` checks for the deleted symbols. CI lint fails if they reappear. |

## Rollout plan

No cohorts, no migration, no flags. After each milestone:

1. `./scripts/fresh-start.sh` resets all state.
2. Smoke-test the canonical demo flow (sign up, sign in, Discover
   Agents, Get credential, Test verification, Sign out everywhere).
3. Merge to `master`.

The PR sequence within a milestone may stage changes (schema before
verifier, verifier before refactor), but each milestone lands as one
coherent set; nothing is half-replaced across milestones.

## Success metrics

Quantitative gates we'd measure post-rollout, with target values:

| Metric | Target | Source |
| --- | --- | --- |
| Prompts per active session (median) | ≤ 1.0 (signup is 2) | Audit log + session lifecycle telemetry |
| Time-to-first-Discover-Agents-result on sign-in | ≤ 4 sec p50 | Front-end timing |
| Session-signed action failure rate | ≤ 0.1% | `decision: denied` rate excluding high-risk-passthrough |
| Active session count per user (median) | 1–2 | SessionRecord query |
| Mean time to revoke (user click → action denial) | ≤ 1 second | Synthetic monitor |
| Pen-test scenarios passing | 100% | M5 acceptance |
| `git grep -E 'createAgentSession\|sessionPrivateKey'` in `apps/`+`packages/sdk/` | 0 hits | M4 acceptance |

## Definition of done

The project is "done" when:

1. M1–M5 are merged.
2. Acceptance criteria in design doc §13 pass after a fresh-start.
3. Pen-test report from an external reviewer signs off on §7
   mitigations.
4. Documentation updated:
   - `docs/architecture/passkey-session-signing.md` — finalized.
   - `docs/architecture/auth-and-onboarding.md` — references the new
     flow as the only flow.
   - `docs/architecture/anoncreds-ssi-flow.md` — §6 sequence diagrams
     updated to show session-signer path for low-risk SSI ops.
5. Old code deleted (no flags, no fallbacks):
   - `packages/sdk/src/session.ts` (`createAgentSession`)
   - `apps/a2a-agent/src/routes/session.ts`
   - Per-action passkey ceremonies for low/medium-risk actions.
6. Backlog tickets filed for the post-M5 items.

## Owners

| Workstream | Primary owner | Backup |
| --- | --- | --- |
| Schema + verifier (M0) | TBD eng | TBD |
| Sign-in flow + KMS abstraction (M1) | TBD eng | TBD |
| Dispatch + person-mcp wiring (M2) | TBD eng | TBD |
| Verifier allowlist + presentation policy (M3) | TBD eng + security | TBD |
| Sessions UX + observability (M4) | TBD eng + design | TBD |
| External pen-test | TBD security firm | — |
| Product decisions (the seven above) | Product owner | Engineering lead |

## Timeline (rough)

Assuming one engineer full-time + standard review cycles. Scope
increased after audit (M1 carries the resolved-finding work).

| Week | Deliverable |
| --- | --- |
| 1 | Decisions 1–6 confirmed; M1 begins |
| 2 | M1 in progress (schemas, classifier, key-custody, ceremony rewrite) |
| 3 | M1 ships (single-ceremony signin, cached ERC-1271, audit log live) |
| 4 | M2 ships (low/medium SSI on session signer; per-action passkey deleted) |
| 5 | M3 ships (presentations on session for known verifiers) |
| 6 | M4 ships (A2A consumes unified session; old session-EOA code deleted) |
| 7 | M5 ships (Settings UX, dashboards, pen-test) |

Total: **~7 weeks** from confirmed decisions to done. With 2 engineers
in parallel from M2 onward, ~5 weeks. Each Friday: fresh-start, run
the demo, sign off, merge.
