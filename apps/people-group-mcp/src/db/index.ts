import Database, { type Database as DatabaseType } from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.js'
import { config } from '../config.js'

const sqliteHandle: DatabaseType = new Database(config.privateStorePath)
sqliteHandle.pragma('journal_mode = WAL')

// Schema bootstrap. Mirrors person-mcp / org-mcp pattern: CREATE TABLE
// IF NOT EXISTS DDL for clean cold-starts. The drizzle types in schema.ts
// stay aligned with these statements.
sqliteHandle.exec(`
  -- ─── PUBLIC REGISTRY (T0) ──────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS classification_schemes (
    id TEXT PRIMARY KEY,
    atl_iri TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    description TEXT,
    source_dataset_iri TEXT,
    version TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS people_group_concepts (
    id TEXT PRIMARY KEY,
    atl_iri TEXT NOT NULL UNIQUE,
    scheme_id TEXT,
    joshua_project_id TEXT,
    pref_label TEXT NOT NULL,
    alt_labels_json TEXT,
    primary_language_iri TEXT,
    religious_affinity_iri TEXT,
    affinity_group_iri TEXT,
    people_cluster_iri TEXT,
    parent_concept_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_pgc_concepts_jp ON people_group_concepts(joshua_project_id);

  CREATE TABLE IF NOT EXISTS scope_types (
    id TEXT PRIMARY KEY,
    atl_iri TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    description TEXT
  );

  CREATE TABLE IF NOT EXISTS people_group_collectives (
    id TEXT PRIMARY KEY,
    atl_iri TEXT NOT NULL UNIQUE,
    concept_id TEXT NOT NULL,
    temporal_scope TEXT,
    label TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_collectives_concept ON people_group_collectives(concept_id);

  CREATE TABLE IF NOT EXISTS pg_classifications (
    id TEXT PRIMARY KEY,
    atl_iri TEXT NOT NULL UNIQUE,
    tier TEXT NOT NULL CHECK (tier IN ('T0','T2')),
    principal TEXT,
    scheme_id TEXT NOT NULL,
    concept_id TEXT NOT NULL,
    classified_entity_iri TEXT NOT NULL,
    classified_entity_tier TEXT NOT NULL,
    classification_method TEXT,
    confidence_score REAL,
    valid_during TEXT,
    source_record_iri TEXT,
    generated_by_activity_iri TEXT,
    recorded_at TEXT NOT NULL,
    CHECK ((tier='T0' AND principal IS NULL) OR (tier='T2' AND principal IS NOT NULL))
  );
  CREATE INDEX IF NOT EXISTS idx_pgc_principal ON pg_classifications(principal) WHERE principal IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_pgc_classified ON pg_classifications(classified_entity_iri);

  CREATE TABLE IF NOT EXISTS external_records (
    iri TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    kind TEXT NOT NULL,
    notes TEXT
  );

  -- ─── SPONSOR-OWNED (T1 + T2) ────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS population_segments (
    id TEXT PRIMARY KEY,
    atl_iri TEXT NOT NULL,
    principal TEXT NOT NULL,
    concept_id TEXT NOT NULL,
    collective_id TEXT,
    scope_type_id TEXT NOT NULL,
    spatial_feature_id TEXT,
    parent_segment_id TEXT,
    display_name TEXT,
    is_diaspora INTEGER NOT NULL DEFAULT 0,
    homeland_feature_id TEXT,
    host_feature_id TEXT,
    religious_identity_iri TEXT,
    primary_language_iri TEXT,
    caste_clan_tribe_identity_iri TEXT,
    within_church_principal TEXT,
    within_network_principal TEXT,
    within_denomination_iri TEXT,
    within_engagement_id TEXT,
    visibility TEXT NOT NULL,
    on_chain_assertion_id TEXT,
    geo_verified_at TEXT,
    temporal_scope TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (principal, atl_iri),
    CHECK (visibility IN ('public','sponsor-private'))
  );
  CREATE INDEX IF NOT EXISTS idx_segments_principal ON population_segments(principal);
  CREATE INDEX IF NOT EXISTS idx_segments_concept ON population_segments(concept_id);
  CREATE INDEX IF NOT EXISTS idx_segments_visibility ON population_segments(visibility);

  -- ADR-PG-1: pg_communities is Tier-2-Sensitive.
  -- display_name, cohesion_basis, location_hint are ciphertext.
  CREATE TABLE IF NOT EXISTS pg_communities (
    id TEXT PRIMARY KEY,
    atl_iri TEXT NOT NULL,
    principal TEXT NOT NULL,
    concept_id TEXT NOT NULL,
    segment_id TEXT NOT NULL,
    display_name_ct BLOB NOT NULL,
    cohesion_basis_ct BLOB,
    location_hint_ct BLOB,
    enc_dek BLOB NOT NULL,
    enc_iv BLOB NOT NULL,
    is_agentive INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (principal, atl_iri)
  );
  CREATE INDEX IF NOT EXISTS idx_communities_principal ON pg_communities(principal);
  CREATE INDEX IF NOT EXISTS idx_communities_segment ON pg_communities(segment_id);

  CREATE TABLE IF NOT EXISTS pg_community_tombstones (
    community_atl_iri TEXT PRIMARY KEY,
    principal TEXT NOT NULL,
    deleted_at TEXT NOT NULL,
    deletion_reason TEXT
  );

  CREATE TABLE IF NOT EXISTS population_estimates (
    id TEXT PRIMARY KEY,
    atl_iri TEXT NOT NULL,
    principal TEXT NOT NULL,
    segment_id TEXT NOT NULL,
    population_count INTEGER,
    percent_christian REAL,
    percent_evangelical REAL,
    primary_language_iri TEXT,
    household_count INTEGER,
    leaders_identified INTEGER,
    estimate_method TEXT,
    confidence_score REAL,
    source_record_iri TEXT,
    generated_by_activity_iri TEXT,
    recorded_at TEXT NOT NULL,
    UNIQUE (principal, atl_iri)
  );
  CREATE INDEX IF NOT EXISTS idx_estimates_principal ON population_estimates(principal);
  CREATE INDEX IF NOT EXISTS idx_estimates_segment ON population_estimates(segment_id);

  CREATE TABLE IF NOT EXISTS reachedness_assessments (
    id TEXT PRIMARY KEY,
    atl_iri TEXT NOT NULL,
    principal TEXT NOT NULL,
    segment_id TEXT NOT NULL,
    reachedness_status_iri TEXT,
    engagement_status_iri TEXT,
    percent_evangelical REAL,
    criteria_iri TEXT,
    confidence_score REAL,
    source_record_iri TEXT,
    generated_by_activity_iri TEXT,
    recorded_at TEXT NOT NULL,
    UNIQUE (principal, atl_iri)
  );
  CREATE INDEX IF NOT EXISTS idx_reachedness_principal ON reachedness_assessments(principal);
  CREATE INDEX IF NOT EXISTS idx_reachedness_segment ON reachedness_assessments(segment_id);

  CREATE TABLE IF NOT EXISTS pg_geometries (
    id TEXT PRIMARY KEY,
    atl_iri TEXT NOT NULL,
    principal TEXT NOT NULL,
    segment_id TEXT NOT NULL,
    wkt_geometry TEXT,
    geometry_method TEXT,
    confidence_score REAL,
    source_record_iri TEXT,
    generated_by_activity_iri TEXT,
    visibility TEXT NOT NULL DEFAULT 'sponsor-private',
    created_at TEXT NOT NULL,
    UNIQUE (principal, atl_iri)
  );
  CREATE INDEX IF NOT EXISTS idx_geometries_principal ON pg_geometries(principal);

  -- ─── AUDIT + REVOCATION ─────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS pg_audit_log (
    id TEXT PRIMARY KEY,
    principal TEXT NOT NULL,
    accessing_agent TEXT NOT NULL,
    via TEXT NOT NULL,
    delegation_hash TEXT,
    tool TEXT NOT NULL,
    args_hash TEXT NOT NULL,
    result_summary TEXT NOT NULL,
    at TEXT NOT NULL,
    archived_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_audit_principal ON pg_audit_log(principal);
  CREATE INDEX IF NOT EXISTS idx_audit_accessing ON pg_audit_log(accessing_agent);
  CREATE INDEX IF NOT EXISTS idx_audit_at ON pg_audit_log(at);
  CREATE INDEX IF NOT EXISTS idx_audit_archived ON pg_audit_log(archived_at) WHERE archived_at IS NULL;

  CREATE TABLE IF NOT EXISTS revocation_epochs (
    principal TEXT PRIMARY KEY,
    current_epoch INTEGER NOT NULL DEFAULT 1,
    bumped_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS jti_usage (
    jti TEXT PRIMARY KEY,
    principal TEXT NOT NULL,
    delegation_hash TEXT NOT NULL,
    used_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_jti_expires ON jti_usage(expires_at);
`)

export const sqlite: DatabaseType = sqliteHandle
export const db = drizzle(sqliteHandle, { schema })
