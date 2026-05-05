# 06 — Data Ontology Per Store

How the physical schema in each store maps onto the **T-Box / C-Box / A-Box** ontology in `docs/ontology/`. This doc keeps the Information Architect and the Ontologist in sync.

> **Reference:** ontology source of truth is `docs/ontology/`. Read [docs/agents/ontologist.md](../agents/ontologist.md) for the ontology layering rules. The Domain Separation Principle there is binding.

## Ontology layering (recap)

```
T-Box (tbox/*.ttl)   — domain-neutral schema (classes, properties)
C-Box (cbox/*.ttl)   — controlled vocabulary, SHACL shapes, enumerations
A-Box (abox/*.ttl)   — concrete instances (hubs, templates) + runtime data in GraphDB
```

Every physical table in this folder's target architecture maps to **exactly one T-Box class** (the row's type) and zero or more C-Box vocabularies (its enum/category fields).

## Bridge classes — agents and engagements

The classes that bridge our physical stores:

| T-Box class | Physical home | Notes |
|---|---|---|
| `sa:Agent` (super) | on-chain (canonical) + graphdb mirror | Identity + owner set |
| `sa:PersonAgent` | on-chain + person-mcp `accounts` | One agent per person principal |
| `sa:OrgAgent` | on-chain + org-mcp `org_accounts` | One agent per org principal; hubs also `sa:OrgAgent` |
| `sar:RelationshipEdge` | on-chain (canonical) + graphdb mirror | Edges anchor membership, coaching, governance |
| `atl:AttestedAssertion` | on-chain (canonical) + graphdb mirror | Reviews, skill claims, engagement assertions |
| `sa:Engagement` | on-chain (canonical) + per-side MCP private state + graphdb mirror | Match + Entitlement state machine; decomposed per P2 in [01-principles.md](01-principles.md) |
| `sa:Intent` | owner's MCP + graphdb mirror (if public) | Owner-routed |
| `sa:CommitmentThreadEntry` | on-chain (canonical) + graphdb mirror | Audit thread |

## Per-store ontology view

### Web SQL — what classes live here

After the cut, web SQL holds instances of:

| T-Box class | Web table | Why here |
|---|---|---|
| `sa:Session` (auth) | `sessions` | Cookie-backed, web-only |
| `sad:RecoveryDelegation` | `recoveryDelegations` | Bootstrap before MCP exists for the user |
| `sa:RecoveryIntent` | `recoveryIntents` | Bootstrap |
| `sa:Invite` | `invites` | One-shot capability for org membership bootstrap |
| `sa:TrainingModule` | `trainingModules` | Reference catalog (shared, not user-instance) |
| `sa:HubVocabulary` | `hubVocabulary` | A-Box instance cache from `cbox/hub-vocabulary.ttl` |
| `sar:RelationshipType` | `relationshipTypes_cache` | Cache of on-chain registry |
| `sa:OntologyTerm` | `ontologyTerms_cache` | Cache of on-chain registry |
| **(cache classes)** | various `*_cache` tables | Read-through caches; never authoritative |

No `sa:Intent`, `sa:Need`, `sa:Offering`, `sa:Outcome`, `sa:Engagement`, `sa:WorkItem`, `sa:ActivityLogEntry`, `sa:Prayer`, `sa:OikosContact`, `sa:UserPreferences`, `sa:Notification`, `sa:RevenueReport`, `sa:Proposal`, `sa:OrgProfile`, `sa:OrgMember`, `sa:DetachedMember` — these are private and live in MCPs.

### person-mcp — what classes live here

