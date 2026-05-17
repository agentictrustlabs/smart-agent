# Developer Current-State Inventory — Production Hardening (v1 → v1.1)

> Honest archaeology of what's actually shipped versus what the 13 hardening areas demand.
> Source-of-truth: `docs/architecture/production-hardening-source.md`.

Legend: ✅ Done · 🟡 Partial · ❌ Missing · 🤔 Unclear

## Reference: A2A authentication layers (what exists today)

The a2a-agent runs three independent auth planes which compose at the route level:

| Layer | File | Scope (mount sites) |
|---|---|---|
| `hostContext` (host-binding) | `apps/a2a-agent/src/middleware/host-context.ts:311` | Mounted globally at `apps/a2a-agent/src/index.ts:23`. Resolves `<slug>.agent.localhost` → on-chain agent principal. Exempts `/health`, `/.well-known/agent.json`, `/auth/{challenge,verify}`, `/session/init`, `/session/package`, `/session/:id/{redeem-*,deploy-agent}`, `/session-store/*`, `/wallet-action/*` (host-context.ts:83–112). |
| `requireSession` (user bearer) | `apps/a2a-agent/src/middleware/require-session.ts:41` | Applied per-route in `routes/mcp-proxy.ts:181`, `routes/profile.ts:198,208,221`, `routes/delegation.ts:34`, `routes/session.ts:415,440`. Tries SessionGrant.v1 lookup (person-mcp) first, falls back to legacy `sessions` table. |
| `requireGrantSession` (grant-only) | `apps/a2a-agent/src/middleware/require-grant.ts:43` | Defined but currently NOT wired into any route. Dead-loaded. |
| `requireInterServiceAuth` (HMAC) | `apps/a2a-agent/src/auth/inter-service.ts:62` | Applied in `routes/onchain-redeem.ts:242, 376, 534, 707, 1041` (the four `/session/:id/redeem-*` plus `/session/:id/deploy-agent`). Header set: `x-a2a-service`, `x-a2a-timestamp`, `x-a2a-signature`. Per-service envs in `A2A_INTERSERVICE_HMAC_KEY_<TAIL>`. |

The web `apps/web/src/middleware.ts` is **path-allowlist only** — it redirects unauthenticated browser GETs to `/sign-in`, but every `/api/*` route is treated as opaque "do your own auth" (web/middleware.ts:34). No rate-limit, no replay, no CSRF middleware.

## Reference: caveat enforcers (all 16 currently shipped)

`packages/contracts/src/enforcers/*.sol` — 16 enforcers + `CaveatEnforcerBase`:

| Enforcer | Purpose |
|---|---|
| `TimestampEnforcer` | validAfter / validUntil window |
| `ValueEnforcer` | max wei per call |
| `AllowedTargetsEnforcer` | restricts `target` address(es) |
| `AllowedMethodsEnforcer` | restricts 4-byte selectors |
| `CallDataHashEnforcer` | locks exact `keccak256(callData)` (sub-delegated path) |
| `TaskBindingEnforcer` | binds D_sub to an a2aTaskId hash |
| `RateLimitEnforcer` | calls-per-window per delegation |
| `QuorumEnforcer` | N-of-M Safe-style multisig over payload |
| `RecoveryEnforcer` | guardian-set recovery intent |
| `NameScopeEnforcer` | restrict by ATL name |
| `PoolMandateEnforcer` | mandate envelope around pool writes |
| `RoundDecisionWindowEnforcer` | bound round-state transitions to its decision window |
| `StewardEligibilityEnforcer` | steward set / quorum at pool level |
| `MembershipProofEnforcer` | proof-of-org-membership gate |
| `AllocationLimitEnforcer` | round/proposal max award cap |
| `DataScopeEnforcer` | OFF-CHAIN scope marker; `beforeHook` is a pure no-op (DataScopeEnforcer.sol:21) |
| `McpToolScopeEnforcer` | OFF-CHAIN scope marker; `beforeHook` is sanity-check only (McpToolScopeEnforcer.sol:25) |

The a2a-agent only knows how to *build* a small subset of these via `redeem-subdelegated`: `Timestamp + AllowedTargets + AllowedMethods + Value + CallDataHash + TaskBinding` (onchain-redeem.ts:800–807). The other ten enforcers exist in Solidity but no a2a-agent code emits them in caveat-builder paths.

---

## Area 1: Public Web Edge

### P0 #1: Keep `pnpm check:bypass` in CI; fail PRs that add direct MCP URLs outside allowlist
**Status**: 🟡 Partial
**Evidence**: `scripts/check-no-bypass.sh:1` exists and works. Forbids `PERSON_MCP_URL|ORG_MCP_URL|PEOPLE_GROUP_MCP_URL|HUB_MCP_URL|FAMILY_MCP_URL|GEO_MCP_URL|VERIFIER_MCP_URL|SKILL_MCP_URL|DiscoveryService\.fromEnv` outside `apps/web/src/` allowlist (system-readiness, boot-seed, lib/boot-seed.ts, lib/demo-seed/, lib/ssi/clients.ts, lib/ssi/config.ts).
**Gap**: I cannot confirm the script is wired into CI yet — `pnpm check:bypass` script name appears in the comment but the root `package.json` `scripts` should be checked. The script is not invoked from any GitHub Actions workflow that I located. Action: add to `.github/workflows/*` and `package.json` if missing.

