# People-Group MCP & Ontology — Detailed Design (v3)

**Status:** v3 — IA, Ontologist, and Security reviews all applied. Cleared for Developer scaffold.
**Author:** auto-generated 2026-05-03 from the Global.Church people-group ontology note + use-case library
**Implements:** central management of people-group classification taxonomy + sponsor-private segment data, with delegation-gated cross-org reads

## Privacy invariant (verbatim from `02-data-ownership-map.md`)

> MCP rows are never mirrored anywhere. If they need to be discoverable, they emit an on-chain assertion — and it is the on-chain assertion that ends up in GraphDB, not the MCP row.

This MCP holds T0 (public reference catalog), T1 (sponsor-public segment registration), and T2 (sponsor-private domain rows). **No row in this MCP is ever written through a direct MCP→GraphDB pipe.** T0 reaches GraphDB via a one-time A-Box turtle export of the reference catalog (same channel as `templates.ttl`). T1 reaches GraphDB only via an on-chain `sa:Assertion` of kind `sapg:StewardsPeopleGroupInPlace` whose mirror is the existing on-chain → GraphDB sync. T2 never reaches GraphDB.

## Multi-tenancy isolation rule

Every T1/T2 query MUST include `WHERE principal = ?`. Bare reads on T1/T2 tables without the principal predicate are rejected at code review and (where possible) by lint rules. The MCP request validates `principal` against either the session's `delegator` (direct path) or the cross-delegation's `delegator` (bridged path) — never trusts client input.

---

## 1. Goal

Add to the Smart-Agent stack a single MCP that manages:

- **Public registry** of people-group classifications: concepts, schemes, scope types, worldwide collectives, source-governed classification records of *public* entities.
- **Sponsor-public segment registrations**: a sponsoring org declares "we steward the Wolof people group in Dakar."
- **Sponsor-private domain data**: population segments' field measurements, communities, estimates, reachedness assessments, geometries, classifications-of-private-rows.
- **Delegation-gated cross-org reads**: a sponsor grants another principal (e.g. a partner network, a coaching analyst) read access to a scoped slice of its private rows via the `DATA_ACCESS_DELEGATION` edge pattern.

Demo objective: `Senegal Wolof Outreach` (new private org under Catalyst hub) sponsors a hierarchy of segments + community + estimates + reachedness for the Wolof people group in Senegal/Dakar; Maria has a cross-delegation that lets her view all of it from the org viewer.

Source ontology pattern: the Global.Church people-group note ("PROV-O-friendly pattern …") and the A-box use-case library. Adopted verbatim and bound to Smart-Agent's existing `sa:` / `sageo:` / `sar:` namespaces via a new `sapg:` namespace.

---

## 2. Ontology Layer

### 2.1 Namespace strategy

`sapg:` = `https://smartagent.io/ontology/people-groups#` is the Smart-Agent-side namespace. Smart-Agent classes are declared `owl:equivalentClass` / `owl:equivalentProperty` to their `gc:` counterparts (Global.Church). Equivalence rather than subclass is intentional: `gc:` is a vocabulary note rather than a published OWL ontology, so `equivalentClass` keeps reasoners happy without coupling to upstream churn. Compare with `tbox/geo.ttl` which uses `subClassOf geo:Feature` because GeoSPARQL is a published standard.

### 2.2 New T-Box file: `docs/ontology/tbox/people-groups.ttl`

```turtle
@prefix sapg: <https://smartagent.io/ontology/people-groups#> .
@prefix gc:   <https://global.church/ontology/people-groups#> .
@prefix sa:   <https://smartagent.io/ontology/core#> .
@prefix sageo: <https://smartagent.io/ontology/geo#> .
@prefix dul:  <http://www.ontologydesignpatterns.org/ont/dul/DUL.owl#> .
@prefix skos: <http://www.w3.org/2004/02/skos/core#> .
@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix geo:  <http://www.opengis.net/ont/geosparql#> .

# ─── Concepts (SKOS-anchored) ────────────────────────────────────────
sapg:PeopleGroup
    a owl:Class ;
    rdfs:subClassOf skos:Concept ;
    owl:equivalentClass gc:PeopleGroup .

sapg:PeopleGroupClassificationScheme
    a owl:Class ;
    rdfs:subClassOf skos:ConceptScheme , dul:Description ;
    owl:equivalentClass gc:PeopleGroupClassificationScheme .

# ─── Collectives (DUL-anchored) ──────────────────────────────────────
sapg:PeopleGroupCollective
    a owl:Class ;
    rdfs:subClassOf dul:Collective .

sapg:PeopleGroupPopulationSegment
    a owl:Class ;
    rdfs:subClassOf sapg:PeopleGroupCollective , prov:Entity .

sapg:PeopleGroupCommunity
    a owl:Class ;
    rdfs:subClassOf sapg:PeopleGroupCollective .

sapg:AgentivePeopleGroupCommunity
    a owl:Class ;
    rdfs:subClassOf sapg:PeopleGroupCommunity , dul:CollectiveAgent .
    # dul:CollectiveAgent ⊑ prov:Agent — provenance for free.

# ─── Assessment data (PROV-O entities) ───────────────────────────────
sapg:AssessmentDatum
    a owl:Class ;
    rdfs:subClassOf prov:Entity ;
    rdfs:comment "Abstract parent of estimate / assessment / classification records." .

sapg:PeopleGroupPopulationEstimate rdfs:subClassOf sapg:AssessmentDatum .
sapg:ReachednessAssessment        rdfs:subClassOf sapg:AssessmentDatum .
sapg:PeopleGroupClassification    rdfs:subClassOf sapg:AssessmentDatum , dul:Classification .

# ─── Activities (PROV-O Activity targets of wasGeneratedBy) ──────────
sapg:PopulationEstimationActivity      rdfs:subClassOf prov:Activity .
sapg:ReachednessAssessmentActivity     rdfs:subClassOf prov:Activity .
sapg:MappingActivity                   rdfs:subClassOf prov:Activity .
sapg:PeopleGroupClassificationActivity rdfs:subClassOf prov:Activity .

# ─── External records (typed prov:Entity) ────────────────────────────
sapg:Dataset       rdfs:subClassOf prov:Entity .
sapg:Report        rdfs:subClassOf prov:Entity .
sapg:InterviewSet  rdfs:subClassOf prov:Entity , prov:Collection .
sapg:MapLayer      rdfs:subClassOf sapg:Dataset .

# ─── Scope type (class only — individuals in C-Box) ─────────────────
sapg:PeopleGroupScopeType
    a owl:Class ;
    rdfs:subClassOf skos:Concept .

# ─── Placeholder for future engagement model (Phase 2) ──────────────
sapg:MinistryEngagement
    a owl:Class ;
    rdfs:subClassOf prov:Activity ;
    rdfs:comment "Phase-2 placeholder. Range of sapg:withinMinistryEngagement." .
```

