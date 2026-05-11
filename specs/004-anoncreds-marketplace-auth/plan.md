# 004 — AnonCreds-Gated Marketplace Authorization

## Goal

Replace principal-based authorization for **proposal submit/edit/withdraw**
and **vote-cast** flows with **AnonCreds presentations**. The submitting
member and the voting member are anonymized; only the org-mcp gateway
sees the presentation. The public can read counts and anonymized bodies
through the MCP but cannot link a proposal or a ballot to a holder.

Out of scope: pool/round body authorization (still owner-of-fund / steward-
of-pool gated). The on-chain registries don't change. The change is purely
at the **off-chain MCP authorization layer**.

## Architecture

```
┌────────────┐    1. issue cred        ┌──────────────┐
│   Round    │ ─────────────────────▶  │   Member's   │
│  Steward   │  (RoundVoter/Submitter) │ Holder Wallet│
└────────────┘                         └──────────────┘
                                              │
                                              │ 2. present (anon proof)
                                              ▼
┌──────────────────┐    3. verify    ┌────────────────┐
│   Public UI      │ ─────────────▶  │    org-mcp     │ ── store nullifier_hash
│  (vote/submit)   │                 │  + verifier    │    + body / ballot
└──────────────────┘                 └────────────────┘
```

**No principal stored** for vote rows or proposal rows going forward —
only the nullifier hash (deterministic from credId + context, one-way).

## Credential Schemas

Both schemas are issued + verified via the existing verifier-mcp + holder
wallet infrastructure (`wallet.provision`, `credentials.accept`,
`credentials.present`).

### `sa:ProposalSubmitterCredential.v1`

Issued by a pool steward (or hub admin) to members eligible to submit
proposals to rounds operated by that pool.

| Attr | Type | Meaning |
|---|---|---|
| `poolAgentId` | string (hex address) | Which pool the credential is scoped to |
| `holderPseudoId` | string (random uuid, set by issuer) | Pseudonym; ties back to issuer's roster but not to wallet identity |
| `issuedAt` | iso timestamp | |
| `expiresAt` | iso timestamp | Optional; if absent, valid until revoked |

### `sa:RoundVoterCredential.v1`

Issued by a round operator (fund steward) to members eligible to vote
on a specific round.

| Attr | Type | Meaning |
|---|---|---|
| `roundId` | string (urn:smart-agent:round:...) | Which round the credential is scoped to |
| `holderPseudoId` | string (random uuid) | |
| `issuedAt` | iso timestamp | |
| `expiresAt` | iso timestamp | Optional |

## Nullifier Algorithm

A **nullifier_hash** is a deterministic, one-way commitment that
prevents replay/double-action while preserving holder anonymity.

```
nullifier_hash = HMAC-SHA256(
  key   = credentialId,
  data  = context
)
where context = {
  for vote-cast:                     `vote:${roundId}`
  for proposal-submit (new):         `submit:${roundId}` -- 1 proposal per round per holder
  for proposal-edit/withdraw:        `edit:${proposalId}` -- holder re-proves possession
}
```

Why three distinct contexts:
- `vote:${roundId}` — same credential cannot vote twice on the same round
- `submit:${roundId}` — same credential cannot submit twice to the same round (per round design)
- `edit:${proposalId}` — only the original submitter can edit / withdraw a specific proposal

The credential ID is private to the holder wallet; the org-mcp only sees
the resulting hash. There is no way to enumerate which credentials produced
which nullifiers without holding all credentials (which the issuer does
not — they only retain the holderPseudoId on the roster).

## MCP Tool Surface Changes

### Replacements

| Existing | Replacement | Behavior |
|---|---|---|
| `grant_proposal:submit` | REQUIRES `presentation` field | Gate by `verify_presentation(submitterCred, poolAgentId)`; store `nullifier_hash` from `proposal:${roundId}` context. No principal-gated fallback. |
| `grant_proposal:edit_pre_deadline` | REQUIRES `presentation` | Gate by nullifier matching the stored nullifier on the row (same `proposal:${roundId}` context). |
| `grant_proposal:withdraw` | REQUIRES `presentation` | Same. |
| `vote:cast` | REQUIRES `presentation` | Gate by `verify_presentation(voterCred, roundId)`; store `nullifier_hash` from `vote:${roundId}`. No principal-gated fallback. |

