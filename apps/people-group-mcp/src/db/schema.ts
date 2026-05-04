import { sqliteTable, text, integer, real, blob, check } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

// =====================================================================
// PUBLIC REGISTRY (T0)
// =====================================================================

export const classificationSchemes = sqliteTable('classification_schemes', {
  id: text('id').primaryKey(),
  atlIri: text('atl_iri').notNull().unique(),
  label: text('label').notNull(),
  description: text('description'),
  sourceDatasetIri: text('source_dataset_iri'),
  version: text('version'),
  createdAt: text('created_at').notNull(),
})

export const peopleGroupConcepts = sqliteTable('people_group_concepts', {
  id: text('id').primaryKey(),
  atlIri: text('atl_iri').notNull().unique(),
  schemeId: text('scheme_id'),
  joshuaProjectId: text('joshua_project_id'),
  prefLabel: text('pref_label').notNull(),
  altLabelsJson: text('alt_labels_json'),
  primaryLanguageIri: text('primary_language_iri'),
  religiousAffinityIri: text('religious_affinity_iri'),
  affinityGroupIri: text('affinity_group_iri'),
  peopleClusterIri: text('people_cluster_iri'),
  parentConceptId: text('parent_concept_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const scopeTypes = sqliteTable('scope_types', {
  id: text('id').primaryKey(),
  atlIri: text('atl_iri').notNull().unique(),
  label: text('label').notNull(),
  description: text('description'),
})

export const peopleGroupCollectives = sqliteTable('people_group_collectives', {
  id: text('id').primaryKey(),
  atlIri: text('atl_iri').notNull().unique(),
  conceptId: text('concept_id').notNull(),
  temporalScope: text('temporal_scope'),
  label: text('label'),
  createdAt: text('created_at').notNull(),
})

// pg_classifications carries both T0 (public) and T2 (sponsor-private) rows.
// The CHECK constraint enforces that principal is set iff tier='T2'.
export const pgClassifications = sqliteTable('pg_classifications', {
  id: text('id').primaryKey(),
  atlIri: text('atl_iri').notNull().unique(),
  tier: text('tier').notNull(),                 // 'T0' | 'T2'
  principal: text('principal'),                 // NULL when T0
  schemeId: text('scheme_id').notNull(),
  conceptId: text('concept_id').notNull(),
  classifiedEntityIri: text('classified_entity_iri').notNull(),
  classifiedEntityTier: text('classified_entity_tier').notNull(),
  classificationMethod: text('classification_method'),
  confidenceScore: real('confidence_score'),
  validDuring: text('valid_during'),
  sourceRecordIri: text('source_record_iri'),
  generatedByActivityIri: text('generated_by_activity_iri'),
  recordedAt: text('recorded_at').notNull(),
}, (t) => ({
  tierPrincipalCheck: check('tier_principal_check',
    sql`(${t.tier} = 'T0' AND ${t.principal} IS NULL) OR (${t.tier} = 'T2' AND ${t.principal} IS NOT NULL)`),
}))

export const externalRecords = sqliteTable('external_records', {
  iri: text('iri').primaryKey(),
  label: text('label').notNull(),
  kind: text('kind').notNull(),                 // 'Dataset' | 'Report' | 'InterviewSet' | 'MapLayer'
  notes: text('notes'),
})

// =====================================================================
// SPONSOR-OWNED (T1 + T2)
// =====================================================================

export const populationSegments = sqliteTable('population_segments', {
  id: text('id').primaryKey(),
  atlIri: text('atl_iri').notNull(),
  principal: text('principal').notNull(),
  conceptId: text('concept_id').notNull(),
  collectiveId: text('collective_id'),
  scopeTypeId: text('scope_type_id').notNull(),
  spatialFeatureId: text('spatial_feature_id'),
  parentSegmentId: text('parent_segment_id'),
  displayName: text('display_name'),
  isDiaspora: integer('is_diaspora').notNull().default(0),
  homelandFeatureId: text('homeland_feature_id'),
  hostFeatureId: text('host_feature_id'),
  religiousIdentityIri: text('religious_identity_iri'),
  primaryLanguageIri: text('primary_language_iri'),
  casteClanTribeIdentityIri: text('caste_clan_tribe_identity_iri'),
  withinChurchPrincipal: text('within_church_principal'),
  withinNetworkPrincipal: text('within_network_principal'),
  withinDenominationIri: text('within_denomination_iri'),
  withinEngagementId: text('within_engagement_id'),

  // SEC: NOT NULL with no default — writer must choose.
  visibility: text('visibility').notNull(),     // 'public' | 'sponsor-private'

  // Set after T1 segment-stewards-PG assertion is minted.
  onChainAssertionId: text('on_chain_assertion_id'),

  // SEC-16: deferred geo-mcp verification mode.
  geoVerifiedAt: text('geo_verified_at'),

  temporalScope: text('temporal_scope'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => ({
  visibilityCheck: check('visibility_check',
    sql`${t.visibility} IN ('public','sponsor-private')`),
}))

// pg_communities — Tier-2-Sensitive (ADR-PG-1).
// display_name, cohesion_basis, location_hint stored as ciphertext.
export const pgCommunities = sqliteTable('pg_communities', {
  id: text('id').primaryKey(),
  atlIri: text('atl_iri').notNull(),
  principal: text('principal').notNull(),
  conceptId: text('concept_id').notNull(),
  segmentId: text('segment_id').notNull(),

  // AES-GCM ciphertext columns; plaintext exits the MCP only after
  // delegation gating + decryption inside the read tool.
  displayNameCt: blob('display_name_ct').notNull(),
  cohesionBasisCt: blob('cohesion_basis_ct'),
  locationHintCt: blob('location_hint_ct'),
  encDek: blob('enc_dek').notNull(),            // DEK wrapped under per-principal KEK
  encIv: blob('enc_iv').notNull(),

  isAgentive: integer('is_agentive').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const pgCommunityTombstones = sqliteTable('pg_community_tombstones', {
  communityAtlIri: text('community_atl_iri').primaryKey(),
  principal: text('principal').notNull(),
  deletedAt: text('deleted_at').notNull(),
  deletionReason: text('deletion_reason'),
})

export const populationEstimates = sqliteTable('population_estimates', {
  id: text('id').primaryKey(),
  atlIri: text('atl_iri').notNull(),
  principal: text('principal').notNull(),
  segmentId: text('segment_id').notNull(),
  populationCount: integer('population_count'),
  percentChristian: real('percent_christian'),
  percentEvangelical: real('percent_evangelical'),
  primaryLanguageIri: text('primary_language_iri'),
  householdCount: integer('household_count'),
  leadersIdentified: integer('leaders_identified'),
  estimateMethod: text('estimate_method'),
  confidenceScore: real('confidence_score'),
  sourceRecordIri: text('source_record_iri'),
  generatedByActivityIri: text('generated_by_activity_iri'),
  recordedAt: text('recorded_at').notNull(),
})

export const reachednessAssessments = sqliteTable('reachedness_assessments', {
  id: text('id').primaryKey(),
  atlIri: text('atl_iri').notNull(),
  principal: text('principal').notNull(),
  segmentId: text('segment_id').notNull(),
  reachednessStatusIri: text('reachedness_status_iri'),
  engagementStatusIri: text('engagement_status_iri'),
  percentEvangelical: real('percent_evangelical'),
  criteriaIri: text('criteria_iri'),
  confidenceScore: real('confidence_score'),
  sourceRecordIri: text('source_record_iri'),
  generatedByActivityIri: text('generated_by_activity_iri'),
  recordedAt: text('recorded_at').notNull(),
})

export const pgGeometries = sqliteTable('pg_geometries', {
  id: text('id').primaryKey(),
  atlIri: text('atl_iri').notNull(),
  principal: text('principal').notNull(),
  segmentId: text('segment_id').notNull(),
  wktGeometry: text('wkt_geometry'),
  geometryMethod: text('geometry_method'),
  confidenceScore: real('confidence_score'),
  sourceRecordIri: text('source_record_iri'),
  generatedByActivityIri: text('generated_by_activity_iri'),
  visibility: text('visibility').notNull().default('sponsor-private'),
  createdAt: text('created_at').notNull(),
})

// =====================================================================
// AUDIT + REVOCATION
// =====================================================================

export const pgAuditLog = sqliteTable('pg_audit_log', {
  id: text('id').primaryKey(),
  principal: text('principal').notNull(),       // data owner
  accessingAgent: text('accessing_agent').notNull(),
  via: text('via').notNull(),                   // 'direct' | 'cross-delegation' | 'curator'
  delegationHash: text('delegation_hash'),
  tool: text('tool').notNull(),
  argsHash: text('args_hash').notNull(),        // principal-salted keccak256
  resultSummary: text('result_summary').notNull(), // includes denials
  at: text('at').notNull(),
  archivedAt: text('archived_at'),
})

export const revocationEpochs = sqliteTable('revocation_epochs', {
  principal: text('principal').primaryKey(),
  currentEpoch: integer('current_epoch').notNull().default(1),
  bumpedAt: text('bumped_at').notNull(),
})

export const jtiUsage = sqliteTable('jti_usage', {
  jti: text('jti').primaryKey(),
  principal: text('principal').notNull(),
  delegationHash: text('delegation_hash').notNull(),
  usedAt: text('used_at').notNull(),
  expiresAt: text('expires_at').notNull(),
})