Object properties:

| Property | Domain → Range | Inverse | Characteristics |
|---|---|---|---|
| `sapg:ofPeopleGroup` | Segment → PeopleGroup | `sapg:isPeopleGroupOf` | |
| `sapg:classifiedByPeopleGroup` | Collective ∪ Community → PeopleGroup | — | `rdfs:subPropertyOf sapg:ofPeopleGroup` |
| `sapg:segmentOfCollective` | Segment → Collective | — | |
| `sapg:hasScopeType` | Segment → ScopeType | — | functional (`maxCount 1`) — enforced by SHACL |
| `sapg:locatedIn` | Segment → `sageo:GeoFeature` | — | range is GeoSPARQL feature only — Place class dropped |
| `sapg:hasGeometry` | Segment → `geo:Geometry` | — | `rdfs:subPropertyOf geo:hasGeometry` |
| `sapg:hasPeopleGroupCommunity` | Segment → Community | `sapg:communityWithinPopulationSegment` | |
| `sapg:hasPopulationEstimate` | Segment → Estimate | `sapg:estimateForPopulationSegment` | |
| `sapg:hasReachednessAssessment` | Segment → Assessment | `sapg:assessmentOfPopulationSegment` | |
| `sapg:withinChurch` | Segment → `sa:OrganizationAgent` | — | for `InChurch` scope |
| `sapg:withinNetwork` | Segment → `sa:OrganizationAgent` | — | for `InNetwork` scope |
| `sapg:withinDenomination` | Segment → `skos:Concept` | — | denomination is a category, not an org |
| `sapg:withinMinistryEngagement` | Segment → `sapg:MinistryEngagement` | — | for `InMinistryEngagement` scope |
| `sapg:overlapsPopulationSegment` | Segment → Segment | — | `owl:SymmetricProperty` |
| `sapg:hasSubPopulationSegment` | Segment → Segment | `sapg:subPopulationSegmentOf` | inverse is `owl:TransitiveProperty` |
| `sapg:isDiasporaPopulation` | Segment → xsd:boolean | — | gated by SHACL |
| `sapg:homelandPlace`, `sapg:hostPlace` | Segment → `sageo:GeoFeature` | — | required when `isDiasporaPopulation = true` |
| `sapg:migrationReason`, `sapg:generationStatus` | Segment → `skos:Concept` | — | |
| `sapg:primaryLanguage` | Segment → `sapg:Language` | — | (Language modeled separately or imported) |
| `sapg:religiousIdentity` | Segment → `sapg:Religion` | — | |
| `sapg:casteClanTribeIdentity` | Segment → `sapg:CasteClanTribeIdentity` | — | |
| `sapg:belongsToAffinityGroup` | PeopleGroup → AffinityGroup | — | on the **concept**, not segment |
| `sapg:belongsToPeopleCluster` | PeopleGroup → Cluster | — | on the **concept** |
| `sapg:populationCount` | Estimate → xsd:integer | — | datatype |
| `sapg:percentChristian`, `sapg:percentEvangelical`, `sapg:confidenceScore` | xsd:decimal | — | SHACL: 0.0 ≤ x ≤ 1.0 |
| `sapg:estimateMethod`, `sapg:assessmentCriteria` | string | — | |

PROV-O re-uses: `prov:wasDerivedFrom`, `prov:wasGeneratedBy`, `prov:startedAtTime`, `prov:wasAssociatedWith`.

### 2.3 Pre-seeded scope-type C-Box (NOT A-Box)

`docs/ontology/cbox/people-group-scopes.ttl`. (Per Ontologist review: finite enumerations belong in C-Box, not A-Box.)

| Scope-type IRI | Use |
|---|---|
| `sapg:PeopleGroupAcrossCountries` (PGAC) | global identity |
| `sapg:PeopleGroupInCountry` (PGIC) | country segment |
| `sapg:PeopleGroupInRegion` | continent / strategic / 10/40 |
| `sapg:PeopleGroupInAdminArea` | province / state / district |
| `sapg:PeopleGroupInCity` (`/MetroArea`) | city or metro |
| `sapg:PeopleGroupInPlace` | generic place |
| `sapg:PeopleGroupInPolygon` | geometry-evidence scope |
| `sapg:PeopleGroupInDiaspora` | host-place scope |
| `sapg:PeopleGroupInLanguage` | language-first |
| `sapg:PeopleGroupInReligion` | religion segment |
| `sapg:PeopleGroupInCasteClanTribe` | social-boundary segment |
| `sapg:PeopleGroupInAffinityGroup` | strategic-cultural family |
| `sapg:PeopleGroupInCluster` | ethno-cultural cluster |
| `sapg:PeopleGroupInChurch` | within a church |
| `sapg:PeopleGroupInNetwork` | within a coalition/network |
| `sapg:PeopleGroupInDenomination` | within a denomination |
| `sapg:PeopleGroupInMinistryEngagement` | target/focus of an engagement |
| `sapg:PeopleGroupReachednessAssessmentScope` | reachedness-as-segment |

Plus a second C-Box file `docs/ontology/cbox/reachedness-vocabulary.ttl`:

```turtle
sapg:ReachednessStatusScheme a skos:ConceptScheme .
sapg:StatusUnreached  a skos:Concept ; skos:inScheme sapg:ReachednessStatusScheme .
sapg:StatusReached    a skos:Concept ; skos:inScheme sapg:ReachednessStatusScheme .
sapg:StatusFrontier   a skos:Concept ; skos:inScheme sapg:ReachednessStatusScheme .

sapg:EngagementStatusScheme a skos:ConceptScheme .
sapg:StatusEngaged    a skos:Concept ; skos:inScheme sapg:EngagementStatusScheme .
sapg:StatusUnengaged  a skos:Concept ; skos:inScheme sapg:EngagementStatusScheme .
```

`reachedness_status` and `engagement_status` columns reference these IRIs (not free text).

### 2.4 SHACL shapes — `docs/ontology/cbox/people-group-shapes.shacl.ttl`

Constraints to enforce:

