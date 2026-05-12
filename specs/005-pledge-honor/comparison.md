# Spec 005 — Competitive Comparison + Locked Build Decision

> **Decision locked**: **Option A — build the proposed substrate ourselves.**
> Rationale: project principle P1 (substrate independence), `docs/architecture/principles.md`.
> Options B (use Safe as custody) and C (build now, migrate to Safe later) are explicitly off
> the table. We study Safe / Aragon / Llama / Endaoment / Bulla as reference implementations,
> never as runtime dependencies.

---

## TL;DR

The proposed design isn't competing with Safe as a custody / multisig product — it's an
**on-chain pledge ledger with two settlement rails**, where the asset custody happens to be an
AgentAccount. The novel pieces are:

1. **Commitment registry separated from payment** (PledgeRegistry is not a treasury — it's a
   public ledger of commitments + settlements).
2. **Two-rail settlement model** (cryptographic donor-treasury transfer + attested admin
   mark-paid) for the same commitment.
3. **Content-hash evidence anchor** on chain, blob in MCP — bridges Web3 audit with Web2
   receipts.

Everything else (atomic batched calls, role-based permissioning, multi-token support) is
well-trodden ground where Safe + Zodiac Roles is more mature **as a product**, but we
re-implement the patterns ourselves per P1.

---

## Per-product breakdown

### Safe (Gnosis Safe)

| Aspect | Safe | Proposed |
|---|---|---|
| Custody model | n-of-m multisig smart contract | ERC-4337 AgentAccount (single or multi-owner) |
| Tx authorization | Off-chain sigs + `execTransaction` | ERC-7710-style delegations + caveat enforcers + DelegationManager |
| Atomic multi-call | `MultiSend` delegatecall library | Proposed `executeBatch` (pattern borrowed) |
| Per-call policy | None natively; Zodiac Roles Modifier refinement | `CallDataHashEnforcer` + AllowedTargets + AllowedMethods + Value per delegation |
| Battle-testing | $100B+ TVL, 5+ years audited | New code, custom enforcers |
| Recovery | Social recovery via Safe modules | Custom RecoveryEnforcer, OAuth-gated |

**What Safe doesn't have**: public commitment registry separate from custody; two-rail
settlement; AgentAccount-as-identity binding (agent name → resolver → account).

**What Safe has that we don't**: production-grade audit history, ecosystem, hardware wallet
flows out of the box, battle-tested guards.

**What we borrow (without depending)**: the `MultiSend` shape inspires `executeBatch`; the
multisig threshold pattern inspires our `QuorumEnforcer`. Both re-implemented in our contracts.

---

### Safe + Zodiac (Roles Modifier, Reality, Bridge)

| Aspect | Safe + Zodiac | Proposed |
|---|---|---|
| Per-role per-target per-selector permission | Yes (Roles v2 supports calldata patterns) | Yes (AllowedTargets + AllowedMethods + CallDataHash) |
| Sub-delegated sessions | Limited (roles are fixed bundles) | Native (ERC-7710 chains) |
| Composability | Module-based | Delegation chains with caveats |

**Closest existing analog to our caveat-enforcer model is Zodiac Roles Modifier v2.** Its
`decodeAbi` parameter scoping is roughly equivalent to AllowedMethods + CallDataHash +
ValueEnforcer.

The proposal goes further with **per-tx calldata hash + short-window timestamp + delegate-bound
session key** — each sensitive operation is a purpose-built micro-delegation that expires in
minutes.

---

### Aragon (OSx)

| Aspect | Aragon | Proposed |
|---|---|---|
| Governance machinery | Plugins → action queue → executor | None at registry level |
| Commitments vs execution | Same lifecycle | **Pledges & honor are explicitly different events** |
| Treasury | DAO contract holds funds, plugins authorize | AgentAccount holds funds, delegations authorize |

Aragon: "membership → proposal → execution". Ours: "anyone-can-pledge → settle-when-able".
Different beasts. Pledge isn't a governance vote, it's a stated commitment that may or may not
be backed by cash.

---

### Llama

