# UX Audit — Intent Marketplace Discovery
**Date:** 2026-05-06  
**Scope:** Three-lane intent marketplace (`/h/catalyst/*`) as Maria Gonzalez (`cat-user-001`), starting from `/h/catalyst/home`.

---

## Executive Summary

1. **"Discover" and "Intents" have no nav tab at all.** The primary nav for catalyst (`hub-profiles.ts:246–266`) has seven tabs: Home, Nurture, People, Groups, Steward, Funding, Activity. There is no tab labeled "Discover" and no tab labeled "Intents" or "Matches". The only marketplace entry point in the top nav is "Funding" (`/h/catalyst/rounds`), which covers Pool and Proposal lanes but silently omits the Direct lane entirely.

2. **After pledging into a pool, there is no path home.** The pledge confirmation drops the user on the pools list or pool detail. "My pledges" at `/h/catalyst/pledges` is reachable only through: (a) the "My pledges" footer button on the Discover page, (b) the Discover page's "Open pools" section which has a "Browse all" link to `/pools` (not `/pledges`), or (c) by typing the URL. None of these paths are in the global nav, and the home page has no "active commitments" section.

3. **The bottom status bar shows static fixture counts.** `HubLayout.tsx:249–253` hard-codes the Catalyst status bar as `3 agent insights · 1 prayer due today · 2 circles need attention · 1 follow-up pending`. These four items never change regardless of actual data. They link to home, /nurture/prayer, /groups, and /activity — none link to any marketplace surface.

4. **The Discover page counts are mostly real but the headline KPI strip is wrong.** The three headline KPI tiles ("OPEN NEEDS", "PROPOSED MATCHES", "MY MATCHES") read from the legacy `needs` table via `getHubDiscoverSummary()`, not from the newer `intents` table. Maria's `demo-maria-need-trauma-coaching` is in the `intents` table. If minimal-mode seed does not populate the `needs` table, all three KPI tiles show 0.

5. **No counter-offering means the Direct lane candidate list is always empty on first boot.** The spec documents this (§ 6), but there is no automated fix. The "Match candidates for your intents" section on the Discover page is conditionally rendered only when `matchCandidatePreviews.length > 0` — so it is invisible to Maria on a minimal-mode boot.

---

## Per-Lane Walk

### Direct Lane (`/h/catalyst/intents`, `/h/catalyst/matches`, `/h/catalyst/discover`)

**Home-to-lane path:**  
There is no primary nav tab for the Direct lane. The only paths from home are:

- `OpenNeedsStrip` (rendered in Zone 4.5 of `CatalystFieldDashboard`, `HubDashboard.tsx:578–583`). This strip has a "Discover →" button linking to `/h/catalyst/discover` and chips linking to individual intent detail pages. The strip renders only when `total > 0` intents exist (reads from `intents` table via `getHubIntentSummary`). If the strip is present, the user can reach Discover from home. Otherwise there is no path.
- No tab links to `/h/catalyst/intents` or `/h/catalyst/matches` from anywhere in the primary nav.

**Landing-page state at minimal-mode boot:**  
`/h/catalyst/intents` shows three sections (addressed-to-me, I-expressed, hub-wide). Maria has one expressed intent (`demo-maria-need-trauma-coaching`) which will appear in "You expressed" (1 item). The hub-wide section will show the same item (or be de-duped out). The "addressed-to-me" inbox will be empty. The filter pills correctly show counts.

**Active-artifact visibility:**  
No "you have an active match" banner on home. `/h/catalyst/matches` is not linked from anywhere in the nav. The only route from home to matches is through Discover → "My proposed matches" section (which also requires a seeded match) or through the `OpenNeedsStrip`'s "Discover →" button.

**What's missing:**  
- No nav tab for Direct lane.
- No "My matches" shortcut from anywhere in the primary nav.
- The match initiation seeded by `seed-test-match-initiation.ts` is Maria's own self-mode initiation. A second user's counter-offering must be expressed separately for the candidate section to render.

---

### Pool Lane (`/h/catalyst/pools`, `/h/catalyst/pledges`)

**Home-to-lane path:**  
The "Funding" tab (`hub-profiles.ts:262`) links to `/h/catalyst/rounds` (not pools). Its `activePrefixes` array includes `/h/catalyst/pools` and `/h/catalyst/pledges`, so the Funding tab stays highlighted when the user is on pool or pledge pages — but the tab does not land there. To reach Pools from home:

