# Smart Agent Production Hardening — Phase 1 Plan

**Synthesis date**: 2026-05-16  
**Source doc**: `docs/architecture/production-hardening-source.md`  
**Inputs**: Security, Information Architect, Developer, Tester+Documentarian reviews under `/home/barb/smart-agent/output/{security-hardening-review,ia-route-classification,developer-current-state,tester-guardrails-framework}.md`

## 0. TL;DR

The 13-area framing is sound and the codebase backs it up. **Two present-day vulnerabilities** must be fixed THIS WEEK before any larger work — they're already-shipped bugs that silently fail open. After that, Phase 1A–1E sequences cleanly into a ~6–10 week initiative; the long pole is generating the route inventory + the standard service-auth envelope, both of which unlock everything else. The architecture is ready to host langchain orchestration **only if the langchain runtime sits in a sandbox sub-process** that has no direct access to the session table, master EOA, or HMAC keys — making the privilege boundary a process boundary, not a function boundary.

## 1. CRITICAL — fix this week (pre-Phase-1)

These are not architecture concerns. They are **exploitable, already-shipped bugs** in the post-consolidation code. Land before anything else.

### 1.1 MCP delegation-token verifier silently fails open on unknown caveats
**Files**: `apps/person-mcp/src/auth/verify-delegation.ts:120-152`, `apps/org-mcp/src/auth/verify-delegation.ts:116-145`  
**Bug**: The caveat-check loop only inspects Timestamp and McpToolScope enforcers. AllowedTargets, AllowedMethods, Value, TaskBinding, CallDataHash all fall through silently. For `mcp-only` tools that never hit the on-chain redeem path, the user's caveat-scoped delegation is effectively unenforced.  
**Fix**: Build `packages/sdk/src/policy/caveat-evaluator.ts` with a fail-closed dispatcher — unknown enforcer ⇒ reject. Both verifiers call it. ~30 lines.

### 1.2 `policyAllowedSelectors` empty-set lets any selector through
**Files**: `apps/a2a-agent/src/routes/onchain-redeem.ts:292, 589, 763, 1091`  
**Bug**: Guard reads `if (allowedSelectors.size > 0 && !allowedSelectors.has(selector))`. Empty set short-circuits → arbitrary calldata permitted. A new tool registered without a selector mapping accepts anything.  
**Fix**: Change to `if (!allowedSelectors.has(selector))` and add `assertPolicyCompleteness()` at startup that fails-fast if any policy lacks a selector table. ~20 lines.

### 1.3 Session-store insert is fully unauthenticated end-to-end
**Files**: `apps/a2a-agent/src/routes/session-store.ts:57-61`, `apps/person-mcp/src/auth/wallet-action-routes.ts:114-153`  
**Bug**: Anyone on the network can `POST /session-store/insert` with a fabricated SessionRecord whose `smartAccountAddress` is a known victim and `sessionSignerAddress` is attacker-controlled. The downstream verifier recovers the attacker's key as the "signed" actor. Full session-impersonation primitive. Similar attacks: `/session-store/revoke` (DoS), `/session-store/bump-epoch` (mass DoS).  
**Fix**: Add `requireServiceAuth('web')` envelope on the insert path (new HMAC key `WEB_TO_A2A_HMAC_KEY`). On insert, person-mcp re-verifies the passkey assertion via ERC-1271 before writing. Migrate `active`, `revoke`, `bump-epoch` to MCP tools requiring a delegation token. ~80 lines.

### 1.4 Production gate on dev/admin routes
**Files**: `apps/web/src/app/api/boot-seed/route.ts`, `dev-membership-check/route.ts`, `dev-patch-hannah/route.ts`, `ontology-sync/turtle/route.ts`, `explorer/edit/route.ts`  
**Bug**: All return 200 in any environment. `/api/explorer/edit` writes on-chain agent properties with **zero caller auth**. `/api/boot-seed` would re-seed the demo community on a prod hit. Only `/api/test/geo-trust-e2e` is gated today.  
**Fix**: New `apps/web/src/lib/env-guard.ts` exporting `requireDev()` returning 404 in production. Apply at the top of each route. ~15 lines.