NOTE: the in-flight implementation from earlier in this session DOES carry
a dual-path (presentation-or-principal) shape. That was a transitional
artifact; per the no-fallback decision, those branches will be deleted as
part of the cleanup queue below.

### New tools

| Tool | Where | Purpose |
|---|---|---|
| `proposal_submitter_cred:issue` | org-mcp | Pool steward issues a SubmitterCredential to a holder (offer flow) |
| `proposal_submitter_cred:revoke` | org-mcp | Revoke (publishes nullifier into a revocation set) |
| `round_voter_cred:issue` | org-mcp | Round operator issues a VoterCredential |
| `round_voter_cred:revoke` | org-mcp | |

### Where verification lives

Stateless `verifyPresentation(blob, schemaId, expectedAttrs)` is an **inline
helper in org-mcp** (not a separate verifier-mcp call). Rationale:

- Each action call already carries the full presentation blob — no
  multi-round-trip wallet/verifier dance needed.
- Avoids an inter-service HMAC hop on every proposal submit / vote cast.
- The verification result (nullifier + attribute values) is consumed
  immediately by the same action's storage path — co-locating them in
  one process keeps the trust boundary tight.
- verifier-mcp's existing role (wallet-facing credential offer/exchange
  and present ceremonies, which ARE stateful and multi-message) is
  unchanged. It remains the "interactive verifier"; org-mcp is the
  "stateless presentation consumer".

The inline helper lives at `apps/org-mcp/src/auth/verify-presentation.ts`,
takes `{ presentation, schemaId, requiredAttrs }`, and returns
`{ ok: true, nullifierContext, attributes } | { ok: false, error }`.
Issuance helpers live alongside in `apps/org-mcp/src/auth/issue-credential.ts`.

## DB Schema Changes

### `proposal_submissions`

```sql
ALTER TABLE proposal_submissions
  ADD COLUMN nullifier_hash TEXT;       -- one nullifier per (cred, round)
ALTER TABLE proposal_submissions
  ADD COLUMN credential_kind TEXT;      -- 'principal' (legacy) | 'proposal_submitter'
CREATE INDEX IF NOT EXISTS idx_proposal_submissions_nullifier
  ON proposal_submissions(nullifier_hash);
```

Legacy rows keep `principal` populated and `nullifier_hash = NULL`. New rows
have `principal = NULL` and `nullifier_hash` set.

### `proposal_votes`

```sql
ALTER TABLE proposal_votes
  ADD COLUMN nullifier_hash TEXT;
ALTER TABLE proposal_votes
  ADD COLUMN credential_kind TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_proposal_votes_nullifier_round
  ON proposal_votes(round_id, nullifier_hash) WHERE nullifier_hash IS NOT NULL;
```

The unique index enforces "one ballot per nullifier per round" at the DB
level — prevents replay even if the MCP tool's verification is bypassed.

### `proposal_submissions` per-round duplicate check

```sql
CREATE UNIQUE INDEX IF NOT EXISTS uq_proposal_submissions_nullifier_round
  ON proposal_submissions(round_id, nullifier_hash) WHERE nullifier_hash IS NOT NULL;
```

## UI Surfaces

### Apply form (`/h/[hub]/rounds/[roundId]/apply`)

- New step before existing form: **"Present your submitter credential"**
- Lists the user's holder-wallet credentials matching `sa:ProposalSubmitterCredential.v1` where `poolAgentId == round.poolAgentId`.
- If none: "You need a submitter credential for this pool. Ask the pool steward to issue one."
- On select, builds a presentation, attaches to the submit POST.

### Vote button (`/h/[hub]/rounds/[roundId]/proposals` and individual proposal pages)

- Renders only when the user has a matching VoterCredential for the round.
- Click triggers presentation + signed ballot.

### Issuer surface (new): `/h/[hub]/rounds/[roundId]/voters` and `/h/[hub]/pools/[poolId]/submitters`

- Steward sees a roster of issued credentials.
- "Issue voting credential" / "Issue submitter credential" → triggers cred offer flow.