| T-Box class | person-mcp table | Notes |
|---|---|---|
| `sa:PersonAgent` | `accounts` | One row per principal |
| `sa:ExternalIdentity` | `external_identities` | OAuth links |
| `sa:PersonProfile` | `profiles` | PII |
| `sa:HolderWallet` | `holder_wallets` | SSI |
| `sa:Credential` | `credential_metadata` | AnonCreds |
| `sa:ChatThread`, `sa:ChatMessage` | `chatThreads`, `chatMessages` | |
| `sa:Session` (passkey-rooted) | `sessions` | Distinct from web `sa:Session` (cookie) |
| `sa:UserPreferences` | `user_preferences` | NEW |
| `sa:OikosContact` | `oikos_contacts` | NEW; corresponds to legacy `circles` table |
| `sa:Prayer` | `prayers` | NEW |
| `sa:TrainingProgress` | `training_progress` | NEW |
| `sa:PinnedItem` | `pinned_items` | NEW |
| `sa:Notification` | `notifications` | NEW |
| `atl:Belief` | `beliefs` | NEW |
| `sa:CoachingNote` | `coaching_notes` | NEW |
| `sa:Intent` | `intents` | NEW |
| `sa:Need` | `needs` | NEW; projection of `sa:Intent` direction=receive |
| `sa:Offering` | `offerings` | NEW; projection of `sa:Intent` direction=give |
| `sa:Outcome` | `outcomes` | NEW |
| `sa:ActivityLogEntry` | `activity_log_entries` | NEW |
| `sa:WorkItem` | `work_items` | NEW; assignee=this principal |
| `sad:CrossDelegation` | `cross_delegation_grants` | NEW; grants others scoped read access |
| `sa:EngagementHolderState` | `engagement_holder_state` | NEW; holder-side per-entitlement metadata |
| `sa:MatchInitiation` | `match_initiations` | NEW (spec 001); owned by initiator; visibility inherits stricter of two source intents — see [10§2.1](10-intent-marketplace-classification.md#21-matchinitiation-spec-001) |
| `sa:PoolPledge` | `pool_pledges` | NEW (spec 002); owned by donor; `anonymous` storyPermissions never anchor on-chain — see [10§2.2](10-intent-marketplace-classification.md#22-poolpledge-spec-002) |
| `sa:ProposalSubmission` (rename candidate `sa:GrantProposal`, see [10§5](10-intent-marketplace-classification.md#5-recommended-renames--consistency-edits) / O1) | `proposal_submissions` | NEW (spec 003); owned by proposer; always private; stewards read via `proposal:read_for_review` cross-delegation |
| `sa:AuditEntry` | `audit_log` | Existing |

### org-mcp — what classes live here

| T-Box class | org-mcp table | Notes |
|---|---|---|
| `sa:OrgAgent` | `org_accounts` | One row per org principal (orgs and hubs) |
| `sa:OrgProfile` | `org_profiles` | Some fields public via projection |
| `sa:OrgMember` | `org_members` | On-chain edge anchors |
| `sa:DetachedMember` | `detached_members` | No on-chain identity |
| `sa:RevenueReport` | `revenue_reports` | Always private |
| `sa:Proposal` | `proposals` | DB cache; on-chain governance state canonical |
| `sa:ActivityLogEntry` | `activity_log_entries` | NEW |
| `sa:Intent`, `sa:Need`, `sa:Offering`, `sa:Outcome` | `intents`, `needs`, `offerings`, `outcomes` | Owner-routed |
| `sa:OrchestrationPlan` | `orchestration_plans` | BDI decomposition |
| `sa:WorkItem` | `work_items` | Assignee=org principal |
| `sa:Notification` | `notifications` | Org inbox |
| `atl:Belief` | `beliefs` | Org-held beliefs |
| `sad:CrossDelegation` | `cross_delegation_grants` | NEW |
| `sa:EngagementProviderState` | `engagement_provider_state` | NEW |
| `sa:EngagementSession` | `engagement_sessions` | Cadence shape |
| `sa:EngagementTranche` | `engagement_tranches` | Money shape |
| `sa:EngagementPolicy` | `engagement_policies` | Governance shape |
| `sa:PolicySigner` | `policy_signers` | |
| `sa:MatchInitiation` | `match_initiations` | NEW (spec 001); owned by initiator when initiator is an org agent (e.g., a hub agent acting as connector) |
| `sa:PoolPledge` | `pool_pledges` | NEW (spec 002); owned by donor when donor is an org (org-to-pool pledge) |
| `sa:ProposalSubmission` | `proposal_submissions` | NEW (spec 003); typical home — proposers are usually orgs applying for grants |
| `sa:Round` | `rounds` | NEW (spec 003); fund's RFP; tenant key = fund's org_principal; on-chain anchored via `sa:RoundOpenedAssertion` |
| `sa:Pool` (with `sa:acceptsUnit`, `sa:ceilingPolicy`, `sa:capacityCeiling`, `sa:acceptsOpenCalls`) | extends existing pool-agent profile | EXTENDED (spec 002 + 003); public agent-metadata fields anchored on-chain with the existing pool sync |
| Pool aggregate `pledgedTotal` (per-pool counter) | `pool_aggregates` (NEW) | NEW (spec 002); fund-mcp aggregate updated by donors via `pool:contribute_to_total` system-delegation; published on-chain as `sa:PoolPledgedTotalAssertion` for public pools |
| `sa:CredentialIssuance` (OID4VCI) | `pre_auth` | Existing |

### GraphDB — what classes live here

GraphDB holds **only** instances that came from on-chain. No MCP-sourced data. Two kinds:

1. **On-chain mirrors** (existing + expanded): `sa:Agent`, `sar:RelationshipEdge`, `atl:AttestedAssertion`, `sa:Engagement`, `sa:CommitmentThreadEntry`. Adding: `sa:Intent`, `sa:Need`, `sa:Offering`, `sa:GeoClaim` — but **only the instances that have an on-chain assertion**. Private intents, private offerings, private geo claims do not appear in GraphDB. From specs 001/002/003: `sa:MatchInitiation` (only public-tier), `sa:PoolPledge` (only public-tier; `anonymous` never appears), `sa:Round` (public rounds; private rounds appear as coarse mirrors without addressed-applicant lists), pool aggregates published as `sa:PoolPledgedTotalAssertion`. **Never** `sa:ProposalSubmission` in v1 — proposal bodies stay confidential.
2. **Materialized aggregates** computed from the on-chain mirror: `atl:ValidationAssertionSummary`, `atl:FeedbackAssertionSummary`, `sa:AgentTrustIndex`. Inputs are on-chain assertions only.

Write paths (all flow from on-chain):
- `apps/web/src/lib/ontology/sync.ts` is the only writer. It reads chain state via the SDK and emits Turtle to GraphDB.
- For new assertion types (intents, offerings, etc.), the sync emitter is extended to read the new on-chain assertion classes and produce the corresponding RDF.
- The aggregates graph is recomputed from `onchain` (SPARQL UPDATE), not from MCPs.

**Forbidden:** Any helper named `publishProjection`, `mirrorToGraphDb`, or any code path that lets an MCP write to GraphDB. If you find one in a PR, reject it. The on-chain emit is the **only** way data gets to GraphDB.

## New T-Box terms required

The classes marked **NEW** above need T-Box definitions. Ontologist owns the work; IA tracks them here:

```
sa:UserPreferences            — subClassOf prov:Entity
sa:OikosContact               — subClassOf prov:Entity (replaces conceptual sa:Circle)
sa:Prayer                     — subClassOf prov:Entity
sa:TrainingProgress           — subClassOf prov:Entity
sa:PinnedItem                 — subClassOf prov:Entity
sa:Notification               — subClassOf prov:Entity
atl:Belief                    — already exists in legacy ATL? confirm
sa:CoachingNote               — subClassOf prov:Entity
sa:Intent                     — subClassOf prov:Entity (already drafted in intent-bdi-plan.md?)
sa:Need                       — subClassOf sa:Intent
sa:Offering                   — subClassOf sa:Intent
sa:Outcome                    — subClassOf prov:Entity
sa:ActivityLogEntry           — subClassOf prov:Activity
sa:WorkItem                   — subClassOf p-plan:Step
sad:CrossDelegation           — subClassOf sad:Delegation
sa:Engagement                 — subClassOf prov:Entity
sa:EngagementHolderState      — subClassOf prov:Entity
sa:EngagementProviderState    — subClassOf prov:Entity
sa:EngagementSession          — subClassOf prov:Activity
sa:EngagementTranche          — subClassOf prov:Entity
sa:EngagementPolicy           — subClassOf prov:Plan
sa:PolicySigner               — subClassOf prov:Agent
sa:OrgProfile                 — subClassOf prov:Entity
sa:OrgMember                  — subClassOf prov:Agent
sa:DetachedMember             — subClassOf prov:Entity
sa:RevenueReport              — subClassOf prov:Entity
sa:Proposal                   — already on-chain; ontology class subClassOf prov:Plan
sa:OrchestrationPlan          — subClassOf p-plan:Plan
sa:HubVocabulary              — subClassOf skos:ConceptScheme
sa:OntologyTerm               — subClassOf prov:Entity

# Intent marketplace (specs 001 / 002 / 003) — see 10-intent-marketplace-classification.md
sa:MatchInitiation            — subClassOf prov:Entity
sa:PoolPledge                 — subClassOf prov:Entity
sa:PledgeAmendment            — subClassOf prov:Entity (embedded inside PoolPledge.history)
sa:ProposalSubmission         — subClassOf prov:Plan (rename candidate: sa:GrantProposal — O1)
sa:Round                      — subClassOf prov:Plan
sa:Fund                       — subClassOf sa:Pool (or property-as-discriminator — O3)
sa:MatchInitiationAssertion   — subClassOf atl:AttestedAssertion (on-chain anchor for public initiations)
sa:PledgeAssertion            — subClassOf atl:AttestedAssertion (on-chain anchor for public pledges)
sa:PoolPledgedTotalAssertion  — subClassOf atl:AttestedAssertion (on-chain anchor for pool's aggregate; no donor IRI)
sa:RoundOpenedAssertion       — subClassOf atl:AttestedAssertion
sa:RoundClosedAssertion       — subClassOf atl:AttestedAssertion

# C-Box vocabulary additions for intent marketplace
MatchInitiationKind             = { Self, Connector }
MatchInitiationStatus           = { Pending, Superseded, Consumed }
PledgeCadence                   = { OneTime, Monthly, Annual }
PledgeStatus                    = { Active, Waitlisted, Stopped, AutoStopped, Fulfilled }
StoryPermissions                = { Public, ShareWithSupportTeam, Anonymous }
CeilingPolicy                   = { Block, Waitlist, Accept }
ProposalStatus                  = { Draft, Submitted, Withdrawn, Awarded, Declined }
ReportingCadence                = { Quarterly, Milestone, Annual, None }
PledgeAmendmentKind             = { Amount, Cadence, Duration }
```

C-Box vocabulary additions (enums) needed:

```
EngagementShape                 = { Worker, Skill, Money, Curriculum, Credential, Organization, Church, Prayer }
ActivityKind                    = { Meeting, Visit, Training, Prayer, Service, ... }
ProposalKind                    = { PauseCapital, GraduateWave, EscalateReview, ... }
WorkItemStatus                  = { Open, InProgress, Resolved, Cancelled }
VisibilityTier                  = { Public, PublicCoarse, Private, OffChain }   ← used by every MCP row
NotificationKind                = { ReviewReceived, MatchAccepted, ProposalOpened, InviteReceived, DataAccessRequested, ... }
```

## Predicates that bridge stores

Some predicates *cross* the boundary — e.g., `sa:fulfillsEntitlement` on a `sa:ActivityLogEntry` in person-mcp points to a `sa:Engagement` whose canonical state is on-chain. These predicates always reference IDs (the on-chain `entitlementId` is the join key), never embedded objects.

```
sa:fulfillsEntitlement     ActivityLogEntry → Engagement     (id reference)
sa:fulfillsNeed            ActivityLogEntry → Need           (id reference; need lives in owner's MCP)
sa:fulfillsIntent          ActivityLogEntry → Intent         (id reference)
sa:linkedOikosContact      Prayer → OikosContact             (within person-mcp)
sa:assignee                WorkItem → Agent                  (assignee's MCP holds the row)
sa:projectsTo              Intent → Need | Offering          (within owner's MCP)
sa:onChainEdgeId           OrgMember → RelationshipEdge      (id reference)

# Intent marketplace bridge predicates (specs 001 / 002 / 003)
sa:initiator               MatchInitiation → Agent                  (id reference; row in initiator's MCP)
sa:viewedIntent            MatchInitiation → Intent                 (id; intent in expresser's MCP)
sa:candidateIntent         MatchInitiation → Intent                 (id; intent in expresser's MCP)
sa:pledger                 PoolPledge → Agent                       (id; row in donor's MCP)
sa:targetPool              PoolPledge → Pool                        (id; pool aggregate in fund's org-mcp)
sa:proposer                ProposalSubmission → Agent               (id; row in proposer's MCP)
sa:operatedByFund          Round → Pool (Fund)                      (id; round body in fund's org-mcp)
sa:basedOnIntent           ProposalSubmission → Intent              (id; intent in proposer's MCP)
sa:clonedFromProposal      ProposalSubmission → ProposalSubmission  (id reference within proposer's MCP)
sa:liveAcknowledgementCount Intent → integer                         (derived counter in intent-owner's MCP; see 10§O5)
```

## Domain Separation enforcement

Per [docs/agents/ontologist.md](../agents/ontologist.md), T-Box stays domain-neutral. Concretely for this migration:

- T-Box classes (`sa:OikosContact`, `sa:Prayer`, `sa:TrainingProgress`) are abstract trust/relationship/learning primitives, not church-specific. Their *labels* in church-hub UIs ("oikos", "prayer", "411 module") come from `cbox/hub-vocabulary.ttl`.
- The Ontologist confirms each new T-Box term has a generic-organization rationale before we ship.

If a new term *cannot* be expressed without a domain word, it goes in C-Box hub vocabulary, not T-Box.
