# Production Boundary Change Analysis And Plan

This document turns the [Production Threat Model](./11-production-threat-model.md) into an implementation plan that can be defended in an architecture review.

The design position is:

> Smart Agent should keep the web app as the user experience edge, A2A as the session and delegation broker, MCPs as private domain services, GraphDB as a public projection, and chain as the source of public authority. Production hardening should make those boundaries enforceable, observable, and testable.

## Executive Summary

The architecture is directionally strong because it separates concerns cleanly:

- The browser never talks directly to private MCP stores.
- The web app should not become a shadow domain backend.
- A2A centralizes session package handling, host routing, delegation token minting, and MCP proxy behavior.
- MCPs own private domain state and verify tool authority.
- Chain owns canonical public authority.
- GraphDB is a query projection, not a decision source.

The main review risk is not the conceptual model. The risk is incomplete production enforcement:

- Some bootstrap passthroughs are intentionally unauthenticated at the A2A edge today.
- Service-to-service authentication is only partially present.
- Open SSI endpoints need explicit classification and rate limits.
- Hub/GraphDB read and write surfaces need stronger separation.
- Dev-only routes need production gates.
- Audit, replay, key rotation, and fail-closed caveat rules need to be made uniform.

## Review-Defensible Target Architecture

```mermaid
flowchart TB
  browser["Browser"]
  webEdge["Public Web Edge"]
  web["apps/web"]
  a2aEdge["A2A Edge, limited public routes"]
  a2a["apps/a2a-agent"]
  serviceAuth["Service Auth Layer"]
  mcps["Private MCP Services"]
  graph["Private GraphDB"]
  chain["EVM RPC or Provider"]
  stores["MCP SQLite and Askar Stores"]

  browser --> webEdge --> web
  browser --> a2aEdge
  web --> a2a
  a2a --> serviceAuth --> mcps
  mcps --> stores
  mcps --> graph
  mcps --> chain
  a2a --> chain

  a2aEdge --> a2a
```

Production stance:

- Public: web UI, auth start/finish, explicitly public A2A metadata, explicitly public SSI issuer/verifier protocol endpoints.
- Private: MCP tool plane, GraphDB, direct service health/admin/debug, session-store, wallet-action passthroughs, hub sync.
- Service-auth-only: A2A-to-MCP calls, MCP-to-A2A redeem calls, hub sync/admin, audit writes, session-store/wallet-action internal paths.
- Dev-only: boot seed, fresh-start, local Anvil, debug turtle, broad health inspection.

## Area 1: Public Web Edge

### Current State

The web app is the user-facing entry point. It owns UI routes, web auth, server actions, and bootstrap flows. Some direct service calls remain allowed for readiness, boot seed, demo seed, and open SSI protocol endpoints.

### Problem To Solve

Seasoned reviewers will ask whether the web app can bypass A2A and call private domain services directly. The answer must be enforceable, not just documented.

### Target Decision

The web app is a policy-neutral UX edge for user workflows. It may authenticate the human and collect signatures, but user-authorized domain actions should go through A2A and MCPs.

### Required Changes

| Priority | Change |
| --- | --- |
| P0 | Keep `pnpm check:bypass` in CI and fail PRs that add direct MCP URLs outside the allowlist. |
| P0 | Add production environment guards to `/api/boot-seed`, demo seed routes, and ontology/debug routes. |
| P1 | Add route classification comments to web API routes: public, web-auth, operator-only, dev-only. |
| P1 | Add rate limits to public auth and open protocol proxy paths. |
| P2 | Generate route inventory docs from app route files. |

### Defense Rationale

This matches common zero-trust and API gateway practice: the browser-facing service is not trusted with every downstream permission by default. It becomes a user interaction edge, while A2A and MCP layers preserve authority boundaries.

## Area 2: A2A Ingress And Wildcard Host Routing

### Current State

A2A supports host-context routing for agent-scoped hosts and routes MCP calls through `/mcp/:server/:tool`. Host context is used as routing context, not as sole identity proof. Some system routes are exempt from host binding.

### Problem To Solve

If wildcard A2A domains become public, reviewers will ask whether host header spoofing or cross-agent replay can grant authority.

### Target Decision

