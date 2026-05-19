# Runtime Security Plans — R1..R10

> **Scope**: board-presentable, developer-actionable runtime hardening tasks.
> Every doc here is an implementation plan, not a survey. Each one names
> concrete files, vendors, costs, acceptance criteria, and an effort tag
> (S = ≤3 days, M = 1 week, L = 2-3 weeks).
>
> These plans assume the Spec 007 contract / signer / storage hardening
> (`specs/007-architecture-hardening/plan.md`) is landing in parallel.
> Where one of these plans touches a Spec 007 surface (e.g. R8 cookie
> changes interact with Phase F.2 Postgres-backed session tables) it
> calls out the dependency explicitly.

## Reading order

The docs are independent — pick any one — but the recommended sequence
is the order in which they earn risk reduction per dev-week:

| # | Doc | Risk class | Effort | Status |
|---|-----|-----------|--------|--------|
| R1 | [SSRF Protection](./R1-ssrf-protection.md) | Server compromise / metadata exfil | M | Draft |
| R2 | [WAF and DDoS](./R2-waf-and-ddos.md) | Edge availability + L7 abuse | S (config) + M (rules) | Draft |
| R3 | [Content Security Policy](./R3-content-security-policy.md) | XSS, data exfil | M | Draft |
| R4 | [Clickjacking Protection](./R4-clickjacking-protection.md) | UI redress / WalletAction frame attacks | S | Draft |
| R5 | [Brute-Force Protection](./R5-brute-force-protection.md) | Auth surface abuse | M | Draft |
| R6 | [Bot Detection](./R6-bot-detection.md) | Account abuse / cost amplification | S | Draft |
| R7 | [Session Fixation Testing](./R7-session-fixation-testing.md) | Session hijack | S | Draft |
| R8 | [Cookie Security Hardening](./R8-cookie-security-hardening.md) | Cookie theft / scope abuse | S | Draft |
| R9 | [MCP Fuzzing](./R9-mcp-fuzzing.md) | Tool-handler panics / info leak | L | Draft |
| R10 | [Dependency Vuln Scanning](./R10-dependency-vuln-scanning.md) | Supply chain | S (setup) + ongoing | Draft |

## Cross-cutting principles

1. **Substrate independence applies here too** (`docs/architecture/principles.md`).
   We may *use* third-party WAFs and scanners but never let them be the
   only line of defense — every R1..R10 control has an in-repo enforcement
   layer that survives a vendor outage.

2. **No silent fallbacks**. Hardening primitives fail loud; they never
   degrade to permissive behavior on misconfiguration. Mirrors the Spec
   007 north-star goal #4.

3. **Dev parity** (memory: `feedback_no_patches_dev_mode.md`). Controls
   must run identically in dev and prod. Where a control is genuinely
   prod-only (e.g. CAPTCHA), the dev no-op path is documented and tested.

4. **CI-detectable invariants**. Every control adds at least one CI guard
   so regressions surface in PR, not in incident response.

## Operator handoff

For each plan:
- The **Files to change** section is exhaustive — `git grep` confirms.
- The **Effort** tag bounds dev time; vendor procurement is separate.
- The **Acceptance** section is the merge gate.
- The **Test plan** is the QA gate.
- A row in `docs/specs/roadmap.md` is added when picked up.

Open questions are flagged with `OQ-<doc>-<n>` and owned by the doc author.
