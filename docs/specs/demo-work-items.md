# Demo Work Items — Catalyst NoCo Network

> **Scope**: this doc is Catalyst-only. Mission Collective (CIL) and Global.Church get their own files when their slices come up.
>
> **Item shape**: each item names (a) the role, (b) the real-world reference org/system that owns that role, (c) the on-chain artifact minted, (d) the trust-search query or demo moment it should make pass. Items are demo-prioritized; engineering priority lives in `backlog.md`.
>
> **Seeded agents** (`scripts/seed-catalyst.sh`): *Mekong Catalyst Network, Fort Collins Hub, Wellington / Laporte / Timnath / Loveland / Berthoud / Johnstown / Red Feather Circles, NoCo Growth Analytics, Maria Gonzalez (Program Director), Pastor David Chen (Hub Lead), Rosa Martinez (Facilitator), Carlos Herrera (Community Partner), Sarah Thompson (Regional Lead), Ana Reyes (Wellington), Miguel Santos (Laporte)*. Geography: Northern Colorado.
>
> **Hub mode**: Catalyst — disciple-making / movement-multiplication.

---

## 1. Mission Intelligence & Strategic Targeting (NoCo scope)

> *Where is the gospel least accessible, where are workers needed, where should resources go — applied to the NoCo region.*

- [ ] **NoCo least-reached zip-code dataset** — *role: research / prioritization; ref: PeopleGroups.org domestic-UPG approach + Barna State of the Church demographic data.* Seed a "NoCo Demographic Research" issuer agent that mints `AgentAssertion`s with `subjectType=GeoFeature`, attaching `unchurchedPercent`, `dominantLifestage`, `language` per zip-code. Trust-search "least-reached zip Loveland" returns the right tracts.
- [ ] **Diaspora-affinity tag** — *role: people-group analyst; ref: Joshua Project diaspora-of-UPGs methodology.* On `loveland.colorado.us.geo`, mint an `EngagementClaim` of relation `diasporaOf` against a Joshua Project people-group ID (e.g. Vietnamese diaspora in Loveland). Heat-map view filters circles by diaspora overlap.
- [ ] **Place-of-need claim with confidence** — *role: regional strategist; ref: Lausanne State of the Great Commission gap-analysis pattern.* **Sarah Thompson** mints `EngagementClaim engagedAmong` against the diaspora tag with `confidence=60`, `proficiencyScore=4000` (early stage). Discovery query "diaspora workers Loveland" returns Sarah.
- [ ] **Provenance-anchored research bundle** — *ref: W3C PROV-O.* Every research assertion carries `predecessorMerkleRoot` so re-importing the same Barna snapshot produces an identical `conceptHash`; old snapshots stay queryable but flagged stale past `validUntil`.
- [ ] **Disputed access-level** — *role: alliance accountability; ref: GACX overlap-resolution playbook.* When two circles claim "no church reached this zip," mint `AgentDisputeRecord` `flagged-by=Fort Collins Hub`. Network graph shows a red edge until **NoCo Growth Analytics** posts a resolving validation.
- [ ] **Federated demographic + engagement query** — *role: strategic targeter.* SPARQL joins demographic claims (above) with `EngagementClaim`s from circles to surface "high-need zips with no current engagement." UI renders a NoCo heat map with engagement gaps.
- [ ] **Sensitive-context redaction** — *role: research steward; ref: Open Doors closed-context guidance translated to NoCo refugee/diaspora cases.* Any zip flagged `Visibility=PublicCoarse` resolves to county-level only in public discovery; circle-internal queries see full granularity via delegation.

## 2. Prayer & Spiritual Mobilization

> *Coordinated intercession over named people, places, and movements — without leaking who is praying for whom.*