### P0 #2: Production environment guards on `/api/boot-seed`, demo seed, ontology/debug routes
**Status**: ❌ Missing (boot-seed) / 🟡 Partial (only `/api/test/geo-trust-e2e` is gated)
**Evidence**: `apps/web/src/app/api/boot-seed/route.ts:1` — no `NODE_ENV` check; freely accepts GET/POST and triggers seed. `apps/web/src/app/api/dev-membership-check/route.ts:1` and `apps/web/src/app/api/dev-patch-hannah/route.ts:1` — no env guard, freely hit chain. `apps/web/src/app/api/test/geo-trust-e2e/route.ts:42` has `if (process.env.NODE_ENV === 'production') return 403`. `apps/web/src/app/api/ontology-sync/` likely needs gating too (not inspected).
**Gap**: Add `if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_DEV_ROUTES) return 403` to all four routes minimum. Suggest a shared `lib/dev-only.ts` guard helper.

### P1 #3: Route classification comments (public/web-auth/operator-only/dev-only)
**Status**: ❌ Missing
**Evidence**: No structured comment header convention exists anywhere in `apps/web/src/app/api/**`. Comments are ad-hoc.
**Gap**: Define a single comment pragma (`// @route-class: public-anon`, `// @route-class: web-session`, `// @route-class: dev-only`, etc.) and a script to assert every route has one — landing pad for the future route-inventory generator.

### P1 #4: Rate limits on public auth and open protocol proxy paths
**Status**: ❌ Missing
**Evidence**: `grep -ri "rateLimit\|rate-limit\|hono-rate-limiter"` finds no rate-limit middleware in any service. The only `rateLimit` hit is the SessionAgentAccount **on-chain hook policy** (`apps/a2a-agent/src/routes/session.ts:43,193`) — different concept; that's a per-session ERC-7579 hook, not an HTTP rate limit.
**Gap**: Drop `@hono/rate-limiter` (or in-memory token bucket) onto: `/auth/challenge`, `/auth/verify`, `/session/init`, `/session/package`, `/.well-known/openid-credential-issuer`, `/credential`, `/verify/*`, `/api/auth/passkey-signup`, `/api/demo-login`. Same per-IP bucket per route family.

### P2 #5: Generate route inventory docs from app route files
**Status**: ❌ Missing — no generator exists.

---

## Area 2: A2A Ingress And Wildcard Host Routing

### P0 #1: Document and enforce allowed public A2A route list
**Status**: 🟡 Partial
**Evidence**: `apps/a2a-agent/src/middleware/host-context.ts:83–112` codifies the exempt list (the inverse: anything else *requires* host context). The list is documented in code comments. But there's no separate "public-allowed-list" doc with security classification.
**Gap**: Externalize the list as `docs/architecture/a2a-public-routes.md` with rationale per entry. Add a CI assertion that any new exempt path in `host-context.ts` requires a matching doc entry.

### P0 #2: Rate limits and request-size limits at the A2A edge
**Status**: ❌ Missing
**Evidence**: `apps/a2a-agent/src/index.ts:17–28` mounts only `logger()` and `hostContext`. No `bodyLimit()`, no rate limiter.
**Gap**: Add `bodyLimit({ maxSize: 256 * 1024 })` and per-IP rate limiter at the top of the Hono chain.

### P0 #3: Keep `/mcp/:server/:tool` behind bearer/session validation
**Status**: ✅ Done
**Evidence**: `apps/a2a-agent/src/routes/mcp-proxy.ts:181` mounts `requireSession` on the `:server/:tool` route. Note the explicit exception at `mcp-proxy.ts:162` — `/mcp/hub/:tool` skips `requireSession` because hub-mcp is system-level. Documented at mcp-proxy.ts:150–161.

### P1 #4: Structured logs for host mismatch, cross-agent calls, denied routes
**Status**: 🟡 Partial
**Evidence**: `apps/a2a-agent/src/middleware/require-session.ts:104` console.logs cross-agent calls but does NOT hard-enforce (intentional — see comment block at require-session.ts:91–98). No structured log emitter, no metrics counter.
**Gap**: Replace `console.log` with a typed structured-log helper that emits a single audit row to a new `auth_audit` table or stdout JSON with `event=cross-agent-call` so a SIEM / Loki query can detect spikes.

### P1 #5: Tests proving host spoofing alone cannot authorize MCP tools
**Status**: 🤔 Unclear — needs test scan
**Evidence**: Not located. A focused test for "Host header arbitrary, no bearer → 401 on `/mcp/person/get_profile`" was not found.
**Gap**: Add an integration test in `apps/a2a-agent/test/` (or similar) exercising the matrix.

### P2 #6: Per-agent domain ownership validation for external custom domains
**Status**: ❌ Missing — out of scope today; the slug→address lookup only goes through `handles` table + on-chain reverse.

---

## Area 3: A2A Session-Store Bootstrap

### P0 #1: `/session-store/*` behind private network policy
**Status**: ❌ Missing
**Evidence**: `apps/a2a-agent/src/routes/session-store.ts:25–86` — all 6 routes (`/epoch/:account`, `/insert`, `/by-cookie/:cookieValue`, `/active/:account`, `/revoke`, `/bump-epoch`) are unauthenticated and host-exempt (host-context.ts:106). Designed-in: see session-store.ts:23–27.
**Gap**: This is OK for dev but in production these MUST be unreachable from the internet. Bind to internal interface, gate at the reverse proxy, or split bootstrap (`/epoch`, `/insert`, `/by-cookie`) from post-session (`/active`, `/revoke`, `/bump-epoch`).

