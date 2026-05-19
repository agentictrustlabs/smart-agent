# SC8 — Testnet Rehearsal

> **Status**: Draft. Schedule against SC1 timeline.
> **Audience**: infra (owner), engineering manager (sponsor), security
> lead (acceptance signoff).
> **Document type**: Operations plan + acceptance criteria.
> **Prerequisite**: SC1 final report public + remediation deployed; SC4
> governance multisig deployed; SC7 storage-layout discipline locked in.
> **Pairs with**: SC3 (testnet-only bug bounty during this rehearsal).

---

## 1. Purpose

Before mainnet, the system must run on a public Ethereum testnet for a
**4-week soak period** under realistic operational conditions:

- Real KMS (AWS or GCP), not LocalStack.
- Real bundler operation (our own per SC6 §5.1, with KMS keys
  exercising the rotation cadence).
- Real `Governance` multisig with hardware-wallet-backed signers.
- Realistic load (synthetic + community participation).
- All paths exercised end-to-end: register, deploy account, sign
  delegations, redeem, upgrade, rotate keys, emergency pause.

The output is an **externally-observable transcript** (block explorer
links, public report) demonstrating system maturity.

[DECISION] Testnet: **Sepolia**. (Holesky is acceptable alternate;
Goerli is deprecated as of 2026.) Sepolia is the canonical Ethereum
mainnet rehearsal target.

---

## 2. Scope

### 2.1 In-scope

- Full contract deployment via `scripts/deploy-local.sh` adapted for
  Sepolia.
- KMS in cloud (AWS production-tier or GCP equivalent) — no
  LocalStack.
- All MCPs running in cloud (Vercel / GCP Cloud Run / equivalent),
  not localhost.
- All `apps/web` running in cloud.
- Real ENS-style name registration via AgentNameRegistry.
- Real ERC-4337 EntryPoint v0.7 / v0.8 (whichever Phase A landed)
  on Sepolia.
- Real Pimlico / Alchemy / Stackup public bundler API (for
  comparison metrics) AND our own bundler.

### 2.2 Out-of-scope

- Mainnet ETH. Use Sepolia ETH (faucets).
- Real user PII. Use synthetic demo users.
- Real money pledges. Use MockUSDC (the spec 005 dev token).

### 2.3 Test population

- 50 synthetic demo agent accounts (split: 30 individual, 15 org,
  5 fund).
- 5 internal team members operating their own accounts via real
  passkeys.
- 10 external invited testers (security researchers, community
  members).
- 5 multisig signers operating hardware wallets.

---

## 3. Deployment plan

### 3.1 Pre-deployment

- [ ] SC1 final report published.
- [ ] SC1 remediation deployed and re-reviewed.
- [ ] SC4 Governance.sol audited and ready.
- [ ] SC7 storage-layout snapshots locked in.
- [ ] KMS keys provisioned in production-tier cloud (per
      `output/KMS-IMPLEMENTATION-PLAN.md` Phase K2).
- [ ] All 9 multisig signers' hardware wallets provisioned + key
      ceremony complete.
- [ ] Monitoring stack live (Sentry + DataDog or equivalent;
      `docs/security/key-management/README.md` describes the KMS
      monitoring requirements).

### 3.2 Deployment day

1. Deploy `OntologyTermRegistry`, `ShapeRegistry`,
   `DelegationManager`, `AttributeStorage`-inheriting registries
   (in dependency order).
2. Deploy `AgentAccount` implementation singleton.
3. Deploy `AgentAccountFactory` with cloud KMS-derived
   `bundlerSigner` + `sessionIssuer` addresses.
4. Deploy `Governance.sol` with 9 multisig signers.
5. Transfer ownership of all governance-managed contracts to the
   multisig.
6. Deploy `SmartAgentPaymaster`; fund deposit at EntryPoint with
   1 ETH (Sepolia ETH).
