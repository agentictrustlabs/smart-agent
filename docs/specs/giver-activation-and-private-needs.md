# Giver Activation, Direct Messaging, and Funding Private Needs

**Status:** Strategic / design doc
**Companion to:** `faith-funding-and-stewardship.md`, `matchmaking-strategy.md`, `agentic-hub-and-bdi.md`
**Purpose:** Two product-strategy gaps the prior docs didn't fully cover:
> (1) How does a giver get *exposed* to a need, proposal, or fund — and from there decide to give? Generosity often starts with awareness, not search.
> (2) How do we fund needs whose details *can't be exposed* publicly (security-sensitive contexts, refugee aid, persecuted ministry, recovery from abuse)? Public discovery breaks; trust still has to flow.

This doc adds an **Activation lane** that cross-cuts the three structural lanes (relationship / pool / proposal) and presents **six concrete patterns for private-need funding** — the genuinely innovative territory in the design.

---

## 1. The activation gap

The previous docs assumed givers come to `/discover` knowing what they want to find. But faith giving (and most generosity) begins very differently:

- A friend forwards a missionary letter
- A pastor preaches on a need; congregation responds
- A campaign banner appears in a newsletter
- A child sponsorship card arrives in the mail
- Someone hears a testimony at a small group
- A fund's annual report lands with a story
- Year-end is approaching and donor wants to give "to something meaningful"

Each is **awareness flowing toward the giver**, not the giver searching. The desire to give is *catalyzed* by the encounter, not pre-formed.

This is the **Activation lane**. It's not a fourth structural lane — it's a *cross-cutting layer* that operates inside all three structural lanes:

```
                    ACTIVATION LAYER
   ┌─────────────────────────────────────────────────────┐
   │  exposures, stories, campaigns, push-messages,      │
   │  fund-agent solicitations, recipient-driven outreach │
   └─────────────────────────────────────────────────────┘
                          ↓
   ┌────────────┐  ┌────────────────────┐  ┌───────────────────┐
   │RELATIONSHIP│  │       POOL         │  │     PROPOSAL      │
   │    LANE    │  │       LANE         │  │       LANE        │
   │            │  │                    │  │                   │
   │ direct     │  │ funds / circles /  │  │ grant rounds /    │
   │ support    │  │ DAFs / FaithPromise│  │ DAOs / RFPs       │
   └────────────┘  └────────────────────┘  └───────────────────┘
                          ↓
                 [pledge / commitment / award]
                          ↓
                      [outcome / report / validation / trust]
```

Activation pushes givers *into* a lane. The lane carries the actual mechanics. Activation is its own design surface with its own primitives.

---

## 2. The activation primitives

### 2.1 Exposure objects

Three things a giver can be *exposed to*:

| Exposure object | What it is | Lives where |
|---|---|---|
| **Story** | Narrative + permissions; tied to a need / proposal / outcome / recipient | Either party's MCP; published with permission |
| **Campaign** | Time-bounded mobilization with goal + matching pool | Hub or fund's MCP |
| **NeedSnapshot** | Coarse public projection of a need (geography + kind + outcome — not identifying details) | On-chain (`atl:expressedIntent` with public-coarse visibility) |
| **MandateSnapshot** | Coarse public projection of a fund's mandate | On-chain (`atl:fundMandate`) |
| **CampaignAnnouncement** | "Match this campaign now" message | A2A push from hub or fund |

These all have *exposure surfaces*: places a giver might encounter them.

### 2.2 Exposure surfaces

Where a giver actually sees an exposure object:

| Surface | Channel | Push or pull? |
|---|---|---|
| **`/discover` matchcards** | Web UI | Pull — giver visits |
| **A2A direct message** | Person Agent's inbox | Push — sender initiates |
| **Hub announcements page** | Web UI | Pull |
| **Email digest** | Out-of-band | Push |
| **Mobile push notification** | OS push | Push |
| **Embedded story link** | Newsletter / website / social | Pull (clicked) |
| **Fund agent's BDI solicit** (Phase 5) | A2A | Push initiated by Fund's BDI loop |
| **Recipient-initiated outreach** | A2A | Push initiated by Recipient |
| **Aggregator signal** (RSS, hub feed) | External | Pull |