- [ ] **Adopted-zip prayer commitment** — *role: intercessor; ref: 24-7 Prayer / Operation World / Prayercast adoption pattern.* On **Rosa Martinez**, mint a `PrivateCommitment` claim `prayingFor` against `loveland.colorado.us.geo` zip-tract. Public count increments by +1 intercessor; identity remains hidden on the place page.
- [ ] **Anonymous prayer count for a circle** — *role: aggregate counter.* Aggregator query returns total intercessors per circle without enumerating commitments. **Wellington Circle** page shows "47 praying" badge sourced from blinded counts.
- [ ] **Sensitive prayer request** — *role: field-safe publisher; ref: GMCN closed-context request norms applied to refugee-serving NoCo circles.* Mint `OffchainOnly` `PrayerRequest` whose plaintext only resolves through person-mcp to relations within `Wellington Circle` (`OrganizationMembership` chain).
- [ ] **Prayer-campaign subscription** — *role: campaign host; ref: Joshua Project Unreached of the Day + Pray.com daily-cadence pattern.* Seed a "NoCo Daily Prayer" agent publishing a daily `Capability` advertisement; **Fort Collins Hub** subscribes via `Alliance` edge with `role=prayer-network-member`.
- [ ] **Prayer-to-mobilization handoff** — *role: discipleship router; ref: Perspectives Course mobilization-from-prayer model.* When a person mints both `prayingFor` and `mobilization-readiness` claims for the same place, the hub agent surfaces a "ready-to-send" suggestion to the regional lead.
- [ ] **Stale-prayer sweep** — *ref: PROV-O `validUntil`.* Prayer commitments older than the configured TTL (default 90 days) drop out of active counts and are flagged `stale`; intercessor receives a renewal nudge via the activity feed.
- [ ] **Cross-hub prayer alliance** — *ref: 24-7 Prayer hub-to-hub alliance pattern.* Mint `Alliance` edge `Fort Collins Hub → (sister catalyst hub agent)` with `role=prayer-partner-network`. Cross-hub query "prayer for Loveland diaspora" returns commitments from both networks.

## 3. Mobilization & Sending Pipeline

> *Move believers from awareness to participation: pray, give, go, send, train, support.*

- [ ] **Group-leader readiness claim** — *role: mobilizer; ref: Exponential / Movement Leaders Collective readiness rubrics.* Mint `practicesSkill mobilization-readiness-assessment` on **Maria Gonzalez** with `proficiencyScore=7500`, cross-issued by **Fort Collins Hub** via EIP-712. Search "mobilization readiness Fort Collins" returns Maria above no-skill peers.
- [ ] **Adopted-circle commitment** — *role: sending-side anchor; ref: Frontier Ventures / Finishing the Task adoption pattern.* Mint `OrganizationMembership` edge **Wellington Circle → Fort Collins Hub** with `role=adopted-circle` plus `validationProfile` from **NoCo Growth Analytics** witnessing healthy multiplication signals.
- [ ] **Capability publication for matching** — *role: hub-as-router; ref: GACX church-multiplication capability cards + A2A Agent Card.* Publish `gc:Capability match-circle-leader-to-neighbourhood` on **Fort Collins Hub**, scoped to NoCo, with `requiredAttestations=[discipleship-formation, local-residency]`.
- [ ] **Candidate-to-opportunity match** — *role: matchmaker; ref: TheCallCollective / Mission App candidate-matching pattern.* Cross-domain query: caller's held skills (Stage-B′ blinded) + open hub `Opportunity` records → ranked match list. Demo: **Carlos Herrera** matches a "neighborhood-host" opportunity in Berthoud.
- [ ] **Support-team relationship cluster** — *role: sender; ref: Navigators support-raising pattern.* Mint a `ServiceAgreement` star: 6+ `OrganizationMembership` edges into a "Carlos support team" hub agent with `role=monthly-supporter`; total support computed as a count, dollar amounts off-chain.
- [ ] **Short-term trip credential** — *role: short-term sending coordinator; ref: STEM Press / SCORE International short-term mission patterns.* Issue a `practicesSkill cross-cultural-short-term-team-leadership` AnonCred (v1) to **Miguel Santos** after a documented trip; presentable to a sister hub for trust-search boost without disclosing trip details.
- [ ] **Readiness gap report** — *role: hub coach; ref: Exponential next-step rubric.* For every uncredentialed person agent, surface a "next readiness milestone" badge driven by a SPARQL query against the readiness skill graph; update daily via `kb-write-through` hooks.

## 4. Discipleship & Spiritual Formation

> *Form people as disciples after initial response; mature them into multiplying communities.*

