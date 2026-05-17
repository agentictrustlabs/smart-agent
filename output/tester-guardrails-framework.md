# Production Hardening — Guardrail Framework (Area 13)

> Owner: Tester + Documentarian. Scope: meta-deliverable for the v1 → v1.1 hardening initiative in `docs/architecture/production-hardening-source.md`. Every guardrail below exists so that a violation of an architectural invariant in another area (1–12) becomes a red CI light, not a manual review observation.

Organized by **enforcement mechanism**, not by area — a single Area-N invariant may be enforced by checks in multiple groups (e.g. Area 1 dev-route gating is enforced by a static lint AND an integration test AND a deployment scan). For every guardrail: **Name · Location · Asserts · Catches · Cost**.

---

## Group 1 — Static / Lint Checks (run on every PR)

These run in well under 30 seconds, gate every PR, and require no running services.

### 1.1 `check:bypass` (extended)
- **Name**: `check-bypass` (extension of existing `scripts/check-no-bypass.sh`).
- **Location**: `scripts/check-no-bypass.sh`.
- **Asserts**: No `*_MCP_URL` reference, no `DiscoveryService.fromEnv()`, AND new patterns:
  - No `fetch(` literal `http://localhost:39\d\d` or `http://localhost:32\d\d` outside allowlist (catches hard-coded MCP/GraphDB ports).
  - No `process.env.GRAPHDB_*` reads outside `packages/discovery` and `apps/hub-mcp`.
  - No `chain.send`/`walletClient.sendTransaction` calls in `apps/web/src` (chain writes must go through A2A redeem).
  - No `crypto.createHmac` outside `packages/sdk/service-auth` (forces use of the shared helper instead of ad hoc HMAC).
- **Catches**: A future developer who hand-rolls a fetch to `localhost:3200` to "just call person-mcp directly".
- **Cost**: 2 hours (extend the existing grep script; reuse allowlist machinery).

### 1.2 `check-route-classification`
- **Name**: `check-route-classification`.
- **Location**: `scripts/check-route-classification.ts` (Node script, run via `pnpm check:routes`).
- **Asserts**: Every file matching `apps/web/src/app/api/**/route.ts` and `apps/a2a-agent/src/routes/**.ts` exports at least one HTTP handler AND the file contains a valid `@sa-route` JSDoc block (see Route Classification Spec below).
- **Catches**: A new `app/api/foo/route.ts` added without explicit classification.
- **Cost**: 1 day (AST walk with `ts-morph` or a JSDoc-tolerant regex; emit a structured failure listing missing files).

### 1.3 `check-tool-policy-metadata`
- **Name**: `check-tool-policy-metadata`.
- **Location**: `scripts/check-tool-policy.ts`.
- **Asserts**: Every MCP tool handler (file under `apps/*/src/tools/*.ts` exporting `handler` or `register*Tool`) declares a `toolPolicy` const matching this TS shape:
  ```ts
  type ToolPolicy = {
    name: string
    riskTier: 'low' | 'medium' | 'high'
    audience: string           // e.g. 'urn:mcp:server:person'
    requiresDelegation: boolean
    requiredCaveatFamilies: Array<'timestamp'|'value'|'targets'|'methods'|'session'>
    auditEvent: string         // event name written to executionAudit
  }
  export const TOOL_POLICY: ToolPolicy = { ... }
  ```
- **Catches**: A new tool added without declaring its risk tier, audience, or required caveat families.
- **Cost**: 1 day (AST scan + JSON schema validation).

### 1.4 `check-audit-coverage` (static)
- **Name**: `check-audit-coverage`.
- **Location**: `scripts/check-audit-coverage.ts`.
- **Asserts**: For every function annotated `@sa-audit-required`, the function body contains a `writeAuditRow(`/`recordExecution(` call OR delegates to an explicitly named auditing wrapper. Reverse-pass: every `return new Response(..., { status: 4\d\d })` in `apps/a2a-agent/src/routes/*` is preceded (within the same block) by an audit-denial write.
- **Catches**: Silent denials, missing audit on the happy-path of a new redeem flow.
- **Cost**: 1 day (lightweight scope-aware regex; trade some precision for low false-negative rate).

### 1.5 ESLint: `no-bare-process-env` for sensitive vars
- **Name**: `eslint-no-bare-process-env`.
- **Location**: custom rule under `tools/eslint-plugin-smart-agent/`.
- **Asserts**: `A2A_SESSION_SECRET`, `SERVICE_HMAC_KEY`, `CHAIN_RPC_PRIVATE_KEY`, etc. only read inside `config.ts` files; everything else consumes via the typed `config` import. Forbids these names appearing on `NEXT_PUBLIC_*` env vars.
- **Catches**: A private key accidentally exposed via `NEXT_PUBLIC_` prefix.
- **Cost**: 0.5 day.