| Constraint | Shape |
|---|---|
| Exactly one scope type | `sh:property [sh:path sapg:hasScopeType ; sh:minCount 1 ; sh:maxCount 1]` |
| `InCity` → `locatedIn` required | `sh:qualifiedValueShape` conditional |
| `InChurch` → `withinChurch` required | conditional |
| `InNetwork` → `withinNetwork` required | conditional |
| `InDenomination` → `withinDenomination` required | conditional |
| `InMinistryEngagement` → `withinMinistryEngagement` required | conditional |
| `InLanguage` → `primaryLanguage` required | conditional |
| `InReligion` → `religiousIdentity` required | conditional |
| `InCasteClanTribe` → `casteClanTribeIdentity` required | conditional |
| `InDiaspora` → `homelandPlace + hostPlace + isDiasporaPopulation = true` | conditional |
| Estimates / assessments / classifications: `prov:wasDerivedFrom` minCount 1, `prov:wasGeneratedBy` maxCount 1 | provenance integrity |
| Confidence scores in [0.0, 1.0] | `sh:minInclusive 0 ; sh:maxInclusive 1` |
| Community segment-set compatibility | SPARQL-target shape: all `communityWithinPopulationSegment` segments must share `ofPeopleGroup` |
| `isDiasporaPopulation = true` → homelandPlace + hostPlace | conditional |

**Enforcement strategy** (joint IA + Ontologist verdict): the MCP's `upsert_segment` runs an application-layer check mirroring these shapes (returns structured 400 with failing predicate list on violation). A **separate out-of-band SHACL validator** runs against the GraphDB-mirrored T0/T1 graph post-sync, reporting violations as IA-team alerts. SHACL engine is **not** in the MCP write path.

---

## 3. Information-Architecture Tier Map

| Class | Tier | Store | On-chain assertion | GraphDB | Notes |
|---|---|---|---|---|---|
| `sapg:PeopleGroupClassificationScheme` | T0 public | people-group-mcp `classification_schemes` | no | A-Box export (one-shot) | reference catalog |
| `sapg:PeopleGroup` (concept) | T0 public | `people_group_concepts` | no | A-Box export | Joshua Project IDs are public |
| `sapg:PeopleGroupScopeType` | T0 public | `scope_types` (pre-seeded) | no | C-Box file (already in ontology) | controlled vocabulary |
| `sapg:PeopleGroupCollective` (worldwide) | T0 public | `people_group_collectives` | no | A-Box export | identity-level, no field data |
| `sapg:PeopleGroupClassification` of T0 entity | T0 public | `pg_classifications` | no | A-Box export | source attribution is part of public taxonomy |
| `sapg:PeopleGroupClassification` of T2 entity | **T2 sponsor-private** | `pg_classifications` (`tier='T2'`) | no | never | exposing the classification of a private community leaks the community's existence |
| `sapg:PeopleGroupPopulationSegment` registration | **T1 sponsor-public** | `population_segments` (`visibility='public'`) | **yes — `sa:Assertion` kind `sapg:StewardsPeopleGroupInPlace`** | the assertion only | sponsor declares focus; field data still private |
| `sapg:PeopleGroupPopulationSegment` registration | T2 sponsor-private | `population_segments` (`visibility='sponsor-private'`) | no | never | sponsor opt-out of public registration |
| `sapg:PeopleGroupPopulationEstimate` | T2 sponsor-private | `population_estimates` | no | never | partner-sensitive |
| `sapg:ReachednessAssessment` | T2 sponsor-private | `reachedness_assessments` | no | never | sensitive interpretation |
| `sapg:PeopleGroupCommunity` | **T2-Sensitive** sponsor-private | `pg_communities` (encrypted-at-rest: `display_name`, `cohesion_basis`, `location_hint`) | no | never | identifies real people; per-principal AES-GCM key in Askar; sponsor-only hard-delete + tombstone audit (ADR-PG-1) |
| `sapg:Geometry` (polygon) | **T2 sponsor-private (default)** | `pg_geometries` | no | never | sub-segment + reachedness can identify at-risk populations |
| `sapg:EngagementActivity` | T2 sponsor-private (Phase 2) | n/a (deferred) | n/a | n/a | column kept nullable for forward-compat |

**`population_segments.visibility` is NOT NULL with no DB default** — writer must set explicitly. Public-by-default is wrong-by-default per principle P9.

The T1 on-chain assertion captures: `(sponsoringOrgPrincipal, conceptIRI, scopeTypeIRI, spatialFeatureIRI, atl_iri)` + **optionally** `displayName`. `displayName` is opt-in because it mints permanently to chain. The MCP row is the source of truth; the assertion is the discovery handle. No field data leaks via the assertion.

**Public-displayName safety controls (`upsert_segment` when `visibility='public'`)**:

- Forbidden-substring deny-list (case-insensitive): `underground`, `persecut`, `secret`, `hidden`, `crypto-`, `clandestine`, `at-risk`, `house church`. Configurable per deployment in `config.ts`. Reject with structured 400.
- Length cap: `displayName` ≤ 80 chars.
- `displayName` and `atl_iri` MUST NOT contain any `pg_communities.atl_iri` for the same principal.
- First-time public-segment mint returns a `displayWarning` field so the sponsor explicitly acknowledges that `displayName` lands on chain.

Owner-routing: every T1/T2 row has `principal = sponsoring_org_smart_account` exactly. No cross-tenant rows.

---

## 4. Storage Layer — `apps/people-group-mcp/`

### 4.1 App layout (mirrors org-mcp + geo-mcp)

```
apps/people-group-mcp/
  package.json                 # @smart-agent/people-group-mcp
  src/
    config.ts                  # PORT 3300, RPC_URL, DELEGATION_MANAGER_ADDRESS,
                               #  CURATOR_ALLOWLIST (non-NEXT_PUBLIC_ env or VCS file only),
                               #  T1_DISPLAY_NAME_DENY_LIST (default; per-deploy override),
                               #  T1_DISPLAY_NAME_MAX_LENGTH (default 80)
    db/
      schema.ts                # drizzle tables
      index.ts                 # CREATE TABLE IF NOT EXISTS, WAL pragma
    auth/
      verify-delegation.ts     # mirrors person-mcp's verifyCrossDelegation
      principal-context.ts     # requirePrincipal, requirePrincipalAny,
                               #  requireCurator (CURATOR_ALLOWLIST gate)
      revocation.ts            # JTI + revocation epoch tracking
    tools/
      concepts.ts              # T0 reads
      concepts-admin.ts        # T0 writes (curator only)
      schemes.ts               # T0
      collectives.ts           # T0
      segments.ts              # T1 reads + T2 owner/delegated
      communities.ts           # T2 owner/delegated
      estimates.ts             # T2 owner/delegated
      reachedness.ts           # T2 owner/delegated
      geometries.ts            # T2 owner/delegated
      classifications.ts       # T0 + T2 (gated by classified-entity tier)
    util/
      iri.ts                   # canonical IRI generation
      shacl-conditions.ts      # application-layer SHACL conditional checks
      audit.ts                 # pg_audit_log writer
    index.ts                   # Hono server + MCP wrapper, port 3300
  drizzle.config.ts
```

### 4.2 Schema

