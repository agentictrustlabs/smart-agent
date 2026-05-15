# Auth, Sessions, and Delegation

This document shows how browser authentication, agent sessions, A2A session packages, and MCP authorization fit together.

## Layers

```mermaid
flowchart TB
  human["Human user"]
  login["Login method: passkey, SIWE, demo"]
  webSession["Web app session"]
  agent["Person or org AgentAccount"]
  a2aSession["A2A session package"]
  delegation["Delegation and caveats"]
  mcpToken["MCP request token"]
  tool["MCP tool execution"]

  human --> login --> webSession
  webSession --> agent
  webSession --> a2aSession
  a2aSession --> delegation
  delegation --> mcpToken
  mcpToken --> tool
```

## Login And Web Session

The web app establishes the user session through its auth routes and helpers.

Key files:

- `apps/web/src/app/api/auth/siwe-verify/route.ts`
- `apps/web/src/app/api/auth/passkey-*/`
- `apps/web/src/app/api/demo-login/route.ts`
- `apps/web/src/lib/auth/session.ts`
- `apps/web/src/lib/auth/get-current-user.ts`

The web session identifies the current user, selected org or hub context, wallet or passkey state, and the user's agent address where available.

## A2A Session Bootstrap

```mermaid
sequenceDiagram
  participant User as Browser
  participant Web as apps/web
  participant A2A as apps/a2a-agent
  participant Chain as AgentAccount and DelegationManager

  User->>Web: Start agent-enabled session
  Web->>A2A: /session/init for agent host
  A2A-->>Web: Challenge and session metadata
  Web->>User: Explain requested agent permissions
  User->>Web: Sign or approve delegation
  Web->>A2A: Store encrypted session package
  A2A->>A2A: Persist session and expiry
  A2A-->>Web: A2A session token
  Web-->>User: Agent session ready
```

Key files:

- `apps/web/src/lib/actions/a2a-session.action.ts`
- `apps/a2a-agent/src/routes/session.ts`
- `apps/a2a-agent/src/routes/session-meta.ts`
- `apps/a2a-agent/src/db/schema.ts`

## Delegation Request Flow

The A2A session package gives the A2A service enough delegated authority to call approved tools for the current agent context. Tool-level authority should be narrow and caveated.

```mermaid
flowchart TD
  rootGrant["User-approved root grant"]
  sessionGrant["Session-scoped grant"]
  caveats["Caveats: tool, target, value, time"]
  a2aStore["Encrypted A2A session store"]
  mcpCall["MCP call"]
  verifier["MCP verifier"]
  action["Allowed action"]
  reject["Reject request"]

  rootGrant --> sessionGrant --> caveats --> a2aStore --> mcpCall --> verifier
  verifier --> action
  verifier --> reject
```

Relevant contract and SDK concepts:

- `DelegationManager`
- caveat enforcers such as timestamp, value, target, and method enforcers
- `hashDelegation`, caveat builders, and encoders from `@smart-agent/sdk`
- ERC-1271 validation on AgentAccount

## MCP Authorization Flow

```mermaid
sequenceDiagram
  participant Web as apps/web
  participant A2A as apps/a2a-agent
  participant MCP as MCP service
  participant Chain as Chain contracts
  participant DB as MCP private DB

  Web->>A2A: POST /mcp/org/round:open
  A2A->>A2A: Load session package
  A2A->>A2A: Mint delegation token
  A2A->>MCP: POST /tools/round:open
  MCP->>Chain: Verify delegation or account authority
  MCP->>DB: Read or write private data
  MCP->>Chain: Optional registry transaction
  MCP-->>A2A: Result
  A2A-->>Web: Result
```

## Session State

The A2A database stores:

- challenges
- sessions
- handles
- execution audit entries

File:

- `apps/a2a-agent/src/db/schema.ts`

The web database stores web-specific auth, local user account, invite, recovery, and bootstrap state.

Files:

- `apps/web/src/db/schema.ts`
- `apps/web/src/db/index.ts`

## Revocation And Expiry

Session authority should end through one of these paths:

```mermaid
flowchart LR
  user["User chooses Stop agent"]
  expiry["Session expires"]
  revoke["On-chain revocation"]
  local["A2A local session invalidated"]
  mcp["Future MCP calls fail"]

  user --> revoke --> local --> mcp
  expiry --> local
```

Relevant routes and files:

- `apps/web/src/app/(authenticated)/sessions/permissions/page.tsx`
- `apps/web/src/app/api/a2a/revoke/route.ts`
- `apps/a2a-agent/src/routes/delegation.ts`
- `apps/a2a-agent/src/routes/onchain-redeem.ts`

## Development Guidance

- Do not put private keys in `NEXT_PUBLIC_*`.
- Treat AnonCreds as proof and eligibility material, not as transaction signatures.
- Use passkeys, EOAs, or AgentAccount validation for signing and account control.
- Keep delegation scopes narrow and time-bound.
- New MCP tools should define explicit tool policy and caveats before the web UI calls them.