Hostnames identify routing context only. They do not prove authority. Authority must come from web session, A2A session, WalletAction signature, MCP delegation token, service identity, or on-chain validation.

### Required Changes

| Priority | Change |
| --- | --- |
| P0 | Document and enforce allowed public A2A route list. |
| P0 | Add rate limits and request-size limits at the A2A edge. |
| P0 | Keep `/mcp/:server/:tool` behind bearer/session validation. |
| P1 | Add structured logs for host mismatch, cross-agent calls, and denied routes. |
| P1 | Add tests proving host spoofing alone cannot authorize MCP tools. |
| P2 | Add per-agent domain ownership validation if external custom domains are supported. |

### Defense Rationale

This is defensible because it treats DNS and host headers as routing labels, not security claims. That is aligned with hardened multi-tenant gateway practice.

## Area 3: A2A Session-Store Bootstrap

### Current State

`/session-store/*` is an A2A passthrough to person-mcp. It exists because some calls happen before a normal A2A session exists. The current route comments say it is unauthenticated at the A2A edge and relies on cookie or SessionGrant semantics downstream.

### Problem To Solve

This is one of the hardest areas to defend. A bootstrap path cannot require the very session it creates, but an unauthenticated network route is risky if it is publicly reachable.

### Target Decision

Keep a bootstrap path, but make it private and service-authenticated. Split bootstrap operations from post-session operations.

### Required Changes

| Priority | Change |
| --- | --- |
| P0 | Put `/session-store/*` behind private network policy. |
| P0 | Add service-auth from A2A to person-mcp for all forwarded session-store calls. |
| P0 | Restrict public A2A ingress so `/session-store/*` is not internet reachable. |
| P1 | Move post-session operations (`active`, `revoke`, `bump-epoch`) to MCP tools or service-auth-only routes. |
| P1 | Add replay/nonce checks to insert and bump-epoch operations. |
| P2 | Collapse bootstrap surface to the minimum required endpoints after passkey/session flow stabilizes. |

### Defense Rationale

The defensible argument is that bootstrap is a special-purpose internal control plane, not part of the public data plane. Mature systems usually isolate bootstrap/session issuance routes more tightly than normal application APIs.

## Area 4: WalletAction Dispatch

### Current State

`/wallet-action/dispatch` is proxied through A2A to person-mcp. The route currently relies on WalletAction signatures as the cryptographic authority.

### Problem To Solve

Reviewers will ask why the A2A edge accepts unauthenticated dispatch requests if person-mcp verifies the signature anyway.

### Target Decision

WalletAction signature remains the action authority, but network and service-auth controls are still required. Signature verification and service identity solve different problems.

### Required Changes

| Priority | Change |
| --- | --- |
| P0 | Make A2A `/wallet-action/*` non-public or service-auth-only. |
| P0 | Add replay protection: action id, nonce, expiry, and one-time use. |
| P0 | Ensure WalletAction verification binds action type, audience, session id, and origin service. |
| P1 | Add audit rows for accepted and denied WalletAction dispatch. |
| P1 | Add negative tests for replay, wrong audience, expired action, and wrong signer. |

### Defense Rationale

This follows defense in depth. The signed action proves user/session authority; service-auth and network isolation prevent untrusted callers from using person-mcp as a public signature oracle or DoS target.

## Area 5: MCP Tool Plane

### Current State

Person, org, people-group, and hub MCPs expose `/tools/:toolName`. A2A mints MCP delegation tokens for person/org tools. Some tools perform their own principal checks. Hub-mcp is treated as system-level.

### Problem To Solve

The question is whether MCP tools trust the gateway too much, and whether tool scopes are complete.

### Target Decision

MCPs should verify every privileged tool request independently. A2A is a broker, not a blanket trusted caller.

### Required Changes

| Priority | Change |
| --- | --- |
| P0 | Require service-auth on A2A-to-MCP `/tools` calls. |
| P0 | Require MCP token audience, expiry, JTI, session id, and tool scope checks for user-context tools. |
| P0 | Make unsupported caveats fail closed. |
| P1 | Add a shared MCP auth middleware package instead of repeated ad hoc checks. |
| P1 | Add per-tool risk tier and execution path to tool metadata. |
| P1 | Add denial audit for wrong audience, missing scope, expired token, wrong principal, unsupported caveat. |
| P2 | Add route-level generated documentation from tool policy metadata. |

