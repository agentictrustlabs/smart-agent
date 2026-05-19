# Demo feature tests — matrix

Each row maps a chapter of the proposal-funding demo video to ONE
specific feature with ONE clear assertion. Each test is runnable in
isolation (`pnpm exec playwright test --grep "T<N>"`) against a running
local stack so you can debug feature-by-feature.

Test file: `tests/e2e/demo-features.spec.ts`.

| #     | Test name (used with `--grep`)            | Video chapter it covers                  | Touches (services)               | Hard pass criterion (the assert)                                                                                          |
|-------|-------------------------------------------|------------------------------------------|----------------------------------|---------------------------------------------------------------------------------------------------------------------------|
| T1    | `auth-demo-login`                          | Ch.1 Maria signs in                      | web + a2a-agent                  | `/api/demo-login` returns 200, sets `a2a-session` cookie, follow-up `GET /api/auth/session` returns Maria's principal      |
| T2    | `hub-home-render`                          | Ch.2 Maria's hub                         | web + hub-mcp                    | `GET /h/catalyst/home` renders with the user's display name and at least one hub-card present                              |
| T3    | `personal-treasury-balance`                | Ch.3 Maria's treasury                    | web + on-chain                   | `/wallet` shows the user's Treasury Service Agent address AND MockUSDC.balanceOf(treasury) > 0                             |
| T4    | `pool-funded`                              | Ch.4 The pool                            | web + on-chain                   | Pool's MockUSDC balance equals the pledged amount (post-honor)                                                            |
| T5    | `round-open`                               | Ch.5 The round                           | web + on-chain                   | `FundRegistry.getRoundStatus(roundSubject)` is in `{review, decided, awarded}`; validators list is non-empty               |
| T6    | `intent-fetch`                             | Ch.6 David's NeedIntent                  | web + person-mcp                 | David's intent page renders without 500; body contains the intent's title                                                  |
| T7    | `proposal-awarded`                         | Ch.7 The proposal                        | web + on-chain                   | `GrantProposalRegistry.getStatus(proposalSubject)` == `sa:GpAwarded`; `CommitmentRegistry.getCommitment(...)` is populated |
| T8    | `validator-inbox-renders`                  | Ch.8 Sarah's inbox                       | web + hub-mcp + on-chain         | `GET /h/catalyst/tasks?commitment=<X>` (as Sarah) renders ≥1 `data-task-kind="attestation"` row matching `<X>`             |
| T9    | `record-outcome-onchain`                   | Ch.9-10 Sarah attests m1+m2              | web + org-mcp + a2a + on-chain   | After two recordOutcome calls, `CommitmentRegistry.getOutcome` returns `recordedAt > 0` for both m1 and m2                |
| T10   | `steward-inbox-renders`                    | Ch.11 Maria's release inbox              | web + hub-mcp + on-chain         | `GET /h/catalyst/tasks?commitment=<X>` (as Maria) renders ≥1 `data-task-kind="release"` row matching `<X>`                |
| T11   | `release-tranche-rail-a`                   | Ch.12-13 Maria releases m1+m2            | web + on-chain (donor-EOA Rail A) | After two releaseTranche calls, `getMilestoneRelease(commitment, mId)` returns `amount > 0` for both milestones            |
| T12   | `pool-drained`                             | Ch.14 Pool at $0                         | on-chain                         | After all releases, `MockUSDC.balanceOf(pool)` == 0                                                                       |
| T13   | `fort-collins-treasury-grew`               | Ch.15 Treasury delta                     | on-chain                         | `MockUSDC.balanceOf(fortCollinsTreasury)` grew by exactly $30,000 from the pre-release baseline                            |

## Setup model

- Tests assume the local stack is up. `scripts/fresh-start.sh --minimal`
  is the canonical bring-up.
- The grant-flow demo seed (`scripts/seed-grant-flow-demo.ts`) runs ONCE
  at the start of the file via a global setup. The commitment subject,
  pool address, milestone IDs, etc. land in a shared
  `demoData` object the tests read.
