# Treasury Build — Frozen Decisions on Open Questions

> Captures the architectural calls I'm making on every "open question" raised by the PM, Plan, UX, and on-chain-attributes planning agents. Per the user's directive to make best assumptions and proceed.
>
> Each decision is reviewable; if any single one is wrong, only that decision's downstream code changes — the surrounding scaffold doesn't.

---

## A. From the UX plan

### A1. Does Phase 2.7 discretionary allocation bypass the 72h dispute window?
**Decision: yes, no dispute window for discretionary disbursements.**
Rationale: discretionary is the "small / fast / mutual-aid" path. A $50 pantry-help payment can't wait 72h. The 72h window's value is concentrated in formal-round disbursements where stakes (and information asymmetry) are higher. Mitigations sit at a different layer:
- Per-action cap (decision A2 below) limits blast radius
- Daily-cap account guard (decision B5) limits total exposure
- Steward signing (still required) provides the human review

If a steward later regrets a discretionary disbursement, the rescission path (Phase 4) still works — funds can be clawed back via `grant_proposal:rescind` semantics adapted to discretionary records.

### A2. Per-action cap for steward discretionary allocation?
**Decision: 5% of pool's `pledgedTotal` per action, OR `$1,000 USDC` (whichever is smaller), with a daily cap of 15% per steward.**
Encoded in `AllocationLimitEnforcer.terms.capAmount` for per-action; `MaxDailyTransferGuard.dailyCap` for daily. Pool can override at create time.

### A3. Treasury address in pledge signing — server-generated vs client prop?
**Decision: server-generated. The pledge UI's signing payload is built server-side from `pools.treasuryAddress` + the donor's session, never accepted from the client.**
Mitigates a malicious client redirecting funds to a stealth treasury. The server verifies the pool exists, is public OR donor is in addressedMembers, and the treasury address matches what's on chain.

### A4. Claim token format for `/claim/[disbursementId]`?
**Decision: 256-bit opaque token, never the disbursement id.**
Generated server-side as `keccak256(disbursementId || randomNonce)`, stored alongside the disbursement row in `org-mcp.db`, expires 90 days after issue. Public route accepts only the opaque token; backend resolves to the disbursement and renders the claim flow.

### A5. Per-tranche USDC floor to avoid gas-exceeds-disbursement?
**Decision: $25 USDC minimum per tranche.** Below that, the bundler-paid gas (~$2-5 on Base) eats too much of the disbursement. Pools can set a higher floor. Hard-coded in `AllocationLimitEnforcer.beforeHook` as a safety check (revert if `disburseAmount < MIN_TRANCHE_USDC`).

