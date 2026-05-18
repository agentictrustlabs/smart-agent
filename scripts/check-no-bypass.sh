#!/usr/bin/env bash
# scripts/check-no-bypass.sh
#
# A2A+MCP consolidation guardrail. Greps `apps/web/src` for forbidden
# direct-MCP bypasses and fails (non-zero exit) unless every hit is on
# the documented allowlist. Wire into `pnpm check:bypass` and CI so
# future PRs can't reintroduce a *_MCP_URL fetch in the web layer.
#
# Forbidden tokens (every one is a documented violation when present
# in `apps/web/src` outside of bootstrap):
#   PERSON_MCP_URL  ORG_MCP_URL  PEOPLE_GROUP_MCP_URL  HUB_MCP_URL
#   FAMILY_MCP_URL  GEO_MCP_URL  VERIFIER_MCP_URL  SKILL_MCP_URL
#   DiscoveryService.fromEnv()
#
# Each forbidden hit must be on the ALLOWLIST below. The allowlist is
# kept short and intentional; new entries require:
#   1. A code comment at the use site naming the bootstrap / open-protocol
#      reason the call can't route through A2A.
#   2. A matching entry in docs/architecture/01-web-a2a-mcp-flows.md.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
WEB_SRC="$ROOT/apps/web/src"

if [[ ! -d "$WEB_SRC" ]]; then
  echo "[check-no-bypass] $WEB_SRC not found — wrong CWD?" >&2
  exit 2
fi

# Files explicitly allowed to reference forbidden tokens. Path is
# relative to apps/web/src. Keep in sync with
# docs/architecture/01-web-a2a-mcp-flows.md § Allowlist.
ALLOWLIST=(
  # Health check probes the underlying MCP HTTP ports directly so we
  # can distinguish "A2A is fine but person-mcp is down" from "A2A is
  # down". Pure liveness probe; not part of any user action.
  "app/api/system-readiness/route.ts"
  # First-run boot seed bootstraps the seed data before any user is in
  # the system, before any A2A session can exist.
  "app/api/boot-seed/route.ts"
  "lib/boot-seed.ts"
  # Demo-seed / fresh-start helpers. Run at boot; not part of any
  # user-action path.
  "lib/demo-seed"
  # Open OID4VCI issuer / verifier protocol surfaces (`ssi/clients.ts`
  # implements an open W3C standard; the *_MCP_URL refs are protocol
  # endpoints, not internal RPC). `ssi/config.ts` carries the URLs.
  "lib/ssi/clients.ts"
  "lib/ssi/config.ts"
  # ── Phase-2 consolidation closed (Sprint 4 A.4) ─────────────────────
  # The four `TODO(phase-2-consolidation)` allowlist entries below were
  # closed in Sprint 4 A.4:
  #   - lib/spec004/self-issue.ts            → ssi_get_holder_wallet MCP tool
  #   - components/agent/PeopleGroupFocusSection.tsx → callMcp('people-group', 'list_segments', {publicOnly:true})
  #   - components/dashboard/HubDashboard.tsx → hubListRounds (callHub)
  #   - lib/ontology/graphdb-sync.ts          → debug:agents_turtle MCP tool
  # No new allowlist drift is permitted — every web→MCP call now routes
  # through callMcp / callHub. New direct *_MCP_URL fetches in apps/web/src
  # MUST fail this guard.
)

PATTERN='PERSON_MCP_URL|ORG_MCP_URL|PEOPLE_GROUP_MCP_URL|HUB_MCP_URL|FAMILY_MCP_URL|GEO_MCP_URL|VERIFIER_MCP_URL|SKILL_MCP_URL|DiscoveryService\.fromEnv'

# Collect every hit (path:line:content), then filter out the allowlist
# and any lines that are inside a comment (// or *).
HITS=$(grep -RIn -E "$PATTERN" "$WEB_SRC" 2>/dev/null || true)

