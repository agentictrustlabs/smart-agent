# IA Route + Data-Plane Classification

> **Purpose.** Drives Production Hardening Areas 1 (Public Web Edge), 2 (A2A Ingress), 3 (Session-Store Bootstrap), 4 (WalletAction), 7 (Hub/GraphDB), 8 (SSI Endpoints), 9 (Chain RPC / On-Chain Redeem), and 12 (Local & Dev Exceptions).
>
> **Scope.** Every route registered in `apps/web`, `apps/a2a-agent`, and every MCP service (`person`, `org`, `people-group`, `hub`, `family`, `verifier`, `skill`, `geo`). Plus the data tiers that back them.
>
> **Methodology.** Routes were enumerated mechanically from `route.ts` files (Next.js) and Hono `.get/.post/.put/.delete/.patch/.route` calls (a2a + MCPs). Auth posture was determined by reading the route handlers for `getSession`, `requireSession`, `requireInterServiceAuth`, `isHostExempt`, etc. The `ALLOWLIST` in `scripts/check-no-bypass.sh` and `docs/architecture/01-web-a2a-mcp-flows.md` was cross-referenced for documented exceptions.

---

## Classification Taxonomy

These six labels are the entire vocabulary. Every route gets exactly one.

| Label              | Meaning                                                                                                                                                                                            | Route comment marker          |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `public`           | Browser/internet reachable, no caller identity required (or only optional). Includes UI page routes and **explicitly public protocol surfaces** (`/.well-known/*`, open SSI metadata, healthcheck). | `// route: public`            |
| `web-auth`         | Browser reachable; caller MUST present the web's authenticated cookie (`getSession()` / native session JWT). Authority is the web cookie + downstream A2A session.                                  | `// route: web-auth`          |
| `a2a-session`      | A2A edge route; caller MUST present a valid `Authorization: Bearer <a2a-session-token>` resolved by `requireSession`. Host-context middleware also enforces agent binding.                          | `// route: a2a-session`       |
| `wallet-action`    | Cryptographic authority is the signed `WalletActionV1` payload on the body; no bearer required. Re-verified by downstream MCP (person-mcp). Must be private at network layer.                       | `// route: wallet-action`     |
| `service-auth`     | Inter-service only. Caller MUST present `X-SA-Service` + HMAC (today) / signed-JWT or mTLS (target). Never reachable from the public internet.                                                       | `// route: service-auth`      |
| `dev-only`         | Must hard-error or 404 unless `NODE_ENV !== 'production'` (or `SMART_AGENT_ENV=dev|staging`). Includes boot-seed, demo-login, dev-patch, raw graph debug, fresh-start helpers, test E2E hooks.       | `// route: dev-only`          |
| `bootstrap`        | Special-case path used **before** a user/A2A session can exist (auth challenge, session-init, session-store insert, session-package). Must be private at network layer; rate-limited; replay-safe.   | `// route: bootstrap`         |

**Anti-classifications:** any route currently lacking enforcement at its declared tier (e.g., a `dev-only` route with no env guard, or a `service-auth` route accepting anonymous traffic) is flagged in §6 below.

---

## 1. Web Edge — `apps/web/src/app/api/**/route.ts`

Port: **3000** (Next.js). All routes are reachable from the browser unless explicitly gated.

### 1.1 Auth bootstrap & session

| Route | Method | Source | Class | Authority | Today's enforcement | Target | Notes |
|---|---|---|---|---|---|---|---|
| `/api/auth/passkey-challenge` | POST | `auth/passkey-challenge/route.ts:1` | `public` | none (issues JWT challenge) | none | rate-limit, replay-id | OK |
| `/api/auth/passkey-verify` | POST | `auth/passkey-verify/route.ts:1` | `public` | WebAuthn assertion + JWT challenge | JWT-pinned | rate-limit, lockout | OK |
| `/api/auth/passkey-signup` | POST | `auth/passkey-signup/route.ts:1` | `public` | WebAuthn registration | challenge JWT only | rate-limit | OK |
| `/api/auth/siwe-challenge` | POST | `auth/siwe-challenge/route.ts:1` | `public` | none (issues nonce) | none | rate-limit | OK |
| `/api/auth/siwe-verify` | POST | `auth/siwe-verify/route.ts:1` | `public` | SIWE signature + nonce JWT | JWT-pinned | rate-limit | OK |
| `/api/auth/google-start` | GET | `auth/google-start/route.ts:1` | `public` | OAuth2 state cookie | state token | rate-limit | OK |
| `/api/auth/google-callback` | GET | `auth/google-callback/route.ts:1` | `public` | Google id_token + state | cookie state check | OK | mints `localUserAccounts` row + cookie |
| `/api/auth/session` | GET | `auth/session/route.ts` | `web-auth` | cookie | `getSession()` | OK | introspection only |
| `/api/auth/logout` | POST | `auth/logout/route.ts` | `web-auth` | cookie | `getSession()` | OK | |
| `/api/auth/profile` | GET/PUT | `auth/profile/route.ts` | `web-auth` | cookie | `getSession()` | should proxy through A2A→MCP for writes | currently mixes web-only profile mirror |
| `/api/auth/check-agent-name` | GET | `auth/check-agent-name/route.ts:1` | `public` | none | none | rate-limit | OK |
| `/api/auth/ensure-user` | POST | `auth/ensure-user/route.ts:1` | `web-auth` | cookie | `getSession()` | OK | |
| `/api/auth/session-grant/start` | POST | `auth/session-grant/start/route.ts:1` | `web-auth` | cookie | `getSession()` | OK | |
| `/api/auth/session-grant/finalize` | POST | `auth/session-grant/finalize/route.ts:1` | `web-auth` | cookie | `getSession()` | OK | |
| `/api/demo-login` | POST | `demo-login/route.ts:1` | **`dev-only`** | demo-user table + CSRF origin check | CSRF-only | **add `NODE_ENV` guard** | **MISCLASSIFIED**: no production gate; deploys & funds smart accounts in DB |

### 1.2 A2A bootstrap proxies (web → A2A)

