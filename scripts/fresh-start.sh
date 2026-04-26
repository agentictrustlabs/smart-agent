#!/usr/bin/env bash
set -euo pipefail

# ───────────────────────────────────────────────────────────────────────
# Smart Agent — Fresh Start
# ───────────────────────────────────────────────────────────────────────
#
# One command to wipe every piece of local state and bring the dev stack
# up from zero with new contract addresses, fresh databases, and a fully
# seeded demo community.
#
# Run this when:
#   • You changed a contract and need a redeploy (= new addresses).
#   • You want clean community/hub/wallet state.
#   • You're debugging something that smells like stale data.
#
# Usage:
#   scripts/fresh-start.sh                # full reset, wait for ready
#   scripts/fresh-start.sh --no-wait      # skip readiness polling
#   scripts/fresh-start.sh --no-services  # only deploy + seed; don't start servers
#
# Where things live afterwards:
#   • Anvil:           pid=tmp/pids/anvil.pid       log=tmp/logs/anvil.log
#   • Each service:    pid=tmp/pids/<svc>.pid       log=tmp/logs/<svc>.log
#   • Web (Next.js):   pid=tmp/pids/web.pid         log=tmp/logs/web.log
#
# ─── How to extend (KEEP THIS UPDATED) ─────────────────────────────────
#   • New backend service?  add it to the SERVICES array below.
#   • New stateful path?    add the glob to the WIPE_PATHS array.
#   • New seed step that
#     runs after deploy?    append a step to seed_after_deploy() below.
#   • New service uses
#     contract addresses?   add it to the env-propagation block in
#                           scripts/deploy-local.sh.
# ───────────────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$ROOT_DIR/tmp/logs"
PID_DIR="$ROOT_DIR/tmp/pids"
mkdir -p "$LOG_DIR" "$PID_DIR"

# ─── Configuration ─────────────────────────────────────────────────────
# Tuple format: "<name>:<port>:<workspace-package>"
# Workspace package is what `pnpm --filter` accepts (e.g. @smart-agent/org-mcp).
SERVICES=(
  "org-mcp:3400:@smart-agent/org-mcp"
  "family-mcp:3500:@smart-agent/family-mcp"
  "person-mcp:3200:@smart-agent/person-mcp"
  "a2a-agent:3100:@smart-agent/a2a-agent"
)
WEB_PORT=3000
WEB_FILTER="@smart-agent/web"
ANVIL_PORT=8545

# Stateful paths under apps/* that survive runs and need wiping. Globs OK.
WIPE_PATHS=(
  "apps/*/local.db"
  "apps/*/local.db-shm"
  "apps/*/local.db-wal"
  "apps/*/person-mcp.db"
  "apps/*/person-mcp.db-shm"
  "apps/*/person-mcp.db-wal"
  "apps/*/org-private.db"
  "apps/*/org-private.db-shm"
  "apps/*/org-private.db-wal"
  "apps/*/oid4vci.db"
  "apps/*/oid4vci.db-shm"
  "apps/*/oid4vci.db-wal"
  "apps/*/family-private.db"
  "apps/*/family-private.db-shm"
  "apps/*/family-private.db-wal"
  "apps/*/family-nonces.db"
  "apps/*/family-nonces.db-shm"
  "apps/*/family-nonces.db-wal"
  "apps/*/askar-stores"
  "apps/web/.next/cache"
)

# ─── Args ──────────────────────────────────────────────────────────────
WAIT_FOR_READY=1
START_SERVICES=1
for arg in "$@"; do
  case "$arg" in
    --no-wait)     WAIT_FOR_READY=0 ;;
    --no-services) START_SERVICES=0; WAIT_FOR_READY=0 ;;
    --help|-h)
      sed -n '/^# ─/,/^# ───/p' "$0" | head -60
      exit 0
      ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

# ─── Helpers ───────────────────────────────────────────────────────────

# Print a banner with a timestamp so logs are easy to scan.
banner() {
  printf '\n\033[1;36m=== %s\033[0m  (%s)\n' "$1" "$(date +%H:%M:%S)"
}

# Kill anything listening on a given port. Quiet on success.
kill_port() {
  local port=$1
  local pids
  pids=$(ss -tlnp 2>/dev/null | awk -v p=":$port" '$0 ~ p {print $0}' \
         | grep -oE 'pid=[0-9]+' | sed 's/pid=//' | sort -u || true)
  if [[ -n "${pids:-}" ]]; then
    echo "  killing pid(s) $pids on :$port"
    kill $pids 2>/dev/null || true
  fi
}

# Start a process in the background; capture pid and log.
spawn() {
  local name=$1 cmd=$2
  local log="$LOG_DIR/$name.log"
  local pidfile="$PID_DIR/$name.pid"
  : > "$log"
  ( cd "$ROOT_DIR" && nohup bash -c "$cmd" > "$log" 2>&1 & echo $! > "$pidfile" )
  echo "  $name → pid=$(cat "$pidfile") log=$log"
}

# Wait until a URL responds with HTTP 200 (or a JSON-RPC OK).
wait_http() {
  local url=$1 label=$2 timeout=${3:-30}
  local i=0
  while ! curl -fsS "$url" >/dev/null 2>&1; do
    sleep 1
    i=$((i+1))
    if (( i >= timeout )); then
      echo "  ⚠ $label not responding at $url after ${timeout}s" >&2
      return 1
    fi
  done
  echo "  ✓ $label up"
}

