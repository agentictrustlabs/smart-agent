# Multiply (global.church) vs Smart Agent Catalyst — Feature Comparison

## Overview

**Multiply** (multiply.global.church) is a disciple-centric personal discipleship tool where each user tracks their own spiritual walk, relationships, prayer life, and growth. It is individual-first.

**Smart Agent Catalyst** is an organization/network management tool with on-chain identity, delegation, and trust graphs. It is organization-first but now incorporates personal discipleship features inspired by Multiply.

## Architecture Differences

| Aspect | Multiply | Smart Agent Catalyst |
|--------|----------|---------------------|
| Identity | Email/password accounts | ERC-4337 smart accounts + Privy auth |
| Data storage | Server-side database | On-chain resolver + SQLite hybrid |
| Relationships | Coach/disciple in app DB | On-chain edges with role taxonomy |
| Permissions | Role-based (Disciple/Coach) | Delegated authority with caveats |
| Multi-org | Single workspace | Multi-org with team selectors |
| Terminology | Church planting / DMM | Agents / organizations / trust graphs |

## Navigation Comparison

| Multiply | Smart Agent Catalyst |
|----------|---------------------|
| Bottom tabs: Home, Circles, Prayer, Church, Grow | Bottom tabs: Home, Circles, Prayer, Church, Grow |
| Top bar: branding + user dropdown | Top bar: branding + Disciple/Coach switcher + user dropdown |
| No sidebar | Sidebar available for admin views (Groups, Members, etc.) |
| Role switcher: Disciple / Coach pills | Role switcher: Disciple / Coach pills (from UserContext) |

## Feature Comparison

### Implemented (Matching Multiply)

| Feature | Multiply | Smart Agent | Notes |
|---------|----------|-------------|-------|
| Circles of Influence (Oikos) | Concentric ring viz, add people, track responses | Concentric ring SVG, proximity rings, response tracking | Matching |
| Prayer Tracker | Scheduled prayers, Mark Prayed, History, Answered | Day-of-week scheduling, Mark Prayed, 3 views | Matching |
| Grow / Training | 411 Training %, Commands of Christ (Obeying/Teaching) | 6 modules, 10 commands with dual-track checkboxes | Matching |
| 3/3rds Meeting | Practicing/Teaching badges | Yes/No toggles with green badges | Matching |
| Church Circle | Count badge, link to church list | Links to /catalyst/groups | Matching |
| Personal Walk | Daily Scripture prompt (stub) | Placeholder card | Both stubs |
| Coach Relationship | Data sharing with privacy toggles | Coach display, sharing section | Simplified |
| Profile Page (/me) | Name, location, home church, language, sharing | Name, location, home church, language, coach display | Matching |
| Language Toggle | English / Espanol | English / Espanol pill toggle | Matching |
| Home Dashboard | Greeting, KPI cards, encouragement banner | Time-aware greeting, KPIs, encouragement banner | Matching |
| Planned Conversations | Dashboard card with linked names | Toggle per circle person, dashboard summary | Matching |
| Sow This Week | Gospel conversation counter | Activity count from outreach type | Matching |
| Active Shares | Coach name badge | Coach name on dashboard | Matching |
| Example Accounts | 5 demo users (Maria, Elena, Kofi, Samuel, Anna) | Demo mode via SKIP_AUTH with seed data | Different approach |
| Church Health Indicators | GAPP-style Yes/No toggles | Full GAPP form with 10+ indicators | Extended |
| Gen Map | GAPP church circles tree | Hierarchical tree + map + church circles SVG | Extended |
| Members Management | GAPP table with roles, detached members | Full GAPP table + search + pagination + edit dialogs | Extended |

### Smart Agent Has, Multiply Does Not

| Feature | Description |
|---------|-------------|
| On-chain identity | ERC-4337 smart accounts for agents and orgs |
| Trust graph | Visual network of relationships with edge types |
| Delegation system | Programmable authority delegation with caveats |
| Multi-org management | Users can belong to multiple organizations |
| Agent deployment | Deploy person, org, or AI agents on-chain |
| TEE validation | Trusted execution environment simulation |
| Treasury tracking | Revenue reports and financial management |
| Governance proposals | On-chain voting and quorum-based decisions |
| Template system | Delegation templates for standardized permissions |
| Invite system | Code-based invitations with role assignment |
| Notification system | In-app messages for relationship and governance events |

