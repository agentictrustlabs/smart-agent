# Catalyst NoCo Home Page — Layout & Work Items

> **Source**: synthesized from a UI Designer audit (component architecture, layout, hierarchy) and a Test User audit (4 personas: Hub Lead, Program Director, Group Leader, new user) of `apps/web/src/components/dashboard/HubDashboard.tsx` (the `CatalystFieldDashboard` block at lines 397–542).
>
> **Companion to**: `discovery-ui-plan.md` (relational distance + coaching panel + intent search), `demo-work-items.md` (per-silo demo items).
>
> **Scope**: layout, prioritization, content cuts, and missing role-aware surfaces on `/h/catalyst/home` only. Token system, color palette, and typography are out of scope (already settled).

---

## 1. Diagnosis

The current page is a **junk-drawer dashboard**: every panel some PR shipped over the last six sprints renders in a single column at equal weight. The only visual hierarchy is a 5-up KPI strip that hardcodes Disciple metrics (`MY OIKOS`, `PRAY NOW`, `PERSONAL WALK`) for every visitor — so a Hub Lead opens the page and sees "5 Circles, 80% Walk", which means nothing to them.

The single biggest verb problem: **the page's primary verb is "view" when it should be "do."** `MyWorkPanel` and `DashboardForMode` are the only role-adaptive surfaces; they're the *fourth* thing you see, below a greeting, the disciple KPI strip, and an inline relationship form. Three publishing forms (`AddGeoClaimPanel`, `AddSkillClaimPanel`, `AddRelationshipPanel`) and a wallet-signing trust-search component sit on the home page even though they belong on `/me` or `/people/discover`. Meanwhile, every catalyst-specific component (`ActivityFeed`, `CircleMapView`, `GroupHierarchy`, `MeetingLog`, `QuickActivityModal`, `NeedsAttentionCard`) is **unwired** on the catalyst home — the CIL dashboard renders `NeedsAttentionCard`, Catalyst doesn't.

User-facing scores from the personas: Hub Lead — "I feel like I'm looking at a personal devotional dashboard, not running a hub." Program Director looking for a coach for a struggling leader — "this task isn't supported from the home page." Group Leader checking in for the week — "useful counters, missing the one button I came for." New user — "five zero-cards in a row feels like a broken account; I'd close the tab."

---

## 2. Recommended Layout (top-to-bottom)


| #   | Zone                                                                                                                                                                                                         | Visual weight                           | Mobile behavior           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | ------------------------- |
| 1   | **Hero strip** — `{greeting}, {firstName}` + hub eyebrow ("Catalyst NoCo Network · Hispanic outreach") + `.agent` name behind a "?" affordance                                                               | Full-width, ~64px                       | Stacks to 2 lines         |
| 2   | `**<NeedsAttentionCard>`** — only renders if items > 0; amber strip                                                                                                                                          | Full-width, conditional                 | Always full-width         |
| 3   | **Role-aware KPI row** — 4 KPIs branched by mode: Govern → Active Groups / This Month / Open Reviews / Pending Invites; Disciple → existing 5 collapsed to 4; Route → Triage / Open Invites / Unread / Stuck | 4-col, full-width, ~120px               | 2×2                       |
| 4   | **Work zone — 2-col 60/40 grid** — left: `<MyWorkPanel>` with mode picker; right: `<DashboardForMode>` (mentees+oikos / triage / null→collapse)                                                              | Tall, hero of the page                  | Stacks; MyWorkPanel first |
| 5   | **Field zone — 2-col grid** — left: `<ActivityFeed limit={5}>`; right: `<CircleMapView compact>` *or* `<GroupHierarchy depth={1}>`                                                                           | Medium                                  | Stacks                    |
| 6   | **"My stuff" inventory row** — 4 link-cards with counts: Relationships → /me/relationships, Orgs → /groups, AI Agents → /agents, Credentials → /me/credentials                                               | Compact, 4-col                          | 2×2                       |
| 7   | **Footer-CTA strip** — 3 quick-action buttons: Log Activity, Add to Oikos, Invite                                                                                                                            | Full-width, sticky on mobile (optional) | Sticky                    |


Removed entirely from the home page (each demoted to its proper route):

