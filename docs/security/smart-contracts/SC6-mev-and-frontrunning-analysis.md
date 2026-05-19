# SC6 — MEV and Front-Running Analysis

> **Status**: Draft. Internal analysis; informational for SC1 auditor.
> **Audience**: security lead (owner), engineering manager (decision
> on private-mempool adoption), bundler operator (executor).
> **Document type**: Analysis (threat enumeration) + ops plan (mitigations).
> **Pairs with**: SC1 (auditor reads this to understand mempool risk
> surface), `apps/a2a-agent/src/routes/onchain-redeem.ts` (the actual
> bundler relay).

---

## 1. MEV landscape for ERC-4337 + delegation systems

The system uses ERC-4337 account abstraction. UserOps land at the
EntryPoint via a bundler, which submits a meta-transaction
(`handleOps`). MEV concerns apply at multiple layers:

- **Mempool exposure of userOps**: if a bundler operates an open
  mempool (mempool of userOps before bundling), searchers can
  observe pending userOps.
- **Bundler MEV opportunities**: the bundler operator can reorder,
  censor, or pad bundles for their own benefit.
- **Underlying mempool exposure of bundles**: even if userOps are
  private, the bundled `handleOps` tx hits the L1 mempool and can
  be observed by L1 searchers.
- **Delegation-specific MEV**: redeemDelegation submissions that
  trigger price-sensitive operations (e.g. treasury moves) are
  sandwichable.

This document enumerates each, classifies severity for our system,
and recommends mitigations.

---

## 2. Current state (as of 2026-05-18)

### 2.1 Bundler

- **Dev**: master signer is the only bundler. Cite:
  `apps/a2a-agent/src/routes/onchain-redeem.ts` (post-Phase-A, the
  bundler signer is the separate KMS key
  `BUNDLER_KMS_KEY_ID`).
- **Prod**: TBD. We have not yet selected a public bundler
  partner (e.g. Pimlico, Stackup, Alchemy, Biconomy). The
  alternative is operating our own bundler.

[DECISION] V1 launch: operate our own bundler with the
`bundlerSigner` KMS key. Centralized but auditable. Revisit
post-launch.

### 2.2 EntryPoint version

EntryPoint v0.7 or v0.8 (Phase A `IMPLEMENTATION_NOTES.md` may
have bumped — verify). MEV mitigations are largely EntryPoint-version
agnostic at the contract layer; the bundler-side mitigations differ
slightly.

### 2.3 Paymaster

`SmartAgentPaymaster` sponsors gas. In dev mode it accepts every
userOp. In prod (post-SC4) the multisig owns the accept list.

### 2.4 Underlying L1

Ethereum mainnet long-term; testnet (Sepolia) for SC8. MEV
infrastructure is well-developed at both: Flashbots Protect,
MEV-Boost, builder market.

---

## 3. Threats

### 3.1 Threat M1: userOp mempool sniping

**Description**: A searcher observes a userOp in the userOp mempool
(if our bundler has one), front-runs it by submitting a competing
tx on L1 with higher priority. Common in DeFi where the userOp's
inner action is value-extracting (e.g. arbitrage, liquidation).

**Applies to us?**

- Our user actions: register agent, deploy account, sign
  delegations, redeem delegations, vote, propose, pledge, honor
  pledge. None of these are inherently arbitrage-able.
- **Exception**: pledge honoring triggers a USDC transfer +
  recordHonor batch (spec 005). If the system gains DEX integration
  in the future, this could be sandwichable.
- **Exception**: grant proposal awards (spec 003) move money;
  if money moves are timing-sensitive (e.g. price-dependent
  conversion), sandwichable.

**Severity for v1**: LOW. No price-sensitive on-chain ops in v1.

**Mitigation if it becomes a concern**:

- Private bundler mempool (Pimlico Sponsored API, Alchemy AA,
  ZeroDev — all expose private mempool tooling).
- Submit bundles through Flashbots Protect (private relay; no
  mempool exposure of the L1 tx).
- Add slippage tolerances client-side if any UX flow involves
  price-sensitive math.

### 3.2 Threat M2: bundler reordering / censorship

**Description**: A bundler holds an internal pool of userOps, and
chooses which to include + in what order. This power can be used
to:

