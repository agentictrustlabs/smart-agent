import Database, { type Database as DatabaseType } from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.js'

const DB_PATH = process.env.ORG_MCP_DB_PATH ?? 'org-mcp.db'

const sqliteHandle: DatabaseType = new Database(DB_PATH)
sqliteHandle.pragma('journal_mode = WAL')

// Schema bootstrap. Mirrors apps/person-mcp/src/db/index.ts pattern.
sqliteHandle.exec(`
  -- ─── Auth foundation ─────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS org_accounts (
    org_principal TEXT PRIMARY KEY,
    account_address TEXT NOT NULL UNIQUE,
    chain_id INTEGER NOT NULL,
    label TEXT,
    created_at TEXT NOT NULL
  );

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

  CREATE TABLE IF NOT EXISTS org_members (
    id TEXT PRIMARY KEY,
    org_principal TEXT NOT NULL,
    member_agent TEXT NOT NULL,
    role TEXT,
    joined_at TEXT,
    left_at TEXT,
    edge_id TEXT,
    internal_notes TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_org_members_org ON org_members(org_principal);
  CREATE INDEX IF NOT EXISTS idx_org_members_agent ON org_members(member_agent);

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

  CREATE TABLE IF NOT EXISTS proposals (
    id TEXT PRIMARY KEY,
    org_principal TEXT NOT NULL,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    proposer_agent TEXT,
    target_address TEXT,
    quorum_required INTEGER NOT NULL DEFAULT 2,
    votes_for INTEGER NOT NULL DEFAULT 0,
    votes_against INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'open',
    on_chain_proposal_id TEXT,
    executed_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_proposals_org ON proposals(org_principal);

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

  CREATE TABLE IF NOT EXISTS orchestration_plans (
    id TEXT PRIMARY KEY,
    org_principal TEXT NOT NULL,
    parent_intent_id TEXT NOT NULL,
    sub_intents TEXT,
    dependencies TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_orchestration_org ON orchestration_plans(org_principal);

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

  -- Round body in the fund's org-mcp tenant (org_principal = fundAgentId).
  -- Mandate / template / counters / addressed-applicants list per IA § 2.4.
  CREATE TABLE IF NOT EXISTS rounds (
    id TEXT PRIMARY KEY,
    org_principal TEXT NOT NULL,
    mandate TEXT NOT NULL,
    milestone_template TEXT NOT NULL,
    validator_requirements TEXT NOT NULL,
    reporting_cadence TEXT NOT NULL,
    deadline TEXT NOT NULL,
    decision_date TEXT NOT NULL,
    required_credentials TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'public',
    addressed_applicants TEXT,
    proposals_received INTEGER NOT NULL DEFAULT 0,
    on_chain_assertion_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_rounds_org ON rounds(org_principal);
  CREATE INDEX IF NOT EXISTS idx_rounds_visibility ON rounds(visibility);

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