```sql
-- ─── PUBLIC REGISTRY (T0) ──────────────────────────────────────────────
CREATE TABLE classification_schemes (
  id TEXT PRIMARY KEY,
  atl_iri TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  description TEXT,
  source_dataset_iri TEXT,
  version TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE people_group_concepts (
  id TEXT PRIMARY KEY,
  atl_iri TEXT NOT NULL UNIQUE,
  scheme_id TEXT REFERENCES classification_schemes(id),
  joshua_project_id TEXT,
  pref_label TEXT NOT NULL,
  alt_labels_json TEXT,
  primary_language_iri TEXT,
  religious_affinity_iri TEXT,
  affinity_group_iri TEXT,
  people_cluster_iri TEXT,
  parent_concept_id TEXT REFERENCES people_group_concepts(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE scope_types (
  id TEXT PRIMARY KEY,
  atl_iri TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  description TEXT
);
-- Pre-seeded: 18 rows from the C-Box file.

CREATE TABLE people_group_collectives (
  id TEXT PRIMARY KEY,
  atl_iri TEXT NOT NULL UNIQUE,
  concept_id TEXT NOT NULL REFERENCES people_group_concepts(id),
  temporal_scope TEXT,
  label TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE pg_classifications (
  id TEXT PRIMARY KEY,
  atl_iri TEXT NOT NULL UNIQUE,
  tier TEXT NOT NULL CHECK (tier IN ('T0','T2')),
  principal TEXT,                            -- NULL when tier='T0', NOT NULL when 'T2'
  scheme_id TEXT NOT NULL REFERENCES classification_schemes(id),
  concept_id TEXT NOT NULL REFERENCES people_group_concepts(id),
  classified_entity_iri TEXT NOT NULL,
  classified_entity_tier TEXT NOT NULL,      -- copied from referenced entity at insert
  classification_method TEXT,
  confidence_score REAL,
  valid_during TEXT,
  source_record_iri TEXT,
  generated_by_activity_iri TEXT,
  recorded_at TEXT NOT NULL,
  CHECK ((tier='T0' AND principal IS NULL) OR (tier='T2' AND principal IS NOT NULL))
);
CREATE INDEX idx_pgc_principal ON pg_classifications(principal) WHERE principal IS NOT NULL;

-- External provenance pointers (typed prov:Entity subclasses).
CREATE TABLE external_records (
  iri TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  kind TEXT NOT NULL,            -- 'Dataset' | 'Report' | 'InterviewSet' | 'MapLayer'
  notes TEXT
);

-- ─── SPONSOR-OWNED (T1 + T2) ──────────────────────────────────────────
CREATE TABLE population_segments (
  id TEXT PRIMARY KEY,
  atl_iri TEXT NOT NULL,
  principal TEXT NOT NULL,
  concept_id TEXT NOT NULL,
  collective_id TEXT,
  scope_type_id TEXT NOT NULL,
  spatial_feature_id TEXT,                   -- IRI to geo-mcp feature; validated at insert
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
  within_engagement_id TEXT,                 -- nullable; Phase 2
  visibility TEXT NOT NULL,                  -- NO DEFAULT — writer must set
                                             -- 'public' (T1) | 'sponsor-private' (T2)
  on_chain_assertion_id TEXT,                -- set when T1 assertion is minted
  temporal_scope TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (principal, atl_iri),
  CHECK (visibility IN ('public','sponsor-private'))
);
CREATE INDEX idx_segments_principal ON population_segments(principal);
CREATE INDEX idx_segments_concept ON population_segments(concept_id);

-- ─── pg_communities — Tier-2-Sensitive (ADR-PG-1) ────────────────────
-- display_name, cohesion_basis, location_hint are stored as ciphertext.
-- Each row carries an `enc_dek` column: data encryption key wrapped under
-- a per-principal key in Askar (mirrors person-mcp profile pattern).
-- Plaintext columns exist only for non-sensitive metadata.
CREATE TABLE pg_communities (
  id TEXT PRIMARY KEY,
  atl_iri TEXT NOT NULL,
  principal TEXT NOT NULL,
  concept_id TEXT NOT NULL,
  segment_id TEXT NOT NULL,
  display_name_ct BLOB NOT NULL,             -- AES-GCM ciphertext
  cohesion_basis_ct BLOB,                    -- AES-GCM ciphertext (nullable)
  location_hint_ct BLOB,                     -- AES-GCM ciphertext (nullable)
  enc_dek BLOB NOT NULL,                     -- DEK wrapped under principal-KEK
  enc_iv BLOB NOT NULL,
  is_agentive INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (principal, atl_iri)
  -- Code-level constraint: segment_id must reference a segment with
  -- the same `principal`. Enforced in upsert_community handler.
);
CREATE INDEX idx_communities_principal ON pg_communities(principal);
CREATE INDEX idx_communities_segment ON pg_communities(segment_id);

-- Tombstone audit for hard-deletes (right-to-be-forgotten compliance).
CREATE TABLE pg_community_tombstones (
  community_atl_iri TEXT PRIMARY KEY,
  principal TEXT NOT NULL,
  deleted_at TEXT NOT NULL,
  deletion_reason TEXT
);

-- Cross-org community-segment overlap deferred to Phase 2.
-- Table omitted from v1 schema (per Security G3) — half-built tables = attack surface.

CREATE TABLE population_estimates (
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
CREATE INDEX idx_estimates_principal ON population_estimates(principal);

CREATE TABLE reachedness_assessments (
  id TEXT PRIMARY KEY,
  atl_iri TEXT NOT NULL,
  principal TEXT NOT NULL,
  segment_id TEXT NOT NULL,
  reachedness_status_iri TEXT,               -- references reachedness C-Box
  engagement_status_iri TEXT,                -- references engagement C-Box
  percent_evangelical REAL,
  criteria_iri TEXT,
  confidence_score REAL,
  source_record_iri TEXT,
  generated_by_activity_iri TEXT,
  recorded_at TEXT NOT NULL,
  UNIQUE (principal, atl_iri)
);
CREATE INDEX idx_reachedness_principal ON reachedness_assessments(principal);

CREATE TABLE pg_geometries (
  id TEXT PRIMARY KEY,
  atl_iri TEXT NOT NULL,
  principal TEXT NOT NULL,
  segment_id TEXT NOT NULL,
  wkt_geometry TEXT,
  geometry_method TEXT,
  confidence_score REAL,
  source_record_iri TEXT,
  generated_by_activity_iri TEXT,
  visibility TEXT NOT NULL DEFAULT 'sponsor-private',  -- T2 default per IA review
  created_at TEXT NOT NULL,
  UNIQUE (principal, atl_iri)
);

-- ─── AUDIT + REVOCATION ────────────────────────────────────────────────
CREATE TABLE pg_audit_log (
  id TEXT PRIMARY KEY,
  principal TEXT NOT NULL,                   -- the data owner whose row was read
  accessing_agent TEXT NOT NULL,             -- caller's smart-account address
  via TEXT NOT NULL,                         -- 'direct' | 'cross-delegation' | 'curator'
  delegation_hash TEXT,                      -- present when via='cross-delegation'
  tool TEXT NOT NULL,
  args_hash TEXT NOT NULL,                   -- keccak256(principal || JSON.stringify(args minus token))
                                             -- principal-salted to block cross-tenant rainbow correlation
  result_summary TEXT NOT NULL,              -- 'ok:N rows, fields=[a,b]' | 'denied:reason'
                                             -- written for both successes AND denials (SEC G9)
  at TEXT NOT NULL,
  archived_at TEXT                           -- nullable; set by retention job
);
CREATE INDEX idx_audit_principal ON pg_audit_log(principal);
CREATE INDEX idx_audit_accessing ON pg_audit_log(accessing_agent);
CREATE INDEX idx_audit_at ON pg_audit_log(at);
-- Retention: via='cross-delegation' rows kept forever; via='direct' rows
-- partition+archive after 365 days via scripts/archive-pg-audit.sh.

CREATE TABLE revocation_epochs (
  principal TEXT PRIMARY KEY,
  current_epoch INTEGER NOT NULL DEFAULT 1,
  bumped_at TEXT NOT NULL
);

CREATE TABLE jti_usage (
  jti TEXT PRIMARY KEY,
  principal TEXT NOT NULL,                   -- caller principal
  delegation_hash TEXT NOT NULL,
  used_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_jti_expires ON jti_usage(expires_at);
```

