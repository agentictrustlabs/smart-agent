# Production Boundary Change Analysis And Plan

> Source document for the production hardening initiative. Multi-agent review of this drives the Smart Agent v1 → v1.1 hardening plan.

This document turns the Production Threat Model into an implementation plan that can be defended in an architecture review.

The design position is: Smart Agent should keep the web app as the user experience edge, A2A as the session and delegation broker, MCPs as private domain services, GraphDB as a public projection, and chain as the source of public authority. Production hardening should make those boundaries enforceable, observable, and testable.

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

```
browser → public web edge → apps/web
browser → A2A edge (limited public routes) → apps/a2a-agent
apps/web → apps/a2a-agent
apps/a2a-agent → service-auth layer → private MCP services
private MCP services → MCP SQLite + Askar stores
private MCP services → private GraphDB
private MCP services → EVM RPC
apps/a2a-agent → EVM RPC
```

Production stance:
- **Public**: web UI, auth start/finish, explicitly public A2A metadata, explicitly public SSI issuer/verifier protocol endpoints.
- **Private**: MCP tool plane, GraphDB, direct service health/admin/debug, session-store, wallet-action passthroughs, hub sync.
- **Service-auth-only**: A2A-to-MCP calls, MCP-to-A2A redeem calls, hub sync/admin, audit writes, session-store/wallet-action internal paths.
- **Dev-only**: boot seed, fresh-start, local Anvil, debug turtle, broad health inspection.

## Area 1: Public Web Edge

**Current State**: The web app is the user-facing entry point. It owns UI routes, web auth, server actions, and bootstrap flows. Some direct service calls remain allowed for readiness, boot seed, demo seed, and open SSI protocol endpoints.

**Problem**: Reviewers will ask whether the web app can bypass A2A and call private domain services directly. The answer must be enforceable, not just documented.

**Target Decision**: The web app is a policy-neutral UX edge. It may authenticate the human and collect signatures, but user-authorized domain actions should go through A2A and MCPs.

**Required Changes**:
- P0: Keep `pnpm check:bypass` in CI; fail PRs that add direct MCP URLs outside the allowlist.
- P0: Add production environment guards to `/api/boot-seed`, demo seed routes, ontology/debug routes.
- P1: Add route classification comments to web API routes: public, web-auth, operator-only, dev-only.
- P1: Add rate limits to public auth and open protocol proxy paths.
- P2: Generate route inventory docs from app route files.

## Area 2: A2A Ingress And Wildcard Host Routing

**Current State**: A2A supports host-context routing for agent-scoped hosts and routes MCP calls through `/mcp/:server/:tool`. Host context is used as routing context, not as sole identity proof. Some system routes are exempt from host binding.

**Problem**: If wildcard A2A domains become public, reviewers will ask whether host header spoofing or cross-agent replay can grant authority.

**Target Decision**: Hostnames identify routing context only. They do not prove authority. Authority must come from web session, A2A session, WalletAction signature, MCP delegation token, service identity, or on-chain validation.

**Required Changes**:
- P0: Document and enforce allowed public A2A route list.
- P0: Add rate limits and request-size limits at the A2A edge.
- P0: Keep `/mcp/:server/:tool` behind bearer/session validation.
- P1: Structured logs for host mismatch, cross-agent calls, and denied routes.
- P1: Tests proving host spoofing alone cannot authorize MCP tools.
- P2: Per-agent domain ownership validation if external custom domains are supported.

## Area 3: A2A Session-Store Bootstrap

**Current State**: `/session-store/*` is an A2A passthrough to person-mcp. Exists because some calls happen before a normal A2A session exists. Currently unauthenticated at the A2A edge; relies on cookie or SessionGrant semantics downstream.

**Problem**: This is one of the hardest areas to defend. A bootstrap path cannot require the very session it creates, but an unauthenticated network route is risky if it is publicly reachable.

**Target Decision**: Keep a bootstrap path, but make it private and service-authenticated. Split bootstrap operations from post-session operations.