- [ ] **Faith-journey milestone (private)** — *role: small-group leader; ref: DMM obedience-based discipleship loop.* On **Ana Reyes**, mint `hasSkill obedience-based-discipleship-facilitation` with private `evidenceCommit` over a journey-stage transcript stored in person-mcp. Public claim shows skill; evidence redacted.
- [ ] **Mentor relationship** — *role: discipler; ref: Real Life Ministries / Navigators discipleship-relationship pattern.* Mint `OrganizationalControl` template-derived edge **Maria → Ana** with `role=mentor`, `templateId=catalyst.mentorship.v1`, scoped delegation `read-formation-records-for-mentee`.
- [ ] **Group-health attestation** — *role: hub coach; ref: 4 Fields / T4T health markers.* Mint `AgentValidationProfile` on **Wellington Circle** with `validationMethod=mutually-confirmed`, evidence pointing at the seven-marker health rubric, signed by **Pastor David Chen** as *circle-coach*.
- [ ] **Curriculum tag** — *role: formation-content steward; ref: BibleProject / Right Now Media / Alpha course taxonomy.* Each formation milestone references a `CurriculumNode` (`gc:Capability` subtype) so a person's journey is reconstructable across circles. Trust-search "Alpha-course alumni Loveland" works.
- [ ] **Baptism witness** — *role: church-integration witness; ref: Real Life Ministries discipleship-formation milestones.* Cross-issued `AgentValidationProfile` from **Pastor David Chen** witnessing a `Baptism` milestone on **Carlos Herrera**. Surfaced in profile as a verified milestone, not a self-claim.
- [ ] **Formation-recovery delegation** — *role: care provider; ref: Cloud-and-Townsend / Soul Care Network member-care framework.* When a milestone goes `stalled`, the formation pipeline auto-issues a scoped delegation `notify-care-team` to a seeded "NoCo Soul Care" agent (read-only access to milestone state).
- [ ] **Privacy-preserving cohort analytics** — *role: data steward; ref: differential-privacy aggregation patterns.* `Wellington Circle` cohort dashboard shows formation-stage counts but uses k-anonymity threshold (≥3 per bucket) so no individual journey is reverse-engineerable from public queries.

## 5. Gospel Proclamation & Digital Engagement

> *How people hear, encounter, understand, and respond to the gospel — physical and digital.*

- [ ] **Digital-evangelism agent registration** — *role: digital-ministry operator; ref: Indigitous / Global Media Outreach pattern.* Seed a "NoCo Digital Outreach" agent that publishes a JSON-LD `gc:AgentCapability` for `digital-seeker-conversation`, linked from `agentURI()`. Trust-ladder rung shown on its profile.
- [ ] **Seeker referral handoff** — *role: handoff coordinator; ref: Indigitous → local-church handoff pattern.* The digital agent issues a one-time scoped delegation to **Fort Collins Hub** carrying `language + region + readiness-stage` only — no name, no platform, no chat history. Hub intake action requires those three attributes.
- [ ] **Content-provenance tag** — *role: content publisher; ref: schema.org `CreativeWork` + C2PA provenance.* Each gospel-content asset carries a `provenanceCommit` and `licenseUri`; downstream republishing chain is traceable in PROV-O view.
- [ ] **Seeker journey privacy fence** — *role: privacy steward; ref: GDPR / consent-by-default norms.* Seeker contact records are `OffchainOnly` until the seeker mints a self-claim joining a circle. Public discovery never exposes seeker identity; only counts.
- [ ] **Multilingual capability discovery** — *role: language-aware router; ref: BibleProject multilingual catalog pattern.* `agentsForCapability('digital-seeker-conversation', languageFilter=es)` returns Spanish-speaking circle leaders (e.g. **Ana Reyes**, **Miguel Santos**) above English-only matches.
- [ ] **AI-generated content disclosure** — *role: content steward; ref: emerging C2PA + IAB AI-disclosure norms.* Any AI-authored proclamation asset carries a `gc:authoredByAgent` predicate naming the issuing AI agent (e.g. **NoCo Growth Analytics** when summarizing); UI badges accordingly.
- [ ] **Discipleship-handoff metric** — *role: MEL link.* SPARQL query joins digital-engagement claims to formation milestones to compute a "digital → discipled" conversion rate per circle; rendered in the activity feed weekly.

## 6. Church Multiplication

> *Where are circles multiplying, are they healthy, are they reproducing into G2 / G3 / G4 generations?*