The matcher (matchmaking-strategy.md §11) covers `/discover` cards. This doc adds the **push** surfaces.

### 2.3 Push: the right to message

Critical principle: **a giver's inbox is theirs**. A Fund Agent or Recipient cannot send unsolicited messages without consent.

Three consent levels:

| Consent level | What's allowed | Default |
|---|---|---|
| **Subscribed** | Giver explicitly subscribed to a fund's updates / a recipient's reports / a hub's campaign feed | Per-subscription |
| **Past relationship** | Giver has previously pledged / supported / engaged; ongoing communication implied | Implicit unless opted out |
| **First-touch** | Giver has no prior relationship; sender wants to introduce | **Requires explicit gate** — see §3 |

This is the same email-marketing-respect-of-inboxes principle, extended to A2A. The system enforces consent rules; an agent that violates them gets trust-debited (TrustDeposit penalty) and may be blocklisted by the hub.

---

## 3. Direct messaging to funders / from funders

The user explicitly asked for direct-messaging mechanics for needs reaching funders. Here's the design surface.

### 3.1 Three direction patterns

```
1. Recipient → Donor
   "Hi, we have a need that matches your stated intent. Story + ask."

2. Recipient → Fund
   "We submitted a proposal. Could we discuss revisions?"

3. Fund → Donor
   "Your past intent matches our current campaign. Story + invitation."

4. Fund → Recipient
   "We see your need. Here's how to apply / pledge / join the network."

5. Hub → Donor / Fund / Recipient
   "Coordinated campaign: here's how to participate."
```

Each is a different message type with different consent rules.

### 3.2 The first-touch gate

Without consent, no first-touch DM. Options for legitimate first-touch:

| Mechanism | How it works | Consent model |
|---|---|---|
| **Hub-mediated introduction** | Sender requests hub to forward; hub approves and forwards if consent rules allow | Hub steward consents on behalf of community norms |
| **Public-channel post** | Sender posts to hub's public announcements; recipient sees in pull-mode `/discover` feed | No consent needed (public posting) |
| **Validator-bonded outreach** | Sender's outreach co-signed by a validator; recipient sees with validator's vouch attached | Validator consents; recipient's filter rules accept validator-bonded outreach |
| **Trust-tier opt-in** | Recipient sets "I accept first-touch from agents with trust ≥ X"; sender qualifies | Recipient consents preemptively |
| **Subscription invitation** | Sender posts "subscribe to my updates if interested"; recipient opts in then receives ongoing | Recipient self-subscribes |

The default for v1: **no first-touch DM without one of the above**. This is conservative; we can liberalize as the trust graph matures.

### 3.3 Message kinds for activation

Building on `agentic-hub-and-bdi.md` §3.1:

```yaml
SolicitForGift:
  from: <fund-agent>
  to: <donor>
  consent: subscribed | past-relationship | hub-mediated
  payload:
    mandate-summary
    storyAttachment (with permissions)
    askAmount
    callToAction
    optOutLink
  signedBy: fund's session signer
  trustVouch: <hub or validator IRI>

ProposalIntroduction:
  from: <recipient>
  to: <fund-agent>
  consent: hub-mediated | open-call (during round)
  payload:
    needSummary
    proposalDraft
    requestedAmount
    storyAttachment

ImpactStoryPublication:
  from: <fund-agent OR recipient>
  to: <subscribed-donors>
  consent: subscribed
  payload:
    outcomeSummary
    quotes (with story permissions)
    photos (if permitted)
    nextOpportunities

CampaignAnnouncement:
  from: <hub OR fund>
  to: <hub-members | subscribed-donors>
  consent: subscribed-or-member
  payload:
    campaign details
    timewindow
    matchingPool
    targetNeed
```

### 3.4 Acknowledgment loop

Every push message that asks for action MUST include:
- A **decline path** ("not now", "don't message me again", "unsubscribe")
- A **trust-cost** for the sender if recipient marks as spam (TrustDeposit penalty)