| Route | Method | Source | Class | Authority | Today | Target | Notes |
|---|---|---|---|---|---|---|---|
| `/api/a2a/auth/challenge` | POST | `a2a/auth/challenge/route.ts:1` | `web-auth` | cookie | `getSession()` | OK | proxies A2A `/auth/challenge` |
| `/api/a2a/auth/verify` | POST | `a2a/auth/verify/route.ts:1` | `web-auth` | cookie | `getSession()` | OK | proxies A2A `/auth/verify` |
| `/api/a2a/bootstrap` | * | `a2a/bootstrap/route.ts` | `web-auth` | cookie | `getSession()` | OK | |
| `/api/a2a/bootstrap/client` | POST | `a2a/bootstrap/client/route.ts:41` | `web-auth` | cookie | `getSession()` | OK | |
| `/api/a2a/bootstrap/complete` | POST | `a2a/bootstrap/complete/route.ts:16` | `web-auth` | cookie | `getSession()` | OK | hits A2A `/session/package` on bare host |
| `/api/a2a/session/init` | POST | `a2a/session/init/route.ts:11` | `web-auth` | cookie | `getSession()` | OK | |
| `/api/a2a/session/[id]` | GET/DELETE | `a2a/session/[id]/route.ts` | `web-auth` | cookie | `getSession()` | OK | |
| `/api/a2a/session-status` | GET | `a2a/session-status/route.ts:21` | `web-auth` | cookie | `getSession()` | OK | |
| `/api/a2a/session-audit` | GET | `a2a/session-audit/route.ts:15` | `web-auth` | cookie | `getSession()` | OK | |
| `/api/a2a/profile` | GET/PUT | `a2a/profile/route.ts:25` | `web-auth` | cookie | `getSession()` | OK | proxies A2A `/profile` |
| `/api/a2a/delegated-profile` | GET | `a2a/delegated-profile/route.ts:12` | `web-auth` | cookie | `getSession()` | OK | |
| `/api/a2a/message` | POST | `a2a/message/route.ts:11` | `web-auth` | cookie | `getSession()` | OK | |
| `/api/a2a/revoke` | POST | `a2a/revoke/route.ts` | `web-auth` | cookie | `getSession()` | OK | |
| `/api/a2a/user-info` | GET | `a2a/user-info/route.ts:11` | `web-auth` | cookie | `getSession()` | OK | |

### 1.3 Domain action routes (web → A2A → MCP)

These are thin server actions that all call `callMcp()` / `callHub()` / `callA2A()`.

| Route | Method | Source | Class | Authority | Today | Target | Notes |
|---|---|---|---|---|---|---|---|
| `/api/votes/cast` | POST | `votes/cast/route.ts` | `web-auth` | cookie + a2a session | `getSession()` inside action | OK | |
| `/api/votes/eligibility` | GET | `votes/eligibility/route.ts` | `web-auth` | cookie | OK | OK | |
| `/api/votes/my-vote` | GET | `votes/my-vote/route.ts` | `web-auth` | cookie | OK | OK | |
| `/api/votes/tally` | GET | `votes/tally/route.ts` | `public` (read-only aggregate) | none | none | rate-limit | OK |
| `/api/attestations/cast` | POST | `attestations/cast/route.ts` | `web-auth` | cookie | `getSession()` | OK | |
| `/api/attestations/list` | GET | `attestations/list/route.ts` | `web-auth` or `public` | varies | varies | classify per-handler | depends on whether it leaks orgs' private attestation refs |
| `/api/commitments/attest` | POST | `commitments/attest/route.ts:1` | `web-auth` | cookie | `getSession()` | OK | |
| `/api/commitments/release` | POST | `commitments/release/route.ts` | `web-auth` | cookie | `getSession()` | OK | |
| `/api/disbursements/claim` | POST | `disbursements/claim/route.ts` | `web-auth` | cookie | `getSession()` | OK | |
| `/api/disbursements/list` | GET | `disbursements/list/route.ts` | `web-auth` | cookie | `getSession()` | OK | |
| `/api/disbursements/mark-paid` | POST | `disbursements/mark-paid/route.ts` | `web-auth` | cookie | `getSession()` | OK | |
| `/api/pool-admin/mandate` | POST | `pool-admin/mandate/route.ts` | `web-auth` | cookie + steward delegation | action checks | OK | |
| `/api/pool-admin/stewards` | * | `pool-admin/stewards/route.ts` | `web-auth` | cookie + steward delegation | OK | OK | |
| `/api/round-admin/add-voter` | POST | `round-admin/add-voter/route.ts` | `web-auth` | cookie + admin delegation | OK | OK | |
| `/api/round-admin/config` | POST | `round-admin/config/route.ts` | `web-auth` | cookie + admin delegation | OK | OK | |
| `/api/round-admin/finalize` | POST | `round-admin/finalize/route.ts` | `web-auth` | cookie + admin delegation | OK | OK | |
| `/api/round-admin/lifecycle` | POST | `round-admin/lifecycle/route.ts` | `web-auth` | cookie + admin delegation | OK | OK | |
| `/api/treasury/fund` | POST | `treasury/fund/route.ts` | `web-auth` | cookie | `getSession()` | OK | |
| `/api/invites` | POST/GET | `invites/route.ts` | `web-auth` | cookie | `getSession()` | OK | |
| `/api/invites/[code]/accept` | POST | `invites/[code]/accept/route.ts` | `public` (code is the secret) | invite-code | code check | rate-limit + replay-check | OK |
| `/api/messages` | * | `messages/route.ts` | `web-auth` | cookie | `getSession()` | OK | |
| `/api/messages/[id]` | * | `messages/[id]/route.ts` | `web-auth` | cookie | `getSession()` | OK | |
| `/api/org-context` | * | `org-context/route.ts` | `web-auth` | cookie | `getSession()` | OK | |
| `/api/user-context` | * | `user-context/route.ts` | `web-auth` | cookie | `getSession()` | OK | |
| `/api/agents/can-manage` | GET | `agents/can-manage/route.ts` | `web-auth` | cookie | OK | OK | |
| `/api/agents/governance` | GET | `agents/governance/route.ts` | `web-auth` | cookie | OK | OK | |
| `/api/agents/people` | GET | `agents/people/route.ts` | `web-auth` | cookie | OK | OK | |
| `/api/naming/check` | GET | `naming/check/route.ts` | `public` | none | none | rate-limit | OK |

### 1.4 Explorer (public discovery surface)