- **Reorder for MEV**: include a profitable userOp first, then
  the user's. (Our userOps are not MEV-profitable, so this is low
  risk.)
- **Censor**: refuse to include a user's userOp.
- **Delay**: include intermittently to extract fees.

**Applies to us?**

- V1: our own bundler. Censorship risk = trust the operator
  (us). Reordering risk = us (low).
- Future: third-party bundler. Risk increases.

**Severity for v1**: LOW (we operate the bundler).

**Mitigation**:

- Document the bundler operator clearly (transparency).
- Plan bundler diversity for v2: multiple bundlers operated by
  unrelated parties.
- Surface bundler latency metrics so users can see if they're
  being delayed.

### 3.3 Threat M3: bundler sandwiching

**Description**: Bundler observes a user's userOp, inserts its own
trade BEFORE and AFTER to extract value.

**Applies to us?**

- V1: no price-sensitive userOps.
- Future: if treasury moves involve a DEX swap, the swap is the
  sandwich target.

**Severity for v1**: LOW.

**Mitigation if it becomes a concern**:

- Slippage limits in UI.
- Commit-reveal for high-value operations (see §3.6).
- Off-chain price oracles + on-chain slippage enforcement via a
  caveat enforcer.

### 3.4 Threat M4: bundle-level L1 mempool sniping

**Description**: The bundler submits `handleOps` to the L1 mempool.
Searchers observe the bundle and front-run by submitting a
competing tx. Generally less relevant to AA because the bundle
already includes the userOp (the inner action).

**Applies to us?**

- Searchers could observe a `handleOps` bundle and:
  - Re-submit a tx that races us to be the first to claim a
    spot (e.g. first to claim a one-time grant). Unlikely in
    v1 — our grants are awarded by org, not first-come.
  - Read pending userOps from the bundle and act on the public
    information (not really front-running, but information
    leakage).

**Severity for v1**: LOW.

**Mitigation**:

- Flashbots Protect for sensitive bundles.
- For specific high-value flows (proposal-lane award commits),
  consider private mempool.

### 3.5 Threat M5: delegation-redemption sandwiching

**Description**: A user's `redeemDelegation` call moves money (e.g.
pledge honor → USDC transfer). A searcher sandwiches.

**Applies to us?**

- Direct USDC transfers are not inherently sandwichable (no price
  motion).
- AMM / DEX swaps triggered via delegation WOULD be sandwichable.
- V1 has no DEX integration; spec 005 honor is `USDC.transfer +
  recordHonor`, no swap.

**Severity for v1**: LOW.

**Mitigation if it becomes a concern**:

- Slippage caveat enforcer (`SlippageEnforcer` — not yet
  implemented; future enforcer for v1.5 if DEX integration
  emerges).
- Private mempool for the redemption.

### 3.6 Threat M6: commitment-reveal patterns

**Description**: For high-value actions, instead of submitting the
final action in the open mempool, the user first commits a hash
(`commit(hash)`), then reveals (`reveal(value)`). MEV can't act
until the reveal, and by then the commitment is already on-chain.

**Applies to us?**

- Currently used: NO. Our delegation hashes are not commit-reveal
  patterns.
- Could apply: high-value award commits in spec 003 if a sniping
  concern emerges.

**Severity for v1**: LOW (not needed).

**Trade-offs**:

- Commit-reveal adds 1 block of delay.
- Front-running protection is real.
- UX cost: user must keep the secret around between commit and
  reveal.

**Decision**: defer to v1.5; not in v1 scope.

### 3.7 Threat M7: censorship by bundler operator

**Description**: Bundler refuses to include specific users' userOps
(political, regulatory, or commercial).

**Applies to us?**

- V1: we are the bundler. Self-censorship risk = political /
  regulatory pressure on us.
- We commit (publicly) to not censoring legitimate users.

**Severity for v1**: LOW (it is our policy not to censor).

**Mitigation**:

- Bundler diversity in v2.
- Public commitment to non-censorship policy in docs.
- Users can self-bundle by submitting `handleOps` directly to
  EntryPoint (gas cost-bearing). This is the AA escape hatch.

### 3.8 Threat M8: paymaster grief

