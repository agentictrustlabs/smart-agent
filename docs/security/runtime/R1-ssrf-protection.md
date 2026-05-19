# R1 — SSRF Protection

> **Effort**: M (1 week dev + 2 days review)
> **Owner**: developer (security review by reviewer + ontologist for vocabulary terms)
> **Status**: ready to assign
> **Dependencies**: none (lands ahead of Spec 007 Phase E proxy hardening; complementary)

## 1. Threat model

Server-Side Request Forgery is the class of bugs where an attacker
influences the URL of an outbound HTTP request the server makes on their
behalf. Smart Agent has three outbound-fetch surfaces, each with a
distinct attack vector:

### 1.1 Surfaces

| # | Surface | Code path | User input? |
|---|---------|-----------|-------------|
| S1 | web → a2a-agent | `apps/web/src/lib/clients/a2a-fetch.ts` (`a2aFetch`) | URL is `<slug>.agent.localhost:<port>`; slug from authenticated session |
| S2 | web → MCP (via a2a proxy) | `apps/web/src/lib/clients/mcp-client.ts` (`callMcp`) | server name, tool name from server-side enum; args from request body |
| S3 | a2a-agent → MCPs | `apps/a2a-agent/src/routes/mcp-proxy.ts` | downstream URL built from MCP id mapping, NOT user input today |
| S4 | a2a-agent → hub-mcp | `apps/a2a-agent/src/routes/mcp-proxy.ts` (hub branch) | system slug `system.<base>`; URL is fixed |
| S5 | a2a-agent → chain RPC | `viem.createPublicClient({ transport: http(config.RPC_URL) })` | `RPC_URL` is from env, not user-controlled |
| S6 | person-mcp → external resolver fetches | none today (search `apps/person-mcp/src/**` for `fetch(` — only intra-cluster calls) | n/a |
| S7 | OID4VCI / OID4VP issuer / verifier URLs | `packages/sdk/src/anoncreds/**`, `apps/verifier-mcp/src/**` | **YES** — issuer/verifier URLs travel in credential offers; a malicious offer can name an attacker URL |
| S8 | Webhook surfaces | search confirms NONE today; future invite/notification subscriber endpoints would qualify |

> **Audit step** (developer, day 1): re-run
> `git grep -nE "fetch\(|undiciFetch\(|axios\.(get|post)" apps/ packages/`
> and append any missed surface to this table before writing code. The
> threat-model table is the canonical inventory; if it doesn't list a
> surface, that surface isn't protected.

### 1.2 Attacker capabilities by surface

- **S1, S3, S4** — URL builder is server-side, not user-controlled. Low
  risk today; goes from "low" to "zero" once we wrap the call with
  `safeFetch` (defense in depth: hard-codes the egress allowlist).
- **S2** — `opts.agentAddress` is server-supplied or from the
  authenticated user's record; `server` is an enum (`'person' | 'org' |
  'people-group' | 'hub'`). The risk is a future regression that lets a
  client-supplied address through; `safeFetch` catches that.
- **S5** — RPC URL is from `config.RPC_URL` (env). Egress allowlist must
  include the configured RPC host.
- **S7 (highest risk today)** — AnonCreds issuer URLs, OID4VCI
  credential-offer URLs, and OID4VP presentation-definition URLs CAN
  arrive embedded in a credential offer / presentation request. An
  attacker offering a credential to one of our users could specify
  `http://169.254.169.254/latest/meta-data/iam/...` as the issuer's
  schema-fetch endpoint. Our wallet code would then fetch from cloud
  metadata.
- **S8** — anticipatory. The marketplace roadmap (specs 001-003) does
  not introduce webhooks yet, but the proposal lane's "review receipts"
  surface (`1CLAW-INSPIRED-FEATURES-PLAN.md`) might. If it does, this
  doc's pattern applies verbatim.

### 1.3 Concrete attack scenarios

1. **Cloud-metadata exfil via OID4VCI**. User accepts an offer; wallet
   fetches `issuer.metadata.url` → `http://169.254.169.254/latest/
   meta-data/iam/security-credentials/<role>`. Response contains an IAM
   token. Wallet returns the body to the issuer in the offer-accept
   handshake (which is the standard OID4VCI metadata-discovery flow).
   Result: AWS role credentials leaked to attacker-controlled origin.
   Mitigation: refuse outbound fetches to private / link-local IPs.
