# Smart Agent — Cryptographic Posture (Phase H Deliverable)

> Audience: external security reviewers (Trail of Bits / Cure53 / NCC Group
> tier) and the board sub-committee that signs off on the spec 007
> rollout. Documents are intentionally code-cited, system-specific, and
> honest about residual risk. No boilerplate. No security theatre.

## Why these documents exist

Spec 007 (`specs/007-architecture-hardening/plan.md`) closes the gap
between Smart Agent's stated security principles
(`docs/architecture/principles.md`) and the current implementation.
Phase H is the "privacy + infrastructure-as-code" terminus of that work
and is also where the deliverable artefacts a board / external reviewer
needs in order to sign off live. This directory holds four of those
artefacts (the runbooks, IaC, and AnonCreds custodial policy ship
separately under `docs/runbooks/`, `infra/terraform/`, and
`docs/privacy/`).

The four documents are designed to be read together by a reviewer who
understands ERC-4337 / ERC-7710 / ERC-1271 / WebAuthn but does not yet
know the system. They give the reviewer:

1. The complete adversary model and the per-adversary mitigation
   inventory (**C1**).
2. A focused dive on the single highest-leverage residual replay
   surface — Variant A off-chain delegations (**C2**).
3. The cryptographic-agility plan, including the post-quantum migration
   path that the substrate-independence rule (P1) leaves us responsible
   for executing ourselves (**C3**).
4. A small but load-bearing piece of due diligence on subliminal
   channels in ECDSA, including a concrete finding about AWS KMS that
   affects how we deploy (**C4**).

## Reading order

1. **C1 — Threat model.** Read first. Authority graph + 16 adversary
   classes + 5 compound chains + accepted residual risks.
2. **C2 — Variant A replay analysis.** Specific to the off-chain
   delegation lane introduced in Phase B; cites the contract code that
   defends it.
3. **C3 — Cryptographic agility & PQC.** Migration plan per primitive;
   hybrid signing scheme proposal for AgentAccount.
4. **C4 — Subliminal channels.** Contains a real finding about AWS KMS
   ECDSA nonce generation. Bounded scope but actionable.

The four documents are independent after C1; C2/C3/C4 do not assume
each other.

## Status

| Doc | Status | Notes |
|---|---|---|
| C1 | DRAFT — internal review pending | Comprehensive but expect external reviewers to add adversary classes we missed. |
| C2 | DRAFT — internal review pending | Spec a `MaxDelegationsPerPeriodEnforcer` + `MaxActionsPerPeriodEnforcer` proposal; not yet implemented. |
| C3 | DRAFT — internal review pending | NIST FIPS 204 / 205 finalised Aug 2024; Smart Agent action items defined here, no code yet. |
| C4 | DRAFT — internal review pending; **contains a CI-test recommendation** | Confirmed via AWS docs: AWS KMS ECDSA uses randomized k; recommends a deterministic-k application-layer wrapper for high-stakes signing OR exclusive use of Schnorr / EdDSA where available. |
| External audit | PENDING | Phase H exit. Vendor TBD. |

## Cross-references

- `docs/architecture/principles.md` — the substrate-independence rule
  (P1) that defines what we own vs. what we delegate to vendors.
- `specs/007-architecture-hardening/plan.md` § Phase H — the deliverable
  list that includes this directory.
- `docs/runbooks/aws-kms-setup.md`, `docs/runbooks/gcp-kms-setup.md` —
  operational KMS surface referenced by C1 A6 and C4 § 3.
- `output/KMS-IMPLEMENTATION-PLAN.md`, `output/GCP-KMS-IMPLEMENTATION-PLAN.md` —
  KMS migration plans; referenced by C3 § 5 and C4 § 3.

## Glossary

| Term | Meaning in this codebase |
|---|---|
| **AgentAccount** | The ERC-4337 + UUPS user smart account. Source: `packages/contracts/src/AgentAccount.sol`. |
| **Master signer** | An EOA (KMS-backed in prod) that historically co-owned every AgentAccount via the factory's `serverSigner` field. Phase A drops that co-ownership; master is reduced to envelope-only roles (MAC, bundler relay). |
| **bundlerSigner** | New Phase A capability role. EOA authorized to submit ERC-4337 EntryPoint envelopes. NOT an owner. |
| **sessionIssuer** | New Phase A capability role. EOA that co-signs SessionAuthorization envelopes for Variant B sessions. NOT an owner. |
| **Variant A** | Phase B off-chain caveated delegation. User signs an EIP-712 `Delegation` at session-init; stored encrypted in person-mcp; redeemed on chain via `DelegationManager.redeemDelegation` at action time. |
| **Variant B** | Phase B on-chain delegation registration. User signs a userOp that calls `acceptSessionDelegation(sessionDelegationHash)` on their own AgentAccount; subsequent session actions reference the on-chain record. |
| **MAC** | Inter-service authentication. HMAC-SHA256 in dev (`local-hmac`); `kms:GenerateMac` / `kms:VerifyMac` in prod (`aws-kms-mac.ts`, `gcp-kms-mac.ts`). |
| **Caveat enforcer** | An on-chain contract implementing `ICaveatEnforcer`. Eight in tree under `packages/contracts/src/enforcers/`. Run inside `DelegationManager.redeemDelegation` before execution. |
| **HNDL** | Harvest-Now-Decrypt-Later. Adversary captures ciphertext today and decrypts when CRQC arrives. Relevant for any long-confidentiality data (PII, AnonCreds link secrets). |
| **CRQC** | Cryptographically Relevant Quantum Computer. NIST and NSA project early 2030s as the inflection but no public timeline. |

---

*Last updated: 2026-05-18. Authors: agent (Phase H prep). Reviewers
pending.*