**Required Changes**:
- P0: Put `/session-store/*` behind private network policy.
- P0: Service-auth from A2A to person-mcp for all forwarded session-store calls.
- P0: Restrict public A2A ingress so `/session-store/*` is not internet reachable.
- P1: Move post-session operations (active, revoke, bump-epoch) to MCP tools or service-auth-only routes.
- P1: Replay/nonce checks to insert and bump-epoch operations.
- P2: Collapse bootstrap surface to the minimum required endpoints after passkey/session flow stabilizes.

## Area 4: WalletAction Dispatch

**Current State**: `/wallet-action/dispatch` is proxied through A2A to person-mcp. Currently relies on WalletAction signatures as the cryptographic authority.

**Problem**: Reviewers will ask why the A2A edge accepts unauthenticated dispatch requests if person-mcp verifies the signature anyway.

**Target Decision**: WalletAction signature remains the action authority, but network and service-auth controls are still required. Signature verification and service identity solve different problems.

**Required Changes**:
- P0: Make A2A `/wallet-action/*` non-public or service-auth-only.
- P0: Replay protection: action id, nonce, expiry, one-time use.
- P0: WalletAction verification binds action type, audience, session id, origin service.
- P1: Audit rows for accepted and denied WalletAction dispatch.
- P1: Negative tests for replay, wrong audience, expired action, wrong signer.

## Area 5: MCP Tool Plane

**Current State**: Person, org, people-group, and hub MCPs expose `/tools/:toolName`. A2A mints MCP delegation tokens for person/org tools. Some tools perform their own principal checks. Hub-mcp is treated as system-level.

**Problem**: Do MCP tools trust the gateway too much? Are tool scopes complete?

**Target Decision**: MCPs verify every privileged tool request independently. A2A is a broker, not a blanket trusted caller.

**Required Changes**:
- P0: Service-auth on A2A-to-MCP `/tools` calls.
- P0: MCP token audience, expiry, JTI, session id, and tool scope checks for user-context tools.
- P0: Unsupported caveats fail closed.
- P1: Shared MCP auth middleware package instead of repeated ad hoc checks.
- P1: Per-tool risk tier and execution path in tool metadata.
- P1: Denial audit for wrong audience, missing scope, expired token, wrong principal, unsupported caveat.
- P2: Route-level generated documentation from tool policy metadata.

## Area 6: Service-To-Service Authentication

**Current State**: Some inter-service calls use HMAC, especially MCP-to-A2A on-chain redeem. Other internal calls still rely on locality or downstream cryptographic verification.

**Problem**: Network locality is not a security model.

**Target Decision**: One standard service-auth envelope for internal HTTP. Prefer mTLS or signed service JWTs in production; HMAC acceptable near-term for local/staging with rotation.

**Required Changes**:
- P0: Define `X-SA-Service`, `X-SA-Timestamp`, `X-SA-Nonce`, `X-SA-Signature` (or equivalent JWT/mTLS standard).
- P0: Apply service-auth to A2A-to-MCP `/tools`, session-store, wallet-action, hub sync, audit, MCP-to-A2A redeem.
- P0: Nonce window and replay cache.
- P1: Key ids and rotation support.
- P1: Service allowlists by route family.
- P2: Move to mTLS/service mesh identity when platform supports it.

## Area 7: Hub-MCP And GraphDB

**Current State**: Hub-mcp owns discovery reads and GraphDB sync tools. GraphDB is a projection. Hub-mcp has admin/debug paths useful in dev.

**Problem**: GraphDB corruption or stale projection can create false discovery data even if chain remains canonical.

**Target Decision**: Hub-mcp is the only GraphDB access path. Discovery reads separate from sync writes. Sync/admin/debug are service-auth-only or dev-only.

**Required Changes**:
- P0: Service-auth gate `sync:*`, `/admin/*`, `/debug/*`.
- P0: Disable debug turtle output in production unless operator-authenticated.
- P1: Split discovery and sync route groups in code.
- P1: Sync audit: source block/tx, subject, predicate family, actor service.
- P1: Cache invalidation tests for write-after-read consistency.
- P2: Separate read-only hub and write-only sync worker if traffic/risk grows.

