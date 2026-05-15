# Web, A2A, and MCP Flows

This document describes how the web app reaches backend tools. The preferred model is:

`Web server action -> A2A agent -> MCP tool -> domain store or chain`.

## Main Flow

```mermaid
sequenceDiagram
  participant User as Browser user
  participant Web as apps/web
  participant A2A as apps/a2a-agent
  participant MCP as Domain MCP
  participant Store as DB or chain

  User->>Web: Submit UI action
  Web->>Web: Server action or API route
  Web->>A2A: POST /mcp/:server/:tool
  A2A->>A2A: Resolve host context and load session
  A2A->>A2A: Decrypt delegation package
  A2A->>MCP: POST /tools/:tool with delegation token
  MCP->>MCP: Verify request authority
  MCP->>Store: Read or write domain state
  Store-->>MCP: Result
  MCP-->>A2A: Tool response
  A2A-->>Web: JSON response
  Web-->>User: UI update
```

## Web Side

Key files:

- `apps/web/src/lib/clients/mcp-client.ts`
- `apps/web/src/lib/clients/a2a-fetch.ts`
- `apps/web/src/lib/clients/a2a-url-resolver.ts`
- `apps/web/src/lib/clients/hub-client.ts`
- `apps/web/src/lib/actions/a2a-session.action.ts`

`callMcp` is the main application helper for user-authorized MCP calls.

```mermaid
flowchart TD
  serverAction["Server action or API route"]
  callMcp["callMcp(server, tool, args)"]
  sessionToken["getA2ASessionToken"]
  urlResolver["A2A URL resolver"]
  a2aFetch["a2aFetch"]
  a2a["A2A /mcp/:server/:tool"]

  serverAction --> callMcp
  callMcp --> sessionToken
  callMcp --> urlResolver
  callMcp --> a2aFetch
  a2aFetch --> a2a
```

## Agent-Scoped Host Routing

The web app can construct agent-scoped A2A hosts such as:

- `rich-pedersen.agent.localhost:3100`
- `system.agent.localhost:3100`

The local fetch layer resolves wildcard hostnames to loopback while preserving the `Host` header for the A2A service.

```mermaid
flowchart LR
  web["apps/web"]
  resolver["a2a-url-resolver"]
  fetch["a2a-fetch, loopback dispatcher"]
  a2aHost["A2A Host header, slug.agent.localhost"]
  hostContext["host-context middleware"]
  route["/mcp/:server/:tool"]

  web --> resolver --> fetch --> a2aHost --> hostContext --> route
```

## A2A Side

Key files:

- `apps/a2a-agent/src/index.ts`
- `apps/a2a-agent/src/routes/mcp-proxy.ts`
- `apps/a2a-agent/src/routes/session.ts`
- `apps/a2a-agent/src/routes/auth.ts`
- `apps/a2a-agent/src/routes/delegation.ts`
- `apps/a2a-agent/src/routes/onchain-redeem.ts`
- `apps/a2a-agent/src/middleware/host-context.ts`
- `apps/a2a-agent/src/db/schema.ts`

The A2A agent is the session broker and MCP proxy. It stores encrypted session packages, mints or forwards delegation material, and routes to the correct MCP.

```mermaid
flowchart TD
  incoming["Incoming A2A request"]
  host["host-context middleware"]
  session["Load encrypted session"]
  decrypt["Decrypt delegation package"]
  policy["Apply tool policy"]
  token["Mint delegation JWT"]
  proxy["Proxy to MCP"]
  audit["execution_audit"]

  incoming --> host --> session --> decrypt --> policy --> token --> proxy
  proxy --> audit
```

## MCP Target Map

| `callMcp` server | Target service | Typical responsibility |
| --- | --- | --- |
| `person` | `apps/person-mcp` | Private person data, credentials, wallet actions |
| `org` | `apps/org-mcp` | Org data, rounds, proposals, pledges |
| `people-group` | `apps/people-group-mcp` | Group membership and people group tools |
| `hub` | `apps/hub-mcp` | System discovery and GraphDB sync |

## Hub-MCP Exception

Hub MCP tools are often system-level reads or sync tools and may not require a user session in the same way person/org tools do.

```mermaid
sequenceDiagram
  participant Web as apps/web
  participant A2A as apps/a2a-agent
  participant Hub as hub-mcp
  participant Graph as GraphDB

  Web->>A2A: POST system host /mcp/hub/discovery:search
  A2A->>Hub: Proxy hub tool
  Hub->>Graph: SPARQL read
  Graph-->>Hub: Result set
  Hub-->>A2A: Tool response
  A2A-->>Web: Discovery result
```

## Known Direct Bypasses

Some flows still bypass A2A and should be treated as migration candidates unless they are explicitly system-level:

- Direct GraphDB and discovery reads from web code.
- Direct person-mcp session-store calls in `apps/web/src/lib/auth/person-mcp-session-client.ts`.
- Direct wallet-action dispatch calls in `apps/web/src/lib/wallet-action/dispatch.ts`.
- Direct chain writes and reads through `apps/web/src/lib/contracts.ts`.
- Readiness and boot scripts that intentionally call service health endpoints.

## Development Guidance

For new user-initiated person or organization work:

1. Add or reuse an MCP tool in the domain service.
2. Call it through `callMcp` from the web server action.
3. Let A2A handle session, host context, and delegation.
4. Keep direct web-to-service calls for bootstrapping, health checks, or explicit system-level exceptions only.