### 1.6 TypeScript type-level guards
- **Name**: `types-service-call-envelope`.
- **Location**: `packages/types/src/service-auth.ts`.
- **Asserts**: Define `type ServiceAuthedRequest<T> = T & { __sa_service_authed: true }`. The internal HTTP helpers `callInternal()` (in `packages/sdk/service-auth/`) accept only `ServiceAuthedRequest`. The brand can only be produced by `signServiceRequest()`. A2A `/tools`, `/session-store`, `/wallet-action`, `/redeem` handlers accept only branded input. This makes "call an internal route without service auth" a compile error.
- **Catches**: Any path that tries to hit a private route without going through the signing helper.
- **Cost**: 1 day (refactor existing internal callers).

### 1.7 Foundry invariant test: caveat fail-closed matrix
- **Name**: `CaveatFailClosed.invariant.t.sol`.
- **Location**: `packages/contracts/test/CaveatFailClosed.invariant.t.sol`.
- **Asserts**: For every registered enforcer in `PolicyEnforcers`, calling `enforceBeforeHook` with malformed terms reverts; calling with unknown enforcer address reverts; calling with empty caveats array on a delegation that requires caveats reverts. Foundry invariant fuzz over 10k inputs.
- **Catches**: A new enforcer added that silently accepts unparseable terms (fail-open).
- **Cost**: 2 days (one invariant test scaffold + one targeted test per enforcer; reuse `PolicyEnforcers.t.sol` helpers).

### 1.8 Lint: route handler shape (no raw `Response`)
- **Name**: `eslint-route-handler-shape`.
- **Location**: `tools/eslint-plugin-smart-agent/rules/route-handler-shape.ts`.
- **Asserts**: Inside `apps/web/src/app/api/**/route.ts`, every exported HTTP method (`GET`/`POST`/`PUT`/`DELETE`) must call one of `withClassification(...)`, `withWebAuth(...)`, `withOperatorAuth(...)`, `withDevGuard(...)` as the outermost wrapper. No raw `export async function POST(req) {…}` bodies allowed.
- **Catches**: A route silently shipping without an auth wrapper.
- **Cost**: 1 day (incl. wrappers in `apps/web/src/lib/route-wrappers.ts`).

---

## Group 2 — Integration Tests (CI, runs against `fresh-start.sh`)

These spin up the full stack via `./scripts/fresh-start.sh --no-wait` plus targeted waits. Live under `tests/e2e/security/`.

### 2.1 Service-auth required (one test per private route family)
- **Name**: `tests/e2e/security/service-auth.spec.ts`.
- **Asserts**: Each of the following routes returns **401/403** when called with NO `X-SA-Signature`:
  - `POST http://localhost:3100/mcp/person/:tool`
  - `POST http://localhost:3100/session-store/insert`
  - `POST http://localhost:3100/wallet-action/dispatch`
  - `POST http://localhost:3100/redeem`
  - `POST http://localhost:3900/sync/*`
  - `POST http://localhost:3900/admin/*`
  - `POST http://localhost:3200..3600/tools/:tool` (every MCP `/tools` endpoint)
- **Catches**: Service-auth middleware regressed or missing on a new endpoint.
- **Cost**: 1 day (parameterized over a route table; reuse the same table as the route inventory in 3.3).

### 2.2 Replay rejection
- **Name**: `tests/e2e/security/replay.spec.ts`.
- **Asserts**: For each nonce/JTI-bound endpoint (`/redeem`, `/wallet-action/dispatch`, `/session-store/insert`, `/session-store/bump-epoch`):
  1. Sign a valid request and dispatch — expect 2xx.
  2. Replay the exact same payload + signature — expect 409 (`replay_detected`) and an audit row with `denial_reason='replay'`.
- **Catches**: Missing nonce cache, stale TTL on the replay window.
- **Cost**: 1 day.

### 2.3 Tool-policy caveat coverage
- **Name**: `tests/e2e/security/tool-caveats.spec.ts`.
- **Asserts**: For each MCP tool with `riskTier !== 'low'`:
  - Mint a delegation token with **one required caveat family removed** (e.g. drop the `targets` caveat) → expect tool call to reject with `403 caveat_missing`.
  - Mint a delegation token with a caveat whose terms are malformed → expect `403 caveat_unparseable`.
  - Mint a delegation token whose `aud` is wrong → expect `403 wrong_audience`.
  - Mint with a JTI already used → expect `409 replay`.
