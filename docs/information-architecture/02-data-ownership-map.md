# 02 — Data Ownership Map

The authoritative table of every domain concept and where it lives after the cut.

**Legend**
- **Store**: where the row physically lives — `web-sql`, `person-mcp`, `org-mcp`, `family-mcp`, `skill-mcp`, `verifier-mcp`, `geo-mcp`, `graphdb`, `on-chain`
- **Tier**: visibility tier (`public` / `public-coarse` / `private` / `off-chain`) for MCP rows; n/a for non-MCP rows
- **On-chain assertion**: whether the row triggers an on-chain `makeAssertion` mint. **GraphDB only mirrors on-chain.** No MCP writes directly to GraphDB.
- **T-Box**: the ontology class

If a concept has no row here, it is undefined and a new IA decision is required before it ships.

**Privacy invariant:** The `Mirrored` column appears only for `on-chain` rows (whose mirror is GraphDB by sync). MCP rows are never mirrored anywhere. If they need to be discoverable, they emit an on-chain assertion — and it is the on-chain assertion that ends up in GraphDB, not the MCP row.

---

## A. Identity, Auth, Recovery (web-sql + on-chain)

| Concept | Store | Owner key | Tier | Mirrored | T-Box | Notes |
|---|---|---|---|---|---|---|
| User session / cookie | web-sql | session id | n/a | — | — | Privy + cookie store |
| Recovery delegation | web-sql | smart account | n/a | — | `sad:Delegation` | Bootstrap state for passkey re-enroll |
| Recovery intent | web-sql | smart account | n/a | — | — | Pending recovery proposal |
| Invite (org membership bootstrap) | web-sql | invite code | n/a | — | — | One-shot capability code |
| Smart account registration | on-chain | account address | public | graphdb | `sa:AgentAccount` | AgentAccount contract |
| Owner set | on-chain | account address | public | graphdb | `sa:AgentControl` | AgentControl contract |
| Edge / relationship | on-chain | edgeId | public | graphdb | `sar:RelationshipEdge` | AgentRelationship contract |
| Assertion | on-chain | assertionId | public | graphdb | `atl:AttestedAssertion` | AgentAssertion contract |

## B. Person-Owned Private Data (person-mcp)

| Concept | Store | Owner key | Tier | Mirrored | T-Box | Notes |
|---|---|---|---|---|---|---|
| Profile (PII) | person-mcp | principal | private | — | `sa:PersonProfile` | Already exists |
| External identities (OAuth) | person-mcp | principal | private | — | `sa:ExternalIdentity` | Already exists |
| Holder wallet (SSI) | person-mcp | principal | private | — | `sa:HolderWallet` | Already exists |
| Credential metadata | person-mcp | principal | private | — | `sa:Credential` | Already exists |
| Chat threads / messages | person-mcp | principal | private | — | `sa:ChatThread` | Already exists |
| User preferences | person-mcp | principal | private | — | `sa:UserPreferences` | NEW |
| Oikos contacts | person-mcp | principal | private | — | `sa:OikosContact` | NEW |
| Prayer entries | person-mcp | principal | private | — | `sa:Prayer` | NEW |
| Training progress | person-mcp | principal | private | none | `sa:TrainingProgress` | NEW; aggregate counts come from on-chain credential mints (skill claims), not from MCP |
| Pinned items | person-mcp | principal | private | none | `sa:PinnedItem` | NEW |
| Personal messages (notifications) | person-mcp | principal | private | none | `sa:Notification` | NEW |
| Personal beliefs | person-mcp | principal | private | none | `atl:Belief` | NEW |
| Coaching notes (coach side) | person-mcp | principal=coach | private | none | `sa:CoachingNote` | NEW; cross-delegation lets disciple read where shared |
| Personal intents | person-mcp | principal | private / public / public-coarse | on-chain assertion (when public) | `sa:Intent` | NEW; if public, MCP signs an `IntentAssertion` mint via owner's session |
| Personal needs (intent projection) | person-mcp | principal | inherits from intent | on-chain assertion (when public) | `sa:Need` | NEW; projection of receive intents |
| Personal offerings (intent projection) | person-mcp | principal | inherits from intent | on-chain assertion (when public) | `sa:Offering` | NEW; projection of give intents |
| Personal activity log entries | person-mcp | principal | private | — | `sa:ActivityLogEntry` | NEW |
| Personal work item assignments | person-mcp | principal=assignee | private | — | `sa:WorkItem` | NEW; entitlement-attached |
| Personal outcomes | person-mcp | principal | private | — | `sa:Outcome` | NEW; tied to personal intent |
| Cross-principal delegation grants | person-mcp | principal=grantor | private | — | `sad:CrossDelegation` | Grants others read access |
| Audit log (delegation usage) | person-mcp | principal | private | — | `sa:AuditEntry` | Already exists |