7. Deploy caveat enforcers.
8. Run `scripts/deploy-local.sh --testnet sepolia` (or equivalent
   adapted script).
9. Run a smoke test: register one test agent, mint one delegation,
   redeem once, verify on Etherscan.
10. Publish deployment-summary post: contract addresses, multisig
    address, KMS key fingerprints, bundler address, monitoring
    dashboards.

### 3.3 Public deployment post

Within 24 hours of deployment, publish:

- A blog post on our security page.
- A pinned post in community channels.
- Etherscan-verified contract source for every deployed contract.
- Block-explorer URLs in a stable directory at
  `docs/runbooks/sepolia-rehearsal-addresses.md`.

---

## 4. Test plan

### 4.1 Path 1: register + deploy account

For each of 50 synthetic + 5 internal users:

1. User registers via web flow.
2. Passkey ceremony (real WebAuthn from browser).
3. `AgentAccountFactory.createAccount(owner, salt)` executes.
4. Verify on Etherscan: account deployed at expected counterfactual
   address.
5. Verify ENS name registered.

Expected output: 55 successful registrations. Failure mode: any
revert at deploy or any unexpected address.

### 4.2 Path 2: sign + redeem delegation

For 30 random users:

1. User signs a Variant A delegation (off-chain, EIP-712).
2. Session key submits redemption via a2a-agent → bundler → EntryPoint.
3. Verify `executeFromBundler` succeeds.
4. Verify all caveat enforcers fire (`AttributeSet` events or
   equivalent).
5. Verify target contract state updates.

Expected output: 30 successful redemptions.

### 4.3 Path 3: governance upgrade

1. Engineering manager queues a benign upgrade (e.g. update
   `AgentAccount.version()` from `2.2.0` to `2.2.1`).
2. 5 multisig signers approve via hardware wallets.
3. 48-hour timelock begins; public notice posted.
4. After timelock, `execute` called; new impl active.
5. Verify a fresh redemption uses the new impl (via the
   `version()` view).

Expected output: 1 successful governance upgrade, externally visible.

### 4.4 Path 4: emergency pause

1. Schedule a controlled pause exercise.
2. 5 multisig signers sign EMERGENCY_PAUSE digest.
3. One signer submits `emergencyPause(sigs)`.
4. Verify `paused == true`.
5. Verify subsequent writes to governance-managed contracts revert
   `SystemPaused`.
6. After 1 hour, queue Unpause proposal (48-hour timelock).
7. After timelock, execute; system resumes.

Expected output: 1 controlled pause + unpause cycle, externally
visible.

### 4.5 Path 5: bundler key rotation

1. Rotate the `bundlerSigner` KMS key (per KMS K7 rotation runbook).
2. Verify new key signs valid envelopes; old key's signatures
   rejected.
3. Verify no in-flight redemptions broken.

Expected output: 1 clean rotation.

### 4.6 Path 6: variant B session

1. User signs a userOp calling `acceptSessionDelegation(hash)`.
2. Subsequent session userOp using the registered delegation
   redeems.
3. Verify the on-chain registration via
   `hasAcceptedSessionDelegation(hash)`.

Expected output: 5 Variant B sessions across the 4-week period.

### 4.7 Path 7: pledge + honor (spec 005)

1. Donor (synthetic) pledges MockUSDC to a pool.
2. Pool steward initiates honor.
3. `executeBatch(USDC.transfer, PledgeRegistry.recordHonor)`
   redeemed via session delegation.
4. Verify USDC moved + honor recorded atomically.

Expected output: 10 pledges across the period; 5 honored.

### 4.8 Path 8: grant proposal (spec 003)

1. Org awards a proposal via `ProposalRegistry.announceAward`.
2. Verify the proposal is visible publicly.

Expected output: 5 proposals awarded.

### 4.9 Path 9: vote + dispute

Path 9 exercises the secondary lanes (Vote, Dispute, Review)
that landed pre-Phase-A. Verify each writes correctly.