- **Catches**: A new high-risk tool ships without requiring its declared caveat families; fail-open on malformed caveats.
- **Cost**: 2 days (one parameterized matrix iterating the `TOOL_POLICY` registry).

### 2.4 Audit denial completeness
- **Name**: `tests/e2e/security/audit-denials.spec.ts`.
- **Asserts**: Run the negative scenarios from 2.1, 2.2, 2.3. For each, after the failing call, query `execution_audit` (A2A) and `audit_log` (each MCP) — assert exactly one new row with `outcome='denied'`, the expected `denial_reason`, populated `actor`, `tool`, `correlation_id`.
- **Catches**: A denial path that silently 403s without writing audit.
- **Cost**: 1 day (extends 2.1/2.2/2.3 with DB-readback assertions).

### 2.5 Production-gate test (`NODE_ENV=production`)
- **Name**: `tests/e2e/security/production-gates.spec.ts`.
- **How it runs**: Helper `spinProdWeb(port)` boots a second Next.js instance via `pnpm --filter @smart-agent/web start -- -p 3101` with `NODE_ENV=production` and a minimal env (no `ENABLE_DEV_ROUTES`, no `DEMO_LOGIN=1`). The test waits for `/api/health` 200 then probes:
  - `/api/boot-seed` → expect **404**
  - `/api/demo-login` → expect **404**
  - `/api/dev-patch-hannah` → expect **404**
  - `/api/dev-membership-check` → expect **404**
  - `/api/test/geo-trust-e2e` → expect **404**
  - `/api/ontology-sync/turtle` → expect **404** OR **401** (operator-auth)