- Tests T1-T7 are **read-only or auth-only** — they only verify
  prerequisites + initial state. They run fast (<5s each) and don't
  mutate chain or DB state.
- Tests T8-T13 do **state mutation** — they must run in order if
  re-using the same seed. Each one is also runnable in isolation if
  the prior state is already on chain (the assertion is on the END
  state, not on the transition).

## Run cookbook

```bash
# Full pass (~2 min after seed):
pnpm exec playwright test tests/e2e/demo-features.spec.ts \
  --config tests/e2e/playwright.config.ts \
  --reporter=line

# Just one feature (debugging):
pnpm exec playwright test tests/e2e/demo-features.spec.ts \
  --config tests/e2e/playwright.config.ts \
  --grep "T9 record-outcome-onchain" \
  --reporter=line

# Read-only sanity (T1-T7 only — fastest, no state mutation):
pnpm exec playwright test tests/e2e/demo-features.spec.ts \
  --config tests/e2e/playwright.config.ts \
  --grep "T[1-7] " \
  --reporter=line
```

## Failure modes per test (debug map)

| Test fails | First place to look                                                                  |
|-----------|---------------------------------------------------------------------------------------|
| T1 auth-demo-login | `apps/web/src/app/api/demo-login/route.ts`; `bootstrapA2ASessionForUser`        |
| T2 hub-home-render | Next.js compile in `apps/web/.next`; `apps/web/src/lib/contracts.ts` SDK leak    |
| T3 personal-treasury-balance | `scripts/seed-catalyst-onchain.ts` treasury deploy step; `deploy-local.sh` USDC mint |
| T4 pool-funded | `scripts/seed-grant-flow-demo.ts` STEP 5 honor (`redeemThroughDonor`); AgentAccount.executeBatch reentrancy |
| T5 round-open | `scripts/seed-grant-flow-demo.ts` STEP 6 openRound; FundRegistry seeded validators list |
| T6 intent-fetch | `apps/person-mcp/src/tools/intent.ts`; web's intent page route                   |
| T7 proposal-awarded | `scripts/seed-grant-flow-demo.ts` STEPS 7-10 (submit / vote / announce / commit) |
| T8 validator-inbox-renders | `apps/web/src/app/h/[hubId]/(hub)/tasks/page.tsx`; `listInboxTasks`         |
| T9 record-outcome-onchain | `apps/web/src/lib/actions/commitments.action.ts` (recordOutcome); MCP `/redeem-via-account`; session-key gas funding |
| T10 steward-inbox-renders | same as T8 but viewer = Maria; depends on T9 having landed outcomes        |
| T11 release-tranche-rail-a | `apps/web/src/lib/actions/commitments.action.ts` (releaseTranche); Rail-A donor delegation |
| T12 pool-drained | depends on T11; pool USDC drains via Rail-A executeBatch                          |
| T13 fort-collins-treasury-grew | recipient resolution in `getCommitment`; T11 success                       |

## What this surfaces

Each test failure points at exactly ONE subsystem to look at. Today's
known gaps (from `delegation-implementation-audit.md`):

- T9 expected to fail: session-key reuse bug (web hits old session in
  the sessions table; the freshest one isn't picked). Fix landed in
  `apps/a2a-agent/src/routes/mcp-proxy.ts` (orderBy desc on createdAt)
  but needs a fresh-start to validate.
- T11 was the original "Rail A executeBatch reverts with `0x3ee5aeb5`"
  reentrancy bug — fix landed in `AgentAccount.executeBatch`
  (`nonReentrant` removed); needs contract redeploy via fresh-start.
- High-value MCP tools (`pool:close`, `round:close`,
  `round:cancel`, `round:set_awards_root`) are NOT exercised by these
  tests because the demo doesn't use them — but the
  `/redeem-subdelegated` server endpoint is also missing
  (`delegation-implementation-audit.md` Invariant 9). Tracked
  separately; not blocking the demo.