| Route | Method | Source | Class | Authority | Today | Target | Notes |
|---|---|---|---|---|---|---|---|
| `/api/explorer/names` | GET | `explorer/names/route.ts` | `public` | none | none | rate-limit | OK — chain read |
| `/api/explorer/records` | GET | `explorer/records/route.ts` | `public` | none | none | rate-limit | OK — chain read |
| `/api/explorer/resolve` | GET | `explorer/resolve/route.ts` | `public` | none | none | rate-limit | OK |
| `/api/explorer/stats` | GET | `explorer/stats/route.ts` | `public` | none | none | rate-limit | OK |
| `/api/explorer/tree` | GET | `explorer/tree/route.ts` | `public` | none | none | rate-limit | OK |
| `/api/explorer/edit` | POST | `explorer/edit/route.ts:1` | **`dev-only`** *(currently mislabeled)* | none today | **none** | gate behind operator role or `NODE_ENV` | **MISCLASSIFIED**: writes `setStringProperty` / `updateAgentCore` on-chain with no caller auth |
| `/api/graph/route` (GET) | GET | `graph/route.ts:1` | `public` | none | none | rate-limit | OK — heavy chain reads |

### 1.5 Bootstrap / boot-seed / dev

| Route | Method | Source | Class | Authority | Today | Target | Notes |
|---|---|---|---|---|---|---|---|
| `/api/system-readiness` | GET | `system-readiness/route.ts:1` (allowlisted) | `public` | none | none | rate-limit | OK — liveness probe |
| `/api/boot-seed` | GET/POST | `boot-seed/route.ts:1` | **`dev-only`** | none | **no env gate** | add `NODE_ENV !== 'production'` | **MISCLASSIFIED**: writes chain state, deploys system agents |
| `/api/ontology-sync` | POST | `ontology-sync/route.ts:1` | `dev-only` *(soft)* | none | comment says "production callers should hit hub-mcp directly" | enforce in code | **MISCLASSIFIED**: triggers full GraphDB sync; needs operator auth or env gate |
| `/api/ontology-sync/turtle` | GET | `ontology-sync/turtle/route.ts:1` | `dev-only` *(soft)* | none | none | operator-auth or env gate | **MISCLASSIFIED**: dumps full agent graph turtle |
| `/api/dev-membership-check` | GET | `dev-membership-check/route.ts:1` | **`dev-only`** | none | **no env gate** | `NODE_ENV !== 'production'` | **MISCLASSIFIED**: name starts with `dev-` but anyone can hit it |
| `/api/dev-patch-hannah` | POST | `dev-patch-hannah/route.ts:1` | **`dev-only`** | none | **no env gate** | `NODE_ENV !== 'production'` | **MISCLASSIFIED**: writes on-chain edges for demo user "Hannah"; could be invoked against an arbitrary demo user in prod |
| `/api/test/geo-trust-e2e` | POST | `test/geo-trust-e2e/route.ts:1` | `dev-only` | session | `NODE_ENV === 'production'` 403 | OK | only correctly-gated dev route today |

### 1.6 Web summary

- **74 web API routes** total.
- **49** are correctly `web-auth` or `public`.
- **6** are mis-classified `dev-only` routes without production gates (`/api/boot-seed`, `/api/demo-login`, `/api/dev-membership-check`, `/api/dev-patch-hannah`, `/api/explorer/edit`, `/api/ontology-sync*`).
- The web app does NOT host any `service-auth` or `wallet-action` routes — those live downstream.

---

## 2. A2A Edge — `apps/a2a-agent`

Port: **3100** (Hono). Host-context middleware (`apps/a2a-agent/src/middleware/host-context.ts:83`) gates almost every path on a resolvable `<slug>.agent.localhost` subdomain. Exempt paths are enumerated in the source as `isHostExempt`.

### 2.1 Public / metadata

| Route | Method | Source | Class | Authority | Today | Target | Notes |
|---|---|---|---|---|---|---|---|
| `/health` | GET | `index.ts:27` | `public` | none | none | rate-limit | OK |
| `/.well-known/agent.json` | GET | `routes/a2a.ts:16` | `public` | none | none | rate-limit | OK; host-aware response |

### 2.2 Auth bootstrap (host-exempt)

| Route | Method | Source | Class | Authority | Today | Target | Notes |
|---|---|---|---|---|---|---|---|
| `/auth/challenge` | POST | `routes/auth.ts:20` | `bootstrap` | none → issues challenge | none | rate-limit | OK |
| `/auth/verify` | POST | `routes/auth.ts:55` | `bootstrap` | ERC-1271 signature on challenge | on-chain `isValidSignature` | rate-limit + per-account lockout | OK |
| `/session/init` | POST | `routes/session.ts:48` | `bootstrap` | none (issues session key + delegation challenge) | none | rate-limit, must not be internet-reachable (it deploys SessionAgentAccount + funds key) | **PARTIAL GAP**: `stateful=true` body funds an EOA on Anvil and writes on-chain — completely anonymous; rate-limited & private-net mandatory in prod |
| `/session/package` | POST | `routes/session.ts:254` | `bootstrap` | delegation signature (ERC-1271 on-chain) | on-chain verify | rate-limit | OK — signature IS the authority |

### 2.3 A2A user session plane (requires `requireSession`)

| Route | Method | Source | Class | Authority | Today | Target | Notes |
|---|---|---|---|---|---|---|---|
| `/session/:id` | GET | `routes/session.ts:415` | `a2a-session` | bearer | `requireSession` | OK | |
| `/session/:id` | DELETE | `routes/session.ts:440` | `a2a-session` | bearer | `requireSession` | OK | |
| `/session/:id/status` | GET | `routes/session-meta.ts:49` | `a2a-session` | session-id as secret | **NO `requireSession`** | add proper session bind or service-auth | **PARTIAL GAP**: comment claims "session id is the secret like cookies" but the route accepts ANY id with no token correlation; trivially enumerable |
| `/session/:id/audit` | GET | `routes/session-meta.ts:126` | `a2a-session` | session-id as secret | none | same as above | same gap |
| `/delegation/mint` | POST | `routes/delegation.ts:34` | `a2a-session` | bearer | `requireSession` | OK | |
| `/profile` | GET/PUT | `routes/profile.ts:198,208` | `a2a-session` | bearer | `requireSession` | OK | |
| `/profile/delegated` | GET | `routes/profile.ts:221` | `a2a-session` | bearer | `requireSession` | OK | |
| `/mcp/:server/:tool` | POST | `routes/mcp-proxy.ts:181` | `a2a-session` | bearer | `requireSession` | OK | host-context binds agent |
| `/mcp/hub/:tool` | POST | `routes/mcp-proxy.ts:162` | `public` *(system surface)* | none | **no auth** | classify per-tool: most hub tools should be `service-auth`; discovery reads `public` | **PARTIAL GAP**: bypasses `requireSession`; under `system.agent.localhost`. Allows unauthenticated callers to invoke any hub-mcp tool including `sync:*`. See §7. |
| `/a2a/:handle` | POST | `routes/a2a.ts:75` | `a2a-session` | bearer (TODO — not enforced today) | **no auth** | add `requireSession` + cross-agent audit | **PARTIAL GAP**: today only ACKs; if forward messaging is wired in, no auth gate exists |