### 4.3 Auth helpers (`auth/principal-context.ts`)

```ts
// requirePrincipal(token, toolName) — owner-only writes (T2)
// requirePrincipalAny(token, args, toolName, requiredResource) — owner OR cross-delegation (T2 reads)
// requireCurator(token, toolName) — caller's session principal in CURATOR_ALLOWLIST; T0 writes
// no auth — T0 reads
//
// EVERY call path runs these checks in order and audits regardless of outcome:
//   1. Verify session token (HMAC + ECDSA + EIP-712).
//   2. Reject if claims.aud !== 'urn:mcp:server:people-groups'  (SEC-2; cross-audience reuse defense)
//   3. If cross-delegation provided:
//        a. crossDelegation.delegate.toLowerCase() === sessionDelegator
//        b. EIP-712 hash + DelegationManager.isRevoked() not revoked
//        c. ERC-1271 isValidSignature against crossDelegation.delegator
//        d. timestamp caveat valid
//        e. DataScope caveat: server === 'urn:mcp:server:people-groups'
//             AND requiredResource ∈ grants[i].resources         (SEC-12; per-resource gate)
//        f. revocation_epochs[delegator].current_epoch <= delegation's recorded epoch
//        g. JTI insert into jti_usage atomically (single-use within window)
//   4. Append to pg_audit_log — successes AND denials                (SEC G9)
//      args_hash salted with principal (SEC G3 §3 ADR-PG-1)
//
// Curator writes (requireCurator) audit-log even though row is T0.
```

### 4.4 Tool surface

| Tool | Auth | Tier | Notes |
|---|---|---|---|
| `list_pg_concepts(filter?, schemeId?)` | none | T0 | |
| `get_pg_concept(id)` | none | T0 | |
| `list_pg_collectives(conceptId?)` | none | T0 | |
| `list_classification_schemes()` | none | T0 | |
| `list_scope_types()` | none | T0 | |
| `register_pg_concept(...)` | requireCurator | T0 write | |
| `register_classification_scheme(...)` | requireCurator | T0 write | |
| `register_pg_collective(concept_id, ...)` | requireCurator | T0 write | |
| `list_segments(orgPrincipal?, conceptId?, scopeTypeId?, includeSponsorPrivate?)` | none for T1; T2 fields stripped if no auth | mixed | T1 only by default |
| `get_segment(id)` | mixed | mixed | T2 fields only if owner or delegated |
| `upsert_segment(...)` | requirePrincipal | T1+T2 write | runs SHACL conditional check; on `visibility='public'` mints on-chain assertion |
| `list_estimates_for_segment(segmentId)` | requirePrincipalAny | T2 | |
| `add_estimate(segmentId, ...)` | requirePrincipal | T2 write | |
| `list_reachedness_for_segment(segmentId)` | requirePrincipalAny | T2 | |
| `add_reachedness_assessment(segmentId, ...)` | requirePrincipal | T2 write | |
| `list_communities(segmentId)` | requirePrincipalAny | T2 | |
| `upsert_community(segmentId, ...)` | requirePrincipal | T2 write | enforces same-principal as segment |
| `list_geometries(segmentId)` | requirePrincipalAny | T2 | |
| `add_geometry(segmentId, wkt, ...)` | requirePrincipal | T2 write | |
| `add_classification(scheme_id, concept_id, classified_entity_iri, ...)` | mixed | T0 or T2 | tier auto-derived from `classified_entity_iri`; T2 inserts gated by `requirePrincipal` |

Cross-MCP referential integrity: `upsert_segment` calls geo-mcp's `get_feature(spatial_feature_id)` and rejects with structured 400 on 404. **Deferred-verification mode** (SEC-16): when `{ deferGeoVerification: true }` is set on the request, the row is written with `geo_verified_at = NULL` and the integrity sweep job repairs later. Outage tolerance, not a security relaxation.

CI lint (SEC-10 / G1): a Vitest+grep step fails the build if any `db.select().from(populationSegments | population_estimates | reachedness_assessments | pg_communities | pg_geometries | pg_classifications)` lacks a `.where(eq(*.principal, ?))` clause. The multi-tenancy isolation rule is a code-review rule made enforceable in CI.

### 4.5 Wiring (`fresh-start.sh` deltas)

In `scripts/fresh-start.sh`:

```bash
# SERVICES (around line 50)
SERVICES=(
  ...
  "people-group-mcp:3300:@smart-agent/people-group-mcp"
)

# WIPE_PATHS (around line 60)
WIPE_PATHS=(
  ...
  "apps/*/people-group-mcp.db"
  "apps/*/people-group-mcp.db-shm"
  "apps/*/people-group-mcp.db-wal"
)

# seed_after_deploy() — order matters
seed_after_deploy() {
  ...
  seed_geo                 # places must exist before segments reference them
  seed_catalyst_onchain    # Senegal Wolof Outreach must exist before sponsor-private seed
  seed_people_groups       # NEW — public registry + sponsor-private seed via Sione's session
  ...
}
```

