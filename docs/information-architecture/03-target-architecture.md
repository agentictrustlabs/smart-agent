# 03 — Target Architecture (Per-Store Schemas)

This is the shape of each store *after* the cut. Schemas are sketched as drizzle-style table definitions (informal — the developer expands into real `schema.ts` files during build).

## Web SQL — `apps/web/src/db/schema.ts` (target)

Web SQL becomes thin. Five categories:

```ts
// Auth & session
users {                      // Auth-side fields ONLY (no profile, no preferences)
  id, smartAccountAddress, did, emailHash,
  privyUserId, createdAt, lastLoginAt
}
sessions { sessionId, userId, expiresAt, ... }   // cookie-backed sessions
recoveryDelegations { ... }
recoveryIntents { ... }
invites { ... }

// Reference catalogs (shared, not user-instance)
trainingModules { id, programKey, key, title, description, hours, displayOrder }
hubVocabulary { hubKey, term, label, lang }                    // sourced from a-box
relationshipTypes_cache { typeHash, key, label }               // cache of on-chain registry
ontologyTerms_cache { termHash, key, label, parentHash }       // cache of on-chain registry

// On-chain caches (read-through, never authoritative)
agentMetadata_cache { address, name, type, displayName, ..., lastSyncedAt }
edges_cache { edgeId, subject, object, type, status, lastSyncedAt }
assertions_cache { assertionId, edgeId, type, ..., lastSyncedAt }

// Discover read cache (mirror of GraphDB public projections; OPTIONAL)
discover_intent_cache { intentId, ownerAgent, kind, summary, ..., lastSyncedAt }
discover_offering_cache { offeringId, ownerAgent, ..., lastSyncedAt }
discover_need_cache { needId, ownerAgent, ..., lastSyncedAt }
```

The discover cache is optional; we can read GraphDB directly. Add only if measured latency demands it.

**Removed from web SQL:** every table listed in section I of [02-data-ownership-map.md](02-data-ownership-map.md).

---

## person-mcp — target schema

Builds on the existing person-mcp foundation. All tables keyed by `principal`.

```ts
// Already exists (kept)
accounts, external_identities, profiles, chatThreads, chatMessages,
token_usage, sessions, revocation_epochs, action_nonces_v2, audit_log,
holder_wallets, action_nonces, credential_metadata,
trust_overlap_audit, ssi_proof_audit, vault_kv (askar), profiles (askar)

// NEW — personal app data
user_preferences {
  principal PRIMARY KEY,
  language, homeChurch, location, theme, notifications, ...
}
oikos_contacts {
  id, principal, name, relationship, proximityRing,
  spiritualResponseState, lastContactAt, plannedConversation, notes, createdAt
}
prayers {
  id, principal, title, content, schedule, responseState,
  linkedOikosContactId, tags, createdAt, updatedAt
}
training_progress {
  id, principal, moduleKey, programKey, status, completedAt, hoursLogged
}
pinned_items {
  id, principal, itemType, itemRef, displayOrder, createdAt
}
notifications {
  id, principal, kind, payload, readAt, createdAt
}
beliefs {
  id, principal, statement, tags, informsIntentId, visibility, createdAt
}
coaching_notes {
  id, principal,                  // coach owns the row
  subjectAgent,                   // disciple address
  content, sharedWithSubject,     // bool — if true, disciple cross-delegation reads it
  createdAt
}

// NEW — personal intents/needs/offerings (owner-routed)
intents {
  id, principal, direction,       // receive | give
  visibility,                     // public | public-coarse | private | off-chain
  kind, addressedTo, summary, contextJson,
  status, priority, expiresAt, createdAt, updatedAt,
  graphdbMirroredAt               // timestamp of last public mirror
}
needs {                           // projection of receive-direction intents
  id, principal, intentId, kind, requirements, status,
  visibility, geo, capacityNeeded, createdAt
}
offerings {                       // projection of give-direction intents
  id, principal, intentId, kind, capabilities, capacity,
  visibility, geo, timeWindow, createdAt
}
outcomes {
  id, principal, intentId, metric, target, achieved, achievedAt
}
activity_log_entries {
  id, principal, kind, performedAt, durationMin,
  geo, witnesses, fulfillsEntitlementId,    // links to on-chain entitlement
  fulfillsNeedId, fulfillsIntentId,
  payload, evidenceUri, createdAt
}
work_items {                      // assigned-to person
  id, principal,                  // assignee
  entitlementId,                  // on-chain reference
  title, description, dueAt, status, resolvedAt,
  resolvedByActivityId, createdAt
}
cross_delegation_grants {
  id, principal,                  // grantor
  granteeAgent, scopeJson, validFrom, validUntil,
  caveatTerms, createdAt, revokedAt
}

// NEW — engagement holder-side state
engagement_holder_state {
  entitlementId PRIMARY KEY,      // on-chain id
  principal,                      // holder agent
  capacityConsumed, holderOutcomeNotes, lastActivityId, ..., updatedAt
}
```

**Auth model** — identical to today: delegation token + cross-principal delegation, with caveat enforcement and JTI usage tracking.

**Public-anchor emitter (NOT a GraphDB writer)** — when a row is inserted/updated with `visibility ∈ {public, public-coarse}`, the MCP signs an on-chain assertion using the **owner's session signer** and submits it to the chain. For `public-coarse`, only the coarse fields are placed in the assertion. The on-chain assertion is then picked up by the existing on-chain → GraphDB sync. **The MCP never calls GraphDB directly.** This guarantees no private data leaks via GraphDB by construction.