## Area 8: SSI Issuer And Verifier Endpoints

**Current State**: Org, family, geo, skill, and verifier MCPs expose credential and proof protocol routes. Some are intentionally open protocol endpoints.

**Problem**: Reviewers will ask why any MCP is public if MCPs are supposed to be private.

**Target Decision**: Separate open SSI protocol endpoints from private MCP tool endpoints. Same process can host both in dev; production ingress must classify separately.

**Required Changes**:
- P0: Inventory every `/credential/*`, `/verify/*`, `/.well-known/*` endpoint.
- P0: Rate limits and request-size limits to open protocol endpoints.
- P0: Ensure open protocol endpoints do not expose `/tools` or private stores.
- P1: Issuer/verifier abuse controls: challenge expiry, replay checks, issuer policy.
- P1: Consider separate public protocol gateway from private MCP process.
- P2: Conformance tests for OID4VCI/OID4VP route behavior.

## Area 9: Chain RPC And On-Chain Redeem

**Current State**: A2A has on-chain redeem endpoints guarded by inter-service HMAC. These enforce tool policy, allowed targets, allowed selectors before redeeming delegation transactions.

**Problem**: Can a compromised MCP ask A2A to run arbitrary transactions?

**Target Decision**: MCP-to-A2A redeem is a narrow execution boundary: every request must match tool policy, target allowlist, selector allowlist, session state, and delegation caveats.

**Required Changes**:
- P0: Complete the fail-closed caveat matrix for every execution path.
- P0: Tests for disallowed target, selector, value, expired session, wrong tool, wrong service.
- P0: Chain RPC write keys scoped, not available in browser or public web env.
- P1: Per-tool maximum value and target binding in policy metadata.
- P1: On-chain receipt correlation to audit rows.
- P2: Simulation before submission for high-risk money-moving calls.

## Area 10: A2A Session Package And Key Custody

**Current State**: A2A stores encrypted session packages and uses `A2A_SESSION_SECRET` for decryption. Package can include session private key material and delegation data.

**Problem**: Highest-value compromise target. If A2A DB and encryption secret leak together, active sessions are at risk.

**Target Decision**: A2A session packages are sensitive key custody material. Use envelope encryption, AAD binding, short TTLs, rotation, emergency revocation.

**Required Changes**:
- P0: Bind encryption AAD to session id, account address, chain id, audience, expiry.
- P0: Define max session TTL by risk tier.
- P0: Emergency revoke-all-by-account and revoke-all-by-key-version.
- P1: Key versioning and rotation for `A2A_SESSION_SECRET`.
- P1: Move production encryption key to KMS or secret manager.
- P1: Avoid logging decrypted package fields.
- P2: Consider splitting signing into an isolated signer service or HSM-backed key path.

## Area 11: Audit, Evidence, And Incident Response

**Current State**: A2A has execution audit entries for redeem paths. Other paths have uneven audit coverage.

**Problem**: How to prove what happened after an incident?

**Target Decision**: All authority-bearing actions emit a common audit event with correlation ids across web, A2A, MCP, GraphDB sync, and chain receipts.

**Required Changes**:
- P0: Unified audit schema: actor, subject, service, route, tool, session id, delegation hash, mcp call id, decision, reason, tx hash.
- P0: Audit denials as well as successes.
- P1: Correlation ids from web action → A2A → MCP → chain.
- P1: Make audit append-only at the application level.
- P1: Retention and export path.
- P2: Security dashboards for denial spikes and replay attempts.

## Area 12: Local And Dev Exceptions

**Current State**: Local development depends on fresh-start, seed routes, readiness probes, local Anvil, direct service health checks.

**Problem**: Reviewers will reject "it is only local" unless production cannot accidentally expose those paths.

