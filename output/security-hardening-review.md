# Smart Agent Production Hardening — Security Review

**Reviewer**: Security agent
**Date**: 2026-05-16
**Branch**: 003-intent-marketplace-proposal
**Source doc**: `docs/architecture/production-hardening-source.md`

This is a threat-model-driven review of the 13-area hardening initiative, grounded in the current codebase. Every finding cites specific files, every recommendation names a file/middleware/scheme to change. Priority annotations preserve P0/P1/P2 from the source doc but flag where the actual code argues for re-ranking.

The strategic context that drives the urgency: the user plans to host **langchain orchestration inside `a2a-agent`**. Today, a2a-agent is a thin broker. The moment LLM-driven planning lives inside it, the blast radius of a prompt-injection or jailbreak inside a2a expands to *everything that a2a-agent's session table + master EOA + per-MCP HMAC keys can reach*. The mesh of caveats, tool policies, and the (still-thin) inter-service auth layer must bound that blast radius cryptographically, not by convention.

---

## Area 1: Public Web Edge

### Current control
- Next.js middleware at `apps/web/src/middleware.ts:12-44` only does session-cookie redirect for non-API pages. All `/api/*` routes are explicitly bypassed at line 22-23 and 33 ("API routes do their own auth where needed").
- `scripts/check-no-bypass.sh:33-50` enforces an allowlist on direct `*_MCP_URL` references in `apps/web/src` (boot-seed, demo-seed, SSI clients, system-readiness).
- Demo-login route has an Origin/Host CSRF check at `apps/web/src/app/api/demo-login/route.ts:11-15`, and only one test endpoint guards `NODE_ENV === 'production'` (`apps/web/src/app/api/test/geo-trust-e2e/route.ts:42-43`).

### Gap
1. **No production env guard on `/api/boot-seed` or `/api/dev-membership-check` or `/api/dev-patch-hannah`**. `apps/web/src/app/api/boot-seed/route.ts:7-17` calls `triggerBootSeed()` on every GET/POST in any environment. In production, an unauthenticated POST to `/api/boot-seed` will attempt to re-deploy the demo community, write to localUserAccounts, and seed AnonCreds — disastrous.
2. **No rate limit anywhere** — neither at the Next middleware nor on any auth endpoint. `apps/web/src/app/api/auth/passkey-verify/route.ts` and `apps/web/src/app/api/auth/siwe-verify/route.ts` are unauthenticated by design (start-of-auth), and a credential-stuffing/replay attacker can hammer them without consequence beyond CPU cost.
3. **`/api/ontology-sync/turtle/route.ts:12-22` exposes the entire GraphDB agents projection** as `text/turtle` to anyone hitting the URL. The route is bare GET, no auth check.
4. The `Origin` CSRF check at `demo-login/route.ts:13` does substring matching (`!origin.includes(host.split(':')[0])`). `Origin: https://evil-foo.com` against `Host: foo.com` *succeeds* the check — substring contains, not equality. Same pattern likely repeated.

### Recommendation
- Add a module `apps/web/src/lib/env-guard.ts` that exports `requireDev()` returning 404 in production, and call it at the top of `apps/web/src/app/api/boot-seed/route.ts`, `dev-membership-check/route.ts`, `dev-patch-hannah/route.ts`, `ontology-sync/turtle/route.ts`, and any `app/api/test/**`.
- Add Next.js middleware-level rate-limit (in `apps/web/src/middleware.ts`) for `/api/auth/passkey-challenge`, `/api/auth/passkey-verify`, `/api/auth/siwe-challenge`, `/api/auth/siwe-verify`, `/api/a2a/bootstrap/complete`. A simple sliding-window with an in-memory + Redis-backed fallback is enough; the source doc P1 understates this — it's P0 once the system is internet-exposed.
- Replace the substring `Origin` check in `apps/web/src/app/api/demo-login/route.ts:13-15` with a parsed-URL equality check (`new URL(origin).host === host`). Audit other API routes for the same anti-pattern via `grep -rn "origin.includes" apps/web/src`.

### Priority
**P0** — boot-seed/dev/ontology-turtle exposure is one-line-fix risk; rate-limit is a regulatory minimum.

---

## Area 2: A2A Ingress and Wildcard Host Routing

### Current control
- `apps/a2a-agent/src/middleware/host-context.ts:83-112` is the central exempt-list for paths that don't require an agent slug. It exempts `/health`, `/.well-known/agent.json`, `/auth/challenge`, `/auth/verify`, `/session/init`, `/session/package`, and any path starting with `/session-store/` or `/wallet-action/`, plus the inter-service redeem suffixes.
- Host parsing at `host-context.ts:121-133` is strict — requires the exact `.<base>` suffix, single-label slug, and a regex match.
- `apps/a2a-agent/src/middleware/require-session.ts:91-107` *logs* a cross-agent call but does NOT enforce a match between the bearer session's `accountAddress` and the host's `agentAddress`. The comment lists "legitimate" reasons (org context, hub), so the routing slug is intentionally a routing signal only.

