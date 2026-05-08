import Database, { type Database as DatabaseType } from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.js'

const DB_PATH = process.env.ORG_MCP_DB_PATH ?? 'org-mcp.db'

const sqliteHandle: DatabaseType = new Database(DB_PATH)
sqliteHandle.pragma('journal_mode = WAL')

// Schema bootstrap. Mirrors apps/person-mcp/src/db/index.ts pattern.
sqliteHandle.exec(`
  -- ─── Auth foundation ─────────────────────────────────────────────────
  -- org_accounts removed: agent records canonical on-chain.

  CREATE TABLE IF NOT EXISTS org_token_usage (
    jti TEXT PRIMARY KEY,
    org_principal TEXT NOT NULL,
    usage_count INTEGER NOT NULL DEFAULT 1,
    usage_limit INTEGER NOT NULL,
    first_used_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_org_token_usage_principal ON org_token_usage(org_principal);

  -- ─── Org core ───────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS org_profiles_private (
    org_principal TEXT PRIMARY KEY,
    internal_contact_email TEXT,
    internal_contact_phone TEXT,
    financial_contacts TEXT,
    internal_notes TEXT,
    updated_at TEXT NOT NULL
  );

  -- org_members removed: canonical on-chain via AgentRelationship edges.

  CREATE TABLE IF NOT EXISTS detached_members (
    id TEXT PRIMARY KEY,
    org_principal TEXT NOT NULL,
    display_name TEXT NOT NULL,
    contact_info_encrypted TEXT,
    tracked_since TEXT,
    notes TEXT,
    assigned_node_id TEXT,
    role TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_detached_org ON detached_members(org_principal);

  -- ─── Business data ──────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS revenue_reports (
    id TEXT PRIMARY KEY,
    org_principal TEXT NOT NULL,
    period TEXT NOT NULL,
    gross_revenue INTEGER,
    expenses INTEGER,
    net_revenue INTEGER,
    share_payment INTEGER,
    currency TEXT NOT NULL DEFAULT 'XOF',
    notes TEXT,
    evidence_uri TEXT,
    status TEXT NOT NULL DEFAULT 'submitted',
    submitted_by TEXT,
    submitted_at TEXT NOT NULL,
    verified_by TEXT,
    verified_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_revenue_org ON revenue_reports(org_principal);

  -- proposals removed: legacy, superseded by proposal_submissions.

  CREATE TABLE IF NOT EXISTS org_activity_log_entries (
    id TEXT PRIMARY KEY,
    org_principal TEXT NOT NULL,
    kind TEXT NOT NULL,
    performed_at TEXT NOT NULL,
    performed_by_agent TEXT,
    duration_min INTEGER,
    geo TEXT,
    participants TEXT,
    fulfills_entitlement_id TEXT,
    fulfills_need_id TEXT,
    fulfills_intent_id TEXT,
    payload TEXT,
    evidence_uri TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_org_activity_org ON org_activity_log_entries(org_principal);
  CREATE INDEX IF NOT EXISTS idx_org_activity_entitlement ON org_activity_log_entries(fulfills_entitlement_id);

  CREATE TABLE IF NOT EXISTS org_intents (
    id TEXT PRIMARY KEY,
    org_principal TEXT NOT NULL,
    direction TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'private',
    kind TEXT NOT NULL,
    addressed_to TEXT,
    summary TEXT NOT NULL,
    context TEXT,
    status TEXT NOT NULL DEFAULT 'expressed',
    priority TEXT,
    expires_at TEXT,
    on_chain_assertion_id TEXT,
    live_acknowledgement_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_org_intents_org ON org_intents(org_principal);

  CREATE TABLE IF NOT EXISTS org_needs (
    id TEXT PRIMARY KEY,
    org_principal TEXT NOT NULL,
    intent_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    requirements TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    visibility TEXT NOT NULL DEFAULT 'private',
    geo TEXT,
    capacity_needed INTEGER,
    on_chain_assertion_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_org_needs_org ON org_needs(org_principal);

  CREATE TABLE IF NOT EXISTS org_offerings (
    id TEXT PRIMARY KEY,
    org_principal TEXT NOT NULL,
    intent_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    capabilities TEXT,
    capacity INTEGER,
    visibility TEXT NOT NULL DEFAULT 'private',
    geo TEXT,
    time_window TEXT,
    on_chain_assertion_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_org_offerings_org ON org_offerings(org_principal);

  CREATE TABLE IF NOT EXISTS org_outcomes (
    id TEXT PRIMARY KEY,
    org_principal TEXT NOT NULL,
    intent_id TEXT NOT NULL,
    metric TEXT NOT NULL,
    target TEXT,
    achieved INTEGER NOT NULL DEFAULT 0,
    achieved_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_org_outcomes_org ON org_outcomes(org_principal);

  -- orchestration_plans removed: defined but never used.

  CREATE TABLE IF NOT EXISTS org_work_items (
    id TEXT PRIMARY KEY,
    org_principal TEXT NOT NULL,
    entitlement_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    due_at TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    resolved_at TEXT,
    resolved_by_activity_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_org_workitems_org ON org_work_items(org_principal);

  CREATE TABLE IF NOT EXISTS org_notifications (
    id TEXT PRIMARY KEY,
    org_principal TEXT NOT NULL,
    kind TEXT NOT NULL,
    payload TEXT,
    read_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_org_notif_org ON org_notifications(org_principal);

  CREATE TABLE IF NOT EXISTS org_beliefs (
    id TEXT PRIMARY KEY,
    org_principal TEXT NOT NULL,
    statement TEXT NOT NULL,
    tags TEXT,
    informs_intent_id TEXT,
    visibility TEXT NOT NULL DEFAULT 'private',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_org_beliefs_org ON org_beliefs(org_principal);

  CREATE TABLE IF NOT EXISTS org_cross_delegation_grants (
    id TEXT PRIMARY KEY,
    org_principal TEXT NOT NULL,
    grantee_agent TEXT NOT NULL,
    scope TEXT NOT NULL,
    valid_from TEXT,
    valid_until TEXT,
    caveat_terms TEXT,
    created_at TEXT NOT NULL,
    revoked_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_org_cdg_org ON org_cross_delegation_grants(org_principal);

  -- ─── Spec 003: Intent Marketplace — Proposal Lane ──────────────────
  -- GrantProposal body (sa:GrantProposal). Always private; never anchored
  -- on chain in v1. SHACL sa:GrantProposalAlwaysPrivateShape enforces.
  CREATE TABLE IF NOT EXISTS proposal_submissions (
    id TEXT PRIMARY KEY,
    principal TEXT NOT NULL,
    round_id TEXT,
    fund_mandate_id TEXT,
    based_on_intent_id TEXT NOT NULL,
    budget TEXT NOT NULL,
    plan TEXT NOT NULL,
    milestones TEXT NOT NULL,
    desired_outcomes TEXT NOT NULL,
    reporting_obligations TEXT NOT NULL,
    organisational_background TEXT NOT NULL,
    submitted_at TEXT,
    version INTEGER NOT NULL DEFAULT 0,
    last_edited_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft',
    withdrawn_at TEXT,
    cloned_from_proposal_id TEXT,
    basis TEXT,
    visibility TEXT NOT NULL DEFAULT 'private',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_proposal_submissions_principal ON proposal_submissions(principal);
  CREATE INDEX IF NOT EXISTS idx_proposal_submissions_round ON proposal_submissions(round_id);
  CREATE INDEX IF NOT EXISTS idx_proposal_submissions_status ON proposal_submissions(status);

  -- Round body lives on chain in FundRegistry; mirrored to GraphDB by sync.
  -- This slim table holds only the off-chain DAO voting config keyed by round id.
  CREATE TABLE IF NOT EXISTS rounds (
    id TEXT PRIMARY KEY,
    voting_strategy TEXT NOT NULL DEFAULT 'steward-quorum',
    voting_threshold INTEGER NOT NULL DEFAULT 2,
    voting_window_starts_at TEXT,
    voting_window_ends_at TEXT,
    eligible_voters TEXT NOT NULL DEFAULT '{"kind":"stewards"}',
    updated_at TEXT NOT NULL
  );

  -- Disbursements (Sprint C) — off-chain ledger for the funding stage.
  -- Real USDC custody in Treasury Phase 3 (deferred); this mirrors what
  -- would otherwise happen on chain so the demo flow shows claim → paid.
  CREATE TABLE IF NOT EXISTS disbursements (
    id TEXT PRIMARY KEY,
    proposal_id TEXT NOT NULL,
    round_id TEXT NOT NULL,
    tranche_label TEXT NOT NULL,
    amount INTEGER NOT NULL,
    unit TEXT NOT NULL DEFAULT 'USD',
    recipient_agent_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','claimed','paid','revoked')),
    claimed_at TEXT,
    paid_at TEXT,
    tx_hash TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_disbursements_proposal ON disbursements(proposal_id);
  CREATE INDEX IF NOT EXISTS idx_disbursements_round ON disbursements(round_id);
  CREATE INDEX IF NOT EXISTS idx_disbursements_recipient ON disbursements(recipient_agent_id);

  -- Outcome attestations (Sprint C) — validators record milestone delivery.
  -- Multiple per milestone allowed; dispute resolution rules apply server-side.
  CREATE TABLE IF NOT EXISTS outcome_attestations (
    id TEXT PRIMARY KEY,
    proposal_id TEXT NOT NULL,
    milestone_label TEXT NOT NULL,
    validator_agent_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('delivered','partial','disputed','overdue')),
    evidence TEXT,
    attested_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_attest_proposal ON outcome_attestations(proposal_id);

  -- DAO voting (Sprint A). Per output/voting-and-admin-plan.md.
  CREATE TABLE IF NOT EXISTS proposal_votes (
    id TEXT PRIMARY KEY,
    round_id TEXT NOT NULL,
    proposal_id TEXT NOT NULL,
    voter_agent_id TEXT NOT NULL,
    vote TEXT NOT NULL CHECK (vote IN ('approve', 'reject', 'abstain')),
    weight INTEGER NOT NULL DEFAULT 1,
    rationale TEXT,
    signature TEXT,
    cast_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (round_id, proposal_id, voter_agent_id)
  );
  CREATE INDEX IF NOT EXISTS idx_votes_round ON proposal_votes(round_id);
  CREATE INDEX IF NOT EXISTS idx_votes_proposal ON proposal_votes(proposal_id);
  CREATE INDEX IF NOT EXISTS idx_votes_voter ON proposal_votes(voter_agent_id);

  -- ─── Spec 001: Intent Marketplace — Direct Lane ─────────────────────
  -- match_initiations — body of sa:MatchInitiation (initiator-owned, IA § 2.1).
  -- principal = initiatorAgentId. status starts 'pending'; visibility cascades
  -- from the two source intents (strictest wins). Public/public-coarse rows
  -- anchor sa:MatchInitiationAssertion on chain (set onChainAssertionId).
  CREATE TABLE IF NOT EXISTS match_initiations (
    id TEXT PRIMARY KEY,
    principal TEXT NOT NULL,
    viewed_intent_id TEXT NOT NULL,
    candidate_intent_id TEXT NOT NULL,
    initiator_agent_id TEXT NOT NULL,
    initiation_kind TEXT NOT NULL,
    proposed_at TEXT NOT NULL,
    basis TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    visibility TEXT NOT NULL DEFAULT 'private',
    on_chain_assertion_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_match_initiations_principal ON match_initiations(principal);
  CREATE INDEX IF NOT EXISTS idx_match_initiations_pair ON match_initiations(viewed_intent_id, candidate_intent_id);
  CREATE INDEX IF NOT EXISTS idx_match_initiations_status ON match_initiations(status);
  CREATE INDEX IF NOT EXISTS idx_match_initiations_viewed ON match_initiations(viewed_intent_id);
  CREATE INDEX IF NOT EXISTS idx_match_initiations_candidate ON match_initiations(candidate_intent_id);

  -- pools table removed: pool body lives on-chain in PoolRegistry; counters
  -- are derived from pool_pledges sums at read time.

  -- pool_pledges — org-mcp twin of person-mcp's pool_pledges. principal =
  -- pledgerAgentId. SHACL invariants on storyPermissions / visibility.
  CREATE TABLE IF NOT EXISTS pool_pledges (
    id TEXT PRIMARY KEY,
    principal TEXT NOT NULL,
    pool_agent_id TEXT NOT NULL,
    cadence TEXT NOT NULL,
    unit TEXT NOT NULL,
    amount INTEGER NOT NULL,
    duration INTEGER,
    restrictions TEXT,
    story_permissions TEXT NOT NULL,
    pledged_at TEXT NOT NULL,
    stopped_at TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    history TEXT NOT NULL DEFAULT '[]',
    visibility TEXT NOT NULL DEFAULT 'private',
    on_chain_assertion_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_pool_pledges_principal ON pool_pledges(principal);
  CREATE INDEX IF NOT EXISTS idx_pool_pledges_pool ON pool_pledges(pool_agent_id);
  CREATE INDEX IF NOT EXISTS idx_pool_pledges_status ON pool_pledges(status);

  -- ─── Engagement provider-side state ─────────────────────────────────
  CREATE TABLE IF NOT EXISTS engagement_provider_state (
    entitlement_id TEXT PRIMARY KEY,
    org_principal TEXT NOT NULL,
    capacity_remaining INTEGER,
    provider_notes TEXT,
    internal_assignee TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_provider_state_org ON engagement_provider_state(org_principal);

  CREATE TABLE IF NOT EXISTS engagement_sessions (
    id TEXT PRIMARY KEY,
    entitlement_id TEXT NOT NULL,
    org_principal TEXT NOT NULL,
    scheduled_at TEXT,
    occurred_at TEXT,
    status TEXT NOT NULL DEFAULT 'scheduled',
    notes TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_entitlement ON engagement_sessions(entitlement_id);

  CREATE TABLE IF NOT EXISTS engagement_tranches (
    id TEXT PRIMARY KEY,
    entitlement_id TEXT NOT NULL,
    org_principal TEXT NOT NULL,
    scheduled_at TEXT,
    amount_cents INTEGER,
    currency TEXT NOT NULL DEFAULT 'XOF',
    status TEXT NOT NULL DEFAULT 'pending',
    released_at TEXT,
    gated_on_report_id TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_tranches_entitlement ON engagement_tranches(entitlement_id);

  CREATE TABLE IF NOT EXISTS engagement_policies (
    id TEXT PRIMARY KEY,
    entitlement_id TEXT NOT NULL,
    org_principal TEXT NOT NULL,
    policy_type TEXT NOT NULL,
    document_uri TEXT,
    version TEXT,
    signatures_required INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS policy_signers (
    id TEXT PRIMARY KEY,
    policy_id TEXT NOT NULL,
    signer_agent TEXT NOT NULL,
    role TEXT,
    signed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_policy_signers_policy ON policy_signers(policy_id);
`)

export const sqlite: DatabaseType = sqliteHandle
export const db = drizzle(sqliteHandle, { schema })