### 1.5 The other quick wins (each <1 day, sequenced for week 1)
| # | What | Files | Lines |
|---|---|---|---|
| 5 | `pnpm check:bypass` in CI | `.github/workflows/ci.yml` | <10 |
| 6 | `policy.maxValueWei` actually enforced | `onchain-redeem.ts` (5 handlers) | ~15 |
| 7 | Cap `durationSeconds` on `/session/init` | `apps/a2a-agent/src/routes/session.ts` | <10 |
| 8 | AAD-bind `encryptPayload` | `packages/sdk/src/crypto.ts` + callers | ~30 |
| 9 | Body-size + per-IP rate limit on a2a + web auth routes | `apps/a2a-agent/src/index.ts`, `apps/web/src/middleware.ts` | ~20 |
| 10 | Replay-nonce cache in `requireInterServiceAuth` | `apps/a2a-agent/src/auth/inter-service.ts` + new schema table | ~60 |

**Week-1 estimate**: 4-5 engineering days. After this, the architecture is no longer trivially exploitable; everything else is depth-in-defense.

## 2. The 13-area plan, codebase-grounded

The reviewers agreed on the area-level diagnosis. Density of issues per area:

| Area | Status | Top finding | Phase |
|---|---|---|---|
| 1 Public web edge | 🟡 partial | 5 dev routes ungated; substring origin check | 1A |
| 2 A2A ingress + host | 🟡 partial | Cross-agent host check is log-only (`require-session.ts:99-107`); no body limit | 1A |
| 3 Session-store bootstrap | ❌ open | Insert/revoke/bump-epoch all unauthenticated; full session-impersonation primitive | 1A (P0) |
| 4 WalletAction dispatch | ❌ open | A2A passthrough unauthenticated; no nonce/expiry/audience binding | 1A (P0) |
| 5 MCP tool plane | 🟡 partial | A2A→MCP `/tools/*` direction unsigned; caveat fail-open (§1.1) | 1B |
| 6 Service-to-service auth | 🟡 partial | MCP→A2A redeem ✅ HMAC; A2A→MCP ❌; no replay cache; no key rotation | 1B |
| 7 Hub-mcp + GraphDB | 🟡 partial | `/mcp/hub/:tool` bypasses requireSession; `/admin/*` `/debug/*` unauthenticated | 1B |
| 8 SSI issuer/verifier | 🤔 unaudited | Open protocol endpoints inventoried (17 routes); rate limits + audit not surveyed | 1B |
| 9 Chain RPC + redeem | 🟡 partial | Selector fail-open (§1.2); `maxValueWei` dead; unknown-enforcer not allowlisted | 1A+1C |
| 10 Session package custody | 🟡 partial | No AAD; master EOA can default to zero key; no rotation | 1A+1C |
| 11 Audit | 🟡 partial | `executionAudit` covers redeem; denial path uneven; no cross-service correlation id | 1D |
| 12 Local/dev exceptions | ❌ open | One gated route out of ~8; no docs table | 1A |
| 13 Guardrails | 🟢 some | `check-no-bypass.sh` ✅; need 17 more (route-class lint, fail-closed tests, etc.) | 1E (continuous) |

## 3. Phase 1A → 1E sequenced plan

Dependency order matters — the parser + service-auth envelope unlock everything that comes after.

### Phase 1A — Close Public Exposure Risks (weeks 1-2; ~6 dev-days)
**Goal**: nothing reachable from the public internet that shouldn't be.

1. All 10 critical-week fixes from §1.
2. Build the **route classification comment parser** (`scripts/lib/route-classification-parser.ts` using `ts-morph`) — Tester+Documentarian Group 1 #2. This is the linchpin for everything downstream.
3. Add `@sa-route` / `@sa-auth` / `@sa-rate-limit` / `@sa-prod-gate` JSDoc tags + the lint that enforces them on every route file. (Spec in `output/tester-guardrails-framework.md` §"Route Classification Comment Spec".)
4. CI: `check-no-bypass.sh` + new `check-route-classification` (every route handler has the JSDoc tags); fail the build on missing.
5. Production-gate integration test — spin a second Next.js on port 3101 with `NODE_ENV=production`, assert every `@sa-prod-gate dev` route returns 404. Tester Group 2 #5.

**Exit criterion**: every route file in `apps/web/src/app/api/**` and `apps/a2a-agent/src/routes/**` has a classification comment; CI fails on missing or mismatched; dev routes 404 in production.

### Phase 1B — Standardize Service Auth (weeks 3-5; ~10 dev-days)
**Goal**: every internal route requires a verifiable service identity.