1. Click "Funding" tab → lands on `/h/catalyst/rounds`.
2. There is no secondary nav or sub-tab rendering on Rounds that links to Pools (no `subTabs` defined on the Funding nav item, `hub-profiles.ts:262`).
3. The user must know to navigate directly to `/h/catalyst/pools` or find it through the Discover page's "Open pools" section → "Browse all →" link.

Alternatively, from the Discover page (`/h/catalyst/discover`): the "Open pools" section shows `demo-trauma-care-pool` with a "Browse all →" link to `/h/catalyst/pools`. The Discover page is reachable from the `OpenNeedsStrip` on home (conditional) or by guessing the URL.

**After pledging:**  
After completing a pledge at `/h/catalyst/pools/[poolId]/pledge`, the confirmation redirects (per `PledgeComposer.tsx`) but there is no "View your pledge" CTA in the success state, and `/h/catalyst/pledges` is not in the nav. The user has no discoverable path back to their pledge. Specifically:

- No "My pledges" link in the Funding tab landing page (`/h/catalyst/rounds`).
- No "active pledges" module on the home page.
- The Discover page's footer CTAs include "My pledges" linking to `/h/catalyst/pledges` (`discover/page.tsx:335`), but the user must reach Discover first.

**Landing-page state at minimal-mode boot:**  
`/h/catalyst/pools` shows `demo-trauma-care-pool`. Pool detail at `/h/catalyst/pools/demo-trauma-care-pool` shows `getPoolRecentAllocations()` — if `demo-maria-trauma-care-pledge` is seeded, the pool's "recent allocations" rollup should show Maria's $100/month pledge. This is the only part of Pool lane that has full live-data coverage.

`/h/catalyst/pledges` shows Maria's pledge in the "Active" group (`listMemberPledges()` reads from person-MCP). If `seed-test-pledge.ts` has been run, this page is live.

**What's missing:**  
- No route from Funding tab landing to Pools or Pledges — Funding lands on Rounds only.
- No "active pledge" summary on home.
- No "View my pledge" CTA on pledge success page.

---

### Proposal Lane (`/h/catalyst/rounds`, `/h/catalyst/proposals`)

**Home-to-lane path:**  
The "Funding" tab links directly to `/h/catalyst/rounds` — this is the only lane that is one click from the primary nav. Rounds index page is fully reachable.

**Landing-page state at minimal-mode boot:**  
`/h/catalyst/rounds` shows `demo-trauma-care-q2`. `PriorStatsBlock` on the round detail page reads from GraphDB for prior-cycle data — if GraphDB is not populated this section will be empty.

`/h/catalyst/proposals` shows Maria's two proposals (one draft, one submitted) via `listMemberProposals()`. The list renders correctly with "Resume editing" and "View →" CTAs.

The Discover page shows "My grant proposals" section (`discover/page.tsx:251–281`) populated from `listMemberProposals()`. This section conditionally renders only when `myProposals.length > 0`. With the seed active, this section appears and links to `/h/catalyst/proposals`.

**Active-artifact visibility:**  
Proposals are the best-served lane. The "My grant proposals" section appears on Discover with status badges. However, no "you have a draft in progress" notice appears on the home page.

**What's missing:**  
- No "my proposals" count or CTA on home.
- `PriorStatsBlock` may be empty in minimal-mode (no prior-cycle data in GraphDB).
- The round list page shows a round count but no "you have N proposals submitted" banner.

---

## Discover & Home Count Audit

### Status bar (`HubLayout.tsx:249–253`)
```
"3 agent insights" → STATIC FIXTURE, always "3", links to /h/catalyst/home
"1 prayer due today" → STATIC FIXTURE, always "1", links to /nurture/prayer
"2 circles need attention" → STATIC FIXTURE, always "2", links to /groups
"1 follow-up pending" → STATIC FIXTURE, always "1", links to /activity
```
None of these counts are driven by data. None link to any marketplace surface.

### Discover page headline KPI tiles (`discover/page.tsx:118–134`)
```
OPEN NEEDS      → summary.openNeeds   from getHubDiscoverSummary()
                  reads legacy `needs` table, NOT `intents` table
                  Maria's intent is in `intents` — if `needs` is empty: shows 0

PROPOSED MATCHES→ summary.proposedMatches
                  reads `needResourceMatches` table against `needs` rows
                  if `needs` is empty: shows 0

MY MATCHES      → myMatches.length
                  listMatches({ matchedAgent: myAgent, status: 'proposed' })
                  reads `needResourceMatches` — if seed has match: shows 1
```