A2A proxy: extend `apps/a2a-agent/src/routes/mcp-proxy.ts` to recognize `people-group` as a valid server key. The proxy already forwards `crossDelegation` arg untouched.

---

## 5. Delegation Model

### 5.1 Audience string

`urn:mcp:server:people-groups` (plural — registry-of-many semantics). Aligns with the natural-domain naming pattern; `urn:mcp:server:org` referred to a *single* org's data, while this URN refers to the registry as a whole.

### 5.2 DataScopeGrant template

```json
[
  {
    "server": "urn:mcp:server:people-groups",
    "resources": ["segments", "estimates", "reachedness", "communities", "community-locations", "geometries", "classifications"],
    "fields": ["*"]
  }
]
```

Resource granularity (SEC-5):
- `communities` grants `display_name` + `cohesion_basis` (decrypted server-side, returned to delegate). **Does NOT include `location_hint`.**
- `community-locations` grants `location_hint` separately. **Geographic detail is opt-in.** A v1 default cross-delegation issued from a sponsor to an analyst should grant `communities` only and let the sponsor manually elevate when the relationship justifies it.
- `geometries` is unaffected (polygons remain a separate resource).

Field strings: `'*'` resolves to a v1-published list registered in `packages/sdk/src/data-scope-fields.ts`. Phase-2 will permit explicit subsets (e.g. `populationCount` without `householdCount`) — the registry pattern keeps that forward-compatible.

The audience constant `PEOPLE_GROUPS_MCP_AUDIENCE = 'urn:mcp:server:people-groups'` is exported from `@smart-agent/sdk` (mirrors `ORG_MCP_AUDIENCE`); spelling drift across services is impossible.

### 5.3 Pattern: on-chain `DATA_ACCESS_DELEGATION` edge

- `subject = sponsoring_org_PA`, `object = recipient_PA`
- `metadataURI` JSON:
  ```json
  {
    "delegation": {
      "delegator": "<sponsoring_org_smart_account>",
      "delegate": "<recipient_smart_account>",
      "audience": "urn:mcp:server:people-groups",
      "caveats": [<timestamp>, <dataScope>],
      "salt": "...",
      "signature": "..."
    },
    "delegationHash": "...",
    "grants": [...],
    "expiresAt": "...",
    "audience": "urn:mcp:server:people-groups",
    "kind": "people-group-readership"
  }
  ```