## Migration

- Legacy proposals/votes (rows with `principal` set) remain valid; their UI displays "(legacy member)".
- New rows display "Anonymized member" with no link.
- No automatic conversion. The two cohorts coexist.

## Open Questions

1. **Revocation immediacy** — when a credential is revoked, do already-submitted proposals get withdrawn? **Recommendation: NO** — past actions are immutable; revocation only blocks future actions.
2. **Pool steward-issued vs hub admin-issued submitter creds** — who's the authoritative issuer for the `ProposalSubmitterCredential`? **Recommendation: pool steward** (since the cred is poolAgentId-scoped).
3. **Multiple credentials per holder per round** — can a member hold 2 voter creds for the same round (e.g., dual roles)? **Recommendation: NO** — the issuer's roster enforces uniqueness; the nullifier prevents double-counting even if duplicates leak.
4. ~~**Demo-mode fallback**~~ **Decided: NO fallback.** Demo users (Maria / David / Sarah / Pastor David / etc.) are architecturally identical to production users — same passkey signup path, same smart account, same holder wallet. They should receive `ProposalSubmitterCredential` and `RoundVoterCredential` at boot-seed time the same way they currently receive `OrgMembershipCredential`. There is ONE auth path: AnonCreds presentation. The `principal`-gated fallback branches in the wrapped action tools (added earlier in this spec, before this decision) need to be REMOVED — see "Cleanup queue" below.

## Cleanup queue (consequences of the no-fallback decision)

| File | Change |
|---|---|
| `apps/org-mcp/src/tools/proposalVotes.ts` | Drop the legacy principal-gated branch in `vote:cast`. `presentation` becomes a required field, not optional. Remove `voterAgentId` from the args; the column on the row stays empty. |
| `apps/org-mcp/src/tools/grantProposals.ts` | Drop legacy branches in `:submit/:edit_pre_deadline/:withdraw`. `presentation` required. `principal` no longer stored. |
| `apps/org-mcp/src/db/schema.ts` + `db/index.ts` | Once R7 (org-mcp tool refactor onto registries) lands, drop `principal` column from `proposal_submissions` and `voter_agent_id` from `proposal_votes` — the tables themselves are slated for deletion (R9) so this becomes moot. |
| `apps/web/src/lib/demo-seed/seed-catalyst-onchain.ts` (and `cil`/`global-church` siblings) | Add an issuance pass: after deploying each pool, call `proposal_submitter_cred:issue` for every demo member of that pool. After opening each round, call `round_voter_cred:issue` for stewards. |
| `tool-policies.ts` | Add the issuance tools to the delegation scope. |

## Architectural pivot (mid-spec)

Per the in-conversation decision to push **as much marketplace state as
possible on chain and out of SQL**, this spec was extended with four new
on-chain registries that take authoritative ownership of vote, proposal,
pledge, and match-initiation rows. SQL tables for these objects can then
be dropped; reads flow through GraphDB (mirror) or directly from the
on-chain registry. The AnonCreds-nullifier story stays intact — rows are
nullifier-keyed, never identity-keyed.

| Registry | Purpose | Subject id |
|---|---|---|
| `VoteRegistry` | Authoritative ballots; nullifier-keyed; replay-protected | `keccak256("sa:vote:" + roundSubject + nullifier)` |
| `GrantProposalRegistry` | Full proposal bodies + lifecycle (submit/edit/withdraw); nullifier-keyed | `keccak256("sa:grantProposal:" + roundSubject + nullifier)` |
| `PledgeRegistry` | Pool pledges; nullifier-keyed; story-permissions JSON enforced by GraphDB emit layer, not by hiding the row | `keccak256("sa:pledge:" + poolAgent + nullifier + salt)` |
| `MatchInitiationRegistry` | Direct-lane match initiations; initiator-nullifier-keyed | `keccak256("sa:matchInitiation:" + viewedIntent + candidateIntent + initiatorNullifier)` |

