# DR4 — Mainnet Transition

> **Status**: DRAFT. **Today all contract operations target an anvil
> dev chain at `127.0.0.1:8545`.** There is no testnet deploy, no
> mainnet deploy, no plan for migrating demo accounts, no paymaster
> bonding strategy, no MockUSDC → real USDC switchover. `scripts/
> deploy-local.sh` deploys to anvil only. The user explicitly committed
> the Spec-005 design uses MockUSDC dev-only with the smartAccount-as-
> treasury model.
>
> This document specifies the multi-stage transition from anvil → public
> testnet (Base Sepolia or Optimism Sepolia) → mainnet (Base or
> Optimism). It is the largest single DR-class change in the project.
>
> **Effort**: L (3-4 weeks — staged deploys + rehearsal + migration).
> **Owner**: Director of Engineering + Smart-contracts owner.
> **Depends on**: Spec 007 Phase A (final contract addresses; redeploy
> required), Spec 007 Phase C (no DEPLOYER_PRIVATE_KEY at runtime),
> Sprint 5 KMS migration (production signing via KMS only), O1 (deploy
> procedure), O11 (CAB approval for contract deploys).
> **Unblocks**: real-money operation; customer beta.

---

## 1. Today's state (honest)

| Item | Today |
|---|---|
| Chain | Anvil dev (chain id 31337) — `127.0.0.1:8545`. |
| Contract addresses | Regenerated on every `fresh-start.sh` (CREATE2 with random salt-prefix per redeploy). |
| Demo accounts | All dev fixtures (Maria, Pastor David, etc.) seeded into anvil + apps/web local SQLite. |
| USDC | MockUSDC (in-house, mintable). |
| Paymaster | Deployed to anvil; funded via deploy script. |
| Gas | Free (anvil). |
| Bundler | Embedded — `apps/a2a-agent` calls EntryPoint directly with the master key as bundler signer (Spec 007 Phase A makes this a separate `bundlerSigner` key). |
| Onchain assertion classes (sa:RoundOpenedAssertion, etc.) | Anvil only. |
| User wallets | Anvil-generated EOAs + smartAccounts; no real funds. |

If we needed to onboard a real customer tomorrow: we couldn't. No
real chain; no real money; no audit-ready deploy. DR4 is the path
from "demo working on anvil" to "production running on mainnet."

---

## 2. Goals

1. **Three environments**: dev (anvil), staging (testnet), production
   (mainnet). Each has its own contracts, its own paymaster, its own
   AgentAccountFactory.
2. **Pre-mainnet rehearsal**: every flow exercised against testnet at
   least once before mainnet. Rehearsal checklist signed off by CAB.
3. **Demo accounts migrated** to testnet for user testing; not
   migrated to mainnet (mainnet starts with real users only).
4. **Real USDC** on mainnet; MockUSDC stays in dev. Application code
   reads the `USDC_ADDRESS` env var; no hard-coded constants.
5. **Paymaster bonding strategy** decided + executed before mainnet:
   how much ETH to deposit; how to top up; alarms.
6. **Gas funding strategy**: paymaster sponsorship per Spec-005, but
   with a budget alarm (O9 §5.1).
7. **No deployer key at runtime** — Spec 007 Phase C is a hard
   precondition. The runtime stack signs with KMS only.

---

## 3. Stage 0 — Anvil dev (today)

Anvil is the development substrate. It stays. `scripts/fresh-start.sh`
remains the canonical reset for the dev environment.

No changes needed here for mainnet readiness.

---

## 4. Stage 1 — Testnet (Base Sepolia or OP Sepolia)

### 4.1 Chain decision

