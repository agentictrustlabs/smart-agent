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
  # TODO(phase-2-consolidation): pre-existing bypass drift discovered when
  # the Phase-1 hardening run wired `check:bypass` into CI for the first
  # time. Each of these has a documented migration target and should be
  # closed in the Phase-2 follow-up sprint. Removing an entry from this
  # list requires migrating its callers to `callMcp`/`callHub`.
  "lib/spec004/self-issue.ts"            # needs ssi_get_holder_wallet MCP tool
  "components/agent/PeopleGroupFocusSection.tsx"  # needs people-group MCP tool wrapping list_focus
  "components/dashboard/HubDashboard.tsx"         # needs discovery via callHub('hub', 'discovery:list_agents')
  "lib/ontology/graphdb-sync.ts"         # debug turtle endpoint — migrate to callHub('hub', 'debug:agents_turtle')
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
  # TODO(K6-D1): migrate to a dedicated `auth-bootstrap` tool-executor
  # signer (Category D). The deployer-as-initial-owner factory pattern
  # is correct architecturally; the KEY just needs to leave runtime
  # env and live in a per-tool KMS slot. See
  # docs/operations/kms-signer-setup.md § "Deployer key" and
  # docs/architecture/01-web-a2a-mcp-flows.md § K6.
  "apps/web/src/app/api/auth/siwe-verify/route.ts"
  "apps/web/src/app/api/auth/passkey-signup/route.ts"
  "apps/web/src/app/api/auth/google-callback/route.ts"
  # TODO(K6-C1): check-agent-name only needs the deployer ADDRESS to
  # derive a counterfactual smart-account address for UX preview.
  # Migrate to read `DEPLOYER_ADDRESS` env var (Category C-trivial).
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

# ─── Append-only audit invariant (Hardening Phase 1D) ───────────────
# `execution_audit` is append-only at the application layer. The only
# sanctioned UPDATE site is `auditFinalize()` in
# `apps/a2a-agent/src/lib/audit.ts`, which flips a `pending` row to
# `completed` / `reverted` after a chain tx settles. No other file in
# `apps/a2a-agent/src/` may call `db.update(executionAudit)` or
# `db.delete(executionAudit)`. Comments / string literals naming the
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
    # Skip the one sanctioned site — the auditFinalize helper.
    rel=${line#"$ROOT/"}
    relpath=${rel%%:*}
    path=${relpath#apps/a2a-agent/src/}
    if [[ "$path" == "lib/audit.ts" ]]; then
      continue
    fi
    AUDIT_VIOLATIONS+=("$line")
  done <<< "$AUDIT_HITS"

  if [[ ${#AUDIT_VIOLATIONS[@]} -ne 0 ]]; then
    echo "[check-no-bypass] FAIL — execution_audit is append-only; UPDATE/DELETE outside auditFinalize() detected:" >&2
    printf '  %s\n' "${AUDIT_VIOLATIONS[@]}" >&2
    echo "" >&2
    echo "Audit rows are written via auditAppend() (INSERT only) and the single" >&2
    echo "outcome-update helper auditFinalize() in $AUDIT_HELPER. Add new audit" >&2
    echo "state via a new row, never mutate an existing one. See Hardening" >&2
    echo "Phase 1D #3 (append-only invariant)." >&2
    exit 1
  fi
fi

echo "[check-no-bypass] OK — no direct-MCP bypasses in apps/web/src, no direct KMS SDK imports in a2a-agent routes, no DEPLOYER_PRIVATE_KEY in route handlers outside K6 allowlist, execution_audit append-only invariant holds."
exit 0