**Publisher model**: the round's fund-owner / pool's owner AgentAccount is
the on-chain writer (in practice, org-mcp signs via session delegation).
org-mcp verifies the AnonCreds presentation off-chain BEFORE the on-chain
write; the chain trusts the gateway as publisher. This matches the
verifier-location decision (verifier-mcp owns interactive wallet
ceremonies; org-mcp owns stateless action-time verification AND on-chain
publishing).

**SQL drops queued** (after the per-registry org-mcp tool refactor):
- `proposal_submissions` — replaced by GrantProposalRegistry
- `proposal_votes` — replaced by VoteRegistry
- `rounds` (voting config) — fold into FundRegistry extension (windowStart/windowEnd/threshold/strategy)
- `pool_pledges` — replaced by PledgeRegistry
- `match_initiations` — replaced by MatchInitiationRegistry

Tables that stay in SQL (genuinely off-chain concerns):
- `org_token_usage` — JTI replay tracking for the delegation token layer
- `org_profiles_private`, `detached_members` — private membership/profile data
- AnonCreds wallet-side state in person-mcp (holder wallets, credential metadata)

## Implementation Order + Status

| # | Step | Status | Notes |
|---|---|---|---|
| 1 | Schema migrations (`proposal_submissions`, `proposal_votes`) | ✅ **Landed** | `nullifier_hash` + `credential_kind` columns added in `apps/org-mcp/src/db/index.ts` w/ `IF NOT EXISTS` ALTERs + unique `(round_id, nullifier_hash)` indexes. Drizzle schema updated in `apps/org-mcp/src/db/schema.ts`. |
| 2 | Shared nullifier helper | ✅ **Landed** | `packages/sdk/src/anoncreds/nullifier.ts` exports `computeNullifier`, `voteContext`, `submitContext`, `editContext`. Uses `keccak256(credId \| ':' \| context)` — separator prevents boundary ambiguity. |
| 3 | Inline `verifyPresentation` helper in org-mcp | ✅ **Landed** | `apps/org-mcp/src/auth/verify-presentation.ts` + `auth/on-chain-resolver.ts`. Calls `AnonCreds.verifierVerifyPresentation` directly, extracts revealed attrs, enforces `expectedAttributes`, derives nullifier from `holderPseudoId` + context. |
| 4 | Credential schemas in shared registry | ✅ **Landed (descriptors)** | Added `ProposalSubmitterCredential` + `RoundVoterCredential` to `packages/sdk/src/credential-types.ts`. Issuer endpoints (`/credential/offer` + `/credential/issue`) still need org-mcp routes — queued. |
| 5 | Wrap `vote:cast` | ✅ **Landed** | `apps/org-mcp/src/tools/proposalVotes.ts` now accepts an optional `presentation` field. When present: verify, store `nullifier_hash` + `credential_kind='round_voter'`, leave `voter_agent_id` empty, return `{ anonymous: true }`. Replay rejected via unique `(round_id, nullifier_hash)` index. When absent: existing principal-gated path unchanged. |
| 6 | Wrap `grant_proposal:submit/:edit_pre_deadline/:withdraw` | ✅ **Landed** | All three accept optional `presentation` field. Single `proposal:${roundId}` nullifier context spans the full lifecycle (submit + edit + withdraw + clone) — the original submitter re-proves the same credential to mutate; the verifier matches the freshly-derived nullifier against the stored `nullifier_hash`. Anonymous rows have `principal=''`; legacy rows continue to gate on `principal===orgPrincipal`. Edit/withdraw UPDATE keys on proposal id alone (auth already checked above) so anonymous rows don't get shadowed by the legacy `eq(principal, ...)` clause. |
| 7 | Issuance MCP tools (`proposal_submitter_cred:issue/:revoke`, `round_voter_cred:issue/:revoke`) | ⏳ Queued | Need to hook into the existing org-mcp credential issuance machinery (the `IssuerAgent` from `@smart-agent/privacy-creds` already used for `OrgMembershipCredential`). Pool steward gate for submitter cred; round operator gate for voter cred. |
| **R1** | **On-chain `VoteRegistry`** | ✅ **Landed** | `packages/contracts/src/VoteRegistry.sol`. Nullifier-keyed subject. `castVote` UPSERTs (re-cast same credential = vote-change). Auth: round's fund-owner via `_isAccountOwner`. Compiles. |
| **R2** | **On-chain `GrantProposalRegistry`** | ✅ **Landed** | `packages/contracts/src/GrantProposalRegistry.sol`. Submit / edit / withdraw / setStatus, all nullifier-gated. Body fields as JSON strings (same pattern as FundRegistry round body). Compiles. Named `GrantProposalRegistry` to avoid colliding with the existing `ProposalRegistry` (the public-facet-after-award contract — separate concern). |
| **R3** | **On-chain `PledgeRegistry`** | ✅ **Landed** | `packages/contracts/src/PledgeRegistry.sol`. submit / amend / stop. Pool-owner gated. Salt in subject lets same credential pledge multiple times to the same pool. Compiles. |
| **R4** | **On-chain `MatchInitiationRegistry`** | ✅ **Landed** | `packages/contracts/src/MatchInitiationRegistry.sol`. create / setStatus. Initiator-nullifier-keyed. Publisher (org-mcp AgentAccount) gates the write. Compiles. |
| R5 | Deploy script updates | ✅ **Landed** | `Deploy.s.sol` instantiates the 4 registries (passing ontologyRegistry + shapeRegistry + fundRegistry where needed), `_logEnv`s their addresses. `scripts/deploy-local.sh` extracts and propagates: `VOTE_REGISTRY_ADDRESS`, `GRANT_PROPOSAL_REGISTRY_ADDRESS`, `PLEDGE_REGISTRY_ADDRESS`, `MATCH_INITIATION_REGISTRY_ADDRESS` to web + a2a-agent + all MCP envs. Ready for the next `fresh-start.sh` run. |
| R6 | SDK ABI exports + onchain client classes | ✅ **Landed** | All 4 ABIs spliced into `packages/sdk/src/abi.ts` (`voteRegistryAbi`, `grantProposalRegistryAbi`, `pledgeRegistryAbi`, `matchInitiationRegistryAbi`). Client classes in `packages/sdk/src/onchain/marketplace/index.ts` — `VoteRegistryClient`, `GrantProposalRegistryClient`, `PledgeRegistryClient`, `MatchInitiationRegistryClient`, each with `encodeXxx()` static methods that org-mcp uses to build calldata for the a2a-agent redeem path. Re-exported from `@smart-agent/sdk`. |
| R7 | org-mcp tool refactor: read/write through registries instead of SQL | ✅ **Landed (4/4 tool families)** | All four tool families now write to chain via `callA2aRedeem`, with SQL writes dropped: **vote:cast** (presentation-gated, returns `{ok,txHash,nullifier,anonymous:true}`), **grant_proposal:submit/:edit_pre_deadline/:withdraw** (presentation-gated, single `proposal:${roundSubject}` nullifier context), **pool_pledge:submit/:amend/:stop/:auto_stop** (donor pseudonym nullifier from authenticated principal — pledges are not cred-gated per spec scope), **match_initiation:create/:supersede/:consume** (initiator pseudonym nullifier; `setStatus` encoder added to SDK). Read-side tools temporarily return empty arrays / SQL until R8 (GraphDB sync) ships. SDK `PledgeRegistryClient` gained `encodeAmend` + `pledgeSubject` deterministic-subject helper; `MatchInitiationRegistryClient` gained `encodeSetStatus`. |
| R7a | **Auth-model (b2): chained admin→voter→session redeem** | ✅ **Smoke-tested against Anvil — voter casts on chain end-to-end** | **Path chosen: b2** — admin pre-signs a long-lived `admin → holder` delegation at credential issuance; the web action layer freshly mints a short-lived `holder → session` leaf with `authority = hash(admin → holder)` at action time; redeem chain = `[leaf, root]` (DelegationManager-native order; leaf at index 0 must delegate to the session key). DelegationManager dispatches root-down, ending at `admin.execute(target, ...)`, so msg.sender at the registry = admin's AgentAccount (= pool/fund AgentAccount) and `_isAccountOwner(fund/pool, admin)` passes via self-ownership. <br/><br/>**Smoke test (Anvil)**:<br/>• Voter (Rosa) casts a ballot → tx mined; on-chain ballot = `keccak256("sa:Approve")` at `voteSubject(roundSubject, nullifier)`.<br/>• Recasting from the same voter returns the same nullifier `0x4c56…801f` and updates the ballot to `keccak256("sa:Reject")`.<br/>• Non-credentialed user (Luis) is rejected client-side with `no held credential of type RoundVoterCredential` — never reaches the chain.<br/><br/>**Demo seed key choices**: pool/round AgentAccounts in the catalyst seed are deployed with the deployer EOA as their AgentAccount owner. The `admin → holder` delegation therefore has `delegator = poolAgent` (or `fundAgent`) and is signed by the deployer EOA (the smart account's ERC-1271 path validates the deployer is a registered owner). The CLI wrapper passes `adminSigningKey: DEPLOYER_PRIVATE_KEY` + `adminAccountOverride: <poolAgent or fundAgent>` for this reason. <br/><br/>**Landed**:<br/>• `POST /session/:id/redeem-with-chain` in `apps/a2a-agent/src/routes/onchain-redeem.ts` (chain validated leaf-delegate == session key + target/selector policy).<br/>• `callA2aRedeemWithChain()` helper in `apps/org-mcp/src/lib/a2a-client.ts`.<br/>• All four marketplace tool families now require `chain: SignedDelegation[]`: `vote:cast`, `grant_proposal:submit/:edit_pre_deadline/:withdraw`, `pool_pledge:submit/:amend/:stop/:auto_stop`. MatchInitiation stays on `redeem-tx` (self-ownership of the publisher covers it).<br/>• SDK helpers in `packages/sdk/src/onchain/marketplace/admin-delegation.ts`: `SPEC004_SELECTORS`, `buildAdminDelegationCaveats()`, `signRootDelegation()`, `signChildDelegation()`, `delegationHash()`.<br/>• Issuance MCP tools `proposal_submitter_cred:issue/:revoke` + `round_voter_cred:issue/:revoke` (return the delegation-params snapshot for the admin to sign).<br/>• Person-mcp credential_metadata extended with `admin_delegation_json` + `admin_delegation_target` columns; new tool `ssi_get_marketplace_delegation` looks up the delegation by target registry.<br/>• Web action-layer helpers `apps/web/src/lib/spec004/chain.ts` (`resolveSpec004Chain()`) + `presentation.ts` (`buildMarketplacePresentation()`).<br/>• `castVote()`, `submitProposal()`, `submitPledge()` action functions wired: build presentation, resolve chain, pass both to org-mcp.<br/>• Demo seed: `apps/web/src/lib/demo-seed/seed-spec004-credentials.ts` issues both credential kinds + mints admin→holder delegation server-side using the admin's stored EOA private key. CLI wrapper: `scripts/seed-spec004-creds.ts`.<br/>• Playwright spec: `tests/e2e/spec004-anoncreds-flow.spec.ts` (vote happy path, nullifier idempotence, no-credential rejection, tally anonymity).<br/><br/>**Real-user (passkey/OAuth) follow-up**: `resolveSpec004Chain` currently errors `no-eoa-signer` for users without a stored privateKey. Wiring the passkey-leaf-mint ceremony (browser signs the leaf hash via WebAuthn, server assembles the chain) is queued. See TODO at bottom of `apps/web/src/lib/spec004/chain.ts`.<br/><br/>**Withdraw + edit + clone**: `withdrawMemberProposal` / edit / clone in `apps/web/src/lib/actions/grantProposals.action.ts` still take the legacy `proposalId` arg and would need to switch to `roundId + presentation + chain` to match the refactored MCP tools. Tracked as a follow-up. |
| R7b | **Credential issuance endpoints** | ✅ **Landed** | `apps/org-mcp/src/issuers/marketplaceCreds.ts` registers ProposalSubmitter + RoundVoter schemas/credDefs against the existing `catalystIssuer`. `/credential/offer` and `/credential/issue` now dispatch by `credentialType` (back-compat: omitted type defaults to OrgMembership). `ensureMarketplaceCredsRegistered()` runs at org-mcp startup. The two new kinds are usable from the same client functions as OrgMembership — `org.offer({credentialType: 'ProposalSubmitterCredential'})` → `org.issue({credentialOfferJson, credentialRequestJson, attributes})`. Demo seed still needs an issuance pass for at least one ProposalSubmitter + one RoundVoter holder per round to enable the Playwright spec. |
| R8 | GraphDB sync for new registries | ⏳ Queued | Mirror `Vote`, `GrantProposal`, `Pledge`, `MatchInitiation` subjects to the data graph. Follow the same attribute-walk pattern `apps/web/src/lib/ontology/graphdb-sync.ts` uses for FundRegistry + PoolRegistry: enumerate subjects via each registry's predicate-hash table, emit Turtle, write through to GraphDB. Story-permissions enforcement on pledge emit (strip donor reveal when `showName=false`). Until this lands, public proposal-list / vote-tally / pledge-list pages render empty after the SQL drops — readers must continue to hit org-mcp directly for now. |
| R11 | On-chain ontology + shape for spec-004 registries | ✅ **Backfilled via `scripts/seed-spec004-ontology.ts`** | The four new registries need their predicates registered as active in `OntologyTermRegistry` and their classes shaped in `ShapeRegistry` (the original `Deploy.s.sol` only seeds Pool / Fund / Proposal). The seed script registers 44 predicates covering Vote/GrantProposal/Pledge/MatchInitiation + defines a no-op shape for each class. Idempotent (term-exists / shape-exists checks). **Follow-up**: roll these registrations into `Deploy.s.sol` so a clean fresh-start needs no extra step (queued). |
| R12 | Selectors per chain action | ✅ **Landed** | `apps/web/src/lib/spec004/chain.ts` now requires `methodSelectors` on `resolveSpec004Chain` — action callers pass the specific selector (`SPEC004_SELECTORS.voteCast`, `.grantProposalSubmit`, etc.) for the action being taken. The leaf's `AllowedMethodsEnforcer` rejects empty lists, so previously the redeem was reverting with `MethodNotAllowed()` before this fix. |
| R13 | Tool policies for chain-redeem path | ✅ **Landed** | `packages/sdk/src/policy/tool-policies.ts`: `vote:cast`, `grant_proposal:submit/edit_pre_deadline/withdraw`, `pool_pledge:submit/amend/stop/auto_stop`, `match_initiation:create/supersede/consume` upgraded from `mcpOnly` → `statelessRedeem` with new registry-target enum values (`VoteRegistry`, `GrantProposalRegistry`, `PledgeRegistry`, `MatchInitiationRegistry`); env-var resolver added for each. |
| R14 | deploy-local.sh env propagation | ✅ **Landed** | Script now extracts `VOTE_REGISTRY_ADDRESS`, `GRANT_PROPOSAL_REGISTRY_ADDRESS`, `PLEDGE_REGISTRY_ADDRESS`, `MATCH_INITIATION_REGISTRY_ADDRESS` from the Deploy.s.sol output and writes them to all three env files (web, a2a-agent, org-mcp). Earlier fresh-start runs left the spec-004 addresses missing from `apps/web/.env`. |
| R15 | Admin-delegation persistence | 🟡 **Working via SQL backfill in seed; HTTP path needs follow-up** | `apps/web/src/lib/demo-seed/seed-spec004-credentials.ts` saves the signed `admin → holder` delegation to `person-mcp/person-mcp.db credential_metadata.admin_delegation_json`. The HTTP path through `ssi_finish_credential_exchange` accepts the field and forwards to `/credentials/store`, but a regression in the forward layer (under investigation) drops the field before storage. The seed includes a direct-SQL backfill as a workaround. Production needs the HTTP path debugged + a passkey ceremony for the OAuth user flow (no stored privateKey). |
| R16 | **v2 anonymity model + per-proposal vote uniqueness** | ✅ **Landed + smoke-tested** | <br/>**Vote uniqueness** — `VoteRegistry._voteSubject(roundSubject, proposalSubject, nullifier)` now keys on all three. One voter can vote on many proposals per round; recasting on the same proposal UPSERTs the row. Two distinct on-chain vote subjects confirmed on Anvil after voting on proposals A and B with the same nullifier `0xe56e…77a5`.<br/><br/>**Anonymity v2** — Dropped the stable `holderPseudoId` (cross-context pseudonym). RoundVoterCredential.attributeNames is now `['roundSubject', 'nullifierSecret', 'issuedYear']`; ProposalSubmitterCredential is `['poolAgentId', 'nullifierSecret', 'issuedYear']`. Schema/credDef versions bumped to 2.0. The issuer generates a fresh 256-bit `nullifierSecret` per issuance (`randomBytes(32)`); nullifier = `keccak256(nullifierSecret ‖ context)` where context = `vote:<roundSubject>` / `proposal:<roundSubject>`. Per-cred secret rotation eliminates cross-round / cross-pool linkability. **Within-round linkability persists** because nullifierSecret is revealed inside the round so the verifier can compute the nullifier — full hidden-secret ZK derivation (Semaphore/MACI-style) stays as the v3 target.<br/><br/>**Cred ↔ round binding** — `vote:cast` now passes `expectedAttributes: { roundSubject: args.roundSubject }` to `verifyPresentation` (was `{}`, which was a high-severity gap caught in review — any RoundVoterCredential could satisfy any round's vote). Verified working: a Round-A cred voting on Round B now returns `attribute mismatch: roundSubject expected "<B>" but got "<A>"`. <br/><br/>**Action-layer error propagation** — `castVote` now distinguishes `{ ok: true, txHash, nullifier }` from `{ ok: false, error }` returned by org-mcp instead of dropping the error and emitting `{ ok: true, anonymous: true }` with no txHash. |
| R9 | SQL table drops | ⏳ Queued | Remove `proposal_submissions`, `proposal_votes`, `rounds`, `pool_pledges`, `match_initiations` from org-mcp once readers/writers are migrated. |
| R10 | FundRegistry extension for voting config | ⏳ Queued | Add `votingStrategy`, `votingThreshold`, `votingWindowStartsAt`, `votingWindowEndsAt` as round attributes so the off-chain `rounds` SQL table can be dropped. |
| 8 | UI: present-credential picker on apply form | ⏳ Queued | New step before form; lists holder-wallet credentials matching `ProposalSubmitterCredential` where `poolAgentId == round.poolAgentId`. |
| 9 | UI: vote button uses VoterCred | ⏳ Queued | Replace existing steward-only button with cred-presence check + present-then-cast. |
| 10 | UI: issuer roster pages | ⏳ Queued | `/h/[hub]/rounds/[roundId]/voters` + `/h/[hub]/pools/[poolId]/submitters`. |
| 11 | Public read endpoints | ⏳ Queued | New MCP tools for anonymized proposal lists + tally counts. Most existing endpoints are already anonymized-enough; audit and wrap. |
| 12 | E2E + replay/anonymity tests | ⏳ Queued | Playwright spec exercising both legacy + AnonCreds paths; double-vote/double-submit reject tests. |

## Design change recorded mid-push

The original spec had three nullifier contexts (`vote:`, `submit:`, `edit:`).
That introduced a correctness bug: the `edit:${proposalId}` nullifier
can't match the `submit:${roundId}` nullifier stored on the row, so
edit/withdraw couldn't recognize the original submitter's credential.

**Fixed**: collapsed to two contexts:
- `vote:${roundId}` — voting (UPDATE on existing ballot row when same holder re-votes)
- `proposal:${roundId}` — entire proposal lifecycle (submit, edit, withdraw, clone)

`proposalContext()` replaces both `submitContext()` and `editContext()` in
the SDK exports.

## Coexistence with legacy

Until step 11 lands, **both paths coexist**:
- Demo users (Maria, David, etc.) keep using principal-gated calls.
- AnonCreds-gated calls become available as the wrapper code lands.
- DB constraint: `nullifier_hash` is nullable; `principal` is nullable; legacy rows have `principal` set + `nullifier_hash` NULL, new rows have the inverse.

## Validation

- E2E test (Maria submits proposal via legacy path; new test user submits via AnonCreds path; both visible in steward review)
- Replay test (same credential cannot vote twice on same round)
- Anonymity test (no DB column links nullifier to credentialId in a recoverable way)
- Revocation test (revoked credential cannot present successfully)