## C. Org-Owned Private Data (org-mcp)

org-mcp today: 1 table (`pre_auth` for OID4VCI). Everything below is NEW.

| Concept | Store | Owner key | Tier | Mirrored | T-Box | Notes |
|---|---|---|---|---|---|---|
| Org profile (public-fit fields: name, logo, description, contacts) | on-chain | org_principal | public | graphdb (via sync) | `sa:OrgProfile` | Public profile is anchored on-chain (already is, via agent metadata). MCP holds nothing public. |
| Org profile (private fields: internal contacts, finance details) | org-mcp | org_principal | private | none | `sa:OrgProfilePrivate` | NEW; never leaves MCP |
| Org member roster (with role) | org-mcp | org_principal | private | none | `sa:OrgMember` | NEW; on-chain edges anchor identity for the public side; the org-mcp roster row holds private metadata (joined date, internal role, notes) |
| Detached members (no on-chain identity) | org-mcp | org_principal | private | none | `sa:DetachedMember` | NEW; never on-chain by definition |
| Revenue reports | org-mcp | org_principal | private | none | `sa:RevenueReport` | NEW; financial detail stays private |
| Proposals (off-chain detail) | org-mcp | org_principal | private | none | `sa:ProposalDraft` | NEW; on-chain governance state (votes, status) is canonical and indexed via existing on-chain → GraphDB sync |
| Org activity log entries | org-mcp | org_principal | private | none | `sa:ActivityLogEntry` | NEW |
| Org intents | org-mcp | org_principal | private / public / public-coarse | on-chain assertion (when public) | `sa:Intent` | NEW; same pattern as personal intents |
| Org needs (projection) | org-mcp | org_principal | inherits from intent | on-chain assertion (when public) | `sa:Need` | NEW |
| Org offerings (projection) | org-mcp | org_principal | inherits from intent | on-chain assertion (when public) | `sa:Offering` | NEW |
| Org outcomes | org-mcp | org_principal | private | none | `sa:Outcome` | NEW |
| Org orchestration plans (BDI decomposition) | org-mcp | org_principal | private | none | `sa:OrchestrationPlan` | NEW |
| Org work items (assignee=org agent) | org-mcp | org_principal=assignee | private | — | `sa:WorkItem` | NEW |
| Engagement sessions (cadence) | org-mcp | org_principal=provider | private | none | `sa:EngagementSession` | NEW; private internal scheduling |
| Engagement tranches (money) | org-mcp | org_principal=provider | private | none | `sa:EngagementTranche` | NEW; financial detail stays private. On-chain tranche-release event (when fired) is the public anchor. |
| Engagement policies (governance) | org-mcp | org_principal=provider | private | none | `sa:EngagementPolicy` | NEW; the policy *commitment* is on-chain; the policy document detail stays private |
| Policy signers | org-mcp | org_principal | private | none | `sa:PolicySigner` | NEW |
| Org messages / inbox | org-mcp | org_principal | private | none | `sa:Notification` | NEW |
| Cross-principal delegation grants | org-mcp | org_principal=grantor | private | none | `sad:CrossDelegation` | NEW; same pattern as person-mcp |
| OID4VCI pre-auth (credential issuance) | org-mcp | org_principal=issuer | private | none | — | Already exists |