1. **Pick the envelope** (resolved below in §5): HMAC with key-id + nonce + 60s window, signed over `${ts}|${nonce}|${path}|${sha256(body)}`. Same scheme as today's `requireInterServiceAuth`, extended with key-id + nonce table.
2. **Add `WEB_TO_A2A_HMAC_KEY`** for web→A2A bootstrap calls (session-store, wallet-action). Symmetric to the existing per-MCP keys.
3. **Apply service-auth to**:
   - `apps/a2a-agent/src/routes/session-store.ts` (all routes) — replace today's pure passthrough
   - `apps/a2a-agent/src/routes/wallet-action.ts` — bind `audience.originService`
   - `apps/a2a-agent/src/routes/mcp-proxy.ts` `/hub/:tool` route — replace the system-slug bypass
   - `apps/hub-mcp/src/index.ts` `/admin/*`, `/debug/*`, `sync:*` tools
   - All `apps/*-mcp/src/index.ts` `/tools/*` direction (inbound from a2a-agent)
4. **Replay-nonce cache** — new `inter_service_nonce` table; eviction TTL = 2× clock-skew window.
5. **Service allowlist per route family** — `ROUTE_FAMILY_ALLOWED = { 'mcp.tools.person': ['a2a-agent'], 'session-store.bootstrap': ['web'], ... }`.
6. Tester Group 2 #1 + #2 (service-auth-required test, replay rejection test) shipped alongside.

**Exit criterion**: every route in IA's "service-auth" or "bootstrap" classification has middleware mounted; integration tests prove `401 + audit-deny` on unsigned/replayed calls; `pnpm check:service-auth-coverage` lints that no route file in that classification is missing the middleware.

### Phase 1C — Harden Delegated Execution (weeks 4-6; runs partly parallel to 1B; ~8 dev-days)
**Goal**: caveat enforcement is fail-closed end-to-end.

1. Build `packages/sdk/src/policy/caveat-evaluator.ts` (the off-chain twin of the on-chain enforcers) and use it from both MCP verifiers and `onchain-redeem.ts`. Single dispatch table; unknown enforcer ⇒ reject.
2. Selector + target + value + timestamp + tool-scope checks fail-closed in every redeem handler. Tester Group 1 #1.6 Foundry invariants for the on-chain side; Group 2 #3 caveat-matrix tests for the off-chain side.
3. **Short TTLs by risk tier** — extend `ToolPolicy` with `defaultTtlSec` per `riskTier`; clamp `/session/init`'s `durationSeconds` accordingly.
4. **WalletAction nonce + JTI cache** alongside the inter-service nonce cache.

**Exit criterion**: caveat matrix passes for every (tool × allowed-targets × allowed-methods × value × ttl) cell; Foundry invariants pass.

### Phase 1D — Make It Auditable (weeks 6-7; ~4 dev-days)
**Goal**: every authority-bearing action is correlatable.

1. Unified audit schema — extend `apps/a2a-agent/src/db/schema.ts:executionAudit` to be the single sink; add `correlationId`, `service`, `decision`, `reason`. Mirror in person-mcp / org-mcp via a thin `audit_event` table fed by the shared middleware.
2. **Generate correlation id at the web request edge**, propagate via `X-SA-Correlation-Id` header through web→A2A→MCP→chain.
3. **Audit denial parity** — every middleware that returns 401/403/400 writes a row.
4. Append-only at the app level — Drizzle `INSERT` only; no DELETE/UPDATE in code paths.