- **Catches**: A new dev route added without a `withDevGuard()` wrapper.
- **Cost**: 2 days (the prod-mode boot helper is the long pole; reuse Playwright's `globalSetup` to keep it warm across tests).

### 2.6 Host-spoof negative test
- **Name**: `tests/e2e/security/host-spoof.spec.ts`.
- **Asserts**: A request to `POST http://localhost:3100/mcp/person/profile.read` with `Host: attacker.agent.localhost:3100` and a session cookie issued for `rich-pedersen.agent.localhost` → expect `403 host_mismatch` and audit row tagged `denial_reason='host_mismatch'`.
- **Catches**: Regressions in `host-context.ts` that let host header alone grant authority.
- **Cost**: 0.5 day.

### 2.7 Caveat fail-closed end-to-end
- **Name**: `tests/e2e/security/caveat-fail-closed.spec.ts`.
- **Asserts**: Force-feed `onchain-redeem.ts` a delegation containing an enforcer address NOT in `PolicyEnforcers` registry → expect `400 unknown_enforcer`, no chain submission, audit row. Complements 1.7 (Solidity side) on the JS side.
- **Cost**: 0.5 day.

### 2.8 GraphDB write authority
- **Name**: `tests/e2e/security/graphdb-writes.spec.ts`.
- **Asserts**: Direct `POST` to GraphDB's SPARQL update endpoint with a service-auth header for any service NOT `hub-mcp` → expect rejection. Calls via `callMcp('hub', 'sync.run', …)` succeed.
- **Catches**: A future feature accidentally granting another MCP write access to GraphDB.
- **Cost**: 0.5 day.

---

## Group 3 — Deployment / Config Checks

Run in CI on every PR (cheap) AND at service startup (fail-fast).

### 3.1 `check-ingress-exposure`
- **Name**: `check-ingress-exposure`.
- **Location**: `scripts/check-ingress-exposure.ts`.
- **Asserts**: Parse all `docker-compose*.yml` and `infra/k8s/**.yaml`. For every service in a "private" allowlist (`person-mcp`, `org-mcp`, `people-group-mcp`, `family-mcp`, `geo-mcp`, `skill-mcp`, `verifier-mcp`, `hub-mcp`, `graphdb`, `anvil`), assert no `ports:` declaration of the form `host:container` where `host` is `0.0.0.0` or unset. Bind addresses must be `127.0.0.1` (dev) or absent (k8s ClusterIP). Public services (`web`, `a2a-agent`) are explicitly listed and allowed.
- **Catches**: An MCP port accidentally exposed publicly in a production manifest.
- **Cost**: 1 day (YAML parse + assert; service classification table in `docs/architecture/production-services.json`).

### 3.2 Startup env-var checks (per service)
- **Name**: `assertProductionEnv()`.
- **Location**: `packages/sdk/runtime/assert-prod-env.ts`; called from each service's `index.ts`.
- **Asserts**: When `NODE_ENV=production`:
  - `A2A_SESSION_SECRET` present, ≥32 bytes base64.
  - `SERVICE_HMAC_KEY` present (or service JWT key path resolvable).
  - `AUDIT_DB_URL` present and reachable (1 round-trip ping).
  - No `ENABLE_DEV_ROUTES`, no `DEMO_LOGIN`, no `DEMO_USER_PRIVATE_KEY`.
  - For A2A: `MAX_SESSION_TTL_SECONDS` set per risk tier.
- **Catches**: Service starting in prod without an HMAC key or with demo flags accidentally enabled.
- **Cost**: 1 day (one schema per service, reusable helper).

### 3.3 Generated route inventory
- **Name**: `generate-route-inventory`.
- **Location**: `scripts/generate-route-inventory.ts` → writes `docs/architecture/generated/route-inventory.json` AND `route-inventory.md`.
- **Asserts (drift check)**: A CI job runs the generator and `git diff --exit-code` against the committed copy. Out-of-date inventory fails the build.
- **What it generates**: One row per route: `{ service, method, path, classification, auth, rateLimit, owner, file, lineNumber, riskTier }`. Sources:
  - `apps/web/src/app/api/**/route.ts` → parsed `@sa-route` blocks.
  - `apps/a2a-agent/src/routes/**.ts` → parsed Hono `.get/.post/.put` calls plus `@sa-route` JSDoc on the handler.
  - `apps/*-mcp/src/tools/**.ts` → parsed `TOOL_POLICY` const.
- **Catches**: Drift between code and architecture docs; a route changing classification silently.
- **Cost**: 2–3 days (the most ambitious piece; build incrementally — web first, then A2A, then MCPs).

### 3.4 `check-port-isolation` (compose lint)
- **Name**: `check-port-isolation`.
- **Location**: `scripts/check-port-isolation.ts`.
- **Asserts**: In `scripts/fresh-start.sh` and any `docker-compose.dev.yml`, private services must bind to `127.0.0.1`. Inverted assertion: assert that the running ports in `tmp/pids/<service>.pid` correspond to listeners on loopback only (parsed from `ss -tlnp`).
- **Catches**: A new service started with `0.0.0.0` bind in dev that would leak in prod.
- **Cost**: 0.5 day.

---

## Group 4 — Observability / Runtime Invariants

These run inside the services themselves and are checked by periodic jobs or test probes against staging.

### 4.1 Structured-log classification field
- **Name**: `log-classification-invariant`.
- **Location**: Shared logger in `packages/sdk/logger/`; runtime check `tests/e2e/security/log-classification.spec.ts`.
- **Asserts**: Every HTTP request emits a `request.complete` log line with fields `{ route, method, classification, outcome, durationMs, correlationId }`. Test: drive a representative set of requests through the running stack, tail the structured log (`tmp/logs/*.log`), assert every line has the required fields and a known `classification` enum value.
- **Catches**: A new route bypassing the wrapper and emitting no classification.
- **Cost**: 1 day (logger middleware) + 0.5 day (test).

### 4.2 Audit completeness reconciliation
- **Name**: `audit-vs-chain-reconcile`.
- **Location**: `scripts/audit-reconcile.ts` (CI job + nightly cron).
- **Asserts**: For each block in the local Anvil run, fetch transactions whose `to` is a registered `AgentAccount` factory or `DelegationManager`. For each such tx, assert an `execution_audit` row exists with matching `txHash`. Any orphan chain tx without an audit row is a failure.
- **Catches**: A new redeem path that submits a tx without writing audit; lost audit rows.
- **Cost**: 1 day.

### 4.3 Replay-cache health probe
- **Name**: `replay-cache-probe`.
- **Location**: `tests/e2e/security/replay-cache.spec.ts`.
- **Asserts**: Replay cache is alive and bounded: insert 1000 synthetic nonces, assert TTL pruning kicks in below cap, assert hit-detection latency stays under threshold.
- **Cost**: 0.5 day.

### 4.4 Denial-rate alarm
- **Name**: `denial-rate-alarm` (operational, not CI).
- **Location**: `scripts/observability/denial-watch.ts`.
- **Asserts**: Periodically queries `execution_audit` for denial-rate spikes over 5-min windows; emits a structured alarm if rate jumps over the moving baseline. Not gating; flags suspicious activity.
- **Cost**: 1 day.

---

## Route Classification Comment Specification

Per Area 1 P1: every web API route and every A2A route must carry a JSDoc-style classification block immediately above the exported HTTP handler.

### Format

```ts
/**
 * @sa-route operator-only         // one of: public | web-auth | service-auth | operator-only | dev-only
 * @sa-auth siwe-session           // none | siwe-session | passkey-session | service-hmac | service-jwt | walletaction-sig | dev-bypass
 * @sa-rate-limit 10/min            // optional; required for 'public' classification
 * @sa-audit-event round.lifecycle  // optional; if present, handler must call writeAuditRow with this event
 * @sa-risk-tier medium             // low | medium | high — defaults to 'low' if omitted
 * @sa-owner pm                     // role from docs/agents/* — for ownership in route inventory
 * @sa-prod-gate ENABLE_DEV_ROUTES  // optional; env var that must be truthy in prod (for dev-only routes)
 */
export async function POST(req: Request) { ... }
```

### Allowed values (enum)

- `@sa-route`: `public` | `web-auth` | `service-auth` | `operator-only` | `dev-only`
- `@sa-auth`: `none` | `siwe-session` | `passkey-session` | `service-hmac` | `service-jwt` | `walletaction-sig` | `dev-bypass`
- `@sa-risk-tier`: `low` | `medium` | `high`

### Validity rules (enforced by parser)

1. `@sa-route` is **required**; missing → fail.
2. If `@sa-route: public` → `@sa-rate-limit` is required.
3. If `@sa-route: dev-only` → `@sa-prod-gate` is required AND handler body must include `assertDevOnly()` call.
4. If `@sa-route: service-auth` → `@sa-auth` must be `service-hmac` or `service-jwt`.
5. If `@sa-route: operator-only` → `@sa-auth` must be `service-jwt` (with operator scope).
6. `@sa-audit-event` is **required** when `@sa-risk-tier` is `medium` or `high`.

### Parser

- **Location**: `scripts/lib/route-classification-parser.ts` (shared between `check-route-classification`, `generate-route-inventory`, and `check-audit-coverage`).
- **Implementation**:
  - Use `ts-morph` to walk the file's AST, locate exported async functions matching HTTP method names, find leading JSDoc.
  - Tokenize block on `@sa-` tags into a `RouteClassification` record (TS type lives in `packages/types/src/route-classification.ts`).
  - Validate against the enum + cross-tag rules above.
  - Emit either `{ ok: true, classification }` or `{ ok: false, errors: string[] }`.
- **Consumers**:
  - `check-route-classification` (fails build on any error).
  - `generate-route-inventory` (rolls up into `route-inventory.json`).
  - `check-audit-coverage` (cross-checks `@sa-audit-event` against `writeAuditRow` call sites).
- **Test fixtures**: `scripts/__tests__/route-classification-fixtures/` — one fixture per validity rule (positive + negative).

### Tooling integration

- `pnpm check:routes` runs `check-route-classification` + `generate-route-inventory --check`.
- A pre-commit hook (`scripts/hooks/pre-commit-route-class.sh`) runs the parser only on staged route files for fast local feedback.
- `route-inventory.md` is regenerated nightly by a CI job and committed automatically; PRs that change routes must update it (drift check fails otherwise).

---

## Phase 1 Testing Roadmap

Mapping each guardrail to the source-doc phase, with dependency notes. Each phase delivers a self-enforcing slice of the architecture invariants for the areas opened in that phase.

### Phase 1A — Close Public Exposure Risks
Foundation slice: classification metadata and dev-route gates land first so every later guardrail has a stable substrate.

| Order | Guardrail | Notes |
|-------|-----------|-------|
| 1 | Route Classification Spec (parser + types) | Prerequisite for almost everything else; ship the parser before the lint that consumes it. |
| 2 | 1.2 `check-route-classification` | Uses parser. Blocks PRs without `@sa-route`. |
| 3 | 1.8 `eslint-route-handler-shape` + `withDevGuard()` wrapper | Provides the runtime gate the spec promises. |
| 4 | 3.1 `check-ingress-exposure` | Independent; bring in parallel — needs the `production-services.json` classification table. |
| 5 | 2.5 Production-gate test | Validates 1.8 + 3.1 end-to-end. Depends on `withDevGuard()`. |
| 6 | 1.1 `check:bypass` extensions (extra patterns) | Independent; small, ship anytime in 1A. |

Exit criterion: a PR adding a new dev route without `@sa-route: dev-only` + `withDevGuard()` cannot merge; production-mode boot serves 404 for every known dev path.

### Phase 1B — Standardize Service Auth
Builds on 1A's classification.

| Order | Guardrail | Notes |
|-------|-----------|-------|
| 1 | 1.6 Type-level `ServiceAuthedRequest<T>` brand | Land the type + signing helper first so refactors compile. |
| 2 | Refactor internal callers to use `callInternal()` | Not a guardrail per se but a required refactor. |
| 3 | 3.2 Startup env-var checks | Fail-fast when service auth keys are missing. |
| 4 | 2.1 Service-auth required (integration) | Validates 1.6 end-to-end on every private route family. |
| 5 | 1.1 Extended bypass check (HMAC outside SDK) | Locks the refactor in place. |

Exit criterion: every internal HTTP call has a service-auth header; bare `fetch()` to internal services fails to compile.

### Phase 1C — Harden Delegated Execution
Closes Areas 4, 5, 9.

| Order | Guardrail | Notes |
|-------|-----------|-------|
| 1 | 1.3 `check-tool-policy-metadata` | Declares the contract every high-risk tool must meet. |
| 2 | 1.7 Foundry caveat fail-closed invariants | Contract-level closure for Area 9. Parallel to 1.3. |
| 3 | 2.7 JS-side caveat fail-closed test | Mirrors 1.7 on the redeem path. |
| 4 | 2.3 Tool-policy caveat coverage matrix | Depends on 1.3 (consumes `TOOL_POLICY`). |
| 5 | 2.2 Replay rejection | Depends on 1B (replay cache uses service-auth nonce envelope). |
| 6 | 2.6 Host-spoof negative test | Lightweight; ship in parallel. |

Exit criterion: every high-risk tool has declared caveats; a missing-caveat redeem attempt fails at three layers (compile, JS runtime, Solidity).

### Phase 1D — Make It Auditable
Closes Area 11.

| Order | Guardrail | Notes |
|-------|-----------|-------|
| 1 | 1.4 Static `check-audit-coverage` | Cheap; ensures `@sa-audit-event` claims line up with code. |
| 2 | 4.1 Structured-log classification field | Logger middleware is a single PR. |
| 3 | 2.4 Audit denial completeness | Builds on 2.1/2.2/2.3 — readback assertions. |
| 4 | 4.2 Audit-vs-chain reconciliation | Last; needs all redeem paths writing audit. |

Exit criterion: every denial in the negative-test corpus produces an audit row; reconciliation job finds zero orphan chain transactions.

### Phase 1E — Prove The Boundary
The capstone. Everything generated, everything inventoried.

| Order | Guardrail | Notes |
|-------|-----------|-------|
| 1 | 3.3 Generated route inventory | Consumes 1A's classification + 1.3's tool policy + 1B's service-auth metadata. |
| 2 | 3.4 `check-port-isolation` | Runtime port scan. |
| 3 | 4.3 Replay-cache health probe | Light operational test. |
| 4 | 4.4 Denial-rate alarm | Operational; can lag CI. |

Exit criterion: `pnpm check:all` runs all of Group 1 + 3.1 + 3.3 in under 60 seconds; CI runs Group 2 against `fresh-start` in under 10 minutes; the architecture review docs `route-inventory.md` is committed and proven drift-checked.

---

## Cross-Cutting Notes

- **Source of truth**: route classification, tool policy, and service-auth envelope specs all live as TS types in `packages/types/`. Parsers and runtime middlewares import the same types — drift is prevented at compile time.
- **Allowlist discipline**: guardrails with allowlists (1.1, 1.4, 3.1) keep the allowlist next to the script AND require a matching entry in `docs/architecture/01-web-a2a-mcp-flows.md`. PR template gets a checkbox: "If you modified an allowlist, did you update the matching architecture doc section?"
- **Cost summary**: ~22 engineering-days total. The route inventory generator (3.3) is the long pole at 2–3 days. Phase 1A foundation is ~6 days; the rest parallelizes once the parser and type substrate land.
- **Performance budget**: Group 1 < 30 s locally; Group 2 < 10 min in CI; Group 3 startup checks ≤ 200 ms per service boot.

Finishing Area 13 alongside Areas 1–12 leaves the system *self-enforcing*: a reviewer six months from now can answer "what is the authority on this route?" by running `pnpm check:routes && cat docs/architecture/generated/route-inventory.md`.