### Defense Rationale

This is the same split used in mature systems: the gateway authenticates and routes, while the domain service authorizes against its own resource model.

## Area 6: Service-To-Service Authentication

### Current State

Some inter-service calls use HMAC, especially MCP-to-A2A on-chain redeem. Other internal calls still rely on locality or downstream cryptographic verification.

### Problem To Solve

Network locality is not a security model. Reviewers will expect every private service route to require a service identity.

### Target Decision

Use one standard service-auth envelope for internal HTTP. Prefer mTLS or signed service JWTs in production; keep HMAC as an acceptable near-term local/staging mechanism if rotation exists.

### Required Changes

| Priority | Change |
| --- | --- |
| P0 | Define `X-SA-Service`, `X-SA-Timestamp`, `X-SA-Nonce`, `X-SA-Signature` or equivalent JWT/mTLS standard. |
| P0 | Apply service-auth to A2A-to-MCP `/tools`, session-store, wallet-action, hub sync, audit, and MCP-to-A2A redeem. |
| P0 | Add nonce window and replay cache. |
| P1 | Add key ids and rotation support. |
| P1 | Add service allowlists by route family. |
| P2 | Move to mTLS/service mesh identity when deployment platform supports it. |

### Defense Rationale

This addresses the classic “flat internal network” critique. Even if a port is accidentally reachable, the route still requires a verifiable service principal.

## Area 7: Hub-MCP And GraphDB

### Current State

Hub-mcp owns discovery reads and GraphDB sync tools. GraphDB is a projection and should not be directly reached by web users. Hub-mcp has admin/debug paths useful in development.

### Problem To Solve

GraphDB corruption or stale public projection can create false discovery data even if chain remains canonical.

### Target Decision

Hub-mcp is the only GraphDB access path. Discovery reads are separate from sync writes. Sync/admin/debug are service-auth-only or dev-only.

### Required Changes

| Priority | Change |
| --- | --- |
| P0 | Service-auth gate `sync:*`, `/admin/*`, and `/debug/*`. |
| P0 | Disable debug turtle output in production unless operator-authenticated. |
| P1 | Split discovery and sync route groups in code. |
| P1 | Add sync audit: source block/tx, subject, predicate family, actor service. |
| P1 | Add cache invalidation tests for write-after-read consistency. |
| P2 | Consider separate read-only hub and write-only sync worker if traffic or risk grows. |

### Defense Rationale

This preserves the projection model: GraphDB can speed reads but cannot become hidden authority. Write paths are tightly limited and auditable.

## Area 8: SSI Issuer And Verifier Endpoints

### Current State

Org, family, geo, skill, and verifier MCPs expose credential and proof protocol routes. Some are intentionally open protocol endpoints.

### Problem To Solve

Reviewers will ask why any MCP is public if MCPs are supposed to be private.

### Target Decision

Separate open SSI protocol endpoints from private MCP tool endpoints. The same process can host both in local/dev, but production ingress must classify them separately.

### Required Changes

| Priority | Change |
| --- | --- |
| P0 | Inventory every `/credential/*`, `/verify/*`, and `/.well-known/*` endpoint. |
| P0 | Add rate limits and request-size limits to open protocol endpoints. |
| P0 | Ensure open protocol endpoints do not expose `/tools` or private stores. |
| P1 | Add issuer/verifier abuse controls: challenge expiry, replay checks, issuer policy. |
| P1 | Consider separate public protocol gateway from private MCP process. |
| P2 | Add conformance tests for OID4VCI/OID4VP route behavior. |

### Defense Rationale

Public credential protocols are normal. What must be defended is the separation between public protocol traffic and private domain tooling.

## Area 9: Chain RPC And On-Chain Redeem

### Current State

A2A has on-chain redeem endpoints guarded by inter-service HMAC. These enforce tool policy, allowed targets, and allowed selectors before redeeming delegation transactions.

### Problem To Solve

Reviewers will focus on whether a compromised MCP can ask A2A to run arbitrary transactions.

### Target Decision