wait_anvil() {
  local i=0
  while ! curl -fsS -X POST -H 'content-type: application/json' \
            --data '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' \
            "http://127.0.0.1:$ANVIL_PORT" >/dev/null 2>&1; do
    sleep 1; i=$((i+1)); (( i >= 30 )) && return 1
  done
  echo "  ✓ anvil up"
}

# ─── Steps ─────────────────────────────────────────────────────────────

stop_all() {
  banner "1/8  Stopping anvil + every dev service"
  kill_port "$ANVIL_PORT"
  kill_port "$WEB_PORT"
  for tuple in "${SERVICES[@]}"; do
    IFS=':' read -r name port _ <<<"$tuple"
    kill_port "$port"
  done
  # Catch any tsx watcher that survived port-kill (e.g. between watch + child).
  pkill -f 'tsx (watch )?src/index.ts' 2>/dev/null || true
  # Anvil parent shells keep the process under a wrapper bash; pkill catches stragglers.
  pkill -f 'anvil --host 0.0.0.0' 2>/dev/null || true
  sleep 1
}

wipe_state() {
  banner "2/8  Wiping DB + Askar state"
  for glob in "${WIPE_PATHS[@]}"; do
    # shellcheck disable=SC2086
    rm -rf $ROOT_DIR/$glob 2>/dev/null || true
  done
  echo "  removed: ${#WIPE_PATHS[@]} path globs"
}

start_anvil() {
  banner "3/8  Starting fresh anvil (chain id 31337)"
  spawn anvil "anvil --host 0.0.0.0 --chain-id 31337"
  wait_anvil
}

# Strip out orphan address lines that prior versions of deploy-local.sh
# left behind (bare hex lines, duplicate marker headers). Keeps the file
# tidy so each redeploy doesn't accumulate cruft.
sanitize_web_env() {
  local f="$ROOT_DIR/apps/web/.env"
  [[ -f "$f" ]] || return 0
  # Drop bare-hex lines, then collapse runs of the duplicated marker header
  # down to a single instance, then collapse runs of blank lines.
  awk '
    /^0x[0-9a-fA-F]{40}$/                                        { next }
    /^# ─── Deployed Contract Addresses .* ─+$/                  {
      if (skip_marker) next; skip_marker=1; print; next
    }
    /./                                                          { skip_marker=0 }
    { print }
  ' "$f" | awk 'BEGIN{blank=0} /^$/{blank++; if(blank<=1)print; next} {blank=0; print}' > "$f.tmp"
  mv "$f.tmp" "$f"
}

deploy_contracts() {
  banner "4/8  Deploying contracts + seeding ontology"
  sanitize_web_env
  bash "$SCRIPT_DIR/deploy-local.sh" 2>&1 | tee "$LOG_DIR/deploy.log" \
    | grep -E '=== |Address:|Tx:' || true
}

# Future on-chain seed steps go here. Order matters; one per line.
seed_after_deploy() {
  banner "5/8  Post-deploy seeds"
  echo "  (ontology + relationship-type-registry seeded inline by deploy-local.sh)"
  echo "  (per-hub on-chain seed runs in-process via /api/boot-seed)"
}

start_services() {
  banner "6/8  Starting backend services"
  for tuple in "${SERVICES[@]}"; do
    IFS=':' read -r name _port pkg <<<"$tuple"
    spawn "$name" "pnpm --filter $pkg dev"
  done
  for tuple in "${SERVICES[@]}"; do
    IFS=':' read -r name port _ <<<"$tuple"
    wait_http "http://127.0.0.1:$port/health" "$name" 30 || \
      wait_http "http://127.0.0.1:$port/.well-known/agent.json" "$name" 5 || true
  done
}

start_web() {
  banner "7/8  Starting web (Next.js)"
  spawn web "pnpm --filter $WEB_FILTER dev"
  wait_http "http://127.0.0.1:$WEB_PORT/" "web" 60
}

trigger_boot_seed() {
  banner "8/8  Triggering /api/boot-seed"
  curl -fsS "http://127.0.0.1:$WEB_PORT/api/boot-seed" >/dev/null
  if (( WAIT_FOR_READY )); then
    echo "  polling /api/system-readiness …"
    local i=0 ready=0
    while (( i < 120 )); do
      local body
      body=$(curl -fsS "http://127.0.0.1:$WEB_PORT/api/system-readiness" 2>/dev/null || true)
      if [[ "$body" == *'"allReady":true'* ]]; then ready=1; break; fi
      sleep 2; i=$((i+1))
    done
    if (( ready )); then
      echo "  ✓ allReady=true after ${i}×2s"
    else
      echo "  ⚠ readiness still false after $((i*2))s — see tmp/logs/web.log"
    fi
  fi
}

# ─── Run ───────────────────────────────────────────────────────────────

stop_all
wipe_state
start_anvil
deploy_contracts
seed_after_deploy

if (( START_SERVICES )); then
  start_services
  start_web
  trigger_boot_seed
fi

banner "Done — fresh stack at http://localhost:$WEB_PORT"
echo "Tail logs:   tail -f $LOG_DIR/<service>.log"
echo "Stop later:  for f in $PID_DIR/*.pid; do kill \"\$(cat \"\$f\")\" 2>/dev/null || true; done"