VIOLATIONS=()
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  # Strip the apps/web/src/ prefix for matching against ALLOWLIST.
  rel=${line#*apps/web/src/}
  path=${rel%%:*}
  # Skip if path starts with any allowlisted prefix.
  skip=0
  for allowed in "${ALLOWLIST[@]}"; do
    if [[ "$path" == "$allowed" || "$path" == "$allowed"/* ]]; then
      skip=1
      break
    fi
  done
  [[ $skip -eq 1 ]] && continue
  # Skip pure comment lines (// or starts with leading * inside a /* */ block).
  content=${line#*:*:}
  trimmed="${content#"${content%%[![:space:]]*}"}"
  case "$trimmed" in
    "//"*|"*"*|"/*"*) continue ;;
  esac
  VIOLATIONS+=("$line")
done <<< "$HITS"

if [[ ${#VIOLATIONS[@]} -ne 0 ]]; then
  echo "[check-no-bypass] FAIL — direct-MCP bypasses found in apps/web/src:" >&2
  printf '  %s\n' "${VIOLATIONS[@]}" >&2
  echo "" >&2
  echo "Every reference must either route through callMcp / callHub / A2A" >&2
  echo "passthroughs, or be added to the allowlist in this script + the" >&2
  echo "matching section of docs/architecture/01-web-a2a-mcp-flows.md." >&2
  exit 1
fi

# ─── KMS-substrate invariant (KMS migration K0+K1) ───────────────────
# Route handlers MUST NOT import any KMS / crypto-as-a-service SDK
# directly. The only allowed callers are the app-layer wrappers under
# `apps/a2a-agent/src/auth/` (`encryption.ts` for envelope encrypt/decrypt,
# future `a2aSigner.ts` for asymmetric sign, future `serviceAuth.ts` for
# HMAC). Provider-neutral: the invariant is "no direct KMS SDK in routes",
# not "no AWS SDK in routes" — every backend (AWS KMS, HCP Vault Transit,
# GCP KMS, Azure Key Vault) is equally forbidden here.
#
# See KMS-IMPLEMENTATION-PLAN.md §2.1 "No-direct-KMS invariant".
KMS_SDK_PATTERN='@aws-sdk/client-kms|@hashicorp/vault-client|node-vault|@google-cloud/kms|@azure/keyvault-keys|@azure/keyvault-secrets'
KMS_ROUTES_DIR="$ROOT/apps/a2a-agent/src/routes"
if [[ -d "$KMS_ROUTES_DIR" ]]; then
  KMS_HITS=$(grep -RIn -E "$KMS_SDK_PATTERN" "$KMS_ROUTES_DIR" 2>/dev/null || true)
  if [[ -n "$KMS_HITS" ]]; then
    echo "[check-no-bypass] FAIL — direct KMS SDK import in route handler(s):" >&2
    echo "$KMS_HITS" >&2
    echo "" >&2
    echo "Route handlers MUST go through apps/a2a-agent/src/auth/encryption.ts" >&2
    echo "(and future a2aSigner / serviceAuth wrappers). Direct KMS SDK imports" >&2
    echo "in routes are forbidden by KMS-IMPLEMENTATION-PLAN.md §2.1." >&2
    echo "Forbidden SDKs: $KMS_SDK_PATTERN" >&2
    exit 1
  fi
fi

# ─── K6 invariant — DEPLOYER_PRIVATE_KEY MUST NOT appear in request handlers ──
# The deployer private key is a CI/CD-only secret used by `forge script
# Deploy.s.sol` to deploy contracts. After K6 it must NEVER be referenced
# from a request-handler path. Allowed contexts:
#
#   - `apps/web/src/lib/demo-seed/**` — deploy/seed-time helpers invoked
#     from boot scripts, never from request handlers (already on the
#     direct-MCP bypass allowlist above).
#   - `apps/web/src/lib/boot-seed.ts` — one-shot boot seeding driver,
#     same exemption.
#   - `scripts/**` — operator / CI tooling.
#   - `packages/contracts/**` — Foundry deploy scripts.
#   - Top-level `apps/web/src/lib/` modules used ONLY by demo-seed or
#     boot-seed (transitively deploy-time), are explicitly listed below.
#
# Any reference under `apps/web/src/app/api/**/route.ts` or
# `apps/a2a-agent/src/routes/**` is a runtime regression UNLESS it
# appears on the K6_ROUTE_HANDLER_ALLOWLIST below. Each allowlist
# entry documents the migration target (Category C or D) and a
# follow-up ticket.
#
# See `docs/operations/kms-signer-setup.md` § "Deployer key (K6 —
# CI/CD only)" for the operator runbook.
DEPLOYER_KEY_TOKEN='DEPLOYER_PRIVATE_KEY'
ROUTE_HANDLER_PATHS=(
  "$ROOT/apps/web/src/app/api"
  "$ROOT/apps/a2a-agent/src/routes"
)
# Per-file allowlist for the K6 invariant. Path is relative to repo root.
# Every entry MUST link to a follow-up ticket / migration plan in the
# matching section of `docs/architecture/01-web-a2a-mcp-flows.md` § K6.
# Removing an entry from this list requires migrating its callers to
# either the user's session signer (Category C) or a new tool-executor
# identity registered in `TOOL_EXECUTOR_IDS` (Category D).
K6_ROUTE_HANDLER_ALLOWLIST=(
  # K6-D1 RESOLVED (S1.5): the three bootstrap-auth routes
  # (siwe-verify, passkey-signup, google-callback) migrated to the
  # `auth-bootstrap` tool-executor signer registered in TOOL_EXECUTOR_IDS.
  # The deployer key MUST NOT reappear in those handlers — this guard
  # now catches any regression.
  #
  # EXEMPT: check-agent-name needs the deployer ADDRESS (not the private
  # key) to compute a counterfactual smart-account address preview for
  # the passkey-signup UI. The route prefers `DEPLOYER_ADDRESS` env var
  # and falls back to deriving the address from `DEPLOYER_PRIVATE_KEY`
  # ONLY in local-dev where both vars co-exist. In production the K6
  # hard-fail (`assertDeployerKeyPolicy`) refuses startup if the private
  # key is present, so the fallback is unreachable in prod. This is a
  # permanent local-dev exemption, not a migration debt.
  "apps/web/src/app/api/auth/check-agent-name/route.ts"
)

ROUTE_HANDLER_VIOLATIONS=()
for handler_root in "${ROUTE_HANDLER_PATHS[@]}"; do
  [[ -d "$handler_root" ]] || continue
  hits=$(grep -RIn -E "$DEPLOYER_KEY_TOKEN" "$handler_root" 2>/dev/null || true)
  [[ -z "$hits" ]] && continue
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    # Strip the repo prefix for matching against ALLOWLIST.
    rel=${line#"$ROOT/"}
    path=${rel%%:*}
    # Skip if path is on the K6 allowlist.
    skip=0
    for allowed in "${K6_ROUTE_HANDLER_ALLOWLIST[@]}"; do
      if [[ "$path" == "$allowed" ]]; then
        skip=1
        break
      fi
    done
    [[ $skip -eq 1 ]] && continue
    # Skip pure comment lines (// or starts with leading * inside a /* */ block).
    content=${line#*:*:}
    trimmed="${content#"${content%%[![:space:]]*}"}"
    case "$trimmed" in
      "//"*|"*"*|"/*"*|"#"*) continue ;;
    esac
    ROUTE_HANDLER_VIOLATIONS+=("$line")
  done <<< "$hits"
done

if [[ ${#ROUTE_HANDLER_VIOLATIONS[@]} -ne 0 ]]; then
  echo "[check-no-bypass] FAIL — DEPLOYER_PRIVATE_KEY referenced in request-handler path(s):" >&2
  printf '  %s\n' "${ROUTE_HANDLER_VIOLATIONS[@]}" >&2
  echo "" >&2
  echo "The deployer private key is a CI/CD-only secret used by " >&2
  echo "\`forge script Deploy.s.sol\`. It MUST NOT be referenced from any" >&2
  echo "request-handler path. Migrate the call site to:" >&2
  echo "  - the user's session signer (Category C), or" >&2
  echo "  - a tool-executor signer registered in TOOL_EXECUTOR_IDS (Category D)." >&2
  echo "Seed scripts under apps/web/src/lib/demo-seed/** and " >&2
  echo "apps/web/src/lib/boot-seed.ts are exempt (deploy-time only)." >&2
  echo "If this site is a known migration debt, add it to the" >&2
  echo "K6_ROUTE_HANDLER_ALLOWLIST in this script with a TODO link." >&2
  echo "See docs/operations/kms-signer-setup.md § \"Deployer key (K6 — CI/CD only)\"." >&2
  exit 1
fi

# ─── GCP KMS SDK isolation invariant (GCP-KMS G-PR-1) ──────────────────
# `@google-cloud/kms` and `google-auth-library` may only be imported from
# `packages/sdk/src/key-custody/`. Mirrors the AWS-SDK isolation rule
# above (KMS-IMPLEMENTATION-PLAN §2.1) and the matching invariant for
# `@google-cloud/kms` in the KMS_SDK_PATTERN check on the a2a-agent
# routes. Centralising every KMS / cloud-auth client behind the
# `key-custody` barrel preserves the substrate-independence rule (P1):
# we can swap or remove a backend with a single-directory blast radius.
GCP_SDK_PATTERN='@google-cloud/kms|google-auth-library'
GCP_SDK_ALLOWED_DIR="$ROOT/packages/sdk/src/key-custody"
GCP_SDK_VIOLATIONS=()
if command -v grep >/dev/null 2>&1; then
  # Search ALL TS/JS source files in the repo, then filter to only
  # report hits OUTSIDE the allowed directory. node_modules and build
  # outputs are excluded.
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    file=${line%%:*}
    # Skip if the file is inside the allowed directory.
    case "$file" in
      "$GCP_SDK_ALLOWED_DIR"/*) continue ;;
    esac
    # Skip pure comment lines (// or starts with leading * inside a /* */ block).
    content=${line#*:*:}
    trimmed="${content#"${content%%[![:space:]]*}"}"
    case "$trimmed" in
      "//"*|"*"*|"/*"*|"#"*) continue ;;
    esac
    GCP_SDK_VIOLATIONS+=("$line")
  done < <(
    grep -RIn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' --include='*.cjs' \
      --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=dist --exclude-dir=build \
      -E "from ['\"]($GCP_SDK_PATTERN)['\"]|require\(['\"]($GCP_SDK_PATTERN)['\"]\)" \
      "$ROOT/apps" "$ROOT/packages" "$ROOT/scripts" 2>/dev/null || true
  )
fi

if [[ ${#GCP_SDK_VIOLATIONS[@]} -ne 0 ]]; then
  echo "[check-no-bypass] FAIL — @google-cloud/kms or google-auth-library imported outside packages/sdk/src/key-custody/:" >&2
  printf '  %s\n' "${GCP_SDK_VIOLATIONS[@]}" >&2
  echo "" >&2
  echo "Both packages MUST only be imported from packages/sdk/src/key-custody/" >&2
  echo "(GCP-KMS-IMPLEMENTATION-PLAN.md § G8). All cloud-KMS / cloud-auth" >&2
  echo "clients are centralised behind the key-custody barrel so backends" >&2
  echo "can be swapped or removed with single-directory blast radius (P1)." >&2
  exit 1
fi

# ─── Session-store signed-fetch invariant (Sprint 5 Wave 2 P1-1) ─────
# Every web→a2a `/session-store/*` call (read or write) MUST go through
# the signed-envelope helper in
# `apps/web/src/lib/auth/person-mcp-session-client.ts` (or any future
# extension that reuses its `signedHeadersFor` builder). A bare
# `fetch(...session-store...)` from anywhere under `apps/web/src/`
# bypasses `requireServiceAuth('web')` at the a2a edge and re-introduces
# the metadata leak P1-1 closed. The session-store client itself uses
# the helper, so we allow it to call fetch on a session-store URL.
SESSION_STORE_FETCH_PATTERN='fetch\([^)]*session-store'
SESSION_STORE_ALLOWLIST=(
  # The signed-fetch helper. Every fetch in this file is wrapped by
  # `signedHeadersFor(path, body)` — it IS the canonical entry point.
  "lib/auth/person-mcp-session-client.ts"
)
SESSION_STORE_VIOLATIONS=()
if [[ -d "$WEB_SRC" ]]; then
  SESSION_STORE_HITS=$(grep -RIn -E "$SESSION_STORE_FETCH_PATTERN" "$WEB_SRC" 2>/dev/null || true)
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    rel=${line#*apps/web/src/}
    path=${rel%%:*}
    skip=0
    for allowed in "${SESSION_STORE_ALLOWLIST[@]}"; do
      if [[ "$path" == "$allowed" || "$path" == "$allowed"/* ]]; then
        skip=1
        break
      fi
    done
    [[ $skip -eq 1 ]] && continue
    # Skip pure comment lines.
    content=${line#*:*:}
    trimmed="${content#"${content%%[![:space:]]*}"}"
    case "$trimmed" in
      "//"*|"*"*|"/*"*|"#"*) continue ;;
    esac
    SESSION_STORE_VIOLATIONS+=("$line")
  done <<< "$SESSION_STORE_HITS"
fi

if [[ ${#SESSION_STORE_VIOLATIONS[@]} -ne 0 ]]; then
  echo "[check-no-bypass] FAIL — unsigned session-store fetch in apps/web/src:" >&2
  printf '  %s\n' "${SESSION_STORE_VIOLATIONS[@]}" >&2
  echo "" >&2
  echo "Sprint 5 Wave 2 P1-1: every /session-store/* call (read or write)" >&2
  echo "MUST go through the signed-envelope helper in" >&2
  echo "apps/web/src/lib/auth/person-mcp-session-client.ts (signedHeadersFor)." >&2
  echo "Bare fetch() to /session-store/* bypasses requireServiceAuth('web')" >&2
  echo "at the a2a edge and re-opens the session-metadata leak P1-1 closed." >&2
  exit 1
fi

# ─── Append-only audit invariant (Hardening Phase 1D, tightened by P0-5) ───
# `execution_audit` is STRICTLY append-only at the application layer.
# Every helper in `apps/a2a-agent/src/lib/audit.ts` (auditAppend,
# auditFinalize, auditDeny) is an INSERT. NO file — not even
# `lib/audit.ts` — may call `db.update(executionAudit)` or
# `db.delete(executionAudit)`. Outcome rows (`request_finalized` /
# `request_denied`) are hash-chained NEW rows that bind the origin row's
# PK + the outcome columns, so the chain is tamper-evident on both
# request and outcome sides. Comments / string literals naming the
# pattern (e.g. inside doc comments or error messages) are tolerated.
AUDIT_APPEND_PATTERN='\.(update|delete)\(executionAudit\)'
AUDIT_A2A_SRC="$ROOT/apps/a2a-agent/src"
AUDIT_HELPER="$AUDIT_A2A_SRC/lib/audit.ts"
if [[ -d "$AUDIT_A2A_SRC" ]]; then
  AUDIT_HITS=$(grep -RIn -E "$AUDIT_APPEND_PATTERN" "$AUDIT_A2A_SRC" 2>/dev/null || true)
  AUDIT_VIOLATIONS=()
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    # Skip pure comment lines (// or starts with leading * inside a /* */ block).
    content=${line#*:*:}
    trimmed="${content#"${content%%[![:space:]]*}"}"
    case "$trimmed" in
      "//"*|"*"*|"/*"*|"#"*) continue ;;
    esac
    AUDIT_VIOLATIONS+=("$line")
  done <<< "$AUDIT_HITS"

  if [[ ${#AUDIT_VIOLATIONS[@]} -ne 0 ]]; then
    echo "[check-no-bypass] FAIL — execution_audit is append-only; UPDATE/DELETE call site(s) detected:" >&2
    printf '  %s\n' "${AUDIT_VIOLATIONS[@]}" >&2
    echo "" >&2
    echo "Audit rows are written via auditAppend / auditFinalize / auditDeny in" >&2
    echo "$AUDIT_HELPER — every helper is an INSERT (P0-5 two-row outcome model)." >&2
    echo "Outcome must be encoded as a NEW hash-chained row, never as a mutation" >&2
    echo "of an existing one. See Hardening Phase 1D #3 (append-only invariant)" >&2
    echo "and P0-5 (outcome binding)." >&2
    exit 1
  fi
fi

# ─── P0-4 invariant — denyAndAudit gate on high-risk routes ──────────
# Sprint 5 Wave 2 P0-4: across the four redeem variants and the
# deploy-agent route, every 4xx/5xx exit MUST call `denyAndAudit(...)`
# so the chain has a hash-bound terminal row for every authority
# decision. A raw `c.json({error}, 4xx_or_5xx)` in these files is a
# regression — it leaves a `request_received` row without a matching
# `request_denied` row, indistinguishable from an open request.
#
# Scope: `apps/a2a-agent/src/routes/onchain-redeem.ts` (and any sibling
# files that mint on-chain action — add them to P0_4_FILES below).
#
# Allowed exit shapes in these files:
#   - `return c.json({ ... })`            — 2xx (status omitted, default 200)
#   - `return c.json({ ... }, 200)`       — explicit 2xx
#   - `return denyAndAudit(c, { ... })`   — every 4xx/5xx
#
# Disallowed: any `c.json(..., 4xx|5xx)` outside a denyAndAudit call.
P0_4_FILES=(
  "$ROOT/apps/a2a-agent/src/routes/onchain-redeem.ts"
)
P0_4_BARE_PATTERN='c\.json\([^)]*,[[:space:]]*[45][0-9][0-9][[:space:]]*\)'
P0_4_VIOLATIONS=()
for f in "${P0_4_FILES[@]}"; do
  [[ -f "$f" ]] || continue
  hits=$(grep -nE "$P0_4_BARE_PATTERN" "$f" 2>/dev/null || true)
  [[ -z "$hits" ]] && continue
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    content=${line#*:}
    trimmed="${content#"${content%%[![:space:]]*}"}"
    case "$trimmed" in
      "//"*|"*"*|"/*"*|"#"*) continue ;;
    esac
    P0_4_VIOLATIONS+=("$f:$line")
  done <<< "$hits"
done

if [[ ${#P0_4_VIOLATIONS[@]} -ne 0 ]]; then
  echo "[check-no-bypass] FAIL — P0-4: raw c.json(..., 4xx|5xx) in route(s) requiring denyAndAudit():" >&2
  printf '  %s\n' "${P0_4_VIOLATIONS[@]}" >&2
  echo "" >&2
  echo "Every 4xx/5xx exit in the redeem + deploy-agent routes MUST go through" >&2
  echo "denyAndAudit(c, { reason, status, ... }) so a request_denied audit row" >&2
  echo "is hash-chained for every authority decision. See" >&2
  echo "apps/a2a-agent/src/lib/audit.ts (denyAndAudit) and" >&2
  echo "apps/a2a-agent/src/lib/audit-deny-reasons.ts (AUDIT_DENY_REASONS)." >&2
  exit 1
fi

echo "[check-no-bypass] OK — no direct-MCP bypasses in apps/web/src, no direct KMS SDK imports in a2a-agent routes, no @google-cloud/kms or google-auth-library imports outside packages/sdk/src/key-custody, no DEPLOYER_PRIVATE_KEY in route handlers outside K6 deployer-name exemption (${#K6_ROUTE_HANDLER_ALLOWLIST[@]} entr$([ ${#K6_ROUTE_HANDLER_ALLOWLIST[@]} -eq 1 ] && echo y || echo ies)), all /session-store/* fetches in apps/web/src go through signed-envelope helper, execution_audit append-only invariant holds, P0-4 denyAndAudit invariant holds in ${#P0_4_FILES[@]} file(s)."
exit 0
