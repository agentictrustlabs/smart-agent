import Database, { type Database as DatabaseType } from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.js'

const DB_PATH = process.env.PERSON_MCP_DB_PATH ?? 'person-mcp.db'

const sqliteHandle: DatabaseType = new Database(DB_PATH)

// Enable WAL mode for better concurrent read performance
sqliteHandle.pragma('journal_mode = WAL')

// Schema bootstrap — single source of truth for both the drizzle-typed tables
// (PII, profile, chat, accounts) and the absorbed ssi-wallet tables
// (holder_wallets, credential_metadata, action_nonces, trust_overlap_audit).
//
// The trust-overlap audit got renamed from ssi_proof_audit because the
// presentation-audit table (legacy from when ssi-wallet-mcp + person-mcp ran
// as two services) already owned that name with a different column shape.
sqliteHandle.exec(`
  -- ─── Person identity / profile ──────────────────────────────────────
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    principal TEXT NOT NULL,
    account_address TEXT NOT NULL UNIQUE,
    chain_id INTEGER NOT NULL,
    label TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS external_identities (
    id TEXT PRIMARY KEY,
    principal TEXT NOT NULL,
    provider TEXT NOT NULL,
    identifier TEXT NOT NULL,
    verified INTEGER NOT NULL DEFAULT 0,
    metadata TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    principal TEXT NOT NULL UNIQUE,
    display_name TEXT,
    bio TEXT,
    avatar_url TEXT,
    email TEXT,
    phone TEXT,
    date_of_birth TEXT,
    gender TEXT,
    language TEXT,
    address_line1 TEXT,
    address_line2 TEXT,
    city TEXT,
    state_province TEXT,
    postal_code TEXT,
    country TEXT,
    location TEXT,
    preferences TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chat_threads (
    id TEXT PRIMARY KEY,
    principal TEXT NOT NULL,
    title TEXT,
    metadata TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES chat_threads(id),
    principal TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_accounts_principal ON accounts(principal);
  CREATE INDEX IF NOT EXISTS idx_external_identities_principal ON external_identities(principal);

  CREATE TABLE IF NOT EXISTS token_usage (
    jti TEXT PRIMARY KEY,
    principal TEXT NOT NULL,
    usage_count INTEGER NOT NULL DEFAULT 1,
    usage_limit INTEGER NOT NULL,
    first_used_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_profiles_principal ON profiles(principal);
  CREATE INDEX IF NOT EXISTS idx_token_usage_principal ON token_usage(principal);
  CREATE INDEX IF NOT EXISTS idx_chat_threads_principal ON chat_threads(principal);
  CREATE INDEX IF NOT EXISTS idx_chat_messages_thread_id ON chat_messages(thread_id);
  CREATE INDEX IF NOT EXISTS idx_chat_messages_principal ON chat_messages(principal);

  -- ─── ssi-wallet (canonical, was a separate process) ──────────────────
  CREATE TABLE IF NOT EXISTS holder_wallets (
    id TEXT PRIMARY KEY,
    person_principal TEXT NOT NULL,
    wallet_context TEXT NOT NULL,
    signer_eoa TEXT NOT NULL,
    askar_profile TEXT NOT NULL,
    link_secret_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    UNIQUE (person_principal, wallet_context)
  );
  CREATE INDEX IF NOT EXISTS idx_hw_principal ON holder_wallets(person_principal);
  CREATE INDEX IF NOT EXISTS idx_hw_signer_eoa ON holder_wallets(signer_eoa);

  CREATE TABLE IF NOT EXISTS action_nonces (
    nonce TEXT PRIMARY KEY,
    action_type TEXT NOT NULL,
    holder_wallet_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_nonce_wallet ON action_nonces(holder_wallet_id);

  CREATE TABLE IF NOT EXISTS credential_metadata (
    id TEXT PRIMARY KEY,
    holder_wallet_id TEXT NOT NULL,
    issuer_id TEXT NOT NULL,
    schema_id TEXT NOT NULL,
    cred_def_id TEXT NOT NULL,
    credential_type TEXT NOT NULL,
    received_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    link_secret_id TEXT NOT NULL DEFAULT '',
    -- Target org's smart-account address (e.g. Red Feather Circle for an
    -- OrgMembership in that circle). The credential's issuer DID points at
    -- the org-mcp signing EOA, not at the org being joined; this column
    -- captures the *target* so the held-credentials view can label it.
    target_org_address TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_cm_wallet ON credential_metadata(holder_wallet_id);

  -- Trust-overlap audit (renamed from ssi_proof_audit to avoid collision
  -- with the legacy presentation-audit table below).
  CREATE TABLE IF NOT EXISTS trust_overlap_audit (
    id TEXT PRIMARY KEY,
    holder_wallet_id TEXT NOT NULL,
    principal TEXT NOT NULL,
    counterparty_id TEXT NOT NULL,
    policy_id TEXT NOT NULL,
    block_pin TEXT NOT NULL DEFAULT '0',
    public_set_commit TEXT NOT NULL,
    evidence_commit TEXT NOT NULL,
    score REAL NOT NULL,
    shared_count INTEGER NOT NULL,
    output_kind TEXT NOT NULL DEFAULT 'score-only',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_to_audit_principal ON trust_overlap_audit(principal);
  CREATE INDEX IF NOT EXISTS idx_to_audit_wallet    ON trust_overlap_audit(holder_wallet_id);

  -- Presentation audit (one row per /proofs/present call). Legacy name
  -- predates the trust-overlap audit; keeping both lets ssi_create_presentation
  -- and ssi_match_against_public_set track distinct events.
  CREATE TABLE IF NOT EXISTS ssi_proof_audit (
    id TEXT PRIMARY KEY,
    principal TEXT NOT NULL,
    wallet_context TEXT NOT NULL,
    holder_wallet_ref TEXT NOT NULL,
    verifier_id TEXT NOT NULL,
    purpose TEXT NOT NULL,
    revealed_attrs TEXT NOT NULL,
    predicates TEXT NOT NULL,
    action_nonce TEXT NOT NULL,
    pairwise_handle TEXT,
    holder_binding_included INTEGER NOT NULL DEFAULT 0,
    result TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ssi_audit_principal ON ssi_proof_audit(principal);

  -- ─── Person-domain app data (NEW: data store consolidation initiative) ──
  CREATE TABLE IF NOT EXISTS user_preferences (
    principal TEXT PRIMARY KEY,
    language TEXT,
    home_church TEXT,
    location TEXT,
    theme TEXT,
    notifications TEXT,
    extras TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS oikos_contacts (
    id TEXT PRIMARY KEY,
    principal TEXT NOT NULL,
    person_name TEXT NOT NULL,
    proximity TEXT,
    spiritual_response_state TEXT,
    last_contact_at TEXT,
    planned_conversation INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    tags TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_oikos_principal ON oikos_contacts(principal);

  CREATE TABLE IF NOT EXISTS prayers (
    id TEXT PRIMARY KEY,
    principal TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    schedule TEXT,
    response_state TEXT,
    linked_oikos_contact_id TEXT,
    tags TEXT,
    last_prayed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_prayers_principal ON prayers(principal);

  CREATE TABLE IF NOT EXISTS training_progress (
    id TEXT PRIMARY KEY,
    principal TEXT NOT NULL,
    module_key TEXT NOT NULL,
    program_key TEXT,
    track TEXT,
    status TEXT NOT NULL DEFAULT 'not-started',
    completed_at TEXT,
    hours_logged INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_training_principal ON training_progress(principal);
  CREATE UNIQUE INDEX IF NOT EXISTS uq_training_principal_module ON training_progress(principal, module_key);

  CREATE TABLE IF NOT EXISTS pinned_items (
    id TEXT PRIMARY KEY,
    principal TEXT NOT NULL,
    item_type TEXT NOT NULL,
    item_ref TEXT NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_pinned_principal ON pinned_items(principal);
  CREATE UNIQUE INDEX IF NOT EXISTS uq_pinned_principal_ref ON pinned_items(principal, item_ref);

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    principal TEXT NOT NULL,
    kind TEXT NOT NULL,
    payload TEXT,
    read_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_notif_principal ON notifications(principal);
  CREATE INDEX IF NOT EXISTS idx_notif_unread ON notifications(principal, read_at);

  CREATE TABLE IF NOT EXISTS beliefs (
    id TEXT PRIMARY KEY,
    principal TEXT NOT NULL,
    statement TEXT NOT NULL,
    tags TEXT,
    informs_intent_id TEXT,
    visibility TEXT NOT NULL DEFAULT 'private',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_beliefs_principal ON beliefs(principal);

  CREATE TABLE IF NOT EXISTS coaching_notes (
    id TEXT PRIMARY KEY,
    principal TEXT NOT NULL,
    subject_agent TEXT NOT NULL,
    content TEXT NOT NULL,
    shared_with_subject INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_coaching_principal ON coaching_notes(principal);
  CREATE INDEX IF NOT EXISTS idx_coaching_subject ON coaching_notes(subject_agent);

  CREATE TABLE IF NOT EXISTS cross_delegation_grants (
    id TEXT PRIMARY KEY,
    principal TEXT NOT NULL,
    grantee_agent TEXT NOT NULL,
    scope TEXT NOT NULL,
    valid_from TEXT,
    valid_until TEXT,
    caveat_terms TEXT,
    created_at TEXT NOT NULL,
    revoked_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_cdg_principal ON cross_delegation_grants(principal);
  CREATE INDEX IF NOT EXISTS idx_cdg_grantee  ON cross_delegation_grants(grantee_agent);

  -- Holder-side store for off-chain cross-delegations (private coaching, etc.)
  CREATE TABLE IF NOT EXISTS received_delegations (
    id TEXT PRIMARY KEY,
    holder_principal TEXT NOT NULL,
    delegator_principal TEXT NOT NULL,
    audience TEXT NOT NULL,
    kind TEXT NOT NULL,
    subject_label TEXT,
    delegation_json TEXT NOT NULL,
    delegation_hash TEXT NOT NULL,
    expires_at TEXT,
    created_at TEXT NOT NULL,
    revoked_at TEXT,
    UNIQUE (holder_principal, delegation_hash)
  );
  CREATE INDEX IF NOT EXISTS idx_recv_deleg_holder ON received_delegations(holder_principal);
  CREATE INDEX IF NOT EXISTS idx_recv_deleg_kind ON received_delegations(holder_principal, kind);

  CREATE TABLE IF NOT EXISTS intents (
    id TEXT PRIMARY KEY,
    principal TEXT NOT NULL,
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
  CREATE INDEX IF NOT EXISTS idx_intents_principal ON intents(principal);
  CREATE INDEX IF NOT EXISTS idx_intents_visibility ON intents(visibility);

  CREATE TABLE IF NOT EXISTS needs (
    id TEXT PRIMARY KEY,
    principal TEXT NOT NULL,
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
  CREATE INDEX IF NOT EXISTS idx_needs_principal ON needs(principal);
  CREATE INDEX IF NOT EXISTS idx_needs_intent ON needs(intent_id);

  CREATE TABLE IF NOT EXISTS offerings (
    id TEXT PRIMARY KEY,
    principal TEXT NOT NULL,
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
  CREATE INDEX IF NOT EXISTS idx_offerings_principal ON offerings(principal);
  CREATE INDEX IF NOT EXISTS idx_offerings_intent ON offerings(intent_id);

  CREATE TABLE IF NOT EXISTS outcomes (
    id TEXT PRIMARY KEY,
    principal TEXT NOT NULL,
    intent_id TEXT NOT NULL,
    metric TEXT NOT NULL,
    target TEXT,
    achieved INTEGER NOT NULL DEFAULT 0,
    achieved_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_outcomes_principal ON outcomes(principal);
  CREATE INDEX IF NOT EXISTS idx_outcomes_intent ON outcomes(intent_id);

  CREATE TABLE IF NOT EXISTS activity_log_entries (
    id TEXT PRIMARY KEY,
    principal TEXT NOT NULL,
    kind TEXT NOT NULL,
    performed_at TEXT NOT NULL,
    duration_min INTEGER,
    geo TEXT,
    witnesses TEXT,
    fulfills_entitlement_id TEXT,
    fulfills_need_id TEXT,
    fulfills_intent_id TEXT,
    payload TEXT,
    evidence_uri TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_activity_principal ON activity_log_entries(principal);
  CREATE INDEX IF NOT EXISTS idx_activity_entitlement ON activity_log_entries(fulfills_entitlement_id);

  CREATE TABLE IF NOT EXISTS work_items (
    id TEXT PRIMARY KEY,
    principal TEXT NOT NULL,
    entitlement_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    due_at TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    resolved_at TEXT,
    resolved_by_activity_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_workitems_principal ON work_items(principal);
  CREATE INDEX IF NOT EXISTS idx_workitems_entitlement ON work_items(entitlement_id);

  -- ─── Spec 003: Intent Marketplace — Proposal Lane (solo human applicant) ──
  -- GrantProposal body. Always private; never on chain; never in GraphDB.
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

  -- ─── Spec 001: Intent Marketplace — Direct Lane ────────────────────────
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

  CREATE TABLE IF NOT EXISTS engagement_holder_state (
    entitlement_id TEXT PRIMARY KEY,
    principal TEXT NOT NULL,
    capacity_consumed INTEGER NOT NULL DEFAULT 0,
    holder_outcome_notes TEXT,
    last_activity_id TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_holder_state_principal ON engagement_holder_state(principal);

  -- ─── Spec 002: Intent Marketplace — Pool Lane ─────────────────────────
  -- pool_pledges — body of sa:PoolPledge (donor-owned, IA § 2.2).
  -- principal = pledgerAgentId. visibility cascades from pool visibility +
  -- donor's storyPermissions; public + non-anonymous rows anchor
  -- sa:PledgeAssertion on chain.
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
`)

/** Raw better-sqlite3 handle. Used by the absorbed ssi storage modules. */
export const sqlite: DatabaseType = sqliteHandle

/** Drizzle-typed wrapper. Used by person-mcp's profile/chat/account tools. */
export const db = drizzle(sqliteHandle, { schema })