The Discover page's deeper sections (match candidates, open rounds, open pools, my proposals) are all driven by real data from the correct tables (`intents`, rounds, pools, proposals). But the three headline counts at top use `getHubDiscoverSummary()` which queries the legacy `needs` table. This creates a split: the sections below the fold are populated, but the headline numbers at the top are zero.

### Home page intent counts
`OpenNeedsStrip` reads from `getHubIntentSummary(hubId)` which queries the `intents` table — this is correct. With `demo-maria-need-trauma-coaching` seeded, the strip shows real data. The KPI tiles on home ("MY OIKOS", "PRAY NOW", "MY CIRCLES", "PERSONAL WALK") are all real data from their respective tables; they do not include any marketplace counts.

---

## Seed-Data Gaps

**Direct Lane:**
1. No counter-intent from a second user. Maria's need candidate list is empty at boot. Fix: add `seed-test-counter-offering.ts` that signs in as `cat-user-002` (Pastor David) and posts a Give intent for `resourceType:Coaching` / `mandate:trauma-care`. Or extend `seed-test-match-initiation.ts` to also seed David's intent. Per spec § 6, this is the documented workaround; the fix is to automate it.

2. The self-mode `MatchInitiation` seeded for Maria (in `seed-test-match-initiation.ts`) does not create a "proposed match" in `needResourceMatches` — it creates a record in the `matchInitiations` table. The "MY MATCHES" KPI on Discover reads `needResourceMatches` (legacy), so it will show 0 even with the initiation seeded.

**Pool Lane:**
3. `demo-maria-trauma-care-pledge` shows in `pledges` page and pool detail "recent allocations" rollup, but only if `seed-test-pledge.ts` has been run. `fresh-start.sh` does not call this script. Verify it is in `seed_after_deploy()` or the pledge will not appear on first boot.

4. No second donor pledge. The pool's "recent allocations" rollup will show only Maria. A second pledge from `cat-user-002` would show the pool is funded by multiple donors, which is the whole point. Extend `seed-test-pledge.ts` with a David pledge.

**Proposal Lane:**
5. No prior-cycle data for `demo-trauma-care-q2`. `PriorStatsBlock` (`rounds/(components)/PriorStatsBlock.tsx`) shows "no previous cycle data" at minimal-mode boot. The component is rendered on the round detail page and is visually prominent. Add a stub prior-cycle record in the round seed.

6. The proposal list row (`proposals/page.tsx:244`) renders `Round: <short URN>` and `Intent: <short URN>` rather than a human-readable round name. With short opaque IDs this reads as `Round: demo-trau…` and `Intent: demo-mari…`. Not a seed gap but a display gap.

---

## Recommended Nav and Home Changes

### P0 — Direct lane is unreachable from the nav

**File:** `apps/web/src/lib/hub-profiles.ts:246–266`

The catalyst `navItems` array has no tab for `/h/catalyst/intents`, `/h/catalyst/matches`, or `/h/catalyst/discover`. Add a "Discover" tab between "Home" and "Nurture" (or after "Funding") that covers all three Direct lane surfaces:

```
Current position: no entry
Proposed new nav item (insert at index after Funding):
  href: '/h/catalyst/discover',
  label: 'Discover',
  section: 'primary',
  activePrefixes: [
    '/h/catalyst/discover',
    '/h/catalyst/intents',
    '/h/catalyst/matches',
    '/h/catalyst/needs',
    '/h/catalyst/offerings',
  ]
```

This is a one-line change to the `navItems` array. The Funding tab already handles the Pool/Proposal active-prefix highlighting.

### P0 — "Funding" tab lands on Rounds, pools and pledges have no entry point

**File:** `apps/web/src/lib/hub-profiles.ts:262`

Either: (a) add sub-tabs to the Funding nav item, or (b) add a section header on the Rounds index page that surfaces Pool and Pledge entry points.

Option (a) is cleaner — the `HubNavItem` type already supports `subTabs`:
```
{
  href: '/h/catalyst/rounds',
  label: 'Funding',
  section: 'primary',
  activePrefixes: [...existing...],
  subTabs: [
    { href: '/h/catalyst/rounds',   label: 'Rounds' },
    { href: '/h/catalyst/pools',    label: 'Pools' },
    { href: '/h/catalyst/pledges',  label: 'My pledges' },
    { href: '/h/catalyst/proposals', label: 'My proposals' },
  ]
}
```

