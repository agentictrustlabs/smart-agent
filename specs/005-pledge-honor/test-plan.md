# Spec 005 — Test Plan

> **Owners**: Tester + QA + Test User.
> **Bound to**: `plan.md`, `contracts.md`, `settlement-rails.md`.

## 1. Unit tests (Forge — `packages/contracts/test/`)

### MockUSDC

| ID | Test | Expected |
|---|---|---|
| U-USDC-1 | `mint(to, 1000)` increments balance | ✓ |
| U-USDC-2 | `transfer` between two addresses | balances move; Transfer event |
| U-USDC-3 | `decimals()` returns 6 | ✓ |

### AgentAccount.executeBatch

| ID | Test | Expected |
|---|---|---|
| U-AA-1 | DelegationManager → executeBatch with 2 calls succeeds | both inner calls fire, msg.sender == account |
| U-AA-2 | One inner call reverts | entire batch reverts; no state change |
| U-AA-3 | Direct caller (not EntryPoint / self / DM) blocked | reverts |
| U-AA-4 | Empty batch | no-op, no revert |
| U-AA-5 | 10-element batch with mixed targets | all fire in order |

### PledgeRegistry.recordHonor

| ID | Test | Expected |
|---|---|---|
| U-PR-H-1 | `recordHonor(subj, treasury, USDC, 100)` from `treasury` increments honored to 100 | event emitted; `getSettlement(subj, USDC).honored == 100` |
| U-PR-H-2 | Second call (`+50`) accumulates | honored == 150 |
| U-PR-H-3 | `recordHonor` from non-treasury caller | reverts with `NotPoolOperator` |
| U-PR-H-4 | `recordHonor(token=0x0)` | reverts with `InvalidToken` |
| U-PR-H-5 | `recordHonor` causing `honored + external > committed` | reverts with `PledgeAmountExceedsCommitted` |
| U-PR-H-6 | `recordHonor` causing exactly `honored + external == committed` | status flips to `sa:PledgeFullyHonored`; `PledgeFullyHonored` event emitted |
| U-PR-H-7 | `recordHonor` updates `pledgeHonorTokenList` (new token) | list contains the token |
| U-PR-H-8 | Multi-token: honor in token A then token B | both lists tracked separately; status only flips per-token |

### PledgeRegistry.markPaid

| ID | Test | Expected |
|---|---|---|
| U-PR-M-1 | Fund admin calls markPaid with valid evidence hash | event emitted; externallyPaid incremented |
| U-PR-M-2 | Non-admin calls markPaid | reverts with `NotPoolOperator` |
| U-PR-M-3 | `markPaid(evidenceHash=0x0)` | reverts with `EvidenceHashRequired` |
| U-PR-M-4 | `markPaid` causing total > committed | reverts |
| U-PR-M-5 | `markPaid` sets `pledgePaymentRail`, `pledgeEvidenceHash`, `pledgeMarkedByAgent`, `pledgeLastMarkedAt` | all four fields written |
| U-PR-M-6 | `markPaid` then `recordHonor` both contribute to settled total | external + honored == settled |

## 2. Integration tests (`apps/web/test/`)

| ID | Scenario | Expected |
|---|---|---|
| I-1 | `provisionPersonalTreasury` for a passkey user | treasury deployed; `sa:hasPersonalTreasury` set on person agent; passkey is owner of treasury |
| I-2 | `fundLocalTreasury` (idempotent) | mints to 100k USDC on first call; no-op when already at 100k |
| I-3 | `addRoundVoter` issues cred to a demo user | cred lands at `person_<userId>/default` (existing path) |
| I-4 | Build + sign honor sub-delegation | calldata hash matches; sig recovers to passkey owner via ERC-1271 |
| I-5 | Calldata hash mismatch | redeem reverts with caveat-enforcer revert |
| I-6 | A2A redeem of honor batch | both inner txs land; events emitted |
| I-7 | `pledgeHonor.action.ts` returns `{ ok: true, txHash }` | downstream reader reflects new honored amount |
| I-8 | `markPaid` action stores evidence in org-mcp + writes chain | both happen; hash matches |
| I-9 | Reader returns settlement for a pledge with both rails populated | both totals + rail + evidence visible |