### 2.4 Inter-service (MCP → A2A) chain redeem

All four are `requireInterServiceAuth` (HMAC). Host-exempt — see `INTER_SERVICE_PATH_SUFFIXES` in `middleware/host-context.ts:75-81`.

| Route | Method | Source | Class | Authority | Today | Target | Notes |
|---|---|---|---|---|---|---|---|
| `/session/:id/redeem-tx` | POST | `routes/onchain-redeem.ts:242` | `service-auth` | HMAC | `requireInterServiceAuth()` | rotate key + nonce window | OK |
| `/session/:id/redeem-with-chain` | POST | `routes/onchain-redeem.ts:534` | `service-auth` | HMAC | `requireInterServiceAuth()` | same | OK |
| `/session/:id/redeem-subdelegated` | POST | `routes/onchain-redeem.ts:707` | `service-auth` | HMAC | `requireInterServiceAuth()` | same | OK |
| `/session/:id/redeem-via-account` | POST | `routes/onchain-redeem.ts:1041` | `service-auth` | HMAC | `requireInterServiceAuth()` | same | OK |
| `/session/:id/deploy-agent` | POST | `routes/onchain-redeem.ts:376` | `service-auth` | HMAC | `requireInterServiceAuth()` | same | OK |

### 2.5 Session-store passthrough (host-exempt; Phase 2 of A2A+MCP consolidation)

All six are **currently unauthenticated** at the A2A edge — they forward verbatim to person-mcp on `PERSON_MCP_URL`. Source: `routes/session-store.ts`. Source-comment at `routes/session-store.ts:22-26` documents this intent.

| Route | Method | Source | Class | Authority | Today | Target | Notes |
|---|---|---|---|---|---|---|---|
| `/session-store/epoch/:account` | GET | `routes/session-store.ts:51` | `bootstrap` | none | none | private-net + service-auth | **GAP**: bootstrap path, but must be unreachable from public ingress in prod |
| `/session-store/insert` | POST | `routes/session-store.ts:57` | `bootstrap` | body is `SessionGrant` payload | none | replay-nonce + service-auth | **GAP**: anonymous endpoint that inserts session records |
| `/session-store/by-cookie/:cookieValue` | GET | `routes/session-store.ts:63` | `bootstrap` | cookie value is the secret | none | rate-limit + private-net | **PARTIAL GAP**: lookup-by-cookie is enumerable; should require service-auth from `a2a-agent` itself |
| `/session-store/active/:account` | GET | `routes/session-store.ts:69` | `service-auth` *(per hardening Area 3 P1)* | post-session | none | move to MCP tool + service-auth | **GAP**: should be A2A-session or MCP-tool, not raw passthrough |
| `/session-store/revoke` | POST | `routes/session-store.ts:75` | `service-auth` *(per Area 3 P1)* | post-session | none | move to MCP tool + service-auth | **GAP**: same |
| `/session-store/bump-epoch` | POST | `routes/session-store.ts:81` | `service-auth` *(per Area 3 P1)* | post-session | none | move to MCP tool + service-auth + replay-nonce | **GAP**: same |

### 2.6 WalletAction passthrough (host-exempt; Phase 3)

| Route | Method | Source | Class | Authority | Today | Target | Notes |
|---|---|---|---|---|---|---|---|
| `/wallet-action/dispatch` | POST | `routes/wallet-action.ts:25` | `wallet-action` | WalletActionV1 signature | none at edge; person-mcp verifies | **add service-auth + replay + audience binding** | **GAP per Area 4 P0**: signature is good, but the edge must not be public |

---

## 3. Person MCP — `apps/person-mcp`

Port: **3200**.

