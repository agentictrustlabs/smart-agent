# R2 — WAF and DDoS Protection

> **Effort**: S for vendor configuration (3 days) + M for custom rule
> set and in-app fallback (5 days). Total M.
> **Owner**: infra (vendor setup) + developer (in-app fallback)
> **Status**: ready to assign
> **Dependencies**: vendor procurement (Vercel WAF auto-included for our
> web tier; Cloudflare account needed for a2a-agent if hosted elsewhere)

## 1. Threat model

### 1.1 What WAF stops (and what it doesn't)

A WAF is a request inspection / blocking layer that sits at the edge.
It's good at:

- **OWASP Top 10 generic patterns** — SQL injection, XSS, LFI, RCE
  signatures in the request line / body / headers.
- **Reputation-based blocking** — IPs from known botnets, Tor exit
  nodes, scanners.
- **Geo-blocking** — refuse traffic from countries we don't serve.
- **Rate-based rules** — "more than N requests per IP per minute hits
  4xx, banhammer them at the edge for 10 minutes."
- **Bot-traffic heuristics** — JA3/JA4 fingerprints, headless-browser
  signatures.

A WAF is poor at:

- **Application-layer logic abuse** — a valid logged-in user making
  expensive but valid requests at high volume.
- **Slow-and-low credential stuffing** distributed across thousands of
  IPs at 1 req/min each.
- **Business-logic exploits** — replay attacks, race conditions in
  state machines (handled by Spec 007 nonce + epoch invariants).

DDoS protection is a layered defense — typically:

