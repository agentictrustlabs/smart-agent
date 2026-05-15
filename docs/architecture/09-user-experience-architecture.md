# User Experience Architecture

This document defines the product-facing architecture of the Smart Agent web app: navigation, user mental models, action surfaces, funding workflows, trust/identity concepts, and reusable UI patterns.

## UX Architecture Goals

- Make complex agent, credential, delegation, funding, and trust concepts understandable to non-technical users.
- Keep one user-facing name per concept.
- Separate action, alert, activity, engagement, and history.
- Make irreversible or money-moving actions reviewable before execution.
- Hide technical identifiers unless the user explicitly opens technical details.

## Product Mental Models

```mermaid
flowchart TD
  user["User"]
  hub["Community hub"]
  identity["Digital identity"]
  agent["Agent assistant"]
  actionCenter["Action Center"]
  marketplace["Marketplace and grants"]
  trust["Trust and credentials"]
  treasury["Treasury and funds"]

  user --> hub
  user --> identity
  identity --> agent
  hub --> actionCenter
  hub --> marketplace
  hub --> trust
  marketplace --> treasury
```

## Navigation Model

The app currently has global authenticated routes, hub routes, Catalyst rewrites, and dropdown-only account routes. The target UX should make these feel like one product.

```mermaid
flowchart TB
  home["Hub home"]
  actionCenter["Action Center"]
  marketplace["Marketplace"]
  people["People and orgs"]
  trust["Trust"]
  account["My Account"]
  admin["Admin and stewardship"]

  home --> actionCenter
  home --> marketplace
  home --> people
  home --> trust
  home --> account
  home --> admin
```

## Action Center Model

Use Action Center as the umbrella for “things that need my attention.”

```mermaid
flowchart TD
  actionCenter["Action Center"]
  actions["Actions: requires user input"]
  alerts["Alerts: awareness"]
  activity["Activity: history"]
  engagements["Engagements: long-running work"]

  actionCenter --> actions
  actionCenter --> alerts
  actionCenter --> activity
  actionCenter --> engagements
```

User-facing terms:

| Term | Meaning |
| --- | --- |
| Action | Something the user must do: vote, sign, attest, release, approve |
| Alert | Something the user should know |
| Activity | What happened in the past |
| Engagement | A long-running relationship or commitment |
| Next step | A single recommended step inside an engagement |

Avoid using `work item`, `inbox task`, or implementation type names in primary UI.

## Funding UX Lifecycle

```mermaid
flowchart LR
  intent["Need or offer"]
  funding["Funding round or pool"]
  apply["Apply or pledge"]
  review["Review and vote"]
  award["Award"]
  commitment["Commitment"]
  milestone["Milestone evidence"]
  payment["Milestone payment"]
  outcome["Outcome"]

  intent --> funding --> apply --> review --> award --> commitment --> milestone --> payment --> outcome
```

Recommended user-facing labels:

| Technical term | Preferred UI label |
| --- | --- |
| Round | Funding round |
| Pool | Giving pool or funding pool |
| Mandate | Fund focus |
| Proposal | Grant application |
| VoteRegistry ballot | Vote |
| Commitment | Commitment or award schedule |
| Tranche | Milestone payment |
| Attestation | Confirm milestone |
| Honor pledge | Release payment or confirm payment |

## Identity, Agent, Credential, And Treasury UX

```mermaid
flowchart TD
  account["My Account"]
  identity["Identity"]
  credentials["Credentials"]
  permissions["Agent permissions"]
  funds["Funds"]
  history["Security activity"]

  account --> identity
  account --> credentials
  account --> permissions
  account --> funds
  account --> history
```

Use plain language:

| Technical term | UI label |
| --- | --- |
| AgentAccount | Digital identity or agent account |
| Delegation | Permission |
| Caveat | Limit |
| AnonCreds | Credential |
| Holder wallet | Credential wallet |
| Link secret | Hide unless technical details |
| GraphDB | Public knowledge graph |

## Confirmation Pattern

All irreversible, permission-changing, or money-moving actions should use an explicit review screen or modal.

```mermaid
flowchart LR
  intent["User clicks action"]
  review["Review details"]
  sign["Confirm and sign"]
  execute["Execute"]
  result["Show result and audit link"]

  intent --> review --> sign --> execute --> result
```

Review screens should show:

- action name,
- amount if money moves,
- source and recipient,
- authority or permission used,
- expiry or limits,
- consequence,
- cancel path.

## UX Source Files

Primary areas:

- `apps/web/src/components/hub/HubLayout.tsx`
- `apps/web/src/components/dashboard/HubDashboard.tsx`
- `apps/web/src/components/work-queue/MyWorkPanel.tsx`
- `apps/web/src/app/h/[hubId]/(hub)/tasks/page.tsx`
- `apps/web/src/app/h/[hubId]/(hub)/rounds`
- `apps/web/src/app/h/[hubId]/(hub)/pools`
- `apps/web/src/app/h/[hubId]/(hub)/proposals`
- `apps/web/src/app/(authenticated)/wallet/page.tsx`
- `apps/web/src/app/(authenticated)/treasury/page.tsx`
- `apps/web/src/app/(authenticated)/sessions/permissions/page.tsx`

Related docs:

- `docs/specs/ux-component-specs.md`
- `docs/product/hub-site-redesign.md`
- [Marketplace and Funding Architecture](./06-marketplace-funding-flow.md)
- [Persistence and Data Stores](./05-persistence-data-stores.md)

## UX Architecture Rules

- Prefer progressive disclosure over dense technical panels.
- Never use raw enum values as labels.
- Resolve names before showing addresses.
- Use empty states with a useful next action.
- Keep technical details behind `Show technical details`.
- Make role and permission context visible: “You can do this because...”
- Treat accessibility as architecture: focus, labels, contrast, keyboard flow, and mobile layout are part of the system design.
