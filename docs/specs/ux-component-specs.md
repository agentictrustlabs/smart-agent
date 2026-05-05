# UX Component Specs — Top 5 Discover/Activation Priorities

**Status:** Component design spec for review
**Companions:** `matchmaking-strategy.md`, `giver-activation-and-private-needs.md`, `faith-funding-and-stewardship.md`, `agentic-hub-and-bdi.md`
**Purpose:** Concrete, implementable specs for the five components the UX review identified as blocking. Each spec gives props, variants, states, data sources, accessibility, and rendering composition. Detailed enough to start coding; abstract enough that a UX designer can iterate on visual direction.

This is *not* implementation. It's the contract between design and engineering — the artifact that lets both sides agree what's being built before any pixel or TSX line lands.

The five components, in priority order:

1. **`<MatchCard>`** — the unit of `/discover` output
2. **`<PrivacyChip>`** — vocabulary chip for the six privacy patterns
3. **`<ViewerModeToggle>`** — donor / recipient / fund-admin mode switcher
4. **`<StoryStrip>` + `<InboxFeed>`** — activation surfaces
5. **`<StewardshipCard>`** — ECFA-aligned trust signals on agent viewer

---

## 1. `<MatchCard>`

### 1.1 Purpose

Render one *strategic action* a user could take, derived from the matcher's output. Every card answers four questions in two seconds:

1. **What is this match about?** (subject + lane)
2. **Why should I trust it?** (trust path + privacy state)
3. **What happens next?** (predicted impact + urgency)
4. **What can I do?** (primary action + alternatives)

A `/discover` page is a stack of these. So is the fund-admin queue, the campaign feed, and the agent viewer's "available matches" sidebar.

### 1.2 TypeScript interface

```tsx
type MatchCardKind =
  | 'direct-match'                       // donor ↔ recipient direct
  | 'fund-mediated-submit-proposal'      // recipient → fund (apply)
  | 'fund-mediated-pledge'               // donor → fund (give)
  | 'fund-mediated-recommend-grant'      // DAF-style recommendation
  | 'fund-mediated-honor-faith-promise'  // recurring annual pledge
  | 'campaign-active'                    // time-bounded campaign
  | 'story-driven-activation'            // story-led card
  | 'sensitive-need-disclosure'          // request credential / unlock
  | 'fund-admin-queue'                   // fund principal's view
  | 'fund-admin-validate-outcome'        // outcome pending validation
  | 'fund-admin-allocate-round'          // round closing soon

type LaneKind = 'relationship' | 'pool' | 'proposal' | 'campaign'

interface MatchCardProps {
  // Identity
  id: string                              // for keys + memoization
  kind: MatchCardKind
  lane: LaneKind

  // Subject (left-side, primary)
  subject: AgentRef                       // person/org/fund/hub principal
  subjectIntent?: IntentRef               // what the subject is offering or asking for

  // Counterparty (when direct-match) OR mediator (when fund-mediated)
  counterparty?: AgentRef
  mediator?: { fund: AgentRef; mandate: MandateRef }

  // Trust signals
  trustPath: TrustPathSegment[]           // 1-4 hops; first hop = caller
  trustScore?: number                     // 0..10 overall
  endorsedBy?: AgentRef[]                 // top 1-3 endorsers

  // Privacy state
  privacyPattern: PrivacyPatternKind      // see PrivacyChip below
  privacyContext?: {
    granter?: AgentRef                    // for trusted-intermediary
    requiredCredential?: string           // for selective-disclosure
    fundShield?: AgentRef                 // for fund-shielded
  }

  // Predicted impact / urgency
  predicted?: {
    impact: string                        // e.g. "$25 funds 1 trauma-trainer-week"
    multiplier?: number                   // e.g. 2.5x for matching pool
    expectedTimeline?: string             // e.g. "decision in 14d"
  }
  urgency?: {
    deadline: string                      // ISO
    cadence?: 'one-time' | 'recurring' | 'campaign'
  }

  // Activation context (when kind ends with -activation or story-driven)
  story?: StoryRef                        // see StoryStrip
  campaign?: CampaignRef

  // Hub context (for multi-hub display)
  hubContext: { hubAddress: string; hubName: string }

  // Actions
  actions: MatchAction[]                  // ≤ 3; first is primary
  overflow?: MatchAction[]                // shown in a "..." menu

  // Behavior
  onActivate?: (action: MatchAction) => void | Promise<void>
  onDismiss?: () => void                  // for "not interested" / mute
  onExpandTrustPath?: () => void
  onExpandStory?: () => void
}

interface AgentRef {
  address: string
  displayName: string
  agentType: 'person' | 'org' | 'fund' | 'hub' | 'ai'
  avatarUrl?: string
  agentNameAtl?: string                   // e.g. 'sione.swo.catalyst.agent'
}

interface IntentRef {
  id: string
  kind: string                            // e.g. 'sa:CoachingOfferType'
  direction: 'give' | 'receive'
  summary: string
  geoRoot?: string                        // e.g. 'us/colorado'
  capabilities?: string[]
  visibility: 'public' | 'public-coarse' | 'private'
}

interface MandateRef {
  id: string
  fundAddress: string
  acceptsKinds: string[]
  governanceModel: string                 // 'single-coach' | 'multisig' | ...
  geoRoot?: string
}

interface TrustPathSegment {
  fromAgent: AgentRef
  toAgent: AgentRef
  relationship: string                    // 'endorses' | 'coaches' | 'hub-member' | ...
  weight?: number                         // strength of this hop
}

interface MatchAction {
  id: string
  verb: string                            // imperative — "Pledge $25", "Submit proposal"
  variant: 'primary' | 'secondary' | 'overflow' | 'destructive'
  icon?: string                           // lucide-react name
  href?: string                           // for nav
  onClick?: () => void | Promise<void>
  disabled?: boolean
  disabledReason?: string                 // shown in tooltip
  caveat?: string                         // e.g. "requires VerifiedHuman credential"
}
```