## 3. E2E walkthroughs (Test User)

### E1. Passkey user end-to-end honor

1. Sign in as a passkey user `joe.agent`.
2. Personal treasury auto-provisioned at first login; dashboard shows 100,000 USDC.
3. Browse a pool, pledge $100 USD.
4. Open pledge detail; click "Honor pledge"; enter $40.
5. Sign with passkey on confirmation modal showing calldata hash.
6. Wait for tx receipt.
7. Pledge detail now shows: `$40 honored / $100 pledged`. Treasury balance: $99,960.
8. Pool detail shows pledge: `$40 of $100 settled`.

### E2. SIWE user same as E1
Substituting SIWE auth flow. Same end state.

### E3. Demo user honoring (existing privateKey path)
Tests that the demo-EOA-based signing path works alongside passkey/SIWE.

### E4. Admin marks external payment

1. Sign in as round operator (passkey user who created the pool).
2. Open pool steward view → pledge list.
3. Select a pledge that someone else made; click "Mark paid externally".
4. Form:
   - amount = $30
   - token = USDC
   - rail = Bank transfer
   - upload a sample PDF receipt
5. Sign with passkey.
6. Pledge now shows: `$X honored + $30 externally paid / $100 pledged`.
7. Evidence link present on pledge detail (admin-viewable in v1).

### E5. Combined honor + external (no double-count)

Run E1 ($40 honored) then E4 ($30 marked) on the same pledge.
Expected: `$70 settled / $100 pledged`, `$30 remaining`. Two events on chain.

### E6. Non-USDC pledge (Rail B only)

1. Create a pool accepting `prayer-minutes`.
2. Pledge 200 prayer-minutes.
3. Pledge detail shows "Honor via external mark-paid only" — no Rail A button.
4. As pool admin, mark 100 prayer-minutes paid with rail=inKind + evidence (log file).
5. Pledge shows: `100 of 200 prayer-minutes settled (inKind)`.

### E7. Fully honored status

1. Pledge $100, honor $100 in one shot via Rail A.
2. `PledgeFullyHonored` event fires; status updates.
3. Pledge detail surfaces "Fully honored" badge.

### E8. Insufficient treasury balance

1. Treasury holds $50 USDC.
2. Try to honor $100.
3. `USDC.transfer` reverts inside `executeBatch`; entire batch reverts.
4. No `recordHonor` written; UI shows error "insufficient balance".

### E9. Non-admin tries to mark-paid

1. Demo user (not pool admin) opens the pool's steward URL (URL guessing).
2. Page either shows "not authorized" surface OR — if they bypass UI — the API call reverts on chain with `NotPoolOperator`.

### E10. Evidence hash mismatch (detection)

1. Admin uploads PDF → web computes hash → markPaid records it.
2. Later, someone receives the PDF and recomputes sha256.
3. Hashes match → evidence is unmodified.
4. (Mutation test): manually edit the stored blob; recompute → mismatch → integrity violation detected.

## 4. Performance budget (post-R8)

- Per-pledge reader latency: ≤ 200 ms (includes 1 RPC for honored, 1 for external, 1 for tokens list, 1 for status). Acceptable for single-pledge detail page.
- Pool aggregate (sum across all pledges): O(pledges × tokens). Cap at 100 pledges per pool in v1; beyond that, add an indexer.

## 5. Acceptance gates per phase

| Phase | Acceptance |
|---|---|
| 2. Contracts | All U-* tests pass; `forge test` green |
| 3. Infra | `fresh-start.sh` deploys MockUSDC + mints to all demo treasuries |
| 4. SDK | `buildHonorBatchCalldata` matches a hand-computed reference encoding |
| 5. Web actions + MCP | I-1 through I-9 green |
| 6. UI | E1, E4 manual walkthroughs succeed; UI shows correct settled totals |
| 7. Tests | All E* manual walkthroughs documented as passing; one passkey + one SIWE + one demo |

## 6. Regression cover

After implementing spec 005, re-run spec 004 acceptance:
- Pledge creation still works.
- Vote / proposal flows unchanged.
- The R8 readers still return correct (now-extended) pledge rows.
- `fresh-start.sh` re-seeds end-to-end without manual intervention.
