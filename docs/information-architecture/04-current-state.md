# 04 — Current State (What We're Tearing Down)

Snapshot taken 2026-05-02. This is the "before" picture. After the cut (see [07-build-plan.md](07-build-plan.md)), most of this moves.

## Web SQL — `apps/web/src/db/schema.ts` (38 tables)

### Auth / recovery (stays)
- `users` (auth-side fields stay; profile fields move to person-mcp)
- `recoveryDelegations`
- `recoveryIntents`
- `invites`
- `trainingModules` (reference catalog, stays)

### Person-private (moves to person-mcp)
- `userPreferences`
- `circles` (oikos)
- `prayers`
- `trainingProgress`
- `coachRelationships` (drop; on-chain edge replaces)
- `pinnedItems`
- `messages` (split by recipient owner: person → person-mcp, org → org-mcp)

### Org-private (moves to org-mcp)
- `revenueReports`
- `proposals`
- `detachedMembers`

### Owner-routed (moves to person-mcp OR org-mcp by row)
- `intents` — currently mixes person- and org-expressed rows; will split
- `needs` — projection of intents; same split
- `resourceOfferings` — projection of intents; same split
- `outcomes` — same split
- `orchestrationPlans` (org-side)
- `activityLogs` — same split
- `beliefs` — same split

### Engagement cluster (decomposed: on-chain backbone + per-side MCP state)
- `entitlements`
- `fulfillmentWorkItems`
- `commitmentThreadEntries`
- `roleAssignments`
- `engagementSessions`
- `engagementTranches`
- `engagementPolicies`
- `policySigners`
- `needResourceMatches`

### Trust deposits (on-chain canonical + GraphDB aggregate)
- `agentReviewRecords`
- `agentSkillClaims`
- `agentAssertions`
- `agentValidationProfiles`

## person-mcp — current schema

Foundation is in place; domain tables are missing.

**Already exists:**
- `accounts` — smart account registrations
- `external_identities` — OAuth links
- `profiles` — PII (email, phone, DOB, address, displayName, bio, avatarUrl, location, preferences JSON)
- `chatThreads`, `chatMessages` — conversations
- `token_usage` — JTI tracking for delegation tokens
- `sessions`, `revocation_epochs`, `action_nonces_v2`, `audit_log` — passkey-rooted session signing
- `holder_wallets`, `action_nonces`, `credential_metadata`, `trust_overlap_audit`, `ssi_proof_audit` — SSI wallet
- `vault_kv`, `profiles` (askar) — encrypted KV store

**Auth model:** delegation token (HMAC + ERC-1271) with caveat enforcement; cross-principal delegation for scoped reads of another user's data; passkey-rooted session signing for write actions.

**Tools (MCP):** `get_profile`, `update_profile`, `get_delegated_profile`, `add/list/remove_external_identity`, `create_thread`, `add_message`, `list_threads`, `get_thread`, `ssi_create_wallet_action`.

**HTTP routes:** wallet provision, credential request/store, presentations, OID4VP, audit append/read, wallet-action verify/dispatch.

**Missing for the cut:** every person-domain table listed in section B of [02-data-ownership-map.md](02-data-ownership-map.md) — preferences, oikos, prayers, training, pinned, notifications, beliefs, coaching notes, intents/needs/offerings/outcomes, activity log entries, work items, cross-delegation grants table.

## org-mcp — current schema

Effectively empty for business data.

**Already exists:**
- `pre_auth` (OID4VCI pre-authorized code flow)
- `org-private.db` — only used as the IssuerAgent's AnonCreds private store (master secret, schema/credDef JSON). **Not** business data.

**Auth model:** none. `/credential/offer`, `/oid4vci/offer` accept any caller. `/token` and `/credential` use capability (pre-auth code) only.

**Tools (MCP):** none.

**HTTP routes:** `/credential/offer`, `/credential/issue`, `/.well-known/openid-credential-issuer`, `/oid4vci/offer`, `/oid4vci/offer-by-code/:code`, `/token`, `/credential`.

**Missing for the cut:** literally everything in section C of [02-data-ownership-map.md](02-data-ownership-map.md). org-mcp needs:
- A multi-tenant schema keyed by `org_principal`
- A delegation-based auth model (mirror of person-mcp's)
- Drizzle tables for org profile, members, revenue, proposals, activity log, intents/needs/offerings/outcomes, orchestration plans, work items, engagement sessions/tranches/policies/policy signers, detached members, notifications, cross-delegations
- A public-projection writer that mirrors `public` and `public-coarse` rows to GraphDB

This is the largest single piece of new construction.

## family-mcp / geo-mcp / skill-mcp / verifier-mcp

Already serve their narrow purposes. Schema audit deferred to per-domain owners (see [08-team-assignments.md](08-team-assignments.md)). Notable:

- `geo-mcp` — geo claims (operatesIn / residentOf). Stays.
- `skill-mcp` — skill issuance. Mints land on-chain CredentialRegistry; private issuer state stays here.
- `family-mcp` — family ties. Stays as-is.
- `verifier-mcp` — verifier nonces. Stays.

## GraphDB

Currently mirrors agents + relationships from on-chain. `apps/web/src/lib/ontology/sync.ts` is the writer. T-Box files in `docs/ontology/tbox/` are the schema.

**After the cut:** GraphDB also receives public-projection writes from each MCP (intents, offerings, geo claims, etc.). Today those projections only exist as web SQL rows. The new pattern: each MCP writes its public rows to GraphDB on insert/update. Web SQL stops being a discoverable source.

## On-chain

Already canonical for identity, edges, assertions, governance proposals, name registry, ontology term registry, relationship type registry, credential registry.

**After the cut:** also canonical for the engagement state machine (Match → Entitlement → Outcome) where it currently shares state with web SQL. This means the `entitlements`/`commitmentThreadEntries`/`roleAssignments` tables in web SQL go away — their authoritative state already exists on-chain; web SQL was just denormalizing for convenience.