### P0 #2: Service-auth from A2A to person-mcp for forwarded session-store calls
**Status**: ❌ Missing
**Evidence**: `apps/a2a-agent/src/routes/session-store.ts:39–49` `forwardJson` simply proxies `fetch(${PERSON_MCP_URL}${path})` with no `x-a2a-service` / signature headers. Person-mcp accepts the call because the route is unauthenticated.
**Gap**: Mirror the org-mcp/person-mcp inter-service HMAC client pattern (`apps/org-mcp/src/lib/a2a-client.ts:18` uses `hmacSign`) on the **A2A → person-mcp** direction too — currently the only mcp-bound HMAC traffic is **MCP → A2A**, not the reverse.

### P0 #3: Restrict public A2A ingress so `/session-store/*` is not internet-reachable
**Status**: ❌ Missing — no deployment-level enforcement (we don't have a production ingress manifest yet).

### P1 #4: Move post-session operations (`active`, `revoke`, `bump-epoch`) to MCP tools or service-auth-only routes
**Status**: 🟡 Partial
**Evidence**: MCP tool counterparts exist (`tool-policies.ts:417–422`: `ssi_session_active`, `ssi_session_revoke`, `ssi_session_bump_epoch`) but the unauthenticated `/session-store/*` passthrough still exists side-by-side.
**Gap**: Once the web app moves to `/mcp/person/ssi_session_*` for post-session ops, delete the `/session-store/{active,revoke,bump-epoch}` passthroughs.

### P1 #5: Replay / nonce checks on insert + bump-epoch
**Status**: ❌ Missing — person-mcp's `session-store/index.ts` has nonce table (`action_nonces_v2`) but session-store routes do not consume it.

### P2 #6: Collapse bootstrap surface
**Status**: ❌ Missing — premature; do after P0/P1 above lands.

---

## Area 4: WalletAction Dispatch

### P0 #1: A2A `/wallet-action/*` non-public or service-auth-only
**Status**: ❌ Missing
**Evidence**: `apps/a2a-agent/src/routes/wallet-action.ts:25` — single `POST /wallet-action/dispatch` route, no auth, host-exempt. Forwards raw to person-mcp. Person-mcp's own dispatch (`apps/person-mcp/src/auth/dispatch-routes.ts:1`) re-verifies the WalletAction signature, which is the cryptographic authority — but the network-level shield is absent.
**Gap**: Add `requireInterServiceAuth()` (or split: keep one bootstrap route for the SessionGrant-finalize flow that has no session yet, gate the rest).

### P0 #2: Replay protection: action id, nonce, expiry, one-time use
**Status**: 🤔 Unclear / 🟡 Partial
**Evidence**: Person-mcp has `action_nonces_v2` table (session-store/index.ts:13). Need to verify `verifyDelegatedWalletAction` actually checks-and-inserts a nonce; the import at dispatch-routes.ts:28 exists but I didn't trace the implementation.
**Gap**: Audit `apps/person-mcp/src/auth/verify-delegated-action.ts` for nonce behavior; if missing, wire it.

### P0 #3: WalletAction verification binds action type, audience, session id, origin service
**Status**: 🤔 Unclear — same audit as above.

### P1 #4: Audit rows for accepted and denied WalletAction dispatch
**Status**: 🟡 Partial — person-mcp has `audit_log` with prevEntryHash chain (session-store/index.ts:6); coverage of WalletAction events not verified.

### P1 #5: Negative tests for replay, wrong audience, expired action, wrong signer
**Status**: ❌ Missing.

---

## Area 5: MCP Tool Plane

### P0 #1: Service-auth on A2A-to-MCP `/tools` calls
**Status**: ❌ Missing
**Evidence**: `apps/a2a-agent/src/routes/mcp-proxy.ts:116` — `fetch(${server.url}/tools/${toolName}, {…})` sends only `Content-Type`. No `x-a2a-service` / signature. MCP `/tools/:toolName` handlers (`apps/person-mcp/src/index.ts:150`, `apps/org-mcp/src/index.ts:103`, `apps/hub-mcp/src/index.ts:86`) accept any unsigned request from the network.
**Gap**: Person-mcp & org-mcp already SIGN outbound to A2A (`hmacSign` in their `lib/a2a-client.ts`). The reverse — A2A signing inbound to MCPs — is not implemented. Add `hmacSign` to `mcp-proxy.ts:callMcpTool` and a shared `requireA2aHmac` middleware on each MCP's `/tools/:toolName` handler.

### P0 #2: MCP token audience, expiry, JTI, session id, tool scope checks
**Status**: ✅ Done (for org-mcp + person-mcp)
**Evidence**: `apps/person-mcp/src/auth/verify-delegation.ts:1–40` walks the full 9-step chain (HMAC, ECDSA recovery, ERC-1271, revocation, timestamp caveat, MCP tool scope, JTI tracking, principal extraction). Org-mcp parallel at `apps/org-mcp/src/auth/verify-delegation.ts`. Audience + JTI usage tracking baked into `verifyDelegationToken` at `packages/sdk/src/delegation-token.ts:181`.
**Gap (minor)**: People-group-mcp / family-mcp / verifier-mcp / skill-mcp / geo-mcp not inspected — confirm they reuse the same `verifyDelegationToken` path.

### P0 #3: Unsupported caveats fail closed
**Status**: 🟡 Partial — depends on which caveat at which layer.
**Evidence**:
- **On-chain redeem path**: `apps/a2a-agent/src/routes/onchain-redeem.ts:255–303` rejects unknown tool, wrong execution path, unknown target, unknown selector — fails closed. ✅
- **DataScopeEnforcer / McpToolScopeEnforcer beforeHook**: deliberately no-ops on chain (DataScopeEnforcer.sol:21–35, McpToolScopeEnforcer.sol:25–55); enforcement is in MCP code. ✅ for the MCP tools that decode + check; ❌ for any MCP tool that doesn't.
- **MCP tool scope check**: `verify-delegation.ts:5 decodeMcpToolScopeTerms` is imported but I didn't verify it's called for every tool path.
- **AllocationLimit / Quorum / Membership / Recovery / NameScope / PoolMandate / StewardEligibility / RoundDecisionWindow / RateLimit**: enforcers ship in Solidity but **no a2a-agent caveat builder emits them** (see `redeem-subdelegated` caveat set at onchain-redeem.ts:800–807 — only 6 of the 16). If a user-side path emits them they'd be evaluated on chain. If a tool emitted an *unknown* enforcer address it'd revert at the DelegationManager `beforeHook` call — that IS fail-closed at chain level. But the a2a-agent's policy layer only inspects target+selector+value, NOT the broader caveat set.
**Gap**: Document the fail-closed matrix explicitly (which caveats checked where) and add a 1-page "caveat coverage" table. Add a registry of "enforcers we know about" so a redeem with an unknown enforcer address gets pre-flight rejected with a useful error.

### P1 #4: Shared MCP auth middleware package
**Status**: ❌ Missing — each MCP has its own `auth/verify-delegation.ts` that's mostly cut-and-paste from person-mcp.
**Gap**: Extract `packages/sdk/src/mcp-auth/` with `verifyDelegationAndExtractPrincipal` + `requirePrincipal`. The duplication is real maintenance debt.

### P1 #5: Per-tool risk tier and execution path in tool metadata
**Status**: ✅ Done
**Evidence**: `packages/sdk/src/policy/tool-policies.ts:40–74` — every policy has `riskTier`, `executionPath`, `allowedTargets`, `allowedSelectors`, `requiresTaskBinding`, `requiresCalldataHash`. 200+ tools enumerated.

### P1 #6: Denial audit for wrong audience, missing scope, expired token, wrong principal, unsupported caveat
**Status**: 🟡 Partial
**Evidence**: On-chain redeem denials go into `execution_audit` (status='denied'; see onchain-redeem.ts:272–283, 292–303, 743–754, 762–774). MCP-side denials (token expired, wrong audience, scope miss) do NOT write to any audit table — they just throw.
**Gap**: Mirror the `execution_audit` row pattern at the MCP boundary for denied tool calls.

### P2 #7: Route-level generated documentation from tool policy metadata
**Status**: ❌ Missing — would be a nice afternoon project (the policy is structured enough to template).

---

## Area 6: Service-To-Service Authentication

### P0 #1: Define `X-SA-Service`, `X-SA-Timestamp`, `X-SA-Nonce`, `X-SA-Signature`
**Status**: 🟡 Partial — header names exist with `x-a2a-*` prefix (not `X-SA-*`), and `Nonce` is implicit-in-timestamp rather than separate.
**Evidence**: `apps/a2a-agent/src/auth/inter-service.ts:30–32`: `x-a2a-service`, `x-a2a-timestamp`, `x-a2a-signature`. Canonical message at inter-service.ts:93: `bodyJson:timestamp:sessionId`. SDK client at `apps/org-mcp/src/lib/a2a-client.ts:18`, `apps/person-mcp/src/lib/a2a-client.ts:14`.
**Gap**: Add an explicit `x-a2a-nonce` for replay defense within the 60s window (today, two requests with identical body+timestamp would both pass).

### P0 #2: Apply service-auth to A2A↔MCP `/tools`, session-store, wallet-action, hub sync, audit, MCP→A2A redeem
**Status**: 🟡 Partial — only one direction covered
**Evidence**:
- ✅ MCP → A2A `/session/:id/redeem-*` and `/session/:id/deploy-agent` are HMAC-protected (onchain-redeem.ts:242, 376, 534, 707, 1041).
- ❌ A2A → MCP `/tools/:toolName` calls (mcp-proxy.ts:116, delegation.ts:87, profile.ts:200) — unsigned.
- ❌ A2A → MCP `/session-store/*` forwards (session-store.ts:39–49) — unsigned.
- ❌ A2A → MCP `/wallet-action/dispatch` forward (wallet-action.ts:27) — unsigned.
- ❌ Hub-mcp `/tools/:toolName` (hub-mcp/index.ts:86), `/admin/cache/clear` (hub-mcp/index.ts:108), `/debug/agents-turtle` (hub-mcp/index.ts:114) — no auth at all.
**Gap**: This is the single biggest checklist item. Implement once as a shared `packages/sdk/src/inter-service/` module exporting `requireServiceAuth(allowedServices: string[])` middleware + `signServiceRequest(body, sessionId?)` client helper. Mount on every internal route. Each MCP/A2A gets one HMAC secret per peer.

### P0 #3: Nonce window and replay cache
**Status**: 🟡 Partial — only timestamp-skew (60s) enforced.
**Evidence**: inter-service.ts:79–82 enforces `Math.abs(now - timestamp) > MAX_CLOCK_SKEW_SECONDS` but no nonce cache.
**Gap**: Add an in-memory LRU of seen `(service, timestamp, signature)` tuples cleared after the 60s window.

### P1 #4: Key ids and rotation support
**Status**: ❌ Missing
**Evidence**: `getInterServiceSecret(service)` returns a single env var per service; no key-id selector, no overlap window for rotation.
**Gap**: Support `A2A_INTERSERVICE_HMAC_KEY_ORG_v1` and `_v2` simultaneously with a `x-a2a-key-id` header.

### P1 #5: Service allowlists by route family
**Status**: ❌ Missing — today, every enrolled MCP service can hit every `/session/:id/redeem-*` path.

### P2 #6: Move to mTLS / service mesh
**Status**: ❌ Missing — appropriate for later phase.

---

## Area 7: Hub-MCP And GraphDB

### P0 #1: Service-auth gate on `sync:*`, `/admin/*`, `/debug/*`
**Status**: ❌ Missing
**Evidence**:
- `apps/hub-mcp/src/index.ts:86` `POST /tools/:toolName` — accepts any tool unauthenticated. `sync:*` tools live there.
- `apps/hub-mcp/src/index.ts:108` `POST /admin/cache/clear` — public.
- `apps/hub-mcp/src/index.ts:114` `GET /debug/agents-turtle` — public.
- A2A's `/mcp/hub/:tool` route bypasses `requireSession` (mcp-proxy.ts:162) so even via A2A there's no per-user gate.
**Gap**: Add `requireServiceAuth` on every `/tools`, `/admin`, `/debug` mount on hub-mcp. The "system-level" framing is correct but the implementation is "trust the network", which is insufficient.

### P0 #2: Disable debug turtle output in production unless operator-authenticated
**Status**: ❌ Missing — no `NODE_ENV` guard on `/debug/agents-turtle`.

### P1 #3: Split discovery and sync route groups in code
**Status**: 🟡 Partial — already split as `tools/discovery.ts` + `tools/sync.ts` (hub-mcp/src/index.ts:24–25) but both share the same `/tools/:toolName` mount.
**Gap**: Separate Hono sub-apps: `app.route('/discovery', discoverySub); app.route('/sync', syncSub)` — sync goes service-auth-only.

### P1 #4: Sync audit (source block/tx, subject, predicate family, actor service)
**Status**: 🤔 Unclear — not inspected. Likely missing.

### P1 #5: Cache invalidation tests for write-after-read consistency
**Status**: 🤔 Unclear — `hub-mcp/src/lib/cache.ts` mentions cache invalidation by family; test coverage not verified.

### P2 #6: Separate read-only hub and write-only sync worker
**Status**: ❌ Missing — fine for now.

---

## Area 8: SSI Issuer And Verifier Endpoints

### P0 #1: Inventory every `/credential/*`, `/verify/*`, `/.well-known/*`
**Status**: 🟡 Partial — no formal inventory, but I located:
- `apps/org-mcp/src/api/oid4vci.ts:44 /.well-known/openid-credential-issuer`, `oid4vci.ts:180 POST /credential`
- `apps/org-mcp/src/api/credential.ts` (mounted at org-mcp/index.ts:122)
- `apps/person-mcp/src/index.ts:212 GET /.well-known/ssi-wallet.json`
- `apps/person-mcp/src/ssi/api/proofs.ts` (`/proofs/present`), `credentials.ts` (`/credentials/store`, `/credentials/request`), `oid4vp.ts`, `wallet.ts`, `audit.ts`, `match-public-set.ts`, `walletActionRoutes`, `dispatchRoutes` (person-mcp/index.ts:203–210)
- `apps/a2a-agent/src/routes/a2a.ts:16 /.well-known/agent.json` (host-aware)
**Gap**: Produce the formal inventory doc with each row's classification (open-protocol vs private tool surface).

### P0 #2: Rate limits + request-size on open protocol endpoints
**Status**: ❌ Missing — see Area 1 #4 (same gap).

### P0 #3: Ensure open protocol endpoints do not expose `/tools` or private stores
**Status**: ✅ Done by mounting convention — `/tools/:toolName` is separate from `/credential` / `/proofs`. But there's no network-level isolation; same Hono process serves both.
**Gap**: If you keep dual-purpose per process (acceptable for v1), add a comment block at each open-protocol mount site marking it as "PUBLIC PROTOCOL" so refactors don't move private logic into it. Long-term: separate public protocol gateway from private MCP process.

### P1 #4: Issuer/verifier abuse controls (challenge expiry, replay, issuer policy)
**Status**: 🤔 Unclear — not audited.

### P1 #5: Separate public protocol gateway from private MCP process
**Status**: ❌ Missing — same process today.

### P2 #6: Conformance tests for OID4VCI / OID4VP route behavior
**Status**: 🤔 Unclear — packages/privacy-creds may have some.

---

## Area 9: Chain RPC And On-Chain Redeem

### P0 #1: Complete fail-closed caveat matrix for every execution path
**Status**: 🟡 Partial
**Evidence**: For the four `/session/:id/redeem-*` endpoints (onchain-redeem.ts:242, 376, 534, 707, 1041) the matrix is:

| Check | redeem-tx | deploy-agent | redeem-with-chain | redeem-subdelegated | redeem-via-account |
|---|---|---|---|---|---|
| Service HMAC | ✅ | ✅ | ✅ | ✅ | ✅ |
| Tool policy exists | ✅ | n/a (hardcoded) | ✅ | ✅ | ✅ |
| ExecutionPath matches | ✅ | n/a | ✅ | ✅ | ✅ |
| Target in allowedTargets | ✅ | n/a | ✅ | ✅ | ✅ |
| Selector in allowedSelectors | ✅ | n/a | ✅ | ✅ | ✅ |
| Session active + unexpired | ✅ | ✅ | ✅ | ✅ | ✅ |
| Chain-leaf delegate match | n/a | n/a | ✅ | ✅ | n/a |
| Value cap (`maxValueWei`) | ❌ | ❌ | ❌ | ❌ | ❌ |
| Caveat enforcer in known set | ❌ | ❌ | ❌ | ❌ | ❌ |
| Audit row on denial | ✅ | ❌ | ❌ | ✅ | ✅ |

**Gap**: (1) `maxValueWei` from the tool policy is NEVER enforced at the A2A boundary — it's defined in `tool-policies.ts:61` but unread by `onchain-redeem.ts`. Add `if (BigInt(body.value) > policy.maxValueWei) reject`. (2) `redeem-with-chain` and `deploy-agent` don't write deny-rows on policy fail (only redeem-tx and redeem-subdelegated do). (3) An unknown caveat enforcer hash in the user's signed root delegation would only fail at chain `beforeHook` time, after gas is spent. Add a pre-flight allowlist of enforcer addresses (the 16 from `packages/contracts/src/enforcers/`).

### P0 #2: Tests for disallowed target, selector, value, expired session, wrong tool, wrong service
**Status**: ❌ Missing — none located in `apps/a2a-agent/test/` (assuming `pnpm test` doesn't cover these).

### P0 #3: Chain RPC write keys scoped, not in browser or public web env
**Status**: ✅ Done
**Evidence**: All write keys are server-side: `A2A_MASTER_EOA_PRIVATE_KEY`, `DEPLOYER_PRIVATE_KEY`, executor family keys via `TOOL_EXECUTOR_<FAMILY>_PRIVATE_KEY` (apps/a2a-agent/src/lib/tool-executors.ts:1). `apps/web/src/middleware.ts` doesn't gate them. None are `NEXT_PUBLIC_*`. (CLAUDE.md root section "No private keys in `NEXT_PUBLIC_` variables" enforces this).

### P1 #4: Per-tool maximum value and target binding in policy metadata
**Status**: 🟡 Partial — `maxValueWei` is in `ToolPolicy` but unread.

### P1 #5: On-chain receipt correlation to audit rows
**Status**: ✅ Done
**Evidence**: `executionAudit.txHash` populated on completion (onchain-redeem.ts:351–358, 449–456, 648–655, 928–937, 1185–1193).

### P2 #6: Simulation before submission for high-risk money-moving calls
**Status**: ❌ Missing — no `simulateContract` pre-flight before `writeContract` anywhere in `onchain-redeem.ts`.

---

## Area 10: A2A Session Package And Key Custody

### P0 #1: Bind encryption AAD to session id, account address, chain id, audience, expiry
**Status**: ❌ Missing
**Evidence**: `packages/sdk/src/crypto.ts:54–77` — `encryptPayload` calls `crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)` with NO `additionalData` field. AAD is unused. Decryption (`decryptPayload`, crypto.ts:82–98) accordingly does not verify AAD. The encryption key is derived via `SHA-256(A2A_SESSION_SECRET)`.
**Gap**: Add `additionalData: encoder.encode(JSON.stringify({ sessionId, accountAddress, chainId, audience, expiresAt }))` to both encrypt and decrypt. Pass AAD components through `encryptPayload(payload, secret, aad)`. Each callsite already has these values; only the helper signature needs updating.

### P0 #2: Define max session TTL by risk tier
**Status**: ❌ Missing
**Evidence**: `apps/a2a-agent/src/routes/session.ts:66` — `durationSeconds = body.durationSeconds ?? 86400`. Client-supplied with a 24h default and no cap. The user could ask for `durationSeconds: 100 * 365 * 86400` and the server would accept it.
**Gap**: Hard-cap per risk tier: routine = 24h, sensitive = 1h, stateful = 6h. Reject `durationSeconds` over the cap with 400.

### P0 #3: Emergency revoke-all-by-account and revoke-all-by-key-version
**Status**: 🟡 Partial — single-session revoke exists (session.ts:440 `DELETE /session/:id`); bulk revoke does not.
**Gap**: Add `DELETE /sessions/by-account/:accountAddress` and `DELETE /sessions/by-key-version/:keyVersion` admin endpoints under `requireInterServiceAuth()` (or operator HMAC).

### P1 #4: Key versioning and rotation for `A2A_SESSION_SECRET`
**Status**: ❌ Missing
**Evidence**: `apps/a2a-agent/src/config.ts:40` — `requireSecret('A2A_SESSION_SECRET')`. Single value. No `_v1`/`_v2` overlap.
**Gap**: Add `A2A_SESSION_SECRET_VERSIONS` env (comma-separated `v1=<hex>,v2=<hex>` or JSON), tag each stored payload with `keyVersion`, decrypt with the matching version, encrypt new sessions with the latest.

### P1 #5: Move production encryption key to KMS or secret manager
**Status**: ❌ Missing — secret is process env only.

### P1 #6: Avoid logging decrypted package fields
**Status**: 🟡 Partial
**Evidence**: `apps/a2a-agent/src/routes/session.ts:370` logs WebAuthn diagnostics including `clientDataJSON.slice(0, 80)` — not the private key, but is enriched session material. The session private key itself is never logged.
**Gap**: Audit `console.log/warn/error` for sensitive fields; add a serializer that scrubs `sessionPrivateKey`, `signature`, `clientDataJSON` from any logged object.

### P2 #7: Splitting signing into an isolated signer service / HSM
**Status**: ❌ Missing — appropriate for a later phase.

---

## Area 11: Audit, Evidence, And Incident Response

### P0 #1: Unified audit schema (actor, subject, service, route, tool, session id, delegation hash, mcp call id, decision, reason, tx hash)
**Status**: 🟡 Partial
**Evidence**: `apps/a2a-agent/src/db/schema.ts:57–79` — `execution_audit` table covers most of this for ON-CHAIN paths: `rootGrantHash`, `sessionId`, `sessionPrincipal`, `a2aTaskId`, `mcpServer`, `mcpTool`, `mcpCallId` (unique!), `executionPath`, `toolGrantHash`, `toolExecutor`, `target`, `selector`, `callDataHash`, `valueWei`, `txHash`, `userOpHash`, `status`, `errorReason`. Person-mcp has `audit_log` with `prevEntryHash` chain (session-store/index.ts:13).
**Gap**: (1) No row written for MCP-only tool calls (the `mcp-only` execution path doesn't go through `onchain-redeem.ts`). (2) No row for `/session-store/*` or `/wallet-action/*` passthroughs. (3) No cross-service correlation column — each service writes its own audit, no shared trace id.

### P0 #2: Audit denials as well as successes
**Status**: 🟡 Partial — see Area 5 #6 and Area 9 #1; only `redeem-tx` and `redeem-subdelegated` write deny rows. MCP tool denials and `deploy-agent`/`redeem-with-chain` deny paths don't.

### P1 #3: Correlation ids from web → A2A → MCP → chain
**Status**: ❌ Missing — `mcpCallId` is the closest thing (a2a→mcp), and `a2aTaskId` is sub-delegated-only. No `traceId` header propagates from web through every layer.
**Gap**: Add `x-sa-trace-id` header generated at the web action layer, propagated through all subsequent fetch calls, written to every audit row.

### P1 #4: Make audit append-only at the application level
**Status**: 🟡 Partial — person-mcp's `audit_log` uses `prevEntryHash` chaining (session-store/index.ts:13). A2A's `execution_audit` is mutated post-submit (status: pending → completed/reverted; onchain-redeem.ts:351). That's intentional for the receipt lifecycle but means "append-only" doesn't apply to that table.
**Gap**: Add a separate `execution_audit_immutable_log` table that captures each state transition as a new row (no UPDATE).

### P1 #5: Retention and export path
**Status**: ❌ Missing.

### P2 #6: Security dashboards
**Status**: ❌ Missing.

---

## Area 12: Local And Dev Exceptions

### P0 #1: NODE_ENV / SMART_AGENT_ENV guards on seed/debug routes
**Status**: ❌ Missing — see Area 1 #2. Only `/api/test/geo-trust-e2e` has it.

### P0 #2: Bind local-only services to localhost in dev scripts
**Status**: 🤔 Unclear — likely `scripts/fresh-start.sh` and per-service launchers default to localhost binding, but unverified.

### P0 #3: CI check that production env cannot enable demo key paths
**Status**: ❌ Missing
**Evidence**: Anvil-set-balance branch exists at `apps/a2a-agent/src/routes/session.ts:78` gated on `config.CHAIN_ID === 31337`. The dev-membership-check and dev-patch-hannah routes are not env-gated.
**Gap**: Add a runtime fail-fast in `apps/a2a-agent/src/config.ts` and `apps/web/src/config.ts`: if `NODE_ENV === 'production'` and `CHAIN_ID === 31337`, throw at boot.

### P1 #4: Docs table mapping each exception to its guard
**Status**: ❌ Missing.

### P1 #5: Tests for disabled production seed/debug routes
**Status**: ❌ Missing.

---

## Area 13: Guardrails And Tests

### P0 #1: Keep bypass check in CI
**Status**: 🟡 Partial — script exists, CI wiring unverified (see Area 1 #1).

### P0 #2: Test that private MCP ports are not configured as public ingress
**Status**: ❌ Missing — no deployment manifests yet to assert against.

### P1 #3: Route classification metadata or comments + coverage check
**Status**: ❌ Missing — see Area 1 #3.

### P1 #4: Service-auth integration tests for all internal route families
**Status**: ❌ Missing — only HMAC verification unit-level tests likely exist (not located).

### P1 #5: Tool policy coverage tests
**Status**: ❌ Missing — no test asserts every `executionPath !== 'mcp-only'` tool has non-empty `allowedTargets` AND non-empty selector entry in the per-target table.

### P2 #6: Generate architecture route matrices from code
**Status**: ❌ Missing.

---

## Top 10 Quick Wins (< 1 day each, mostly Phase 1-A or 1-B)

These are the items where the implementation cost is low and the security/clarity payoff is high. Suggested ordering matches a Phase-1 sprint:

1. **NODE_ENV gate on `/api/boot-seed`, `/api/dev-membership-check`, `/api/dev-patch-hannah`** (Area 12 #1, Area 1 #2). 3 routes × 4 lines. Pattern already exists at `apps/web/src/app/api/test/geo-trust-e2e/route.ts:42`.
2. **`pnpm check:bypass` wired into CI** (Area 1 #1). Add to `.github/workflows/ci.yml` (or whatever the workflow is) + `package.json` `scripts` if not present.
3. **Production fail-fast in config: refuse to start if `NODE_ENV=production && CHAIN_ID=31337`** (Area 12 #3). 5 lines in each `config.ts`.
4. **Enforce `policy.maxValueWei` in onchain-redeem.ts** (Area 9 #1). Today the field is dead. Add the guard at the start of each redeem handler (~3 lines × 5 handlers).
5. **Cap `durationSeconds` on `/session/init`** (Area 10 #2). One `clamp(body.durationSeconds, 0, MAX_SESSION_TTL[tier])` call.
6. **AAD-bind `encryptPayload` / `decryptPayload`** (Area 10 #1). Add an optional `aad: Uint8Array` parameter to `packages/sdk/src/crypto.ts` and pass `{sessionId, accountAddress, chainId, expiresAt}` from every callsite.
7. **Body-size limit + per-IP rate limit on a2a-agent** (Area 1 #4, Area 2 #2). One `app.use('*', bodyLimit({...}))` and one `app.use('*', rateLimit({...}))` in `apps/a2a-agent/src/index.ts`. Hono ships both.
8. **Audit-row write on deny for `deploy-agent` and `redeem-with-chain`** (Area 9 #1, Area 11 #2). Add the `await writeReceipt({..., status: 'denied', errorReason})` block already present in `redeem-tx` and `redeem-subdelegated` to the two missing paths.
9. **Replay-nonce cache in `requireInterServiceAuth()`** (Area 6 #3). Add a `Map<string, number>` with TTL eviction; key on `${service}:${signature}` so identical replays in-window are rejected.
10. **Enforcer address allowlist pre-flight in `onchain-redeem.ts`** (Area 9 #1). One `KNOWN_ENFORCERS: Set<Address>` from the 16 `apps/contracts/src/enforcers/*.sol`; reject any caveat whose `enforcer` is not in the set before submitting. Saves gas on accidentally-bad delegations and gives clearer errors.

Each of these is bounded by a few files, has clear "before/after" assertion shape, and lays the rails for the larger Phase-1B service-auth standardization push.

---

## Cited files (39 total)

A2A-agent: `apps/a2a-agent/src/index.ts`, `apps/a2a-agent/src/middleware/host-context.ts`, `apps/a2a-agent/src/middleware/require-session.ts`, `apps/a2a-agent/src/middleware/require-grant.ts`, `apps/a2a-agent/src/auth/inter-service.ts`, `apps/a2a-agent/src/routes/auth.ts`, `apps/a2a-agent/src/routes/session.ts`, `apps/a2a-agent/src/routes/delegation.ts`, `apps/a2a-agent/src/routes/profile.ts`, `apps/a2a-agent/src/routes/mcp-proxy.ts`, `apps/a2a-agent/src/routes/onchain-redeem.ts`, `apps/a2a-agent/src/routes/session-meta.ts`, `apps/a2a-agent/src/routes/session-store.ts`, `apps/a2a-agent/src/routes/wallet-action.ts`, `apps/a2a-agent/src/routes/a2a.ts`, `apps/a2a-agent/src/db/schema.ts`, `apps/a2a-agent/src/config.ts`, `apps/a2a-agent/src/lib/tool-executors.ts`.

Web: `apps/web/src/middleware.ts`, `apps/web/src/lib/actions/a2a-session-caveats.ts`, `apps/web/src/app/api/boot-seed/route.ts`, `apps/web/src/app/api/dev-membership-check/route.ts`, `apps/web/src/app/api/dev-patch-hannah/route.ts`, `apps/web/src/app/api/test/geo-trust-e2e/route.ts`.

SDK: `packages/sdk/src/crypto.ts`, `packages/sdk/src/policy/tool-policies.ts`, `packages/sdk/src/delegation.ts`, `packages/sdk/src/delegation-token.ts`.

MCPs: `apps/person-mcp/src/index.ts`, `apps/person-mcp/src/auth/verify-delegation.ts`, `apps/person-mcp/src/auth/dispatch-routes.ts`, `apps/person-mcp/src/session-store/index.ts`, `apps/person-mcp/src/lib/a2a-client.ts`, `apps/org-mcp/src/index.ts`, `apps/org-mcp/src/lib/a2a-client.ts`, `apps/org-mcp/src/auth/verify-delegation.ts`, `apps/org-mcp/src/api/oid4vci.ts`, `apps/hub-mcp/src/index.ts`.

Contracts: `packages/contracts/src/enforcers/DataScopeEnforcer.sol`, `packages/contracts/src/enforcers/McpToolScopeEnforcer.sol`, `packages/contracts/src/enforcers/QuorumEnforcer.sol`, plus the 13 other enforcers under `packages/contracts/src/enforcers/`.

Scripts/docs: `scripts/check-no-bypass.sh`, `docs/architecture/production-hardening-source.md`, `docs/architecture/01-web-a2a-mcp-flows.md`.
