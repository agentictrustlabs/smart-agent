# Grants & Generosity Ontology — Consolidated T-Box

**Status:** Source-of-truth ontology consolidation
**Companions:** All other grant-fund docs in this directory
**Owner:** Ontologist agent (per `docs/agents/ontologist.md`)
**Purpose:** Single comprehensive ontology document that pulls together every class, property, role, situation, and constraint introduced across the grants-fund design. Aligns to PROV-O + DOLCE+DnS + existing `sa:` / `sageo:` / `sapg:` namespaces. Becomes the basis for the actual `.ttl` files we ship.

This is the document the user identified as a *main goal*: "a clean and comprehensive ontology that covers this area."

---

## 1. Design principles

### 1.1 Alignment

We commit to:

1. **PROV-O** for every entity, activity, and agent. PROV-O is the W3C standard for provenance and gives us `wasDerivedFrom`, `wasGeneratedBy`, `wasInfluencedBy`, `actedOnBehalfOf`, `wasAttributedTo`, `wasAssociatedWith`, `used`. Every assertion datum in our system traces back through these properties.

2. **DOLCE+DnS** for the description/role/situation triangle. DOLCE gives us the upper-ontology categories (Endurant, Perdurant, Quality, Concept). DnS (Description and Situations pattern) gives us the formal mechanism for "this thing satisfies that schema by playing those roles."

3. **SKOS** for controlled vocabularies (scope types, status enums, kind taxonomies). Same pattern we use in `tbox/people-groups.ttl`.

4. **GeoSPARQL** for any geographic feature — through `sageo:GeoFeature` which subclasses `geo:Feature`.

5. **Existing `sa:` namespace** for Smart-Agent classes — no parallel hierarchy. We extend, we don't fork.

### 1.2 Cleanliness rules

- **One concept = one class.** No alias classes; if it's the same notion, it's the same IRI.
- **Equivalent classes for upstream alignment.** When we adopt a Global.Church or external pattern, use `owl:equivalentClass` to map without coupling.
- **Properties have explicit domain + range.** No untyped properties.
- **Inverse properties declared.** Every directional relation gets an inverse where natural.
- **Functional vs symmetric vs transitive declared explicitly.**
- **No subclass-explosion for variants.** Use scope-type / kind / mode controlled vocabularies (SKOS) instead of subclasses where the variant is conceptual not structural.

### 1.3 Comprehensiveness rules

- **Every object referenced in the design docs must appear here.** If it's used in `grants-fund-architecture.md`, `faith-funding-and-stewardship.md`, `agentic-hub-and-bdi.md`, `giver-activation-and-private-needs.md`, `gitcoin-grants-deep-dive.md`, `funding-models-survey.md`, or `matchmaking-strategy.md` — it's in this T-Box.
- **No orphan classes.** Every class either subclasses something, has properties referencing it, or is itself referenced from a property.
- **DnS roles enumerated for every Description.** Mandates, campaigns, rounds, and policies all declare the roles they define.

### 1.4 Versioning

This ontology will evolve. Each release:
- Bumps `sa:OntologyVersion`
- Documents added/removed/changed classes in a CHANGELOG section here
- Maintains `owl:deprecated true` on retired classes for one cycle before removal

---

## 2. Namespace strategy

Five namespaces in play:

| Prefix | IRI base | Owner | Purpose |
|---|---|---|---|
| `sa:` | `https://smartagent.io/ontology/core#` | us | Core agent / identity / relationship / governance terms |
| `sageo:` | `https://smartagent.io/ontology/geo#` | us | Geographic features (subclass of `geo:Feature`) |
| `sapg:` | `https://smartagent.io/ontology/people-groups#` | us | People-group ontology (already shipped) |
| `sagrant:` | `https://smartagent.io/ontology/grants#` | us | **NEW — this document defines** |
| `gc:` | `https://global.church/ontology/...` | upstream Global.Church | We reference via `equivalentClass` only |