### Multiply Has, Smart Agent Does Not Yet

| Feature | Description | Priority |
|---------|-------------|----------|
| Rich prayer scheduling | Multiply has "every day", specific days, frequency reminders | Low (basic version implemented) |
| Prayer answered celebrations | Visual celebration when marking prayer answered | Low |
| Full i18n translation | Actual Spanish translations of all UI text | Medium |
| Scripture prompts | Daily Scripture display in Personal Walk section | Low |
| Oikos response tracking depth | Multiply tracks response changes over time as a journey | Medium |
| Coach data sharing toggles | Per-category privacy controls for what coach can see | Medium |
| Gospel conversation logging | Dedicated "sow" flow separate from general activities | Low |
| Warm onboarding flow | Multiply guides new users through initial setup steps | Medium |
| Offline support | Multiply designed for areas with spotty connectivity | High (future) |

## Terminology Mapping

| Multiply Term | Smart Agent Term | Context |
|---------------|-----------------|---------|
| Circles | Tracked Contacts / Members | People in your relational orbit |
| Oikos | Circles of Influence | Greek term for household/network |
| Prayer focuses | Prayers | Items to pray for regularly |
| Sow | Outreach activity | Sharing the gospel |
| 411 Training | Training modules | Foundational discipleship curriculum |
| Commands of Christ | Training modules (commands program) | 10 commands to obey and teach |
| 3/3rds Meeting | Meeting activity type | Structured group meeting format |
| Church Circle | Gen Map node / Group | A simple church or gathering |
| Coach | Coach role (coach_relationships table) | Someone who mentors disciples |
| Disciple | Team member / User | Someone being mentored |
| Home Church | User preference (home_church) | Primary church affiliation |
| Sharing | Coach grants / share_permissions | What data you share with your coach |
| Multiply | Catalyst | Hub/product branding |
| Alliance | Church Lineage | On-chain relationship type for parent-child churches |
| Strategic Partner | Parent Church | On-chain role for parent in lineage |
| Subsidiary | Daughter Church | On-chain role for child in lineage |
| Gathering | Group (dashed circle) | Not-yet-established church |
| Established | Church (solid circle) | Self-functioning church |

## Roles Observed in Multiply

| User | Roles | Characteristics |
|------|-------|----------------|
| Maria | Disciple | San Diego, coached by Anna, 5 circles, active prayer life |
| Elena | Disciple | Mexico City, Spanish-speaking, 2 circles, early stage |
| Kofi | Disciple | Africa region, coached by Samuel, 3 circles, students |
| Samuel | Disciple + Coach | Lagos NG, 100% training, 1 church, coaches Kofi |
| Anna | Disciple + Coach | Lisbon PT, coaches Maria, active prayer life |

### Role Behavior Differences

- **Disciple only**: Sees Home, Circles, Prayer, Church, Grow. No role switcher in header.
- **Disciple + Coach**: Gets "Disciple" and "Coach" pill tabs in the header. Coach view would show disciples' shared data (not fully built in Multiply Phase 0 either).

## Visual Design Comparison

| Aspect | Multiply | Smart Agent Catalyst |
|--------|----------|---------------------|
| Background | Warm cream (#faf8f3) | Warm cream (#faf8f3) in Catalyst hub |
| Accent color | Brown (#8b5e3c) | Brown (#8b5e3c) in Catalyst, teal (#0d9488) elsewhere |
| Cards | Cream with subtle gold/beige borders | Matching warm card style |
| Buttons | Brown filled, rounded pills | Brown filled pills in Catalyst |
| Typography | Clean sans-serif, uppercase section headers | Matching |
| Icons | Custom SVG icons in bottom tabs | Custom SVG icons in bottom tabs |
| Overall feel | Warm, personal, inviting | Matches in Catalyst hub; more corporate in admin views |