This makes outreach self-limiting. Spammy fund agents quickly lose ability to reach donors.

---

## 4. The activation user-journey, end-to-end

```
1. Steward / fund agent crafts a story
   - References a NeedSummary (anonymized as per StoryPermissions)
   - Includes coarse outcome data
   - Links to a CampaignAnnouncement or directly to a Pledge action

2. Story is published:
   - Fund's MCP holds full story
   - Public projection on-chain: `atl:storyPublished`
   - Hub feed surfaces the story
   - Subscribed donors receive A2A DM with story digest

3. Donor encounters story
   - In feed (pull) or DM (push)
   - Story carries: who validated, who's recommending, story permissions
   - Donor clicks → sees richer story (with selectively disclosed details if cross-delegation already exists)

4. Donor's *desire* is activated
   - Belief update: this need is real, validated, urgent
   - Desire emerges: "I want to help"
   - Person Agent's BDI: deliberate (which lane / mechanism?)

5. Match cards rendered for the donor
   - Direct (relationship) — if direct support is appropriate
   - Pool — pledge to matching fund
   - Proposal — sponsor specific proposal
   - Campaign — give to the active campaign

6. Donor commits via chosen lane
   - Pledge / contribute / propose / direct-give
   - Acknowledgment scheduled
   - Outcome tracking begins

7. Outcome flows back as Story
   - Story respects permissions
   - Donor sees impact
   - Activation cycle completes; donor is more activated for next round
```

This loop describes what the activation lane is *supposed* to feel like to the user. The product surfaces (feeds, DMs, story pages, match cards) implement it; the BDI engines run it.

---

## 5. The hard problem: funding private needs

Now the genuinely innovative territory. The user's specific framing:

> "Need innovative ways to overcome the security constraints to fund needs where details about them cannot be exposed."

Real-world examples where exposing details is dangerous:

- **Refugee aid**: identifying location/family puts them at further risk
- **Persecuted-context ministry**: identifying recipients endangers them
- **Trauma recovery / abuse survivors**: identifying victims re-traumatizes
- **Whistleblower legal defense**: identifying recipients gets them deplatformed
- **Domestic abuse safe-houses**: location secrecy is the whole point
- **Underground churches**: identifying members invites state retaliation
- **Substance recovery**: anonymity is therapeutic
- **Children in dangerous family situations**: identification is harmful
- **Investigative journalism support**: identification compromises the story

The system has to fund these without making the recipient's existence, location, identity, or specific situation public. But it also has to give the donor enough to decide.

### 5.1 The privacy / trust trade-off

The fundamental tension:

```
Donor needs:
   - some basis to trust the need is real
   - some basis to direct their giving
   - eventual evidence the gift achieved something

Recipient needs:
   - identity protection (per their threat model)
   - operational continuity
   - access to resources
```

These conflict directly with public discovery. The solution space requires *new primitives*: trust without disclosure, evidence without identification, story without revelation.

Six patterns follow. They can compose; a real deployment likely uses multiple.

---

### 5.2 Pattern 1 — Selective disclosure via AnonCreds

**Setup:**
- Recipient publishes a *coarse public projection* of need: "trauma-recovery support, NoCo, capacity-need-12-clients"
- The full need is private in recipient's MCP
- Recipient's eligibility credential: "validated-trauma-recovery-counselor, vetted-by-XYZ"
- Donor proves they meet some bar: "verified-donor", "non-state-actor", "background-checked-by-network"
- On consent, recipient issues a temporary cross-delegation revealing more details to donor for evaluation

**Trust assumptions:**
- Recipient's credential issuer is trustworthy
- Donor's credential issuer is trustworthy
- Cross-delegation tokens are properly scoped + revocable

**Donor experience:**
1. Sees coarse listing in `/discover` (or via push)
2. Clicks "Request to evaluate"
3. Presents credentials proving they qualify to see more
4. Recipient (or fund-as-broker) approves; cross-delegation flows
5. Donor sees richer detail (still possibly redacted)
6. Donor decides; pledges or declines