A row carries `onChainAssertionId` once minted, so revoke/update flows can target the chain entry. The MCP's table is still the only place the full row lives; the on-chain assertion is a *narrower* public claim.

---

## org-mcp — target schema

This is the biggest new build. Today org-mcp is OID4VCI-only; after the cut it's a full peer of person-mcp.

```ts
// Already exists (kept)
pre_auth                          // OID4VCI

// NEW — auth foundation (mirror of person-mcp)
org_accounts                      // org smart account registrations
org_token_usage                   // JTI tracking
org_sessions                      // session signing
org_revocation_epochs
org_action_nonces
org_audit_log

// NEW — org core
org_profiles_private {            // private fields ONLY
  org_principal PRIMARY KEY,
  internalContactEmail, internalContactPhone,
  internalNotes, financialContacts,
  createdAt, updatedAt
}
// NOTE: public org profile fields (name, logo, website, public-facing description,
// public address) are anchored ON-CHAIN as agent metadata. They are not stored in org-mcp.
// The on-chain → GraphDB sync indexes them for Discover. To update the public profile,
// the org owner submits an on-chain transaction. org-mcp never duplicates these fields.
org_members {
  id, org_principal, memberAgent, role, joinedAt, leftAt,
  edgeId                          // on-chain edge that anchors the membership
}
detached_members {
  id, org_principal, displayName, contactInfoEncrypted,
  trackedSince, notes, createdBy, createdAt
}

// NEW — org business data
revenue_reports {
  id, org_principal, period, revenue, expenses, currency,
  submittedBy, submittedAt, verifiedBy, verifiedAt, status, evidenceUri
}
proposals {                       // off-chain DB cache; on-chain governance is canonical
  id, org_principal, kind, body, proposerAgent,
  votesFor, votesAgainst, status, onChainProposalId, createdAt
}
activity_log_entries { ... }      // same shape as person-mcp's
intents { ... }                   // same shape; principal=org_principal
needs { ... }
offerings { ... }
outcomes { ... }
orchestration_plans {
  id, org_principal, parentIntentId, subIntents, dependencies, ..., createdAt
}
work_items { ... }                // assignee=org_principal
notifications { ... }             // org inbox
beliefs { ... }                   // org-held
cross_delegation_grants { ... }   // grantor=org_principal

// NEW — engagement provider-side state
engagement_provider_state {
  entitlementId PRIMARY KEY,      // on-chain id
  org_principal,                  // provider
  capacityRemaining, providerNotes, internalAssignee, ..., updatedAt
}
engagement_sessions {
  id, entitlementId, scheduledAt, occurredAt, status, notes
}
engagement_tranches {
  id, entitlementId, scheduledAt, amount, currency,
  status, releasedAt, gatedOnReportId
}
engagement_policies {
  id, entitlementId, policyType, documentUri, version, signaturesRequired
}
policy_signers {
  id, policyId, signerAgent, role, signedAt
}
```

**Auth model** — port the person-mcp delegation flow:
- Delegation token gates each tool, scoped by `allowedTools` caveat.
- Each row is keyed by `org_principal`; the delegation token's `delegator` claim must match (or be a delegation chain rooted at the org).
- Cross-principal delegation: an org owner grants a finance officer scoped read of `revenue_reports` only.
- All MCP tools require an explicit Security-approved delegation scope before merge.

**Multi-tenancy** — single org-mcp process serves all orgs; isolation is per `org_principal` column on every table. Same shape as person-mcp's per-`principal` isolation.

**Public-anchor emitter (NOT a GraphDB writer)** — same pattern as person-mcp: when a row is `public` or `public-coarse`, the MCP signs an on-chain assertion via the org's session signer. The on-chain → GraphDB sync handles indexing. **org-mcp never calls GraphDB.**

---

## GraphDB — target named graphs

GraphDB is fed exclusively by the on-chain → GraphDB sync (`apps/web/src/lib/ontology/sync.ts`). **No MCP writes to GraphDB.**

```
https://smartagent.io/graph/data/onchain      — agents, edges, assertions, intent/need/offering assertions, engagement events (one-way mirror of on-chain)
https://smartagent.io/graph/data/aggregates   — materialized trust/validation summaries (computed from `onchain` graph, never from MCP data)
https://smartagent.io/graph/schema/tbox       — T-Box (existing)
https://smartagent.io/graph/schema/cbox       — C-Box (existing)
https://smartagent.io/graph/data/abox         — A-Box hub/template instances (existing)
```

The `aggregates` graph is computed by a periodic job (or on each new on-chain mint) — its inputs are *only* on-chain assertions. It contains things like `agentValidationProfiles` and `feedbackAssertionSummaries`. There is no `projections` graph, because the only path for a piece of data to enter GraphDB is via on-chain.

---

## On-chain — what becomes canonical

After the cut, on-chain is canonical for:

- Identity (AgentAccount, AgentControl, AgentRegistry)
- Authority (AgentControl owners, proposals)
- Edges and roles (AgentRelationship)
- Assertions (AgentAssertion, AttestedAssertion family)
- Engagement state machine (Match, Entitlement, CommitmentThreadEntry, RoleAssignment) — currently shared with web SQL; ownership shifts entirely to chain after the cut
- Reviews, skill claims, agent assertions (already on-chain)

Web SQL caches read-through copies for UI speed; never authoritative.