| Route | Method | Source | Class | Authority | Today | Target | Notes |
|---|---|---|---|---|---|---|---|
| `/health` | GET | `index.ts:185` | `public` *(should be private)* | none | none | service-auth or private net | **GAP**: MCP healthcheck publicly exposed |
| `/tools` | GET | `index.ts:180` | `service-auth` *(target)* | none today | none | service-auth | **GAP**: lists tool catalog |
| `/tools/:toolName` | POST | `index.ts:150` | `service-auth` *(target)*; per-tool authority is the delegation token | per-tool token check inside handler | per-tool `requireXPrincipal` inside the tool | service-auth at edge + per-tool token | **PARTIAL GAP per Area 5 P0**: a2a-agent is implicitly trusted at the network layer; production should require `X-SA-Service` header |
| `/.well-known/ssi-wallet.json` | GET | `index.ts:212` | `public` | none | none | rate-limit | OK |
| `/wallet/provision` | POST | `ssi/api/wallet.ts:31` | `wallet-action` *or* `service-auth` | downstream verifier | none at edge | rate-limit + service-auth | **GAP** |
| `/wallet/:principal` | GET | `ssi/api/wallet.ts:101` | `service-auth` | none today | none | service-auth | **GAP**: leaks per-principal wallet metadata |
| `/wallet/rotate-link-secret` | POST | `ssi/api/wallet.ts:126` | `wallet-action` | downstream verifier | none at edge | replay + service-auth | **GAP** |
| `/wallet/:principal/:context` | GET | `ssi/api/wallet.ts:162` | `service-auth` | none | none | service-auth | **GAP** |
| `/credentials/request` | POST | `ssi/api/credentials.ts:32` | `public` *(SSI protocol)* | issuer flow | none | challenge expiry + replay | OK per Area 8 |
| `/credentials/store` | POST | `ssi/api/credentials.ts:98` | `wallet-action` | session signer | none | rate-limit | OK target |
| `/credentials/:holderWalletId` | GET | `ssi/api/credentials.ts:166` | `service-auth` | none | none | service-auth | **GAP** |
| `/proofs/present` | POST | `ssi/api/proofs.ts:36` | `public` *(SSI protocol)* | OID4VP | none | rate-limit | OK |
| `/audit/:holderWalletId/credentials` | GET | `ssi/api/audit.ts:6` | `service-auth` | none | none | service-auth | **GAP** |
| `/oid4vp/preview` | POST | `ssi/api/oid4vp.ts:150` | `public` *(SSI protocol)* | request URI | none | rate-limit | OK |
| `/oid4vp/authorize` | POST | `ssi/api/oid4vp.ts:164` | `public` *(SSI protocol)* | OID4VP request | none | rate-limit + nonce | OK |
| `/wallet/match-against-public-set` | POST | `ssi/api/match-public-set.ts:62` | `service-auth` | none | none | service-auth | **GAP** |
| `/wallet-action/verify` | POST | `auth/wallet-action-routes.ts:38` | `service-auth` | downstream | none | service-auth | **GAP** |
| `/audit/append` | POST | `auth/wallet-action-routes.ts:67` | `service-auth` | none | none | service-auth + append-only DB | **GAP per Area 11 P1** |
| `/audit/log/:account` | GET | `auth/wallet-action-routes.ts:98` | `service-auth` | none | none | service-auth | **GAP** |
| `/session-store/epoch/:account` | GET | `auth/wallet-action-routes.ts:108` | `service-auth` | none | none | service-auth | **GAP**: same as A2A passthrough; this is the actual target |
| `/session-store/insert` | POST | `auth/wallet-action-routes.ts:114` | `service-auth` | none | none | service-auth | **GAP** |
| `/session-store/by-cookie/:cookieValue` | GET | `auth/wallet-action-routes.ts:155` | `service-auth` | none | none | service-auth | **GAP** |
| `/session-store/active/:account` | GET | `auth/wallet-action-routes.ts:161` | `service-auth` | none | none | service-auth | **GAP** |
| `/session-store/revoke` | POST | `auth/wallet-action-routes.ts:167` | `service-auth` | none | none | service-auth | **GAP** |
| `/session-store/bump-epoch` | POST | `auth/wallet-action-routes.ts:173` | `service-auth` | none | none | service-auth + replay | **GAP** |
| `/wallet-action/dispatch` | POST | `auth/dispatch-routes.ts:140` | `wallet-action` | WalletAction signature | signature verify in handler | replay + audience | OK at signature layer; gap is network exposure |

**Per Area 5/6 hardening targets**: every `/tools/*`, `/wallet/*`, `/audit/*`, `/credentials/:holderWalletId`, `/session-store/*`, `/wallet-action/*` route should require `X-SA-Service` (or equivalent JWT/mTLS) at the edge, with allowlist of caller services (`a2a-agent`, `org-mcp` only). Open SSI protocol surfaces (`/credentials/request`, `/credentials/store` via OID4VCI, `/proofs/present`, `/oid4vp/*`) stay `public` per Area 8.

---

## 4. Org MCP — `apps/org-mcp`

Port: configured per-instance (3401, 3402, …).

| Route | Method | Source | Class | Authority | Today | Target |
|---|---|---|---|---|---|---|
| `/health` | GET | `index.ts:78` | `service-auth` *(target)* | none | none | service-auth or private |
| `/.well-known/agent.json` | GET | `index.ts:87` | `public` | none | none | rate-limit |
| `/tools` | GET | `index.ts:101` | `service-auth` | none | none | service-auth |
| `/tools/:toolName` | POST | `index.ts:103` | `service-auth` *(edge)* + delegation token *(per-tool)* | per-tool `requireOrgPrincipal` | per-tool token | service-auth edge + token |
| `/credential/offer` | POST | `api/credential.ts:48` | `public` *(SSI)* | OID4VCI flow | none | rate-limit + replay |
| `/credential/issue` | POST | `api/credential.ts:81` | `public` *(SSI)* | OID4VCI flow | none | rate-limit + replay |
| `/.well-known/openid-credential-issuer` | GET | `api/oid4vci.ts:44` | `public` | none | none | rate-limit |
| `/oid4vci/offer` | POST | `api/oid4vci.ts:82` | `public` *(SSI)* | OID4VCI | none | rate-limit |
| `/oid4vci/offer-by-code/:code` | GET | `api/oid4vci.ts:125` | `public` *(SSI)* | one-time code | code-expiry + single-use | rate-limit |
| `/token` | POST | `api/oid4vci.ts:142` | `public` *(SSI)* | pre-auth code | grant verification | rate-limit |
| `/credential` | POST | `api/oid4vci.ts:180` | `public` *(SSI)* | OID4VCI access token | token verify | rate-limit |

**Pattern**: per-tool authority is the delegation token; `/tools/*` edge needs service-auth. SSI/OID4VCI routes remain `public` per Area 8 but need rate limits + abuse controls (issuer policy).

---

## 5. People-Group MCP — `apps/people-group-mcp`

Port: **3300**.

| Route | Method | Source | Class | Authority | Today | Target |
|---|---|---|---|---|---|---|
| `/health` | GET | `index.ts:56` | `service-auth` | none | none | private |
| `/.well-known/agent.json` | GET | `index.ts:64` | `public` | none | none | rate-limit |
| `/tools` | GET | `index.ts:73` | `service-auth` | none | none | service-auth |
| `/tools/:toolName` | POST | `index.ts:75` | `service-auth` (edge) + per-tool gate | per-tool `requirePrincipal*` / `requireCurator` | per-tool | service-auth edge |

---

## 6. Hub MCP — `apps/hub-mcp`

Port: **3900**. Source comment at `index.ts:13` says "Direct HTTP (port 3900) is dev-only / inter-MCP."

| Route | Method | Source | Class | Authority | Today | Target | Notes |
|---|---|---|---|---|---|---|---|
| `/health` | GET | `index.ts:105` | `service-auth` | none | none | private | gap |
| `/tools` | GET | `index.ts:104` | `service-auth` | none | none | service-auth | gap |
| `/tools/:toolName` | POST | `index.ts:86` | `service-auth` (`sync:*`) / `public` (`discovery:*` reads) | none | none | split: reads = public via A2A proxy, syncs = service-auth | **GAP per Area 7 P0**: all hub tools today are unauthenticated; the same endpoint hosts `sync:*` writes |
| `/admin/cache/clear` | POST | `index.ts:108` | `service-auth` | none | none | service-auth + operator-only | **GAP per Area 7 P0** |
| `/debug/agents-turtle` | GET | `index.ts:114` | `dev-only` | none | none | env gate + operator auth | **GAP per Area 7 P0** — dumps full agent KB as turtle |

