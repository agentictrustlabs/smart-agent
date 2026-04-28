# Agent Skills — Implementation Plan

> **Status**: design — agent-team reviewed (architect / PM / security /
> ontologist). All Critical and High findings folded in. Open questions
> Q1 + Q6 resolved. v0 cut documented in §11; v1 backlog in §12.
> **Pattern**: parallels `.geo` (GeoFeatureRegistry + GeoClaimRegistry +
> `geo.ttl` + GraphDB sync + AnonCreds). Skills are **agent-level
> claims**, not endpoint metadata.
> **Author**: based on user proposal + repo grounding from Explore
> agents (geo registry / credential-kinds / .agent naming).

## 1. Why agent-level (not endpoint-level)

The proposal locks in a decision worth restating up front:

> **Agent X has skill Y; Endpoint E implements skill Y.**

Today A2A cards describe "how to call me." That's correct as
operational metadata, but wrong as the source of truth for "what is
this agent capable of." A `Person Agent` or `Organization Agent` may
carry skills with no hosted endpoint at all (e.g., a counsellor's
licensure, an org's scope of work). Conversely, one endpoint may
implement many skills, and one skill may be backed by multiple
endpoints. The two layers separate cleanly:

| Layer | Source of truth | Lifecycle |
| --- | --- | --- |
| `Agent hasSkill X` | `AgentSkillRegistry` (on-chain) + `skills.ttl` (RDF) + AnonCred (private) | Long-lived; tied to agent identity |
| `Endpoint implementsSkill X` | A2A `agent.json` card | Short-lived; tied to deployment |

Trust-graph queries always start from the **agent layer**. Endpoints
are resolved last, only when a caller wants to actually invoke.

## 1.5 Parity matrix — what's geo-equivalent at each cut

The two-question check anyone reading this plan will run:

> 1. Can agents register skills **on chain** like they do for geo?
> 2. Can agents hold a **private AnonCred** for a skill the way they
>    hold a `GeoLocationCredential` in their vault?

| Capability | Geo (today) | Skills v0 | Skills v1 |
| --- | :-: | :-: | :-: |
| On-chain definition registry (`*FeatureRegistry` / `*DefinitionRegistry`) | ✓ | ✓ | ✓ |
| On-chain per-agent public claim registry (`mint*Claim`) | ✓ | ✓ | ✓ |
| GraphDB sync of public claims (two-named-graph privacy fence in skills) | ✓ | ✓ | ✓ |
| Discovery API with text → concept expansion | ✓ (containment) | ✓ exact + altLabel | ✓ + SKOS narrower |
| Trust-search public-claim contribution | ✓ | ✓ | ✓ |
| Profile UI: mint public claim | ✓ | ✓ | ✓ |
| Pagination on registry readers | ✗ (liability) | ✓ | ✓ |
| Self-attest rate-limit + EIP-712 cross-issuance gate | n/a | ✓ | ✓ |
| **Held AnonCred (private vault) — `GeoLocationCredential` / `SkillsCredential`** | ✓ | ✗ | ✓ |
| Issuer MCP for AnonCred (`apps/geo-mcp` / `apps/skill-mcp`) | ✓ | ✗ | ✓ |
| Verifier-mcp spec for credential check | ✓ | ✗ | ✓ |
| `IssueCredentialDialog` form to obtain a private credential | ✓ | ✗ | ✓ |
| "Test verification" on `HeldCredentialsPanel` | ✓ | ✗ | ✓ |
| Trust-search Stage-B′ — held credential contribution to score | ✓ (just shipped) | ✗ | ✓ |
| `.geo` / `.skill` TLD with bi-directional `bindName` | ✓ | ✗ | ✓ |
| ZK match circuit (`GeoH3Inclusion` / skill equivalent) | partial | ✗ | ✗ (v2) |

**Direct answers to the two questions:**

- **Q1 (on-chain skill registration like geo):** **YES in v0.** The
  `AgentSkillRegistry` ships in S1 — first milestone of v0. After v0,
  any agent can mint a public `(skillId, relation, proficiencyScore)`
  claim against themselves (or have an issuer cross-sign one) and it
  appears in trust-search. Same shape as `mintGeoClaim`.
- **Q2 (AnonCred for skills like the geo held credential):** **NO in
  v0; YES in v1.** v0 deliberately ships only the public on-chain
  path. The held-credential / private-vault / `IssueCredentialDialog`
  path requires a new `apps/skill-mcp` issuer service plus
  `SkillsCredential` schema/credDef registration — that's S6, deferred
  to v1 per the PM cut. The full geo-parity moment is the v1 ship.

This matters for sequencing: the v0 cut intentionally validates the
search-and-rank story before committing to the AnonCred infra.
If the public skill column doesn't move trust-search rankings on demo
data, S6 is wasted spend; if it does, v1 becomes obvious.

## 2. Components (paralleling .geo)

### 2.1 `SkillDefinitionRegistry.sol` (mirrors `GeoFeatureRegistry`)

Versioned, content-addressed taxonomy of "what is this skill?"

```solidity
struct SkillRecord {
    bytes32 skillId;          // = keccak256(canonical-id-string)
    uint64  version;
    address steward;          // governing org (e.g. OASF curator)
    bytes32 kind;             // KIND_OASF_LEAF / KIND_DOMAIN / KIND_CUSTOM
    bytes32 conceptHash;      // keccak256(SKOS preferred-label + ancestors)
    bytes32 ontologyMerkleRoot; // anchors RDF/SKOS expansion (synonyms,
                                // narrower / broader / related, OASF mapping).
                                // Canonical = sorted N-Quads, URDNA2015.
    bytes32 predecessorMerkleRoot; // mirrors `sageo:sourceSetRoot` so
                                   // taxonomy diffs are traceable across
                                   // versions; bytes32(0) for first version.
    string  metadataURI;      // off-chain JSON-LD with full SKOS triples;
                              // includes `oasfRelease` tag (e.g. "oasf-0.5.2")
                              // so identical OASF reimports produce identical
                              // conceptHash regardless of import day.
    uint64  validAfter;
    uint64  validUntil;
    bool    active;
}

event SkillPublished(bytes32 indexed skillId, uint64 version, address steward);
event SkillNameBound(bytes32 indexed skillId, bytes32 indexed nameNode);
event SkillDeactivated(bytes32 indexed skillId);
event SkillValidityChanged(bytes32 indexed skillId, uint64 validAfter, uint64 validUntil);
```

> **Architect-review fix (B4)**: dropped `broaderSkillId` from the struct.
> SKOS hierarchy lives in the off-chain RDF graph anchored by
> `ontologyMerkleRoot`. Re-parenting a node should NOT force a new
> on-chain version when `conceptHash` is unchanged.

Storage / indexes (same shape as geo):
- `latestVersion[skillId]`
- `_skillNames[skillId][]` and `skillForName[nameNode]` (for `.skill` namespace; v1 only)

`skillIdFor(parts)` deterministic hash, mirroring `featureIdFor`'s flat
key list:

```ts
skillIdFor({
  scheme: 'oasf' | 'custom' | 'skos',
  conceptId: 'oasf:communication.write.grant_writing',  // canonical, scheme-prefixed
  variant?: 'nonprofit',
}) → keccak256(stringToHex(`skill:${scheme}|${conceptId}|${variant ?? ''}`))
```

> **Architect-review fix**: removed redundant `domain` parameter — it was
> already implicit in the scheme-prefixed `conceptId`. Inconsistent
> callers passing `domain` in both places would have produced different
> IDs for the same concept.

### 2.2 `AgentSkillRegistry.sol` (mirrors `GeoClaimRegistry`)

Per-agent claim index. Three relations only — proficiency is encoded in
the relation, not as a separate byte:

```solidity
struct SkillClaim {
    bytes32 claimId;              // = keccak256(subject ‖ skillId ‖ relation ‖ nonce)
    address subjectAgent;
    address issuer;               // gated: see "Issuer authentication" below
    bytes32 skillId;
    uint64  skillVersion;         // pinned snapshot
    bytes32 relation;             // hasSkill | practicesSkill | certifiedIn  (v0 set)
    uint8   visibility;           // Public | PublicCoarse | PrivateCommitment | PrivateZk | OffchainOnly
    uint16  proficiencyScore;     // 0–10000 (= 0–100.00 percent), populated
                                  // by issuer's rubric. Display ladder
                                  // (basic/advanced/certified/expert) is
                                  // a presentation-layer cut at the score.
    uint8   confidence;           // 0–100
    bytes32 evidenceCommit;       // hash(evidence bundle) — ZK-targetable
    bytes32 edgeId;               // optional AgentRelationship edge (e.g. issuer→subject)
    bytes32 assertionId;          // optional ATL Assertion record
    bytes32 policyId;             // "smart-agent.skill-overlap.v1"
    uint64  validAfter;
    uint64  validUntil;
    bool    revoked;
}

event SkillClaimMinted(bytes32 indexed claimId, address indexed subject, address indexed issuer, bytes32 skillId);
event SkillClaimRevoked(bytes32 indexed claimId);
event SkillClaimEvidenceUpdated(bytes32 indexed claimId, bytes32 evidenceCommit);
```

> **Architect-review fix (B2)**: collapsed six relations
> (`hasSkill / certifiedIn / practicesSkill / endorsesSkill / mentorsIn /
> canTrainOthersIn`) and four proficiency rungs into **three relations +
> a numeric `proficiencyScore`**. Endorser/mentor/trainer claims become
> their own subjects in v1 (`endorses` and `trains` are *acts*, not
> *skill modalities*). Avoids 120-cell semantic-space lock-in on the
> ABI.

> **Ontologist-review fix**: promoted proficiency to `uint16
> proficiencyScore` (0–10000) so it composes with `confidence` and
> `issuerTrust` continuously, mirroring `sageo:confidence`. The 4-step
> enum is a UI label only.

#### Issuer authentication (B1 — security blocker)

The `issuer` field is **gated at mint**. Two valid paths:

1. **Direct mint** — `msg.sender == subjectAgent && issuer == msg.sender`.
   Self-attestation; allowed for all relations. **Hard cap on
   self-attested `proficiencyScore` at 6000** (= "advanced" ceiling).
   `certifiedIn` is forbidden in this path.
2. **Cross-issued mint** — caller submits an EIP-712
   `SkillEndorsement` signature from the `issuer` address. The
   signature commits to `(issuer, subjectAgent, skillId, relation,
   proficiencyScore, validAfter, validUntil, nonce)`. `ecrecover` runs
   on chain at mint; mismatch reverts. Mirrors the EIP-712 pattern in
   `DelegationManager.sol`.

> **Security-review fix (S1)**: closes "Org B mints `endorsesSkill` on
> behalf of Org A" by requiring cross-signed proof. Indexed `issuer`
> event topic enables off-chain audit of impersonation attempts.

Indexes:
- `_claimsBySubject[agent][]`
- `_claimsBySkill[skillId][]`
- `_claimsByRelation[relation][]`
- `_claimsByIssuer[address][]` ← **architect-review addition**

> **Architect-review addition**: `claimsByIssuer` is cheap to add at
> mint time and prohibitively expensive to retrofit. Skill discovery
> has a strong issuer-centric pattern ("show every credential
> Coursera/Erie School ever issued") that geo doesn't.

#### Self-attestation rate limit (Sybil mitigation)

Per `subjectAgent`, max **N self-attested claims per epoch** (default
20 / 24h, governed by steward). Cross-issued claims are uncapped;
they cost the issuer's signature, which is the rate-limiter.

> **Security-review fix (S3)**: floors don't stop a Sybil from
> stuffing the registry with `practicesSkill` claims to pollute
> autocomplete. Rate-limiting at mint is the only defence that
> doesn't require trust scoring.

#### Revocation epoch

Per `(issuer, subjectAgent)`, a `revocationEpoch` counter increments
on `bumpRevocationEpoch(issuer, subject)`. GraphDB sync surfaces the
epoch on every claim query so readers can detect stale data without
a full re-sync. SLA: revocation propagates to GraphDB within **15
seconds** via a synchronous `DELETE WHERE` push from the indexer
(retry on failure with exponential backoff up to 5 minutes). Mirrors
the session-grant revocation-epoch pattern from M1.

> **Security-review fix (S5)**: closes "compromised issuer's claims
> linger until next full re-sync."

### 2.3 SDK (mirrors `geo-feature.ts` + `geo-claim.ts`)

Two clients in `packages/sdk/src/`:

- `skill-definition.ts` — `SkillDefinitionClient` with `getLatest`,
  `getSkill`, `skillForName`, `allSkills`, `publish`, `bindName`, plus
  `skillIdFor()` static helper.
- `skill-claim.ts` — `AgentSkillClient` with `getClaim`,
  `claimsBySubject`, `claimsBySkill`, `claimsByRelation`, `mint`,
  `revoke`, `updateEvidence`.

Constants in `predicates.ts`:

```ts
// v0 relation set — three only.
export const SKILL_REL_HAS_SKILL          = keccak256(stringToHex('skill:hasSkill'))
export const SKILL_REL_PRACTICES_SKILL    = keccak256(stringToHex('skill:practicesSkill'))
export const SKILL_REL_CERTIFIED_IN       = keccak256(stringToHex('skill:certifiedIn'))

export const SKILL_VISIBILITY = { Public: 0, PublicCoarse: 1, PrivateCommitment: 2, PrivateZk: 3, OffchainOnly: 4 }

// proficiencyScore display thresholds (UI presentation only — score is on chain)
export const SKILL_PROFICIENCY_LABEL = { Basic: 0, Advanced: 4000, Certified: 6500, Expert: 8500 }

// v1: KIND_SKILL added when the .skill TLD lands. Holding off in v0
// avoids leaving an un-gated namespace constant in predicates.ts that
// could be initialized maliciously between v0 and v1.
// export const KIND_SKILL = keccak256(stringToHex('namespace:Skill'))
```

Relation hash table (`SKILL_REL_HASH_TO_LABEL`) for RDF serialisation,
same shape as the geo version. **Defined explicitly** in
`packages/sdk/src/predicates.ts` (architect noted this was missing in
the first draft).

### 2.4 Ontology — `docs/ontology/tbox/skills.ttl` + C-Box files

T-Box (classes / properties only — instances live in C-Box):

```turtle
@prefix sa:      <https://smartagent.io/ontology/core#> .
@prefix saskill: <https://smartagent.io/ontology/skill#> .
@prefix sageo:   <https://smartagent.io/ontology/geo#> .
@prefix skos:    <http://www.w3.org/2004/02/skos/core#> .
@prefix oasf:    <https://oasf.linuxfoundation.org/schema/0.1/> .
@prefix dul:     <http://www.ontologydesignpatterns.org/ont/dul/DUL.owl#> .
@prefix prov:    <http://www.w3.org/ns/prov#> .

# Ontology header — every existing T-Box has one (core.ttl:42–49).
<https://smartagent.io/ontology/skill> a owl:Ontology ;
    owl:imports <https://smartagent.io/ontology/core> ,
                <http://www.w3.org/2004/02/skos/core> ,
                <https://oasf.linuxfoundation.org/schema/0.1/> .

saskill:Skill        a owl:Class ; rdfs:subClassOf skos:Concept .
saskill:SkillClaim   a owl:Class ; rdfs:subClassOf sa:Claim .

# v0 relations (three only — see §2.2).
saskill:HasSkill           a saskill:Relation .
saskill:PracticesSkill     a saskill:Relation .
saskill:CertifiedIn        a saskill:Relation .

# Visibility — reuse sageo:Visibility class (already general).

# Skill metadata
saskill:skillId            a owl:DatatypeProperty .
saskill:skillVersion       a owl:DatatypeProperty .
saskill:conceptHash        a owl:DatatypeProperty .
saskill:ontologyMerkleRoot a owl:DatatypeProperty .
saskill:predecessorMerkleRoot a owl:DatatypeProperty .
saskill:oasfRelease        a owl:DatatypeProperty .   # e.g. "oasf-0.5.2"

# Claim metadata — surface every Solidity field as RDF so GraphDB
# sync round-trips correctly (ontologist-review addition).
saskill:subjectAgent       a owl:ObjectProperty ; rdfs:range sa:Agent .
saskill:issuer             a owl:ObjectProperty ; rdfs:range sa:Agent .
saskill:relation           a owl:ObjectProperty ; rdfs:range saskill:Relation .
saskill:visibility         a owl:ObjectProperty ; rdfs:range sageo:Visibility .
saskill:proficiencyScore   a owl:DatatypeProperty ; rdfs:range xsd:integer .
saskill:confidence         a owl:DatatypeProperty ; rdfs:range xsd:integer .
saskill:evidenceCommit     a owl:DatatypeProperty .
saskill:edgeRef            a owl:ObjectProperty .   # ATL AgentRelationship link
saskill:assertionRef       a owl:ObjectProperty .   # ATL Assertion link
saskill:policyId           a owl:DatatypeProperty .

# OASF alignment (controlled-vocabulary axis).
saskill:oasfMapping        a owl:ObjectProperty ; rdfs:range oasf:Capability .

# Top-level ConceptScheme — declares the whole skill graph.
saskill:SkillScheme a skos:ConceptScheme ;
    skos:prefLabel "Smart Agent Skill Vocabulary"@en .
```

> **Ontologist-review fixes**: added `owl:Ontology` header (every
> existing T-Box has one); surfaced `assertionRef / edgeRef / policyId
> / subjectAgent / issuer` as RDF properties (previously only in
> Solidity); added `predecessorMerkleRoot` and `oasfRelease`
> properties; declared a top-level `skos:ConceptScheme`.

#### C-Box and SHACL (also created in S2)

- `docs/ontology/cbox/skill-vocabulary.ttl` — concrete skill *instances*
  (e.g. `oasf:communication.write.grant_writing`). T-Box stays for
  classes and properties only. Mirrors the
  `cbox/controlled-vocabularies.ttl` / `cbox/hub-vocabulary.ttl`
  split.
- `docs/ontology/cbox/skill-shapes.shacl.ttl` — SHACL constraints
  asserting:
  - every triple in `<…/graph/data/onchain>` carries
    `saskill:visibility saskill:Public` (privacy fence — see
    §2.5);
  - `saskill:proficiencyScore` ≤ 6000 when
    `subjectAgent == issuer` (rate-limit invariant);
  - `saskill:relation == saskill:CertifiedIn` requires
    `subjectAgent != issuer` (no self-cert).
- `docs/ontology/abox/skills-template.ttl` — example A-Box claim
  showing the full triple shape for documentation.

#### OASF round-trip

Deploy-time JSON-LD pull, transformed to SKOS triples:

1. Fetch OASF release at version pinned in
   `OASF_RELEASE_TAG` env (e.g. `"oasf-0.5.2"`).
2. Transform to canonical N-Quads (URDNA2015).
3. Compute Merkle root → `ontologyMerkleRoot` in the SkillRecord.
4. Tag every imported triple with `saskill:oasfRelease` so two
   stewards re-importing the same `oasf:Capability` URI on different
   days produce identical `conceptHash`.
5. Each new `SkillRecord` version carries `predecessorMerkleRoot` so
   diff is traceable; deletions in upstream OASF surface as
   `active = false` on the prior version, not silent removal.

> **Ontologist-review fix**: pinned the OASF release as a first-class
> field; round-trip is one-way no longer. `predecessorMerkleRoot`
> mirrors `sageo:sourceSetRoot`.

The on-chain `skillId` is our anchor; OASF is **input**, not the
canonical registry.

### 2.5 GraphDB sync — two named graphs (privacy fence)

> **Security-review fix (S2)**: split named graphs so a missing or
> typo'd `FILTER` in SPARQL can't leak private claims. Without this,
> the SKOS-narrower expansion at §2.6 is one bug away from
> exfiltrating PrivateCommitment claim relations.

Two separate named graphs:

| Named graph | Contents | Reader access |
| --- | --- | --- |
| `https://smartagent.io/graph/data/onchain` | Public + PublicCoarse claims only. | All discovery API consumers. |
| `https://smartagent.io/graph/data/private` | PrivateCommitment / PrivateZk / OffchainOnly claims (commits, no plaintext). | Caller's own person-mcp only — never returned to peers. |

The SHACL shape at `cbox/skill-shapes.shacl.ttl` asserts every triple
in `data/onchain` carries `saskill:visibility saskill:Public` (or
PublicCoarse), as a CI-checked invariant.

Add to `apps/web/src/lib/ontology/graphdb-sync.ts`
(`emitAgentsTurtle()`) and the live-write hook
`apps/web/src/lib/ontology/kb-write-through.ts`:

- read `claimsBySubject(agent)` from `AgentSkillRegistry`
- route by visibility: Public / PublicCoarse → `data/onchain`;
  everything else → `data/private`
- emit:

```turtle
GRAPH <https://smartagent.io/graph/data/onchain> {
  <.../agent/{addr}> saskill:hasSkillClaim <.../claim/{claimId}> .
  <.../claim/{claimId}>
     saskill:targetSkill     <.../skill/{skillId}> ;
     saskill:skillVersion    "3"^^xsd:integer ;
     saskill:relation        saskill:CertifiedIn ;
     saskill:proficiencyScore "8500"^^xsd:integer ;
     saskill:confidence       "85"^^xsd:integer ;
     saskill:visibility       saskill:Public ;
     saskill:issuer           <.../agent/{issuerAddr}> ;
     saskill:evidenceCommit   "0x…" ;
     saskill:assertionRef     <.../assertion/...> ;
     saskill:edgeRef          <.../edge/...> ;
     saskill:policyId         "smart-agent.skill-overlap.v1" .
}
```

Skill-definition triples (broader / narrower / OASF mapping) are
written **once per skill version** when `SkillPublished` fires, sourced
from the `metadataURI` JSON-LD blob (signed by the steward) and
canonicalized to N-Quads.

> **Architect-review addition**: both `graphdb-sync.ts` (periodic
> emitter) AND `kb-write-through.ts` (live writes) must be wired —
> the first draft only mentioned the periodic path.

### 2.6 Discovery service — `SkillDiscoveryClient`

`packages/discovery/src/skill-sparql.ts` parallels
`geo-sparql.ts`. Core queries:

- `agentsWithSkill(skillId, opts?)` — direct hit + SKOS-narrower
  expansion via property paths (`skos:narrower*`)
- `expandSkillConcept(text)` — text → SKOS concept set (prefLabel /
  altLabel match, then walk to OASF mappings)
- `agentsForConcept(text, geoFilter?)` — combined skill + geo overlap
  query
- `skillsForAgent(agentAddr)` — reverse lookup with claim provenance

Example combined search ("nonprofit grant writing near Erie"):

```sparql
PREFIX saskill: <…/ontology/skill#>
PREFIX sageo:   <…/ontology/geo#>

SELECT ?agent ?skillId ?relation ?confidence ?proficiencyScore ?geoMatch
WHERE {
  # GRAPH-qualified: ensure we only ever read the public graph.
  # The privacy fence is enforced both at the storage layer (separate
  # named graphs in §2.5) AND in every SPARQL query — defence in depth.
  GRAPH <https://smartagent.io/graph/data/onchain> {
    # 1. parsed text → seed concept
    VALUES ?seed { <…/skill/{seedSkillId}> }

    # 2. expand via SKOS narrower / OASF mapping (v1 — v0 uses exact
    #    + altLabel match only).
    ?targetSkill (skos:narrower|saskill:oasfMapping)* ?seed .

    # 3. agents with a public claim against any of those skills
    ?claim a saskill:SkillClaim ;
           saskill:targetSkill     ?targetSkill ;
           saskill:subjectAgent    ?agent ;
           saskill:relation        ?relation ;
           saskill:confidence      ?confidence ;
           saskill:proficiencyScore ?proficiencyScore ;
           saskill:visibility      sageo:Public .

    # 4. geo filter (optional) — reuse stage-B path from geo-overlap
    OPTIONAL {
      ?gclaim a sageo:GeoClaim ;
              sageo:subjectAgent ?agent ;
              sageo:targetFeature ?feature .
      ?feature geo:hasGeometry/geo:asWKT ?wkt .
      FILTER(geof:sfContains(?wkt, "POINT({lon} {lat})"^^geo:wktLiteral))
      BIND(true AS ?geoMatch)
    }
  }
}
```

> **Security-review fix (S2)**: every discovery query now opens with
> `GRAPH <data/onchain>`. Cross-graph reads require explicit
> `GRAPH <data/private>` clauses, which are auditable and never
> generated by the discovery API.

#### Pagination

`claimsBySubject` etc. return unbounded arrays (geo has the same
liability). For skills the cardinality is much higher — an
OASF-aligned agent could easily hold 50+ claims. All
`SkillDiscoveryClient` methods take `{ offset, limit }` defaults
`(0, 100)`, with hard cap `500` enforced server-side.

> **Architect-review addition**: pagination from day one — retrofit
> after S5 starts ranking on full lists is painful.

### 2.7 Trust-search integration

Add a third overlap axis alongside org-overlap and geo-overlap:

`packages/privacy-creds/src/skill-overlap.ts` —
`skillOverlapScore({ caller, candidate, sharedSkills, callerOrgs,
weights })` with policy `smart-agent.skill-overlap.v1`. Inputs:

- caller's held skill claims (private vault → matched skillIds, the
  same Stage-B′ pattern that geo just got)
- candidate's public skill claims (from GraphDB)
- relation-weighted (v0): `hasSkill (0.6) < practicesSkill (1.0) <
  certifiedIn (1.5)`. Weights chosen so cross-issued certifications
  outweigh self-attested practice.
- `proficiencyScore` enters the score linearly (`score *= 0.5 +
  (proficiencyScore / 10000) * 1.0`), giving a 0.5x–1.5x multiplier.
- evidence-commit boost: +0.2 if a verifier has cross-signed.
- recency decay (claims past `validUntil` zero out; claims older than
  `now - 2 years` get a 0.5x decay multiplier).

#### Double-counting fixes (architect-review §5)

Two **real bugs**, not refinements:

1. **Issuer ∈ caller's orgs**. When a `certifiedIn` claim's issuer is
   also a member of the caller's org set, the certification is
   double-counted (org-overlap signal + skill issuer-trust boost).
   Fix in `skillOverlapScore`: cap issuer-trust multiplier at 1.0
   when `issuer ∈ callerOrgs`. Org-overlap owns that signal.
2. **Bundled evidenceCommit**. When a candidate's `certifiedIn`
   (skills) and `licensedIn` (geo) claims share the same
   `evidenceCommit` and issuer within the same time window (e.g.
   "Erie County social work license" produces both), treat them as a
   single bundle — score the higher of the two contributions, not
   their sum.

Both are scoring-side fixes; no contract change.

#### Self-attested floor (security-review S3)

Discovery results filter out `practicesSkill` / `hasSkill` claims with
`issuer == subjectAgent` from the *ranked* list when the requester has
opted into "verified-only" search (default off; on for
high-stakes discovery contexts like grant matching). Always shown for
"all skills" search, just down-weighted.

#### Stage-B′ blinding (security-review S4)

When the caller's held skill credentials feed local trust-score boost,
the wire format ships **`H(evidenceCommit ‖ searchNonce)`** instead of
the raw commit, with the nonce bound to the request. Prevents
cross-search fingerprinting of the caller's held credential set.
Mirrors what should be applied to the geo Stage-B′ path too — call
that out as a follow-up to the geo work.

`AgentTrustSearch.tsx` renders a third column next to org/geo:

```
Agent          Org  Geo  Skill  Total
luis.…         1.7  1.3  0.9    3.9
jane.…         0.0  0.0  2.4    2.4   (skill-only match, e.g. policy expert)
```

> **PM-review note**: trust-search UI is becoming a column-stuffing
> problem (org / geo / skill / shared / city already overflowing).
> UX rethink is a prerequisite for S5, not a follow-up. Tracked in
> the v0 cut as a "Skill column only — postpone column reorg."

### 2.8 `.skill` TLD — **deferred to v1**

Add as a sibling root of `.agent` / `.geo` / `.pg`. Same governance
gap as geo — `initializeRoot` is currently un-gated. This plan does
**not** add governance.

**v0 deliberately ships without `KIND_SKILL`** in `predicates.ts` and
without registry initialization. Reasons:

1. Canonical lookup is by `skillId` regardless. The `.skill` alias is
   developer-friendliness, not user-visible — defer-able cleanly.
2. Architect-review caught a real risk: shipping `KIND_SKILL` constant
   without namespace integration leaves the registry initializable
   maliciously between v0 and v1.

When v1 lands the namespace, naming convention:

- OASF source IDs use `_`; DNS names use `-`. Canonicalizer (`_` →
  `-`, lowercase, NFKC) lives in
  `packages/sdk/src/skill-name-canon.ts`.
- `oasf:communication.write.grant_writing` →
  `grant-writing.communication.write.skill` (leaf-first, matching
  `.geo` precedent: `erie.colorado.us.geo`).
- `custom:org-X-internal-cert` → `org-x-cert.skill`.

Bi-directional binding via `bindName(skillId, nameNode)`, identical to
`featureForName` / `_featureNames`. Canonical lookup remains by
`skillId`.

> **Ontologist-review fix**: documented the `_` vs `-` canonicalizer
> explicitly so `bindName` doesn't fail collision tests when OASF
> ships `grant-writing` vs `grant_writing` variants.

### 2.9 SkillsCredential (AnonCred) — **deferred to v1** (parallel-buildable with v0 S2)

Append to `CREDENTIAL_KINDS` in `packages/sdk/src/credential-types.ts`:

```ts
{
  credentialType: 'SkillsCredential',
  schemaId: 'did:smart-agent:schema:skill:1.0',
  credDefId: 'did:smart-agent:cred-def:skill:1.0',
  attributeNames: [
    'skillId', 'skillName',
    'relation',          // 'hasSkill' | 'practicesSkill' | 'certifiedIn'
    'proficiencyScore',  // '0'–'10000'
    'confidence',        // '0'–'100'
    'issuerName',        // human-readable (audited against DID alsoKnownAs)
    'issuerDid',         // DID for cryptographic identity check
    'validFrom', 'validUntil', 'issuedAt',
  ],
  displayName: 'Skill credential',
  noun: 'skill',
  description: 'AnonCreds binding you to a skill or capability with optional proficiency and issuer attestation. Visibility is your choice.',
  issuerKey: 'skill',
  requiresActiveHub: false,
}
```

> **Security-review fix (S6)**: split `issuerName` (display string)
> from `issuerDid` (cryptographic identity). Verification binds
> `issuerName` to the issuer's DID-Document `alsoKnownAs` rather
> than trusting the credential's self-asserted string. Closes
> "forged certifying authority" attack.

A new `apps/skill-mcp` issuer service mirrors `apps/geo-mcp`:
- `/credential/offer` + `/credential/issue` endpoints
- AnonCreds schema/credDef registered on first boot
- Issuer DID resolution via signed manifest (committed in repo, not
  free env). v1 elevates to on-chain registry.

Stage-B′ for skills (in trust-search): caller's held
`SkillsCredential`s contribute by matching `skillId` against
candidates' public claims, exactly the way held geo creds now do.
Privacy: held creds never leave person-mcp; only blinded
`H(evidenceCommit ‖ searchNonce)` ships (see §2.7).

> **Architect-review fix**: S6 has no real dependency on S4 (UI) or S5
> (trust-search). It can be built in **parallel with S2** as soon as
> `skillId` and `CREDENTIAL_KINDS` are stable from S1. Updated in §3
> milestone table.

> **PM-review note**: net-new MCP service (`apps/skill-mcp`) is the
> single biggest scope risk. v0 cuts it entirely; only adopt the
> AnonCred path after v0 search rankings prove the skill column is
> worth the spend.

### 2.10 UI — Skills panel on profile + form

`apps/web/src/components/profile/AddSkillClaimPanel.tsx` mirrors
`AddGeoClaimPanel`:
- skill picker (SKOS-text-search via SkillDiscoveryClient)
- relation picker
- proficiency picker
- confidence slider
- visibility (defaults to Public)
- "Mint claim" button → `mintPublicSkillClaimAction`

`apps/web/src/lib/credentials/forms/SkillsForm.tsx` mirrors
`GeoForm` for the AnonCred path (private skills via `IssueCredentialDialog`).

`apps/web/src/components/agent/AgentSkillsPanel.tsx` — shows an agent's
public skills on their profile, grouped by domain, with proficiency
badges and issuer attribution. Resembles `AgentGeoPanel`.

## 3. Milestones (build order — reordered after architect review)

> **Reorder**: S6 must run parallel with S2 (was after S4), because
> S5's Stage-B′ depends on held credentials existing. S4 (UI) is now
> last-of-its-tier, not first.
>
> **Recalibration**: 5–6 weeks → **6–8 weeks** single-eng. PM review
> flagged taxonomy curation (OASF) and SKOS query expansion as
> ballooning risks geo didn't have. Parallel build ~4 weeks.

| M | Deliverable | Files | Acceptance | Dependencies |
| --- | --- | --- | --- | --- |
| **S1** | On-chain registries + SDK clients | `SkillDefinitionRegistry.sol`, `AgentSkillRegistry.sol`, `predicates.ts`, `skill-definition.ts`, `skill-claim.ts` | `forge test` covers mint (direct + EIP-712 cross-issued) / revoke / version pin / rate-limit / claimsByIssuer; SDK round-trips a public skill claim | — |
| **S2** | Ontology + GraphDB sync (two named graphs) | `tbox/skills.ttl`, `cbox/skill-vocabulary.ttl`, `cbox/skill-shapes.shacl.ttl`, `abox/skills-template.ttl`, `graphdb-sync.ts` + `kb-write-through.ts` hooks | SHACL validates (incl. visibility-fence shape); `SkillPublished` lands as RDF in <15s; SHACL CI rejects test triples that misroute private claims to `data/onchain` | S1 |
| **S6** (parallel) | SkillsCredential (AnonCred) | `apps/skill-mcp`, `CREDENTIAL_KINDS` entry, `SkillsForm.tsx`, verifier spec, signed issuer manifest | issue + present + verify; private-vault Stage-B′ contribution to trust score; issuerName ↔ DID alsoKnownAs binding test | S1 (parallel with S2) |
| **S3** | DiscoveryService API | `skill-sparql.ts`, `expandSkillConcept`, `agentsWithSkill`, `agentsForConcept`, paginated readers | text query → ranked agent list with provenance; every query graph-qualified to `data/onchain`; regression test: PrivateCommitment claim → 0 hits | S2 |
| **S5** | Trust-search integration | `skill-overlap.ts`, `AgentTrustSearch.tsx` column | search ranks agents by combined org+geo+skill score; double-counting tests pass (issuer ∈ caller orgs, bundled evidenceCommit) | S3, S6 |
| **S4** | Profile UI + claim minting | `AddSkillClaimPanel`, `AgentSkillsPanel`, `mintPublicSkillClaimAction` | user mints a public skill claim; appears on profile within 1 page reload; rate-limit visible to user | S3 |
| **S7** | `.skill` namespace + binding | `KIND_SKILL` (added here, not S1), registry init, `bindName`, name canonicalizer | `grant-writing.communication.skill` resolves to skillId both directions; underscore/hyphen variants collide-test cleanly | S5, namespace governance |

Recommended order: **S1 → (S2 ‖ S6) → S3 → S5 → S4 → S7.**

## 4. Open questions — reviewed

| # | Question | Status | Resolution |
| --- | --- | --- | --- |
| **Q1** | OASF import cadence | **Resolved (must close before S1)** | Deploy-time JSON-LD pull, version pinned to `OASF_RELEASE_TAG` env, canonical N-Quads (URDNA2015) hashed into `ontologyMerkleRoot`. Predecessor merkle root committed for diff traceability. Updates require a new `SkillRecord` version. |
| **Q6** | Privacy default for new claims | **Resolved (must close before S1)** | `Public` for skills suitable for a public résumé. SHACL shape `cbox/skill-shapes.shacl.ttl` enforces "skills routed to `data/onchain` MUST be Public". Sensitive skills (trauma-informed care, legal-status work) opt into `PrivateZk` via the AnonCred path in v1. |
| **Q2** | Endorser gates | Resolve before S5 | (Endorser/mentor relations deferred to v1 — not in v0 set.) When v1 lands them: unrestricted at registry, weighted by issuer-trust at scoring time. |
| **Q3** | Self-attestation max proficiency | Resolve before S5 | **Hard cap on chain at `proficiencyScore ≤ 6000`** when `subjectAgent == issuer`. SHACL enforces same invariant in GraphDB. Scorer additionally filters self-attested claims out of "verified-only" search mode. |
| **Q4** | AnonCred issuer registry | Defer to v1 (S6) | Signed manifest hash (committed in repo) for v0; on-chain `SkillIssuerRegistry` in v1 alongside namespace governance. Security review escalated this from "env-driven for now" → "signed manifest" because env was forgeable. |
| **Q5** | A2A endpoint reverse-link auto-mint | Defer indefinitely | No auto-mint. Surface as a profile-UI suggestion with one-click "claim it." |

## 5. Non-goals (defer to v2)

- ZK skill match circuit (would parallel `GeoH3Inclusion` — needs
  separate Phase-6-style spec)
- On-chain `SkillIssuerRegistry` with stake / slashing (env-driven
  for v0, signed manifest for v1)
- Endorser / mentor / trainer relations (`endorsesSkill`,
  `mentorsIn`, `canTrainOthersIn`) — promote to v1 only after the
  v0 three-relation set proves discovery quality is bottlenecked
  by missing modalities
- Skill marketplaces / matchmaking SLAs / payment rails (out of
  identity-layer scope)
- Endpoint-level `implementsSkill` enforcement at runtime (advisory only)
- AgentTrustSearch column-reorg for >3 dimensions (orthogonal UX work)

## 6. Reuse summary

The win in following the geo pattern: every layer — Solidity,
SDK, ontology, GraphDB sync, SPARQL, discovery, trust scoring,
AnonCred — has a working precedent. The risk surface is small;
the bulk of the work is taxonomy curation (OASF integration) and
UI polish, not novel architecture.

---

## 11. v0 ship — ~2.5 weeks (PM cut)

> Validates the search story before committing to AnonCred infra
> and namespace governance. If the skill column doesn't move
> trust-search rankings on demo data, S6 is wasted spend.

**Cut from full plan:**
1. ❌ S6 (AnonCred + `apps/skill-mcp`). Public claims only.
2. ❌ S7 (`.skill` TLD + `bindName`). Lookup by `skillId` only.
3. ❌ OASF import. Hand-curate ~30 demo-relevant skills directly
   into `cbox/skill-vocabulary.ttl` (grant writing, counselling,
   missions logistics, software engineering, …).
4. ❌ SKOS narrower-expansion in S3. Exact + altLabel match only.
5. ❌ `endorsesSkill` / `mentorsIn` / `canTrainOthersIn` relations.
   v0 ships with `hasSkill`, `practicesSkill`, `certifiedIn`.
6. ❌ AgentTrustSearch column reorg. Skill column added; broader UX
   rethink waits for the v1 push.

**v0 ships:**
- `SkillDefinitionRegistry` + `AgentSkillRegistry` with
  EIP-712-gated cross-issuance and self-attest rate limit
- SDK: `SkillDefinitionClient`, `AgentSkillClient`, predicates
- Ontology: T-Box + C-Box (hand-curated) + SHACL shapes + A-Box
  template — all six files
- Two-named-graph GraphDB sync with privacy fence
- DiscoveryService: exact + altLabel match, paginated
- Profile UI: AddSkillClaimPanel + AgentSkillsPanel
- Trust-search: skill column with v1 scoring math (incl. both
  double-counting fixes)
- Stage-B′ blinding (`H(commit ‖ nonce)`) — applied to skill scoring;
  retrofit to geo as a follow-up

**Acceptance:** demo user mints a `practicesSkill grant_writing`
claim; another demo user searches "grant writing" and sees them
ranked above no-skill peers; private claim ⇒ 0 hits in public search;
rate-limit reverts the 21st self-attestation in a 24h window.

## 12. v1 backlog (post-v0)

- S6: SkillsCredential AnonCred + `apps/skill-mcp`
- OASF import + SKOS narrower expansion
- `endorsesSkill` / `mentorsIn` / `canTrainOthersIn` relations
- S7: `.skill` TLD + namespace governance
- On-chain `SkillIssuerRegistry`
- ZK skill-match circuit (Phase-6 parallel)
- Geo Stage-B′ blinding retrofit (security follow-up)

## 13. Review traceability

This plan was reviewed by four agent-team perspectives (architect /
PM / security / ontologist) on 2026-04-28. Every Critical and High
finding has been folded into the plan above. Specifically:

- **B1 (issuer impersonation)** — fixed in §2.2 "Issuer authentication"
- **B2 (schema bloat)** — fixed in §2.2 (3 relations, `proficiencyScore` 0–10000)
- **B3 (SPARQL privacy)** — fixed in §2.5 (two named graphs) + §2.6 (graph-qualified queries) + SHACL invariant
- **B4 (`broaderSkillId` on chain)** — fixed in §2.1 (removed from struct)
- **Architect §2 (build order)** — fixed in §3 (S6 parallel with S2)
- **Architect §3 (`skillIdFor` signature)** — fixed in §2.1 (flat keys)
- **Architect §3 (`claimsByIssuer`)** — fixed in §2.2 (added)
- **Architect §4 (revocation + audit + pagination + ABI)** — fixed in §2.2 (revocation epoch) + §2.5 (kb-write-through) + §2.6 (pagination)
- **Architect §5 (double-counting)** — fixed in §2.7
- **PM §1–§5 (timeline + cuts + question priority)** — folded into §3, §4, §11
- **Security S1–S6** — folded into §2.2 (gating + rate limit + revocation), §2.5 (two graphs), §2.6 (graph qualification), §2.7 (blinding), §2.9 (DID binding)
- **Ontologist §1–§6** — folded into §2.4 (header, C-Box split, SHACL, A-Box, OASF release pin, name canonicalizer, score 0–10000, surfaced RDF properties)