**Decision:** Grants ontology lives in **new `sagrant:` namespace**. Reasoning:
- Cleaner T-Box file separation (`tbox/grants.ttl`) — easier to maintain, audit, version
- Clear discoverability ("everything sagrant: is grants-domain")
- Doesn't conflate with core agent ontology in `sa:`
- Same pattern we used for `sapg:` (people-groups got its own namespace because it's a coherent domain)

Cross-namespace links: `sagrant:` classes subclass or reference `sa:`, `sageo:`, `sapg:` as needed. This is normal RDF practice.

---

## 3. Class hierarchy

The full tree. All 50+ classes organized by upper category.

### 3.1 Agents (Endurants)

```
sa:Agent (≡ prov:Agent ≡ dul:Agent)
├── sa:PersonAgent (≡ prov:Person, dul:NaturalPerson)
├── sa:OrganizationAgent (≡ prov:Organization, dul:Organization)
│   ├── sa:HubAgent              [existing — registry/curator org]
│   ├── sagrant:FundAgent          [NEW — fund as first-class agent]
│   │   ├── sagrant:DAFAgent        [donor-advised fund variant]
│   │   ├── sagrant:GivingCircleAgent  [member-pooled fund variant]
│   │   └── sagrant:CampaignFundAgent  [time-bounded fund variant]
│   ├── sa:ChurchOrganization     [existing]
│   ├── sa:NetworkOrAssociation   [existing]
│   └── sa:Denomination           [existing — reused via SKOS Concept hybrid]
├── sa:AIAgent                    [existing — for AI/automated agents]
├── sa:ValidatorAgent              [NEW — agent acting as outcome validator]
└── sapg:AgentivePeopleGroupCommunity [existing — community as collective agent]
```

Notes:
- `FundAgent` subclasses `OrganizationAgent` because operationally a fund IS an org with treasury + governance, but with mandate as its primary description (see §4 below).
- Three Fund subclasses (DAF, GivingCircle, CampaignFund) capture *operational variants* — they have different default governance + lifecycle. Modeled as subclasses (not just kinds) because their behavior differs structurally.
- `ValidatorAgent` is a new class because validators have validator-specific properties (validation methodology, validator credential, accuracy track record).

### 3.2 Descriptions (Plans / Schemas)

Per DnS, a Description defines roles + concepts + parameters that a Situation can satisfy.

```
dul:Description (≡ prov:Plan when applicable)
├── sagrant:FundMandate          [the fund's published policy]
│   └── sagrant:GrantRound       [time-bounded refinement of FundMandate]
├── sagrant:Campaign             [time-bounded mobilization wrapper]
├── sagrant:StewardshipPolicy    [ECFA-aligned governance description]
├── sagrant:GovernancePolicy     [voting / approval / quorum description]
├── sagrant:AllocationStrategy   [the algorithm — single-coach, multisig, QF, COCM, etc.]
├── sagrant:Restriction          [donor's conditions on use]
├── sagrant:OutcomeDescriptor    [criteria for what counts as an outcome]
├── sagrant:ReportingObligation  [cadence + format requirements]
├── sagrant:StoryPermissions     [machine-readable consent on narrative]
├── sagrant:ConsentBasis         [outreach consent description]
└── sagrant:AccessPolicy         [credential requirements for sensitive needs]
```

### 3.3 Roles (Concepts)

Per DnS, Roles are `dul:Concept`s defined by Descriptions and played by Agents.

```
dul:Role (≡ dul:Concept)
├── sagrant:DonorRole              [defined by FundMandate; played by Person/Org]
├── sagrant:RecipientRole          [defined by FundMandate; played by Person/Org]
├── sagrant:FunderRole             [defined by FundMandate; played by FundAgent]
├── sagrant:StewardRole            [defined by StewardshipPolicy; played by Person/Org]
├── sagrant:ValidatorRole          [defined by FundMandate.evidence; played by ValidatorAgent]
├── sagrant:HubHostRole            [defined by Hub policy; played by HubAgent]
├── sagrant:CircleMemberRole       [defined by GivingCircleAgent; played by Person]
├── sagrant:GovernanceMemberRole   [defined by GovernancePolicy; played by Person/Org]
├── sagrant:MatcherRole            [a sponsor matching others' contributions]
├── sagrant:CampaignParticipantRole [sub-role within campaign]
└── sagrant:StoryAuthorRole        [who's allowed to author a story]
```

### 3.4 Situations (Particulars)

Per DnS, Situations are `dul:Situation` instances that satisfy a Description by binding agents to roles.

```
dul:Situation (≡ prov:Entity when info-bearing)
├── sagrant:GrantAwardAgreement  [the particular award; satisfies FundMandate]
│   └── sagrant:RecurringSupportCommitment  [recurring variant]
├── sagrant:PledgeCommitment      [satisfies a fund's pledge-acceptance]
├── sagrant:CampaignParticipation [a particular giver-in-campaign moment]
├── sagrant:CircleAllocation      [a particular giving-circle vote outcome]
├── sagrant:EngagementSituation   [reuses existing engagement model]
└── sa:CommitmentSituation        [generic commitment frame, existing]
```

### 3.5 Activities (Perdurants)

Per PROV-O / DOLCE, Activities happen at specific times and produce/use Entities.

```
prov:Activity (≡ dul:Action)
├── sagrant:PledgeActivity            [donor signs pledge]
├── sagrant:ContributionActivity      [donor's funds actually transfer to fund]
├── sagrant:FundAllocationActivity    [fund decides which proposals get funded]
├── sagrant:ApprovalActivity          [governance approval event]
│   ├── sagrant:SingleCoachApproval
│   ├── sagrant:MultisigApproval
│   └── sagrant:QuadraticAllocation   [Phase 5; whole-round event]
├── sagrant:DisbursementActivity      [fund → recipient transfer]
│   └── sagrant:TrancheReleaseActivity [milestone-gated tranche]
├── sagrant:OutcomeReportActivity     [recipient files report]
├── sagrant:OutcomeValidationActivity [validator confirms]
├── sagrant:AcknowledgmentActivity    [fund ack to donor]
├── sagrant:StoryPublicationActivity  [story is published]
├── sagrant:OutreachActivity          [push message sent]
├── sagrant:SubscriptionActivity      [donor opts into subscription]
├── sagrant:SolicitationActivity      [fund agent solicits donor]
├── sagrant:ReferralActivity          [fund refers proposal to sibling fund]
├── sagrant:RoundOpeningActivity      [round opens]
├── sagrant:RoundClosingActivity      [round closes]
├── sagrant:RevocationActivity        [pledge / award / mandate revoked]
└── sagrant:ImpactSummaryActivity     [aggregated reporting event]
```

### 3.6 Information / Assessment Entities

```
prov:Entity
├── sagrant:GiftIntent (≡ sa:Intent with direction='give')
├── sagrant:NeedIntent (≡ sa:Intent with direction='receive')
├── sagrant:Proposal           [bridge from NeedIntent to fundable plan]
├── sagrant:OutcomeReport      [recipient's report]
├── sagrant:OutcomeValidation  [validator's assessment]
├── sagrant:Story              [narrative with permissions]
├── sagrant:Subscription       [consent-bound publishing relation]
├── sagrant:OutreachMessage    [single push message]
├── sagrant:Acknowledgment     [fund's communication to donor]
├── sagrant:TrustUpdate        [trust-graph delta]
├── sagrant:AssessmentDatum    [parent of estimate / report / validation]
└── sagrant:ImpactSummary      [aggregated impact across awards]
```

### 3.7 Resources & Money

```
sagrant:Resource
├── sagrant:CapitalResource    [money — ETH, mock-token, real currency]
├── sagrant:TimeResource       [hours / volunteer service]
├── sagrant:SkillResource      [expertise contributed]
├── sagrant:GoodResource       [in-kind material]
└── sagrant:RecurringResource  [scheduled commitment]

sagrant:Treasury [held by FundAgent]
sagrant:FundPoolEntry [ledger entry, debit or credit]
sagrant:Tranche [scheduled disbursement portion]
```

### 3.8 Sensitive-need privacy

```
sagrant:PrivacyPattern (a sagrant:AccessPolicy)
├── sagrant:SelectiveDisclosurePattern   [Pattern 1, AnonCreds]
├── sagrant:TrustedIntermediaryPattern   [Pattern 2, attestation-based]
├── sagrant:CoarseOnlyPattern             [Pattern 3, public-coarse]
├── sagrant:ZKPredicatePattern           [Pattern 4]
├── sagrant:FundAsShieldPattern          [Pattern 5]
└── sagrant:EscrowRevealPattern          [Pattern 6]

sagrant:CoarseProjection (information entity, the public side of a sensitive need)
sagrant:PrivateContent (encrypted information entity)
sagrant:TrustedIntermediaryAttestation (signed by validator/steward)
sagrant:ZKPredicateProof (information entity)
```

### 3.9 Match-card surface

```
sagrant:MatchCard (information entity, never persisted; runtime-only)
├── sagrant:DirectMatchCard
├── sagrant:FundMediatedSubmitCard
├── sagrant:FundMediatedPledgeCard
├── sagrant:CampaignActiveCard
├── sagrant:StoryDrivenCard
├── sagrant:SensitiveNeedCard
└── sagrant:FundAdminCard
```

These are runtime-only objects (never on chain, never in MCP) but documenting them in the ontology gives reasoners a vocabulary to talk about discovery products.

---

## 4. PROV-O backbone

Every class above maps to one of the three PROV-O top-level types:

| PROV-O type | Our classes |
|---|---|
| `prov:Agent` | All `sa:Agent` subclasses, `sagrant:FundAgent`, `sagrant:ValidatorAgent`, `sagrant:DAFAgent`, etc. |
| `prov:Activity` | All classes in §3.5 |
| `prov:Entity` | All classes in §3.6, §3.7, §3.8, §3.9; plus `sagrant:GrantAwardAgreement`, `sagrant:PledgeCommitment` (these are also `dul:Situation` per DnS) |

The reasoning power: any SPARQL query asking "give me everything that flowed into Maria's outcome report" can use PROV-O properties (`wasDerivedFrom`, `wasInfluencedBy`, `wasAssociatedWith`) and get the lineage chain across all our objects.

### 4.1 Canonical PROV-O lineage (the trust loop)

```turtle
?donor a sagrant:DonorRole .
?donor sagrant:hasIntent ?giftIntent .

?pledge a sagrant:PledgeCommitment ;
        sagrant:formalizesIntent ?giftIntent ;
        prov:wasAttributedTo ?donor ;
        sagrant:contributesToFund ?fund .

?contribution a sagrant:ContributionActivity ;
        prov:used ?pledge ;
        prov:wasAssociatedWith ?donor ;
        prov:generated ?fundPoolEntry .

?recipient a sagrant:RecipientRole .
?recipient sagrant:hasIntent ?needIntent .

?proposal a sagrant:Proposal ;
        sagrant:basedOnIntent ?needIntent ;
        prov:wasAttributedTo ?recipient ;
        sagrant:submittedTo ?fund .

?approval a sagrant:ApprovalActivity ;
        prov:used ?proposal ;
        prov:wasAssociatedWith ?fund ;
        prov:generated ?award .

?award a sagrant:GrantAwardAgreement ;
       sagrant:fundsProposal ?proposal ;
       sagrant:allocatesFromPool ?fundPoolEntry .

?disbursement a sagrant:DisbursementActivity ;
        prov:used ?award ;
        prov:wasAssociatedWith ?fund ;
        prov:actedOnBehalfOf ?donor ;        # the responsibility chain!
        prov:generated ?recipientCredit .

?report a sagrant:OutcomeReport ;
        prov:wasAttributedTo ?recipient ;
        prov:wasInformedBy ?disbursement .

?validation a sagrant:OutcomeValidationActivity ;
        prov:used ?report ;
        prov:wasAssociatedWith ?validator ;
        prov:generated ?trustUpdate .

?trustUpdate a sagrant:TrustUpdate ;
        sagrant:appliesTo ?recipient ;
        sagrant:appliesTo ?fund .
```

This is the canonical chain. It's queryable via SPARQL. It satisfies every PROV-O regulation.

---

## 5. DOLCE+DnS triangles

Three central DnS triangles in our system. Each is a `Description` defining roles, satisfied by a `Situation` binding agents to those roles.

### 5.1 The Funding Triangle

**Description:** `sagrant:FundMandate`
**Roles defined:** `sagrant:DonorRole`, `sagrant:RecipientRole`, `sagrant:FunderRole`, `sagrant:ValidatorRole`
**Situation that satisfies it:** `sagrant:GrantAwardAgreement`

```turtle
:NoCoTraumaCareFundMandate2026
    a sagrant:FundMandate, dul:Description, prov:Plan ;
    sagrant:definesRole [
      a dul:Role ;
      sagrant:roleType sagrant:DonorRole ;
      sagrant:rolePolicy [ acceptsGiftKinds ('CapitalOffer'); minimumPledge "$10" ]
    ];
    sagrant:definesRole [
      a dul:Role ;
      sagrant:roleType sagrant:RecipientRole ;
      sagrant:rolePolicy [ fundsNeedKinds ('TraumaCareNeed'); geoRoot "us/colorado" ]
    ];
    sagrant:definesRole [
      a dul:Role ;
      sagrant:roleType sagrant:FunderRole ;
      sagrant:rolePolicy [ governanceModel "single-coach"; coach :paMaria ]
    ];
    sagrant:hasGovernancePolicy :NoCoTraumaSingleCoachPolicy ;
    sagrant:hasStewardshipPolicy :NoCoTraumaStewardshipPolicy .

:Award_Ana_TraumaCare_Q2_2026
    a sagrant:GrantAwardAgreement, dul:CommitmentSituation, prov:Entity ;
    dul:satisfies :NoCoTraumaCareFundMandate2026 ;
    dul:hasParticipant :paAna ;       # plays RecipientRole
    dul:hasParticipant :NoCoTraumaCareFund ;  # plays FunderRole
    dul:hasParticipant :paSarah ;     # plays DonorRole (one of many)
    sagrant:fundsProposal :AnaTraumaProposal ;
    sagrant:awardedAmount "50000"^^xsd:decimal ;
    sagrant:expectedOutcomes :TraumaTrainingOutcomes_Q2_2026 .
```

The triangle: Mandate (description) → defines roles → satisfied by Award (situation) → with agents playing roles.

### 5.2 The Stewardship Triangle

**Description:** `sagrant:StewardshipPolicy`
**Roles defined:** `sagrant:StewardRole`, `sagrant:GovernanceMemberRole`
**Situation that satisfies it:** A particular acknowledgment cycle / reporting cycle

```turtle
:NoCoTraumaStewardshipPolicy
    a sagrant:StewardshipPolicy, dul:Description ;
    sagrant:definesRole [
      a dul:Role ; sagrant:roleType sagrant:StewardRole ;
      sagrant:roleResponsibilities (
        sagrant:HonorRestrictions
        sagrant:TimelyAcknowledgment
        sagrant:TruthfulCommunication
        sagrant:AvoidGiftHardship
      )
    ];
    sagrant:acknowledgmentCadence "P3M"^^xsd:duration ;
    sagrant:transparencyLevel sagrant:DonorReadable ;
    sagrant:storyPermissionsDefault sagrant:AggregatedAnonymized ;
    sagrant:complianceStandard "ECFA Standard 7"@en .
```

### 5.3 The Activation Triangle

**Description:** `sagrant:Campaign` (a description of a mobilization)
**Roles defined:** `sagrant:CampaignParticipantRole`, `sagrant:MatcherRole`
**Situation that satisfies it:** A particular `sagrant:CampaignParticipation` moment

```turtle
:YearEnd2026CampaignDescription
    a sagrant:Campaign, dul:Description ;
    sagrant:definesRole [
      a dul:Role ; sagrant:roleType sagrant:CampaignParticipantRole ;
      sagrant:rolePolicy [ minimumGift "$25" ]
    ];
    sagrant:definesRole [
      a dul:Role ; sagrant:roleType sagrant:MatcherRole ;
      sagrant:rolePolicy [ matchRatio "1.0"; cap "$50000" ]
    ];
    sagrant:campaignWindow [ start "2026-12-01"; end "2026-12-31" ] ;
    sagrant:targetMandate :NoCoTraumaCareFundMandate2026 ;
    sagrant:goalAmount "100000"^^xsd:decimal ;
    sagrant:storyAttachments (:TraumaCareImpactStory_Q3_2026 ) .
```

Each triangle gives us reasoning power: SPARQL queries like "find all situations that satisfy mandate X with at least 5 donor-role participants" are well-defined.

---

## 6. Object properties — comprehensive

Organized by domain.

### 6.1 Identity / structure

| Property | Domain → Range | Inverse | Characteristics |
|---|---|---|---|
| `sa:hubHostsFund` | `sa:HubAgent` → `sagrant:FundAgent` | `sa:fundHostedByHub` | |
| `sagrant:fundGovernedBy` | `sagrant:FundAgent` → `sa:Agent` | `sa:governs` | |
| `sagrant:isMemberOfCircle` | `sa:PersonAgent` → `sagrant:GivingCircleAgent` | `sagrant:hasCircleMember` | |
| `sagrant:operatesUnderHub` | `sagrant:FundAgent` → `sa:HubAgent` | `sa:hostsFund` (alias) | |

### 6.2 Mandate / Description

| Property | Domain → Range | Inverse | Characteristics |
|---|---|---|---|
| `sagrant:hasMandate` | `sagrant:FundAgent` → `sagrant:FundMandate` | `sagrant:isMandateOf` | |
| `sagrant:refinesIntoRound` | `sagrant:FundMandate` → `sagrant:GrantRound` | `sagrant:refinesFromMandate` | |
| `sagrant:hasGovernancePolicy` | `sagrant:FundMandate` → `sagrant:GovernancePolicy` | | |
| `sagrant:hasStewardshipPolicy` | `sagrant:FundMandate` → `sagrant:StewardshipPolicy` | | |
| `sagrant:hasAllocationStrategy` | `sagrant:FundMandate` → `sagrant:AllocationStrategy` | | |
| `sagrant:definesRole` | `dul:Description` → `dul:Role` | | |
| `sagrant:roleType` | `dul:Role` → `sagrant:Role` (subclass) | | |
| `sagrant:rolePolicy` | `dul:Role` → blank node with policy fields | | |
| `sagrant:eligibilityRules` | `sagrant:FundMandate` → `sagrant:EligibilityPredicate` (collection) | | |
| `sagrant:identityRequirement` | `sagrant:FundMandate` → `sagrant:CredentialRequirement` (collection) | | |

### 6.3 Intent / Pledge / Proposal

| Property | Domain → Range | Inverse | Characteristics |
|---|---|---|---|
| `sa:hasIntent` (existing) | `sa:Agent` → `sa:Intent` | `sa:intentOf` | |
| `sagrant:hasFundingMechanism` | `sa:Intent` → `sagrant:FundingMechanism` (skos:Concept) | | |
| `sagrant:formalizesIntent` | `sagrant:PledgeCommitment` → `sagrant:GiftIntent` | `sagrant:hasFormalPledge` | |
| `sagrant:basedOnIntent` | `sagrant:Proposal` → `sagrant:NeedIntent` | `sagrant:hasProposal` | |
| `sagrant:contributesToFund` | `sagrant:PledgeCommitment` → `sagrant:FundAgent` | `sagrant:receivesPledge` | |
| `sagrant:submittedTo` | `sagrant:Proposal` → `sagrant:FundMandate` ∪ `sagrant:GrantRound` | `sagrant:hasSubmittedProposal` | |
| `sagrant:hasRestriction` | `sagrant:PledgeCommitment` → `sagrant:Restriction` | | |
| `sagrant:hasMilestone` | `sagrant:Proposal` → `sagrant:Milestone` (collection) | | |
| `sagrant:requestsResource` | `sagrant:Proposal` → `sagrant:Resource` | | |
| `sagrant:promisesOutcome` | `sagrant:Proposal` → `sagrant:OutcomeDescriptor` | | |
| `sagrant:hasReportingObligation` | `sagrant:Proposal` ∪ `sagrant:GrantAwardAgreement` → `sagrant:ReportingObligation` | | |

### 6.4 Award / Disbursement

| Property | Domain → Range | Inverse | Characteristics |
|---|---|---|---|
| `sagrant:fundsProposal` | `sagrant:GrantAwardAgreement` → `sagrant:Proposal` | `sagrant:fundedByAward` | |
| `sagrant:awardedAmount` | `sagrant:GrantAwardAgreement` → `xsd:decimal` | | (datatype) |
| `sagrant:hasTranche` | `sagrant:GrantAwardAgreement` → `sagrant:Tranche` (collection) | `sagrant:trancheOf` | |
| `sagrant:expectsOutcome` | `sagrant:GrantAwardAgreement` → `sagrant:OutcomeDescriptor` | | |
| `sagrant:disburses` | `sagrant:DisbursementActivity` → `sagrant:Tranche` | `sagrant:wasDisbursed` | |
| `sagrant:allocatesFromPool` | `sagrant:GrantAwardAgreement` → `sagrant:FundPoolEntry` (collection) | | |
| `sagrant:respectingRestriction` | `sagrant:GrantAwardAgreement` → `sagrant:Restriction` (collection) | | |

### 6.5 Outcome / Validation / Trust

| Property | Domain → Range | Inverse | Characteristics |
|---|---|---|---|
| `sagrant:reportsOn` | `sagrant:OutcomeReport` → `sagrant:GrantAwardAgreement` | `sagrant:hasOutcomeReport` | |
| `sagrant:validates` | `sagrant:OutcomeValidationActivity` → `sagrant:OutcomeReport` | `sagrant:wasValidatedBy` | |
| `sagrant:updatesTrust` | `sagrant:OutcomeValidationActivity` → `sagrant:TrustUpdate` | | |
| `sagrant:appliesTo` | `sagrant:TrustUpdate` → `sa:Agent` (collection) | `sa:receivedTrustUpdate` | |
| `sagrant:hasStory` | `sagrant:OutcomeReport` → `sagrant:Story` (collection) | `sagrant:storyOf` | |

### 6.6 Activation / Storytelling

| Property | Domain → Range | Inverse | Characteristics |
|---|---|---|---|
| `sagrant:storyteller` | `sagrant:Story` → `sa:Agent` | | |
| `sagrant:storyAbout` | `sagrant:Story` → `prov:Entity` | | |
| `sagrant:hasStoryPermissions` | `sagrant:Story` → `sagrant:StoryPermissions` | | |
| `sagrant:trustVouchedBy` | `sagrant:Story` → `sa:Agent` (collection) | | |
| `sagrant:subscribesTo` | `sa:Agent` → `sagrant:FundAgent` ∪ `sa:HubAgent` ∪ `sa:Agent` | `sagrant:subscriberOf` | |
| `sagrant:subscriptionTopic` | `sagrant:Subscription` → `sagrant:OutreachKind` (skos:Concept) | | |
| `sagrant:consentBasis` | `sagrant:OutreachMessage` → `sagrant:ConsentBasis` (skos:Concept) | | |
| `sagrant:trustVouch` | `sagrant:OutreachMessage` → `sa:Agent` | | |

### 6.7 Privacy patterns

| Property | Domain → Range | Inverse | Characteristics |
|---|---|---|---|
| `sagrant:privacyPattern` | `sagrant:NeedIntent` → `sagrant:PrivacyPattern` (subclass) | | |
| `sagrant:coarseProjection` | `sagrant:NeedIntent` → `sagrant:CoarseProjection` | | |
| `sagrant:privateContent` | `sagrant:NeedIntent` → `sagrant:PrivateContent` | | (encrypted ref) |
| `sagrant:attestedBy` | `sagrant:NeedIntent` → `sagrant:TrustedIntermediaryAttestation` | | |
| `sagrant:proofOfAttribute` | `sagrant:NeedIntent` → `sagrant:ZKPredicateProof` | | |
| `sagrant:requiresCredential` | `sagrant:AccessPolicy` → `sagrant:CredentialRequirement` | | |

### 6.8 Campaign / Round

| Property | Domain → Range | Inverse | Characteristics |
|---|---|---|---|
| `sagrant:campaignWindow` | `sagrant:Campaign` → `time:Interval` | | |
| `sagrant:matchingPool` | `sagrant:Campaign` → `sagrant:FundPoolEntry` (collection) | | |
| `sagrant:matchRatio` | `sagrant:Campaign` → `xsd:decimal` | | datatype |
| `sagrant:targetsMandate` | `sagrant:Campaign` → `sagrant:FundMandate` | | |
| `sagrant:goalAmount` | `sagrant:Campaign` → `xsd:decimal` | | datatype |
| `sagrant:participatesInCampaign` | `sa:Agent` → `sagrant:Campaign` | | |

---

## 7. Datatype properties

Numeric, string, boolean attributes attached to entities.

```turtle
sagrant:populationCount         a owl:DatatypeProperty ; rdfs:range xsd:nonNegativeInteger .
sagrant:percentChristian        a owl:DatatypeProperty ; rdfs:range xsd:decimal .
sagrant:awardedAmount           a owl:DatatypeProperty ; rdfs:range xsd:decimal .
sagrant:matchRatio              a owl:DatatypeProperty ; rdfs:range xsd:decimal .
sagrant:goalAmount              a owl:DatatypeProperty ; rdfs:range xsd:decimal .
sagrant:cap                     a owl:DatatypeProperty ; rdfs:range xsd:decimal .
sagrant:confidenceScore         a owl:DatatypeProperty ; rdfs:range xsd:decimal . # SHACL: [0,1]
sagrant:cadence                 a owl:DatatypeProperty ; rdfs:range xsd:duration .
sagrant:roundDuration           a owl:DatatypeProperty ; rdfs:range xsd:duration .
sagrant:isDiasporaPopulation    a owl:DatatypeProperty ; rdfs:range xsd:boolean .
sagrant:requiresMatching        a owl:DatatypeProperty ; rdfs:range xsd:boolean .
sagrant:isAgentive              a owl:DatatypeProperty ; rdfs:range xsd:boolean .
sagrant:storyText               a owl:DatatypeProperty ; rdfs:range xsd:string .
sagrant:storyKind               a owl:DatatypeProperty ; rdfs:range xsd:string .  # SKOS in C-Box
sagrant:visibility              a owl:DatatypeProperty ; rdfs:range xsd:string .
sagrant:audience                a owl:DatatypeProperty ; rdfs:range xsd:anyURI .
sagrant:atlIri                  a owl:DatatypeProperty ; rdfs:range xsd:anyURI .
sagrant:onChainAssertionId      a owl:DatatypeProperty ; rdfs:range xsd:string .
```

---

## 8. SHACL constraints

The validation layer. Mirror the pattern from `tbox/people-groups.ttl` + `cbox/people-group-shapes.shacl.ttl`.

### 8.1 Mandate validity

```turtle
sagrant:FundMandateShape a sh:NodeShape ;
    sh:targetClass sagrant:FundMandate ;
    sh:property [
        sh:path sagrant:hasGovernancePolicy ;
        sh:minCount 1 ; sh:maxCount 1 ;
        sh:class sagrant:GovernancePolicy ;
    ];
    sh:property [
        sh:path sagrant:hasStewardshipPolicy ;
        sh:minCount 1 ; sh:maxCount 1 ;
    ];
    sh:property [
        sh:path sagrant:definesRole ;
        sh:minCount 3 ;   # at minimum: Donor, Recipient, Funder
        sh:nodeKind sh:BlankNodeOrIRI ;
    ];
    sh:property [
        sh:path sagrant:hasAllocationStrategy ;
        sh:minCount 1 ; sh:maxCount 1 ;
    ] .
```

### 8.2 Pledge integrity

```turtle
sagrant:PledgeShape a sh:NodeShape ;
    sh:targetClass sagrant:PledgeCommitment ;
    sh:property [
        sh:path prov:wasAttributedTo ;
        sh:minCount 1 ; sh:maxCount 1 ;
        sh:class sa:PersonAgent ;     # or OrgAgent
    ];
    sh:property [
        sh:path sagrant:contributesToFund ;
        sh:minCount 1 ; sh:maxCount 1 ;
        sh:class sagrant:FundAgent ;
    ];
    sh:property [
        sh:path sagrant:formalizesIntent ;
        sh:minCount 1 ; sh:maxCount 1 ;
        sh:class sagrant:GiftIntent ;
    ] .
```

### 8.3 Proposal integrity

```turtle
sagrant:ProposalShape a sh:NodeShape ;
    sh:targetClass sagrant:Proposal ;
    sh:property [
        sh:path sagrant:basedOnIntent ;
        sh:minCount 1 ; sh:maxCount 1 ;
        sh:class sagrant:NeedIntent ;
    ];
    sh:property [
        sh:path sagrant:submittedTo ;
        sh:minCount 1 ; sh:maxCount 1 ;
    ];
    sh:property [
        sh:path sagrant:promisesOutcome ;
        sh:minCount 1 ;
    ];
    sh:property [
        sh:path sagrant:hasMilestone ;
        sh:minCount 1 ;
    ] .
```

### 8.4 Award integrity

```turtle
sagrant:GrantAwardShape a sh:NodeShape ;
    sh:targetClass sagrant:GrantAwardAgreement ;
    sh:property [
        sh:path sagrant:fundsProposal ;
        sh:minCount 1 ; sh:maxCount 1 ;
        sh:class sagrant:Proposal ;
    ];
    sh:property [
        sh:path dul:satisfies ;       # DnS: must satisfy a mandate
        sh:minCount 1 ;
        sh:class sagrant:FundMandate ;
    ];
    sh:property [
        sh:path sagrant:awardedAmount ;
        sh:minCount 1 ; sh:maxCount 1 ;
        sh:datatype xsd:decimal ;
        sh:minInclusive 0 ;
    ] .
```

### 8.5 Outcome / validation provenance

```turtle
sagrant:OutcomeReportShape a sh:NodeShape ;
    sh:targetClass sagrant:OutcomeReport ;
    sh:property [
        sh:path sagrant:reportsOn ;
        sh:minCount 1 ; sh:maxCount 1 ;
    ];
    sh:property [
        sh:path prov:wasAttributedTo ;
        sh:minCount 1 ; sh:maxCount 1 ;
    ];
    sh:property [
        sh:path prov:wasInformedBy ;
        sh:minCount 1 ;       # must trace back through disbursement
    ] .

sagrant:OutcomeValidationShape a sh:NodeShape ;
    sh:targetClass sagrant:OutcomeValidationActivity ;
    sh:property [
        sh:path prov:used ;
        sh:minCount 1 ;
        sh:class sagrant:OutcomeReport ;
    ];
    sh:property [
        sh:path prov:wasAssociatedWith ;
        sh:minCount 1 ; sh:maxCount 1 ;
        sh:class sagrant:ValidatorAgent ;
    ] .
```

### 8.6 Privacy-pattern conditional shapes

```turtle
sagrant:CoarseOnlyNeedShape a sh:NodeShape ;
    sh:targetSubjectsOf sagrant:privacyPattern ;
    sh:sparql [
        sh:message "NeedIntents with coarse-only pattern must have a coarseProjection but no privateContent"@en ;
        sh:select """
            PREFIX sagrant: <https://smartagent.io/ontology/grants#>
            SELECT $this WHERE {
              $this sagrant:privacyPattern sagrant:CoarseOnlyPattern .
              FILTER NOT EXISTS { $this sagrant:coarseProjection ?p }
            }
        """ ;
    ] .

sagrant:SelectiveDisclosureShape a sh:NodeShape ;
    sh:targetSubjectsOf sagrant:privacyPattern ;
    sh:sparql [
        sh:message "NeedIntents with selective-disclosure pattern must declare AccessPolicy with required credentials"@en ;
        sh:select """
            PREFIX sagrant: <https://smartagent.io/ontology/grants#>
            SELECT $this WHERE {
              $this sagrant:privacyPattern sagrant:SelectiveDisclosurePattern .
              FILTER NOT EXISTS { $this sagrant:requiresCredential ?c }
            }
        """ ;
    ] .

sagrant:TrustedIntermediaryNeedShape a sh:NodeShape ;
    sh:targetSubjectsOf sagrant:privacyPattern ;
    sh:sparql [
        sh:message "NeedIntents with trusted-intermediary pattern must declare an attestation"@en ;
        sh:select """
            PREFIX sagrant: <https://smartagent.io/ontology/grants#>
            SELECT $this WHERE {
              $this sagrant:privacyPattern sagrant:TrustedIntermediaryPattern .
              FILTER NOT EXISTS { $this sagrant:attestedBy ?a }
            }
        """ ;
    ] .
```

### 8.7 Stewardship invariants (ECFA-aligned)

```turtle
sagrant:RestrictionRespectShape a sh:NodeShape ;
    sh:targetClass sagrant:GrantAwardAgreement ;
    sh:sparql [
        sh:message "Awards must respect all restrictions on contributing pledges"@en ;
        sh:select """
            PREFIX sagrant: <https://smartagent.io/ontology/grants#>
            SELECT $this WHERE {
              $this sagrant:allocatesFromPool ?entry .
              ?entry sagrant:fromPledge ?pledge .
              ?pledge sagrant:hasRestriction ?r .
              ?this sagrant:fundsProposal ?proposal .
              ?proposal sagrant:hasNeedKind ?nk .
              # If pledge restriction excludes the proposal's need kind, fail
              FILTER EXISTS {
                ?r sagrant:excludesKind ?nk .
              }
            }
        """ ;
    ] .

sagrant:AcknowledgmentDueShape a sh:NodeShape ;
    sh:targetClass sagrant:PledgeCommitment ;
    sh:sparql [
        sh:message "Pledges past acknowledgmentCadence without an Acknowledgment violate stewardship"@en ;
        sh:select """
            ... # SPARQL date arithmetic to find overdue pledges
        """ ;
    ] .
```

---

## 9. Controlled vocabularies (C-Box / SKOS schemes)

Live in `cbox/grants-vocabulary.ttl`.

### 9.1 FundingMechanism scheme

```turtle
sagrant:FundingMechanismScheme a skos:ConceptScheme .

sagrant:DirectSupport       a skos:Concept ; skos:inScheme sagrant:FundingMechanismScheme ;
                            skos:prefLabel "Direct Support"@en .
sagrant:FaithPromise        a skos:Concept ; skos:inScheme sagrant:FundingMechanismScheme ;
                            skos:prefLabel "Faith Promise"@en .
sagrant:ChurchMissionsBudget a skos:Concept ; skos:inScheme sagrant:FundingMechanismScheme .
sagrant:GrantRoundMode      a skos:Concept ; skos:inScheme sagrant:FundingMechanismScheme .
sagrant:GivingCircleMode    a skos:Concept ; skos:inScheme sagrant:FundingMechanismScheme .
sagrant:DonorAdvisedFundMode a skos:Concept ; skos:inScheme sagrant:FundingMechanismScheme .
sagrant:MatchingCampaign    a skos:Concept ; skos:inScheme sagrant:FundingMechanismScheme .
sagrant:Sponsorship         a skos:Concept ; skos:inScheme sagrant:FundingMechanismScheme .
sagrant:Benevolence         a skos:Concept ; skos:inScheme sagrant:FundingMechanismScheme .
sagrant:DisasterRelief      a skos:Concept ; skos:inScheme sagrant:FundingMechanismScheme .
sagrant:InKindSupport       a skos:Concept ; skos:inScheme sagrant:FundingMechanismScheme .
sagrant:VolunteerService    a skos:Concept ; skos:inScheme sagrant:FundingMechanismScheme .
sagrant:RecurringGift       a skos:Concept ; skos:inScheme sagrant:FundingMechanismScheme .
sagrant:OneTimeGift         a skos:Concept ; skos:inScheme sagrant:FundingMechanismScheme .
sagrant:RetroactiveFunding  a skos:Concept ; skos:inScheme sagrant:FundingMechanismScheme .
```

### 9.2 GovernanceModel scheme

```turtle
sagrant:GovernanceModelScheme a skos:ConceptScheme .

sagrant:SingleCoachGovernance         a skos:Concept ; skos:inScheme sagrant:GovernanceModelScheme .
sagrant:MultisigGovernance            a skos:Concept ; skos:inScheme sagrant:GovernanceModelScheme .
sagrant:DonorAdvisedGovernance        a skos:Concept ; skos:inScheme sagrant:GovernanceModelScheme .
sagrant:ConsensusLightGovernance      a skos:Concept ; skos:inScheme sagrant:GovernanceModelScheme .
sagrant:QuadraticAllocationGovernance a skos:Concept ; skos:inScheme sagrant:GovernanceModelScheme .
sagrant:ClusterQuadraticGovernance    a skos:Concept ; skos:inScheme sagrant:GovernanceModelScheme .
sagrant:DAOVoteGovernance             a skos:Concept ; skos:inScheme sagrant:GovernanceModelScheme .
sagrant:RetrospectiveVoteGovernance   a skos:Concept ; skos:inScheme sagrant:GovernanceModelScheme .
sagrant:BountyJudgeGovernance         a skos:Concept ; skos:inScheme sagrant:GovernanceModelScheme .
```

### 9.3 PrivacyPattern scheme

```turtle
sagrant:PrivacyPatternScheme a skos:ConceptScheme .

sagrant:SelectiveDisclosurePattern  a skos:Concept ; skos:inScheme sagrant:PrivacyPatternScheme .
sagrant:TrustedIntermediaryPattern  a skos:Concept ; skos:inScheme sagrant:PrivacyPatternScheme .
sagrant:CoarseOnlyPattern           a skos:Concept ; skos:inScheme sagrant:PrivacyPatternScheme .
sagrant:ZKPredicatePattern          a skos:Concept ; skos:inScheme sagrant:PrivacyPatternScheme .
sagrant:FundAsShieldPattern         a skos:Concept ; skos:inScheme sagrant:PrivacyPatternScheme .
sagrant:EscrowRevealPattern         a skos:Concept ; skos:inScheme sagrant:PrivacyPatternScheme .
```

### 9.4 ConsentBasis scheme

```turtle
sagrant:ConsentBasisScheme a skos:ConceptScheme .

sagrant:SubscribedConsent          a skos:Concept ; skos:inScheme sagrant:ConsentBasisScheme .
sagrant:PastRelationshipConsent    a skos:Concept ; skos:inScheme sagrant:ConsentBasisScheme .
sagrant:HubMediatedConsent         a skos:Concept ; skos:inScheme sagrant:ConsentBasisScheme .
sagrant:ValidatorBondedConsent     a skos:Concept ; skos:inScheme sagrant:ConsentBasisScheme .
sagrant:OpenCallConsent            a skos:Concept ; skos:inScheme sagrant:ConsentBasisScheme .
sagrant:TrustTierOptInConsent      a skos:Concept ; skos:inScheme sagrant:ConsentBasisScheme .
```

### 9.5 OutreachKind scheme

```turtle
sagrant:OutreachKindScheme a skos:ConceptScheme .

sagrant:SolicitForGift          a skos:Concept ; skos:inScheme sagrant:OutreachKindScheme .
sagrant:ProposalIntroduction    a skos:Concept ; skos:inScheme sagrant:OutreachKindScheme .
sagrant:ImpactStoryPublication  a skos:Concept ; skos:inScheme sagrant:OutreachKindScheme .
sagrant:CampaignAnnouncement    a skos:Concept ; skos:inScheme sagrant:OutreachKindScheme .
sagrant:InvitationToSubscribe   a skos:Concept ; skos:inScheme sagrant:OutreachKindScheme .
```

### 9.6 StewardshipStandard scheme (ECFA-aligned)

```turtle
sagrant:StewardshipStandardScheme a skos:ConceptScheme .

sagrant:HonorRestrictions       a skos:Concept ; skos:inScheme sagrant:StewardshipStandardScheme ;
                                skos:definition "Funds restricted by donor must be used as represented (ECFA Std 4)"@en .
sagrant:TimelyAcknowledgment    a skos:Concept ; skos:inScheme sagrant:StewardshipStandardScheme ;
                                skos:definition "Donors acknowledged appropriately and timely (ECFA Std 7c)"@en .
sagrant:TruthfulCommunication   a skos:Concept ; skos:inScheme sagrant:StewardshipStandardScheme ;
                                skos:definition "Appeals current, complete, accurate (ECFA Std 7a)"@en .
sagrant:AvoidGiftHardship       a skos:Concept ; skos:inScheme sagrant:StewardshipStandardScheme ;
                                skos:definition "Avoid gifts that result in family hardship (ECFA Std 7d)"@en .
sagrant:Transparency            a skos:Concept ; skos:inScheme sagrant:StewardshipStandardScheme ;
                                skos:definition "Financial statements available on request (ECFA Std 5)"@en .
sagrant:DisinterestedOversight  a skos:Concept ; skos:inScheme sagrant:StewardshipStandardScheme ;
                                skos:definition "Compensation set with disinterested oversight (ECFA Std 6)"@en .
```

---

## 10. T-Box file layout

The .ttl files we'd ship:

```
docs/ontology/
├── tbox/
│   ├── core.ttl                          [existing — sa: namespace]
│   ├── geo.ttl                           [existing]
│   ├── people-groups.ttl                 [existing — sapg:]
│   └── grants.ttl                        [NEW — sagrant: classes + properties]
├── cbox/
│   ├── hub-vocabulary.ttl                [existing]
│   ├── people-group-scopes.ttl           [existing]
│   ├── reachedness-vocabulary.ttl        [existing]
│   ├── people-group-shapes.shacl.ttl     [existing]
│   └── grants-vocabulary.ttl             [NEW — funding mechanism, governance model, privacy pattern, consent, ECFA standards]
│   └── grants-shapes.shacl.ttl           [NEW — SHACL constraints]
└── abox/
    ├── templates.ttl                      [existing]
    └── grants-demo.ttl                    [NEW — Wolof / Catalyst / CIL demo individuals]
```

Three new files:
- `tbox/grants.ttl` — class declarations + object/datatype properties (this is most of §3, §6, §7 of this doc)
- `cbox/grants-vocabulary.ttl` — SKOS schemes (§9)
- `cbox/grants-shapes.shacl.ttl` — SHACL constraints (§8)

Plus optional: `abox/grants-demo.ttl` for the Catalyst/CIL/Wolof demo data once seeded.

---

## 11. A-Box: Catalyst hub demo example

A complete example walking through the full lineage. Demonstrates how every class in the T-Box manifests in real instances.

```turtle
@prefix sagrant: <https://smartagent.io/ontology/grants#> .
@prefix sa: <https://smartagent.io/ontology/core#> .
@prefix sageo: <https://smartagent.io/ontology/geo#> .
@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix dul: <http://www.ontologydesignpatterns.org/ont/dul/DUL.owl#> .
@prefix : <https://smartagent.io/example/catalyst#> .

# ─── Hub + Fund agents ───────────────────────────────────────────────
:CatalystHub a sa:HubAgent .

:NoCoTraumaCareFund a sagrant:FundAgent ;
    sa:hostedByHub :CatalystHub ;
    sagrant:fundGovernedBy :paMaria ;
    sagrant:hasMandate :NoCoTraumaCareFundMandate2026 ;
    sa:displayName "NoCo Trauma-Care Fund"@en .

# ─── Mandate (Description) ──────────────────────────────────────────
:NoCoTraumaCareFundMandate2026
    a sagrant:FundMandate, dul:Description, prov:Plan ;
    sagrant:hasGovernancePolicy :NoCoSingleCoachPolicy ;
    sagrant:hasStewardshipPolicy :NoCoStewardshipPolicy ;
    sagrant:hasAllocationStrategy :SingleCoachAllocation ;
    sagrant:eligibilityRules
        [ sagrant:excludesKind sagrant:DisasterReliefNeedKind ;
          sagrant:requiresGeoPrefix "us/colorado" ] ;
    sagrant:identityRequirement
        [ sagrant:requiresCredential :VerifiedHuman ;
          sagrant:minTrustScore 5.0 ] .

# ─── Stewardship policy ─────────────────────────────────────────────
:NoCoStewardshipPolicy
    a sagrant:StewardshipPolicy, dul:Description ;
    sagrant:acknowledgmentCadence "P3M"^^xsd:duration ;
    sagrant:complianceStandard sagrant:HonorRestrictions ;
    sagrant:complianceStandard sagrant:TimelyAcknowledgment ;
    sagrant:complianceStandard sagrant:TruthfulCommunication ;
    sagrant:storyPermissionsDefault sagrant:AggregatedAnonymized .

# ─── Donor pledges ──────────────────────────────────────────────────
:paSarah a sa:PersonAgent ;
    sa:hasIntent :SarahGiftIntent2026 .

:SarahGiftIntent2026 a sagrant:GiftIntent ;
    sa:direction "give" ;
    sagrant:hasFundingMechanism sagrant:FaithPromise ;
    sagrant:offersResource :CapitalResource_5k ;
    sa:visibility "public-coarse" .

:Pledge_Sarah_NoCoTrauma_2026
    a sagrant:PledgeCommitment, dul:CommitmentSituation, prov:Entity ;
    prov:wasAttributedTo :paSarah ;
    sagrant:formalizesIntent :SarahGiftIntent2026 ;
    sagrant:contributesToFund :NoCoTraumaCareFund ;
    sagrant:hasRestriction
        [ sagrant:excludesKind sagrant:AdminOverhead ;
          sagrant:requiresGeoPrefix "us/colorado" ] ;
    sagrant:cadence "P12M"^^xsd:duration ;
    sagrant:awardedAmount "5000"^^xsd:decimal ;
    sagrant:onChainAssertionId "0xabc..." .

# ─── Recipient + need + proposal ───────────────────────────────────
:paAna a sa:PersonAgent ;
    sa:hasIntent :AnaTraumaCareNeed2026 .

:AnaTraumaCareNeed2026 a sagrant:NeedIntent ;
    sa:direction "receive" ;
    sa:visibility "public" ;
    sagrant:hasFundingMechanism sagrant:GrantRoundMode ;
    sagrant:requestsResource :CapitalResource_50k ;
    sa:locatedIn :WellingtonCO .

:AnaTraumaProposal2026
    a sagrant:Proposal, prov:Plan, prov:Entity ;
    prov:wasAttributedTo :paAna ;
    sagrant:basedOnIntent :AnaTraumaCareNeed2026 ;
    sagrant:submittedTo :NoCoTraumaCareFundMandate2026 ;
    sagrant:requestsResource :CapitalResource_50k ;
    sagrant:promisesOutcome :TrainTraumaLeadersOutcome ;
    sagrant:hasMilestone (
      [ sagrant:milestoneName "Trainer-onboarding"; sagrant:trancheAmount "15000" ]
      [ sagrant:milestoneName "Run-cohort-1"; sagrant:trancheAmount "20000" ]
      [ sagrant:milestoneName "Run-cohort-2"; sagrant:trancheAmount "15000" ]
    ) ;
    sagrant:hasReportingObligation
      [ sagrant:cadence "P3M"^^xsd:duration ;
        sagrant:contentExpected "written + financial + testimony" ] .

# ─── Approval activity → Award ─────────────────────────────────────
:Approval_AnaTrauma_2026Q2
    a sagrant:ApprovalActivity, sagrant:SingleCoachApproval, prov:Activity ;
    prov:used :AnaTraumaProposal2026 ;
    prov:wasAssociatedWith :paMaria ;
    prov:wasAssociatedWith :NoCoTraumaCareFund ;
    prov:atTime "2026-04-15T10:00:00Z"^^xsd:dateTime ;
    prov:generated :Award_AnaTrauma_2026Q2 .

:Award_AnaTrauma_2026Q2
    a sagrant:GrantAwardAgreement, dul:CommitmentSituation, prov:Entity ;
    dul:satisfies :NoCoTraumaCareFundMandate2026 ;
    sagrant:fundsProposal :AnaTraumaProposal2026 ;
    sagrant:awardedAmount "50000"^^xsd:decimal ;
    sagrant:hasTranche (:Tranche1 :Tranche2 :Tranche3) ;
    sagrant:expectsOutcome :TrainTraumaLeadersOutcome ;
    sagrant:respectingRestriction :Pledge_Sarah_NoCoTrauma_2026.restriction ;
    dul:hasParticipant :paAna ;        # plays RecipientRole
    dul:hasParticipant :NoCoTraumaCareFund ;  # plays FunderRole
    dul:hasParticipant :paSarah .      # plays DonorRole

# ─── Disbursement (after milestone 1 met) ──────────────────────────
:Disbursement_Tranche1
    a sagrant:DisbursementActivity, sagrant:TrancheReleaseActivity, prov:Activity ;
    prov:used :Award_AnaTrauma_2026Q2 ;
    prov:used :Tranche1 ;
    prov:wasAssociatedWith :NoCoTraumaCareFund ;
    prov:actedOnBehalfOf :paSarah ;     # <-- the responsibility chain!
    prov:atTime "2026-05-01T09:00:00Z"^^xsd:dateTime ;
    prov:generated :RecipientCredit_Tranche1 .

# ─── Outcome report + validation ───────────────────────────────────
:OutcomeReport_AnaTrauma_Cohort1
    a sagrant:OutcomeReport, prov:Entity ;
    prov:wasAttributedTo :paAna ;
    sagrant:reportsOn :Award_AnaTrauma_2026Q2 ;
    prov:wasInformedBy :Disbursement_Tranche1 ;
    sagrant:hasStory :TraumaImpactStory_Cohort1 .

:Validation_AnaTrauma_Cohort1
    a sagrant:OutcomeValidationActivity, prov:Activity ;
    prov:used :OutcomeReport_AnaTrauma_Cohort1 ;
    prov:wasAssociatedWith :sarah_validator ;   # acting as Validator
    prov:atTime "2026-08-15T14:00:00Z"^^xsd:dateTime ;
    prov:generated :TrustUpdate_Cohort1 .

:TrustUpdate_Cohort1
    a sagrant:TrustUpdate, prov:Entity ;
    sagrant:appliesTo :paAna ;          # +1 deposit
    sagrant:appliesTo :NoCoTraumaCareFund ;  # +1 deposit
    sagrant:appliesTo :sarah_validator . # +1 deposit (good validation)

# ─── Story ─────────────────────────────────────────────────────────
:TraumaImpactStory_Cohort1
    a sagrant:Story, prov:Entity ;
    sagrant:storyteller :paMaria ;
    sagrant:storyAbout :OutcomeReport_AnaTrauma_Cohort1 ;
    sagrant:storyKind sagrant:ImpactSummary ;
    sa:visibility "fund-donors-only" ;
    sagrant:hasStoryPermissions
      [ sagrant:namedRecipients (:paAna :paMaria) ;
        sagrant:redactionLevel sagrant:NamedWithConsent ;
        sagrant:photoPermissions () ] ;   # no photos
    sagrant:trustVouchedBy (:sarah_validator :paMaria) .
```

This single A-Box example exercises every major class in the ontology and lays out the full lineage from giver intent through outcome to trust update.

---

## 12. Cross-namespace integration

How `sagrant:` integrates with existing namespaces:

| Existing namespace | Integration |
|---|---|
| `sa:` | `sagrant:FundAgent rdfs:subClassOf sa:OrganizationAgent`. `sa:Intent` already has `sagrant:hasFundingMechanism` extension. `sa:Hub` has `sa:hostsFund` linking to `sagrant:FundAgent`. |
| `sageo:` | `sagrant:NeedIntent sa:locatedIn → sageo:GeoFeature`. Pledges and proposals can reference geo features. |
| `sapg:` | A people-group segment can be the `sa:locatedIn` target or the focus of a NeedIntent. `sapg:PeopleGroupPopulationSegment` references can appear as outcome targets. |
| `prov:` | All provenance edges as defined in §4. |
| `dul:` | `dul:Description` for FundMandate, `dul:Situation` for GrantAwardAgreement, etc. as in §5. |
| `skos:` | All controlled vocabularies in §9 use SKOS. |
| `time:` | Campaign windows, mandate validity intervals. |
| `geo:` | GeoSPARQL types via sageo:. |

---

## 13. The ontology supports every funding model

A final check: does the consolidated ontology genuinely support all 13 funding models from `funding-models-survey.md` + the 9 Gitcoin variants?

| Model | T-Box class | Configuration |
|---|---|---|
| Direct gift (1:1) | n/a — no fund | Just GiftIntent + NeedIntent + direct match |
| Donor-Advised Fund | `sagrant:DAFAgent` | governance.model = DonorAdvisedGovernance |
| RFP / foundation cycle | FundMandate + GrantRound | governance.model = SingleCoach or Multisig |
| Mutual aid pool | Standard FundAgent | eligibilityRules.membersOnly = true |
| Matching pool | FundMandate.matchingPool | governance.model = SingleCoach with match-aware allocator |
| Quadratic Funding | Standard FundMandate | governance.model = QuadraticAllocationGovernance |
| DAO treasury vote | Standard FundMandate | governance.model = DAOVoteGovernance |
| Prize / bounty | FundMandate | governance.model = BountyJudgeGovernance |
| Retroactive funding | FundMandate | governance.model = RetrospectiveVoteGovernance |
| Restricted gift | Pledge.hasRestriction | always available |
| Crowdfunding | Campaign + conditional Pledge | matchTriggers = atDeadlineIfGoalMet |
| Patronage | RecurringResource Pledge | cadence = monthly |
| Revenue-sharing | FundMandate + reverse-cashflow | mandate.kinds = CapitalNeed; engagement returns flow |
| **Faith Promise** | Campaign | hasFundingMechanism = FaithPromise; cadence = annual |
| **Missionary support** | Direct match | RecurringSupportCommitment |
| **Church missions budget** | OrgFundMandate | OrgAgent's internal fund |
| **Giving circle** | `sagrant:GivingCircleAgent` | governance.model = ConsensusLight |
| **Faith Promise + grant fund** | Campaign + FundMandate composite | both |
| **Allo Profile/Pool/Strategy** | sa:Agent + FundAgent + FundMandate.governance | direct mapping |
| **Gitcoin Passport / Stamps** | sagrant:CredentialRequirement on mandate | requiresCredential |
| **COCM clustering** | governance.model = ClusterQuadraticGovernance | Phase 5 |
| **Hypercerts** | OutcomeReport with retroactive flag | Phase 5 |

Every model has a place. The T-Box is comprehensive.

---

## 14. Ontologist agent's deliverables

For the ontologist agent (per `docs/agents/ontologist.md` role), this consolidated doc produces:

1. **`tbox/grants.ttl`** — class declarations + properties (~600 lines)
2. **`cbox/grants-vocabulary.ttl`** — SKOS schemes (~300 lines)
3. **`cbox/grants-shapes.shacl.ttl`** — SHACL shapes (~400 lines)
4. **`abox/grants-demo.ttl`** — demo individuals (~400 lines)
5. **GraphDB sync mapping** — what gets mirrored from on-chain assertions to GraphDB
6. **Codebase updates** — `packages/sdk/src/relationship-taxonomy.ts` adds new relationship types if needed; `packages/sdk/src/predicates.ts` adds new predicate hashes for new assertion kinds.

These are concrete deliverables for the ontologist pipeline (per `docs/information-architecture/people-groups-design.md` precedent).

---

## 15. Open questions

For ontologist + IA + security review:

1. **Reify Roles or use property-based?** Should `sagrant:DonorRole` be reified as a `dul:Role` instance with explicit policy data, or kept implicit via property paths? The architecture doc favors reification (cleaner DnS). Confirm with ontologist.

2. **Restriction as first-class object vs annotation on Pledge?** Currently modeled as first-class. Ensures restriction lineage is queryable; costs an extra IRI. Recommend keep as first-class.

3. **Fund subclass explosion** (`DAFAgent`, `GivingCircleAgent`, `CampaignFundAgent`) — are these justified subclasses or should they be modeled as FundAgent + FundMandate.kind? Recommend keep as subclasses because their behavior differs structurally (DAF auto-approves donor recommendations; GivingCircle votes; CampaignFund time-bounded). Different default policies.

4. **Story permissions detail level** — should `StoryPermissions` be a structured sub-graph or opaque blob? Recommend structured (`namedRecipients`, `namedBeneficiaries`, `photoPermissions`, `quotePermissions`, `redactionLevel` as separate properties) for queryability.

5. **Multiple agents in one role** — when 5 donors all play the DonorRole in the same Award, do we instantiate the role 5 times or use `dul:Role` with multiple `dul:hasParticipant`? Recommend the latter (DnS standard pattern).

6. **Outcome stories vs Outcome reports** — should they share a class or be distinct? Currently distinct (`Story` is narrative + permissions; `OutcomeReport` is data + evidence). Confirm — the use cases really do differ.

7. **Campaign as Description or Situation?** A campaign is both: it's described (mandate) and it's particular (this year's instance). Recommend the convention: `Campaign` is a Description; `CampaignParticipation` is the Situation. Explicit in §5.3.

8. **TrustUpdate granularity** — currently a single class for any trust delta. Could split into PositiveTrustUpdate / NegativeTrustUpdate / NeutralReview. Recommend keep single class for now; add subclasses if reasoning use cases demand.

---

## 16. Take-away

A clean and comprehensive ontology covers this area when:

1. **PROV-O** anchors the lineage (every entity / activity / agent properly typed)
2. **DOLCE+DnS** anchors the description/role/situation pattern (mandates, campaigns, stewardship policies all are formal Descriptions; awards, participations are formal Situations)
3. **SKOS** anchors the controlled vocabularies (funding mechanisms, governance models, privacy patterns, consent bases, stewardship standards)
4. **GeoSPARQL** anchors any geographic claim
5. **Smart-Agent existing namespaces** anchor identity / relationships / trust deposits
6. **A new `sagrant:` namespace** holds the genuinely-grant-specific terms

Every concept introduced across the seven design docs has a home in this T-Box. Every funding model from the survey + Gitcoin deep-dive maps to a configuration of these classes. Every privacy pattern has its constraint shape.

The ontology is the *spine*. The architecture, design, planning, and implementation docs build on it. The implementation produces the `.ttl` files plus the runtime systems (MCPs, allocators, BDI engines) that operate on instance data of these types.

This is the source of truth. The next steps:

1. Ontologist review for term naming, parent-class choices, SHACL completeness
2. IA review for storage placement and tier assignment
3. Security review for permission boundaries on each class's access patterns
4. Generate the actual `.ttl` files
5. Begin F1–F16 implementation per the architecture doc