| Chain | Pros | Cons | Decision |
|---|---|---|---|
| **Base Sepolia** | Low fees; widely-supported testnet; Coinbase paymaster availability. | Coinbase-affiliated. | Strong candidate. |
| **Optimism Sepolia** | Similar; OP Stack ecosystem. | Less mature for ERC-4337 paymaster tooling than Base. | Acceptable backup. |
| **Sepolia (L1)** | Native Ethereum; widest support. | Higher gas; gas costs aren't representative of L2 production. | Rejected — production target is L2. |
| **Holesky** | Native Ethereum; newer testnet. | Same gas-cost issue as Sepolia. | Rejected. |
| **Hardhat in-CI** | Already used in tests. | Not a public testnet; doesn't exercise external dependencies (Alchemy, paymaster pool). | Continues for tests only. |

**Decision**: Base Sepolia. Production target: Base mainnet.

### 4.2 Deployment

`scripts/deploy-testnet.sh` (new). Reuses `scripts/deploy-local.sh`'s
forge-script pattern but parameterised:

```bash
CHAIN=base-sepolia RPC_URL=$BASE_SEPOLIA_RPC pnpm deploy:chain
```

Drives `packages/contracts/script/Deploy.s.sol` with the testnet
chain id (84532). Outputs contract addresses to
`infra/contracts/base-sepolia/addresses.json` (NOT to `.env`
files — production secrets live in Secrets Manager per Spec 007 H).

### 4.3 Configuration

Per-environment config lives in `infra/contracts/<chain>/addresses.json`.
The application's runtime config reads `CHAIN_ID` and resolves the
addresses for that chain.

```typescript
// packages/sdk/src/config/contract-addresses.ts
import baseSepolia from '../../../../infra/contracts/base-sepolia/addresses.json'
import baseMainnet from '../../../../infra/contracts/base/addresses.json'

export function contractAddresses(chainId: number) {
  switch (chainId) {
    case 31337: return require(`.../anvil/addresses.json`)  // dev only
    case 84532: return baseSepolia
    case 8453:  return baseMainnet
    default: throw new Error(`unsupported chain: ${chainId}`)
  }
}
```

### 4.4 Paymaster

Testnet paymaster funded with ~1 ETH Base Sepolia (free from faucet).
Sufficient for months of testing at expected RPS.

### 4.5 Demo accounts on testnet

