# Spec 005 — Pledge Honor & Treasury Funding

Adds on-chain settlement to the pledge primitive: donors honor commitments by transferring USDC from a personal treasury, and pool admins can attest external (off-chain) payments. Personal treasuries are ERC-4337 AgentAccounts linked to person agents.

## Status

| Phase | State |
|---|---|
| 1. Design lock | ✅ locked (see `plan.md`) |
| 2. Contracts | ⏳ pending |
| 3. Infra | ⏳ pending |
| 4. SDK | ⏳ pending |
| 5. Web actions + MCP | ⏳ pending |
| 6. UI | ⏳ pending |
| 7. Tests | ⏳ pending |
| 8. Docs + memory | ⏳ pending |

## Document map

| Doc | What | Owner |
|---|---|---|
| `plan.md` | Locked decisions, phased delivery, owner per phase | PM |
| `comparison.md` | Safe / Aragon / Llama / Endaoment / Bulla comparison + locked Option A (substrate independence) | Reviewer |
| `contracts.md` | MockUSDC + AgentAccount.executeBatch + PledgeRegistry honor/markPaid surface | Developer |
| `threat-model.md` | Security analysis, exact-call sub-delegation requirements | Security |
| `evidence-storage.md` | sha256 hash on chain, blob in org-mcp | IA + Developer |
| `settlement-rails.md` | Two rails: cryptographic (donor treasury) + attested (admin markPaid) | IA + Developer |
| `test-plan.md` | T1–T12 unit + integration + E2E | Tester + QA |
| `v2-backlog.md` | Deferred: shielded anonymity, non-USDC settlement, IPFS evidence, etc. | PM |

## Reading order by role

- **All agents**: start with `plan.md` § "Goals + Invariants" then your domain doc.
- **Developer**: `contracts.md` → `evidence-storage.md` → `settlement-rails.md`.
- **Reviewer / Security**: `comparison.md` → `threat-model.md`.
- **Ontologist**: `docs/ontology/SPEC005_PLEDGE_HONOR_AUDIT.md` (when authored).
- **IA**: `docs/information-architecture/12-pledge-honor-classification.md` (when authored).
- **Tester**: `test-plan.md`.

## Key locked decisions

1. **Build, don't borrow.** Personal treasury = AgentAccount we deploy ourselves. We do NOT depend on Safe / Privy / MetaMask DTK at runtime — see `docs/architecture/principles.md` § P1.
2. **Mark-paid auth = direct owner only.** Cross-delegation deferred to v2.
3. **Multi-token at storage layer**, USDC-only at settlement layer for v1.
4. **Evidence = sha256 content hash** on chain, blob in org-mcp (v1: admin pastes pre-computed hash; v2: HTTP fetch endpoint).
5. **Non-USDC pledges (prayer-minutes, hours, …) use mark-paid attestation only** in v1 — no cryptographic honor path. Documented in v2-backlog.