2. **Internal port scan**. Attacker tries `issuer.metadata.url =
   http://localhost:5432/`. Server's response time + HTTP status discloses
   whether Postgres is listening. Repeat for each candidate port.
   Mitigation: same DNS-resolution check as scenario 1.
3. **Internal service pivot**. With Spec 007 Phase F.2's Postgres in
   place, attacker probes `http://postgres:5432/`, `http://a2a-agent
   :3100/health` from a credential offer to enumerate the cluster.
   Mitigation: egress firewall (Phase H IaC item) + `safeFetch` allowlist.

## 2. Current state

- **No** `safeFetch` wrapper exists today. Outbound fetches use the
  native `fetch` (web app) or undici (`a2aFetch` for cross-loopback
  calls).
- **No** DNS-resolution check on user-influenced URLs.
- **No** redirect-target validation.
- **Egress firewall**: not present in the dev cluster; production
  posture is Vercel-managed for web, and TBD for a2a-agent.
- **Closest related control**: `apps/a2a-agent/src/middleware/
  host-context.ts` already validates host headers with a strict regex
  (line 139: `/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/`), preventing
  arbitrary subdomain assertion. That regex pattern is the template the
  R1 URL-validator follows.

## 3. Design

### 3.1 Component: `safeFetch`

Location: **`packages/sdk/src/http/safe-fetch.ts`** (new).

Public API:

```ts
import type { Dispatcher } from 'undici'

export interface SafeFetchOptions extends RequestInit {
  /** Optional pre-configured dispatcher (e.g. the a2aFetch loopback agent). */
  dispatcher?: Dispatcher
  /** Override the default allowlist for this single call. Use sparingly;
   *  most callers should rely on the default. */
  allowList?: SafeFetchAllowList
  /** When true, follow up to N redirects but validate each target. Default false. */
  followRedirects?: boolean
  maxRedirects?: number
}

export interface SafeFetchAllowList {
  /** Hostnames or hostname suffixes that are always permitted. */
  hosts: ReadonlyArray<string>
  /** Schemes permitted. Default: ['https:'] in prod, ['http:', 'https:'] in dev. */
  schemes?: ReadonlyArray<string>
  /** Ports permitted on otherwise-allowed hosts. Default: [80, 443] in prod;
   *  any in dev. */
  ports?: ReadonlyArray<number>
}

export class SafeFetchError extends Error {
  constructor(public readonly code: SafeFetchErrorCode, message: string) {
    super(message); this.name = 'SafeFetchError'
  }
}

export type SafeFetchErrorCode =
  | 'BLOCKED_PRIVATE_IP'
  | 'BLOCKED_METADATA_IP'
  | 'BLOCKED_LOOPBACK'
  | 'BLOCKED_LINK_LOCAL'
  | 'BLOCKED_SCHEME'
  | 'BLOCKED_HOST'
  | 'BLOCKED_PORT'
  | 'BLOCKED_REDIRECT'
  | 'DNS_FAILURE'
  | 'INTERNAL'

export async function safeFetch(
  url: string | URL,
  options?: SafeFetchOptions,
): Promise<Response>
```

### 3.2 Validation pipeline (executed for every URL — original AND every redirect target)

1. **Scheme check**. `url.protocol` ∈ `allowList.schemes` (default
   `['https:']` in prod). `BLOCKED_SCHEME` otherwise.
2. **Port check**. `url.port` (or scheme default) ∈ `allowList.ports`.
3. **Host syntax check**. Hostname is RFC 1123 (regex
   `/^[a-z0-9.-]+$/i`); reject empty, percent-encoded, IDN until step 4
   normalizes it.
4. **IDN / Unicode normalization**. `new URL(url).hostname` already
   IDN-normalizes; we additionally compare `url.hostname.toLowerCase()`
   to the punycode form to detect Unicode confusables (a future
   tightening, OQ-R1-3).
5. **Hostname allowlist check**. If `allowList.hosts` is set,
   `url.hostname` must equal one of the entries exactly OR end with
   `.<entry>`. `BLOCKED_HOST` otherwise.