### 4.10 Path 10: failure injection

Deliberately exercise failure paths:

- Submit an invalid signature → reverts.
- Submit a redemption past `validUntil` → reverts.
- Submit with insufficient gas → reverts gracefully.
- Submit with paymaster deposit drained → handled.
- Submit during pause → reverts.

Expected output: 10 failure cases, all gracefully handled, no
stuck state.

---

## 5. Soak load

### 5.1 Synthetic load generator

`packages/contracts/script/SepoliaSoakLoad.s.sol`:

- Cycles through paths 1-9 with randomized parameters.
- Runs 100 cycles per day.
- Target: 3,000 transactions over 4 weeks.

### 5.2 Real-user load

- 10 external invited testers run their own flows.
- Bug-bounty programme at testnet tier (SC3 §8.1) active.

### 5.3 Adversarial load

- Internal security team runs adversarial scenarios from SC5
  (malicious enforcers, malicious targets, etc.).
- Verify ReentrancyGuard mitigations hold under fuzz.

---

## 6. Monitoring

### 6.1 What we track

- Transaction success rate (target: > 99%).
- Revert rate by selector.
- Bundler latency p50 / p95 / p99 (target: p99 < 5s).
- Paymaster deposit balance (alert below 0.1 ETH).
- Monitor every event from every contract.
- Storage-layout drift (CI on every commit).
- KMS audit log volume.
- Multisig signer activity log.

### 6.2 Dashboards

- Public dashboard mirroring testnet metrics.
- Internal dashboard with full telemetry.
- Slack alerts for anomalies.

### 6.3 Anomaly detection

- Bundle revert rate > 1% sustained → page security lead.
- Bundler latency p99 > 30s → page infra.
- Paymaster deposit dropping > 0.05 ETH/hour → page infra.
- Any `SystemPaused` revert in normal operation → page security lead.
- Any failed `executeFromBundler` → page security lead.

---

## 7. Cost

### 7.1 Direct cost

- Sepolia ETH: free from faucets. Budget 5 ETH equivalent of
  faucet draw for soak (multiple faucet sources to avoid rate
  limits).
- KMS in production cloud: ~$50/month for our key + audit log
  volume (per `output/KMS-IMPLEMENTATION-PLAN.md` estimate).
- Cloud compute (Vercel + Cloud Run for MCPs): ~$200/month for
  the rehearsal scale.
- Monitoring (DataDog or equivalent): ~$300/month at this scale.
- **Total direct: ~$600 for 4 weeks.**

### 7.2 Loaded cost

- Infra engineer time: 0.5 FTE × 4 weeks = ~$30k.
- Security lead time: 0.2 FTE × 4 weeks = ~$12k.
- Multisig signer time: 1 hour/week per signer × 9 × 4 = 36
  hours total, ~$10k loaded.
- Testnet bounty payouts (per SC3 §8.1, 10% of mainnet tier):
  $25k for one Critical, $5k per High; budget reserve $30k.
- **Total loaded: ~$82k.**

---

## 8. Acceptance criteria

Rehearsal is "passed" when ALL of:

- [ ] 4 weeks elapsed since deployment.
- [ ] Zero unexpected reverts (defined: any revert not in path 10
      failure injection AND not from external researcher
      exploration).
- [ ] All paths 1-10 executed at least once successfully.
- [ ] At least 1 successful governance upgrade.
- [ ] At least 1 successful emergency pause + unpause cycle.
- [ ] At least 1 successful bundler key rotation.
- [ ] Paymaster deposit balance check at the end: matches expected
      (initial - sum of sponsored gas).
- [ ] No Critical or High findings from testnet bug bounty that
      remain unpatched.
- [ ] Storage layout matches pre-rehearsal snapshot (no drift).
- [ ] Monitoring dashboards retained for retrospective.
- [ ] Final retro published.

### 8.1 What constitutes a fail

If ANY of:

- A user fund (testnet MockUSDC) is lost in a way the user did not
  authorize.
