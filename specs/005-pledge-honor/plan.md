# Spec 005 — Pledge Honor / Treasury Funding — LOCKED Plan v1

> **Cross-cuts**: this spec follows the project principles in `docs/architecture/principles.md`. In particular:
> - **P1 (substrate independence)** — we build our own treasury, do not depend on Safe / Privy / MetaMask DTK.
> - **P2** — chain is source of truth for public state.
> - **P4** — sensitive ops (honor, markPaid) require exact-call sub-delegation.
> - **P5** — passkey/SIWE auth is stateless; honor path uses deployer-fallback signing for those users.

---

## Goals + Invariants

- **Pledge stays a commitment, honor is a separate settlement event.** A pledge can exist without payment; payment can happen without going through the donor treasury.
- **Two settlement rails, one ledger.** Donor-treasury (cryptographic, same-tx) + org-owner mark-paid (attested, evidence-backed). Same `pledgeSubject` aggregates both.
- **On-chain is source of truth.** `PledgeRegistry` carries honored + marked amounts; GraphDB mirrors via the on-chain → GraphDB sync; no SQL.
- **MockUSDC dev-only.** Mint paths gated on `chainId === 31337`. Never minted on public networks.
- **Reuse, don't duplicate.** Org/pool/fund treasuries are existing AgentAccounts — no second treasury per org just to seed USDC.

## Locked Decisions

| # | Question | Decision |
|---|---|---|
| 1 | `CalldataHashEnforcer` | ✅ exists at `packages/contracts/src/enforcers/CallDataHashEnforcer.sol` — reuse |
| 2 | Mark-paid auth | **Direct owner-only**: `_isAccountOwner(fundAgent, msg.sender)`. Cross-delegation deferred to v2 |
| 3 | Multi-token settlement | **Future-proof**: store honored/externally-paid as `(subj, token) → uint256` composite. Use `keccak256(abi.encode(subj, "honored", token))` as composite subject — fits AttributeStorage flat KV |
| 4 | Evidence storage | **Content-addressable**: sha256 hash on chain (`pledgeEvidenceHash` bytes32), blob in org-mcp. v1: admin pastes pre-computed hash. v2: HTTP `/evidence/:hash` endpoint |
| 5 | Pledge currency = settlement currency | **v1 restriction: USDC-only honor path**. Non-USDC pledges (prayer-minutes, hours, etc.) use `markPaid` attestation only. Surface as "Honor via external mark-paid only" + document in `v2-backlog.md` |
| 6 | **Build-vs-reuse: Option A (build as proposed)** | **LOCKED** per `docs/architecture/principles.md` § P1. We build our own treasury substrate. We study Safe / Privy / MetaMask DTK as references, never as runtime dependencies. See `comparison.md` for the full rationale. |

## Phased Delivery

| Phase | Owner pipeline | Deliverable | Est. |
|---|---|---|---|
| 1. Design lock | PM → IA → Ontologist → Security → Reviewer | This doc + sibling docs signed off | 0.5d |
| 2. Contracts | Developer → Reviewer → Tester | MockUSDC + executeBatch + PledgeRegistry extensions; deploy script | 1.0d |
| 3. Infra | Developer (Infra) | `fresh-start.sh` + `deploy-local.sh` extended; env wiring | 0.3d |
| 4. SDK | Developer | Helpers + tool policies + selectors | 0.5d |
| 5. Web actions + MCP tools | Developer → Reviewer | Provisioning, honor, mark-paid; readers extended | 1.0d |
| 6. UI | UX → Developer | Dashboard balance, pledge detail honor form, steward mark-paid form | 1.0d |
| 7. Tests + smoke | Tester → QA → Test User | Unit + integration + E2E | 0.5d |
| 8. Docs + memory | Documentarian | Audit doc, IA classification, CLAUDE updates, memory entry | 0.3d |

**Total**: ~5 person-days sequential; ~3 calendar days with parallelism.

## IA Classification

(See `docs/information-architecture/12-pledge-honor-classification.md` for the full table — short summary here.)

| Artifact | Store | Tier |
|---|---|---|
| `MockUSDC` balance | chain | Public |
| `personalTreasuryAddress` link | chain (AgentAccountResolver) | Public-coarse |
| `pledgeHonoredAmount[token]` | chain (PledgeRegistry) | Public |
| `pledgeExternallyPaidAmount[token]` | chain (PledgeRegistry) | Public-coarse |
| `pledgeEvidenceHash` | chain (PledgeRegistry) | Public |
| Evidence blob content | org-mcp | Private |

No MCP→GraphDB direct pipe (P2). Honor + mark-paid events flow into GraphDB via the existing on-chain sync.

## Open work (not blocking sign-off, captured in v2-backlog)

- Cross-delegation for steward `markPaid` (steward ≠ pool owner).
- Multi-token settlement for non-USDC pledges via attested or shielded rails.
- IPFS/Arweave evidence resolvers as alternatives to org-mcp blob storage.
- HTTP `/evidence/:hash` fetch endpoint on org-mcp.
- Shielded donor anonymity (currently `personalTreasury` is linkable by design).
- Treasury reporting UX (batch payments, payroll-style summaries).

See `v2-backlog.md` for the full list.