- [ ] **Multiplication generation edge** — *role: parent → child plant; ref: NewThing / 100 Movements multiplication chain.* Add `Alliance` relationship **Wellington Circle → Timnath Circle** with `role=parent-of` and `metadataURI` carrying `generationDepth=2`. Lineage view renders the G1→G2→G3 chain.
- [ ] **Engagement claim against a place** — *role: planting team; ref: GACX engagement-claim schema.* Mint `GeoClaim` on **Loveland Circle** at `loveland.colorado.us.geo` with `relation=plantsIn`, `proficiencyScore=4000`, `assertionRef` linking to **Sarah Thompson** as regional lead.
- [ ] **Disputed-engagement handling** — *role: alliance accountability; ref: GACX overlap-resolution.* Two circles claiming the same census tract → mint `AgentDisputeRecord flagged-by=Fort Collins Hub`, surface red edge in network graph, route to alliance working group via **NoCo Growth Analytics**.
- [ ] **Health indicator on movement claim** — *role: movement reporter; ref: GACX church-health rubric / 4 Fields markers.* On **Wellington Circle**, mint `EngagementClaim multipliesIn` with `healthIndicator=multiplying-G3+` and `evidenceCommit` over the seven-marker health bundle.
- [ ] **G3+ generational depth view** — *role: lineage analyst; ref: NewThing generational-depth tracking.* Lineage page walks `parent-of` edges, computes max depth, renders a tree. Trust-search "G3+ multiplying circles NoCo" returns Wellington (G1) ↣ Timnath (G2) ↣ Johnstown (G3) chain.
- [ ] **Reproduction-pace metric** — *role: MEL aggregator; ref: T4T multiplication-velocity tracking.* `NoCo Growth Analytics` computes "circles started per active leader per quarter" from time-stamped `Alliance parent-of` edges; trend chart on dashboard.
- [ ] **Sensitive-circle protection** — *role: closed-context steward; ref: Open Doors security guidance translated to refugee-serving circles.* Seed a **Berthoud underground house-church** placeholder agent at `Visibility=PublicCoarse`; verify public discovery cannot enumerate members; only delegated callers with `Alliance member-of` see full membership.

## 7. Leadership Development

> *Trained, Christlike leaders for every circle and sector.*

- [ ] **Coach credential** — *role: leadership trainer; ref: Catalyst Leadership Network / 100 Movements Academy.* Mint `certifiedIn coach-of-coaches` on **Pastor David Chen**, `issuer=Fort Collins Hub` (signed manifest until v1 on-chain `SkillIssuerRegistry`). Self-cap (≤6000) doesn't apply because issuer ≠ subject.
- [ ] **Portable training credential** — *role: cross-org learning record holder; ref: W3C Verifiable Credentials.* Issue a `SkillsCredential` (v1, AnonCred) to **Rosa Martinez** for `practicesSkill catalyst-facilitation`; verify on a sister hub without disclosing the issuer's full member list.
- [ ] **Theological-formation pathway** — *role: formation steward; ref: Denver Seminary / Asbury / Fuller pathway-design pattern.* Seed `gc:FormationPathway` records for the three NoCo training tracks (lay coach, group-leader, hub-lead); each milestone is a `gc:Capability` reference.
- [ ] **Mentor-mentee chain credential** — *role: cohort tracker; ref: Movement Leaders Collective mentor-cohort pattern.* Mint a chained `practicesSkill mentor-of-mentors` claim on **Maria Gonzalez**, with `evidenceCommit` over a hash of her mentees' attestations. SPARQL traversal renders a mentor tree.
- [ ] **Continuing-formation freshness** — *role: ongoing-learning steward; ref: ECFA continuing-education annual reset pattern.* Each leadership credential carries a `validUntil` (default 24 months) and re-attestation flow. Stale credentials drop out of "verified-only" trust-search rankings.
- [ ] **Selective-disclosure leader VC** — *ref: AnonCreds selective disclosure.* **Pastor David Chen** presents only `coachLevel + region` to a guest-preacher delegation flow — name, ordination history, and seminary stay private. Demo: cross-hub guest-preach without revealing his SBC ordination chain.
- [ ] **Leadership pipeline gap report** — *role: pipeline analyst.* Query: `circlesWithoutCertifiedCoach()`. Surfaces **Red Feather Circle** as needing a coach assignment; auto-suggests **Sarah Thompson** based on regional + skill match.

## 8. Integral Mission & Community Transformation (NoCo)

> *Mercy, justice, relief, development — applied to the NoCo region (food insecurity, refugee resettlement, addiction recovery, immigrant integration).*