- `<AddGeoClaimPanel>` → `/me`
- `<AddSkillClaimPanel>` → `/me`
- `<AgentTrustSearch>` → `/people/discover`
- `<AddRelationshipPanel>` (inline form) → `/me/relationships`
- "My Organizations" body & role chips → collapsed into the inventory KPI
- "AI Agents" body → collapsed into the inventory KPI
- `<HeldCredentialsPanel>` (currently nested inside My Orgs) → `/me/credentials`
- `<PrincipalContextChip>` → moved into `HubLayout.tsx` global header

---

## 3. Work Items by Zone

### 3.1 Hero strip

- **Add hub eyebrow + name to H1** — *role: every persona; ref: `docs/product/hub-site-redesign.md` zone 1.* In `CatalystFieldDashboard` (HubDashboard.tsx:472), prepend the H1 line with the hub display name from `getHubProfile(hubId).name`. Acceptance: every visitor immediately knows which hub they're in.
- **Demote `.agent` handle** — *role: new user / non-developer.* The monospace `.agent` name reads like an error code to non-devs. Hide it behind a "?" affordance with a tooltip "Your unique name in the network." Acceptance: handle no longer dominates the H1 row; tooltip shows full name on click.
- **Move `<PrincipalContextChip>` into the global header** — *role: every persona.* It's a context chip ("Working as Maria · Owner · Catalyst") — header furniture, not page content. Move to `apps/web/src/components/shell/HubLayout.tsx`. Acceptance: chip renders in the topbar and is gone from the dashboard body.
- **Role-aware greeting subhead** — *role: Hub Lead / Coach / new user; ref: persona walkthroughs.* Below the greeting, a single-line subhead that names the role: "*Hub Lead · 8 group leaders · 3 circles need attention*" or "*Wellington Group Leader · log this week's gathering →*". Driven by `defaultModeForRole(role)`. Acceptance: each persona sees a distinct subhead.
- **Hero hover/focus states** — *role: keyboard / accessibility.* The H1 row has no clear focus target. Add a focus ring on the eyebrow link to navigate to hub overview. Acceptance: tab-from-topbar lands on the eyebrow with visible ring.
- **Skeleton-load hero** — *role: every persona.* On first sign-in, the hero flashes empty. Add a skeleton that matches the final layout (greeting placeholder + 2-line subhead). Acceptance: no layout shift on hydration.

### 3.2 NeedsAttentionCard (currently missing on catalyst)

- **Wire `<NeedsAttentionCard>` into `CatalystFieldDashboard`** — *role: Hub Lead / Program Director; ref: `CILDashboard` lines 357–373.* Component already exists at `components/catalyst/NeedsAttentionCard.tsx`. Render after the hero, before the KPI row. Acceptance: card renders when there are open items.
- **Build `catalystAttentionItems` aggregator** — *role: Hub Lead.* Server action that queries: groups with no activity in 14d, prayer commitments past `validUntil`, stale invites (>7d unanswered), unanswered review requests. Returns max 5, severity-ordered. Acceptance: when seed data has any of those, items appear; when none, card hides.
- **Per-item action chip** — *role: Hub Lead.* Each attention item ends in a one-click action ("Nudge leader", "Renew prayer", "Resend invite", "Reply to review"). Acceptance: actions execute server-side and the item is dismissed on success.
- **Severity color tokens** — *role: visual hierarchy.* Use the existing amber strip for warnings; promote to red for items >30d stale. Acceptance: contrast passes WCAG AA at both severities.
- **Dismissal persistence** — *role: Hub Lead.* Dismissed items don't reappear for 7d. Stored in user prefs. Acceptance: refresh after dismiss → item stays gone for 7d.
- **"Show more / show less" expander** — *role: Hub Lead with many groups.* Default cap of 5; expand to all. Acceptance: Hub Lead with 12 attention items can see them all without leaving the home.

### 3.3 Role-aware KPI row