### 1.3 Composition (the five slots)

```
┌─────────────────────────────────────────────────────────────┐
│ ┌─────┐  Subject Line                          [Lane chip]  │   ← header row
│ │ Av  │  Sione → Senegal Wolof Outreach        [Pool]       │
│ │  • Maria's PA │ Trust path strip: 3 hops      ↗ expand    │   ← trust strip
│ └─────┘                                                       │
│                                                               │
│ Match: <subject intent summary>            [Privacy chip]    │   ← intent + privacy
│ Mandate fit: 92% · Geo: us/colorado                          │
│                                                               │
│ ⏱ Expected: $25 funds 1 trainer-week · decision in 14d      │   ← predicted + urgency
│ 🎯 Round closes: Dec 31 (12 days)                            │
│                                                               │
│ ⚠ Requires VerifiedHuman credential                          │   ← caveats (if any)
│                                                               │
│ ─────────────────────────────────────────────────────────── │   ← divider
│                                                               │
│ [ Primary action ] [ Secondary ] [ ⋯ ]                       │   ← action row
└─────────────────────────────────────────────────────────────┘
```

Five-slot composition (matches the matchmaking-strategy doc's spec):

| Slot | Required | Source |
|---|---|---|
| **Subject line** | yes | `props.subject` + `props.subjectIntent` |
| **Trust path strip** | yes | `props.trustPath` (collapsed by default; tap to expand) |
| **Lane chip** | yes | `props.lane` |
| **Privacy chip** | yes (incl. `'public'` variant) | `props.privacyPattern` (and `props.privacyContext`) |
| **Predicted impact narrative** | optional | `props.predicted` |
| **Urgency indicator** | optional | `props.urgency` |
| **Caveat row** | optional | derived from action `caveat` and privacy state |
| **Action row** | yes | `props.actions` + `props.overflow` |

### 1.4 Variants by `kind`

| Kind | Subject | Counterparty/Mediator | Primary action | Lane chip color |
|---|---|---|---|---|
| `direct-match` | caller | counterparty | "Propose meeting" | Green (relationship) |
| `fund-mediated-submit-proposal` | caller (recipient) | fund | "Submit proposal" | Blue (proposal) |
| `fund-mediated-pledge` | caller (donor) | fund | "Pledge $X" | Amber (pool) |
| `fund-mediated-recommend-grant` | caller (DAF holder) | fund | "Recommend grant" | Amber (pool) |
| `fund-mediated-honor-faith-promise` | caller (donor) | fund | "Honor pledge" | Amber (pool) |
| `campaign-active` | caller | campaign + fund | "Give now" | Pink (campaign) |
| `story-driven-activation` | storyteller | (varies) | "Read story" / "Pledge" | Purple (activation) |
| `sensitive-need-disclosure` | caller | (gated) | "Request access" | Slate (privacy) |
| `fund-admin-queue` | fund | (caller is admin) | "Review queue (N)" | Indigo (admin) |
| `fund-admin-validate-outcome` | fund | recipient | "Validate" | Indigo (admin) |
| `fund-admin-allocate-round` | fund | round | "Run allocation" | Indigo (admin) |

Lane chip colors map to brand-neutral light-mode palette (no dark mode); each is a chip with `color: var(--lane-{name})` background-tint + matching text.

### 1.5 States

| State | Trigger | Visual |
|---|---|---|
| **default** | mounted | full opacity; primary action filled; secondary outlined |
| **hover** | mouse over card | card elevation +1 (8% shadow); cursor: pointer on tappable region |
| **focus** | keyboard tab | 2px outline `var(--focus-ring)`; visible on action buttons |
| **loading-action** | primary action firing | primary button shows inline spinner; rest of card disabled |
| **success** | action returns OK | inline check + "Action complete · view" link; auto-collapses to "completed" badge after 3s |
| **error** | action throws | inline error pill with message + retry button |
| **dismissed** | onDismiss called | opacity 40%; "Undismiss" link; auto-removes from stack on next refresh |
| **muted** | onMute called | hidden from view; appears in "Muted" filter |
| **expanded-trust** | trust strip tapped | 4-row trust chain replaces strip; "Collapse" link |
| **expanded-story** | story snippet tapped | full story body replaces snippet; "Collapse" link |
| **stale** | `urgency.deadline` past | header crossed-out style; status pill "Expired" |

### 1.6 Accessibility

- Card is an `<article>` with `role="region"` and `aria-labelledby` pointing to subject line.
- Trust strip is `<nav aria-label="Trust path">` with a list of `<a>` links.
- Lane chip and privacy chip are `<span role="img" aria-label="...">` with full text in label.
- Actions are real `<button>` elements; keyboard order follows visual order.
- Avatar `<img>` has `alt={subject.displayName}`.
- Privacy state changes announce via `aria-live="polite"` zone.
- Dismissed cards remain in DOM with `aria-hidden="true"` until cleanup.

### 1.7 Data sources

| Field | Source |
|---|---|
| `subject` | `getCurrentUser()` + `agent-metadata` lookup |
| `counterparty` | matcher output via `listExpressedIntents()` |
| `mediator.fund` + `.mandate` | `listFundMandates()` (Phase 5+; uses people-group-mcp pattern) |
| `subjectIntent` | caller's session via `callMcp('person', 'list_intents')` |
| `trustPath` | on-chain `AgentRelationship` traversal + `TrustDeposit` reads |
| `trustScore` | aggregated from TrustDeposit + endorsement count |
| `endorsedBy` | top-3 endorsers from `getEdgesByObject(subject, REVIEW)` |
| `privacyPattern` | `props.subjectIntent.visibility` + mandate's `accessPolicy` |
| `predicted.multiplier` | (Phase 5) QF preview from fund's allocator |
| `predicted.impact` | mandate-level template + intent-level filling |
| `urgency.deadline` | mandate.round.endDate or campaign.endDate |
| `actions` | computed from kind + auth state + caveats |

### 1.8 Edge cases

- **No avatar:** show colored circle with first letter of `displayName`. Color is hash of address.
- **Trust path = empty:** show muted pill "No trust path — first encounter."
- **Trust path circular:** detect and label "(direct)" without expanding.
- **Privacy = public + sensitive flag:** show shield with "Public for awareness" label.
- **Stale (post-deadline):** crossed out + "Round closed" pill; primary action disabled.
- **Caveat-disabled action:** primary button shows lock icon; tooltip explains; secondary CTA "Resolve caveat" appears.
- **Network error fetching trust path:** render with skeleton trust strip; non-blocking.
- **Action requires session bootstrap:** primary button shows "Connect agent first" + opens session-bootstrap dialog.

### 1.9 Visual notes (light-mode corporate palette)

- Card BG: `#fff`. Border: `1px solid #ece6db`. Border-radius: `8px`. Padding: `1rem 1.25rem`.
- Subject line: `1rem 600` weight, `#3a3028`.
- Trust strip: `0.75rem`, `#9a8c7e`, with hop dots in `#8b5e3c`.
- Lane chip: light-tinted bg + saturated text — eg. `bg #f3e9d8 text #8b5e3c` for relationship.
- Privacy chip: see `<PrivacyChip>` spec for variants.
- Predicted impact: `0.85rem`, `#5c4a3a`.
- Urgency: `0.85rem`, `#c75c3a` (subdued red, not alarm-red).
- Caveat row: `0.78rem`, `#9a8c7e` italic, with `⚠` glyph.
- Action row: 8-12px spacing between buttons; primary fills, secondary outlines, overflow `⋯`.

---

## 2. `<PrivacyChip>`

### 2.1 Purpose

Vocabulary chip that conveys *why* a need or fund's details are obscured + *what action* gives access. The six privacy patterns from `giver-activation-and-private-needs.md` collapse to one 🔒 today; PrivacyChip gives each a recognizable signature.

### 2.2 TypeScript interface

```tsx
type PrivacyPatternKind =
  | 'public'                     // open visibility — for completeness
  | 'coarse-only'                // location/identity rounded; no detail will ever exist
  | 'selective-disclosure'       // can be unlocked via credential
  | 'trusted-intermediary'       // a trusted vouches without revealing
  | 'zk-proof'                   // attribute proven without revealing
  | 'fund-shielded'              // donor relates to fund, not recipient
  | 'escrow-then-reveal'         // commit escrow to unlock detail

interface PrivacyChipProps {
  pattern: PrivacyPatternKind
  context?: {
    granter?: AgentRef                    // for trusted-intermediary
    requiredCredential?: string           // for selective-disclosure
    fundShield?: AgentRef                 // for fund-shielded
    escrowAmount?: string                 // for escrow-then-reveal
  }
  size?: 'sm' | 'md'                      // sm for inline; md for cards
  variant?: 'badge' | 'pill' | 'button'   // visual style
  onClick?: () => void                    // tap to learn more / take unlock action
}
```

### 2.3 Variant matrix

| Pattern | Icon | Label | Color (bg / text) | Tooltip |
|---|---|---|---|---|
| `public` | 🌐 globe | "Public" | `#e8f4ec / #2a6e3f` | "Anyone can see this need" |
| `coarse-only` | 📍 pin-blur | "Coarse only" | `#f0eef2 / #5a4870` | "Geography rounded; no specific identity" |
| `selective-disclosure` | 🗝 key-circle | "Verified privately" | `#fbf6e7 / #8b5e3c` | "Credential needed to view detail" |
| `trusted-intermediary` | 🤝 handshake | "Vouched" | `#e7eef6 / #2c4f7c` | `${context.granter.displayName} attests to this need` |
| `zk-proof` | 🔐 lock-with-✓ | "Cryptographic proof" | `#f6f0fb / #6e3a92` | "Attribute proven without revealing detail" |
| `fund-shielded` | 🛡 shield | "Via fund" | `#e6f2f6 / #2a6585` | `Give through ${context.fundShield.displayName}` |
| `escrow-then-reveal` | ⚖ scale | "Escrow to unlock" | `#f6e8e7 / #8c4040` | `Commit ${context.escrowAmount} to view detail` |

Light-mode palette only. All combinations meet WCAG AA contrast.

### 2.4 Composition

```
┌────────────────────────────┐
│ [icon] Verified privately  │   ← md size; icon + label
└────────────────────────────┘

[icon] Vouched by Maria       ← md size with context

🌐                           ← sm size; icon-only with full tooltip
```

### 2.5 States

| State | Visual |
|---|---|
| **default** | as in matrix |
| **hover** | bg darkens 8%; tooltip shows |
| **focus** | focus ring; tooltip shows |
| **expanded** (button variant) | tooltip text inline; CTA "Unlock" appears |
| **disabled** | opacity 50%; "Cannot unlock" tooltip |

### 2.6 Accessibility

- `role="img"` for badge/pill variants; full descriptive `aria-label` (combines pattern label + context).
- `<button>` for button variant; `aria-describedby` points to tooltip.
- Tooltip uses `role="tooltip"` and respects `prefers-reduced-motion` for fade.

### 2.7 Data sources

| Field | Source |
|---|---|
| `pattern` | derived from `Intent.visibility` and `Intent.accessPolicy.privacyPattern` |
| `context.granter` | for trusted-intermediary: from `Intent.attestedBy` IRI lookup |
| `context.requiredCredential` | from mandate's `identityRequirement.requiredCredentials[0]` |
| `context.fundShield` | from `Intent.privacyPattern==='fund-shielded'` ref |
| `context.escrowAmount` | from `Intent.accessPolicy.minimumEscrow` |

### 2.8 Edge cases

- **Multiple patterns** (e.g. fund-shielded *and* coarse-only): primary chip = the most-restrictive (coarse-only). Secondary chip in a "+1" pill on hover.
- **Pattern mismatch on render** (matcher disagrees with intent's stored pattern): show "Pattern unknown" gray chip. Log warning.
- **Granter unknown**: trusted-intermediary chip falls back to "Vouched (verified)".
- **i18n**: every label is i18n key; tooltips translatable.

### 2.9 Visual notes

- Border-radius: `4px` (badge), `999px` (pill), `6px` (button).
- Height: 24px (sm), 28px (md).
- Padding: `0 0.5rem` for pill; `0 0.4rem` for badge.
- Icon size: 14px (sm), 16px (md). Use lucide-react where available; emoji fallback for the unique privacy icons.

---

## 3. `<ViewerModeToggle>`

### 3.1 Purpose

Top-of-`/discover` segmented control letting the user pick which "stance" the page is rendered for. Persists the choice in localStorage; defaults to inferred mode from the user's primary intent context.

### 3.2 TypeScript interface

```tsx
type ViewerMode = 'donor' | 'recipient' | 'fund-admin' | 'hub-steward'

interface ViewerModeToggleProps {
  available: ViewerMode[]                 // narrowed by user's roles
  current: ViewerMode
  onChange: (next: ViewerMode) => void
  inferredFromContext?: boolean           // shows hint "auto-selected"
  cardCounts?: Record<ViewerMode, number> // shows badge per mode
}
```

### 3.3 Composition

```
┌──────────────────────────────────────────────────────────────────┐
│ View as: [ Donor (12) ] [ Recipient (3) ] [ Fund Admin (8) ]     │
│                                                                   │
│ Auto-selected based on your primary intent. Switch anytime.       │
└──────────────────────────────────────────────────────────────────┘
```

### 3.4 Variants

- **Two-mode** (most users): donor + recipient — both visible.
- **Three-mode**: donor + recipient + fund-admin — adds admin if user is fund principal anywhere.
- **Four-mode**: + hub-steward — for hub-membership-with-curator-role users.

### 3.5 States

| State | Visual |
|---|---|
| **default** | segmented control; current mode filled |
| **inferred** | small "auto-selected" hint + ⓘ icon |
| **manually-set** | hint disappears; localStorage persists |
| **single-mode** | render no toggle (only one available) — pass through to child |

### 3.6 Accessibility

- `role="tablist"` with each mode as `role="tab"` + `aria-selected="true|false"`.
- Arrow keys cycle modes.
- Announce mode change via `aria-live`.

### 3.7 Data sources

| Field | Source |
|---|---|
| `available` | derived from caller's roles: has gift intents → donor; has need intents → recipient; is fund principal → fund-admin; is hub steward → hub-steward |
| `current` | from localStorage (`pg-discover-mode`) or inferred |
| `cardCounts` | from matcher output, grouped by mode |
| `inferredFromContext` | true if no localStorage value yet |

### 3.8 Visual notes

- Pill height: 40px. Bg `#f7f5ee`. Active pill: `#fff` + 1px border + slight shadow.
- Auto-selected hint: `0.75rem`, `#9a8c7e`, italic, with ⓘ icon.

---

## 4. `<StoryStrip>` + `<InboxFeed>`

These two are paired: StoryStrip is the *broadcast* surface ("here's what's happening you might care about"); InboxFeed is the *targeted* surface ("here's what was sent specifically to you"). Both are activation primitives.

### 4.1 `<StoryStrip>` purpose

A horizontally-scrolling row of 3-7 Story cards, surfaced on hub Home and on `/discover` "All" tab. Each card is awareness-first: a snippet, image, source attribution, and a CTA.

### 4.2 `<StoryStrip>` interface

```tsx
interface StoryStripProps {
  stories: StoryRef[]                     // already filtered + sorted server-side
  variant: 'horizontal-scroll' | 'masonry-grid'
  emptyState?: ReactNode                  // when stories.length === 0
  onStoryClick: (story: StoryRef) => void
  onSubscribe?: (publisher: AgentRef) => void  // "subscribe to more from"
  onMute?: (publisher: AgentRef) => void
}

interface StoryRef {
  id: string
  storyteller: AgentRef
  about: { kind: 'need' | 'proposal' | 'award' | 'outcome' | 'campaign'; ref: string }
  storyKind: 'testimony' | 'progress-update' | 'impact-summary' | 'call-to-action'
  snippet: string                         // 140-character lead
  imageUrl?: string
  hubContext: { hubAddress: string; hubName: string }
  publishedAt: string
  trustVouchedBy: AgentRef[]
  storyPermissions: {
    redactionLevel: 'aggregated' | 'named-with-consent' | 'full'
  }
  cta?: { verb: string; href: string }    // optional embedded action
}
```

### 4.3 `<StoryStrip>` composition

```
┌──────────────────────────────────────────────────────────────────┐
│ Recent stories         [Subscribe to more] [Manage stories]      │
├──────────────────────────────────────────────────────────────────┤
│ ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│ │  IMG     │  │  IMG     │  │  IMG     │  │  IMG     │   →      │
│ │  Catalyst│  │  CIL     │  │  Catalyst│  │  Catalyst│          │
│ │  Maria   │  │  Cameron │  │  Sione   │  │  Sarah   │          │
│ │  Snippet │  │  Snippet │  │  Snippet │  │  Snippet │          │
│ │  [Read]  │  │  [Pledge]│  │  [Read]  │  │  [Read]  │          │
│ └──────────┘  └──────────┘  └──────────┘  └──────────┘          │
└──────────────────────────────────────────────────────────────────┘
```

### 4.4 `<InboxFeed>` purpose

Vertical list of targeted OutreachMessage items addressed to the user. Each message has a sender, a consent basis, an action, and a mute/unsubscribe path.

### 4.5 `<InboxFeed>` interface

```tsx
interface InboxFeedProps {
  messages: OutreachMessageRef[]
  groupBy: 'subscription' | 'sender' | 'date'
  onAcknowledge: (msg: OutreachMessageRef) => void
  onConvert: (msg: OutreachMessageRef, action: MatchAction) => void
  onMute: (publisher: AgentRef) => void
  onUnsubscribe: (subscription: SubscriptionRef) => void
}

interface OutreachMessageRef {
  id: string
  from: AgentRef
  to: AgentRef                            // always caller
  kind: 'solicit-for-gift' | 'proposal-introduction' | 'impact-story-publication'
       | 'campaign-announcement' | 'invitation-to-subscribe'
  consentBasis: 'subscribed' | 'past-relationship' | 'hub-mediated'
                | 'validator-bonded' | 'open-call' | 'trust-tier-opt-in'
  trustVouch?: AgentRef                   // for hub-mediated / validator-bonded
  subject: string
  body: string
  attachments?: Array<{ kind: 'story' | 'intent' | 'mandate' | 'campaign'; ref: string }>
  publishedAt: string
  acknowledgedAt?: string
  declineActions: Array<'not-interested' | 'unsubscribe' | 'block-sender'>
  proposedActions: MatchAction[]          // what the message asks for
}

interface SubscriptionRef {
  id: string
  publisher: AgentRef
  topicKinds: string[]
  cadence: 'realtime' | 'daily-digest' | 'weekly-digest' | 'monthly-digest'
  startedAt: string
}
```

### 4.6 `<InboxFeed>` composition (per item)

```
┌──────────────────────────────────────────────────────────────────┐
│ [Av] From: Senegal Wolof Outreach                  Subscribed ▾  │
│      Subject: Q2 trauma-care training opens Dec 1                │
│                                                                   │
│      First 200 chars of body…                                    │
│                                                                   │
│      📎 attached: Q2 round mandate · trauma-care campaign         │
│                                                                   │
│      [Pledge $25]  [Read more]  [Mute]  [Unsubscribe]             │
└──────────────────────────────────────────────────────────────────┘
```

### 4.7 States (both components)

| State | Trigger |
|---|---|
| **loading** | initial fetch — skeleton cards |
| **empty** | no stories / no messages — empty-state CTA |
| **partial** | some loaded; "load more" link at end |
| **muted** | publisher muted — collapses to "1 muted item from {publisher}" link |
| **acknowledged** | user has read; faded styling, "✓ Acknowledged" pill |
| **error** | fetch failed; retry button |

### 4.8 Data sources

| Field | Source |
|---|---|
| `stories` | server-side: `listMyVisibleStories()` filtered by user's subscriptions + hub memberships |
| `messages` | server-side: `listMyInbox()` — caller's OutreachMessages from `person-mcp` (new table or A2A inbox) |
| `subscriptions` | from `person-mcp.subscriptions` table |
| `consentBasis` | from message metadata; unsigned messages without consent are dropped |

### 4.9 Visual notes

- StoryStrip cards: 240×280px each, horizontal scroll, snap-points at card-width.
- InboxFeed items: full-width card, 1.25rem padding, bordered.
- "Subscribed ▾" badge in upper-right of inbox item shows source; clicking opens subscription manager.
- Muted publisher state: gray-tinted chip at top of stack, "show muted (3)" link.

---

## 5. `<StewardshipCard>`

### 5.1 Purpose

Pinned card on the agent viewer (right after Trust Profile) that surfaces ECFA-aligned stewardship signals. Turns abstract trust scores into specific, donor-credible behavioral evidence.

### 5.2 TypeScript interface

```tsx
interface StewardshipCardProps {
  agent: AgentRef
  stewardship: StewardshipMetrics
  onBadgeClick?: (badge: StewardshipBadge) => void
  // For drill-in / linked evidence
}

interface StewardshipMetrics {
  honorsRestrictions: { committed: boolean; commitmentRef?: string; violations: number }
  acknowledgmentCadence: {
    promised: string                      // ISO duration, e.g. 'P30D'
    actualP50: string                     // observed median
    actualP95: string
    overdueCurrent: number                // count of currently overdue
  }
  outcomeReporting: {
    cadencePromised: string
    onTimeRate: number                    // 0..1
    lastReport?: { date: string; ref: string; summary: string }
  }
  ecfaAccreditation: {
    accredited: boolean
    by?: AgentRef
    since?: string
  }
  trustDeposits: {
    positive: number
    negative: number
    recent: Array<{ date: string; ref: string; delta: number; reason: string }>
  }
  storyPermissions: {
    publishesStories: boolean
    storiesLast90d: number
    consentRespect: 'high' | 'medium' | 'unknown'
  }
}

interface StewardshipBadge {
  id: string
  label: string
  tier: 'gold' | 'silver' | 'bronze' | 'unverified'
  evidence: { kind: string; ref: string }[]
  description: string
}
```

### 5.3 Composition

```
┌─────────────────────────────────────────────────────────────────┐
│ Stewardship                                          […]         │
│ ─────────────────────────────────────────────────────────────── │
│                                                                  │
│ ✓ Honors gift restrictions      0 violations · 24 awards         │
│   Committed via on-chain assertion · 2026-04-15                  │
│                                                                  │
│ ✓ Acknowledges within 30 days   median 18d · 95th: 27d           │
│   Currently overdue: 0                                           │
│                                                                  │
│ ✓ Publishes outcome reports     97% on time · 32 reports         │
│   Last report: 2026-08-10  →  "Q2 trauma cohort"                 │
│                                                                  │
│ ✓ ECFA-aligned                  Verified by ECFA · since 2024    │
│                                                                  │
│ ↗ Trust deposits                +18 endorsements · 0 disputes    │
│                                                                  │
│ ✓ Permission-respecting stories  12 in last 90d · high consent   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 5.4 Badge tiers

| Tier | Visual | Threshold |
|---|---|---|
| **gold** | filled ✓ + accent color | committed + on-time + multi-year evidence |
| **silver** | outlined ✓ | committed + on-time but < 1yr evidence |
| **bronze** | dotted ✓ | partial evidence — committed but no track record |
| **unverified** | gray − | no commitment or no data |

Don't fake gold for new agents. New funds start at unverified for everything; bronze on first commitment; silver after 6mo of evidence; gold after 18mo.

### 5.5 States

| State | Visual |
|---|---|
| **default** | full card with all 6 metrics |
| **partial-data** | metrics with no data show as "Not yet measured" |
| **violation-active** | red bar at top: "X overdue acknowledgments" |
| **expired-accreditation** | yellow bar: "ECFA accreditation expired 2026-01-01" |

### 5.6 Accessibility

- Badges are `<button>` (drilling into evidence) or `<span aria-label>` (display-only).
- Tier conveyed by text + icon, not color alone (WCAG).
- Click on each metric opens drill-in modal with linked evidence.

### 5.7 Data sources

| Field | Source |
|---|---|
| `honorsRestrictions.committed` | on-chain assertion `atl:commitsToStewardshipStandard` with `sagrant:HonorRestrictions` value |
| `honorsRestrictions.violations` | count of `pg_audit_log` rows where allocation_failed_restriction_check |
| `acknowledgmentCadence.promised` | from agent's `StewardshipPolicy` |
| `acknowledgmentCadence.actualP50` | computed from `Acknowledgment.sentAt - Pledge.committedAt` distribution |
| `acknowledgmentCadence.overdueCurrent` | count of `Pledge` rows where current_date - last_ack > promisedDuration |
| `outcomeReporting` | from `OutcomeReport` rows linked to agent's awards |
| `ecfaAccreditation.accredited` | on-chain edge from ECFA accreditor agent → this agent |
| `trustDeposits` | from on-chain `TrustDeposit` reads for this agent |
| `storyPermissions` | from `Story` rows where storyteller = this agent |

### 5.8 Edge cases

- **No StewardshipPolicy declared:** card hides entirely (don't show empty card).
- **Self-reported metrics only:** badge tier maxes at bronze; tooltip explains.
- **Conflicting accreditation claims:** show all; let user judge.
- **Sensitive-need fund (fund-shielded):** outcome reports may be aggregated only — note this; gold tier still possible.

### 5.9 Visual notes

- Border-radius: `8px`. Border `1px solid #ece6db`. Padding `1rem`.
- Each metric row: 32px height; metric icon + label + value; right-aligned secondary value.
- Drill-in arrow on hoverable rows.
- Card sits between "Trust Profile" and "Relationships" on agent viewer.

---

## 6. Cross-component integration map

How these compose together on `/discover`:

```
/discover/page.tsx
├── <Hero> (existing — eyebrow + title + sublabel)
├── <ViewerModeToggle>
│     ┌────────────────────────────────────────────────┐
│     │ Mode: donor                                     │
│     └────────────────────────────────────────────────┘
│
├── <Tabs> (lane filter; sub-tabs)
│     [ All ]  [ Direct ]  [ Pool ]  [ Proposal ]  [ Stories ]
│
├── <StoryStrip>  (when "All" or "Stories" tab)
│     [scrollable strip of recent stories]
│
├── <InboxFeed>  (collapsible; has badge for unread count)
│     [list of OutreachMessage items]
│
├── <MatchCard>[]  (filtered by lane + mode)
│     stack of cards; each uses <PrivacyChip> internally
│
└── <KPIs>  (collapsed by default at bottom)
```

And on the agent viewer:

```
/agents/[address]/page.tsx
├── <AgentSubNav> (existing)
├── <Header> (identity card)
├── <ScorecardSummary> (NEW; trust + mandate + actions in 3 tiles)
├── <TrustResidueCard> (existing)
├── <StewardshipCard>  (NEW; this spec)
├── <PeopleGroupFocusSection> (existing — pin to top for sponsor orgs)
├── <Relationships> (existing)
├── <GrantedAuthority> (existing)
├── <GeoLocations> (existing)
├── <Skills> (existing)
├── <Reviews> (existing)
└── <AgentChatPanel> (NEW — Phase 5+)
```

---

## 7. Implementation ordering

If a developer has 2 weeks:

| Week | Days 1-2 | Days 3-5 | Days 6-7 |
|---|---|---|---|
| **Week 1** | `<PrivacyChip>` (smallest, well-defined) | `<MatchCard>` skeleton with mock data | `<MatchCard>` integrated with matcher (M1+M3 from F-series) |
| **Week 2** | `<ViewerModeToggle>` | `<StoryStrip>` (no real story data yet — mock) | `<StewardshipCard>` (from existing TrustResidue + new StewardshipPolicy data) |

`<InboxFeed>` is Phase 5 since OutreachMessage isn't shipping until then.

---

## 8. Design tokens to define

To support these specs cleanly, define these CSS custom-properties at hub-layout root:

```css
:root,
[data-hub] {
  /* lane colors */
  --lane-relationship: #2a6e3f;
  --lane-relationship-bg: #e8f4ec;
  --lane-pool: #8b5e3c;
  --lane-pool-bg: #f3e9d8;
  --lane-proposal: #2c4f7c;
  --lane-proposal-bg: #e7eef6;
  --lane-campaign: #c75c3a;
  --lane-campaign-bg: #f6e8e7;
  --lane-activation: #6e3a92;
  --lane-activation-bg: #f6f0fb;
  --lane-admin: #4a4a8c;
  --lane-admin-bg: #ecedf7;
  --lane-privacy: #5a5e72;
  --lane-privacy-bg: #f0eef2;

  /* trust */
  --trust-high: #2a6e3f;
  --trust-medium: #8b5e3c;
  --trust-low: #c75c3a;
  --trust-unknown: #9a8c7e;

  /* stewardship tiers */
  --stewardship-gold: #b08b3f;
  --stewardship-silver: #7d8794;
  --stewardship-bronze: #a06846;
  --stewardship-unverified: #c9c4bc;

  /* focus + interaction */
  --focus-ring: rgba(43, 79, 124, 0.5);
  --hover-elevation: 0 2px 8px rgba(58, 48, 40, 0.08);
}
```

Per the UX review's Critique 12, these should be the *first* tokens defined so further surfaces stop hardcoding hex.

---

## 9. Open design questions

1. **MatchCard density** — should mobile stack to single-column with collapsible sections, or render the same dense layout? Recommend: same composition, smaller padding, action row wraps to 2 lines if needed.

2. **PrivacyChip on hover** — do we want a tooltip or a popover? Tooltip for simple text; popover when context.granter is rich (link to granter's profile). Recommend: popover for trusted-intermediary + fund-shielded; tooltip for the rest.

3. **ViewerModeToggle persistence scope** — per-user globally, or per-hub? Recommend: per-hub (a user might be admin in one hub, donor in another).

4. **StoryStrip ranking** — chronological-only, or score-by-relevance? v1: chronological with subscribed-publishers pinned. Phase 5: relevance score from BDI engine.

5. **InboxFeed groupBy default** — group by sender or by date? Email convention is date; subscription-management makes sense as sender. Recommend: date-grouped with sender chip per item; user can switch via groupBy setting.

6. **StewardshipCard for non-fund agents** — do persons get StewardshipCard? Maybe a stripped-down version (only acknowledgment + outcome reporting if they've received awards). Recommend: yes, lightweight version for persons; full version for orgs/funds.

7. **MatchCard actions calling on-chain operations** — primary action should optimistic-update the UI then await chain confirmation. Show success state on confirm; rollback on revert. Recommend: optimistic + confirmation pattern.

8. **Caveat resolution flow** — when a card has `caveat: "requires VerifiedHuman credential"`, the secondary action "Get credential" needs a flow. That's a separate spec — flag as needed in Phase 5.

---

## 10. Take-away

These five components are the smallest set that turns the matchmaking architecture from spec into product:

- **MatchCard** is the unit of strategic surfacing — without it, `/discover` is a wall of text.
- **PrivacyChip** is what teaches users *why* the system exists — six privacy patterns mean nothing if collapsed to one lock icon.
- **ViewerModeToggle** is the cognitive scaffold — donors and recipients see different worlds.
- **StoryStrip + InboxFeed** are the activation primitives — generosity often starts with awareness; without these surfaces, awareness has nowhere to live.
- **StewardshipCard** turns abstract trust scores into ECFA-credible donor signals — what makes a 501(c)(3) trustworthy is *behavior*, not *score*.

Build these in week-1 priority order (PrivacyChip → MatchCard → ViewerModeToggle → StoryStrip → StewardshipCard). At end of two weeks the `/discover` page is no longer a needs-list; it's a real matchmaking surface. The agent viewer no longer asks "look at this 11-section dump" but "here's why this agent is worth your trust."

The architectural commitment from the prior docs is *configurable policy on universal primitives*. The UX commitment from this doc is *strategic surfacing on intent-aware cards*. Together they're the product.
