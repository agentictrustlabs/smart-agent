# Architectural Principles

Cross-cutting rules every spec must respect. Each principle is a hard
constraint, not a suggestion. Deviations require an explicit waiver
recorded in the spec that deviates.

---

## P1. Substrate independence

**We build our own contracts, our own SDK, our own wallet substrate.
We learn from external products. We do not depend on them as
production substrate.**

### What this means concretely

- **No production runtime dependency** on:
  - Safe (Gnosis Safe, Zodiac modules, Safe Apps SDK).
  - Privy, Magic, Dynamic, Web3Auth, or other identity-provider products.
  - MetaMask Delegation Toolkit / DeleGator as an imported library.
  - Coinshift, Den, Multis, Utopia Labs, or other treasury-ops products.
  - Llama, Aragon OSx, or other DAO frameworks as a dependency.
  - Hosted indexer SaaS (Goldsky, Alchemy Subgraphs) as a hard requirement —
    we run our own indexers / readers.
- **What we DO use freely**:
  - **Open standards**: ERC-4337, ERC-7710, ERC-1271, ERC-712, ERC-6492,
    EIP-7702, AnonCreds, OID4VCI, WebAuthn, SIWE, etc. Standards are
    protocols, not products. We implement them ourselves.
  - **Open-source primitive libraries** that are narrow and
    well-audited: viem, OpenZeppelin contracts (specific files, not
    framework-level), foundry, Aries Askar / askar-storage.
  - **Reference implementations as study material**: read their
    contracts, borrow patterns, cite them in design docs. Never import
    their packages into our runtime.

### Why

- **Identity coherence**: our `AgentAccount` is identity + custody +
  delegation surface in one. Splitting custody into Safe (or wallet
  into Privy) means two account models in one system, two recovery
  flows, two ERC-1271 surfaces, two audit boundaries.
- **Auditability**: own code is auditable in one pass. Vendored
  framework code (Aragon OSx, Llama Strategies) inflates the audit
  scope and couples our security posture to the vendor's release
  cadence.
- **No vendor capture**: products pivot, change pricing, deprecate
  features. Standards don't.
- **Patterns are cheap to borrow; substrates are expensive to migrate**:
  reading Safe's `MultiSend.sol` to learn the executeBatch shape is a
  one-hour read. Migrating off Safe later is a multi-quarter project.
- **Privacy story stays coherent**: we control how PII flows through
  every layer — every external SDK we adopt is a third party we'd have
  to vet against the IA classification.

### Anti-patterns this rule kills

- "Let's use Safe so we get audited custody" — leads to two account
  models in one system; the identity binding (`AgentAccount` ↔ agent
  name) doesn't transfer cleanly to a Safe.
- "Let's use Privy for OAuth + passkey" — leads to a third party in
  the auth path, custody of session keys outside our control, and
  vendor decisions about WebAuthn signature shapes we don't get to
  override.
- "Let's pull in MetaMask Delegation Toolkit since we use ERC-7710" —
  we already implement ERC-7710 ourselves in `packages/contracts/` +
  `packages/sdk/`. Importing their toolkit duplicates the surface and
  ties us to their release cycle.

### When learning from external products is required

Any spec that introduces a domain comparable to a well-known product
**must** include a `comparison.md` (in the spec folder) that:
1. Surveys the closest 3–6 existing products.
2. Identifies what they get right and what's genuinely novel about
   our approach.
3. Cites which patterns we borrowed (with file references in the
   external repo if open-source).
4. Explicitly records the decision NOT to depend on those products,
   referencing this principle.

Examples in the codebase:
- `specs/005-pledge-honor/comparison.md` — pledge ledger vs.
  Safe / Aragon / Llama / Endaoment / Bulla.
- `docs/architecture/agent-control.md` — agent control vs. Safe
  multisig / Llama action / Aragon proposal patterns.

---

## P2. Chain is source of truth for public state

(See `docs/information-architecture/` — IA invariant P4.)

The on-chain registries (AgentAccountResolver, FundRegistry,
PledgeRegistry, VoteRegistry, GrantProposalRegistry, etc.) are the
source of truth for any data that's public or public-coarse. SQL is
cache. GraphDB is a mirror via the on-chain → GraphDB sync. The
MCP → GraphDB direct pipe is forbidden.