**Where it works:** Most flexible; supports continuum from "very little disclosure" to "full disclosure under NDA" by varying the credential bar.

**Where it breaks:** Requires functional credential issuance ecosystem. Requires recipient comfortable with having SOME identifiable existence even if details hidden. Sybil donors can pile up to extract data piecemeal.

**Existing infrastructure:** ✅ AnonCreds + verifier-mcp + holder-wallets in person-mcp. We have this.

---

### 5.3 Pattern 2 — Trusted-intermediary attestation

**Setup:**
- A *trusted steward* (validated person, verified org, vetted hub) attests on-chain: "I have verified this need is real, my reputation is at stake. Need IRI = X. Class = trauma-recovery. Coarse population = NoCo."
- The need's full details NEVER get published or shared with donors
- Donors see only the steward's attestation
- Donor decides based on the *steward's trust score*, not the need details

**Trust assumptions:**
- Steward's reputation is on the line (trust-staked attestation)
- Steward has actually verified
- Donor accepts steward-as-proxy

**Donor experience:**
1. Sees "Steward Maria has attested to a verified trauma-recovery need in NoCo. Coarse details only. $X requested."
2. Clicks Maria's profile to see her track record (other attestations she's made; their outcomes)
3. Decides to pledge based on Maria's trust, not the need
4. Funds flow through fund-as-shield (Pattern 5) to the recipient
5. Donor receives outcome report aggregated and anonymized (still no PII)

**Where it works:** Recipient identity stays fully invisible to donor. Donor relies on a *human* (or org) they trust. Mirrors how church benevolence works in practice — pastor knows who's in trouble; congregation gives to the pastor's discretion.

**Where it breaks:** Requires high-trust stewards. Steward becomes a single point of failure. Steward can be compromised or coerced.

**Mitigation:** Multiple stewards co-attest. Hub steward + outside auditor. Trust-staked attestation with slashing on dispute (TrustDeposit).

**Existing infrastructure:** ✅ TrustDeposit + AgentAssertion + per-agent trust scores. We have this.

---

### 5.4 Pattern 3 — Coarse-only public projection (no detail ever)

**Setup:**
- Need is published with *only* coarse attributes:
  - Need-kind tag (`trauma-recovery`, `legal-defense`, `safe-house`)
  - Geo-root prefix (`us/colorado` — not city, not county)
  - Capacity range (`5-20 clients`)
  - Time window (`immediate`, `Q2 2026`)
  - Outcome target (`X clients served`, `Y legal hours`, `Z relocation events`)
- No story
- No identifying details
- No pictures
- No quotes
- No specific location

**Trust assumptions:**
- Donor accepts giving "to a kind of work" without knowing specific recipients
- Recipient + fund + steward chain handles allocation accountability

**Donor experience:**
1. Sees "$50k needed for trauma-recovery work in NoCo, Q2 2026"
2. Sees the fund's mandate, governance, and aggregated past outcomes
3. Pledges to the *fund*, not to a specific recipient
4. Fund allocates internally; donor never knows recipient identity
5. Donor sees aggregated impact: "Q2: served 17 clients, 84% completed treatment"

**Where it works:** Maximum recipient privacy. Donor giving is a vote for *category* of work, not specific case. Fund agent's reputation does the trust work.

**Where it breaks:** Some donors won't give without specifics. Aggregated outcomes can feel impersonal. Trust requires the fund itself be trusted.

**Existing infrastructure:** ✅ Already supported — this is the natural mode for `visibility=public-coarse` on intents + `Restriction.kinds` on pledges.

---

### 5.5 Pattern 4 — ZK proofs of need attributes

**Setup:**
- Recipient computes a zero-knowledge proof of attributes about themselves without revealing the underlying values
- Proofs answer questions like: "I'm in geo X" (without revealing exact location), "I serve population Y" (without revealing names), "I have credential Z from issuer W" (without revealing which credential)
- Donor sees: a list of *verified attributes* + ZK proofs of their truthfulness
- Donor verifies proofs; decides

**Trust assumptions:**
- ZK math is sound (cryptographic assumption)
- Issuer of underlying attribute credentials is trustworthy

