# Treasury + Foundational Refactor — Master Roadmap

> Navigational layer over four detail docs. Sequenced backlog with cross-links.
> Each phase has a single pull-request-sized scope and a verifiable exit gate.

## Lens documents

| Lens | File | What it answers |
|------|------|-----------------|
| Product | `output/product-plan-treasury.md` | What we ship, in what order, for which user, with what success criteria |
| Implementation | `output/onchain-treasury-plan.md` | Solidity surface, MCP tools, web actions, enforcer stack, EIP-712 typed-data, test gates |
| UX | `output/ux-plan-treasury.md` | Screens, copy, consent flows, sig collection UX, dispute UX, paymaster UX |
| On-chain attributes | (this doc § 0) | Foundational refactor: `OntologyAttributeStore` + `ShapeRegistry` + registry replacements for `ClassAssertion`-based mirror |
| Frozen decisions | `output/decisions-treasury.md` | All open questions answered; assumptions of record |
| Org data management | `docs/information-architecture/11-org-data-management.md` (TBD) | Where org-agent data lives by field; the storage split UI editors must respect |

## Cross-cutting alignment — org-data-management strategy

**This is non-negotiable across every phase below.** The user provided a canonical storage split for organization-agent data (memorized as `project_org_data_management.md`). Every phase that touches an org agent's profile, name records, trust signals, or private ops must respect:

- **Public identity** → `AgentAccountResolver` (which after Phase 0 is a thin shim over `OntologyAttributeStore`)
- **Public name records** → `AgentNameRegistry` + ontology-aware `AgentNameResolver` (after Phase 0.2)
- **Public trust signals** → `AgentRelationship` / `AgentAssertion` / `AgentValidationProfile` / `AgentReviewRecord` / `AgentDisputeRecord` (already deployed)
- **Private operations** → `org-mcp.db` only
- **GraphDB** → public mirror only; never an authoritative store
- **Web SQL** → auth + bootstrap + reference cache; **never** private org data

**UI consequence**: a single Edit-Org screen routes each field to the correct store under the hood. Three sections — Public Identity / Public Trust Signals / Private Operations — but one save action. The viewer screen reads public surface from GraphDB; private surface from MCP only when the viewer is an org admin (delegation-gated).

**Public-signal pattern**: when private facts should drive discovery, publish bounded signals (`sa:memberCountBand "25-50"`, `sa:hasPublicOffering "multiplier-coaching"`) — never raw rows. Bands and offerings are shape-validated public attributes through the same `OntologyAttributeStore`.

## Sequenced phases

The PM agent's sequencing recommendation (Bucket 5 → 1 → 3 → 2 → 4) is endorsed. Phase 0 (on-chain attributes) is **foundational** — it precedes every treasury phase below, because every later phase writes its public state through the new attribute store / registry pattern instead of legacy `ClassAssertion` mirrors.

### Phase 0 — On-chain attributes foundation (~7-8 weeks)

**Goal**: generalize `AgentAccountResolver`'s typed-predicate pattern into a reusable `OntologyAttributeStore`; add `ShapeRegistry`; migrate `AgentNameResolver`; add `PoolRegistry` / `FundRegistry` / `ProposalRegistry`. Replaces "MCP body + opportunistic ClassAssertion mirror" with "on-chain attributes are the public source of truth, MCP holds private body, GraphDB mirrors attributes directly."

| Sub-phase | Effort | Critical? | Detail |
|-----------|--------|-----------|--------|
| 0.0 Store + ShapeRegistry + AttributeAuth | M | ✓ | Deploy primitives; no migration. Heavy fuzz + slither here — every later phase rests on this storage layout. |
| 0.1 `AgentAccountResolver` migration | M | ✓ | Resolver becomes shim over store; external API unchanged. |
| 0.2 `AgentNameResolver` replacement | M | (parallel with 0.1) | Drop ENS-style text records for ontology-attribute setters; `setAddr` preserved. |
| 0.3 `PoolRegistry` | L | ✓ | Pool body on chain; `org-mcp.db pools` retired. Aggregate counters (`pledgedTotal`) **stay in MCP** as debounced cache. |
| 0.4 `FundRegistry` + Round migration | M | ✓ | Round body on chain; `org-mcp.db rounds` retired. |
| 0.5 `ProposalRegistry` (privacy-sensitive) | M | (parallel with 0.4) | Public **facets only** at award time. Body stays in MCP per `sa:GrantProposalAlwaysPrivateShape`. New shape `sa:GrantProposalPublicFacetShape` is a separate class, not a relaxation. |
| 0.6 graphdb-sync rewrite + legacy retirement | M | ✓ | `emitAttributesTurtle` walks store + diff-aware watermarks; drops `emitPoolsTurtle` / `emitRoundsTurtle` and the 9 retired class assertions. Subsumes the chunked-SPARQL cleanup that was on the treasury Phase 3 list. |