### Gap
1. **Cross-agent privilege escalation via subdomain swap.** Because `require-session.ts:103` lets `expected !== got` through (logs only), a malicious caller with a valid bearer for user A can call `https://orgB.agent.localhost:3100/mcp/org/<dangerous-tool>`. The bearer is valid for A; the `host-context` routes through B; the MCP-proxy then mints a delegation token whose `delegation.delegator = A.smartAccount` (taken from A's encrypted package), and sends it to org-mcp. Org-mcp's `verify-delegation.ts` checks the delegation but not the *host slug* — so it accepts the call. The bug is masked today because most org-mcp tools recompute the principal from the delegation, but tools that read the host (none yet) or that use the *host* slug as a discovery key would be exploitable.
2. **No request-size limit at the A2A edge.** Hono with `@hono/node-server` defaults to no limit. `POST /session/package` body includes a delegation struct + signature; a large-body DoS is possible.
3. **System slug is hard-coded** at `host-context.ts:284`: `const SYSTEM_SLUG = 'system'`. Anyone who can reach a2a-agent on `system.agent.localhost:3100/mcp/hub/<tool>` bypasses `requireSession` because `mcpProxy.post('/hub/:tool', …)` at `apps/a2a-agent/src/routes/mcp-proxy.ts:162` has no auth at all. If hub tools ever include any write that depends on caller identity, this is a hole. Right now sync writes look at chain receipts, but `cacheClear` (mentioned in hub-mcp `index.ts:108`) and any future `debug:*` tools would be reachable.
4. **A2A `/health` is fully public** — and replies with environment-derived data that includes config readiness signals — `index.ts:27`. Not catastrophic, but reconnaissance.

### Recommendation
- Add a **strict-mode** flag (`A2A_HOST_ENFORCE=strict`) in `apps/a2a-agent/src/middleware/require-session.ts:99-107`. In strict mode, fail closed on a cross-agent mismatch unless the call is to a system-marked route. Org/hub routing should be *explicit* via a per-route allow-list, not implicit. Encode the allow-list in `apps/a2a-agent/src/middleware/require-session.ts` as a `CROSS_AGENT_ALLOWED_PATHS = ['/mcp/org/', '/mcp/hub/']` constant.
- Apply `bodyLimit` middleware in `apps/a2a-agent/src/index.ts:24` — e.g. `app.use('*', bodyLimit({ maxSize: 256 * 1024 }))`. Override per-route if `/session/package` needs more.
- Move the system-slug bypass to a discrete service-auth header on hub routes: require `X-SA-Service: web` with HMAC over the canonical body, instead of host-slug matching. Patch `apps/a2a-agent/src/routes/mcp-proxy.ts:162-179`.
- Add a route-allowlist *positive list* at `apps/a2a-agent/src/index.ts` that whitelists publicly reachable paths (`/health`, `/.well-known/agent.json`, `/auth/*`, `/session/init`, `/session/package`) and rejects everything else unless service-auth or session is present. This inverts the current model (allowlist exempts) which is safer.

### Priority
**P0** — host-bypass to a privileged tool is the kind of finding that ends architecture reviews badly. The cross-agent-call comment that says "we'll log but not enforce" is doing real load.

---

## Area 3: A2A Session-Store Bootstrap

### Current control
- `apps/a2a-agent/src/routes/session-store.ts:51-86` is a pure passthrough — every endpoint forwards directly to `PERSON_MCP_URL` with no edge auth.
- Host-context exempts `/session-store/*` at `host-context.ts:106`.
- Person-mcp's `apps/person-mcp/src/auth/wallet-action-routes.ts:108-177` accepts these forwarded calls and writes to its session-store SQLite, with no service-auth check either.
- The web client in `apps/web/src/lib/auth/person-mcp-session-client.ts:19-26` calls `${A2A_AGENT_URL}/session-store/*` over the bare loopback URL.

### Gap
1. **Anyone on the network can mint, read, revoke, or epoch-bump SessionRecords.** Three concrete attacks:
   - `POST /session-store/insert` with a fabricated SessionRecord whose `smartAccountAddress` matches a known victim and `sessionSignerAddress` is attacker-controlled. The verifier `verify-delegated-action.ts:74-76` recovers the signer and compares to `session.sessionSignerAddress` — which is now the attacker's key. The attacker has effectively planted a session for the victim. This works because `insertSession()` in `apps/person-mcp/src/session-store/index.ts` does not require an ERC-1271 signature on the inserted record. (The web app only inserts after passkey verification, but a network attacker doesn't have to go through the web app.)
   - `POST /session-store/revoke` with `{ sessionId: <victim-cookie-id> }` — denial of service against active sessions.
   - `POST /session-store/bump-epoch` with `{ smartAccountAddress: <victim> }` — invalidates every session for that account (the verifier's epoch check at `verify-delegated-action.ts:62-64` rejects on epoch mismatch). Mass-revocation DoS.
2. **Bootstrap-vs-post-session conflation.** The route comments split routes into "bootstrap-tier" (epoch/insert/by-cookie) vs "post-session-tier" (active/revoke/bump-epoch), but they're served from the same unauthenticated handler. The doc itself flags this (Area 3 P1 "move post-session operations to MCP tools").
3. **The session insert is not cryptographically tied to a fresh passkey assertion.** A SessionRecord includes `verifiedPasskeyPubkey`, but person-mcp does not re-verify the passkey assertion on insert — it trusts whatever the web app sent. The chain of trust is: web app calls passkey-verify route → web app calls insertSessionRecord. Since the insert path is unauthenticated at both edges, anyone can forge it.

### Recommendation
- Split into TWO route groups in `apps/a2a-agent/src/routes/session-store.ts`:
  - **bootstrap group** (`/session-store/epoch/:account` GET, `/session-store/insert` POST, `/session-store/by-cookie/:cookieValue` GET) — accepts a single trusted caller, **the web app**, identified by a *new* service-auth envelope `X-SA-Service: web` + HMAC over canonical(body, ts, path) using a new env `WEB_TO_A2A_HMAC_KEY`. Web populates this in `apps/web/src/lib/auth/person-mcp-session-client.ts`. Insert additionally requires the request to include a `passkeyAssertion` blob that person-mcp re-verifies against the smart account's stored passkey via ERC-1271 BEFORE writing the row.
  - **post-session group** (`/session-store/active/:account`, `/session-store/revoke`, `/session-store/bump-epoch`) — converted to MCP tools (`ssi_session_active`, `ssi_session_revoke`, `ssi_session_bump_epoch`) callable only via `mcpProxy.post('/:server/:tool', requireSession, …)` so they require a delegation token. Delete the corresponding HTTP routes in `apps/person-mcp/src/auth/wallet-action-routes.ts:155-177`.
- Add network-policy gating: in production deployment manifest, **do not expose the a2a-agent's `/session-store/*` route on the public ingress** — only on the internal mesh interface used by the web app's server-side fetcher. The `a2aFetch` in `apps/web/src/lib/clients/a2a-fetch.ts:44-46` already pins to 127.0.0.1; the deployment must mirror that with mTLS or a sidecar listener.
- Add a per-account rate limit on `/session-store/bump-epoch` (≤ 1 per minute) to bound the mass-revocation DoS even if service-auth is bypassed.
- Implement a *nonce table* in person-mcp's session-store for `insert`: `(smartAccountAddress, passkey-challenge-id) UNIQUE` so the same challenge can't be replayed to create two SessionRecords.

### Priority
**P0** — the unauthenticated insert is a session-impersonation primitive. With LangChain orchestration coming, the value of a planted session goes up: it grants the attacker an effective `walletActions: [...]` scope inside the grant.

---

## Area 4: WalletAction Dispatch

### Current control
- `apps/a2a-agent/src/routes/wallet-action.ts:25-36` is a 12-line passthrough — no auth.
- Host-context exempts `/wallet-action/*` at `host-context.ts:110`.
- Person-mcp's `verifyDelegatedWalletAction` at `apps/person-mcp/src/auth/verify-delegated-action.ts:44-138` does the heavy lifting: signature recovery, session lookup, epoch check, audience check, risk classification (line 87 — `serverRisk = classifyRisk(action.action.type)`), scope check, action-window check, nonce burn, idle bump, audit append.
- Verifier rejects on bad audience, bad risk, bad scope, expired, replay (line 119 `consumeActionNonce`).

### Gap
1. The verifier is *good* — but it's the only thing standing between the internet and a person-mcp side-effect. Any signature-bypass bug in `recoverAddress` flow, any pre-verifier short-circuit in person-mcp's Hono route, lands you a free dispatch. Defense-in-depth at the a2a-agent edge is missing.
2. **The dispatch flow trusts the caller-supplied `sessionId`.** Verifier line 54 looks up `getSessionById(input.sessionId)`. If an attacker has a valid SessionRecord (e.g. their own) and signs a WalletAction that claims to act on a different `actor.smartAccountAddress`, the verifier *catches* it at lines 71-73 (`subject_mismatch`). Good. But — if the session-store insert can be planted (Area 3), the planted record's smartAccountAddress matches the victim, and the signer matches the attacker → both checks pass.
3. **No service-auth on the dispatch passthrough means the LangChain agent inside a2a-agent could forge dispatches.** If the LLM is jailbroken and decides to invoke `/wallet-action/dispatch` directly, it needs the user's session key to sign. That key is in the encrypted package in the sessions table. A2A code paths that load that package (e.g. `loadActiveSessionPackage` in `onchain-redeem.ts:219-232`) can sign actions on behalf of the user *without going through any caveat check*, because `verifyDelegatedWalletAction` is happy as long as the action is well-formed.
4. The wallet-action route at `apps/a2a-agent/src/routes/wallet-action.ts` does no replay cache, no expiry, no path-binding. Person-mcp's `consumeActionNonce` is the only replay defense, and a different downstream service hosting the same nonce store would be a footgun.

### Recommendation
- Apply `requireInterServiceAuth()` to `/wallet-action/dispatch` (`apps/a2a-agent/src/routes/wallet-action.ts:25`), with the caller being either `X-SA-Service: web` or the future langchain caller `X-SA-Service: langchain-planner` — never directly from the agent runtime's own outbound requests. The dispatch becomes "the web (or a sanctioned planner) tells a2a to route a signed WalletAction to person-mcp." A2A-agent re-signs to person-mcp with the *person-mcp* HMAC key so person-mcp also verifies service identity, not just signature.
- Add an **audience-binding** layer: the WalletAction's `audience.service` (already present in `verify-delegated-action.ts:82-84`) must equal the service that the request originated from. Make the audience field include `originService` and `originTaskId`, set by a2a-agent at proxy time, validated by person-mcp — that defeats the LangChain-self-call scenario.
- Move the action-nonce table to a **shared cache** (`apps/a2a-agent/src/db/schema.ts` extension) and check it BOTH at the a2a edge AND at person-mcp's verifier. Cross-service replay cache.
- Add audit rows at the a2a edge: every accepted/denied dispatch writes to `apps/a2a-agent/src/db/schema.ts:executionAudit` (extend) with `mcpServer='person-mcp'`, `mcpTool='wallet-action:<type>'`, status. Today only on-chain redeem paths get audit rows.

### Priority
**P0** — Person-mcp's verifier is the right control surface but it's the LAST one. A2A-edge controls are non-optional once LangChain is in-process.

---

## Area 5: MCP Tool Plane

### Current control
- All MCP `/tools/:tool` endpoints (e.g. `apps/person-mcp/src/index.ts:150-177`) accept POST with `{ tool, args: { token, _a2aSessionId, … } }`.
- A2A's `mcp-proxy.ts:81-103` mints a `DelegationTokenClaims` with audience, jti, usageLimit=10, expiresAtISO bound to the session expiry.
- Person-mcp/org-mcp `verify-delegation.ts` verifies: claims canonical signature → on-chain `isRevoked` → ERC-1271 on delegator → caveat enforcement → JTI atomic-upsert with usage-limit gate.
- Caveat enforcement at `apps/person-mcp/src/auth/verify-delegation.ts:120-152` decodes Timestamp and McpToolScope caveats.

### Gap
1. **CRITICAL — caveat enforcement is NOT fail-closed.** `apps/person-mcp/src/auth/verify-delegation.ts:120-152` walks the caveats: if the enforcer address matches the Timestamp address it checks expiry, if it matches the McpToolScope address it checks tool name. **Anything else falls through silently.** The user's root delegation contains AllowedTargets, AllowedMethods, Value, TaskBinding, CallDataHash enforcers — none of them are checked off-chain. They're only checked on-chain at `redeemDelegation` time. So:
   - A2A's mcp-proxy mints a delegation token whose embedded delegation has caveats the verifier *cannot interpret*. The verifier accepts it. The MCP tool runs business logic (writes to SQLite, returns data) believing the caveats authorize this. There's no on-chain redeem for `mcp-only` tools, so the caveats never get enforced *anywhere*.
   - The same gap exists in `apps/org-mcp/src/auth/verify-delegation.ts:116-145`.
   The doc Area 5 P0 says "Unsupported caveats fail closed" — this is currently *not* the case. It's silently fail-open.
2. **`_a2aSessionId` is forwarded as part of `args`** at `apps/a2a-agent/src/routes/mcp-proxy.ts:119`. The MCP tool can read it, sign-back to a2a-agent for on-chain redemption, and tell a2a "redeem with this `mcpTool` for this session." The TOOL_POLICY check at `onchain-redeem.ts:255-262` catches a tool/session mismatch only if the policy itself doesn't allow that tool. There's no binding between **which user session minted the token** and **which session the MCP can call back about** — a compromised org-mcp could call `/session/<other-session-id>/redeem-tx` if it knows another session id, since the HMAC is per-service not per-session. (The session signature on the redeem-tx body is per-session via the canonical `${body}:${ts}:${sessionId}`, so the path-bound check at `inter-service.ts:91-93` *does* prevent cross-session replay using the SAME session key. Good. But it does NOT prevent a malicious org-mcp from inventing a new request for a different session: it computes its own HMAC over the new canonical, which is valid.) The only thing preventing cross-session abuse is `loadActiveSessionPackage` requiring the session to exist + be active — which it always is for victims.
3. **The hub-mcp proxy at `apps/a2a-agent/src/routes/mcp-proxy.ts:162-179` has NO auth at all** — anyone reaching `system.agent.localhost:3100/mcp/hub/<tool>` can invoke any hub tool. The doc Area 7 covers this as P0; reiterating here because it's an MCP-plane finding.

### Recommendation
- **Fail-closed caveat verifier** — at `apps/person-mcp/src/auth/verify-delegation.ts:120-152` and `apps/org-mcp/src/auth/verify-delegation.ts:116-145`, add an explicit "known enforcer addresses" set (Timestamp, MCP-tool-scope, AllowedTargets, AllowedMethods, Value, TaskBinding, CallDataHash, DataScope) imported from `packages/sdk/src/index.ts`. For each caveat in the loop, if `enforcer.toLowerCase()` is not in the known set, `return { error: 'unknown caveat enforcer: <addr>' }`. Implement decoders for AllowedMethods/AllowedTargets/Value off-chain at parity with the on-chain semantics.
- Add a shared utility `packages/sdk/src/policy/caveat-evaluator.ts` so all three MCPs (and any future ones) share one fail-closed implementation. Reduces drift.
- **Bind the inter-service redeem HMAC to a session-and-service pair.** In `apps/a2a-agent/src/auth/inter-service.ts:91-93`, change canonical to include `tokenJti` from the calling MCP's delegation token — i.e. the MCP must echo back the JTI it received from a2a, and a2a's audit-side checks that this MCP was the audience of that JTI. That makes it impossible for org-mcp to invoke redeem for a session it never received a token for.
- Move the hub-mcp proxy under a new `requireServiceAuth('web')` middleware (see Area 6) instead of being unauthenticated.

### Priority
**P0** — the silent fail-open on unknown caveats is the most important codebase-specific finding in this entire review. The risk surface multiplies with every new caveat enforcer the contracts team adds.

---

## Area 6: Service-to-Service Authentication

### Current control
- HMAC envelope defined at `apps/a2a-agent/src/auth/inter-service.ts:30-104`. Headers: `x-a2a-service`, `x-a2a-timestamp`, `x-a2a-signature`. Canonical: `${bodyRaw}:${timestamp}:${sessionId}`. Clock skew ±60s.
- Per-MCP keys: `A2A_INTERSERVICE_HMAC_KEY_<TAIL>` envs (org, person, family, people-group, verifier, skill, geo) — confirmed populated in `apps/a2a-agent/.env:71-102` and `apps/verifier-mcp/.env:45`.
- Applied to: redeem-tx, deploy-agent, redeem-with-chain, redeem-subdelegated, redeem-via-account (all in `apps/a2a-agent/src/routes/onchain-redeem.ts`).
- Not applied to: `/session-store/*`, `/wallet-action/*`, `/mcp/hub/*`, `/mcp/:server/:tool` (the inbound MCP-tool-call path — those use the user delegation token instead).
- Hex-keyed HMAC-SHA256 with constant-time compare at `packages/sdk/src/crypto.ts:112-142`.

### Gap
1. **No key id / no rotation support.** `inter-service.ts:39-42` resolves `envKeyFor(service)` to a single key per service. Rotating org-mcp's key means simultaneous redeploy of org-mcp + a2a-agent. In production that means downtime, and there's no way to support two valid keys during a rolling rotation. Operationally this means the keys *won't* be rotated.
2. **Replay cache absent.** The ±60s window prevents *late* replay but not within-window replay. A malicious co-located network observer (cf. the LangChain-inside-a2a threat model) can capture an HMAC and replay it within 60 seconds. The on-chain audit catches duplicate tx submissions on retry of the redeem-tx path (because the redeem either lands or reverts), but `/wallet-action/dispatch` doesn't have an on-chain step — and right now doesn't have inter-service HMAC at all (Area 4).
3. **No service allowlist per route family.** `inter-service.ts:71` accepts any value in `SERVICE_NAMES`. There's nothing stopping `verifier-mcp` from calling `/session/:id/redeem-tx`, even though only `org-mcp` and `person-mcp` legitimately do today. The policy gate at `onchain-redeem.ts:255-262` accepts whatever `mcpTool` was specified — but the *requesting service* is recorded only in audit (`mcpServer = ctx?.service`), not used for authorization.
4. **HMAC secret strength check is at config load only** (`apps/a2a-agent/src/config.ts:25-34`), and only applies to `A2A_SESSION_SECRET`, not to the inter-service keys. A weak `A2A_INTERSERVICE_HMAC_KEY_ORG` would be accepted silently.

### Recommendation
- Move to a **versioned key** envelope: add `x-a2a-key-id: org-mcp-v3`, with a key store `apps/a2a-agent/src/auth/key-store.ts` that resolves key-id → secret. Support two active key ids per service during rotation (`A2A_INTERSERVICE_HMAC_KEY_ORG_V3`, `_V4`). Modify `inter-service.ts:84-87` to consult the key-id header.
- Add a replay table in `apps/a2a-agent/src/db/schema.ts`: `inter_service_nonce(nonce TEXT PRIMARY KEY, expires_at INTEGER)`. Canonical becomes `${bodyRaw}:${timestamp}:${nonce}:${sessionId}`. Reject if seen.
- Add per-route-family service allowlists in `apps/a2a-agent/src/auth/inter-service.ts`:
  ```ts
  const ROUTE_FAMILY_ALLOWED: Record<string, ServiceName[]> = {
    '/session/*/redeem-tx': ['org-mcp', 'person-mcp'],
    '/session/*/deploy-agent': ['org-mcp'],
    '/session/*/redeem-with-chain': ['org-mcp'],
    '/wallet-action/dispatch': ['web', 'langchain-planner'],
    …
  }
  ```
  Enforce in the middleware.
- Extend the `requireSecret` validator in `apps/a2a-agent/src/config.ts:25-34` to all `A2A_INTERSERVICE_HMAC_KEY_*` envs at startup. Fail fast if any are weak or missing.
- **Production target**: mTLS or signed service-JWTs. HMAC is acceptable for staging/local with rotation; the doc's open-decision recommendation (signed service JWT or mTLS) is correct. Recommend signed-service-JWTs minted by a sidecar with a 5-minute validity window — implementable as a TypeScript wrapper around `jose` and rolled out per route family. Avoid mTLS as the first step because the local-dev story breaks.

### Priority
**P0** — the route-family allowlist and replay cache are quick wins. Key rotation is operationally critical before any production deploy.

---

## Area 7: Hub-MCP and GraphDB

### Current control
- `apps/hub-mcp/src/index.ts:86-108` exposes `/tools/:tool` (handles both discovery and sync tools), `/admin/cache/clear`, `/debug/agents-turtle`. No auth.
- A2A's `mcp-proxy.ts:162-179` proxies `/mcp/hub/:tool` with no auth at the a2a edge either. The bypass note (`mcp-proxy.ts:155-161`) acknowledges this is intentional but does not constrain it.
- GraphDB is written only via hub-mcp `sync:*` tools (per `apps/hub-mcp/src/tools/sync.ts`); discovery reads via `discovery:*` tools cached in `lib/cache.ts`.

### Gap
1. **`/admin/cache/clear` and `/debug/agents-turtle` are unauthenticated on hub-mcp port 3900.** If hub-mcp's port is ever exposed (or if a co-located service is compromised), an attacker can flush the cache (cheap DoS via repeated invalidation) or exfiltrate the entire agent projection (PII-relevant fields like agent display names, types, addresses).
2. **No service-auth on hub-mcp `sync:*` tools.** The on-chain → KB sync writer can be invoked by any caller — including a compromised MCP — and made to write arbitrary turtle into the agents named graph. Even though the writer reads from chain receipts, if the caller can pass arguments that influence what's written, that's a forgery channel.
3. **No write→read consistency token.** The cache invalidation comment at `mcp-proxy.ts:156-158` says hub-mcp invalidates after writes, but there's no guarantee a stale read from the discovery cache won't precede the invalidate. A caller acting on stale discovery data could be misled into making an authorization decision (e.g. "this is the catalyst hub"). Not a direct security issue, more a correctness one.

### Recommendation
- Apply `requireInterServiceAuth()` to `apps/hub-mcp/src/index.ts:86-108` for both `/tools/:tool` whose name starts with `sync:`, `/admin/*`, and `/debug/*`. Read-only discovery tools (`discovery:*`) can stay unauthenticated at hub-mcp if the port is private — but layer them behind a2a-agent's `/mcp/hub` proxy with service-auth.
- Split `apps/hub-mcp/src/tools/sync.ts` and `apps/hub-mcp/src/tools/discovery.ts` into two route groups in `index.ts`. The discovery group can be served on a separate Hono `app.route('/discovery', …)` mount; the sync group on `/sync`. Apply different middleware. Future: split processes.
- Disable `/debug/agents-turtle` unless `NODE_ENV !== 'production' || X-SA-Operator: <jwt>`. Same as web's `/api/ontology-sync/turtle/route.ts`.
- Bind cache invalidation to a monotonic version in the cache key (write returns `cacheVersion`, reads can request `If-At-Least-Version`). Implementation in `apps/hub-mcp/src/lib/cache.ts`.

### Priority
**P0** for the unauthenticated admin/debug; **P1** for the read/write split (doc agrees).

---

## Area 8: SSI Issuer and Verifier Endpoints

### Current control
- `apps/verifier-mcp/src/index.ts:12-36` exposes `/health`, `/.well-known/agent.json`, and the `verifyRoutes` mount (which adds `/verify/:credentialType/request`, `/check`, `/specs`). No auth.
- `apps/skill-mcp/src/index.ts:12-31` exposes `/health`, `/.well-known/agent.json`, and `credentialRoutes` (issuer protocol).
- These are intentionally open per OID4VCI / OID4VP semantics.

### Gap
1. **No rate limit on the open protocol endpoints.** A challenge-generation flood at `/verify/:credentialType/request` is unbounded.
2. **No challenge expiry / replay table evident.** I didn't open `apps/verifier-mcp/src/api/verify.ts` here, but no rate-limit or challenge-replay infrastructure was visible from the imports. (Phase 1 of an audit would walk this code.)
3. **The `/health` endpoint at `apps/verifier-mcp/src/index.ts:12-17` returns the verifier identity** — `did`, `address`, port. Confirms the SSI service is alive and reveals operational details to anyone scanning.
4. The same MCP processes host both the **open** OID4VCI/VP routes AND any private MCP `/tools/:tool` (skill-mcp, geo-mcp, verifier-mcp). If the public ingress is configured to expose port `:3401` for the verifier (necessary for the protocol to work), it inadvertently exposes everything else on that port too. The doc Area 8 P1 recommends a separate public gateway — necessary, not optional.

### Recommendation
- Inventory all `/credential/*`, `/verify/*`, `/.well-known/*` routes in a new file `docs/architecture/03-public-ssi-route-inventory.md`. Auto-generate via a script that grep's `app.get|app.post` across `apps/*-mcp/src/**/*.ts`.
- Add a token-bucket rate limit middleware in `apps/verifier-mcp/src/index.ts` and `apps/skill-mcp/src/index.ts` (`hono-rate-limiter` or a hand-rolled in-memory bucket) keyed on `c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')`. 30 requests/min/IP on `/verify/*/request`.
- Confirm challenge replay defense: read `apps/verifier-mcp/src/api/verify.ts` and add a `challenge_used(challenge_hash UNIQUE)` table if missing.
- Split the SSI process into two Hono apps in the same process, listening on two ports: public-port (3401) → open routes only, private-port (3402) → `/tools/*` (none today on verifier-mcp/skill-mcp, but enforce the constraint anyway). Production ingress maps only the public port.
- Reduce `/health` payload to `{ ok: true }` — push the identity info under `/.well-known/agent.json` which is already an intentional disclosure.

### Priority
**P1** — there's nothing actively bleeding here, but the lack of rate limit on a public surface is reckless once internet-facing.

---

## Area 9: Chain RPC and On-Chain Redeem

### Current control
- `apps/a2a-agent/src/routes/onchain-redeem.ts` is the only path to `DelegationManager.redeemDelegation`. It has 5 variants: `/redeem-tx`, `/redeem-with-chain`, `/redeem-subdelegated`, `/redeem-via-account`, `/deploy-agent`.
- Every variant requires `requireInterServiceAuth()` (lines 242, 376, 534, 707, 1041).
- Every variant checks `TOOL_POLICIES[body.mcpTool]` exists and matches the expected `executionPath` (e.g. `stateless-redeem` at line 259-261, `sub-delegated` at line 723-728, `session-account` at line 1058-1063).
- Target/selector validation at lines 268-303 (redeem-tx), 574-591 (chain), 740-774 (sub-delegated), 1074-1098 (session-account).
- Sub-delegated path mints a 60-second-window D_sub with CallDataHashEnforcer + TaskBindingEnforcer (lines 800-807).
- Audit row written before submit (`status='pending'`) with row updated on completion (`completed`/`reverted`/`denied`).
- The session EOA is funded with 1 ETH from `anvil_setBalance` (dev-only, `session.ts:75-90`); in production the master EOA pays gas for stateful-session bundling (`session.ts:153`, `onchain-redeem.ts:1168`).

### Gap
1. **`policyAllowedSelectors` returns an EMPTY set silently when no SELECTORS_BY_TOOL entry exists.** At `onchain-redeem.ts:145-183`, `policyAllowedSelectors(toolId, policy)` only adds selectors for the targets in the policy that ALSO have an entry in the corresponding `_SELECTORS_BY_TOOL` table. If a tool is registered with `allowedTargets: ['PoolRegistry']` but `POOL_REGISTRY_SELECTORS_BY_TOOL[toolId]` is missing or empty, `allowedSelectors.size === 0`. Then at line 292 `if (allowedSelectors.size > 0 && !allowedSelectors.has(selector))` — the check **passes** because the precondition `size > 0` fails. **This is fail-open**. Any new tool added to `TOOL_POLICIES` but not to the per-target selector tables will accept any selector.
2. **`policy.maxValueWei` is declared in `ToolPolicy` (`tool-policies.ts:62`) but NEVER enforced** in the redeem handlers. The 4 redeem handlers compute `valueWei = BigInt(body.value)` and submit it as-is. The user's root delegation has a Value caveat on chain so the on-chain redeem will revert if it exceeds the on-chain cap — but for tools where the on-chain value cap is generous (or zero with no enforcer), the policy's `maxValueWei` is silently ignored. The sub-delegated path packs `Value(valueWei)` into D_sub (line 804), which is correct, but D_sub's value comes from the *request body*, not from `policy.maxValueWei`.
3. **The session EOA pays gas only with anvil-funded ETH in dev** (`session.ts:78-89`). In production, the EOA needs gas refilling — either from a paymaster or from the master EOA. If gas runs out, the redeem fails silently (`tx reverted: 502`). Operational concern, not security per se.
4. **The `revoke` post-submit is fire-and-forget without retry.** At `onchain-redeem.ts:902-925`, the post-submit `revokeDelegation` for D_sub is best-effort. If it fails (transport, gas, race), `subHash` stays unrevoked and a leaked session key COULD re-submit the same D_sub against the same calldata within the 60s window — actually no, the calldata-hash enforcer + on-chain timestamp double-block it. So the revoke is genuinely belt-and-suspenders. Fine.
5. **`/session/:id/redeem-via-account` uses `config.A2A_MASTER_EOA_PRIVATE_KEY` to pay gas** (line 1168). In production, this private key is hot, must be funded, must be rotated. The current config defaults it to a zero key (`config.ts:70`), which means production accidentally booting with this default would not be detected by `requireSecret` (only `A2A_SESSION_SECRET` is so guarded — line 25-34). Need to gate the master EOA the same way.

### Recommendation
- **Fix the selector fail-open at `apps/a2a-agent/src/routes/onchain-redeem.ts:292`**: change to `if (!allowedSelectors.has(selector))` and abort if `allowedSelectors.size === 0` BEFORE this check — i.e. require every redeem-tier tool policy to have at least one selector mapped, fail-closed otherwise. Add a startup assertion at `packages/sdk/src/policy/tool-policies.ts` (new function `assertPolicyCompleteness()`) that for each policy with `executionPath !== 'mcp-only'`, the per-target `_SELECTORS_BY_TOOL[toolId]` is non-empty for every entry in `allowedTargets`. Invoke at `apps/a2a-agent/src/index.ts:25` so the process refuses to start with an incomplete tool policy.
- **Enforce `policy.maxValueWei`**: at each redeem handler, add `if (valueWei > policy.maxValueWei) return c.json({ error: ... }, 403)`. Sub-delegated path: use `policy.maxValueWei` (not `valueWei`) when building the Value caveat, so the on-chain enforcer caps it independently.
- Promote `A2A_MASTER_EOA_PRIVATE_KEY` to `requireSecret` validation at `apps/a2a-agent/src/config.ts:25-34`. Reject the zero key.
- Add a chain-id consistency check at `loadActiveSessionPackage` — the stored package was minted at `config.CHAIN_ID`; refuse to redeem on a different chain id (paranoid against config mismatch on rolling deploys).
- Add an **on-chain receipt → audit row reconciler** as a background job: every `executionAudit` row with `status='pending'` older than 5 minutes is reconciled against the chain. Catches network drops in the redeem path.
- For high-risk tools (those with `riskTier='sensitive'`): add a *pre-simulation* via `eth_call` before the submit at `onchain-redeem.ts:340-348` / `:879-887`. If the simulation reverts, return 400 without burning gas. Reduces footgun for malicious calldata.

### Priority
**P0** for the selector fail-open + maxValueWei enforcement + master EOA secret-strength. P1 for the rest.

---

## Area 10: A2A Session Package and Key Custody

### Current control
- `packages/sdk/src/crypto.ts:54-98` implements AES-GCM with `crypto.subtle`, deriving the key as `SHA-256(secret)`. IV is 12-byte random.
- `apps/a2a-agent/src/config.ts:40` requires `A2A_SESSION_SECRET` via `requireSecret`, which fails on `<16` chars or strings containing `change-in-production`.
- Encrypted package stored in `apps/a2a-agent/src/db/schema.ts:sessions(encryptedPackage, iv)` (SQLite via drizzle, file-backed).
- Plaintext contains `sessionPrivateKey`, `sessionKeyAddress`, full delegation struct (including signature), `accountAddress`, `expiresAt`.
- Decrypted at: `apps/a2a-agent/src/routes/onchain-redeem.ts:227-230` (every redeem call), `mcp-proxy.ts:76-79` (every tool proxy call), `session.ts:384-387` (activation).

### Gap
1. **No AAD (additional authenticated data) binding.** AES-GCM with no AAD means an encrypted package can be moved between rows: if an attacker writes-access the sessions table, they can copy User A's `(encryptedPackage, iv)` to User B's session row. On decrypt, B's a2a code will get back A's session key + A's delegation. Then B's call paths (where B has a valid bearer cookie) will redeem A's authority. This is a *post-DB-compromise* attack but the AAD defense is one line.
2. **The encryption key derivation is `SHA-256(secret)` without a salt or KDF.** A reused secret across environments means identical key. If `A2A_SESSION_SECRET` is committed by mistake to a shared `.env.example`, every dev's sessions table is interchangeable. The doc Area 10 P1 says "key versioning and rotation for `A2A_SESSION_SECRET`" — there is NO version field today.
3. **No max-TTL by risk tier.** `apps/a2a-agent/src/routes/session.ts:66` defaults to `86400` seconds (24h). The grant scope inside a SessionRecord may be `walletActions: ['CreatePresentation', …]` ranging from low-risk (24h fine) to higher (24h is too long). No code path tightens TTL based on the grant scope.
4. **No "revoke-all-by-account" or "revoke-all-by-key-version" path.** The sessions table has a `status` field but the only ways to flip it are via `/session/:id` DELETE (one at a time) and `bump-epoch` (which invalidates indirectly via the verifier's epoch check). No DELETE-FROM-SESSIONS by account.
5. **Plaintext package fields are logged in some paths.** The diagnostic block at `apps/a2a-agent/src/routes/session.ts:331-371` logs the credential digest, clientDataJSON snippet, delegation hash on signature rejection. The delegation hash + clientDataJSON could be enough for a partial replay against a different verifier. The current log is `console.warn`, which lands in `tmp/logs/a2a-agent.log` — operator-readable but still a leak.

### Recommendation
- **AAD bind**: change `packages/sdk/src/crypto.ts:54-77` to accept an `aad: Uint8Array` argument and pass it through `crypto.subtle.encrypt({name, iv, additionalData: aad}, …)`. In `apps/a2a-agent/src/routes/session.ts:112-127` and `:398-409`, compute AAD as `keccak256(toBytes(sessionId + ':' + accountAddress + ':' + chainId))`. On decrypt, the same AAD must match — wrong-row attacks fail.
- **Key versioning**: introduce `A2A_SESSION_SECRET_V<N>` (e.g. V1, V2). Store the version in the sessions row as `key_version INTEGER NOT NULL DEFAULT 1`. The crypto module accepts a key map. Decrypt route loads the secret for the row's version. Adding V2 is hot-deployable; V1 sessions still work; new sessions use V2; eventually retire V1 rows.
- **Risk-tiered TTL**: at `apps/a2a-agent/src/routes/session.ts:66`, cap `durationSeconds` based on the requested grant scope's `maxRisk`. Suggested caps: low → 24h, medium → 8h, anything higher → ≤1h. Reject grants that exceed the cap.
- **Add `/session/revoke-all-by-account` POST endpoint** under `apps/a2a-agent/src/routes/session.ts`, gated by `requireSession` AND by ERC-1271 confirmation that the caller signed `revoke-all:${account}:${nonce}`. Mark every active session for that account as `status='revoked'`. Used in incident response.
- **Move `A2A_SESSION_SECRET` to a KMS** in production. Implementation: a tiny `apps/a2a-agent/src/lib/kms-client.ts` that fetches the key on startup, caches in process, refreshes on rotation signal. Pin the local-dev path to env-only.
- **Silence the diagnostic log** at `apps/a2a-agent/src/routes/session.ts:333-369`: move all the WebAuthn debug fields behind a `process.env.A2A_DEBUG_PASSKEY_REJECT === '1'` gate. Plain-language rejection in the response and audit table; no clientDataJSON in logs.

### Priority
**P0** — AAD binding is one line, prevents a post-DB-compromise pivot. Risk-tiered TTL and revoke-all-by-account are session-hygiene table stakes for langchain-host scenario.

---

## Area 11: Audit, Evidence, and Incident Response

### Current control
- `apps/a2a-agent/src/db/schema.ts:executionAudit` table — populated by every on-chain redeem path with rootGrantHash, sessionId, sessionPrincipal, a2aTaskId, mcpServer, mcpTool, mcpCallId, executionPath, target, selector, callDataHash, valueWei, txHash, userOpHash, status, errorReason.
- Person-mcp has a separate audit table (`apps/person-mcp/src/session-store/index.ts:appendAuditEntry`) — chained with `prevEntryHash`, used by wallet-action verifier.
- Audit denials happen in `onchain-redeem.ts:272-282`, `:294-302`, `:744-754`, etc. — but only for the redeem paths. The mcp-proxy path (`mcp-proxy.ts:181-195`) does NOT write to any audit table on denial.
- No unified correlation id across web → A2A → MCP.

### Gap
1. **No audit row for mcp-proxy denials.** When a bearer is missing/expired or the MCP returns 403 (e.g. tool-not-in-scope), `apps/a2a-agent/src/routes/mcp-proxy.ts:181-195` returns a JSON error and writes nothing. Repeated 403s from an attacker probing scopes are invisible.
2. **No correlation ids.** The closest thing is `mcpCallId` and `a2aTaskId` in `executionAudit`. Web action → A2A bearer → MCP call → on-chain tx is currently a 4-hop chain with no shared correlation id.
3. **Audit is append-only at the application level but NOT enforced at the DB level.** SQLite doesn't prevent `UPDATE`/`DELETE`; a compromised a2a-agent could rewrite history.
4. **Person-mcp's audit chain (`prevEntryHash`) only protects against silent tampering once an external party knows the latest hash.** If no one mirrors it, the chain rewrites trivially. No published anchor.

### Recommendation
- Define a shared TypeScript type `AuditEvent` in `packages/sdk/src/audit/types.ts` with fields: `correlationId`, `actor`, `subject`, `service`, `route`, `tool`, `sessionId`, `delegationHash`, `mcpCallId`, `decision: 'allow'|'deny'|'error'`, `reason`, `txHash`, `ts`. Every privilege-granting code path in web/A2A/MCP/hub emits one of these.
- Generate `correlationId` at the web edge (`apps/web/src/middleware.ts`), propagate as `X-SA-Correlation-Id` through `a2aFetch`, through inter-service HMAC calls (add to canonical), into MCP tool args. Every audit row in `executionAudit`, `appendAuditEntry`, and the new mcp-proxy audit table carries it.
- Add audit rows to mcp-proxy: extend the schema with a new `mcp_proxy_audit` table and write one row per inbound call at `apps/a2a-agent/src/routes/mcp-proxy.ts:181`. Status: `allowed`/`denied:<reason>`.
- **Append-only DB**: prefix audit tables with grants `REVOKE UPDATE, DELETE on executionAudit FROM <a2a-role>; GRANT INSERT, SELECT ONLY`. SQLite can't do roles, so the production target is Postgres with a least-privilege role for a2a-agent.
- **Anchor person-mcp's audit chain** — periodically (every N entries or every 5 minutes) write the latest `entryHash` to chain via a new `AuditAnchor` contract. Mirrors the prevEntryHash chain into an immutable substrate.

### Priority
**P1** — incident response is about provenance, and without correlation ids reconstructing an incident across services is hours of grep. Add it before LangChain lands, while the surfaces are still small.

---

## Area 12: Local and Dev Exceptions

### Current control
- A handful of routes are dev-only: `/api/test/geo-trust-e2e/route.ts:42-43` has `NODE_ENV === 'production'` gate.
- `scripts/check-no-bypass.sh:33-50` allowlist documents boot-seed, demo-seed, system-readiness, SSI clients as legitimate direct-MCP callers.

### Gap
1. **NO production guards on**: `/api/boot-seed`, `/api/dev-membership-check`, `/api/dev-patch-hannah`, `/api/ontology-sync/turtle` (already mentioned, Area 1).
2. **`apps/a2a-agent/src/routes/session.ts:78-89` runs `anvil_setBalance` on chain id 31337**. The chain-id check (`if config.CHAIN_ID === 31337`) is the only guard. If someone deploys a private chain that happens to use 31337 (the default for hardhat/anvil), this dev-only path would attempt to fund session keys on it. Defense in depth: gate on `process.env.NODE_ENV !== 'production'` too.
3. **No CI assertion that prod env can't enable demo paths.** The `pnpm check:bypass` lint exists; no equivalent for "no dev route is reachable in production NODE_ENV."

### Recommendation
- Create `apps/web/src/lib/env-guard.ts`:
  ```ts
  export function requireDevOr(condition: boolean): Response | null {
    if (process.env.NODE_ENV === 'production' && !condition) {
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
    }
    return null
  }
  ```
  Call from the top of every dev route. The list of dev routes is in `scripts/check-no-bypass.sh:33-50` allowlist — same list.
- Add `scripts/check-no-dev-exposure.sh`: greps for `/api/boot-seed|/api/dev-|/api/test|/api/ontology-sync` in `apps/web/src` and requires each route file to import `env-guard`. Wire into `package.json` as `pnpm check:dev-exposure`. Run in CI.
- Add `if (process.env.NODE_ENV === 'production') { … return 503 }` to `apps/a2a-agent/src/routes/session.ts:78` — defensive belt-and-suspenders for the anvil call.
- Document the exception inventory in `docs/architecture/02-dev-routes-inventory.md` (new). Each row: route → why dev-only → guard mechanism.

### Priority
**P0** — boot-seed in production is a code-red destruction primitive. One-line fixes.

---

## Area 13: Guardrails and Tests

### Current control
- `scripts/check-no-bypass.sh` greps for direct-MCP URL bypasses in `apps/web/src`.
- `requireSecret` validator at `apps/a2a-agent/src/config.ts:25-34` for `A2A_SESSION_SECRET`.
- No route-classification metadata or generated route inventory.

### Gap
1. **No test that proves host-spoofing alone can't authorize MCP tools.** The cross-agent comment at `require-session.ts:99-107` says "log only" — there should be an integration test that hits `https://orgB.agent.localhost/mcp/org/<dangerous-tool>` with userA's bearer and asserts 403.
2. **No service-auth coverage test.** No test that asserts `/session/:id/redeem-tx` returns 401 without HMAC headers.
3. **No tool-policy completeness test.** Nothing fails CI when a new tool is added to `TOOL_POLICIES` with `executionPath !== 'mcp-only'` but no selector mapping.
4. **No "no production secret-default" test.** The zero-default for `A2A_MASTER_EOA_PRIVATE_KEY` would silently boot.

### Recommendation
- Add `apps/a2a-agent/tests/host-isolation.test.ts`: spin up the hono app via `app.request`, fire a bearer-authenticated request with `Host: orgB.agent.localhost`, assert 403.
- Add `apps/a2a-agent/tests/service-auth-coverage.test.ts`: enumerate every route in `apps/a2a-agent/src/routes/onchain-redeem.ts`, hit with no HMAC headers, assert 401. Then with wrong service, assert 403. Then with skewed timestamp, assert 401. Then with mismatched session id in canonical, assert 401.
- Add `packages/sdk/tests/policy-completeness.test.ts`: walks `TOOL_POLICIES`, asserts every non-`mcp-only` entry has a non-empty selector mapping in the respective `_SELECTORS_BY_TOOL` table.
- Add a `pnpm check:secrets` script that scans the env files for default placeholders (`change-in-production`, `0x000…`, length < 16) and fails. Run in pre-deploy CI.
- Add a generated route inventory: `pnpm gen:route-inventory` walks `apps/web/src/app/api/`, `apps/a2a-agent/src/routes/`, `apps/*-mcp/src/`, emits `docs/architecture/route-inventory.json` with one row per route, including a `classification` field (`public|web-auth|service-auth|dev-only`). Pre-commit hook fails on uncommitted changes.

### Priority
**P1** — guardrails make findings stick. None of these are urgent on their own; together they're the difference between "secured this week" and "secured permanently."

---

# Threat-Ranked Top 10 P0 Changes

Ranked by **blast radius × likelihood × ease-of-fix**. Each lists the single named file/change.

1. **Fail-closed caveat enforcement in MCP delegation-token verifier** — `apps/person-mcp/src/auth/verify-delegation.ts:120-152` + `apps/org-mcp/src/auth/verify-delegation.ts:116-145`. Currently silent fail-open on unknown enforcers. Blast radius: every MCP tool call. Likelihood: certain once a new enforcer ships without a matching verifier update. Effort: ~30 lines + shared utility in `packages/sdk/src/policy/caveat-evaluator.ts`.

2. **Selector fail-open in on-chain redeem** — `apps/a2a-agent/src/routes/onchain-redeem.ts:292` (and the three sibling check lines at 589, 763, 1091). Change to `if (!allowedSelectors.has(selector))` and require non-empty selector list. Add `assertPolicyCompleteness()` at startup. Blast radius: any tool registration with a missing selector table accepts arbitrary calldata. Effort: ~20 lines.

3. **Session-store insert authentication + passkey re-verification** — `apps/a2a-agent/src/routes/session-store.ts:57-61` (insert handler) + `apps/person-mcp/src/auth/wallet-action-routes.ts:114-153`. Add `requireServiceAuth('web')` envelope and re-verify the passkey assertion server-side at insert time. Blast radius: full session-impersonation primitive. Effort: ~80 lines including new HMAC key env + web client signing.

4. **AAD-bind A2A session-package encryption** — `packages/sdk/src/crypto.ts:54-98` + `apps/a2a-agent/src/routes/session.ts:112-127` + `:398-409`. AAD = `keccak256(sessionId, accountAddress, chainId)`. Blast radius: post-DB-compromise pivot prevention. Effort: ~30 lines.

5. **Production guard on dev routes** — `apps/web/src/lib/env-guard.ts` (new) + applied to `boot-seed/route.ts`, `dev-membership-check/route.ts`, `dev-patch-hannah/route.ts`, `ontology-sync/turtle/route.ts`. Blast radius: data destruction. Effort: ~15 lines.

6. **WalletAction dispatch HMAC service-auth** — `apps/a2a-agent/src/routes/wallet-action.ts:25` + `apps/person-mcp/src/auth/dispatch-routes.ts:140`. Apply `requireInterServiceAuth()` at the a2a edge and bind action `audience.originService`. Blast radius: every WalletAction in the system. Effort: ~40 lines including web/A2A handshake.

7. **Hub-mcp and `/mcp/hub` proxy service-auth** — `apps/a2a-agent/src/routes/mcp-proxy.ts:162-179` + `apps/hub-mcp/src/index.ts:108-118`. Apply service-auth to `/admin/*`, `/debug/*`, `sync:*` tool routes. Blast radius: cache/projection corruption + PII exfil. Effort: ~30 lines.

8. **Cross-agent host enforcement (strict mode)** — `apps/a2a-agent/src/middleware/require-session.ts:91-107`. Add `A2A_HOST_ENFORCE=strict` config flag; in strict mode, fail closed on host/session-account mismatch except on explicit allow-list of cross-agent paths. Blast radius: cross-agent privilege escalation. Effort: ~25 lines.

9. **maxValueWei enforcement + `A2A_MASTER_EOA_PRIVATE_KEY` strength check** — `apps/a2a-agent/src/routes/onchain-redeem.ts` (each redeem handler) + `apps/a2a-agent/src/config.ts:25-34`. Enforce per-tool value cap; promote master EOA to `requireSecret`. Blast radius: unbounded asset movement + accidental zero-key boot. Effort: ~25 lines.

10. **Inter-service replay cache + route-family allowlist** — `apps/a2a-agent/src/auth/inter-service.ts:62-104` + new `apps/a2a-agent/src/db/schema.ts:inter_service_nonce` table + `ROUTE_FAMILY_ALLOWED` map. Blast radius: within-window replay + service-impersonating-service. Effort: ~60 lines.

---

# Cross-Cutting Observation: LangChain Inside A2A

The user's stated direction is to host LangChain orchestration inside `a2a-agent`. The current code makes a2a-agent the holder of:
- The user's encrypted session package (with the session private key + the full signed root delegation) — `apps/a2a-agent/src/db/schema.ts:sessions`.
- The master EOA private key (paymaster for stateful sessions) — `apps/a2a-agent/src/config.ts:70`.
- Every per-MCP HMAC key (`A2A_INTERSERVICE_HMAC_KEY_*`) — `apps/a2a-agent/.env:71-102`.
- Tool-executor private keys for sub-delegated paths — `apps/a2a-agent/src/lib/tool-executors.ts`.
- The decryption secret `A2A_SESSION_SECRET` — `apps/a2a-agent/src/config.ts:40`.

A compromised a2a-agent today can:
- Sign any WalletAction as any user (read session package → sign with sessionPrivateKey → POST to person-mcp `/wallet-action/dispatch` directly, even bypassing its own `/wallet-action` route).
- Redeem any session's root delegation on chain via the session's package + `redeemDelegation`.
- Mint sub-delegations for sensitive-tier tools.
- Impersonate any MCP to itself (HMAC keys are all local).
- Drain the master EOA's gas balance.

The defenses that bound this today are the **on-chain caveat enforcers** (Timestamp, AllowedTargets, AllowedMethods, Value, CallDataHash, TaskBinding), the **on-chain `isRevoked` check** at MCP verifier time, and the **per-tool target/selector allowlists** in `TOOL_POLICIES`. That is genuinely real defense — the agent can only act inside the user's signed scope.

The findings above tighten three of the four ways an attacker could expand outside the signed scope: (a) by smuggling unknown caveats past the off-chain verifier (Area 5 fail-closed), (b) by smuggling unknown selectors past the redeem gate (Area 9 selector fail-open), (c) by forging a session insert (Area 3 + 4 service-auth). The fourth way — exploiting the on-chain enforcers themselves — is a contracts-audit problem, out of scope for this hardening review but worth noting that the `AllowedTargetsEnforcer` / `AllowedMethodsEnforcer` ABI decoding is now safety-critical in a way the v1 contracts review may not have stressed.

The right architecture stance: **LangChain inside a2a-agent must run inside a sandbox sub-process that does NOT have access to `A2A_SESSION_SECRET`, the master EOA key, or the inter-service HMAC keys**. It can construct WalletAction request blobs, send them through a thin signing-only IPC to the privileged a2a process, and that process applies the same caveat/policy/replay gates that any external caller does. The signing/policy boundary becomes a process boundary, not just a function boundary. Plan this as the design of Phase 7 of the A2A+MCP consolidation; landing it before the LLM has rich tool access is the difference between bounded and unbounded LLM authority.