- [ ] **Community-need registration** — *role: integral-mission operator; ref: Micah Network / Integral Alliance integral-mission framework.* Register a `CommunityNeed food-insecurity` artifact at `loveland.colorado.us.geo` with `safeguardingPolicyRef` and `consentScope=aggregate-only`.
- [ ] **Beneficiary-group privacy** — *role: relief-project lead; ref: Compassion International / World Vision beneficiary protection.* Beneficiary records are `PrivateCommitment` only; aggregate counts feed dashboards. Trust-search never surfaces beneficiaries by name.
- [ ] **Addiction-recovery partnership edge** — *role: integral-mission church anchor; ref: Celebrate Recovery / Teen Challenge partnership pattern.* Mint `Alliance` edge **Loveland Circle → (placeholder Teen Challenge NoCo agent)** with `role=recovery-program-host`.
- [ ] **Refugee-resettlement engagement claim** — *role: integral operator; ref: World Relief / WorldRenew / Lutheran Immigration Refugee Service patterns.* Mint `EngagementClaim servesRefugees` on **Carlos Herrera** at `fortcollins.colorado.us.geo` with `confidence=70`, evidence pinned.
- [ ] **Outcome claim with safeguarding redaction** — *role: development-project lead; ref: Tearfund outcome-tracking pattern.* Mint `practicesSkill recovery-program-facilitation` on **Carlos** with private `evidenceCommit` of beneficiary-anonymized outcomes; public claim shows skill, not beneficiaries.
- [ ] **Cross-domain integral query** — *role: gap analyst.* `agentsForConcept('addiction recovery', geoFilter=loveland)` joins skills + integral-mission engagement claims; returns **Carlos** with both signals reinforcing.
- [ ] **Partner-organization due-diligence link** — *role: alliance accountability; ref: ECFA + Charity Navigator pattern.* Each integral-mission partner agent carries a `Compliance` edge to a verifier (e.g. ECFA placeholder); trust-ladder rung surfaced on the partner's profile.

## 9. Resource Stewardship & Local Funding

> *Donor intent, restricted gifts, anti-duplication, funder-safe aggregation — applied to NoCo-local giving and grants.*

- [ ] **Restricted-gift commitment** — *role: local funder; ref: NCF (donor-advised fund) restricted-grant pattern.* Mint `ServiceAgreement` edge **(NoCo Generosity placeholder agent) → Fort Collins Hub** with `role=grant-funder`, delegation `disburse-tranche` capped by `ValueEnforcer` and gated on `TimestampEnforcer`.
- [ ] **Funding-need artifact** — *role: gap analyst; ref: Generosity Path / NCF funding-need taxonomy.* Mint `FundingNeed` on **Red Feather Circle** linked to a `Capability` ("provide weekly venue") and a `validUntil`; once met, status flips to closed.
- [ ] **Donor-safe aggregation** — *role: anonymized-donor reporter.* Stage-B′ blinded discovery query — caller's held private "monthly-supporter" credential boosts gap-match score without disclosing identity to the recipient circle.
- [ ] **Anti-duplication check** — *role: alliance accountability; ref: ECFA donor-protection norms.* Two `FundingNeed` artifacts on overlapping zips → mint `AgentDisputeRecord overlap` to surface duplicate fundraising before a donor double-funds.
- [ ] **Tranche-release outcome gate** — *role: outcome-bound funder; ref: Acumen Lean Data outcome-bound disbursement.* Tranche-2 delegation only redeems after a referenced outcome assertion (from `NoCo Growth Analytics`) lands within the validity window.
- [ ] **Donor-impact dashboard** — *role: aggregator; ref: Charity Navigator / Charity:Water donor-dashboard pattern.* Per-donor view shows funded circles, milestones met, and aggregate impact — sourced via SPARQL across funding edges + outcome assertions; donor identity stays private to recipients.

## 10. Monitoring, Evaluation & Learning

> *Make every score answer "what was claimed, who asserted it, who validated it, what evidence backs it, and what negative feedback exists?"*

