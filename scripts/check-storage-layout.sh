#!/usr/bin/env bash
# Spec 007 Phase A.5 (SC7 § 4) — storage layout CI guard.
#
# For each contract that has a baseline snapshot in
# `packages/contracts/storage-layouts/<contract>.<version>.json`,
# compare the current `forge inspect <contract> storage-layout --json`
# output against the snapshot. Fails (non-zero exit) on any diff.
#
# Bypass intentionally hard: the only way to silence the gate is to
# commit a NEW versioned snapshot file alongside the contract change,
# which forces explicit human review of every storage-layout change.
#
# Usage:
#   ./scripts/check-storage-layout.sh                # check against latest baseline
#   ./scripts/check-storage-layout.sh --update       # refresh all baselines (dangerous)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CONTRACTS_DIR="$ROOT_DIR/packages/contracts"
LAYOUTS_DIR="$CONTRACTS_DIR/storage-layouts"

UPDATE=0
if [ "${1:-}" = "--update" ]; then
  UPDATE=1
fi

# Contracts we snapshot. Add a new entry here when a new
# upgradeable / state-bearing contract is introduced.
CONTRACTS=(
  AgentAccount
  AgentAccountFactory
  DelegationManager
  SmartAgentPaymaster
  Governance
)

# Resolve the latest baseline file for a contract. The naming
# convention is `<contract>.<version>.json` and we pick the latest by
# lexicographic sort on the version segment.
latest_baseline() {
  local contract="$1"
  ls "$LAYOUTS_DIR/${contract}".*.json 2>/dev/null | sort -V | tail -n1
}

cd "$CONTRACTS_DIR"

fail=0
for contract in "${CONTRACTS[@]}"; do
  baseline="$(latest_baseline "$contract" || true)"
  current="$(mktemp)"
  trap 'rm -f "$current"' EXIT

  if ! forge inspect "$contract" storage-layout --json > "$current" 2>/dev/null; then
    echo "ERROR: forge inspect failed for $contract"
    fail=1
    continue
  fi

  if [ -z "$baseline" ] || [ ! -f "$baseline" ]; then
    if [ "$UPDATE" -eq 1 ]; then
      cp "$current" "$LAYOUTS_DIR/${contract}.v2.2.0.json"
      echo "NEW: $contract baseline at v2.2.0"
    else
      echo "ERROR: no baseline for $contract; commit one under storage-layouts/"
      fail=1
    fi
    continue
  fi

  if ! diff -q "$baseline" "$current" > /dev/null 2>&1; then
    if [ "$UPDATE" -eq 1 ]; then
      # Bump version: latest baseline name is <c>.<vN>.json; user must
      # commit the NEW version explicitly. We always write to the same
      # filename to make the diff visible in the PR.
      cp "$current" "$baseline"
      echo "UPDATED: $contract layout snapshot at $baseline"
    else
      echo ""
      echo "FAIL: storage layout changed for $contract"
      echo "  baseline: $baseline"
      echo "  current:  forge inspect $contract storage-layout --json"
      echo ""
      diff -u "$baseline" "$current" || true
      echo ""
      echo "If this change is intentional, bump the version: copy"
      echo "  $baseline"
      echo "to"
      echo "  storage-layouts/${contract}.v<NEXT>.json"
      echo "with the new layout, commit BOTH files, and request"
      echo "explicit security review."
      fail=1
    fi
  else
    echo "OK: $contract layout matches $baseline"
  fi
done

if [ "$fail" -ne 0 ]; then
  exit 1
fi