The A2A proxy route `/mcp/hub/:tool` (see §2.3) currently routes ALL hub tools through with NO `requireSession`; this is the public reachability hole.

---

## 7. Family / Skill / Geo / Verifier MCPs

These are pure SSI issuer/verifier services per Area 8. All routes are intentionally `public` (open SSI protocol) **except** their `/tools/*` surfaces — but none of these four register a `/tools/*` HTTP endpoint, so there is no MCP-tool plane to harden. The remaining attack surface is rate-limiting + abuse control on the protocol routes.

### Family — `apps/family-mcp` (port 3500)

| Route | Method | Source | Class |
|---|---|---|---|
| `/health` | GET | `index.ts:13` | `service-auth` (target) |
| `/.well-known/agent.json` | GET | `index.ts:21` | `public` |
| `/credential/offer` | POST | `api/credential.ts:13` | `public` (SSI) |
| `/credential/issue` | POST | `api/credential.ts:29` | `public` (SSI) |
| `/verify/guardian/request` | GET | `api/verify.ts:22` | `public` (SSI) |
| `/verify/guardian/check` | POST | `api/verify.ts:34` | `public` (SSI) |

### Skill — `apps/skill-mcp` (port 3700)

| Route | Method | Source | Class |
|---|---|---|---|
| `/health` | GET | `index.ts:12` | `service-auth` (target) |
| `/.well-known/agent.json` | GET | `index.ts:20` | `public` |
| `/credential/offer` | POST | `api/credential.ts:20` | `public` (SSI) |
| `/credential/issue` | POST | `api/credential.ts:47` | `public` (SSI) |

### Geo — `apps/geo-mcp` (port 3600)

| Route | Method | Source | Class |
|---|---|---|---|
| `/health` | GET | `index.ts:12` | `service-auth` (target) |
| `/.well-known/agent.json` | GET | `index.ts:20` | `public` |
| `/credential/offer` | POST | `api/credential.ts:20` | `public` (SSI) |
| `/credential/issue` | POST | `api/credential.ts:46` | `public` (SSI) |

### Verifier — `apps/verifier-mcp` (port 3800)

| Route | Method | Source | Class |
|---|---|---|---|
| `/health` | GET | `index.ts:12` | `service-auth` (target) |
| `/.well-known/agent.json` | GET | `index.ts:19` | `public` |
| `/verify/:credentialType/request` | POST | `api/verify.ts:38` | `public` (SSI) |
| `/verify/:credentialType/check` | POST | `api/verify.ts:69` | `public` (SSI) |
| `/verify/specs` | GET | `api/verify.ts:102` | `public` |

**Target uniform action** per Area 8 P0: `/health` endpoints should be private-network-only (load balancer probe, not internet). All SSI routes need rate limits + challenge replay caches.

---

## 8. Data-Plane Classification

The cross-cutting question — *where authority lives, and how it crosses tier boundaries* — is the second half of route classification.

### 8.1 Storage tiers

