# Smart Contract Security Plans

> **Audience**: engineering manager, security lead, board sub-committee.
> Use as the project plan for getting `packages/contracts/` production-ready.
> Every document here is grounded in real contract code (cited with
> `file:line`) and real vendors (cited with current URLs at time of
> writing, 2026-05-18).

This directory complements `docs/security/cryptographic-posture/`
(threat model, replay analysis, crypto-agility, subliminal channels) and
`docs/security/key-management/` (KMS custody). The cryptographic-posture
work tells reviewers what we believe; this directory tells the project
team what we **do** about it.

## What lives here

| Doc | Type | Approx scope | Pre-req |
|---|---|---|---|
| **SC1** | Procurement plan | External audit RFP/RFQ scaffolding | Spec 007 Phase A landed (✅ 2026-05-18) |
| **SC2** | Procurement + analysis | Formal-verification programme | SC1 firm selected (so FV is complementary, not redundant) |
| **SC3** | Procurement + ops | Bug-bounty programme | SC1 final report + remediation review |
| **SC4** | **Implementation spec** | Upgrade-governance multisig + timelock | Phase A.5 follow-up; in-scope before mainnet |
| **SC5** | Analysis + impl spec | Reentrancy + external-call audit | SC1 in flight (we hand this to them) |
| **SC6** | Analysis | MEV / front-running posture | None — internal exercise |
| **SC7** | Impl spec | Storage-layout safety for UUPS upgrades | Phase A.5 (paired with SC4) |
| **SC8** | Ops plan | Testnet rehearsal (4-week soak) | SC1 remediation done; SC4 deployed |
| **SC9** | Analysis | Cross-chain replay-protection audit | Internal exercise; pairs with C2 |

## Reading order

For an engineering manager building the project plan:

1. **SC1** — what the audit will cost in time, money, and internal prep.
2. **SC4** — the biggest internal implementation item that has to ship
   alongside the audit.
3. **SC7** — paired with SC4; storage-layout discipline locks in our
   ability to ship the upgrade-governance contract without breaking
   live accounts.
4. **SC5** — the load-bearing analysis we hand to the auditor; reading
   it tells the manager what threat surface the audit is sized for.
5. **SC9** — small, high-leverage internal audit; the manager should
   pencil it into the same sprint as SC5.
6. **SC6** — informational; affects bundler-relay design, not contracts
   directly.
7. **SC2** — secondary track; only meaningful after SC1 vendor selection.
8. **SC8** — the gate before mainnet.
9. **SC3** — ongoing programme after live deploy.

For a security lead:

1. **SC1** scope section — what's in-scope, what isn't, why.
2. **SC5** — full read; this is the central technical concern.
3. **SC9** — full read; small, surgical, and easy to miss.
4. **SC4** — review the threat assumptions and the multisig design.
5. **SC6** — review bundler-MEV section.
6. **SC2 / SC3 / SC7 / SC8** — context for resource planning.

## Status snapshot (as of 2026-05-18)

| Doc | Status | Owner | Next gate |
|---|---|---|---|
| SC1 | Draft, ready for vendor outreach | engineering manager | Issue RFQ |
| SC2 | Draft | security lead | Decide Certora vs Halmos-only |
| SC3 | Draft, deferred until post-audit | security lead | Activate after SC1 |
| SC4 | Implementation spec — needs PM/dev pickup | developer + security | Land Phase A.5 |
| SC5 | Draft, ready for auditor handoff | security lead | Bundle into SC1 RFQ |
| SC6 | Draft | security lead | Validate with bundler operator |
| SC7 | Implementation spec — needs developer pickup | developer | CI guard PR |
| SC8 | Draft | infra | Schedule against SC1 timeline |
| SC9 | Draft, ready to execute | developer | Land cross-chain Foundry tests |

## Glossary

- **AA / ERC-4337**: account abstraction. `EntryPoint.handleOps`,
  `validateUserOp`, paymasters, bundlers.
- **DeleGator / ERC-7710**: MetaMask's delegation pattern. Smart-account
  signs a `Delegation` struct; `DelegationManager.redeemDelegation` runs
  caveat enforcers and executes through the delegator. We implement our
  own (`packages/contracts/src/DelegationManager.sol`).
- **UUPS / ERC-1822**: the proxy pattern AgentAccount uses. Upgrade
  authority lives in the implementation contract itself.
- **Caveat enforcer**: a small contract implementing `ICaveatEnforcer`
  that gates a delegation by running `beforeHook` / `afterHook` inside
  `DelegationManager.redeemDelegation`. See
  `packages/contracts/src/enforcers/` (16 enforcers as of Phase A).
- **Master / bundler / session-issuer signer**: three distinct system
  keys post-Phase-A; none are owners of any user account. See
  `specs/007-architecture-hardening/phase-A-contract-role-split.md` and
  `docs/security/cryptographic-posture/C1-threat-model.md`.
- **Phase A**: the contract role-split landed at commit `c8d7052` —
  the foundation this entire programme assumes.

## What is intentionally **not** here

- KMS-side custody for the keys above: lives in
  `output/KMS-IMPLEMENTATION-PLAN.md` and the K0-K7 phase doc set.
- Threat model + adversary inventory: `docs/security/cryptographic-posture/C1-threat-model.md`.
- Variant A replay analysis: `docs/security/cryptographic-posture/C2-replay-analysis-variant-a.md`.
- Operational runbooks for KMS rotation, incident response, key
  ceremony: `docs/runbooks/`.

If you're looking for any of those, those are the canonical homes.

## Reviewer touchpoints

When a doc references a fix the engineering team owes the reviewer, it
will be tagged `[OWE-REVIEWER]`. When a doc commits the project to a
specific decision (vendor choice, dollar range, calendar gate), it is
tagged `[DECISION]`. Search either tag to surface every action item /
commitment in one pass.