MCP-to-A2A redeem is a narrow execution boundary: every request must match tool policy, target allowlist, selector allowlist, session state, and delegation caveats.

### Required Changes

| Priority | Change |
| --- | --- |
| P0 | Complete the fail-closed caveat matrix for every execution path. |
| P0 | Add tests for disallowed target, selector, value, expired session, wrong tool, wrong service. |
| P0 | Ensure chain RPC write keys are scoped and not available in browser or public web env. |
| P1 | Add per-tool maximum value and target binding in policy metadata. |
| P1 | Add on-chain receipt correlation to audit rows. |
| P2 | Add simulation before submission for high-risk money-moving calls. |

### Defense Rationale

This follows smart-account session-key best practice: session authority is bounded by target, selector, value, time, and explicit policy.

## Area 10: A2A Session Package And Key Custody

### Current State

A2A stores encrypted session packages and uses `A2A_SESSION_SECRET` for decryption. The package can include session private key material and delegation data.

### Problem To Solve

This is the highest-value compromise target. If the A2A DB and encryption secret leak together, active sessions are at risk.

### Target Decision

Treat A2A session packages as sensitive key custody material. Use envelope encryption, AAD binding, short TTLs, rotation, and emergency revocation.

### Required Changes

| Priority | Change |
| --- | --- |
| P0 | Bind encryption AAD to session id, account address, chain id, audience, and expiry. |
| P0 | Define max session TTL by risk tier. |
| P0 | Add emergency revoke-all-by-account and revoke-all-by-key-version. |
| P1 | Add key versioning and rotation for `A2A_SESSION_SECRET`. |
| P1 | Move production encryption key to KMS or secret manager. |
| P1 | Avoid logging decrypted package fields. |
| P2 | Consider splitting signing into an isolated signer service or HSM-backed key path. |

### Defense Rationale

The answer to “why trust A2A?” is that A2A is a constrained custodian with bounded session authority, short-lived packages, audited use, and revocation.

## Area 11: Audit, Evidence, And Incident Response

### Current State

A2A has execution audit entries for redeem paths. Other paths have uneven audit coverage.

### Problem To Solve

Architects will ask how to prove what happened after an incident.

### Target Decision

All authority-bearing actions emit a common audit event with correlation ids across web, A2A, MCP, GraphDB sync, and chain receipts.

### Required Changes

| Priority | Change |
| --- | --- |
| P0 | Define unified audit schema: actor, subject, service, route, tool, session id, delegation hash, mcp call id, decision, reason, tx hash. |
| P0 | Audit denials as well as successes. |
| P1 | Add correlation ids from web action to A2A to MCP to chain. |
| P1 | Make audit append-only at the application level. |
| P1 | Define retention and export path. |
| P2 | Add security dashboards for denial spikes and replay attempts. |

### Defense Rationale

This makes the delegation system explainable. It also gives operators evidence for user support, compliance, and security investigations.

## Area 12: Local And Dev Exceptions

### Current State

Local development depends on fresh-start, seed routes, readiness probes, local Anvil, and direct service health checks.

### Problem To Solve

Reviewers will reject “it is only local” unless production cannot accidentally expose those paths.

### Target Decision

Local/dev exceptions are allowed, but every exception must have a production gate and an explicit reason.

### Required Changes

| Priority | Change |
| --- | --- |
| P0 | Add `NODE_ENV` or `SMART_AGENT_ENV` guards to seed/debug routes. |
| P0 | Bind local-only services to localhost in dev scripts. |
| P0 | Add CI check that production env cannot enable demo key paths. |
| P1 | Add docs table mapping each exception to its guard. |
| P1 | Add tests for disabled production seed/debug routes. |

### Defense Rationale

This preserves developer speed while making production behavior explicit and auditable.

## Area 13: Guardrails And Tests

### Current State

`check-no-bypass.sh` prevents direct web-to-MCP URL usage outside documented allowlist. More guardrails are needed for route exposure, service auth, and policy coverage.

### Problem To Solve

Manual review will not scale. Architecture invariants need automated enforcement.

### Target Decision

Every critical boundary gets a guardrail: lint, static check, integration test, or generated route inventory.

### Required Changes