**Org-data-management deltas to apply during Phase 0** (additions to the on-chain attributes plan as written):

1. **`sa:companyType` enum**: add `sa:FaithNetwork` to the allowed set (currently `{Nonprofit, LLC, Church, Foundation, DAO}`). Sourced from the org-data doc's example (`Front Range House Churches`).
2. **Geo predicates** in agent-shape T-Box: `sa:city`, `sa:region`, `sa:country` as optional `string` properties. (Coexists with the geo namespace `sageo:*` for resource-bound geo claims.)
3. **Public-signal predicates**: register `sa:memberCountBand` (bytes32 enum), `sa:hasPublicOffering` (bytes32[]), `saskill:practicesSkill` (bytes32[]) — all optional, all on the Org-Agent shape.
4. **Name visibility**: `san:visibility` enum gains `public-coarse` (in addition to `public` / `private`) for geo-name records that publish region-level granularity without precise coordinates.

**Exit gate**: every demo seed runs through Phase 0 contracts; `grep -r "emitPoolsTurtle\|emitRoundsTurtle" apps/ → 0`; SHACL validators pass; `fresh-start.sh` is green end-to-end.

### Bucket 5 — Sig collection (Phase 2 prep) — first treasury phase (~2-3 weeks)

> Per PM § sequencing: ship sig collection BEFORE discretionary, because every multi-sig path below depends on it.

- EIP-712 typed-data registry under `apps/org-mcp/src/typedData/` with CI-enforced Foundry round-trip tests per payload type
- Safe-format packed signatures (sorted-ascending, 65-byte slot, v-byte type discrimination) — implementation per `output/onchain-treasury-plan.md` § 4
- `treasuryProposals` MCP table (sig collection cache; pure off-chain coordination)
- UX: sig-collection drawer with progress bar, threshold display, expiry countdown — see `output/ux-plan-treasury.md` § 6
- Gas: platform paymaster (Stackup or Pimlico) integrated; per-action paymaster decision documented

**Exit gate**: 2-of-3 happy-path test passes E2E; expired-sig path rejects; v-byte type discrimination accepts both ECDSA and ERC-1271 signers.

### Bucket 1 — Discretionary disbursement (Phase 2.7) (~3-4 weeks)

The small-amount fast path between "pool capacity exists" and "need fulfilled" — bypasses the formal round when overkill.

- New caveat: `DiscretionaryLimitEnforcer` — per-action cap **5% of pool capacity OR $1,000 USDC, whichever smaller**; per-steward daily cap **15% of pool capacity per day**
- **Bypasses the 72h dispute window** — that's the whole point; small fast disbursements
- New MCP tool: `pool:discretionary_disburse` — assembles userOp, collects sigs via Bucket 5 infra
- `sa:DiscretionaryDisbursementAssertion` (event-style; survives Phase 0 — disbursements stay event-style)
- Claim token: 256-bit opaque, expires 90 days, never the disbursement id
- Min tranche: $25 USDC (gas floor)
- UX: discretionary panel on pool detail page with "remaining-today" + "remaining-per-action" indicators

**Exit gate**: steward can fast-disburse to a recipient with 1-of-3 sig (≤$500) or 2-of-3 (>$500); cap enforcement blocks attempted breach; event mirrors to GraphDB.

### Bucket 3 — Phase 3 cleanup (~1-2 weeks)

Mostly subsumed by Phase 0.6 (graphdb-sync rewrite handles the chunked-SPARQL concern). Remaining work:

- Add `nonReentrant` to `AgentAccount.execute` — required before USDC custody
- `IAccountGuard` slot wired through `AgentAccount` — gates accept future global deny-list (Q15)
- AgentNameResolver migration cleanup: any callers still using legacy `text(node, key)` are migrated to typed attribute setters

**Exit gate**: reentrancy test (malicious recipient calls back into `AgentAccount.execute`) fails as expected; `IAccountGuard` plumbing passes a no-op guard test.

### Bucket 2 — Phase 3 USDC custody (~4-5 weeks)

- USDC stored as **subunits (bigint)** end-to-end; UI converts at display
- Pool's `AgentAccount` holds USDC directly (not a separate vault contract)
- Pledge: `USDC.transfer(poolAgent, amount)` — pure ERC-20, no registry mutation
- Disbursement userOp: STEWARDSHIP→SESSION redemption → `MultiSendCallOnly.multiSend([USDC.transfer(recipient, amount), ClassAssertion.emit(sa:DisbursementAssertion, ...)])`
- 72h dispute window via `TimestampEnforcer` + `RoundDecisionWindowEnforcer` — formal-round path only (discretionary skips)
- Cancellation guardian: pool root + designated lead steward (per PM C4 decision)
- First mainnet pilot: $5K USDC pool, 3 stewards 2-of-3, 30-day, ≤$500/disbursement

