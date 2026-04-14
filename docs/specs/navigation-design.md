# Navigation & UX Design — "My World, Agent-Powered"

## Status: Active Design Direction (April 2026)

## Core Insight

The user opens the app and sees **their world** — not an admin panel, not a database viewer. It feels like a living workspace where their agents, relationships, and intentions come together. The navigation is organized by **what they want to accomplish**, the content adapts to **who they are**, and their agents help them **know what to do next**.

---

## Design Principles

### 1. "I see my whole world"
The user sees everything at once — their personal walk, their groups, their org responsibilities. Navigation organizes by **activity type / intent**, not by organizational context. Like a personal dashboard with sections.

### 2. Intent-based navigation
Tabs are organized by what the user wants to accomplish (Connect, Nurture, Build, Steward) rather than by data type (Members, Groups, Activities). This naturally adapts — a funder's "Steward" looks different from a pastor's "Steward."

### 3. Role-adaptive filtering, not separate apps
A mode toggle (My Walk / Manage) **filters** what you see on the current page — same URL, different depth of data. It's not two separate apps.

### 4. Agent-powered intelligence
AI agents surface proactively through contextual cards, a persistent chat panel, and ambient notifications. Each agent (personal, group, AI) has an A2A backend that acts as a digital twin with knowledge and memory.

### 5. Desktop density, mobile field-optimized
Desktop uses full screen width with optional agent panel. Mobile gets a completely different nav paradigm optimized for field use (future phase).

---

## Architecture Decisions

### Flat root-level routes
No `/catalyst` prefix. Clean, human-readable URLs:

```
/                     Home (role-adapted dashboard)
/circles              Connect — circles of influence
/circles/[id]         Person detail
/nurture              Nurture overview (prayer + training)
/nurture/prayer       Prayer tracker
/nurture/grow         Training progress
/nurture/coaching     Coaching dashboard
/groups               Build — group hierarchy
/groups/[address]     Group detail (tabs: Details, Members, Activities, Map)
/steward              Steward overview
/steward/treasury     Treasury
/steward/reviews      Reviews / endorsements
/steward/governance   Governance proposals
/steward/network      Network trust graph
/activity             Activity feed / log
/activity/calendar    Calendar view
/me                   Profile, sharing, settings
/agents/[address]     Agent detail (any type)
```

**Implementation**: Next.js rewrites map root URLs to existing `/catalyst/*` pages. No file moves needed. Old paths still work.

### Hub-driven metadata
Each hub (Global.Church, Catalyst, CIL) stores navigation config, features, theme, and vocabulary **on-chain** via resolver predicates. Static profiles in `hub-profiles.ts` serve as fallbacks. The navigation reads on-chain config first.

### Role-to-tool mapping
The SDK role taxonomy (`RoleDefinition`) carries a `tools` array declaring which UI capabilities each role grants. The user-context API resolves the union of all tools from the user's actual relationship roles. Nav items with `requiresCapability` are filtered against these tools.

---