`scripts/seed-testnet.ts` deploys the catalyst seed (Maria, Pastor
David, etc.) to testnet just like the anvil seed. Differences:
- Demo accounts are deployed via real userOps (not anvil-fast-path).
- Demo MockUSDC is NOT deployed; we use Base Sepolia testnet USDC
  (the canonical address per Circle's documentation).
- Demo users get test USDC from a faucet OR from a one-time mint by
  the testnet deployer (which holds testnet USDC mint authority for
  the dev MockUSDC, but on real testnet we use real testnet USDC,
  obtained via Circle's testnet faucet).

### 4.6 Bundler

Self-hosted via `apps/a2a-agent`'s bundler-signer key (per Spec 007
Phase A). Alternatively: use a public bundler service (Stackup,
Pimlico, Alchemy AA). For testnet, public bundler is fine; cheaper
to operate.

---

## 5. Stage 2 — Pre-mainnet rehearsal

### 5.1 Rehearsal checklist

Per `docs/runbooks/mainnet-rehearsal-checklist.md` (new). CAB
(O11 §6) signs off after every box is checked.

```markdown
## Pre-mainnet rehearsal checklist

### Code readiness
- [ ] Spec 007 Phase A merged + redeployed on testnet (new contract roles).
- [ ] Spec 007 Phase B merged + Variant A/B both exercised on testnet.
- [ ] Spec 007 Phase C merged + no DEPLOYER_PRIVATE_KEY runtime references
      (audited by `no-deployer-key-in-actions.test.ts`).
- [ ] Spec 007 Phase F.2 in production (Postgres).
- [ ] Sprint 5 W3 P0-7 / P0-8 / P0-9 / P1-5 all green in prod env.
- [ ] CI green on `master`.
- [ ] All Slither / Mythril findings resolved or accepted with rationale.

### External readiness
- [ ] Mainnet RPC provider chosen + paid plan in place (Alchemy
      growth tier).
- [ ] Mainnet bundler chosen + funded (self-hosted or Stackup pro).
- [ ] Mainnet paymaster KMS keys provisioned (separate from testnet).
- [ ] Mainnet AgentAccountFactory KMS keys provisioned (separate).
- [ ] Real USDC integration tested on testnet (Base Sepolia USDC).
- [ ] Production GraphDB instance / fallback URL configured (DR3).

### Operational readiness
- [ ] Backups configured for production Postgres + Askar (O4).
- [ ] Postgres HA validated via DR1 failover drill.
- [ ] Backup verification green for 4 consecutive weeks (DR2).
- [ ] All Tier-1 runbooks exist (O7).
- [ ] On-call rotation operational (O6) for at least 1 month.
- [ ] First DR drill (O5 §8 Q1 — Postgres failover) completed.
- [ ] Monitoring + alerting per O5 §7.3 wired.
- [ ] Status page live (O5 OQ-3).

### Security readiness
- [ ] All keys in K1-rotation-tested KMS (Sprint 5 KMS migration done).
- [ ] CodeQL clean (no HIGH findings).
- [ ] Dependency vulnerabilities clean per pnpm audit.
- [ ] Penetration test completed by an external firm.
- [ ] Bug bounty program live (e.g. via Immunefi for smart contracts).

### Customer readiness
- [ ] Privacy policy published.
- [ ] Terms of service published.
- [ ] Audit report from a reputable firm (e.g. Code4rena audit, Open
      Zeppelin) published.
- [ ] Customer support channel live.

### CAB sign-off
- [ ] DoE
- [ ] Security reviewer
- [ ] Smart Contracts owner
```

### 5.2 Rehearsal drill

Once the checklist is green, a full end-to-end rehearsal:

1. Spin up a staging environment that mirrors mainnet posture
   (production Postgres, production KMS keys, production network
   routing). Connected to BASE SEPOLIA, not mainnet.
2. Deploy contracts to staging-on-testnet.
3. Run synthetic transactions (O1 §7.1) at 10× expected first-week
   load. Confirm all pass.
4. Run the O8 load tests at projected first-month load. Confirm SLO
   margins.
5. Trigger a chaos failure (kill Postgres primary mid-flight). Confirm
   recovery.
6. Sign-off meeting: CAB confirms readiness.

Output: `output/mainnet-rehearsal-YYYY-MM-DD.md` filed in repo.

---

## 6. Stage 3 — Mainnet launch

### 6.1 Order of operations

```
1. CAB approves the rehearsal report.
2. Mainnet deploy window scheduled (Tuesday 14:00 PT, NOT Friday).
3. Pre-deploy CAB call. Final checks.
4. Contracts deployed:
   - AgentAccountFactory
   - DelegationManager
   - All registries (PoolRegistry, FundRegistry, etc.)
   - All assertion contracts
   - Paymaster
5. Paymaster funded with the initial bond (§6.3).
6. Application config updated (Secrets Manager): CHAIN_ID = 8453,
   addresses point at mainnet.
7. Application deploys: canary 5% → 25% → 50% → 100% (per O1 §5).
8. Synthetic transactions on mainnet (a small handful, low value):
   - Deploy a synthetic agent account ($0.50 in gas).
   - Mint a $1 USDC pledge.
   - Settle it.
9. Confirm everything is sound; declare mainnet live.
10. Post-launch monitoring window: 24-hour intensified on-call.
```

### 6.2 No demo accounts on mainnet

Demo accounts (Maria, Pastor David) stay on testnet for demos. Mainnet
starts with real users only. The `--minimal` and `--full` seed
profiles are dev/testnet only.

### 6.3 Paymaster bonding

ERC-4337 paymasters bond ETH with the EntryPoint to sponsor user
gas. Strategy:

- **Initial bond**: $1,000 worth of ETH at deploy. Sufficient for
  ~50,000 userOps at $0.02 average gas (very conservative).
- **Auto top-up**: a daily cron checks `EntryPoint.balanceOf(paymaster)`
  and tops up if balance < $200 worth of ETH.
- **Alarm**: balance <$100 pages on-call (Sev-1; running out of gas
  is a Tier 1 outage).
- **Budget alarm**: per O9, monthly paymaster gas spend >$500/mo
  alerts; >$2,000/mo pages. Sustained high spend triggers a CAB
  review — either we have great growth or someone's abusing the
  free gas.

The paymaster contract source is in `packages/contracts/src/
SmartAgentPaymaster.sol` (referenced in `deploy-local.sh`'s
output). Already audited via Spec 005.

### 6.4 USDC

Production: real USDC at the canonical Base mainnet address
(`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`).

`apps/web/.env`-style config gets `USDC_ADDRESS` set per chain via
Secrets Manager. SDK reads from `contractAddresses(chainId).USDC`.

The Spec 005 Rail A (cryptographic) settles real USDC; Rail B
(attested) records evidence pointing at off-chain USDC movement
(per memory `project_spec005_pledge_honor.md`). No code change for
the rails themselves on mainnet — the contracts are agnostic to
testnet/mainnet USDC.

### 6.5 Gas sponsorship vs not

Paymaster sponsors gas per Spec 005. Posture choice:
- **Always sponsor**: maximum UX, maximum cost exposure. The current
  Spec 005 posture.
- **Sponsor for first N userOps per user, then user pays**: lower
  cost; introduces a budget knob.
- **Sponsor only specific tool ids**: low-risk paths (auth, pledge,
  settle) sponsored; high-risk (treasury actions) require user-paid.

**Decision**: always-sponsor at launch; reassess after 30 days based
on actual cost-per-userOp (O9 §4.3).

---

## 7. Rollback

### 7.1 Application rollback

Standard O1 canary rollback. Per-deploy rollback returns to the
previous-known-good config (which may still point at mainnet
contracts).

### 7.2 Contract rollback

Contracts are immutable. "Rollback" means re-pointing the namespace
registry at a previous contract version. If a critical bug surfaces
after launch:

1. Pause new userOps via the paymaster (revoke deposit).
2. Investigate. If a fix is contract-side, deploy the fix as a new
   contract version + migrate via the on-chain `AgentNameResolver`.
3. If a fix is application-side only, normal deploy.

**Catastrophic contract bug** (e.g. funds-drain vulnerability): the
contracts include emergency pause hooks where appropriate (see
Spec 007 Phase A `_authorizeUpgrade` discussion). For accounts that
can't be paused, the mitigation is user communication + new-version
migration. CAB-class incident; war-room engaged.

### 7.3 Cannot un-launch

Once mainnet is live and users have real funds in smartAccounts, we
cannot "un-launch." Every subsequent change is a forward migration.
This is the irreversible step DR4 prepares for.

---

## 8. Files to create/change

### New

- `scripts/deploy-testnet.sh`
- `scripts/deploy-mainnet.sh`
- `scripts/seed-testnet.ts`
- `infra/contracts/base-sepolia/addresses.json` (placeholder; populated
  on first testnet deploy)
- `infra/contracts/base/addresses.json` (populated at mainnet launch)
- `infra/contracts/anvil/addresses.json` (populated by deploy-local.sh)
- `packages/sdk/src/config/contract-addresses.ts`
- `docs/runbooks/mainnet-rehearsal-checklist.md`
- `docs/runbooks/mainnet-deploy.md` — the ordered procedure of §6.1.
- `docs/runbooks/paymaster-underfunded.md`
- `docs/runbooks/mainnet-incident.md` — incident response specific
  to mainnet (different from testnet because real funds).

### Changed

- `packages/contracts/script/Deploy.s.sol` — parameterized over chain.
- `apps/a2a-agent` — reads `CHAIN_ID` + addresses from config, not from
  env-var hard-codes.
- `apps/web/.env.example` — documents the per-chain addresses.
- `scripts/fresh-start.sh` — restricts to anvil (chain id 31337);
  refuses if `CHAIN_ID != 31337`.

### CI guards

- `no-hardcoded-chain-31337.test.ts` — flags any `chain.id === 31337`
  or `chainId === 31337` hard-coded check in app code. Acceptable
  only via the chain-resolver SDK.
- `mainnet-rehearsal-checklist-checked-in.test.ts` — for the mainnet
  deploy workflow, refuses to proceed unless an `output/mainnet-
  rehearsal-YYYY-MM-DD.md` file exists for the deploy week.

---

## 9. Cost (mainnet)

| Item | Cost (first 90 days) |
|---|---|
| Mainnet RPC (Alchemy Growth) | $199/mo |
| Mainnet bundler (self-hosted via existing a2a-agent KMS key) | $0 marginal |
| OR Stackup Pro bundler | $200-500/mo |
| Paymaster bond | $1,000 one-time + $2-10/userOp gas |
| External audit (already done pre-rehearsal) | $50-150k one-time |
| Bug bounty (Immunefi-class) | $25-100k reserve |
| Mainnet contract deploy gas | ~$200 (one-time across all contracts) |
| Customer support tooling | $50-200/mo |

Total operational: ~$300-700/mo recurring + significant one-time
audit + bug-bounty costs.

---

## 10. Acceptance criteria

- [ ] Stage 1: contracts deployed to Base Sepolia. Synthetic
      transactions complete end-to-end.
- [ ] Stage 1: demo accounts seed onto testnet via `seed-testnet.ts`.
- [ ] Stage 2: Full rehearsal checklist signed off by CAB.
- [ ] Stage 2: Rehearsal drill report filed in
      `output/mainnet-rehearsal-YYYY-MM-DD.md`.
- [ ] Stage 3: contracts deployed to Base mainnet.
- [ ] Stage 3: paymaster bonded at $1,000.
- [ ] Stage 3: synthetic mainnet transactions complete.
- [ ] Stage 3: 24-hour post-launch on-call window completed without
      Sev-1.
- [ ] CI guard `no-hardcoded-chain-31337.test.ts` passes.

---

## 11. Test plan

### 11.1 Testnet

- Run every synthetic transaction from O1 §7.1 against testnet.
- Run O8 load tests against testnet (at 10× expected mainnet load).
- Run DR drills (DR1 failover, etc.) in staging that's connected to
  testnet.

### 11.2 Mainnet first-day

- Synthetic transactions at low value (<$10 across all probes).
- One internal team member onboards a real account end-to-end. Records
  everything. Files the first user-feedback report.

### 11.3 Mainnet first-week

- Daily synthetic transactions (per O1 deploy workflow).
- Daily paymaster balance check.
- Daily cost review (per O9 — paymaster gas).

---

## 12. Open questions

- **OQ-DR4-1**: Base vs Optimism for mainnet — both meet the technical
  bar. Proposed: Base (Coinbase ecosystem; easier for non-crypto-native
  users to onboard via Coinbase). Re-evaluate if Optimism's incentives
  shift materially.
- **OQ-DR4-2**: Self-hosted bundler vs Stackup/Pimlico? Self-hosted is
  consistent with Substrate Independence (P1) but adds operational
  load. Proposed: self-hosted via Spec 007 Phase A's `bundlerSigner`
  for v1; revisit if bundler load becomes a distraction.
- **OQ-DR4-3**: How do we handle account-recovery for users who lose
  their passkey on mainnet? Proposed: this is a P1 product concern;
  Spec 008 (not yet written) covers recovery flows. DR4 does not gate
  on Spec 008 — users opting in to mainnet beta accept current
  recovery limitations explicitly.
- **OQ-DR4-4**: Cost monitor for mainnet vs testnet — do we tag
  paymaster spend by chain? Proposed: yes — O9 dashboard filters by
  `Chain=mainnet|testnet`.
- **OQ-DR4-5**: Customer agreement about mainnet outage risk —
  formal SLA when? Proposed: after 90 days of post-launch
  stability + first paying customer. Earlier customers accept
  beta-class SLA.
- **OQ-DR4-6**: Bug bounty timing — before mainnet or after? Proposed:
  bug bounty live BEFORE mainnet for >2 weeks so external white-hats
  can find issues. Audit firms first; bounty second; mainnet third.