**Donor experience:**
1. Sees "Recipient verified: in conflict-zone geo cluster (proof attached); has ministry-credential since 2019 (proof attached); operates with population threshold X (proof attached)"
2. Verifies proofs (usually automatic in app)
3. Donor decides

**Where it works:** Strongest cryptographic guarantee. Zero leakage. Donor sees attestations of attributes without seeing the attributes themselves.

**Where it breaks:** Complex UX. ZK proof generation is heavy. Requires sophisticated tooling.

**Existing infrastructure:** ⚠️ AnonCreds *does* support ZK predicate proofs ("age ≥ 18" without revealing age, etc.). We have the rails. Real implementation requires defining the predicates per need-kind. Phase 5+.

---

### 5.6 Pattern 5 — Fund-as-shield (privacy-protecting passthrough)

**Setup:**
- Donor pledges to a fund whose *entire purpose* is to handle sensitive needs
- Fund's mandate: "I take in pledges. I disburse to verified recipients matching my mandate. I never disclose recipient identity to donors."
- Fund publishes ONLY: aggregate outcomes, audit attestations from third-party validators, financial statements
- Donor's relationship is *with the fund*, not the recipients

**Trust assumptions:**
- Fund is trustworthy (has its own reputation)
- Fund's stewardship is auditable in aggregate
- Validator (separate party) confirms outcomes credibly without revealing identities

**Donor experience:**
1. Sees fund "Refugee Resettlement Network Fund" with aggregate outcomes: "served 240 families in 2025, $1.2M disbursed, audited by XYZ"
2. Pledges to fund
3. Fund allocates; recipients never disclosed
4. Donor receives aggregate annual report with stories whose details have been anonymized per protocol
5. Validator publishes a separate audit attesting funds were used appropriately, without revealing recipient identities

**Where it works:** This is exactly how organizations like the Underground Railroad, modern refugee aid, and persecuted-church support funds operate today. Donor relationship is with the *organization*, not the field-recipients.

**Where it breaks:** Fund can become opaque/captured. Donors lose direct connection. Outcome data has limited verifiability without independent audit.

**Mitigation:** Multi-signer fund governance. External auditor with proper access. Trust-staked validator. Detailed financial statements without naming recipients.

**Existing infrastructure:** ✅ This is just our standard Fund-as-Agent pattern with maximum privacy settings on the mandate.

---

### 5.7 Pattern 6 — Escrow-then-reveal (commitment-bonded disclosure)

**Setup:**
- Donor commits *escrow* of pledge funds
- On commitment, recipient (or fund) reveals additional details under NDA-like terms
- If donor backs out after revelation, social/economic cost (TrustDeposit penalty)
- Encourages serious-only inquiry; deters fishing

**Trust assumptions:**
- Donor's commitment is binding (token escrow on-chain)
- Recipient revealed information is bound by donor's NDA acceptance
- Backing-out has consequences

**Donor experience:**
1. Sees coarse listing
2. Considers; commits escrow ($X locked for evaluation period)
3. Reveals details under NDA
4. Decides:
   - Confirms → escrow releases as pledge
   - Backs out → escrow refunded minus inquiry fee + trust-deposit penalty
   - Reports concern → escrow refunded; recipient notified

**Where it works:** Filters fishing donors. Aligns donor commitment with recipient privacy cost. Useful for high-value sensitive funding.

**Where it breaks:** Adds friction. May discourage casual donors. Requires escrow infrastructure.

**Existing infrastructure:** ⚠️ Phase 5+. Requires escrow contract + dispute resolution.

---

### 5.8 Comparison matrix