- **Branch KPI set on `defaultModeForRole(role)*`* — *role: every persona.* Today, lines 476–482 hardcode 5 disciple KPIs for every visitor. Wire it to the same role/mode branching `DashboardForMode` already uses. Acceptance: Hub Lead sees Active Groups / This Month / Open Reviews / Pending Invites; Disciple sees the existing set; Dispatcher sees Triage Queue / Open Invites / Unread / Stuck.
- **Drop from 5 tiles to 4** — *role: visual rhythm.* Five tiles in a 2-col grid leave one dangling. Cut SOW THIS WEEK from the disciple set (it's already inside `MyWorkPanel`). Acceptance: 4 tiles align cleanly at 4-col / 2×2.
- **Add deltas + sparklines** — *role: every persona; ref: persona feedback "no targets, no trends, no color."* Each KPI shows a "vs last week" delta (▲5, ▼2) and a 7-day sparkline. Use existing `KpiCard` shadcn component. Acceptance: numbers convey trend, not just snapshot.
- **Goal indicator (green/amber/red)** — *role: Hub Lead.* For metrics with a target ("4 activities/week minimum"), show a status dot. Acceptance: at-target = green dot; below = amber/red.
- **Click affordance** — *role: every persona; ref: persona feedback "Users will see numbers and not realize they can drill in."* Add hover state, chevron, and pointer cursor on each KPI card. Acceptance: hover shows the link target; pointer + ring make clickability obvious.
- **Empty-zero protection** — *role: new user.* Today, a new user sees five "0" tiles in a row — feels broken. When all KPIs are zero, replace the row with a "Welcome — let's get you started" CTA card. Acceptance: zero-state replaces the strip, not stack with it.

### 3.4 Work zone — `MyWorkPanel` + `DashboardForMode`

- **Move work zone above the KPI row** — *role: every persona; ref: UI audit problem #1.* Two-line swap in `CatalystFieldDashboard`: cut lines 487–488, paste before line 476. Acceptance: "what should I do next?" is the first content block below the hero on every persona's view.
- **2-col 60/40 grid** — *role: Coach / Dispatcher.* Left: `<MyWorkPanel>` with mode picker; right: `<DashboardForMode>` output. When `DashboardForMode` returns null (govern/walk modes), collapse to 1-col full-width. Acceptance: Coach sees mentees+oikos beside the work queue; Govern role sees a wider single-column work queue.
- **Mode-picker visibility** — *role: every persona.* The mode picker inside `MyWorkPanel` is currently small. Promote it to a tab strip at the top of the panel. Acceptance: switching modes is a 1-click action with visible state.
- **Empty work-queue state** — *role: Hub Lead with everything done.* When the queue is empty, render "*All clear. 3 groups checked in this week — see Activity →*" instead of an empty card. Acceptance: empty state is a celebration + a link, not a void.
- **Quick-action menu on each work item** — *role: Coach.* Right-click / long-press a work item → menu: "Mark done", "Snooze 7d", "Reassign", "View details". Acceptance: each action executes via existing server actions.
- **Work-item count in the global nav** — *role: every persona.* Add a small badge to the "Home" nav item showing open work-queue count. Acceptance: badge updates within 5s of a queue change.
- **Mobile sticky-jump to the work zone** — *role: mobile users.* Mobile users currently scroll past the hero + KPI to reach work. Add a "Jump to my work →" sticky pill in the hero on mobile. Acceptance: tap pill scrolls to the work zone; pill hides once the zone is visible.

### 3.5 Field zone — `ActivityFeed` + `CircleMapView` / `GroupHierarchy`

- **Wire `<ActivityFeed limit={5}>` into the home** — *role: Group Leader / Hub Lead.* Component exists, never rendered on the catalyst home. Place left in the field zone with a "View all →" link to `/activities`. Acceptance: most-recent 5 activities render; click-through works.
- **Wire `<CircleMapView compact>` into the home** — *role: Hub Lead / Regional Lead.* Component exists, never rendered. Place right in the field zone with hub-bounded extent. Acceptance: 9 circles render as pins; click → circle profile.
- **Toggle between map and lineage** — *role: Hub Lead.* A small tab strip on the right cell swaps `CircleMapView` ↔ `GroupHierarchy depth={1}`. Acceptance: tab switches without a route change.
- **"+ Log Activity" CTA on the activity feed** — *role: Group Leader; ref: persona feedback "log this week's meeting … 2+ clicks via MY CIRCLES → group → MeetingLog."* Open `<QuickActivityModal>` (already exists) with one click from the feed header. Acceptance: Group Leader logs a meeting in 1 click from the home.
- **Filter activity feed by my circles** — *role: Group Leader.* Default to "activities from circles I lead or attend" rather than the whole hub firehose. Hub Leads get a toggle to "all circles". Acceptance: Ana sees only Wellington activities by default.
- **Stale-circle markers on the map** — *role: Hub Lead.* Circles with no activity in 14d render in a desaturated gray pin. Acceptance: visual scan instantly shows which circles need attention.

### 3.6 "My stuff" inventory row

- **Collapse 4 separate panels into a 4-up KPI link row** — *role: every persona; ref: UI audit problem #5.* Today there are four overlapping inventory panels (My Relationships, My Orgs, AI Agents, Held Credentials nested inside Orgs) consuming ~600px of vertical space. Replace with a single 4-up row of count-cards linking to deeper routes. Acceptance: ~600px reclaimed; inventory still reachable in 1 click.
- `**HeldCredentialsPanel` → `/me/credentials*`* — *role: every persona.* Currently nested inside My Orgs (line 517) — structurally wrong. Move to its own route accessible from the inventory row. Acceptance: panel renders on `/me/credentials`; gone from home.
- **Inventory-card empty states** — *role: new user.* "0 Relationships → Add your first connection" rather than a 0 with no follow-up. Acceptance: zero-state has a one-click CTA per card.
- **Replace "edges" with "people"** — *role: non-developer; ref: persona pain point on jargon.* In the Relationships card and tooltip, replace "edges" → "people" / "connections". Acceptance: no string in the home page reads "edges".
- **Replace "delegation" / "grants" with plain language** — *role: non-developer.* "Shared with you: Email, Phone" stays as data-share language; replace any visible "delegation" / "grant" strings with "sharing" or "permission". Acceptance: home page contains zero instances of the words "delegation" or "grant".

### 3.7 Footer CTA strip

- **Three primary actions, role-tuned** — *role: every persona.* Single sticky strip at the page foot with 3 verbs: Hub Lead → Log Activity / Send Update / Invite; Group Leader → Log Meeting / Add to Oikos / Pray; Disciple → Log Activity / Add to Oikos / Reach out. Acceptance: actions match `defaultModeForRole(role)`.
- **Sticky on mobile only** — *role: mobile.* Desktop: footer-only. Mobile: sticky bottom bar. Acceptance: mobile bottom bar always visible; desktop scroll reveals it normally.
- **Quick-action modal wiring** — *role: every persona.* Each button opens the appropriate existing modal: `<QuickActivityModal>`, oikos-add panel, invite flow. Acceptance: 1 click from the strip → modal open in <100ms.
- **Keyboard shortcuts** — *role: power users.* `L` for Log Activity, `O` for Add to Oikos, `I` for Invite. Acceptance: shortcuts trigger the same modals; help affordance documents them.

---

## 4. Cross-Cutting Work Items

### 4.1 Empty / first-run states

- `**<JoinHubBanner>` for in-flight membership** — *role: brand-new user; ref: persona walkthrough.* Today the banner only shows on the generic dashboard. When membership resolution is in flight or unknown, show the banner on the catalyst home too. Acceptance: a user mid-onboarding sees a banner, not a blank dashboard.
- **First-run welcome card** — *role: brand-new user with role assigned but zero activity.* Replaces the KPI strip when all KPIs are zero (see 3.3). Card explains the hub, names the user's role, and offers 3 first-step CTAs: "Find your group", "Add someone to your oikos", "Read the welcome guide". Acceptance: any new user lands on a welcoming, action-oriented zero-state.
- **Skeleton states for every async panel** — *role: every persona.* `MyWorkPanel`, `DashboardForMode`, `ActivityFeed`, KPI row all flash empty before data resolves. Add matched skeletons. Acceptance: no panel shows an empty zero-state during initial loading.

### 4.2 Jargon cleanup pass

- **Audit + replace network/edge/delegation/primaryName terms** — *role: non-developer; ref: persona pain point.* Single PR touching all home-rendered components: "edges" → "connections", "delegation" → "sharing", "primaryName" → drop or replace with "username". Acceptance: a non-developer can scan the home and ask zero "what does that mean" questions about the visible labels.
- **Inline tooltip system** — *role: every persona.* Where a domain term must remain (e.g. ".agent name", "trust score"), pair it with a small "?" tooltip showing a one-sentence plain-language definition. Acceptance: every domain term on the home has either been replaced or has a tooltip.
- **Tooltip i18n** — *role: Spanish-speaking personas (Maria, Ana, Carlos).* Tooltips live in the existing string table; add Spanish strings. Acceptance: language toggle swaps tooltip language.

### 4.3 Visual hierarchy

- **Card-chrome differentiation** — *role: visual scanability; ref: persona feedback "six or seven white rounded-12px cards stacked vertically, all with the same border."* Apply two card weights: hero/work cards get a subtle shadow + accent border; inventory/secondary cards are flatter. Acceptance: at 1m viewing distance, primary vs. secondary cards are distinguishable by chrome alone.
- **Section anchors in the side rail** — *role: power user.* On desktop, a thin left rail shows section anchors (Hero / Attention / Work / Field / Inventory) that highlight as you scroll. Acceptance: clicking an anchor smooth-scrolls to the section; current section is highlighted.

---

## 5. Quick Wins (≤1 hour each)

These five ship today, no design review needed:

1. **Move `<MyWorkPanel>` and `<DashboardForMode>` above the KPI grid** in `CatalystFieldDashboard` — cut lines 487–488, paste before line 476.
2. **Add `<NeedsAttentionCard>` to `CatalystFieldDashboard*`* — copy the pattern from `CILDashboard` (lines 357–373); seed items from overdue prayers + stale invites.
3. **Delete the three publish-form panels from the catalyst home** — remove lines 489–491 (`AddGeoClaimPanel`, `AddSkillClaimPanel`, `AgentTrustSearch`); forms still work on `/me`.
4. **Move `<PrincipalContextChip>` out of the home body** — into `HubLayout.tsx`. Single-line move.
5. **Add the hub eyebrow + name to the H1 line** — surface `getHubProfile(hubId).name` so the user knows which hub they're on. Two-line markup change.

After those five land, you've cleared ~1000px of scroll noise, brought the work queue above the fold, given the Hub Lead a "needs attention" surface that mirrors CIL, and labeled the page with which hub it belongs to. That's the demo-able state.

---

## 6. Recommended Implementation Order

1. **Quick wins (1–5 above)** — single small PR, ~1 day.
2. **Wire field zone (`ActivityFeed` + `CircleMapView`)** — both components exist, just need slot + filter.
3. **Role-aware KPI row** — needs `defaultModeForRole` branching; mid-size PR.
4. `**MyWorkPanel` 2-col grid + mode-picker promotion** — touches `MyWorkPanel` and `DashboardForMode`.
5. `**catalystAttentionItems` aggregator + per-item actions** — biggest single piece; needs server action and 4–5 query types.
6. **Inventory KPI row + delete the four full-panel inventories** — visual cleanup, low-risk.
7. **Footer CTA strip + mobile sticky** — finishes the do-verb story.
8. **Jargon cleanup pass** — single sweep PR.
9. **Empty / first-run states** — last because it's only visible to a small slice of users.

Each step ends in a demoable moment for one of the four personas:

- Step 1 → Hub Lead has a hub-named home with attention items above the fold.
- Step 2 → Group Leader sees their week's activities + map.
- Step 3 → every persona sees role-relevant numbers.
- Step 4 → Coach has work + mentees side-by-side.
- Step 5 → Hub Lead's attention items become 1-click actionable.
- Step 6 → ~600px of clutter gone; navigation through inventory stays intact.
- Step 7 → Group Leader logs a meeting in 1 click.
- Step 8 → non-developers stop bouncing on the words.
- Step 9 → new user lands on a welcoming home, not a void.

---

## 7. Out of Scope (defer)

- New visual identity / palette / typography — token system is settled.
- Mobile app shell — web-only for v0.
- Dashboard builder ("let users pick their own panels") — premature; settle the canonical layout first.
- Cross-hub embedded views (e.g. CIL widget on Catalyst home) — single-hub demo first.
- Real-time updates over WebSocket — polling is fine; promote later if needed.
- Animations beyond hover/focus — flat first, motion later.

---

## 8. Open Questions

1. **Mode-picker location** — promote to tab strip at top of `MyWorkPanel`, or keep it as a header dropdown? Tradeoff: tabs are clearer but eat vertical space.
2. **KPI delta source** — compare-against-last-week needs a snapshot pipeline. Use existing `genmap` weekly roll-up, or compute on the fly from `AgentAssertion` history?
3. **Inventory KPIs vs. inventory list** — collapse fully to KPI cards, or keep a 1-row preview ("Maria · Sarah · Ana") under each count? Lean to pure-count for cleanliness; revisit if users miss the names.
4. **Jargon replacement strings** — settle a glossary doc before the cleanup pass so we don't ping-pong on "edge" → "connection" vs. "link" vs. "relationship".
5. **Hub Lead "all-clear" celebration** — emoji? animation? Plain text with a check? Personality call.