| Tier | Write authority | Read authority | Source-of-truth for | Projection of | Can become authoritative? |
|---|---|---|---|---|---|
| **On-chain — `AgentNameRegistry`, `AgentAccountResolver`, `AgentAccountFactory`, `AgentRelationship`, `AgentAssertion`, `DelegationManager`, `PoolRegistry`, `FundRegistry`, `CommitmentRegistry`, `ProposalRegistry`, `PledgeRegistry`, `MatchInitiationRegistry`** | EOA-signed tx (deployer, demo user, or via `redeem-tx` from a2a-agent's session key) | Anyone (RPC) | All public agent identity, names, edges, assertions, delegations, marketplace state, governance state | (nothing — it IS the truth) | Yes — this is the only tier that holds public authority |
| **Person-MCP — SQLite (`apps/person-mcp/data/person-mcp.db`) + Askar (`apps/person-mcp/data/askar.db` for AnonCreds wallets)** | MCP tool, gated by delegation token (`requireXPrincipal`) | Owner cookie session + cross-principal delegation grantees | All private person data: profile, oikos, prayers, beliefs, intents (private), training progress, coaching notes, AnonCreds wallets, audit log, session-store | (none — owner-private) | No — owner-private by P1 |
| **Org-MCP — SQLite** | MCP tool, gated by `requireOrgPrincipal` token | Org admins + cross-delegation | Org private state: revenue reports, members (detached side), org intents/needs, work items, engagement provider state, disbursements, outcome attestations, marketplace cred issuance | (none — org-private) | No |
| **People-Group MCP — SQLite** | MCP tool, gated by curator allowlist (T0) or principal session (T2) | Mix: T0 reads = public; T2 reads = principal-only | People-group classifications, population estimates, reachedness assessments, audit log | (none — T2) / partial mirror to GraphDB (T0) | T0 can grow public projection; T2 stays private |
| **Hub-MCP cache + GraphDB read cache** | Hub-MCP `sync:*` tools, fed from on-chain | `discovery:*` tools (public reads) | (nothing) | On-chain authority | **NO** — Area 7 explicit: "Can GraphDB become authority? No." |
| **GraphDB (`SmartAgents` repo, named graphs: `data/onchain`, `data/people`, `agents`, `ontology`)** | Hub-MCP `kb-write-through` only (`apps/hub-mcp/src/lib/kb-write-through.ts`) | Discovery service (read-only) | (nothing) | On-chain + curated ontology | **NO** by IA P4 |
| **A2A-agent — SQLite (`apps/a2a-agent/data/a2a.db`)** | Auth handlers, session handlers, execution-audit writers | `requireSession` / `requireInterServiceAuth` | A2A-only state: challenges, sessions (encrypted packages), handles (slug→address), execution_audit (chain receipts) | (none — session-broker state) | No — broker, not domain |
| **Web SQL (`apps/web/data/smart-agent.db`)** | Web server actions only | Web `getSession()` | Auth/session bootstrap: `local_user_accounts` (demo-user fallback keys), recovery delegations, invites, training modules. Plus residual transitional tables (`intents`, `entitlements`, `commitment_thread_entries`, `fulfillment_work_items`, `role_assignments`, `engagement_*`) that should already be in org-mcp post-consolidation. | (none for auth tables) / (transitional shadow of org-mcp for the rest) | Auth tables stay; transitional tables should be deleted per IA P6 |

### 8.2 Where authority crosses tiers

| Crossing | Direction | Mechanism | Correct per IA P4? |
|---|---|---|---|
| Chain → GraphDB | one-way | Hub-MCP `sync:*` reads chain events, writes named graph `<…/data/onchain>` | Yes |
| MCP private row → on-chain assertion | one-way at row write time | MCP tool emits `AgentAssertion.makeAssertion` for `visibility=public` rows | Yes (P4) |
| On-chain → MCP | read-only | MCPs read chain for resolver / policy enforcement | Yes |
| GraphDB → web read | read-only via `DiscoveryService` | Web actions call `discovery:*` via hub | Yes |
| GraphDB → decision path | **must not happen** | — | GraphDB is projection; if any code reads GraphDB and then writes on-chain or MCP, that violates P4. **No violations were found in route survey**, but worth a coverage test |
| Web SQL → MCP | should be deleted | transitional tables (`intents` etc.) still exist in web schema | **Violation in flight** — per `12-person-data-management.md` and `11-org-data-management.md`, these are to be removed; `fresh-start.sh` reseeds without them. Today's row counts may be zero, but the tables remain. |
| MCP → A2A redeem | one-way | HMAC `requireInterServiceAuth` | Yes |
| Session-store reads/writes | A2A passthrough → person-mcp | Unauthenticated network forward | **Violation in flight** — Area 3 hardening required |

### 8.3 Where should langchain-agent memory + knowledge stores live?

Stated direction: put **langchain orchestration inside a2a-agent**. This is correct for the *control plane* (a2a is already the session/delegation broker, and langchain "decides what tools to call" — those tools are MCP tools).

It is **wrong** for the *data plane*. Langchain's two persistent data stores are:

1. **Agent memory** (conversation history, scratchpad, per-task working memory)
2. **Agent knowledge** (vector index, RAG corpus, retrieved-document cache, structured tool memory)

If those sit inside `apps/a2a-agent`, the a2a-agent SQLite becomes a data-rich store and conflates two authorities that must stay separate:

- session/delegation custody (the current `sessions` table holds encrypted session packages),
- agent cognition (memory + knowledge).

Concrete risks:

- A leak of the a2a-agent DB now leaks both active session packages and a transcript of the agent's reasoning + every retrieved private document.
- Memory ownership becomes ambiguous: whose data is it? The user (then it belongs in person-mcp) or the org/team (then in org-mcp)?
- Backup/retention policies for sessions are short (TTL ≤ 24h per Area 10 P0) but for knowledge are long; one DB can't satisfy both.

**Recommended placement**:

| Data | Home (new) | Why |
|---|---|---|
| Per-user agent conversation memory | **person-mcp** (`agent_memory_threads`, `agent_memory_messages`) | Already the home of `chat_threads` + `chat_messages` for the human-side chat. Same owner-routing rule (P1). Agent memory is private to the human principal. |
| Per-org agent conversation memory | **org-mcp** (`org_agent_memory_*`) | Org-owned interactions (e.g., the org's AI working on org tasks). |
| Per-team / shared agent knowledge base (vector indices, retrieved corpora) | **A new MCP service**: `agent-knowledge-mcp` (port 3950) | A knowledge index has its own access-control story (who can query, who can ingest, where the embeddings live). It should NOT be a table inside the session broker. It can live alongside hub-mcp as a system service if knowledge is "shared catalog"; for per-principal knowledge it follows owner-routing into person-mcp/org-mcp. |
| Tool-result cache (idempotency keys for tool calls, retry state) | **a2a-agent** (broker scope) | This is broker state, not knowledge — it belongs here. Bound to session TTL. |
| Long-term agent profile / "core" (a2a-agent's `.well-known/agent.json` metadata, capabilities, supported tools) | **a2a-agent** + chain (`AgentAssertion`) | Already correct. |

a2a-agent then stays a thin orchestrator: it loads memory from `person-mcp.agent_memory_*` via MCP tool calls (gated by the same delegation that gates `chat_messages`), runs langchain steps, calls MCP tools, persists the new memory back. The langchain "decision" happens in-process; the "data" lives where its authority lives.

The hardening payoff: Area 10 (session package custody) remains analyzable in isolation, and Area 5 (MCP tool plane) automatically covers agent memory because it's just another MCP tool.

---

## 9. Mis-classified Routes (Action List)

Routes currently reachable from the public internet that should NOT be, **or** lack production gating, **or** are inconsistently classified across the system:

### Critical (Phase 1A — close before any production rollout)

1. **`/api/boot-seed`** (web) — `dev-only`. No env gate. Deploys system agents on-chain. → Add `NODE_ENV !== 'production'` guard or operator-token check.
2. **`/api/demo-login`** (web) — `dev-only`. CSRF-only. Mints sessions for demo identities. → Same guard.
3. **`/api/dev-membership-check`** (web) — `dev-only`. Diagnostic chain reads scoped to "catalyst hub". Name suggests dev, but anyone can hit it. → Same guard.
4. **`/api/dev-patch-hannah`** (web) — `dev-only`. **Writes on-chain edges**. → Same guard.
5. **`/api/explorer/edit`** (web) — currently `public` by default; performs `setStringProperty` / `updateAgentCore` **on-chain** with NO caller authentication. → Either `web-auth` + owner-of-agent check, or `dev-only`. Recommend `web-auth` with explicit owner-of-agent gate.
6. **`/api/ontology-sync`** and **`/api/ontology-sync/turtle`** (web) — `dev-only` per source comment but no enforcement. → Operator-auth or `NODE_ENV` gate.
7. **`/debug/agents-turtle`** (hub-mcp) — unauthenticated raw KB dump on a dev-only port. → Env gate + don't expose port 3900 publicly. (Already true at the deployment layer in dev, but no code guard.)
8. **`/admin/cache/clear`** (hub-mcp) — unauthenticated. → service-auth.

### High (Phase 1A/1B)

9. **`/mcp/hub/:tool`** (a2a-agent) — bypasses `requireSession`. Today this means anyone hitting `system.agent.localhost:3100` can invoke `sync:*` or `discovery:*` hub tools unauthenticated. → Split: `discovery:*` reads stay open via this path (rate-limited); `sync:*` writes require service-auth from a2a-agent operator service.
10. **`/session-store/*`** (a2a-agent passthrough + person-mcp target) — six routes, all unauthenticated at network layer. Bootstrap tier OK; post-session tier (`active`, `revoke`, `bump-epoch`) should be MCP-tool or service-auth-only. → Implement Area 3 P0+P1 in lockstep.
11. **`/wallet-action/dispatch`** (a2a-agent + person-mcp) — anonymous network reach. Signature is good; network should still be private. → Area 4 P0.
12. **`/session/:id/status`** and **`/session/:id/audit`** (a2a-agent session-meta) — comment claims session-id is the secret, but routes accept any id with NO bearer correlation. Trivially enumerable if ids leak. → Require `requireSession` with id-binding check, OR service-auth.
13. **`/session/init`** with `stateful=true` (a2a-agent) — anonymous endpoint that deploys a SessionAgentAccount and (in dev) funds the key with Anvil ETH. Production must require service-auth from the web edge or rate-limit aggressively. → Area 3 P0.
14. **Every `/tools/*` endpoint on every MCP** — implicit network trust today. → Add `X-SA-Service` envelope (Area 5/6 P0).
15. **Every `/health` endpoint on every MCP** — publicly exposed. → Private-network or service-auth.

### Inconsistency findings

- `/mcp/hub/*` skips `requireSession` while `/mcp/:server/*` requires it. Justified for `discovery:*` reads, **not** for `sync:*` writes. Today the same path handles both → split route groups (Area 7 P1).
- `/session-store/*` is exempt from host-context at the A2A edge (correct for bootstrap) but the same paths in person-mcp accept the same anonymous traffic (`apps/person-mcp/src/auth/wallet-action-routes.ts:108-179`). No defense-in-depth between A2A and person-mcp.
- `/wallet-action/dispatch` is similarly exempt at both layers — signature is the only check.
- `requireInterServiceAuth` is well-applied to `/session/:id/redeem-*` and `/session/:id/deploy-agent` on a2a-agent. It is **not** applied to `/session-store/*` or `/wallet-action/dispatch` even though Area 3/4 P0 calls for it. Inconsistent enforcement of the same security tier.
- A2A's `requireSession` middleware (`apps/a2a-agent/src/middleware/require-session.ts:99-107`) explicitly **does not enforce** host/session agent address match; it only logs cross-agent calls. This is correct for the "user acts on behalf of org" pattern, but it means host-based identity assertions for tools are advisory only. Area 2 P1 requires a test proving host spoofing alone cannot authorize MCP tools — that test should pass today because MCP delegation tokens are bound by audience and account, not host. Add the test.

---

## 10. Route-Comment Naming Convention (Area 1 P1)

Per the hardening plan, every API route file must carry a single-line classification comment near the top of the file. Recommended form:

```ts
// route: <class>   // <one-line rationale or guard>
```

Examples:

```ts
// apps/web/src/app/api/votes/cast/route.ts
// route: web-auth  // user-action; getSession() then callMcp('org', 'vote:cast', …)
```

```ts
// apps/web/src/app/api/boot-seed/route.ts
// route: dev-only  // NODE_ENV !== 'production' guard; deploys system agents
```

```ts
// apps/a2a-agent/src/routes/onchain-redeem.ts (each handler)
// route: service-auth  // requireInterServiceAuth(); HMAC from MCP, host-exempt
```

```ts
// apps/person-mcp/src/auth/dispatch-routes.ts
// route: wallet-action  // WalletActionV1 signature verify; network must be private
```

Then add a CI check (Area 1 P2 / Area 13 P1) that:

1. Walks every `route.ts` in `apps/web/src/app/api/**` and every Hono route file in `apps/a2a-agent/src/routes/**` + each `apps/*-mcp/src/index.ts` + `apps/*-mcp/src/api/**`.
2. Asserts a `// route: <class>` comment is present.
3. Asserts the class is one of the seven taxonomy labels.
4. For `dev-only` routes: asserts a `process.env.NODE_ENV` or `SMART_AGENT_ENV` guard is present in the same file.
5. For `service-auth` routes: asserts `requireInterServiceAuth()` (or future replacement) is referenced.
6. For `web-auth` routes: asserts `getSession()` is referenced.

This is the inverse of `check-no-bypass.sh` — instead of forbidding a substring, it requires one. Together the two scripts make Area 13's "every critical boundary gets a guardrail" enforceable.

---

## 11. Summary Counts

| Surface | Routes enumerated | Public | Web-auth | A2A-session | Wallet-action | Service-auth | Dev-only | Bootstrap |
|---|---|---|---|---|---|---|---|---|
| apps/web (`/api/*`) | 74 | 11 | 56 | — | — | — | 7 | — |
| apps/a2a-agent | 22 | 2 | — | 11 | 1 | 5 | — | 4 (incl. 6 session-store + 1 wallet-action passthroughs that share bootstrap class today) |
| apps/person-mcp | 25 | 6 | — | — | 2 | 16 *(target)* | — | — |
| apps/org-mcp | 11 | 8 | — | — | — | 3 *(target)* | — | — |
| apps/people-group-mcp | 4 | 1 | — | — | — | 3 *(target)* | — | — |
| apps/hub-mcp | 5 | 0 | — | — | — | 4 *(target)* | 1 | — |
| family/skill/geo/verifier MCPs | 17 | 13 | — | — | — | 4 (health) *(target)* | — | — |
| **Total** | **158** | **41** | **56** | **11** | **3** | **35 (target)** | **8** | **4** |

The **35 service-auth routes** are the work item: today most accept anonymous network traffic and rely on either downstream cryptographic verification (signature, delegation token) or naïve network locality. Standardizing the service-auth envelope per Area 6 P0 closes 35 routes' enforcement gap in one stroke.

The **8 dev-only routes** are the easiest immediate win: a single CI check + 8 file edits close Area 12 P0.

The **3 wallet-action + 4 bootstrap routes** are the hardest to defend on review because they are deliberately unauthenticated at the network layer. The hardening recipe per Area 3/4: network-private + service-auth from the front-door service + replay-nonce + audience binding. Those four properties together form the answer to "why is this OK that the route accepts unauthenticated traffic?"