| Pattern | Privacy level | Donor effort | Trust burden | Existing infra | v1? |
|---|---|---|---|---|---|
| **1. Selective disclosure (AnonCreds)** | Medium-High | Medium | Distributed (recipient + donor credentials) | ✅ | ✅ v1 |
| **2. Trusted-intermediary attestation** | High | Low | Steward-centric | ✅ | ✅ v1 |
| **3. Coarse-only public projection** | High | Low | Fund-centric | ✅ (already in design) | ✅ v1 |
| **4. ZK proofs of attributes** | Highest | Low (UX complexity hidden) | Cryptographic | ⚠️ AnonCreds supports; needs predicate definitions | Phase 5 |
| **5. Fund-as-shield** | High | Low | Fund + validator | ✅ | ✅ v1 |
| **6. Escrow-then-reveal** | Medium | High | Distributed (escrow + dispute) | ⚠️ requires escrow contract | Phase 5+ |

**Recommendation for v1:** Ship Patterns 1, 2, 3, and 5. They cover most real-world sensitive-need scenarios with infrastructure we already have. Patterns 4 and 6 land in Phase 5+.

### 5.9 Composition

Real deployments compose. Examples:

- **Refugee fund**: Pattern 5 (fund-as-shield) + Pattern 2 (trusted intermediary attestation). Donors pledge to "Refugee Aid Fund"; fund operates Pattern 3 (coarse-only projection) for needs; trusted stewards (Pattern 2) attest to specific case validity; ZK proofs (Pattern 4 in Phase 5) verify location categories.

- **Trauma recovery**: Pattern 5 + Pattern 1 + Pattern 3. Fund-as-shield with public coarse mandate. Selective disclosure (AnonCreds) for high-trust donors who want details. Coarse public reporting for everyone else.

- **Persecuted-church support**: Pattern 5 + Pattern 4 (Phase 5). Fund-as-shield with ZK-proof mandates. Donors verify "recipient is in geo cluster X" without learning more.

- **Domestic abuse safe-house**: Pattern 5 + Pattern 6 (Phase 5). Fund-as-shield; escrow-then-reveal for major institutional gifts.

The matrix lets us match privacy primitives to risk levels without forcing one pattern on all sensitive cases.

---

## 6. Object-model additions for activation

Three new objects, attached to existing ones:

### 6.1 `Story` (new)

```yaml
Story:
  id: <uuid>
  storyteller: <agent>                    # the entity that authored
  about: <NeedIntent | Proposal | Award | OutcomeReport | Campaign>
  storyText: <markdown>
  storyKind: testimony | progress-update | impact-summary | call-to-action
  visibility: public | hub-members-only | fund-donors-only | private
  permissions:
    namedRecipients: [<agent IRI>, ...]   # who's named (may be empty)
    namedBeneficiaries: [<agent IRI>, ...] # who's named as beneficiary
    photoPermissions: [<photo-id>, ...]
    quotePermissions: [<quote-id>, ...]
    redactionLevel: full | aggregated | named-with-consent
  publicProjection:
    onChain: <atl:storyPublished assertion id>
    sharedWith: [<agent IRI>, ...]        # for selective-disclosure stories
  trustVouches: [<agent IRI>, ...]        # who attests this story is accurate
  createdAt: <iso>
  expiresAt: <iso>
```

A story is a first-class object because:
- It's the unit of activation
- It carries explicit permissions (StorePermissions)
- It can be linked to multiple other objects (e.g. one outcome → multiple stories at different abstraction levels)
- It can be selectively shared

### 6.2 `Subscription` (new)

```yaml
Subscription:
  subscriber: <person-agent>
  publisher: <fund | hub | recipient>
  topicKinds: [campaign-announcement, story-update, outcome-report, ...]
  cadence: realtime | daily-digest | weekly-digest | monthly-digest
  channels: [a2a-inbox, email, push]
  consentEvidence: <on-chain assertion or signed message>
  unsubscribeUrl: <action>
  startedAt: <iso>
  endedAt: <iso | null>
```

A subscription captures explicit consent for ongoing push messages. Without it, no first-touch DM (per §3.2).

### 6.3 `OutreachMessage` (new)