Sub-tabs are rendered by `HubLayout.tsx` via `activeSubTabs` from `HubContext.tsx:100–112`. The rendering code already exists but is never triggered because no nav item currently has `subTabs` defined.

### P1 — Home has no "active commitments" module

**File:** `apps/web/src/components/dashboard/HubDashboard.tsx` (`CatalystFieldDashboard`)

Add a "Your active marketplace items" strip rendered between Zone 4.4 (ActiveFulfillmentsStrip) and Zone 4.5 (OpenNeedsStrip). It should surface:
- Active pledge count with "Manage pledges →" link (reads `listMemberPledges()`, show only if count > 0)
- Draft/submitted proposal count with "My proposals →" link (reads `listMemberProposals()`, show only if count > 0)
- Expressed intent count with "My intents →" link (reads `listIntents({ expressedBy: myAgent })`, show only if count > 0)

Wrap in Suspense (same pattern as ActiveFulfillmentsStrip). Build as a new `<ActiveMarketplaceStrip userId hubSlug />` server component alongside the existing strip components.

### P1 — Pledge success page has no "View your pledge" CTA

**File:** `apps/web/src/app/h/[hubId]/(hub)/pools/[poolId]/pledge/PledgeComposer.tsx`

On pledge submission success, the confirmation state should display:
- "Pledge recorded" heading
- Summary of amount / cadence
- "View your pledges →" linking to `/h/${slug}/pledges`
- "Back to pool →" linking to `/h/${slug}/pools/${poolId}`

Currently the user has nowhere to navigate after pledging without using the back button or knowing the URL.

### P1 — Discover page headline KPIs read legacy `needs` table

**File:** `apps/web/src/lib/actions/discover.action.ts:614–668`

`getHubDiscoverSummary()` queries `schema.needs` and `schema.needResourceMatches`. These tables belong to the pre-spec-001 architecture. Post-migration, open intents live in `schema.intents`. The function needs a second implementation that reads `intents` for "OPEN NEEDS" count, and either keeps or bridges `needResourceMatches` for "PROPOSED MATCHES". Until this is fixed, all three headline KPI numbers on Discover read 0 in minimal-mode (or any fresh-start without the legacy needs seed).

### P2 — Status bar fixtures never reflect real data

**File:** `apps/web/src/components/hub/HubLayout.tsx:244–253`

The Catalyst status bar is four hard-coded strings. At minimum, replace two of them with live marketplace links:
- Replace "3 agent insights" with a dynamic "N intents · N pledges" that reads from a lightweight summary endpoint.
- Or replace the last two static items with: `"N open intents" → /h/catalyst/discover` and `"N active pledges" → /h/catalyst/pledges`.

This is medium complexity; the status bar is a client component and would need a `useEffect` or a data-fetch in `HubLayoutInner`. Lower priority than adding the nav tabs, but higher value than the existing static fixtures which mislead the user (the "3 agent insights" link just takes them back to home).

### P2 — Proposal list row shows opaque URN fragments instead of names

**File:** `apps/web/src/app/h/[hubId]/(hub)/proposals/page.tsx:211–213`

```
Round: <code>{proposal.roundId.slice(0, 8)}…</code>
Intent: <code>{proposal.basedOnIntentId.slice(0, 8)}…</code>
```

Replace with human-readable names. `listMemberProposals()` should be extended to hydrate `roundDisplayName` and `intentTitle` fields, or the proposal object should carry `title` at the top level. The current display is developer-legible but user-opaque.

---

## Developer Handoff Notes

- Sub-tab rendering in `HubLayout.tsx` works but requires `subTabs` to be populated in the profile. No code changes needed in the layout — only the profile definition.
- `OpenNeedsStrip` already links to `/h/${hubSlug}/discover` dynamically. Once the "Discover" nav tab is added, the strip's "Discover →" button becomes a redundant shortcut (fine to keep).
- `getHubDiscoverSummary()` fix: the function is called only by `discover/page.tsx:45`. Changing its data source does not affect any other consumer.
- `ActiveMarketplaceStrip` suggestion: three server actions already exist (`listMemberPledges`, `listMemberProposals`, `listIntents`) — the component is purely additive with no new actions needed. Wrap in Suspense with a skeleton that matches `CatalystAttentionStripSkeleton`.
- The pledge seed (`seed-test-pledge.ts`) needs to be verified in `seed_after_deploy()` in `scripts/fresh-start.sh` — if it is missing from that function, Maria's pledge will not exist on a first-boot demo.