**Description**: Adversary submits userOps that succeed but waste
the paymaster's deposit.

**Applies to us?**

- In dev mode (`SmartAgentPaymaster._dev = true`), every userOp is
  sponsored. Adversary can submit garbage userOps to drain the
  deposit.
- In prod mode (allow-list), only allow-listed senders sponsored.
  Adversary cannot drain via random senders.

**Severity for v1**: HIGH if dev mode persists into production.

**Mitigation**:

- SC4 mandates `SmartAgentPaymaster.setDevMode(false)` is a
  governance-controlled state.
- Pre-launch checklist: confirm dev mode is FALSE before any
  production traffic.
- Monitor deposit balance; alert below threshold.

[OWE-REVIEWER] Add a pre-launch verification step: query
`paymaster.devMode()` and assert FALSE before allowing user-facing
production traffic.

### 3.9 Threat M9: priority-fee front-running of redemption

**Description**: A searcher observes a pending `handleOps` bundle
and submits a competing tx with higher priority fee to be included
first. Generally a no-op against ERC-4337 because the bundler's
bundle is opaque to the searcher (they can't easily replicate it).

But: if a userOp's inner action is to claim a one-time, first-come
resource (e.g. claim a quota slot, mint a limited-edition asset),
the bundler MEV concern applies.

**Applies to us?**

- V1: no first-come-first-served resources on chain.
- Possible future: limited-quota grants ("first 10 applicants
  accepted").

**Severity for v1**: LOW.

**Mitigation**:

- Avoid first-come-first-served patterns on chain.
- If one is needed, use a commit-reveal or a randomness-based
  selection (Chainlink VRF or equivalent).

### 3.10 Threat M10: bundler key compromise

**Description**: `bundlerSigner` KMS key is compromised.
Attacker can forge `BUNDLER_ENVELOPE` signatures.

**Applies to us?**

- The Phase A architecture explicitly contemplates this. Cite:
  `AgentAccount.executeFromBundler` (line 358-385) requires both
  bundler envelope AND inner user signature. Bundler-only
  compromise CANNOT author userOps; the user's inner signature
  is still required.
- BUT: a compromised bundler can refuse to bundle, can censor,
  can submit DoS bundles.

**Severity for v1**: MEDIUM (DoS-level impact; no authority
escalation).

**Mitigation**:

- KMS rotation (output/KMS-IMPLEMENTATION-PLAN.md, Phase K7).
- Bundler diversity in v2: multiple bundlerSigner keys with
  independent KMS holders.

---

## 4. Mitigation summary

| Threat | Severity v1 | Mitigation in v1 | Future |
|---|---|---|---|
| M1 userOp mempool sniping | LOW | None needed | Private mempool if DEX integration |
| M2 bundler reordering | LOW | Operate our own bundler | Bundler diversity v2 |
| M3 bundler sandwiching | LOW | Operate our own | Slippage enforcer if needed |
| M4 L1 mempool sniping | LOW | None needed | Flashbots Protect for sensitive flows |
| M5 redemption sandwiching | LOW | None (no swaps) | Slippage enforcer + private mempool |
| M6 commit-reveal | LOW | Not needed | v1.5 if needed |
| M7 censorship | LOW | Self-policy + AA escape hatch | Bundler diversity |
| M8 paymaster grief | HIGH if dev mode | Pre-launch check + governance gate | Allow-list + monitoring |
| M9 priority-fee FR | LOW | Avoid FCFS patterns | VRF if needed |
| M10 bundler key compromise | MEDIUM | KMS + Phase A split | KMS rotation + diversity |

---

## 5. Bundler operator design

### 5.1 V1 design (single bundler, our operation)

```
[user app] → (signed userOp) →
[a2a-agent /onchain-redeem]
  ↓ (verify user inner sig)
  ↓ (sign BUNDLER_ENVELOPE digest with bundlerSigner KMS key)
  ↓ (call AgentAccount.executeFromBundler to pre-verify)
  ↓ (submit handleOps to EntryPoint via L1 RPC)
[EntryPoint] → AgentAccount.validateUserOp → AgentAccount.execute
```

Cite: `apps/a2a-agent/src/routes/onchain-redeem.ts` (the actual
relay). `AgentAccount.executeFromBundler` (`AgentAccount.sol:358-385`).

### 5.2 V2 design (bundler diversity)

- Multiple `bundlerSigner` addresses.
- Each `AgentAccountFactory` deployment commits to one.
- Users (or higher-level chooser) pick which bundler to use.
- Bundlers are operated by independent parties under contractual
  SLAs.

### 5.3 V2 design (private mempool, optional)

- Bundler submits `handleOps` via Flashbots Protect (or equivalent)
  for sensitive flows.
- Sensitive = flagged by `@sa-risk-tier high|critical` (re-use
  Phase A's risk-tier routing infrastructure).

---

## 6. Slippage and price-sensitive actions

### 6.1 V1 commitments

V1 has no DEX integration and no price-sensitive on-chain math.
Pledge honor moves USDC at face value. Grant awards move USDC at
face value. No swap.

### 6.2 V1.5 risk

If a future spec introduces DEX integration (e.g. multi-currency
treasury → convert to USDC at honor time), MEV risk goes from LOW
to MEDIUM-HIGH.

Pre-emptive design choices for v1.5:

- A new `SlippageEnforcer` caveat enforcer: terms specify a
  minimum acceptable output amount; beforeHook checks the AMM
  query result (or relies on the swap path's revert-on-slippage).
- Private mempool for high-value swaps.
- UX: every swap surfaces estimated output + slippage; user
  approves explicitly.

[OWE-REVIEWER] Flag for any future PM picking up DEX integration:
do NOT ship without `SlippageEnforcer`.

### 6.3 UX-level slippage tolerance

Even today, users see specific dollar amounts. The UI MUST round
to whole units and not perform price math; any client-side
estimate must use the on-chain unit (USDC = 6 decimals; show 2
decimal places). A user signing "transfer $100" should not be
exposed to a $100.0000001 rounding-error attack.

---

## 7. Monitoring

### 7.1 Bundler health metrics

- Bundler signer KMS key age (alert at 80% of rotation interval).
- Bundle inclusion latency (p50 / p95 / p99).
- Bundle revert rate (high reverts = signal of mempool sniping
  or contract bug).
- Paymaster deposit balance (alert below threshold).
- Bundle gas usage (anomaly detection on per-bundle gas).

### 7.2 MEV signal

- Track every `handleOps` tx; compute "would have been front-run"
  signal by checking if any tx in the same block has the same
  target+selector as the userOp's inner call. If yes, flag.
- Manual review of flagged blocks weekly during early v1.

### 7.3 Censorship signal

- Track every accepted userOp at the a2a-agent layer.
- Track every userOp that landed on chain.
- The diff is censored (or stuck in pending).
- Alert if the diff > X% over 24h.

---

## 8. Risks

| # | Risk | Mitigation |
|---|---|---|
| MEV-1 | Future DEX integration adds MEV surface and we forget to add SlippageEnforcer. | §6.3 OWE-REVIEWER flag; pre-merge checklist for any DEX integration spec. |
| MEV-2 | Our bundler operator's KMS gets compromised → DoS. | M10 mitigation (KMS rotation). |
| MEV-3 | We become a bundler monopolist; centralization concern. | §5.2 v2 diversity plan; transparent commitment. |
| MEV-4 | Paymaster dev mode ships to production. | §3.8 pre-launch check. |
| MEV-5 | Researcher finds a sandwich vector we missed. | SC3 bounty pricing MEV exploits at Medium-High. |

---

## 9. Open questions

1. [OWE-REVIEWER] Pre-launch check that confirms
   `paymaster.devMode() == false`: where in CI / launch runbook?
2. Do we run our own bundler at v1 or use a third-party (Pimlico
   / Alchemy / Biconomy)? Plan default: our own.
3. Bundler-diversity v2 timeline.
4. Future SlippageEnforcer design — start design work pre-emptively?
   Plan: no, defer until DEX integration is on the roadmap.

---

## 10. Next actions

1. Security lead: review with bundler operator (us) and confirm
   the v1 design in §5.1.
2. Developer: add the §3.8 pre-launch check to the launch runbook.
3. Developer: instrument §7 monitoring on the bundler.
4. After SC1 audit: revisit any MEV-related findings.