```yaml
OutreachMessage:
  from: <agent>
  to: <agent>
  kind: SolicitForGift | ProposalIntroduction | ImpactStoryPublication | CampaignAnnouncement | InvitationToSubscribe
  subject: <string>
  body: <markdown>
  attachments: [<Story id>, <NeedIntent id>, ...]
  signedBy: <session-signer>
  consentBasis: subscribed | past-relationship | hub-mediated | open-call | trust-tier
  trustVouch: <validator IRI | hub IRI>   # for first-touch outreach
  declineActions: ["not-interested", "unsubscribe", "block-sender"]
  trustBondedBy: <agent IRI>              # who's reputation is on the line
  sentAt: <iso>
  acknowledgedAt: <iso | null>
```

Each push message carries its consent justification + decline path + trust-vouch. Spam = trust deposit penalty.

### 6.4 Privacy-preserving need objects

For sensitive needs, augment `NeedIntent`:

```yaml
SensitiveNeedIntent:
  baseClass: NeedIntent
  privacyPattern: selective-disclosure | trusted-intermediary | coarse-only | zk-proof | fund-shield | escrow-reveal
  attestations: [<TrustedIntermediaryAttestation>, ...]
  zkProofs: [<predicate-proof>, ...]      # Phase 5
  coarseProjection:                       # the public-coarse view
    needKind: <iri>
    geoRoot: <prefix>
    capacityRange: [min, max]
    timeWindow: { start, end }
    outcomeTarget: <description>
  privateContent:                          # access-controlled
    fullDescription: <encrypted>
    beneficiaryDetails: <encrypted>
    storyPermissions: <see Story object>
  accessPolicy:
    requiredCredentials: [<credential-def-id>, ...]
    minimumTrustScore: <number>
    escrowRequired: <boolean>
    minimumPledge: <amount>                # for escrow-reveal
```

The `privacyPattern` field selects the disclosure mechanism. The matcher respects it; the storage encrypts; the access tools verify.

---

## 7. Implications for the matcher

The matchmaker (matchmaking-strategy.md) gets *richer* card output:

```
For donor with give-intent:
  ┌────────────────────────────────────────────────────────┐
  │  Direct match: Sofia needs Wellington coach           │ ← relationship
  ├────────────────────────────────────────────────────────┤
  │  Fund: NoCo Trauma-Care Fund                          │ ← pool
  │  Pledge $X | Recommend grant | Honor faith promise    │
  ├────────────────────────────────────────────────────────┤
  │  Active campaign: Year-end giving                     │ ← activation (cross-cutting)
  ├────────────────────────────────────────────────────────┤
  │  Story-driven: 3 new stories from funds you support   │ ← activation
  ├────────────────────────────────────────────────────────┤
  │  Sensitive needs: Refugee Resettlement Fund           │ ← private-need
  │  (fund-as-shield + trusted-attestation)               │
  │  See aggregated impact; no recipient detail required  │
  ├────────────────────────────────────────────────────────┤
  │  Selective disclosure available (with credentials):   │ ← private-need
  │  Trauma-recovery need in NoCo                         │
  │  Requires: VerifiedDonor credential + steward-vouched │
  │  [Get credential] [View details]                      │
  └────────────────────────────────────────────────────────┘
```

The card variety reflects the lane variety. Activation-lane cards (campaigns, stories) are surfaced alongside structural-lane cards (direct/pool/proposal) and privacy-pattern cards (fund-as-shield, selective-disclosure).

---

## 8. v1 scope and phasing

| Capability | v1 | Phase 5 | Phase 6+ |
|---|---|---|---|
| Story object as first-class | ✅ | | |
| StoryPermissions (basic) | ✅ | | |
| Subscription (basic, manual) | ✅ | | |
| Subscription cadence + digest | | ✅ | |
| OutreachMessage with consent gating | ✅ (basic) | rich first-touch gates | |
| Trust-bonded outreach | ⚠️ basic | full trust-staking | |
| Selective disclosure (AnonCreds) — Pattern 1 | ✅ | refined | |
| Trusted-intermediary attestation — Pattern 2 | ✅ | | |
| Coarse-only projection — Pattern 3 | ✅ | | |
| ZK predicate proofs — Pattern 4 | | ✅ | |
| Fund-as-shield — Pattern 5 | ✅ | | |
| Escrow-then-reveal — Pattern 6 | | ✅ | |
| Story → Activation feed UI | ⚠️ basic | rich feed | |
| Push notifications cross-channel | ⚠️ a2a-inbox only | + email + mobile push | |
| Adversarial detection (spam, fake stories) | | ⚠️ basic | full reputation algorithm |