**Exit gate**: pilot pool can pledge → close round → disburse with dispute window observed; testnet fork test validates full flow; gas costs documented per phase of the userOp lifecycle.

### Bucket 4 — Phase 4 outcomes (~3-4 weeks)

- `OutcomeAttestationAssertion` (stays event-style per Phase 0 § 6 triage)
- Validator agent eligibility shape-checked at sync time: `sa:ValidatorShape` requires `atl:agentType = atl:AIAgent` AND `atl:aiAgentClass = atl:ValidatorAgent`
- Single validator default; multi-validator required when status `disputed`
- Public dispute filing: hub members only at v1 (PM C5)
- Outcome cardinality: one attestation per disbursement default; many for disputed
- UX: outcome timeline on pool detail; validator badge with shape-check indicator

**Exit gate**: a disbursement with a validator-emitted `OutcomeAttestationAssertion` shows the attestation in the UI; an attestation by an agent that fails `sa:ValidatorShape` is dropped from public mirror with a warn log.

## What we deferred to v2 (per PM C8)

- Pool-pays-its-own-gas (paymaster funded from pool USDC)
- Email notifications (in-app inbox first)
- Cross-hub pool visibility
- Connector-style pledging (steward pledging on someone else's behalf)
- Chunked SPARQL UPDATE in graphdb-sync — superseded by diff-aware sync in Phase 0.6
- Encrypted on-chain attributes — privacy stays via MCP-for-private-bodies pattern

## Definition of Done — per phase

1. Foundry tests pass (`pnpm --filter @smart-agent/contracts test`)
2. TypeScript strict (`pnpm typecheck`) and lint (`pnpm lint`) green
3. Playwright E2E for the user-facing path (`pnpm test:e2e`)
4. SHACL validators pass for any new ontology terms
5. `fresh-start.sh` runs end-to-end without manual intervention
6. UX-plan screens implemented and reviewed against light corporate palette
7. Runbook entry in `docs/runbooks/` for any new operational concern (paymaster funding, dispute response, validator onboarding)
8. Decision-doc updates if any decision was overturned during implementation

## Security gates

Per `output/decisions-treasury.md` § E3:

- Slither + foundry coverage on every contract change
- Mainnet pilot only after testnet-fork test of the full pledge → disburse → dispute → outcome cycle
- Sig collection cache (`treasuryProposals`) auto-expires entries after 14 days (no orphan sigs)
- Paymaster spending policy: per-org daily cap; reviewed monthly

## Risk callouts

- **Phase 0 is gating risk**. A storage-layout flaw in `OntologyAttributeStore` propagates to every later phase. Recommend extra fuzz tests + a shadow-deploy on testnet for two weeks before any production seed.
- **Privacy regression on Phase 0.5**. The temptation will be to put proposal-budget fields on chain "because it's simpler." `sa:GrantProposalAlwaysPrivateShape` is the backstop; CI runs `scripts/validate-grant-proposal-shacl.ts` on every PR.
- **Aggregate-counter drift**. `pools.pledgedTotal` in MCP and the on-chain `sa:PoolPledgedTotalAssertion` event-style anchor must be reconciled by a periodic job. If drift exceeds 1% raise an alert.
- **Sig-collection cache poisoning**. The off-chain cache must verify each sig against the canonical EIP-712 hash before storing — never accept a sig blob without verification, even from the cache origin.

## Estimated total effort

| Bucket | Effort |
|--------|--------|
| Phase 0 (foundation) | 7-8 weeks |
| Bucket 5 (sig collection) | 2-3 weeks |
| Bucket 1 (discretionary) | 3-4 weeks |
| Bucket 3 (Phase 3 cleanup) | 1-2 weeks |
| Bucket 2 (Phase 3 USDC custody) | 4-5 weeks |
| Bucket 4 (Phase 4 outcomes) | 3-4 weeks |
| **Total** | **~21-26 weeks** with serial execution; ~14-18 weeks if 0.1/0.2 and 0.4/0.5 run in parallel |

## What this roadmap does NOT cover

- Geo + .pg + namespace initiative (separate multi-week build per `project_geo_initiative` memory)
- Data-store consolidation (separate IA initiative per `project_data_store_consolidation` memory; Phase 0.3-0.5 of this roadmap *is* a chunk of that consolidation)
- AnonCred kind additions (one-off pattern; not roadmap-level)
- Ontology audit follow-ups outside the 17 anchor classes triaged in Phase 0