## Desktop Layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [Logo] Smart Agent    Home  Connect  Nurture  Build  Steward  Activity  │
│                                              [My Walk ↔ Manage] [🤖] [👤▾]│
├──────────────────────────────────────────────────────────────────────────┤
│ Build > Grace Community Church > Members                    (breadcrumb)│
├──────────────────────────────────────────────┬───────────────────────────┤
│                                              │                           │
│           Main Content                       │   Agent Panel (toggle)    │
│           (full width when panel closed)     │                           │
│                                              │   "2 members haven't      │
│           Role-adapted, context-aware        │    checked in. Follow     │
│                                              │    up with Maria?"        │
│           Contextual agent cards             │                           │
│           embedded in page flow              │   [Ask your agent...]     │
│                                              │                           │
├──────────────────────────────────────────────┴───────────────────────────┤
│ 🔔 3 suggestions · 🙏 1 prayer due · 📊 2 groups flagged · ✉ 1 message │
└──────────────────────────────────────────────────────────────────────────┘
```

### Header
- **Left**: Logo + brand name. Click goes to `/`.
- **Center**: 6 intent-based primary tabs as pills.
- **Right**: Mode toggle (My Walk / Manage), Agent panel toggle (🤖), User avatar dropdown.

### Breadcrumbs
Below header, only when navigated deeper than top-level tab. Derived from pathname + agent metadata.
Example: `Build > Grace Community Church > Members`

### Agent Panel
Toggleable right panel (320px). Shows the contextual agent for the current page. Chat input at bottom. Slide-in animation. When closed, content gets full width.

### Bottom Status Bar
Fixed, subtle, 36px. Aggregates cross-cutting notifications from agents. Each item clickable.

---

## The 6 Tabs

| Tab | Route | My Walk mode | Manage mode |
|-----|-------|-------------|-------------|
| **Home** | `/` | Personal dashboard — greeting, today's focus, agent suggestions | Org dashboard — KPIs, movement metrics, team activity |
| **Connect** | `/circles` | My circles of influence, planned conversations, outreach | All contacts across org, team outreach, demographics |
| **Nurture** | `/nurture` | My prayer list, personal training, devotional | Team prayer needs, training completion, coaching dashboard |
| **Build** | `/groups` | Groups I lead, their health, my gen map branch | Full group hierarchy, all church circles, gen map, geo map |
| **Steward** | `/steward` | My giving, personal accountability | Treasury, reviews, governance, network trust, delegations |
| **Activity** | `/activity` | My recent activities, what I logged | All org activities, team feed, calendar, field reports |

### Hub-specific tab variations

- **CIL hub**: Build becomes "Portfolio", Activity becomes "Operations", Nurture hidden (not a discipleship context)
- **Generic hub**: Connect/Nurture hidden, Build becomes "Organizations", Steward becomes "Manage"
- **Global Church / Catalyst**: Full set of all 6 tabs

---

## Mode Toggle: My Walk / Manage

The toggle does NOT navigate. It **filters** what appears on the current page:
- Same URL
- "My Walk": shows personal data, items I own/lead, my prayer/training
- "Manage": shows org-wide data, all members, all groups, aggregated metrics
- State persists across tab navigation
- Visibility: only shown when user has roles that warrant both modes (e.g., leader + disciple)

---

## User Dropdown (right side)

```
YOUR ACCOUNT
  [Avatar] James — Senior Pastor
  Edit profile | Settings

MY GROUPS
  ● Grace Community Church (owner)
  ● Youth Ministry (operator)

COACHING
  ● Dr. Sarah Mitchell (disciple)

ORGANIZATIONS
  ● Global.Church Network (board-member)
  ● ECFA (member)

AI AGENTS
  ● Growth Analytics (AI)