| Priority | Change |
| --- | --- |
| P0 | Keep bypass check in CI. |
| P0 | Add test that private MCP ports are not configured as public ingress in deployment manifests. |
| P1 | Add route classification metadata or comments and check coverage. |
| P1 | Add service-auth integration tests for all internal route families. |
| P1 | Add tool policy coverage tests: every high-risk tool has target, selector, value, and caveat policy. |
| P2 | Generate architecture route matrices from code. |

### Defense Rationale

Defensible architectures are not just diagrams. They have tests that prevent drift.

## Implementation Roadmap

### Phase 1A: Close Public Exposure Risks

- Gate dev-only web routes in production.
- Ensure MCP, GraphDB, local Anvil, and debug/admin ports are private.
- Add A2A allowed public route list.
- Add route comments for critical web and A2A endpoints.

### Phase 1B: Standardize Service Auth

- Pick HMAC-with-rotation, service JWT, mTLS, or service mesh identity.
- Apply it to A2A-to-MCP `/tools`.
- Apply it to session-store and wallet-action passthroughs.
- Apply it to hub sync/admin/debug and MCP-to-A2A redeem.

### Phase 1C: Harden Delegated Execution

- Finish fail-closed caveat matrix.
- Add tool policy tests for target/selector/value/session failure cases.
- Add replay cache for MCP tokens and WalletAction.
- Add short TTL defaults by risk tier.

### Phase 1D: Make It Auditable

- Define unified audit schema.
- Thread correlation ids across web, A2A, MCP, and chain.
- Audit denial and success events.
- Add incident queries and retention guidance.

### Phase 1E: Prove The Boundary

- Add CI guardrails for direct bypasses, route classification, and production dev-route gates.
- Add integration tests for public/private route expectations.
- Generate route and port inventory from code or manifests.

## Architecture Review Questions And Answers

| Veteran architect question | Defensible answer |
| --- | --- |
| Why not let web call MCPs directly? | Because web is the UX edge; A2A centralizes session/delegation policy, MCPs own domain authorization, and the path is auditable. |
| Is A2A a single point of failure? | It is a control-plane choke point by design. We bound its authority with short-lived sessions, caveats, audit, service-auth, and revocation. |
| Is host routing security? | No. Host routing selects context. Authority comes from session grants, delegation tokens, WalletAction signatures, service identity, and chain checks. |
| Why are some MCP endpoints public? | Only open SSI issuer/verifier protocol endpoints are public. Private MCP `/tools` and stores remain internal. |
| What if MCP is compromised? | MCP cannot ask A2A to execute arbitrary chain calls; redeem is constrained by service-auth, tool policy, target/selector allowlists, session status, and caveats. |
| What if A2A DB leaks? | Session package encryption, AAD binding, short TTL, key rotation, and emergency revocation reduce blast radius. |
| What prevents architecture drift? | CI bypass checks, route classification checks, service-auth tests, tool-policy coverage tests, and generated route/port inventory. |
| Can GraphDB become authority? | No. It is a projection. Writes go through hub sync, reads are public/discovery only, and chain/MCP stores remain source of truth. |

## Open Decisions To Resolve

| Decision | Recommendation |
| --- | --- |
| Public A2A wildcard domains | Allow public metadata and auth bootstrap only; keep data plane authenticated and rate-limited. |
| Service-auth mechanism | Use signed service JWT or mTLS for production; HMAC with nonce/key-id for local/staging. |
| Hub read/write split | Start with route-level auth; split into read and sync services if production blast radius or scale demands it. |
| Session-store shape | Keep bootstrap passthrough private; move post-session operations to MCP tools or service-auth-only routes. |
| Public SSI endpoints | Keep issuer/verifier protocol endpoints public only when product requires it; never expose `/tools`. |
| Audit storage | Start append-only DB table with export; later move to immutable log storage if compliance requires it. |

## Success Criteria

The architecture is defensible when:

- a reviewer can identify the authority mechanism for every route,
- public, private, service-auth, and dev-only surfaces are enforced in code and deployment,
- every user-authorized domain action goes through A2A/MCP unless explicitly exempted,
- MCPs verify authority independently of A2A routing,
- session material has bounded lifetime and revocation,
- GraphDB cannot mutate without controlled sync authority,
- tests fail when a new bypass or unclassified privileged route appears.