**Target Decision**: Local/dev exceptions allowed, but every exception must have a production gate and an explicit reason.

**Required Changes**:
- P0: NODE_ENV or SMART_AGENT_ENV guards to seed/debug routes.
- P0: Bind local-only services to localhost in dev scripts.
- P0: CI check that production env cannot enable demo key paths.
- P1: Docs table mapping each exception to its guard.
- P1: Tests for disabled production seed/debug routes.

## Area 13: Guardrails And Tests

**Current State**: `check-no-bypass.sh` prevents direct web-to-MCP URL usage outside documented allowlist. More guardrails needed for route exposure, service auth, policy coverage.

**Problem**: Manual review will not scale.

**Target Decision**: Every critical boundary gets a guardrail: lint, static check, integration test, or generated route inventory.

**Required Changes**:
- P0: Keep bypass check in CI.
- P0: Test that private MCP ports are not configured as public ingress in deployment manifests.
- P1: Route classification metadata or comments and check coverage.
- P1: Service-auth integration tests for all internal route families.
- P1: Tool policy coverage tests: every high-risk tool has target, selector, value, caveat policy.
- P2: Generate architecture route matrices from code.

## Implementation Roadmap (from source document)

- **Phase 1A — Close Public Exposure Risks**: Gate dev-only web routes in production. Ensure MCP, GraphDB, local Anvil, debug/admin ports are private. A2A allowed public route list. Route comments for critical web and A2A endpoints.
- **Phase 1B — Standardize Service Auth**: Pick HMAC-with-rotation, service JWT, mTLS, or service mesh identity. Apply to A2A-to-MCP `/tools`, session-store and wallet-action passthroughs, hub sync/admin/debug, MCP-to-A2A redeem.
- **Phase 1C — Harden Delegated Execution**: Finish fail-closed caveat matrix. Tool policy tests for target/selector/value/session failure cases. Replay cache for MCP tokens and WalletAction. Short TTL defaults by risk tier.
- **Phase 1D — Make It Auditable**: Unified audit schema. Correlation ids across web/A2A/MCP/chain. Audit denial and success. Incident queries and retention.
- **Phase 1E — Prove The Boundary**: CI guardrails for direct bypasses, route classification, production dev-route gates. Integration tests for public/private route expectations. Route and port inventory from code or manifests.

## Architecture Review Questions And Answers

| Veteran architect question | Defensible answer |
|---|---|
| Why not let web call MCPs directly? | Because web is the UX edge; A2A centralizes session/delegation policy, MCPs own domain authorization, and the path is auditable. |
| Is A2A a single point of failure? | It is a control-plane choke point by design. We bound its authority with short-lived sessions, caveats, audit, service-auth, and revocation. |
| Is host routing security? | No. Host routing selects context. Authority comes from session grants, delegation tokens, WalletAction signatures, service identity, and chain checks. |
| Why are some MCP endpoints public? | Only open SSI issuer/verifier protocol endpoints are public. Private MCP `/tools` and stores remain internal. |
| What if MCP is compromised? | MCP cannot ask A2A to execute arbitrary chain calls; redeem is constrained by service-auth, tool policy, target/selector allowlists, session status, caveats. |
| What if A2A DB leaks? | Session package encryption, AAD binding, short TTL, key rotation, emergency revocation reduce blast radius. |
| What prevents architecture drift? | CI bypass checks, route classification checks, service-auth tests, tool-policy coverage tests, generated route/port inventory. |
| Can GraphDB become authority? | No. It is a projection. Writes go through hub sync, reads are public/discovery only, chain/MCP stores remain source of truth. |

## Open Decisions To Resolve

| Decision | Recommendation |
|---|---|
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

## Strategic Context

The user's stated motivation: prepare the architecture to host **full langchain capabilities inside the a2a-agent framework** (orchestration, knowledge management, etc.) — the agent should be free to take rich actions on the user's behalf, but **shielded from direct MCP resource management**. Every privilege the agent uses must flow through the bounded delegation/policy/audit mesh.
