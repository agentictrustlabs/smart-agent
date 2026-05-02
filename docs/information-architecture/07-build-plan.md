# 07 — Build Plan

> **No backwards compatibility.** Build the target stores, rewrite seeds, rewire web actions, drop old tables. Re-seed via `scripts/fresh-start.sh`.

The plan has six phases. Each phase ends in a working `fresh-start.sh` and an updated readiness page.

## Phase 0 — Decisions and scaffolding

**Owner:** Information Architect + Ontologist + Security
**Output:** decisions ratified, scaffolding committed

- [ ] Ratify open decisions in [02-data-ownership-map.md §J](02-data-ownership-map.md#j-open-decisions-escalate-to-ia-before-shipping)
- [ ] Ontologist drafts new T-Box terms listed in [06-data-ontology.md](06-data-ontology.md) (PRs to `docs/ontology/tbox/*.ttl`)
- [ ] Security drafts the org-mcp delegation scope catalog (mirror of person-mcp's `allowedTools` caveat)
- [ ] Add `apps/org-mcp/src/db/schema.ts` skeleton (drizzle) and `apps/org-mcp/src/auth/` skeleton (port from person-mcp)
- [ ] Add `apps/person-mcp/src/db/schema.ts` columns/tables for the new domain rows (no logic yet)
- [ ] Update `scripts/fresh-start.sh` `WIPE_PATHS` to include org-mcp's new private DB paths
- [ ] Update `scripts/fresh-start.sh` `SERVICES` if any new MCP process is added

**Done when:** `fresh-start.sh` boots a stack with the new schemas present (empty), and `pnpm typecheck` passes.

## Phase 1 — Person-MCP domain expansion

**Owner:** Developer (with IA review)
**Output:** person-mcp owns all person-private app data; web SQL person-private tables dropped.

Tables to add and tools to expose (from [03-target-architecture.md](03-target-architecture.md)):

- `user_preferences` → `get_user_preferences`, `update_user_preferences`
- `oikos_contacts` → `list_oikos_contacts`, `add_oikos_contact`, `update_oikos_contact`, `delete_oikos_contact`, `toggle_planned_conversation`
- `prayers` → `list_prayers`, `upsert_prayer`, `delete_prayer`, `mark_prayer_response`
- `training_progress` → `list_training_progress`, `toggle_training_module`, `get_delegated_training_progress`
- `pinned_items` → `list_pinned_items`, `pin_item`, `unpin_item`
- `notifications` → `list_notifications`, `mark_notification_read`, `create_notification` (system-delegation only)
- `beliefs` → `list_beliefs`, `upsert_belief`, `delete_belief`
- `coaching_notes` → `list_coaching_notes`, `upsert_coaching_note`, `delete_coaching_note`, `share_coaching_note`
- `cross_delegation_grants` → `grant_cross_delegation`, `revoke_cross_delegation`, `list_cross_delegation_grants`

Each tool gets a Security-approved delegation scope name (`preferences:read`, `preferences:write`, `oikos:read`, `oikos:write`, …).

Web work:
- Replace `apps/web/src/lib/actions/oikos.action.ts`, `prayer*` (inline), `grow.action.ts` (preferences + training parts), `members.action.ts` (pinnedItems part), `profile.action.ts` (preferences) with thin pass-throughs that call the person-mcp tools through the user's delegation token.
- Drop the corresponding tables from `apps/web/src/db/schema.ts`.
- Update demo-seed scripts (`seed-multiply-data.ts` etc.) to populate person-mcp via tool calls instead of writing to web SQL.

**Done when:**
- All tools tested (Tester)
- `fresh-start.sh` reseeds a working demo (Test User)
- Hub home renders without errors using the new flow
- web SQL no longer contains `userPreferences`, `circles`, `prayers`, `trainingProgress`, `pinnedItems`, `messages`, `coachRelationships`

## Phase 2 — Org-MCP foundation

**Owner:** Developer (with IA review, Security review)
**Output:** org-mcp has the auth foundation and core tables.

This is the largest single piece of new construction. It ports the person-mcp auth foundation to org-mcp.

- [ ] Port `apps/person-mcp/src/auth/` → `apps/org-mcp/src/auth/` (delegation token verification, cross-principal delegation, JTI tracking)
- [ ] Add `org_accounts`, `org_token_usage`, `org_sessions`, `org_revocation_epochs`, `org_action_nonces`, `org_audit_log`
- [ ] Add `org_profiles`, `org_members`, `detached_members`
- [ ] First tools: `get_org_profile`, `update_org_profile`, `list_members`, `add_detached_member`, `list_detached_members`
- [ ] Public-projection writer: on `org_profiles` insert/update where visibility includes public fields, mirror to GraphDB

Web work:
- Replace org settings actions and member-list actions with org-mcp pass-throughs.
- Drop `detachedMembers` from web SQL.

**Done when:** Org settings page works against org-mcp; org profile public fields appear in GraphDB.

## Phase 3 — Org business data

**Owner:** Developer (with IA review)
**Output:** revenue, proposals, activity logs, beliefs, notifications all in org-mcp.

- [ ] `revenue_reports` → `submit_revenue_report`, `approve_revenue_report`, `reject_revenue_report`, `list_revenue_reports`
- [ ] `proposals` → `create_proposal`, `list_proposals` (on-chain `propose`/`vote` calls remain on the web side via SDK; org-mcp stores the cache)
- [ ] `activity_log_entries` → `log_activity`, `list_activities`
- [ ] `beliefs` → `list_beliefs`, `upsert_belief`, `delete_belief`
- [ ] `notifications` → `list_notifications`, `mark_notification_read`, `create_notification` (system-delegation only)

Web work:
- `revenue.action.ts`, `governance.action.ts`, `activity.action.ts` become pass-throughs.
- Drop `revenueReports`, `proposals`, `activityLogs` from web SQL.

**Done when:** Treasury, Steward, and Activities pages all render against org-mcp.

## Phase 4 — Owner-routed intents/needs/offerings/outcomes

**Owner:** Developer + IA + Ontologist
**Output:** intents and projections live in owner's MCP; public projections in GraphDB; Discover reads from GraphDB.

This is the trickiest phase because the current `intents` table is a cross-owner mix.

- [ ] Add `intents`, `needs`, `offerings`, `outcomes`, `orchestration_plans` to **both** person-mcp and org-mcp (same shape; `principal` column scoped per store)
- [ ] Tools (each MCP): `express_intent`, `withdraw_intent`, `list_intents`, `get_intent`
- [ ] Public-projection writer: on `visibility ∈ {public, public-coarse}`, mirror to `https://smartagent.io/graph/data/projections`
- [ ] Discover UI rewires to GraphDB SPARQL only (no web SQL `needs`/`resourceOfferings`)
- [ ] Match acceptance: `acceptMatch` flow becomes web → on-chain mint → both sides' MCP listeners initialize side-state

Web work:
- `intents.action.ts`, `needs.action.ts`, `discover.action.ts` become routers: pick the owner's MCP based on the expressing agent.
- Drop `intents`, `needs`, `resourceOfferings`, `needResourceMatches`, `outcomes`, `orchestrationPlans`, `beliefs` from web SQL.

**Done when:** Discover finds public intents from both person and org sources via GraphDB. Personal intents not visible without delegation.

## Phase 5 — Engagement decomposition

**Owner:** Developer + IA + Reviewer
**Output:** entitlements/sessions/tranches/policies/work-items/role-assignments live as on-chain backbone + per-side MCP state. Web SQL drops the entire engagement cluster.

- [ ] Build the on-chain event listeners (one per MCP) that initialize side-state on `EngagementMinted` / `EngagementClosed` / `WorkItemCreated`
- [ ] person-mcp: `engagement_holder_state`, `work_items` (assignee=person)
- [ ] org-mcp: `engagement_provider_state`, `engagement_sessions`, `engagement_tranches`, `engagement_policies`, `policy_signers`, `work_items` (assignee=org)
- [ ] Each side exposes: `list_my_entitlements`, `get_engagement_state`, `list_work_items`, `resolve_work_item`, `record_session`, `release_tranche` (where applicable)
- [ ] GraphDB engagement projection updated by on-chain listener (existing sync.ts pattern)

Web work:
- `entitlements.action.ts`, `sessions.action.ts` become routers (read on-chain + each side's MCP).
- Drop `entitlements`, `fulfillmentWorkItems`, `commitmentThreadEntries`, `roleAssignments`, `engagementSessions`, `engagementTranches`, `engagementPolicies`, `policySigners` from web SQL.

**Done when:** A complete engagement (match → entitlement → activities → close) flows through on-chain + MCPs only, with no web SQL writes for engagement state.

## Phase 6 — Trust deposits cleanup

**Owner:** Developer + Ontologist
**Output:** trust deposits live on-chain + GraphDB aggregates. Web SQL drops the deposit tables.

- [ ] On-chain listener materializes `atl:ValidationAssertionSummary` and `atl:FeedbackAssertionSummary` aggregates into GraphDB
- [ ] Web reputation reads switch to GraphDB SPARQL
- [ ] Drop `agentReviewRecords`, `agentSkillClaims`, `agentAssertions`, `agentValidationProfiles` from web SQL

**Done when:** Reviews UI and trust-graph rendering all read from GraphDB; web SQL has no deposit tables.

## Final cleanup

- [ ] `apps/web/src/db/schema.ts` shrunk to: auth/session, recovery, invites, training catalog, hub vocabulary, on-chain caches, optional discover read cache. Nothing else.
- [ ] `scripts/fresh-start.sh` `WIPE_PATHS` reflects new MCP DB locations
- [ ] `scripts/fresh-start.sh` `seed_after_deploy()` calls each MCP's seeder
- [ ] All demo seed scripts under `apps/web/src/lib/demo-seed/` rewritten to call MCP tools (or moved to per-MCP seeder modules)
- [ ] `docs/architecture/information-architecture.md` updated to point at this folder for the cross-layer view

## Sequencing notes

- Phases 1–3 can mostly happen in parallel after Phase 0 (different table groups, different web action files).
- Phase 4 must wait for Phase 1 (person-mcp foundation) and Phase 2 (org-mcp foundation).
- Phase 5 must wait for Phase 4 (intents are inputs to engagements).
- Phase 6 can start any time after Phase 0 and run in parallel with Phases 1–5.

## Cutover

Because there is no backwards-compatibility constraint:

1. Land each phase to a feature branch.
2. Merge phases serially (or in parallel where the dependency graph allows).
3. Each merge runs `fresh-start.sh` automatically as part of CI smoke (recommend this).
4. After all phases land, the demo state is rebuilt cleanly from on-chain + seed scripts. There is no migration of existing data — fresh-start *is* the migration.

## Risks

- **Auth scaffolding bottleneck.** Phase 2 ports the person-mcp delegation flow to org-mcp. Until that lands, Phases 3+ are blocked. Mitigation: do the port early; Security pre-reviews the scope catalog so it doesn't block at PR time.
- **Public projection drift.** GraphDB projections can lag MCP writes. Mitigation: every MCP write that should mirror records `graphdbMirroredAt`; a periodic verifier compares MCP rows against GraphDB and reports drift.
- **On-chain event listener reliability.** Engagement decomposition depends on each MCP receiving on-chain events. Mitigation: idempotent event handlers; periodic reconciliation against on-chain state on MCP startup.
- **Seed script churn.** Many seed scripts will need rewriting. Mitigation: do this in Phase 0 — rewrite seeds against the new tool surfaces *before* code that uses them lands, so each phase's smoke test exercises the seeds.