| Aspect | Llama | Proposed |
|---|---|---|
| Strategy / executor separation | First-class | Implicit |
| Policy NFTs (roles) | Yes | Roles via AgentAccount ownership + delegation chains |
| Action-based perms | Yes (Strategy contracts) | Selector + calldata-hash on a per-delegation basis |

Llama's strategy-based action approval is closer to a **DAO proposal workflow** than a treasury
workflow. For "donor decides to pay X to pool", you wouldn't want an approval queue — that's
friction.

---

### Endaoment / Giveth / Octant

These are the closest **functional** analogs (commitment-based donor pools).

| Aspect | Endaoment | Giveth | Proposed |
|---|---|---|---|
| Pledge vs payment separation | No — donations atomic | No — donations atomic | **Yes — pledge → honor → settled** |
| Recurring pledges | No | Limited (Superfluid streams on some surfaces) | **Cadence on chain: one-time / monthly / annual / recurring** |
| Story permissions / anonymity tier | Donor-side toggle | Public by default | **Per-pledge cascade: public / coarse / anonymous; SHACL-enforced privacy** |
| Off-chain payment reconciliation | No | No | **`markPaid` second rail with attested evidence hash** |
| Multi-token | Limited | Yes | Token-agnostic storage, USDC-first settlement |

Where the proposal innovates:

- **Stated commitment as on-chain primitive.** Endaoment / Giveth treat donation as the
  source-of-truth event. We treat pledge as the source-of-truth event and settlement as an
  audit trail attached to it. This matches how funders, charities, and non-profits actually
  operate (pledges in capital campaigns are tracked separately from paid receipts).
- **Two-rail settlement.** Genuinely uncommon: it lets a donor pay outside the system (bank
  transfer, check, in-kind) and have the pool admin record it on chain as an attestation
  backed by an evidence hash. Standard donor-pool products force on-chain settlement, locking
  out donors who prefer Stripe/ACH/check.

---

### Bulla Network / Request Network

| Aspect | Bulla | Request | Proposed |
|---|---|---|---|
| Invoice-as-commitment | Yes | Yes | Yes (pledge ≈ invoice) |
| Payment proof on chain | Required | Required | **Two rails** |
| Multi-party (pool of payers + recipient) | Limited | No | **Yes (pool with multiple pledgers)** |

Bulla is the closest **protocol-level** analog to the pledge primitive. Differences:

- Bulla is bilateral (payer → payee). We're one-to-many (donor → pool).
- Bulla requires on-chain payment. We allow attested external payment.
- Bulla has no permissioning of who can issue an invoice. We gate pledges via marketplace
  credentials (AnonCreds + admin delegation).

---

### Sablier / Superfluid (streaming)

Not a direct comparison — streaming-payment products solve "automate recurring crypto
payments". They don't help with:

- "Pledge to give later when ready" (no commitment without funds).
- "I paid you by bank transfer — please record it" (no external rails).

Sablier could complement v2: recurring pledges optionally backed by a Superfluid stream from
the donor treasury to the pool, with the monthly drip auto-triggering `recordHonor`. Out of
scope for v1 — captured in `v2-backlog.md`.

---

## Identity / Auth product comparisons (for context)

### Privy / Magic / Dynamic / Web3Auth

| Aspect | Privy / Magic / Dynamic / Web3Auth | Proposed (sessionless passkey + SIWE) |
|---|---|---|
| Custody of session keys | Vendor's MPC / TEE | Our session-EOA, derived from server master IKM, forgotten after use |
| WebAuthn signature shape | Vendor decides; we adapt | We define exactly; ERC-1271 on AgentAccount verifies |
| OAuth login | Vendor's hosted UI | We implement Google OAuth ourselves |
| Recovery | Vendor's recovery flow | Our `RecoveryEnforcer` + OAuth-gated timelock |
| Privacy story | Vendor sees auth events | All auth events stay in our infra |

**Per P1**: we don't use any of these as a runtime dependency. We study their UX for the
flows (Privy's "embedded wallet for OAuth user" pattern is a useful reference for our
sessionless-passkey design).