6. **DNS resolution + IP check**. Resolve via `dns.promises.lookup(
   hostname, { all: true, verbatim: true })`. For **every** returned
   address, apply the IP filters:
   - `127.0.0.0/8` → `BLOCKED_LOOPBACK`
   - `169.254.0.0/16` → `BLOCKED_LINK_LOCAL` (covers cloud metadata
     IPv4 `169.254.169.254`)
   - `fe80::/10` → `BLOCKED_LINK_LOCAL` (IPv6 link-local)
   - `fd00::/8`, `fc00::/7` → `BLOCKED_PRIVATE_IP` (IPv6 ULA)
   - `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` → `BLOCKED_PRIVATE_IP`
   - `100.64.0.0/10` (CGNAT) → `BLOCKED_PRIVATE_IP`
   - `::1/128` → `BLOCKED_LOOPBACK`
   - `0.0.0.0/8` → `BLOCKED_PRIVATE_IP`
   - GCP metadata: `metadata.google.internal` resolves to `169.254.169.254`
     so step 6's IP check covers it. We add an explicit hostname guard
     for `metadata.google.internal` and `metadata.goog` as
     `BLOCKED_METADATA_IP` so the error message is unambiguous.
   - AWS metadata IPv6: `fd00:ec2::254` → `BLOCKED_METADATA_IP`
7. **Connect**. Issue the request with a `Dispatcher` configured to
   reuse the already-resolved IP (otherwise the OS could rebind the
   hostname between our check and the connect — TOCTOU). The undici
   pattern: `new Agent({ connect: { lookup: (host, opts, cb) => cb(null,
   [{ address: <resolvedIp>, family: 4|6 }]) } })`. We follow the
   existing `a2aFetch` pattern (`apps/web/src/lib/clients/a2a-fetch.ts`
   line 48-50).
8. **Redirect handling**. If `followRedirects === false` (default),
   pass `redirect: 'manual'`. If the response is 3xx with a `Location`,
   throw `BLOCKED_REDIRECT`. If `followRedirects === true`, validate
   the new URL through steps 1-7 and recurse up to `maxRedirects`
   (default 3).
9. **Response size cap**. Default 5 MB body; reading is streamed and a
   reader throws on overflow. Pairs with the existing a2a-agent
   `bodyLimit` middleware (`apps/a2a-agent/src/index.ts:46`).
10. **Timeout**. Default 10s connect + 30s read; both wired via an
    `AbortController` plumbed through `init.signal`.

### 3.3 Default allow-lists (`packages/sdk/src/http/safe-fetch-defaults.ts`)

```ts
export const DEFAULT_ALLOWLIST_WEB_TO_A2A: SafeFetchAllowList = {
  hosts: ['agent.localhost', 'agent.smartagent.io'], // env override
  schemes: process.env.NODE_ENV === 'production' ? ['https:'] : ['http:', 'https:'],
  ports: process.env.NODE_ENV === 'production' ? [443] : [3100, 443],
}

export const DEFAULT_ALLOWLIST_AGENT_TO_CHAIN: SafeFetchAllowList = {
  // Loaded from env at module load time so config is single-sourced.
  hosts: parseRpcAllowedHosts(process.env.RPC_URL_ALLOWLIST),
  schemes: ['https:', 'http:'], // anvil dev uses http; prod uses https
}

export const DEFAULT_ALLOWLIST_USER_PROVIDED_URL: SafeFetchAllowList = {
  // Empty hostname list → ANY hostname allowed (post-IP-check). Schemes
  // restricted to https only in prod. THIS is the allowlist used for S7
  // — credential-offer issuer URLs etc. — and it's the strictest path
  // because hostname is attacker-influenced.
  hosts: [],
  schemes: ['https:'],
  ports: [443],
}
```

Allowlists are designed so the `hosts` list is the **discriminator**: if
the surface knows its callees (S1-S6), populate it. If the surface
accepts arbitrary user URLs (S7), leave it empty and rely on the
IP-filter and scheme check.

### 3.4 Call-site changes