- [ ] **Weekly health roll-up** — *role: data steward; ref: PROV-O claim chain.* **NoCo Growth Analytics** mints a weekly `AgentAssertion` of type `ORG_ASSERTED` aggregating `groupCount, baptisms, multiplicationDepth` across circles, with `predecessorMerkleRoot` linking to the prior week. Trust-search shows "evidence freshness ≤7d" badge.
- [ ] **Outcome-claim provenance chain** — *role: external evaluator; ref: Lausanne SOGC reporting cadence.* A second-tier validator (seeded as a separate person agent representing an external auditor) signs an `AgentValidationProfile` against last quarter's roll-up assertion; review surfaces in the trust-explanation panel.
- [ ] **Trust-explanation object** — *role: explainability surface; ref: validation-feedback-plan §4.5.* Each ranked agent in trust-search returns a structured explanation: `[claim → assertion → validation → review → dispute]` ladder; UI renders as a stack with green/yellow/red rungs.
- [ ] **Recency-decay sweep** — *ref: geo-recency pattern.* Claims past `validUntil` zero out; claims older than 2 years get a 0.5x decay multiplier. Demo: a stale 2024 health claim drops Wellington's score by ~30% until refreshed.
- [ ] **Negative-evidence aggregator** — *role: dispute resolver; ref: validation-feedback-plan §4.5.* Disputes against an agent surface as a count + types in the trust-explanation panel. Demo: a flagged claim against **Berthoud Circle** lowers its rank in the discovery list until a counter-validation lands.
- [ ] **Differential-privacy outcome rollup** — *role: privacy-preserving analyst; ref: emerging differential-privacy norms.* Per-zip outcome counts apply k-anonymity (≥3 per bucket); UI shows masked numbers when below threshold. Demo: small **Red Feather Circle** outcomes don't leak individual-level data.
- [ ] **Cross-silo MEL query** — *role: integrated reporter.* Single SPARQL query joins prayer commitments, mobilization readiness, formation milestones, multiplication chains, and integral-mission outcomes for one quarter; renders a NoCo State of Mission dashboard. Mirrors Lausanne SOGC at NoCo scale.

---

## Cross-Silo Recurring Patterns

| Pattern | Where it shows up | Real-world ref |
|---|---|---|
| Org-ID trust ladder (5 rungs) | Every org agent | schema.org Organization + GC-Core Org ID |
| Capability publication parity (human / org / AI) | Skills + endpoints across silos | OASF + A2A Agent Card + MCP tools |
| Engagement-claim schema | Mobilization (`adoptedCircle`), Multiplication (`plantsIn`), Integral (`servesRefugees`), Prayer (`prayingFor`) | GACX overlap registry |
| Stage-B′ blinded discovery contribution | Mobilization match, Funding match, Sensitive prayer | AnonCreds + caller-bound nonce |
| Validator + dispute pair | Every silo where a claim is high-stakes | ECFA / GACX / Lausanne working-group accountability |
| PROV-O provenance | All aggregated claims | W3C PROV-O |
| Privacy fence (`data/onchain` vs `data/private`) | All discovery queries | SHACL CI-checked invariant |
| Selective-disclosure VC presentation | Leadership credentials, seeker handoffs | W3C Verifiable Credentials + AnonCreds |

## Out-of-Scope for This Demo (deferred to v1+)

- ZK skill / geo / engagement match circuits
- On-chain `SkillIssuerRegistry` / `OrgIssuerRegistry` (signed manifest only for v0)
- Endorser / mentor / trainer skill modalities (`endorsesSkill`, `mentorsIn`)
- Cross-chain trust assertions
- Live federation against external Joshua Project / Barna / Operation World APIs (mock data only)
- Federated query against sister-hub graphs (single-hub demos first)

---

## Recommended Demo Slice Order

For Catalyst NoCo, the smallest valuable slice is **one item per silo, ending in a trust-search query that visibly improves**. Suggested order, each step adds one item from the corresponding silo and demonstrates a query change:

1. Silo 3 (Mobilization) — mint Maria's readiness claim → search "mobilization readiness Fort Collins" returns her ranked first.
2. Silo 4 (Discipleship) — mint Ana's mentor relationship + faith-journey milestone → cohort dashboard shows formation-stage counts.
3. Silo 6 (Multiplication) — mint Wellington→Timnath G2 edge → lineage view renders the chain.
4. Silo 2 (Prayer) — anonymous adoption → place page shows "47 praying" without identities.
5. Silo 7 (Leadership) — David's coach credential → cross-hub guest-preach selectively-discloses only level + region.
6. Silo 10 (MEL) — weekly health roll-up + trust-explanation object → ranked search shows the [claim → assertion → validation] ladder.

After those six, deepen each silo to its full 6+ items, then add silos 1, 5, 8, 9 as optional advanced demos.