- Signed by deployer (legitimate ERC-1271 owner of the sponsoring org's smart account).
- Reusable seeder: extend `seed-org-delegations.ts` with an `audience` parameter (and optional `grants` override) so it emits both `urn:mcp:server:org` (existing) and `urn:mcp:server:people-groups` (new) from the same code path.

### 5.4 Bridge to people-group-mcp

See the verifier sequence in §4.3 (auth helpers). Behavior differences from org-mcp's `requireOrgPrincipalAny`:

- **Per-resource gate** (SEC-12): each tool declares its `requiredResource` (e.g. `list_geometries` → `'geometries'`); the verifier rejects if the cross-delegation grant doesn't list it. Holding *any* people-group-mcp grant is not enough.
- **Audit on denial** (SEC G9): `pg_audit_log` row written even when verification fails, with `result_summary='denied:<reason>'`.
- **Tool-result fields recorded**: success rows include the disclosed field set (e.g. `'ok:1 row, fields=[displayName,cohesionBasis]'`), enabling sponsors to incident-review what was actually disclosed.

### 5.5 Atomic revocation (SEC-11)

Sponsor-initiated tool `revoke_pg_delegation(delegationHash)`:

1. **DB first**: bump `revocation_epochs[caller_principal].current_epoch += 1`, write `bumped_at`. In-flight requests with stale epoch are rejected by the verifier check (§4.3 step 3f).
2. **Chain second**: submit `DelegationManager.revokeDelegation(delegationHash)` from the sponsor's session signer.
3. If the chain submission fails, the DB bump rolls back. (DB transaction wraps both — the on-chain step uses a try/catch with explicit rollback on rejection.)

This ordering is intentional: an in-flight reader hitting the MCP between step 1 and step 2 still sees a fresh DB epoch and gets denied; the chain mirror catches up shortly after.

### 5.6 v1 scope: on-chain only

Off-chain holder-store delegation (the private-coaching pattern) is **deferred to a later iteration**. Org-to-org research access is structurally public-coaching-shaped; off-chain transport adds a second auth path with no v1 use case.

---

## 6. Demo Seed Plan

### 6.1 Choice — Wolof / Senegal / Dakar

Mirrors the Global.Church doc 1:1. No creative content needed. Tests scope types: PGAC, PGIC, InCity, InPlace, InChurch (via Grace Church example), InMinistryEngagement, InLanguage, InReligion, InAffinityGroup, InCluster.

### 6.2 New on-chain entities (extend `seed-catalyst-onchain.ts`)

| Entity | Type | Owner |
|---|---|---|
| `cat-user-014 — Sione Diop` | demo user | own EOA |
| `Senegal Wolof Outreach` | OrganizationAgent | initialOwner = Sione_EOA, serverSigner = deployer |
| ORG_GOVERNANCE edge | `paSione → senegalWolofOutreach`, `ROLE_OWNER` | |
| HAS_MEMBER edge | `hubCatalyst → senegalWolofOutreach` | |
| Org→Sione cross-delegation, audience `urn:mcp:server:org` | for org-mcp access | |
| Org→Sione cross-delegation, audience `urn:mcp:server:people-groups` | for people-group-mcp access | |
| Org→Maria cross-delegation, audience `urn:mcp:server:people-groups` | so Maria can read | |

### 6.3 Public registry seed (curator session at MCP seed step)

- Schemes: `JoshuaProjectPeopleGroupScheme2026`, `LocalDakarFieldResearchScheme2026`
- External records: `JoshuaProjectDataset2026`, `DakarFieldResearchReport2026`, `DakarFieldInterviewSet2026`, `JoshuaProjectMapLayer2026`
- Affinity / cluster: `SubSaharanAfricanPeoples`, `SenegambianPeoplesCluster`
- Concept: `Wolof` (joshua_project_id, primary language, religious affinity, affinity group + cluster)
- Collective: `WolofPeopleWorldwide2026`
- Scope-types: 18 from C-Box (loaded as part of MCP boot, not seeded per-deploy)

### 6.4 Sponsor-private seed (Sione's session via cross-delegation)

- Country segment: `WolofInSenegal2026` (PGIC, locatedIn `Senegal`) → mints T1 on-chain assertion
- City segment: `WolofInDakarMetro2026` (InCity, parent country) → T1 assertion
- 3× place segments: `WolofInPlateau`, `WolofInMédina`, `WolofInPikine` → T1 assertions
- Community: `WolofCommunityDakar2026` within city + country segments (same-principal constraint satisfied — all rows owned by `senegalWolofOutreach`)
- Estimates (multi-source disagreement demo):
  - Country / source = JP2026: pop 6.8M, %evang 0.10, conf 0.76
  - Country / source = LocalDakarFieldResearch2026: pop 6.55M, %evang 0.14, conf 0.63
  - City: pop est, %evang
  - Each place segment: rough estimate
- Reachedness:
  - Country: status `sapg:StatusUnreached`, engagement `sapg:StatusEngaged`, criteria JP2026, conf 0.72
- Geometry: 1 WKT polygon for the city segment, default visibility `sponsor-private`, method `MappingActivity2026`

### 6.5 Maria's reading flow

1. Maria's session bootstrap via demo-login (existing).
2. UI calls `people-group-mcp.list_segments({ sponsorPrincipal: senegalWolofOutreach_SA })` with Maria's session token + the on-chain cross-delegation read for the `(senegalWolofOutreach_PA, paMaria)` edge attached as `crossDelegation` arg.
3. people-group-mcp validates session + cross-delegation → `principal = senegalWolofOutreach_SA`.
4. UI then calls `list_estimates_for_segment` / `list_reachedness_for_segment` / `list_communities` with the same pair.
5. Every successful read appends a row to `pg_audit_log`.

---

## 7. UI Integration

### 7.1 Org viewer page

Path TBD (will grep before implementation; expected `/h/[hubId]/orgs/[address]` or `/h/[hubId]/(hub)/agents/[address]`). New section: "People-Group Focus."

```
Senegal Wolof Outreach
─────────────────────────────────────────────────────────────────
[existing: profile, governance, members]

People-Group Focus
  Concept: Wolof   (Joshua Project · Senegambian cluster · Sub-Saharan affinity)
  Worldwide collective: Wolof people worldwide, 2026

  Segments
  ┌─────────────────────────────┬────────┬───────────────┬───────────┬────────┬──────────────┐
  │ Display name                │ Scope  │ Place         │ Pop est.  │ %Evang │ Reachedness  │
  ├─────────────────────────────┼────────┼───────────────┼───────────┼────────┼──────────────┤
  │ WolofInSenegal2026          │ PGIC   │ Senegal       │ 6,800,000 │ 10%    │ Unreached    │
  │   ↳ WolofInDakarMetro2026   │ InCity │ Dakar Metro   │  (sub)    │ …      │ Unreached    │
  │       ↳ WolofInPlateau      │ InPlace│ Plateau       │   …       │ …      │ —            │
  │       ↳ WolofInMédina       │ InPlace│ Médina        │   …       │ …      │ —            │
  │       ↳ WolofInPikine       │ InPlace│ Pikine        │   …       │ …      │ —            │
  └─────────────────────────────┴────────┴───────────────┴───────────┴────────┴──────────────┘

  Communities (sponsor-private, gated by delegation)
    Wolof Community Dakar 2026 — within city + country segments

  Sources & disagreement (estimates table grouped by segment)
    Country segment — WolofInSenegal2026
      JoshuaProject 2026:        pop 6,800,000   %evang 0.10   conf 0.76
      LocalDakarFieldResearch:   pop 6,550,000   %evang 0.14   conf 0.63

  Geometry (sponsor-private; map preview if present)
```

### 7.2 Auth branches

| Viewer | Sees |
|---|---|
| Unauthenticated | concept link + scope type + place name (T1 fields only) |
| Logged-in non-delegated user | T1 segment registration table |
| Sione (org owner) — direct session | + estimates, reachedness, communities, geometries (T2 via direct delegation) |
| Maria (delegated) — session + cross-delegation | + estimates, reachedness, communities, geometries (T2 via bridged delegation) |

### 7.3 Server-side data plumbing

```ts
const segments = await callMcp<{ segments: Segment[] }>(
  'people-group', 'list_segments',
  { sponsorPrincipal: sponsorAddr },
  /* crossDelegation auto-attached by mcp-client if Maria's session and
     on-chain edge exists; lookup helper resolves audience='urn:mcp:server:people-groups' */
)
```

`mcp-client` extension: `discoverableCrossDelegationFor(addr, audience)` already supports the org-mcp audience; new audience `urn:mcp:server:people-groups` slots in.

---

## 8. Cross-cutting

### 8.1 PROV-O on every assertion datum

Every estimate/assessment/classification carries:
- `source_record_iri` → `prov:wasDerivedFrom`
- `generated_by_activity_iri` → `prov:wasGeneratedBy`
- `confidence_score`
- `valid_during` / `recorded_at`

External records and activities are typed `prov:Entity` subclasses (see §2.2). RDF emit attaches them properly typed.

### 8.2 GraphDB sync

Per the privacy invariant (top of doc):

| Row class | Path to GraphDB |
|---|---|
| T0 reference catalog (schemes, concepts, scope-types, collectives) | One-shot **A-Box turtle export** under `https://smartagent.io/graph/data/people-groups`. Same channel as `templates.ttl` + `hub-vocabulary.ttl`. Curator updates re-run the export. **No MCP→GraphDB writer process.** |
| T1 segment registration (`visibility='public'`) | MCP emits an **on-chain `sa:Assertion`** of kind `sapg:StewardsPeopleGroupInPlace`. The existing on-chain → GraphDB sync mirrors that assertion. The MCP row stays put. |
| T2 estimates / communities / geometries / reachedness / classifications-of-private | **Never reach GraphDB.** No mirror. No aggregate. No projection. |

Canonical IRI form:

| Class | IRI form |
|---|---|
| `sapg:PeopleGroup` | `did:sapg:concept:{joshuaProjectId}` (when present) or `sapg:concept:{atl_iri}` |
| `sapg:PeopleGroupCollective` | `sapg:collective:{conceptId}-{temporalScope}` |
| `sapg:PeopleGroupPopulationSegment` | `sapg:segment:{principal}-{atl_iri}` |
| `sapg:PeopleGroupPopulationEstimate` | `sapg:estimate:{segmentId}-{recordedAt}-{sourceRecordIri.fragment}` |
| `sapg:ReachednessAssessment` | `sapg:reachedness:{segmentId}-{recordedAt}-{sourceRecordIri.fragment}` |

### 8.3 Multi-source disagreement

`population_estimates` and `reachedness_assessments` allow multiple rows per segment with their own provenance. UI shows all rows grouped by segment. Reconciliation by a `PopulationReconciliationActivity` is deferred from v1.

### 8.4 Out-of-band SHACL validator output (SEC-13)

The validator runs against the GraphDB-mirrored T0/T1 graph post-sync. Output handling rules:

- **Curator-only.** Never sponsor-readable, never sponsor-public. Reading the report reveals data-maturity gaps that are themselves intelligence.
- Sanitize `displayName` → `atl_iri` in violation reports.
- Aggregate counts ("12 segments missing scope type across all sponsors") may surface in a curator dashboard. **Per-sponsor violation lists must NOT be shared even with that sponsor** — the sponsor receives synchronous integrity feedback through `upsert_segment` 400 responses, not the offline validator.
- Validator process MUST run against the GraphDB mirror, never against MCP rows directly.

### 8.5 Materialized aggregate

`sapg:hasAssessmentSummary` (analogue of `FeedbackAssertionSummary`): per-segment summary with latest-pop, latest-reachedness, source-count, last-updated. Lets `list_segments` UI return aggregate stats without per-segment subqueries. Maintained by an MCP-internal trigger on insert/update to estimates/reachedness.

### 8.6 No PII in T0/T1

By design: `pg_communities` (which can identify named local groups) is T2. T0/T1 hold concepts, schemes, scope types, collectives, and segment registrations only. No row in T0/T1 can reveal a real person's name.

---

## 9. Pipeline + commit plan

1. **IA review** — *complete* ✓
2. **Ontologist review** — *complete* ✓
3. **Security review** — pending. Focus: audience scope grants, community-PII consideration, audit-log retention, T1 on-chain assertion safety.
4. **Developer scaffold** — after Security signs off.
5. **Tester / Reviewer / QA / Test User** — standard pipeline + a multi-source-disagreement test.

Estimated commits:

- **C1** — ontology .ttl files + scope C-Box + reachedness C-Box + SHACL shapes
- **C2** — people-group-mcp scaffold + schema + auth + JTI + revocation + audit-log
- **C3** — public registry tools + admin/curator seed (T0 reference catalog A-Box export pipe)
- **C4** — sponsor-private tools (segments + communities + estimates + reachedness + geometries + classifications)
- **C5** — on-chain catalyst seed extension (Sione + Senegal Wolof Outreach + delegations)
- **C6** — `seed-org-delegations` audience parameter + Maria PG cross-delegation + T1 segment-assertion pattern
- **C7** — MCP demo seed (Wolof concept + segments + estimates + reachedness)
- **C8** — org viewer UI section + delegation lookup helper

---

## Appendix A — Resolved open issues

| # | Question | Decision |
|---|---|---|
| 1 | Classification tier | T0 by default; T2 if `classified_entity_iri` resolves to a T2 row. Code derives at insert time. |
| 2 | Geometry default | T2 (sponsor-private). Sponsors flip per-row to T1 if appropriate. |
| 3 | Segment registration default | NOT NULL, no DB default. Writer chooses `'public'` or `'sponsor-private'`. |
| 4 | PG↔geo coupling | Soft IRI ref + insert-time validation against geo-mcp + deferred integrity sweep job. |
| 5 | EngagementActivity v1 | Deferred to Phase 2. `within_engagement_id` column kept nullable. |
| 6 | Audience name | `urn:mcp:server:people-groups` (plural). |
| 7 | Off-chain sponsor delegation | Deferred. On-chain only for v1. |
| 8 | SHACL enforcement | Application-layer conditionals in `upsert_segment` + out-of-band SHACL engine post-sync against GraphDB mirror. SHACL engine NOT in MCP write path. |

## Appendix B — Architecture Decision Records

### ADR-PG-1 — `pg_communities` is Tier-2-Sensitive

**Decision:** Treat `pg_communities` rows as Tier-2-Sensitive: a strict subclass of T2 with mandatory column-level encryption-at-rest, principal-salted audit-log args_hash, sponsor unilateral hard-delete + tombstone audit, and explicit opt-in for `community-locations` resource scope (separate from `communities`).

**Rationale:** `display_name` ("Wolof Community Dakar 2026") + `cohesion_basis` + `location_hint` together can identify named local groups in religiously-sensitive contexts. Treat as PII-equivalent.

**Implementation:** AES-GCM ciphertext columns (`*_ct BLOB`); per-row DEK wrapped under per-principal KEK in Askar (mirrors person-mcp profile pattern); `enc_iv` stored alongside.

### ADR-PG-2 — Curator allowlist v1

**Decision:** v1 curator authority lives in `CURATOR_ALLOWLIST` loaded from a non-`NEXT_PUBLIC_` env var or a VCS-checked config file. Never from runtime DB or request headers. Every `requireCurator` call audit-logs even though the row is T0.

**Rationale:** Threat model for curators is *integrity of the public catalog*, not *confidentiality* (curators have no T2 read). Hard-coded allowlist is sufficient bootstrap; on-chain `sa:RegistryCurator` role is roadmap (Phase 2).

### ADR-PG-3 — Public displayName deny-list

**Decision:** `upsert_segment` with `visibility='public'` rejects `displayName` matching the configured forbidden-substring deny-list (case-insensitive: `underground`, `persecut`, `secret`, `hidden`, `crypto-`, `clandestine`, `at-risk`, `house church`) or > 80 chars or containing any community `atl_iri` for the same principal. `displayName` itself is OPTIONAL in the on-chain assertion mint.

**Rationale:** Strings minted into the on-chain assertion are permanent. Sponsors who pick names like "Wolof Underground in Pikine 2026" leak both the community and the security context forever.

### ADR-PG-4 — Per-resource grant gate

**Decision:** Each tool declares a `requiredResource` value; the cross-delegation verifier checks `requiredResource ∈ grants[i].resources`. Holding *any* people-group-mcp grant is insufficient.

**Rationale:** Without per-resource gating, a sponsor who shares `segments` access also implicitly shares `geometries` access — undermining the resource-list model.

### ADR-PG-5 — Atomic revocation: DB-bump-first then on-chain

**Decision:** `revoke_pg_delegation` bumps the local `revocation_epochs` row first, then submits the on-chain `revokeDelegation`; rolls back DB on chain failure.

**Rationale:** In-flight readers between step 1 and step 2 see a stale epoch and get denied. If we did chain-first, an in-flight reader could still pass the local check before the next epoch read.

### ADR-PG-6 — Audit-log read scopes

**Decision:**
- Sponsor reads own (`pg_audit_log WHERE principal = sponsor_principal`).
- Delegated readers cannot read the audit log even for their own accesses (would expose other delegates' activity).
- Curators cannot read T2 audit rows.

**Rationale:** The audit log is sponsor incident-review surface. Exposing it to delegates leaks cross-delegate information.

### ADR-PG-7 — SHACL validator output is curator-only

**Decision:** Per §8.4. Per-sponsor violation lists never shared even with that sponsor.

**Rationale:** Coverage gaps in a sponsor's data are intelligence about that sponsor.