- **L3/4 volumetric** — handled by the cloud provider (AWS Shield
  Standard, GCP Cloud Armor's L3/4 layer, Cloudflare). Free at the
  baseline; we get this with any major cloud.
- **L7 application flood** — handled by WAF rate rules + auto-mitigation.
- **Slowloris / slow-body / slow-read** — handled by edge connection
  timeouts; the relevant config in our case is the Vercel / Cloudflare
  default (10s body timeout) which is sufficient.

### 1.2 Concrete attack scenarios

1. **OWASP CRS regex flood**. Attacker sends 10k requests/sec with SQL
   payloads in the URL. Without WAF, every one hits the Next.js handler,
   exhausts the Drizzle connection pool, OOMs. With WAF, ~99 % blocked
   at the edge.
2. **Auth credential stuffing distributed**. 100k IPs each make 1
   demo-login POST per minute against `apps/web/src/app/api/demo-login/
   route.ts`. Per-IP limiter (`apps/web/src/middleware.ts:46`,
   10/min) is useless. WAF rate-limit by `path + body-shape` is the
   right primitive. Note this overlaps with R5 (per-account brute force);
   R2 is the edge layer, R5 is the application layer — both required.
3. **Slow POST**. Attacker opens 10k connections to `/api/auth/passkey-
   verify`, sends 1 byte / second. Without timeout, Next.js workers
   exhaust. With Vercel's default (10s body), connections close.
4. **Geo-targeted flood**. Most traffic comes from countries we host
   in; an attacker from a region we don't serve can be geo-blocked
   outright. Low false-positive ratio because legitimate users in
   blocked regions are zero today (single-region demo).

### 1.3 What we have today

- **Per-IP sliding-window rate limit in-process**:
  - `apps/web/src/middleware.ts:46-62` — 10/min on auth/bootstrap paths.
  - `apps/a2a-agent/src/middleware/rate-limit.ts` — 60/min global,
    10/min auth, 60/min MCP proxy.
  - **Limitation**: in-memory state per process. Multi-instance
    deployments race; restart wipes the state (memory note:
    `feedback_seed_footguns.md` item 3 — same root cause).
- **Body limits**: `apps/a2a-agent/src/index.ts:46` — 256 KB default,
  1 MB on `/session/package`. Web has no explicit limit (Next.js
  defaults apply).
- **No WAF**.
- **No DDoS auto-mitigation beyond Vercel's free tier defaults**.

## 2. Vendor selection

### 2.1 Options matrix

| Vendor | Coverage | Per-request cost | Custom rules | Notes |
|--------|----------|------------------|--------------|-------|
| **Vercel WAF + Firewall** | web tier only | included up to plan; overage $1/10M | UI + API; CRS subset | First choice for `apps/web/` since we're already on Vercel |
| **Cloudflare WAF + Bot Mgmt** | any HTTP origin | Free tier: 5 custom rules; Pro $25/mo: 20 rules; Business $200/mo: WAF + Bot Mgmt | YAML + UI | First choice for `apps/a2a-agent` (cloud-agnostic) |
| **AWS WAF** | ALB / CloudFront / API Gateway | $5 per WebACL/mo + $1 per rule + $0.60/M req | JSON | Use only if we move web to AWS; today not. |
| **GCP Cloud Armor** | GLB / Cloud Run | $5 per policy/mo + $1/M req | Rego-like | Use only if we move to GCP |

**Selection**:

- `apps/web/` → **Vercel WAF** (already pay for Vercel; activate WAF).
- `apps/a2a-agent/` → **Cloudflare** (front Hono with Cloudflare DNS +
  proxied A record; origin shielded).
- `apps/*-mcp/` → fronted by a2a-agent; no separate edge needed.

### 2.2 Cost estimate

| Item | Monthly |
|------|---------|
| Vercel WAF on existing Pro plan | $0 incremental (included) |
| Cloudflare Pro plan (a2a-agent zone) | $25 |
| Cloudflare WAF rules (Pro tier limit: 20 custom) | $0 incremental |
| Cloudflare Bot Management (only if needed) | $200 (defer until we observe bot traffic) |
| **Estimated total** | **$25/mo at launch; $225/mo at scale** |

Free-tier viability: Cloudflare's free plan includes DDoS auto-mitigation
and 5 custom WAF rules. We can start there if budget is tight; upgrade
when we hit the 5-rule limit.

## 3. Design

### 3.1 In-app fallback (always-on)

Even with WAF in place, in-app limits must exist for defense in depth
(memory rule: substrate independence). We harden the existing limiters:

1. **Migrate in-process store to Redis** (Spec 007 Phase F dependency:
   F.2 lands Postgres; Redis is a separate small instance for
   ephemeral state). Today's in-memory map breaks under multi-instance.
   Target: `packages/sdk/src/rate-limit/redis-store.ts` with the same
   sliding-window algorithm.
2. **Standardize the IP extraction**. Today web (`apps/web/src/middleware
   .ts:64-70`) and a2a (`apps/a2a-agent/src/middleware/rate-limit.ts:46-55`)
   each have their own `clientIp`. Extract `getClientIp(headers,
   socket?)` into `packages/sdk/src/rate-limit/client-ip.ts`. Must
   honor `X-Forwarded-For` only from trusted proxies (Vercel /
   Cloudflare; configurable via `TRUSTED_PROXY_CIDRS`).
3. **Token-bucket option for legitimate bursty endpoints**. The
   sliding-window 60/min is too coarse for e.g. boot-seed (memory
   note: dev raised SESSION_INIT to 600/min). Token bucket lets us
   say "burst 30 then 5/s thereafter." Add `tokenBucket(rate, burst)`
   alongside `slidingWindow(max, windowMs)` in the shared package.

### 3.2 Vercel WAF rule set (apps/web/)

Configured via Vercel dashboard or Terraform (`infra/vercel/waf.tf`).
Initial rule set, in priority order (highest first):

```
# R-001: Allow Vercel internal probes (health checks).
when path matches "^/_health" then ALLOW

# R-002: Block requests with no User-Agent header. Legitimate browsers
#        and our own a2aFetch always set one. Bots often don't.
when user_agent equals "" then BLOCK

# R-003: Block known bad IP lists (Vercel's built-in reputation feed).
when ip in reputation_list("malicious_botnet") then BLOCK

# R-004: Rate-limit /api/demo-login by IP. 60 req / 10 min — legitimate
#        users login once or twice; abusers spray. Stricter than the
#        in-app 10/min because edge sees the spray first.
when path equals "/api/demo-login" and method equals "POST"
  then RATE_LIMIT(60, 10m, per_ip)

# R-005: Rate-limit auth surfaces. Same shape as the in-app limiter so
#        the edge intercepts the bulk of attempts.
when path matches "^/api/auth/" and method equals "POST"
  then RATE_LIMIT(60, 10m, per_ip)

# R-006: OWASP-CRS subset — SQL injection signatures in URL or body.
#        Vercel ships a managed rule set; enable "Critical" + "High".
enable_managed_rules "owasp_crs_critical"
enable_managed_rules "owasp_crs_high"

# R-007: Geo-block — refuse traffic from sanctioned regions. List
#        sourced from OFAC SDN; updated quarterly. Initial: ["KP", "IR",
#        "CU", "SY"]. Tunable; some legitimate users may need a VPN.
when geo.country in ["KP", "IR", "CU", "SY"] then BLOCK

# R-008: Block requests with body > 1 MB.
when body_size > 1048576 then BLOCK

# R-009: Log all 4xx/5xx for SIEM ingestion. NOT a block — observability.
when status >= 400 then LOG
```

**Tuning**: deploy in **Log-only** mode for 7 days. Collect false-
positive rate. Then promote each rule to **Block** individually
starting with R-002 (lowest false-positive risk).

### 3.3 Cloudflare WAF rule set (apps/a2a-agent/)

Configured via Cloudflare dashboard or Terraform (`infra/cloudflare/
zone.tf`). Same shape as §3.2 with a2a-specific paths:

```
# C-001: Health and well-known endpoints — always allow, no rate limit.
when path in ["/health", "/.well-known/agent.json"] then ALLOW

# C-002: Rate-limit /session/init. Matches the in-app SESSION_INIT
#        limiter (10/min prod / 600/min dev). Edge does 60/10min.
when path equals "/session/init" and method equals "POST"
  then RATE_LIMIT(60, 10m, per_ip)

# C-003: Rate-limit /auth/* (matches in-app AUTH limiter).
when path matches "^/auth/" then RATE_LIMIT(60, 10m, per_ip)

# C-004: Reject requests to /session/<id>/redeem-via-account from any
#        IP that isn't on the MCP-to-A2A allow list. These are HMAC-
#        authenticated inter-service calls; should never come from the
#        public internet.
when path matches "^/session/.+/redeem-via-account$"
   and ip not in mcp_internal_subnet
  then BLOCK

# C-005: Block requests with no x-sa-correlation-id where the Host
#        header is a valid agent subdomain. Legitimate web → a2a calls
#        always set the header (per a2a-fetch.ts §3.2). Bots probing
#        the agent endpoint don't know about it.
#        DEFER: turn on after we confirm 0 % false-positive in log-only
#        mode for 30 days.
# when missing x-sa-correlation-id and host matches "^[a-z0-9-]+\.agent\."
#   then BLOCK

# C-006: OWASP managed rules — same as R-006.
enable_managed_rules "owasp_managed_ruleset"

# C-007: Body-size cap. Lower than web because a2a-agent's own
#        bodyLimit is 256 KB.
when body_size > 524288 then BLOCK
```

### 3.4 DDoS protection

**Vercel**: included with Pro plan. Auto-mitigation kicks in at
volumetric thresholds; no config needed.

**Cloudflare**: free tier includes L3/4 + L7 auto-mitigation. We
explicitly enable:

```
Security level: Medium
Bot Fight Mode: ON (free tier)
Challenge Passage: 30 minutes
Browser Integrity Check: ON
```

**AWS Shield Standard**: free with any AWS service. Add to roadmap for
when (if) we move infrastructure to AWS.

### 3.5 Monitoring + alerting

- WAF events flow into Cloudflare Logpush → S3 (or GCS). Retention 90 days.
- Per-rule alert thresholds:
  - R-005 / C-003 fires > 100 times in 5 min on a single IP → page
    on-call.
  - R-007 fires > 1000 times in 5 min → page on-call (potential
    targeted attack from sanctioned region).
- Dashboard: Grafana panel pulling from Cloudflare GraphQL Analytics
  API + Vercel logs.

## 4. Files to create / change

```
infra/vercel/
└── waf.tf                                NEW — Terraform for Vercel WAF rules (use vercel_firewall_rule)

infra/cloudflare/
├── zone.tf                               NEW — Cloudflare zone, WAF, rate limits
├── waf-rules.tf                          NEW — rule blocks per §3.3
└── README.md                             NEW — operator runbook for vendor account setup

packages/sdk/src/rate-limit/
├── client-ip.ts                          NEW — unified IP extractor
├── sliding-window.ts                     NEW — extracted from middleware
├── token-bucket.ts                       NEW — new algorithm for bursty endpoints
├── redis-store.ts                        NEW — Redis-backed store
├── in-memory-store.ts                    NEW — extracted from current code
└── __tests__/                            NEW — unit + property tests

apps/web/src/middleware.ts                EDIT — call shared rate-limit helpers
apps/a2a-agent/src/middleware/rate-limit.ts  EDIT — call shared rate-limit helpers

docs/operations/
└── waf-runbook.md                        NEW — what to do when a rule fires
```

## 5. Implementation steps

| Day | Task |
|-----|------|
| 1 | Extract `client-ip.ts` + `sliding-window.ts` into shared package; refactor web + a2a to use them. No behavior change. |
| 2 | Add `redis-store.ts`. Behind a flag; default off in dev (memory-store). |
| 3 | Add `token-bucket.ts`. Apply to `/session/init` so boot-seed doesn't need the 600/min env override. |
| 4 | Procure Cloudflare account + add a2a-agent DNS zone. Vercel WAF: ensure plan includes it. |
| 5 | Write `infra/vercel/waf.tf` + `infra/cloudflare/zone.tf`. Deploy rules in Log-only mode. |
| 6 | Monitor for 7 days; collect false-positive data. |
| 7 | Promote rules to Block one-by-one with low-risk first. |
| 8 | Write `docs/operations/waf-runbook.md` + Grafana dashboard. |

## 6. Test plan

### 6.1 In-app fallback

- Unit tests for `sliding-window.ts`, `token-bucket.ts`, `client-ip.ts`
  (mocked `Date.now`, table-driven inputs).
- Integration test against a2a-agent: make 100 POSTs to `/session/init`
  in 1 second; expect 90 to receive `429` (ceiling 10/min in prod
  defaults).
- Redis-store test: spin up Redis in CI (`services: redis:7-alpine`);
  assert ceiling enforced across two simulated server instances by
  sharing a Redis URL.

### 6.2 WAF (manual + automated)

- Smoke test against a deployed staging environment:
  - `curl -i 'https://staging.smartagent.io/api/demo-login' -H ''` with
    no UA → expect 403 (R-002).
  - `curl -i 'https://staging.smartagent.io/?id=1%20UNION%20SELECT'` →
    expect 403 (R-006).
  - Loop 100 demo-login POSTs from one IP → expect Vercel rate-limit
    page after threshold (R-004).
- Automated synthetic-monitoring tests run hourly via Grafana k6 hitting
  the malicious payloads above; alert if WAF stops blocking.

### 6.3 DDoS exercise (planned, not run repeatedly)

- Schedule one annual coordinated load test with Cloudflare Load Testing.
- Acceptance: site stays available; rate-limiting messages returned
  cleanly; no 5xx on the origin.

## 7. Acceptance criteria

- [ ] `packages/sdk/src/rate-limit/*` exists and is consumed by both
      web middleware and a2a-agent middleware.
- [ ] Redis-store passes the multi-instance integration test.
- [ ] Vercel WAF active with R-001..R-009 rules.
- [ ] Cloudflare proxy active for a2a-agent zone with C-001..C-007.
- [ ] All rules promoted to Block after 7-day Log-only burn-in (with
      one exception: rules whose false-positive rate is documented and
      tuned).
- [ ] `docs/operations/waf-runbook.md` written and one tabletop drill
      executed.
- [ ] Grafana dashboard live; PagerDuty wired to fire on §3.5 thresholds.

## 8. Vendor references

- Vercel Firewall: https://vercel.com/docs/edge-network/firewall
- Vercel WAF (Pro): https://vercel.com/docs/security/web-application-firewall
- Cloudflare WAF rules: https://developers.cloudflare.com/waf/custom-rules/
- Cloudflare Managed Rules (OWASP): https://developers.cloudflare.com/waf/managed-rules/
- Cloudflare Rate Limiting: https://developers.cloudflare.com/waf/rate-limiting-rules/
- AWS WAF: https://docs.aws.amazon.com/waf/latest/developerguide/waf-chapter.html
- AWS Shield Standard: https://docs.aws.amazon.com/waf/latest/developerguide/shield-chapter.html
- GCP Cloud Armor: https://cloud.google.com/armor/docs/cloud-armor-overview
- OWASP Core Rule Set: https://coreruleset.org/

## 9. Open questions

- **OQ-R2-1**: Do we want a managed bot-detection product (Cloudflare
  Bot Mgmt $200/mo) or roll with R6's CAPTCHA approach? Proposal: R6
  CAPTCHA is sufficient for v1; reassess at 10k MAU.
- **OQ-R2-2**: Redis vs. Postgres for rate-limit state? Postgres is
  already coming in Spec 007 Phase F.2; reusing it avoids a new
  dependency. Latency tradeoff: Redis ~0.5ms, Postgres ~2ms with
  pooling. Proposal: Postgres for v1 (one less moving part); revisit
  if rate-limit checks become a hot path. The shared store interface
  in `packages/sdk/src/rate-limit/` MUST be swappable.
- **OQ-R2-3**: Geo-block list — who owns updates? Proposal: legal /
  compliance review quarterly; track in `docs/security/compliance/geo-block.md`.
- **OQ-R2-4**: a2a-agent fronted by Cloudflare implies Cloudflare can
  read our TLS-decrypted traffic. Is that acceptable? Proposal: yes
  for v1 (web data is already passing through Vercel); revisit when we
  have a security/SOC2 customer.

## 10. Effort summary

| Stream | Days |
|--------|------|
| Shared rate-limit package extraction | 2 |
| Redis-store + token-bucket | 2 |
| WAF rule authoring (both providers) | 1.5 |
| WAF burn-in monitoring | calendar week (negligible dev time) |
| Operator runbook + dashboards | 1.5 |
| Code review | 1 |
| **Total** | **8 days (M)** |