---

## 9. Real-world examples

### 9.1 Catalyst hub story (already in our seed)

> A Wellington Circle gathering this Sunday: Ana shares testimony of 3 trauma-care training sessions complete. Maria (catalyst pastor) records story with Ana's consent (Story object). Story published to Catalyst hub feed. Subscribed donors receive A2A digest. One donor, Lisa, sees the story; her belief about the trauma-care work strengthens; her desire to pledge activates; she pledges $500 to NoCo Trauma-Care Fund (Pattern 3, coarse-only public projection of fund mandate). Ana never sees Lisa's identity directly; fund acknowledges via aggregated annual report.

### 9.2 Sensitive-need example

> A safehouse network in Northern Colorado needs $20k/month to operate. Names of clients can never be public. The Hub steward (Maria) knows the network operator personally; Maria attests on-chain: "I attest this network is verified, mandate-aligned, NoCo-located, helps domestic-abuse survivors. I stake my reputation." (Pattern 2). Donors can't see network or clients; they see Maria's attestation + her track record. Fund-as-shield (Pattern 5) collects pledges. The fund disburses monthly; outcome reports aggregated. A separate validator (a regional family-services org) audits annually with proper access; publishes audit attestation without naming clients. Donors get acknowledgment with aggregated outcome stats; never see clients.

### 9.3 Activation-driven gift

> Sarah subscribes to NoCo Trauma-Care Fund's monthly digest. December's digest includes: 3 stories from Q4 awards (with permitted detail), aggregate outcome ("17 leaders trained"), call-to-action for year-end matching campaign ($25k matching pool). Sarah's belief updates ("the fund is delivering"); desire activates ("I want to amplify this"); intention forms ("I'll pledge $250 to year-end campaign"). She acts; her $250 becomes $500 via the matching pool. Sarah's pledge appears in next year's aggregated report.

---

## 10. The bigger principle

Activation completes the loop. Without it:
- Discovery is purely active (giver searches)
- Sensitive needs can't be funded
- Funds can't grow donor base
- Stories don't make it from outcome back to next round

With it:
- Generosity flows in response to encounter, not just search
- Sensitive needs find trustworthy paths to funding
- Funds become storytellers and relationship-builders
- Outcome stories activate next round's giving

**The system isn't just a marketplace. It's a generosity loop.** Every outcome becomes a story; every story has the chance to activate new giving; every new gift becomes another seed for outcomes. That's the real product.

The technical primitives (Story, Subscription, OutreachMessage, SensitiveNeedIntent with privacyPattern) are how that loop is implemented. The lanes (relationship / pool / proposal) are the structural mechanisms. The activation layer is what makes the system *grow*.

---

## 11. Take-away

Two answers to the user's two questions:

**Q1 — "expose → desire → give" lane:** Implemented as the **Activation layer** that cross-cuts the three structural lanes. New primitives: `Story`, `Subscription`, `OutreachMessage`. New consent rules for first-touch DMs. New match-card variety on `/discover`.

**Q2 — funding sensitive needs:** Six composable patterns:
1. Selective disclosure via AnonCreds
2. Trusted-intermediary attestation
3. Coarse-only public projection
4. ZK proofs of attributes
5. Fund-as-shield
6. Escrow-then-reveal

v1 ships #1, #2, #3, #5. Phase 5 adds #4 and #6. The patterns compose; real deployments use multiple.

The framework now spans:
- **Three structural lanes** — relationship / pool / proposal
- **One activation layer** — exposure / push / story / subscription
- **Six privacy patterns** — for sensitive-need contexts
- **Five agent types** — Person / Org / Fund / Hub / Validator (each running BDI)
- **Multi-hub** — coherent identity, hub-scoped contexts

This is the full surface of the generosity protocol. The ontology consolidation doc puts it all in one machine-readable T-Box.