| Call site | Today | After R1 |
|-----------|-------|----------|
| `apps/web/src/lib/clients/a2a-fetch.ts` | wraps `undiciFetch` with the loopback dispatcher | wraps `safeFetch` with `DEFAULT_ALLOWLIST_WEB_TO_A2A`; loopback dispatcher passed through `options.dispatcher` |
| `apps/a2a-agent/src/routes/mcp-proxy.ts` | direct `fetch` to downstream MCP | `safeFetch(url, { allowList: MCP_ALLOWLIST })` where `MCP_ALLOWLIST.hosts` lists every MCP id |
| OID4VCI metadata fetch (`packages/sdk/src/anoncreds/oid4vci-client.ts`, **doesn't exist yet** but will when 1CLAW plan lands) | n/a | `safeFetch(url, { allowList: DEFAULT_ALLOWLIST_USER_PROVIDED_URL })`; pre-emptive entry so future code doesn't bypass |
| `viem.createPublicClient({ transport: http(RPC_URL) })` | bare fetch via viem | wrap viem transport via `http({ fetch: (url, init) => safeFetch(url, { ...init, allowList: DEFAULT_ALLOWLIST_AGENT_TO_CHAIN }) })`; viem's `http` accepts a custom fetch |
| any future webhook subscriber endpoint | n/a | `safeFetch(url, { allowList: DEFAULT_ALLOWLIST_USER_PROVIDED_URL })` |

### 3.5 Egress firewall (infrastructure layer)

`safeFetch` is the application-layer defense. Defense in depth requires
an **egress firewall** at the cluster boundary that drops outbound
traffic to RFC 1918 ranges by default. This is a Spec 007 Phase H IaC
deliverable (`specs/007-architecture-hardening/phase-H-privacy-and-iac.md`).
R1 explicitly does NOT scope the firewall — but the acceptance criteria
include a test that confirms `safeFetch` blocks RFC 1918 BEFORE the
firewall would, so the application is resilient if the firewall is
absent (e.g. a misconfigured staging cluster).

Concretely on the eventual Terraform module (`infra/terraform/aws/
egress.tf` per phase H):

- AWS: VPC endpoint policy + NAT-gateway-fronted security group; deny
  egress to `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`,
  `169.254.0.0/16`, `100.64.0.0/10`; allow `0.0.0.0/0` only after
  passing the deny list.
- GCP: VPC firewall rule with priority 1000 (allow public) + priority
  100 (deny private); IAP for any required internal hop.

## 4. Files to create / change

```
packages/sdk/src/http/
├── safe-fetch.ts              NEW — the wrapper
├── safe-fetch-defaults.ts     NEW — DEFAULT_ALLOWLIST_* constants
├── safe-fetch-ip-filter.ts    NEW — IP-range matching (extracted for test)
└── __tests__/
    ├── safe-fetch.test.ts             NEW — unit tests, see §6
    ├── safe-fetch-redirect.test.ts    NEW — redirect-target validation
    └── safe-fetch-toctou.test.ts      NEW — TOCTOU via dispatcher lookup
```

Updates:

```
apps/web/src/lib/clients/a2a-fetch.ts           — route through safeFetch
apps/a2a-agent/src/routes/mcp-proxy.ts          — route through safeFetch
apps/a2a-agent/src/lib/chain-client.ts          — viem transport wrapped
packages/sdk/src/index.ts                       — re-export safeFetch
```

CI:

```
scripts/check-no-raw-fetch.sh    NEW — fails CI if `fetch(` appears in
                                  any app/web/, app/a2a-agent/, packages/sdk/
                                  source file outside the allowlist
                                  (a2a-fetch.ts and safe-fetch.ts).
```

## 5. Implementation steps

| Day | Task |
|-----|------|
| 1 | Re-audit §1.1 table; commit any missed surface as an issue. Stub `packages/sdk/src/http/safe-fetch.ts` with types only. |
| 2 | Implement `safe-fetch-ip-filter.ts` + unit tests (table-driven; one row per CIDR). |
| 3 | Implement steps 1-7 of §3.2 + redirect handling. Wire timeout + body cap. |
| 4 | Implement allowlist defaults; wire viem transport + a2aFetch + mcp-proxy. Run full app under `safeFetch` in dev. |
| 5 | Write `scripts/check-no-raw-fetch.sh` + add to CI. Write integration test simulating malicious credential-offer URL targeting `169.254.169.254`. |
| 6 | Code review; tighten; merge. |

## 6. Test plan

### 6.1 Unit tests (`safe-fetch.test.ts`)

For each error code in `SafeFetchErrorCode`, one happy + one denial test:

| Input URL | Expected outcome |
|-----------|------------------|
| `http://169.254.169.254/` | `BLOCKED_METADATA_IP` |
| `http://[fd00:ec2::254]/` | `BLOCKED_METADATA_IP` |
| `http://metadata.google.internal/` | `BLOCKED_METADATA_IP` |
| `http://localhost/` | `BLOCKED_LOOPBACK` |
| `http://127.0.0.1/` | `BLOCKED_LOOPBACK` |
| `http://[::1]/` | `BLOCKED_LOOPBACK` |
| `http://10.1.2.3/` | `BLOCKED_PRIVATE_IP` |
| `http://172.20.0.5/` | `BLOCKED_PRIVATE_IP` |
| `http://192.168.1.1/` | `BLOCKED_PRIVATE_IP` |
| `http://[fc00::1]/` | `BLOCKED_PRIVATE_IP` |
| `http://[fe80::1]/` | `BLOCKED_LINK_LOCAL` |
| `ftp://example.com/` | `BLOCKED_SCHEME` |
| `http://example.com:22/` | `BLOCKED_PORT` (prod) |
| `http://attacker.test/`, allowList = `{hosts:['api.smartagent.io']}` | `BLOCKED_HOST` |
| `https://api.smartagent.io/health`, allowList present | `ok 200` |

### 6.2 Integration tests

- **Redirect target check**: stub server responds 302 → `http://169.254.169.254/`.
  `safeFetch` with `followRedirects:true` must throw `BLOCKED_REDIRECT`.
- **TOCTOU**: a mock DNS resolver returns `1.2.3.4` on first call,
  `127.0.0.1` on second. `safeFetch` must connect to `1.2.3.4` (the
  validated IP), NOT re-resolve.
- **Credential-offer SSRF** (S7 scenario): feed a synthetic OID4VCI
  offer with `credential_issuer = "http://169.254.169.254"` through the
  wallet code (once 1CLAW plan provides the entry-point); assert the
  fetch is blocked and the error is surfaced to the user with a non-
  leaky message.

### 6.3 CI guards

- `scripts/check-no-raw-fetch.sh` fails when a new `fetch(` appears in
  guarded paths.
- ESLint custom rule `no-unsafe-fetch`: reports `fetch` / `undiciFetch`
  imports in `apps/web/src` and `apps/a2a-agent/src` (allowlist: the
  two wrapper files).

### 6.4 Manual penetration test

Add to `docs/security/runtime/pentest-cases.md` (created here):

1. Start a malicious OID4VCI issuer at `http://attacker.test:8080/`
   returning `Location: http://169.254.169.254/` on the metadata
   endpoint.
2. Have a demo user accept the offer.
3. Assert: zero outbound packets toward `169.254.0.0/16` per `tcpdump`.

## 7. Acceptance criteria

- [ ] `safeFetch` exists, exports the API in §3.1.
- [ ] Every call-site row in §3.4 routes through `safeFetch`.
- [ ] `scripts/check-no-raw-fetch.sh` is wired into CI.
- [ ] Unit + integration tests in §6 all pass.
- [ ] `pnpm typecheck` clean.
- [ ] Spec 007 phase H IaC item references this doc as the
      application-layer counterpart.

## 8. Vendor references

- OWASP SSRF cheat sheet: https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
- AWS IMDS lockdown: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-IMDS-options.html (IMDSv2 with hop-limit 1 is the production guard; safeFetch is the dev/staging guard)
- GCP metadata server: https://cloud.google.com/compute/docs/metadata/overview
- undici `Agent` for custom DNS: https://undici.nodejs.org/#/docs/api/Agent

## 9. Open questions

- **OQ-R1-1**: Should `safeFetch` log every denial to the audit chain
  (Spec 007 audit-checkpoint), or only sample? Proposal: log every
  denial in prod, sample 10 % in dev to avoid filling the chain during
  Playwright sweeps.
- **OQ-R1-2**: Do we maintain a separate allowlist per MCP id, or one
  flat list keyed on the proxy mount? Proposal: per-MCP — aligns with
  Phase E's per-MCP tool allowlist.
- **OQ-R1-3**: How aggressive is the Unicode-confusable check? IDN
  homograph attacks (e.g. `аpi.smartagent.io` with Cyrillic `а`) are
  blocked by hostname-allowlist matching since `аpi != api`, but a
  user-URL surface (S7) bypasses the allowlist. Proposal: defer until
  we have a real OID4VCI flow; add a TODO with the URL of OWASP
  guidance.
- **OQ-R1-4**: viem transport instantiation — should we proxy at the
  transport layer or the public-client level? Transport is cleaner;
  public-client is less invasive. Proposal: transport (per §3.4 row).

## 10. Effort summary

| Stream | Days |
|--------|------|
| Implementation (safe-fetch.ts + filters) | 3 |
| Call-site migration | 1 |
| Tests + CI guards | 1.5 |
| Pen test scenario + writeup | 0.5 |
| Code review iteration | 1 |
| **Total** | **7 days (M)** |