- An unauthorized upgrade lands (governance bypass).
- The paymaster deposit drains unexpectedly (more than 2x the
  expected sponsored gas).
- An ERC-1271 forgery is found.
- A caveat enforcer is bypassed.
- A pause-then-write sequence executes the write.
- Storage layout drifts.

→ Rehearsal FAILS. Investigate root cause; patch; re-rehearsal for
another 2-4 weeks.

---

## 9. Public artifacts

### 9.1 Pre-rehearsal

- Deployment post (per §3.3).
- Bug-bounty programme page (testnet tier).
- Sepolia addresses runbook.
- Multisig signer roster (anonymized but with role labels).

### 9.2 During rehearsal

- Weekly progress posts (transaction count, paths exercised,
  notable findings).
- Real-time public dashboard.

### 9.3 Post-rehearsal

- Final retro post:
  - Total transactions.
  - Paths exercised.
  - Anomalies + resolutions.
  - Bug-bounty findings + patches.
  - Storage-layout, monitoring, KMS metrics summary.
- Etherscan-link directory.
- "What we learned" page.

These artifacts are the evidence base for the board mainnet sign-off.

---

## 10. Risks

| # | Risk | Mitigation |
|---|---|---|
| T1 | Sepolia goes down / forks; rehearsal interrupted. | Sepolia is the most stable testnet; if it does fall, pause rehearsal clock during outage. |
| T2 | Insufficient Sepolia ETH; faucet exhaustion. | Multiple faucet sources; partner with ETH Foundation if needed for larger draw. |
| T3 | Internal team boredom during 4-week soak. | Synthetic load generator runs automated; humans only respond to incidents. |
| T4 | Real user finds a critical and tries to exploit testnet maliciously. | SC3 testnet safe-harbor; we expect this and welcome it. |
| T5 | Multisig signer hardware fails during rehearsal. | Backup process per SC4 §7.4; resilience is part of what we test. |
| T6 | KMS API quotas hit. | Pre-warm capacity with cloud provider; observed scale is well under quota. |
| T7 | Bundler operator (us) takes too long to bundle. | Latency monitoring (§6.1); page if p99 > 30s. |
| T8 | Storage layout drifts during rehearsal due to an unintentional upgrade. | CI guard prevents drift on PR; SC4 multisig prevents drift on upgrade. |
| T9 | We discover a structural design flaw that requires a redesign. | Better here than mainnet. Pause rehearsal; redesign; re-rehearsal. |
| T10 | Rehearsal completes successfully but mainnet exposes unique conditions (different mev landscape, real adversaries, real money). | Rehearsal is necessary but not sufficient; SC3 mainnet bounty + SC6 monitoring catch what slip through. |

---

## 11. Open questions

1. [OWE-REVIEWER] Sepolia or Holesky? Plan: Sepolia (more stable
   ecosystem; widest tooling support). Confirm.
2. Do we run BOTH our own bundler AND a public bundler in parallel
   for comparison data? Plan: yes; ours is primary, public is
   reference.
3. What is the activation threshold for the SC3 testnet bounty?
   Plan: activate alongside rehearsal start.
4. Do we publish weekly retro posts publicly or internally only?
   Plan: public (transparency is part of the mainnet sign-off
   argument).
5. Multisig signer availability across 4 weeks: confirm time
   commitments.

---

## 12. Next actions

1. Engineering manager: confirm rehearsal timeline against SC1
   audit completion.
2. Infra: provision cloud KMS + cloud compute for rehearsal env.
3. Developer: adapt `scripts/deploy-local.sh` for Sepolia.
4. Developer: write `packages/contracts/script/SepoliaSoakLoad.s.sol`.
5. Security lead: prepare SC3 testnet bounty page.
6. Engineering manager: schedule key ceremony 8 weeks before rehearsal.
7. After SC1 + SC4 + SC7 ready: execute rehearsal.