**Exit criterion**: correlation-id flows visible in `executionAudit` joined to `audit_event`; denial completeness test passes (Tester Group 2 #4); zero update/delete statements on audit tables outside admin scripts.

### Phase 1E — Prove The Boundary (weeks 7-10; ~5 dev-days, mostly continuous)
**Goal**: drift is impossible without a failing test.

1. **Route inventory generator** — `scripts/generate-route-inventory.ts` uses the parser to emit `docs/architecture/route-inventory.md`. CI fails if committed file diverges from generated.
2. Deployment manifest lint — `scripts/check-ingress-exposure.ts` walks compose/k8s and asserts private-classification routes aren't on a public listener.
3. Chain-vs-audit reconciliation batch — `scripts/audit-reconcile.ts`.
4. Denial-rate alarm + replay-cache health probe (observability, low priority).

**Exit criterion**: `pnpm check:all` runs full Group 1+3 statics in <60s; CI runs Group 2 integration tests against fresh-start in <10 min; `docs/architecture/route-inventory.md` is current; production-config CI fails on demo-key paths.

**Total budget**: ~33 engineering days across all phases. Tester estimated 22 days for the guardrail layer; that's a subset that runs alongside.

## 4. The langchain-inside-a2a architecture decision

The user's strategic goal: host langchain orchestration (planning, knowledge, memory) inside `a2a-agent` so the agent can take rich actions on the user's behalf, **shielded from direct MCP resource management**. Two architectural constraints emerged consistently from the reviewers:

### 4.1 The process boundary
A2A-agent today holds: session private keys (encrypted), master EOA, all per-MCP HMAC keys, session-package decryption secret, tool-executor keys. A prompt-injection / jailbreak of an LLM running in the same process reaches all of these.

**Decision**: langchain orchestration runs in a **sandbox sub-process** with no environment access to those secrets. The privileged a2a-process exposes a thin, audited internal IPC (HTTP over Unix socket or named pipe) that the orchestrator calls; the orchestrator can request "redeem this tool", "ask this MCP", but cannot read the session table or sign arbitrary calldata. Privilege boundary = process boundary, not function boundary.

```
┌─── a2a-process (privileged) ───┐    ┌─── orchestrator-process (sandbox) ───┐
│  session table                 │    │  langchain runtime                   │
│  master EOA / HMAC keys        │◄───┤  no env access to secrets            │
│  TOOL_POLICIES (canonical)     │ ipc│  knows the tool registry             │
│  redeem handlers + caveats     │    │  drives planning loops               │
└────────────────────────────────┘    └──────────────────────────────────────┘
```

### 4.2 The data boundary
A2A-agent should NOT become a data-rich service. Memory and knowledge are user/org data — they belong in MCPs (single source of truth, projection model preserved).

**Decision**:
- Per-user agent memory + chat history → **`person-mcp`** (alongside the existing `chat_threads`/`chat_messages` tables).
- Per-org agent memory + shared org knowledge → **`org-mcp`**.
- Cross-org shared knowledge graph / vector indexes → **new `agent-knowledge-mcp` service** (Phase 2 of this initiative; not part of Phase 1).
- A2A-agent keeps only an **ephemeral tool-result/idempotency cache** (TTL 5 minutes) for orchestrator-loop efficiency. No long-term state.

This preserves the projection model: chain + MCP stores are source of truth; GraphDB is a public projection; the agent has no hidden authority.

### 4.3 The capability boundary
The orchestrator can compose tool calls but cannot widen them. Every tool call still passes through the redeem caveat chain. **A langchain plan is a sequence of tool invocations, each individually delegation-bounded.** The plan itself has no extra authority. This is the architectural answer to "what if the agent decides to drain the treasury": it can't, because every tool call respects the user's signed AllowedTargets + AllowedMethods + Value + Timestamp caveats.

## 5. Open decisions, resolved

| Decision | Recommendation |
|---|---|
| Public A2A wildcard domains | Whitelist only `/health`, `/.well-known/agent.json`, `/auth/*`, `/session/init`, `/session/package`. Everything else requires either session bearer or service-auth header. Inverts today's "exempt list" model. |
| Service-auth mechanism | **HMAC with key-id, nonce, and 60s window** for v1 (extends today's `requireInterServiceAuth`). Add key rotation via `KEY_ID` header. Move to signed service JWT in Phase 2 once we have a key manager. mTLS only if/when deployed to a service-mesh platform. |
| Hub read/write split | Route-level auth in v1 (different middleware on `discovery:*` vs `sync:*` vs `admin:*` vs `debug:*`). Process split deferred until scale or blast-radius justifies. |
| Session-store shape | Bootstrap routes private + service-auth via new `WEB_TO_A2A_HMAC_KEY`. Post-session ops (`active`, `revoke`, `bump-epoch`) become MCP tools requiring delegation token. |
| Public SSI endpoints | Keep `/.well-known/openid-credential-issuer`, `/credential`, `/verify/*` public per protocol; add rate-limit + body-size + challenge-replay table. Hard-segregate from `/tools/*` namespace; never publish a `/tools/*` route on a public listener. |
| Audit storage | Append-only Drizzle table in each service, joined by correlation id. Export to immutable storage only if compliance later requires; not blocking v1. |

## 6. Defendability matrix — codebase-grounded answers to architect Q&A

| Question | Defensible answer (with citation) |
|---|---|
| Why not let web call MCPs directly? | `scripts/check-no-bypass.sh` + `docs/architecture/01-web-a2a-mcp-flows.md` allowlist forbid it at CI time. Phase 1B extends the guardrail with route classification lint. |
| Is A2A a single point of failure? | A2A is the control-plane choke point by design. Its authority is bounded by: per-tool target/selector allowlists (`tool-policies.ts`), short session TTL (Phase 1C clamps), on-chain caveat enforcers (16 contracts under `packages/contracts/src/enforcers/`), per-MCP HMAC keys (defense in depth), and emergency revoke-all-by-account/key-version (Phase 1A). |
| Is host routing security? | No. `apps/a2a-agent/src/middleware/require-session.ts` resolves session by bearer, not by host. Phase 1A strict-mode change makes this explicit by failing closed on cross-agent mismatches outside an explicit allowlist. |
| Why are some MCP endpoints public? | Only `/.well-known/*`, `/credential`, `/verify/*` per SSI protocol requirement. Inventoried in IA report. `/tools/*` is never published on a public listener (Phase 1E ingress-lint enforces). |
| What if MCP is compromised? | MCP→A2A redeem is HMAC-signed, scope-bounded, target+selector-allowlisted, value-capped (Phase 1A fix #6), caveat-fail-closed (Phase 1C). Cannot ask A2A to run arbitrary chain calls. |
| What if A2A DB leaks? | Session packages AES-GCM with AAD bound to `(sessionId, accountAddress, chainId)` (Phase 1A fix #8); short TTL by risk tier; emergency revoke-by-key-version; encryption key in KMS in production (deployment item, Phase 2). |
| What prevents architecture drift? | Tester+Doc's 17 guardrails: route-classification lint, service-auth coverage lint, tool-policy completeness lint, fail-closed Foundry invariants, ingress exposure lint, production-gate test. CI fails on any drift. |
| Can GraphDB become authority? | No. `apps/hub-mcp/src/lib/graphdb-sync.ts` is the only writer; reads via `discovery:*` tools are read-only projections; all decision paths re-read chain (`onchain-redeem.ts`) or MCP store (`verify-delegation.ts`). |
| What if the langchain agent jailbreaks? | Sandbox sub-process model (§4.1) — orchestrator has zero access to session table, master EOA, HMAC keys. Every action still flows through the same redeem caveat chain. Plan = sequence of individually-bounded tool calls. |

## 7. Recommended next steps

1. **This week**: land §1.1–1.10 (the critical fixes + week-1 quick wins). Single sub-agent + reviewer can ship this in 4-5 days. The 2 fail-open bugs are the highest priority and unlock the rest.
2. **Weeks 2-3**: build the route classification parser and apply tags across the codebase. This is the foundation for every subsequent guardrail and the route-inventory generator.
3. **Weeks 3-5**: standardize the service-auth envelope and apply it across all 35+ identified inbound private routes.
4. **Weeks 4-6**: caveat-evaluator + fail-closed matrix (overlaps 1B; cheap to parallelize because it's a separate codebase area).
5. **Weeks 6-7**: unified audit schema + correlation ids.
6. **Weeks 7-10**: route inventory generator + ingress-lint + chain-reconcile (continuous; mostly tooling).
7. **Phase 2 (post-Phase-1)**: build `agent-knowledge-mcp` for the langchain memory plane; deploy the orchestrator sandbox sub-process; introduce key manager + service JWT.

After Phase 1E, the architecture is defensible against the source doc's review-question list, the langchain initiative has a clean home, and drift is automatically prevented.

## 8. References

- Full reports: `output/security-hardening-review.md`, `output/ia-route-classification.md`, `output/developer-current-state.md`, `output/tester-guardrails-framework.md`
- Source plan: `docs/architecture/production-hardening-source.md`
- Existing flow doc + bypass allowlist: `docs/architecture/01-web-a2a-mcp-flows.md`
- Existing CI guardrail: `scripts/check-no-bypass.sh`
- Strategic context: user intends to bring full langchain capabilities into a2a-agent; this plan makes that safe.