### MetaMask Delegation Toolkit / DeleGator

| Aspect | MetaMask DT | Proposed |
|---|---|---|
| ERC-7710 implementation | Yes — `DeleGatorCore` + caveats | Yes — our own `DelegationManager` + `enforcers/` |
| Caveat enforcer library | Theirs | Ours: 18 enforcers in `packages/contracts/src/enforcers/` |
| SDK | Theirs | Ours in `packages/sdk/` |

We **implement ERC-7710 ourselves** rather than import their library. ERC-7710 is an open
standard; the toolkit is one party's implementation of it. We study their toolkit as a
reference for the patterns + edge cases we should cover.

---

## Genuinely novel in our approach

1. **Pledge-honor separation as a first-class on-chain pattern.** No major existing product
   treats "stated commitment" as a primitive distinct from "payment". The closest is
   non-profit pledge-tracking software, which is all off-chain.

2. **Attested external-payment rail with evidence-hash anchor.** Lets the on-chain system
   reflect Web2 payment reality (bank transfers, checks, cash) without lying about
   cryptographic settlement. Treasury products treat off-chain payments as out of scope.

3. **Caveat-enforcer-based sub-delegation for sensitive ops.** Each honor / mark-paid is a
   one-shot delegation with calldata hash + short timestamp window — finer-grained than Safe
   roles (long-lived) or Llama strategies (action-class scoped).

4. **AgentAccount-as-identity binding treasuries to agents.** Treasuries are not anonymous
   wallets — they're explicitly bound to a person agent, with the privacy tradeoff
   documented. This lets the pool know "Maria pledged $100" without making the donor figure
   out cross-wallet bookkeeping. Trade-off is captured in `threat-model.md`.

---

## Where we're weaker (and accept)

1. **Audit history.** Safe has 5+ years of audited prod. Our enforcers are newer.
2. **Ecosystem composability.** Safe accounts work with every DeFi protocol; AgentAccounts
   work with what we build.
3. **No standard guard / firewall integration.** Safe has Cobie Guard, anti-phishing modules.
4. **Treasury ops UX maturity.** Coinshift / Den / Multis give DAOs polished batch-payment +
   payroll + reporting UX. We don't yet.
5. **Linkable donor identity.** By design.

We accept these trade-offs because the **value is in the pledge primitive + identity-bound
treasury**, not in re-creating Safe's polish.

---

## Patterns we borrow (with attribution)

Per P1, every borrowed pattern is re-implemented in our codebase, not imported:

| Pattern | Source | Our implementation |
|---|---|---|
| Batched calls in one tx | Safe `MultiSend.sol` | `AgentAccount.executeBatch` (proposed) |
| Roles-based per-target / per-selector / per-arg permission | Zodiac Roles Modifier v2 | AllowedTargets + AllowedMethods + CallDataHash enforcers |
| Calldata hash binding | MetaMask DT `CallDataHashEnforcer` | `packages/contracts/src/enforcers/CallDataHashEnforcer.sol` |
| Donor-advised fund commitment shape | Endaoment | `PledgeRegistry` commitment subject |
| Invoice / receipt content addressing | Bulla / Request | `pledgeEvidenceHash` + org-mcp blob |
| Token-streaming for recurring obligation | Sablier / Superfluid | (v2 backlog — not in v1) |

---

## Why not B or C

- **Option B (Safe as custody + our PledgeRegistry)**: introduces two account models in one
  system. Identity binding (agent name → AgentAccount) doesn't transfer to a Safe address
  without a brittle redirect layer. ERC-1271 surface is now Safe's, not ours. Recovery flow
  is Safe's, not ours. Per P1: **no**.

- **Option C (build now, migrate to Safe later)**: explicitly an escape hatch from P1.
  Migration costs are real (every delegation chain, every reader, every UI surface assumes
  AgentAccount). If we ever genuinely need Safe-grade custody for a high-value treasury,
  the right move is to add Safe-compatible behavior to AgentAccount (e.g., add a
  `Safe-like-multisig-mode` configuration), not to swap substrates.

Locked: **Option A** — build, study, attribute, never depend.