──────────
Disconnect
```

Personalized nav sections built from the user's actual agent relationships (resolved server-side).

---

## Agent Intelligence Layer

### Three tiers (all present, layered):

**1. Contextual cards (inline in pages)**
Embedded in page content. Role-filtered. The group page shows a card from the group's agent. The prayer page shows a card from the personal agent.

```
┌───────────────────────────────────────────────────┐
│ 🤖 Grace Analytics                                │
│ "2 of your 3 daughter groups haven't reported     │
│  health metrics this month."                      │
│  [View Details]  [Dismiss]  [Ask More]            │
└───────────────────────────────────────────────────┘
```

**2. Persistent chat panel (right side)**
Toggle via 🤖 icon. Shows the contextual agent for the current page. Chat input for deeper interaction. Remembers conversation within session.

**3. Notification/status bar (bottom)**
Ambient awareness. Aggregates suggestions from all agents. Non-intrusive.

### Agent context mapping:
- `/groups/0xABC` → that group's organization agent
- `/circles`, `/nurture` → user's personal agent
- `/steward/treasury` → finance AI agent
- `/activity` → activity tracker agent
- Default → user's personal agent

### Future: A2A integration
Each agent (personal, group, AI) will have an Agent-to-Agent backend that is a digital twin with robust knowledge and memory. The panel will connect to these backends for real intelligence.

---

## Role-to-Tool Authorization

The SDK `RoleDefinition` carries a `tools` array:

| Role | Tools granted |
|------|-------------|
| owner | all tools |
| board-member | governance, treasury, reviews, network, agents, members, activities, circles, prayer, grow |
| operator | activities, members, genmap, map, circles, prayer, grow, coaching |
| member | activities, members, circles, prayer, grow |
| treasurer | treasury, reviews |
| reviewer | reviews |
| advisor | network, reviews, activities, circles, prayer, grow |

Nav items with `requiresCapability` are filtered against the union of tools from all the user's roles across all their orgs.

---

## First-Time Delight

When a new user lands for the first time:

1. **Warm greeting** — "Good day, James" with time-of-day awareness
2. **Populated world** — circles, groups, prayer items visible (from seed data or onboarding)
3. **Agent speaks first** — contextual card: "Welcome. I see you lead Grace Community Church with 3 ministry groups. Here's what I'd focus on this week."
4. **One clear action** — the dashboard surfaces the single most important thing, not a wall of KPIs
5. **Visual warmth** — cream/brown palette, personal language ("your circles", "your walk"), agent voice

---

## Technical Implementation

### Route mapping (next.config.ts rewrites)
Root-level URLs rewrite to existing `/catalyst/*` pages. No file moves required.

### On-chain hub config predicates
- `ATL_HUB_NAV_CONFIG` — JSON navigation items
- `ATL_HUB_FEATURES` — JSON feature flags
- `ATL_HUB_THEME` — JSON theme colors
- `ATL_HUB_VIEW_MODES` — JSON view mode definitions
- `ATL_HUB_GREETING` — greeting template string
- `ATL_HUB_VOCABULARY` — domain-specific label overrides

### Key components
- `HubLayout` — authenticated layout wrapper (header + breadcrumbs + content + status bar)
- `HubProvider` / `HubContext` — resolves hub profile, filters nav, provides context
- `AgentPanel` — toggleable right panel with contextual agent chat
- `AgentCard` — inline suggestion cards from agents
- `StatusBarItems` — ambient notification aggregation

### Data flow
```
User logs in
  → user-context API resolves person agent, orgs, roles, delegations, hubs
  → getToolsForRoles() computes UI capabilities from role taxonomy
  → getHubProfileFromChain() reads hub config from on-chain resolver
  → HubContext merges: hub features ∩ user tools = visible nav items
  → personalNav built from user's relationship graph
  → HubLayout renders adaptive header + content
```

---

## Open Questions / Future Work

- **Mobile paradigm**: Completely different nav for mobile (bottom tabs, swipe, field-optimized). Not responsive CSS — different component tree.
- **A2A agent backends**: Each agent gets a real backend with knowledge, memory, and reasoning. Panel connects via A2A protocol.
- **Delegation-to-tool mapping**: Delegations with specific caveats could further scope which tools are available (e.g., time-limited treasury access).
- **Hub switching**: Users in multiple hubs may need to switch between them. Currently resolved by primary org.
- **Offline mode**: Field workers need offline capability with sync.
- **i18n**: Full translation infrastructure beyond English/Spanish toggle.

---

## Reference Apps

- **GAPP** (thegapp.app) — church planting field tool. Church circles, gen map, member management, activity funnel. Video reference analyzed for feature comparison.
- **Multiply** (multiply.global.church) — personal discipleship tool. Circles of influence, prayer tracker, training progress, coach relationships. Live site crawled for feature/language comparison.

See also: `docs/specs/multiply-comparison.md` for detailed feature comparison.