### A6. Who pays gas on the disbursement userOp?
**Decision: pool's paymaster sponsors gas in v1.**
Routing through Stackup or Pimlico paymaster, funded by the platform (not by the pool's USDC balance). Sustainable because disbursements are infrequent (tens per pool per month). v2 reconsiders self-funded paymaster if platform-sponsored becomes a bottleneck.

### A7. Email notification for steward sig collection?
**Decision: in-app inbox only at Phase 3 launch, email in Phase 3.5.**
Stewards already use the app; the notification badge on the Funding tab + a dedicated inbox at `/h/[hub]/inbox` is enough. Email integration adds a secrets/SMTP dependency that delays Phase 3. Phase 3.5 adds optional email subscription per user (via Resend or SES), opt-in.

---

## B. From the Plan agent

### B1. Sequencing — does Bucket 5 (sig collection) ship first?
**Decision: yes, the PM agent's recommendation overrides the original "2.7 first" default.**
Rationale: real-money Phase 3 cannot ship under deployer-auth; the sig-collection MCP layer is the cryptographic prerequisite. Building Phase 3 against a shim "lead steward signs alone via deployer key" creates a known refactor trap. Order:
1. **Bucket 5** — `treasury_proposal:* ` Safe-format sig collection (~2 weeks)
2. **Bucket 1** — Phase 2.7 discretionary path (~2-3 weeks; can run in parallel with Bucket 5)
3. **Bucket 3** — Phase 3 cleanup (chunked SPARQL UPDATE; ~1.5 weeks; can run in parallel)
4. **Bucket 2** — Phase 3 USDC custody (~4-5 weeks; depends on Bucket 5)
5. **Bucket 4** — Phase 4 outcomes/reputation (~3-4 weeks; depends on Bucket 2)

Total wall-clock: 11-14 weeks single-engineer; 7-9 weeks two-engineer parallel.

### B2. EIP-712 typed-data drift across payload types
**Decision: codify a single `apps/org-mcp/src/typedData/` directory with one file per payload type. Reviewer rule enforced via CI: any new typed-data must add a Foundry round-trip test.**
Files: `AllocationDecided.ts`, `DiscretionaryAllocation.ts`, `MandateUpdate.ts`, `OutcomeAttestation.ts`, `ValidatorRotation.ts`. Each exports `domain`, `types`, `version`. The `treasury_proposal:create` MCP tool's input schema validates `payloadType` against an enum drawn from this directory.

### B3. USDC precision — store as subunits or decimals?
**Decision: USDC subunits (integer, 6 decimals). All seed scripts updated; UI converts at display.**
`pools.pledgedTotal: bigint` holds `100_000_000n` for $100. UI helpers `formatUSDC(amount: bigint): string` and `parseUSDC(input: string): bigint`. Already partially in place; Phase 3 finishes the migration.

### B4. Reentrancy on `AgentAccount.execute`?
**Decision: add `nonReentrant` modifier now (one storage slot; cheap).**
USDC is non-reentrant by spec, but if we ever support arbitrary ERC-20 we want the protection. OpenZeppelin's `ReentrancyGuard` pattern; documented as "added during Phase 3 prep."

### B5. `IAccountGuard` slot — Phase 3 or earlier?
**Decision: Phase 3, alongside USDC custody.** The guards are most valuable when real money moves. Ship the slot + 3 reference guards (`DenyListGuard`, `DisputeFreezeGuard`, `MaxDailyTransferGuard`) as part of Phase 3.

### B6. Foundry test runtime growth — keep all under 30s?
**Decision: yes, gate slow E2E tests behind opt-in `forge test --match-test E2E`.**
Default `forge test` stays fast (under 25s). E2E suite (full-lifecycle Phase 3, Phase 4 attestation+rescission) runs on CI but not on every local change.

---

## C. From the PM agent

### C1. Per-steward discretionary cap default?
**Decision: 5% of pool capacity per action, 15% per steward per day** (matches A2 above).
Pool root can override at pool-create time via a `discretionaryCapPolicy` JSON field on the pool. Encoded in `MaxDailyTransferGuard.dailyCap` per asset.

### C2. First-mainnet-pool pilot scope?
**Decision: a single faith-based mutual-aid pool with $5K USDC seed capacity, 3 stewards (2-of-3), 30-day pilot.**
Scope: 50 expected disbursements, mean $50, max $500. Recipients pre-screened. Validators chosen from stewards' personal networks (not the steward set itself — separation of duties). Exit criteria: 0 funds lost to bugs; ≥80% disbursements attested within 14 days; documented runbook.

### C3. Validator-set default for v1?
**Decision: 1-of-N for disbursements ≤ $500, 2-of-3 for disbursements > $500.**
Validators default to the pool's stewards' personal networks (UI prompts pool root to nominate at pool-create time). High-value threshold encoded in `QuorumEnforcer.terms` on the validator delegation chain.

### C4. Cancellation guardian — pool root only, or shared with lead steward?
**Decision: pool root + designated lead steward.**
Two roles, both can revoke a SESSION_DELEGATION mid-window. Documented in pool's `cancellationGuardians: address[]` attribute. UI surfaces "Cancel round" button to anyone in that list.

### C5. Public dispute filing — anyone, or hub members only?
**Decision: hub members only at v1.**
Anyone can file a dispute against a public disbursement IF they're a member of the hub the pool operates in. Reduces drive-by dispute spam. The dispute filer must have a registered person agent in the hub. v2 considers a dispute-filing fee (slashable bond) for non-members.

### C6. Outcome attestation — single validator or multiple per disbursement?
**Decision: single validator default; multi-validator opt-in for disputed outcomes.**
For routine "delivered as described" attestations, 1 validator is enough. When `outcomeKind = 'disputed'`, the disbursement enters a 2-of-3 multi-validator review queue. Encoded by checking `outcomeKind` in the validator-delegation caveat stack.

### C7. Steward removal — graceful or immediate?
**Decision: immediate (already shipped via Hats-style `StewardEligibilityRegistry`).**
A removed steward's signatures are rejected on next redeem; in-flight `treasury_proposal` rows whose signer set no longer matches get auto-marked `expired`. Documented in `pool:rotate_stewards` tool docstring; UI shows clear "Steward removed — pending proposals expired" state.

### C8. v2 deferral list — what triggers re-surfacing?
**Decision: PM agent's list stands as-is** (Appendix A.2 of `output/product-plan-treasury.md`). Each item has a "re-surface trigger" (e.g., "ETH-native treasury reconsidered when Base mainnet pool exceeds $100K"). PM owns the trigger watch.

---

## D. From the on-chain attributes plan (assumptions for the still-running agent)

### D1. Privacy / IA P4 reconciliation — proposal bodies?
**Decision: Option C — bodies stay in MCP, on-chain registry is a coarse public mirror.**
SHACL `GrantProposalAlwaysPrivateShape` is non-negotiable. The `ProposalRegistry` stores only public facets: `kind`, `status`, `recipientAgentIRI` (when awarded), `totalAwarded`, `submittedAt`. The full body (budget, plan narrative, milestones, organisational background) stays in proposer's MCP and is read via cross-delegation by stewards. This means `ProposalRegistry` is for status + outcome tracking, not body storage.

### D2. Long descriptions — fully on-chain or IPFS pointer?
**Decision: IPFS hash (`bytes32`) referenced via attribute.**
For Pool / Round mandates' narrative descriptions (>200 chars), store an IPFS CID as `bytes32`; the attribute store carries the pointer, not the content. Short labels (`displayName`, `domain`) stay as `string`. Documented per-attribute in shape definitions (`sa:hasIPFSContent` predicate flag).

### D3. ONE shared OntologyAttributeStore vs per-domain stores?
**Decision: ONE shared store contract.**
Reasoning: simpler GraphDB sync (single contract to walk), simpler shape registry references, single deployment. Per-domain ACL is enforced via a `subjectAuthority(subject) → address` mapping inside the store; the authority for each subject is hard-set at first-write and only that authority can mutate.

### D4. Attribute mutability — full history or latest only?
**Decision: latest value only in storage; full history derivable from event logs.**
Each `setX(subject, predicate, value)` call emits `AttributeSet(subject, predicate, valueType, value, blockNumber)`. The contract storage holds only the latest. GraphDB sync's `emitAttributesTurtle` walks the latest values; an audit-trail SPARQL query walks the event log. Cheap on chain, complete history off chain.

### D5. Existing data migration — wipe or in-place backfill?
**Decision: wipe + re-seed via `fresh-start.sh`.** User has stated this throughout the build. Phase 0 ships the new contracts; existing demo state is wiped; seed scripts populate the new attribute store on next run. No legacy-data preservation.

### D6. Phase 0 sequencing — before or interleaved with Phase 2.7 / 3 / 4?
**Decision: Phase 0 (`OntologyAttributeStore` + `ShapeRegistry` + `AgentAccountResolver` migration) ships before Phase 3 critical path; `AgentNameResolver` migration + new domain registries (Pool / Fund / Proposal) interleave with Phase 3 cleanup.**
Sequencing graph:
```
Bucket 5 (sig collection)  ───────────────────┐
Bucket 1 (discretionary)   ───────────────────┤
Phase 0 (shared store + ShapeRegistry)        │
   │                                          │
   ├──→ Phase 0.1 (AAR migration)             │
   │                                          ▼
   ├──→ Phase 0.2 (ANR migration)         ┌── Bucket 2 (Phase 3 USDC custody)
   │                                      │   ┌── PoolRegistry / FundRegistry
   ├──→ Bucket 3 (Phase 3 cleanup) ───────┘   │   (uses shared store)
   │                                          │
   └──→ ProposalRegistry (Phase 4 prep)  ─────┘
                                              │
                                              ▼
                                          Bucket 4 (Phase 4)
```

Phase 0 adds ~3-4 weeks to the critical path but eliminates IA P4 violations and simplifies Phase 3+4 considerably.

### D7. Aggregate counters (`pledgedTotal`) on chain or MCP cache?
**Decision: MCP cache.** High-frequency mutation (every pledge); on-chain SSTORE per pledge is gas-prohibitive. The MCP-side `pools.pledgedTotal` stays as the running sum; events from `sa:PledgeAssertion` re-derive it for audit. UI reads from MCP for fast display; `availableTotal` widgets show "as of [timestamp]" disclosure.

### D8. ShapeRegistry validation — invoked at write or read time?
**Decision: write-time (in `OntologyAttributeStore.setX` flow).**
Each setter calls `shapeRegistry.validatePredicate(classId, predicate, value)` before storing. Read-time validation is too late (bad data already on chain). Cost: ~5-10k gas per write for shape lookup; acceptable.

---

## E. Cross-cutting decisions I'm making for the synthesis

### E1. Do we ship a single master roadmap doc or separate-but-linked plans?
**Decision: separate-but-linked.**
- `output/product-plan-treasury.md` (PM lens, shipped)
- `output/implementation-plan-treasury.md` (architect lens, shipped)
- `output/ux-plan-treasury.md` (UX lens, shipped)
- `output/onchain-attributes-implementation-plan.md` (in flight)
- `output/decisions-treasury.md` (this file — frozen decisions)
- `output/treasury-roadmap.md` (NEW; synthesized once attributes plan lands — sequenced backlog with cross-links into the four detail docs)

The roadmap is short (200-300 lines); details live in the four lens docs.

### E2. Definition of "Phase X complete"?
**Decision: every phase has the PM agent's definition-of-done checklist (Appendix A.1 in product-plan-treasury.md) PLUS:**
- All Foundry tests in scope pass
- All Playwright tests in scope pass
- IA P4 grep is clean (`grep -rn 'org-mcp.db' apps/web/src/lib/ontology/` empty for Phase 3 cleanup; analogous greps per phase)
- Demo script (per the PM doc) executes cleanly end-to-end as Maria + David

### E3. Security review gates?
**Decision: PM agent's gate sequence (Appendix B) is the standard.**
- Pre-implementation review for Buckets 2 + 4 (real money + reputation)
- Mid-implementation review when contracts compile but UI not wired
- External auditor scope spelled out for Bucket 2 contracts (`QuorumEnforcer`, `MultiSendCallOnly`, `IAccountGuard` + 3 reference guards)
- Pre-mainnet review before Phase 3 production deploy
- Pilot review (30 days) before broader rollout

### E4. Documentation outputs alongside code?
**Decision: each phase ships:**
- A `docs/runbooks/<phase-name>.md` runbook (operational steps to deploy / monitor / rollback)
- Updates to `docs/specs/intent-marketplace-capabilities.md` (the user-facing capability map)
- Updates to `output/onchain-treasury-plan.md` (the master plan, marking the phase as done)