---

## P3. Body in owner's MCP

Private body data (intents, proposals, profile data, recovery state)
lives in the agent's MCP (person-mcp for person agents, org-mcp for
org agents). Web SQL is becoming thin; new private data goes to MCP,
not to the web app's SQLite.

---

## P4. Sensitive operations require exact-call sub-delegation

Asset-affecting and account-mutating operations (pledge honor,
treasury transfer, key rotation) MUST be redeemed under a
sub-delegation whose caveats include:
- `AllowedTargetsEnforcer` — bound to the exact target contract.
- `AllowedMethodsEnforcer` — bound to the exact selector.
- `CallDataHashEnforcer` — bound to the exact calldata hash.
- `TimestampEnforcer` — short window (≤ 5 min).
- `ValueEnforcer` — exact ETH value (usually 0).

Broad session authority cannot substitute. Session keys for
read-only or low-risk ops are fine.

---

## P5. Stateless auth for passkey + SIWE

Passkey and SIWE users have NO `users` row in web SQL. Auth is
anchored on chain via `AgentNameResolver` + `AgentAccount.isValidSignature`.
The session JWT carries everything `getCurrentUser` needs. Profile
data comes from the user's person-mcp via delegation post-auth.

(See `memory/project_sessionless_passkey_siwe.md`.)

---

## P6. Deployer is for bootstrap, not user-action signing

The deployer EOA is for **contract deployment + governance/system writes**
(ontology registration, type registry seeding, class-assertion emission,
boot-time agent registration). It MUST NOT sign delegations on behalf of an
end-user's AgentAccount to perform their authorized actions.

### Concretely

- **Demo users** sign with their stored `users.privateKey` (their EOA is
  registered as an owner of their smart account at `factory.createAccount(eoa, salt)`
  time → ERC-1271 accepts).
- **Passkey/SIWE users** sign via their passkey/EOA. Until the passkey
  signing ceremony lands, `loadSignerForCurrentUser` returns a
  deployer-backed signer for stateless sessions — **v1 placeholder scoped
  to stateless sessions only, never reachable by demo users**. The
  placeholder is explicitly labeled in the comment at `apps/web/src/lib/ssi/signer.ts:34-37`.
- **Self-issue** (`selfIssueMarketplaceCredential`, `selfIssuePledgerDelegation`):
  caller's own key is the only signer. The wrapper requires `signerPrivateKey`
  as a parameter — no implicit deployer fallback inside the SDK helper.
- **Admin-issue to other holder** (`addRoundVoter` → `issueMarketplaceCredential`):
  admin's own key signs the admin→holder delegation; holder's own key signs
  their wallet provisioning. Neither slot defaults to the deployer.
- **Pledge auth**: `PledgeRegistry.submit` is permissionless on chain; the
  donor signs only their own session leaf. `amend`/`stop` gate on
  `msg.sender == sa:pledgeDonor`. No admin→holder needed.

### Tripwire

Any new code path that uses `process.env.DEPLOYER_PRIVATE_KEY` inside a
`*.action.ts` file (a user-action server action) is suspect. Audit it
against this rule before merging. Legitimate deployer uses live in:
- `lib/onchain/*Assertion.ts` (class-assertion observer)
- `lib/demo-seed/*` and `scripts/seed-*.ts` (boot-time)
- `lib/ssi/signer.ts` (stateless-session placeholder — documented)
- `lib/contracts.ts::getWalletClient` (general deployer wallet for system writes)
- `lib/actions/onboarding/*` and `lib/actions/passkey/*` (account deployment)
- `lib/actions/recovery/*` (account recovery oracle)

---

## How to apply

When proposing or reviewing a spec:

- ✅ "We borrowed the executeBatch pattern from Safe's MultiSend" — fine.
- ❌ "We'll add `@safe-global/safe-core-sdk` as a dependency" — violates P1.
- ✅ "We hash evidence with sha256 and store in org-mcp" — fits P3.
- ❌ "We'll use Pinata for evidence storage" — would add a vendor; needs
  explicit waiver if there's no in-system alternative.
- ✅ "Pledge honor uses sub-delegation with CallDataHashEnforcer" — fits P4.
- ❌ "Pledge honor uses the existing A2A session" — violates P4 (session
  is broad, honor is asset-affecting).