## D. Multi-Party Engagement (on-chain backbone + per-side MCP private state)

Engagements are decomposed: the public state-machine backbone is **entirely on-chain**, and each party's *private* side-state is in their own MCP. **Nothing about the engagement is duplicated in GraphDB except via the existing on-chain → GraphDB sync.**

| Concept | Store | Owner key | Tier | Mirrored | T-Box | Notes |
|---|---|---|---|---|---|---|
| Engagement backbone (Match → Entitlement, status, signatures, mints) | on-chain | matchId / entitlementId | public | graphdb (via on-chain sync) | `sa:Engagement` | Single source of truth for the public state machine |
| Holder side-state (capacity consumed, holder's private outcome notes) | holder's MCP | holder agent | private | none | `sa:EngagementHolderState` | NEW; never published anywhere |
| Provider side-state (work-item assignments, session schedules, internal tranche notes) | provider's MCP | provider agent | private | none | `sa:EngagementProviderState` | NEW; never published anywhere |
| Commitment thread entries | on-chain | entryId | public | graphdb (via on-chain sync) | `sa:CommitmentThreadEntry` | Audit backbone; reconstructable from chain logs |

## E. Trust Deposits (on-chain canonical + GraphDB aggregate)

Trust deposits are public-by-design (they are reputation). They are *not* in person-mcp or org-mcp.

| Concept | Store | Owner key | Tier | Mirrored | T-Box | Notes |
|---|---|---|---|---|---|---|
| Agent review record | on-chain | reviewId | public | graphdb | `atl:ReputationTrustAssertion` | |
| Agent skill claim | on-chain (CredentialRegistry) | claimId | public | graphdb | `atl:VerificationTrustAssertion` | |
| Agent assertion (engagement-as-claim) | on-chain | assertionId | public | graphdb | `atl:AttestedAssertion` | |
| Agent validation profile (rolling aggregate) | graphdb (materialized) | agent address | public | — | `atl:ValidationAssertionSummary` | Recomputed on each new deposit; not stored in any MCP |

## F. Marketplace / Discovery (on-chain canonical → GraphDB mirror)

Discover reads exclusively from GraphDB. GraphDB only mirrors on-chain. **No web SQL discover cache** (we don't add caching until measured latency demands it, and it would still mirror on-chain not MCPs). **No MCP-to-GraphDB pipe.**

| Concept | Store | Owner key | Tier | Mirrored | T-Box | Notes |
|---|---|---|---|---|---|---|
| Public intent assertion | on-chain | assertionId | public | graphdb (via on-chain sync) | `sa:Intent` | Minted by the owner's MCP via owner's session signer |
| Public need assertion | on-chain | assertionId | public | graphdb (via on-chain sync) | `sa:Need` | Same |
| Public offering assertion | on-chain | assertionId | public | graphdb (via on-chain sync) | `sa:Offering` | Same |
| Match scoring inputs | graphdb | n/a | public | (computed) | `sa:MatchScore` | Computed at query time from on-chain mirror |
| Need-resource match record | on-chain | matchId | public | graphdb (via on-chain sync) | `sa:NeedResourceMatch` | When match is accepted, on-chain mint creates entitlement |

## G. Domain-Specific MCPs

| Concept | Store | Owner key | Tier | Mirrored | T-Box | Notes |
|---|---|---|---|---|---|---|
| Family ties | family-mcp | family_principal | private | none | `sa:FamilyTie` | Already exists |
| Family nonces | family-mcp | family_principal | private | none | — | |
| Geo claims (operatesIn / residentOf) | on-chain (public) + geo-mcp (private detail) | agent address | public / private (per-claim) | graphdb (via on-chain sync) | `sa:GeoClaim` | Public claims are anchored on-chain; private locations stay in geo-mcp only |
| Skill claims (issuance side) | skill-mcp | issuer | private | none | `sa:SkillClaimDraft` | Issuance state; mints to on-chain CredentialRegistry — that's where they become public |
| Verifier nonces / sessions | verifier-mcp | verifier | private | none | — | Already exists |

## H. Reference Catalogs (web-sql, never private)

| Concept | Store | Tier | T-Box | Notes |
|---|---|---|---|---|
| Training module catalog | web-sql | n/a | `sa:TrainingModule` | Shared reference data; not user-instance |
| Hub vocabulary (label overrides) | web-sql + graphdb (a-box) | n/a | `sa:HubVocabulary` | Sourced from `docs/ontology/cbox/hub-vocabulary.ttl` |
| Relationship type registry | on-chain (canonical) + web-sql cache | public | `sar:RelationshipType` | |
| Ontology term registry | on-chain (canonical) + web-sql cache | public | `sa:OntologyTerm` | |

## I. Removed / Dropped From Web SQL

These tables in `apps/web/src/db/schema.ts` are removed entirely after the cut. Rows are re-derived from on-chain + each MCP's seed.

```
users (private side)        → person-mcp profiles
userPreferences             → person-mcp
circles                     → person-mcp (oikos)
prayers                     → person-mcp
trainingProgress            → person-mcp
coachRelationships          → drop (use on-chain COACHING_MENTORSHIP edge + person-mcp coaching notes)
pinnedItems                 → person-mcp
messages                    → person-mcp + org-mcp (split by recipient owner)
revenueReports              → org-mcp
proposals                   → org-mcp (DB cache; on-chain remains canonical)
detachedMembers             → org-mcp (or stay on-chain JSON property — see decision in 03)
activityLogs                → owner-routed: person-mcp or org-mcp
intents                     → owner-routed: person-mcp or org-mcp; graphdb public mirror
needs                       → owner-routed projection
resourceOfferings           → owner-routed projection
needResourceMatches         → on-chain canonical; graphdb mirror
outcomes                    → owner-routed
orchestrationPlans          → org-mcp (BDI decomposition is org-side)
entitlements                → on-chain canonical; per-side state in each MCP
fulfillmentWorkItems        → assignee's MCP (owner-routed)
commitmentThreadEntries     → on-chain canonical; graphdb mirror
roleAssignments             → on-chain canonical; graphdb mirror
engagementSessions          → provider's MCP
engagementTranches          → provider's MCP; graphdb coarse mirror
engagementPolicies          → provider's MCP; graphdb mirror
policySigners               → provider's MCP
agentReviewRecords          → on-chain canonical; graphdb aggregate
agentSkillClaims            → on-chain canonical; graphdb aggregate
agentAssertions             → on-chain canonical; graphdb aggregate
agentValidationProfiles     → graphdb materialized aggregate
beliefs                     → owner-routed (person-mcp or org-mcp)
```

## J. Open Decisions (escalate to IA before shipping)

1. **Detached members** — keep current on-chain JSON property pattern, or move to `org-mcp` table? Trade-off: on-chain is simpler to query in dashboards, MCP is more flexible. *Recommendation: org-mcp, with a thin on-chain pointer.*
2. **Hub-level intents** (a hub agent expressing intent on behalf of all members) — does the hub agent have its own org-mcp tenant, or do hubs piggyback on a parent org's tenant? *Recommendation: every hub agent is an org-mcp tenant (orgs and hubs are both `sa:OrgAgent`).*
3. **Beliefs** (held by either person or org) — owner-routed is the obvious answer, but the on-chain edge backing a belief-derived assertion needs both stores reachable from the assertion. *Recommendation: owner-routed. Assertion-issuance flow looks up the agent type and routes the read.*
4. **Web SQL discover cache** — full mirror of GraphDB public projections, or query GraphDB directly on each request? *Recommendation: GraphDB direct for now; add cache only if latency demands.*
