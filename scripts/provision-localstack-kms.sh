#!/usr/bin/env bash
set -euo pipefail

# ───────────────────────────────────────────────────────────────────────
# Smart Agent — LocalStack KMS provisioning (Task #122)
# ───────────────────────────────────────────────────────────────────────
#
# Create every AWS KMS key the smart-agent stack needs against a running
# LocalStack KMS emulator, then write the resulting key IDs into the
# per-service .env files. This is the dev-mode replacement for the
# manual AWS console / Terraform key-provisioning step described in
# docs/operations/kms-signer-setup.md (Steps 1-3).
#
# Preconditions:
#   - LocalStack is running at $AWS_ENDPOINT_URL (default
#     http://localhost:4566), with the KMS service available.
#   - apps/a2a-agent/.env and apps/web/.env exist (deploy-local.sh creates them).
#
# Keys created (one CMK each):
#   1. Symmetric AES envelope key (K2)                    — for sessionDataKey wrap/unwrap
#   2. Asymmetric ECC_SECG_P256K1 signing key (K4 PR-2)   — master EOA replacement
#   3. Four tool-executor asymmetric secp256k1 keys (K5)  — round-awards,
#                                                            disbursement,
#                                                            pool-lifecycle,
#                                                            grant-awards
#   4. Nine HMAC_256 keys (K3-extension)                  — one per MacKeyId in
#                                                            packages/sdk/.../mac-provider-factory.ts:
#                                                            web-to-a2a, a2a-to-{person,org,family,
#                                                            people-group,verifier,skill,geo},
#                                                            oauth-salt
#
# All env vars match the names the production AWS factories read
# (apps/a2a-agent/src/auth/{key-provider,mac-provider}.ts) so flipping
# A2A_KMS_BACKEND=aws-kms is the only switch needed to run the dev stack
# against LocalStack instead of the local-aes shim.
#
# IMPORTANT: This script is dev-only. It uses dummy AWS credentials
# ($AWS_ACCESS_KEY_ID=test / $AWS_SECRET_ACCESS_KEY=test) which LocalStack
# accepts. Real AWS would refuse them. The Vercel OIDC federation step
# from production is skipped — see
# packages/sdk/src/key-custody/aws-kms-client-config.ts for the
# dev-only divergence.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

STRIP_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --strip-only)
      # Second-phase invocation from fresh-start.sh: deploy-local.sh has
      # re-written the local-aes dev-shim private keys after the initial
      # provisioning; this mode strips them again without touching KMS.
      STRIP_ONLY=1
      ;;
    --help|-h)
      sed -n '/^# ─/,/^# ───/p' "$0" | head -40
      exit 0
      ;;
    *)
      echo "unknown flag: $arg" >&2
      exit 2
      ;;
  esac
done

AWS_ENDPOINT_URL="${AWS_ENDPOINT_URL:-http://localhost:4566}"
AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-test}"
AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-test}"
# LocalStack does not enforce IAM. We need a value matching the
# `arn:aws:iam::<account>:role/<name>` regex the AWS factories validate
# their AWS_ROLE_ARN against. The factory uses this string only as a
# label in dev-mode (the credentials provider is skipped when
# AWS_ENDPOINT_URL is set — see aws-kms-client-config.ts).
AWS_ROLE_ARN="${AWS_ROLE_ARN:-arn:aws:iam::000000000000:role/smart-agent-localstack-dev}"

export AWS_ENDPOINT_URL AWS_REGION AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY

A2A_ENV_FILE="$ROOT_DIR/apps/a2a-agent/.env"
WEB_ENV="$ROOT_DIR/apps/web/.env"

mkdir -p "$ROOT_DIR/tmp"
PROVISION_LOG="$ROOT_DIR/tmp/localstack-kms-provision.log"
: > "$PROVISION_LOG"

# ─── Helpers ───────────────────────────────────────────────────────────

# Write `key=value` into an env file. If the key already exists, replace
# the line; otherwise append. Same semantics as `update_env_var` in
# scripts/deploy-local.sh.
update_env_var() {
  local file="$1" key="$2" value="$3"
  if [ ! -f "$file" ]; then
    printf '%s=%s\n' "$key" "$value" > "$file"
    return
  fi
  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$file"
  fi
}

# Create one KMS key via a small node helper that uses the SDK already in
# node_modules. The output is one bare KMS key id (UUID) on stdout.
#
# Arguments:
#   $1 = KeySpec (SYMMETRIC_DEFAULT | ECC_SECG_P256K1 | HMAC_256)
#   $2 = KeyUsage (ENCRYPT_DECRYPT | SIGN_VERIFY | GENERATE_VERIFY_MAC)
#   $3 = Description
create_kms_key() {
  local spec="$1" usage="$2" desc="$3"
  cd "$ROOT_DIR/packages/sdk"
  node --input-type=module -e "
    import { KMSClient, CreateKeyCommand } from '@aws-sdk/client-kms'
    const c = new KMSClient({})
    const r = await c.send(new CreateKeyCommand({
      KeySpec: '${spec}',
      KeyUsage: '${usage}',
      Description: '${desc}',
    }))
    process.stdout.write(r.KeyMetadata.KeyId)
  "
}

banner() {
  printf '\n\033[1;36m=== %s\033[0m\n' "$1"
}

# Remove the dev-shim static keys that aws-kms mode replaces. These are
# the "no private keys in .env" gap the LocalStack work closes. The
# aws-kms code path does NOT read any of these — the production guard
# in apps/a2a-agent/src/auth/key-provider.ts would refuse them in
# NODE_ENV=production, and dev parity means we don't want them lying
# around once aws-kms is the active backend.
strip_local_aes_static_keys() {
  local envf="$1"
  [ -f "$envf" ] || return 0
  sed -i \
    -e '/^A2A_MASTER_PRIVATE_KEY=/d' \
    -e '/^A2A_BUNDLER_PRIVATE_KEY=/d' \
    -e '/^A2A_SESSION_ISSUER_PRIVATE_KEY=/d' \
    -e '/^TOOL_EXECUTOR_ROUND_AWARDS_PRIVATE_KEY=/d' \
    -e '/^TOOL_EXECUTOR_DISBURSEMENT_PRIVATE_KEY=/d' \
    -e '/^TOOL_EXECUTOR_POOL_LIFECYCLE_PRIVATE_KEY=/d' \
    -e '/^TOOL_EXECUTOR_GRANT_AWARDS_PRIVATE_KEY=/d' \
    -e '/^A2A_INTERSERVICE_HMAC_KEY_PERSON=/d' \
    -e '/^A2A_INTERSERVICE_HMAC_KEY_ORG=/d' \
    -e '/^A2A_INTERSERVICE_HMAC_KEY_FAMILY=/d' \
    -e '/^A2A_INTERSERVICE_HMAC_KEY_PEOPLE_GROUP=/d' \
    -e '/^A2A_INTERSERVICE_HMAC_KEY_VERIFIER=/d' \
    -e '/^A2A_INTERSERVICE_HMAC_KEY_SKILL=/d' \
    -e '/^A2A_INTERSERVICE_HMAC_KEY_GEO=/d' \
    -e '/^A2A_INTERSERVICE_HMAC_KEY_HUB=/d' \
    -e '/^WEB_TO_A2A_HMAC_KEY=/d' \
    -e '/^OAUTH_SALT_HMAC_KEY=/d' \
    "$envf"
}

# --strip-only short-circuit: deploy-local.sh has re-written the dev-shim
# static keys after the main provisioning ran; fresh-start invokes us
# again in this mode to clean them up without touching KMS.
if (( STRIP_ONLY )); then
  strip_local_aes_static_keys "$A2A_ENV_FILE"
  strip_local_aes_static_keys "$WEB_ENV"
  for svc in person-mcp org-mcp family-mcp people-group-mcp verifier-mcp skill-mcp geo-mcp hub-mcp; do
    strip_local_aes_static_keys "$ROOT_DIR/apps/$svc/.env"
  done
  echo "  ✓ Stripped local-aes static keys from every service .env"
  exit 0
fi

# ─── Wait for LocalStack KMS to be ready ──────────────────────────────

banner "1/5  Verifying LocalStack KMS at $AWS_ENDPOINT_URL"
for _ in $(seq 1 30); do
  if curl -fsS "$AWS_ENDPOINT_URL/_localstack/health" 2>/dev/null \
       | grep -q '"kms": *"\(available\|running\)"'; then
    echo "  ✓ KMS service available"
    break
  fi
  sleep 1
done
if ! curl -fsS "$AWS_ENDPOINT_URL/_localstack/health" 2>/dev/null \
       | grep -q '"kms": *"\(available\|running\)"'; then
  echo "  ⚠ LocalStack KMS did not become ready at $AWS_ENDPOINT_URL" >&2
  echo "  Check: docker logs sa-localstack-kms" >&2
  exit 1
fi

# ─── Create keys ──────────────────────────────────────────────────────

banner "2/5  Creating envelope-encryption (K2) + signer (K4) keys"

AWS_KMS_KEY_ID=$(create_kms_key SYMMETRIC_DEFAULT ENCRYPT_DECRYPT \
  "smart-agent K2 session-envelope encryption (LocalStack dev)")
echo "  K2 envelope key   : $AWS_KMS_KEY_ID" | tee -a "$PROVISION_LOG"

AWS_KMS_SIGNER_KEY_ID=$(create_kms_key ECC_SECG_P256K1 SIGN_VERIFY \
  "smart-agent K4 master-EOA signer (LocalStack dev)")
echo "  K4 master signer  : $AWS_KMS_SIGNER_KEY_ID" | tee -a "$PROVISION_LOG"

# Spec 007 Phase A — bundler-envelope signer + session-issuer signer.
# Separate KMS keys from K4 master (different blast radius + rotation
# cadence, see phase-A-contract-role-split.md § D1).
AWS_KMS_BUNDLER_SIGNER_KEY_ID=$(create_kms_key ECC_SECG_P256K1 SIGN_VERIFY \
  "smart-agent Phase A bundler-envelope signer (LocalStack dev)")
echo "  Phase A bundler   : $AWS_KMS_BUNDLER_SIGNER_KEY_ID" | tee -a "$PROVISION_LOG"

AWS_KMS_SESSION_ISSUER_KEY_ID=$(create_kms_key ECC_SECG_P256K1 SIGN_VERIFY \
  "smart-agent Phase A session-issuer signer (LocalStack dev)")
echo "  Phase A session   : $AWS_KMS_SESSION_ISSUER_KEY_ID" | tee -a "$PROVISION_LOG"

banner "3/5  Creating tool-executor (K5) signing keys"

AWS_KMS_TOOL_EXECUTOR_ROUND_AWARDS_KEY_ID=$(create_kms_key ECC_SECG_P256K1 SIGN_VERIFY \
  "smart-agent K5 tool-executor round-awards (LocalStack dev)")
echo "  K5 round-awards   : $AWS_KMS_TOOL_EXECUTOR_ROUND_AWARDS_KEY_ID" | tee -a "$PROVISION_LOG"

AWS_KMS_TOOL_EXECUTOR_DISBURSEMENT_KEY_ID=$(create_kms_key ECC_SECG_P256K1 SIGN_VERIFY \
  "smart-agent K5 tool-executor disbursement (LocalStack dev)")
echo "  K5 disbursement   : $AWS_KMS_TOOL_EXECUTOR_DISBURSEMENT_KEY_ID" | tee -a "$PROVISION_LOG"

AWS_KMS_TOOL_EXECUTOR_POOL_LIFECYCLE_KEY_ID=$(create_kms_key ECC_SECG_P256K1 SIGN_VERIFY \
  "smart-agent K5 tool-executor pool-lifecycle (LocalStack dev)")
echo "  K5 pool-lifecycle : $AWS_KMS_TOOL_EXECUTOR_POOL_LIFECYCLE_KEY_ID" | tee -a "$PROVISION_LOG"

AWS_KMS_TOOL_EXECUTOR_GRANT_AWARDS_KEY_ID=$(create_kms_key ECC_SECG_P256K1 SIGN_VERIFY \
  "smart-agent K5 tool-executor grant-awards (LocalStack dev)")
echo "  K5 grant-awards   : $AWS_KMS_TOOL_EXECUTOR_GRANT_AWARDS_KEY_ID" | tee -a "$PROVISION_LOG"

banner "4/5  Creating inter-service HMAC keys (K3-extension)"

AWS_KMS_MAC_KEY_ID_WEB_TO_A2A=$(create_kms_key HMAC_256 GENERATE_VERIFY_MAC \
  "smart-agent K3-ext web→a2a MAC (LocalStack dev)")
echo "  MAC web-to-a2a    : $AWS_KMS_MAC_KEY_ID_WEB_TO_A2A" | tee -a "$PROVISION_LOG"

AWS_KMS_MAC_KEY_ID_A2A_TO_PERSON=$(create_kms_key HMAC_256 GENERATE_VERIFY_MAC \
  "smart-agent K3-ext a2a→person MAC (LocalStack dev)")
echo "  MAC a2a-to-person : $AWS_KMS_MAC_KEY_ID_A2A_TO_PERSON" | tee -a "$PROVISION_LOG"

AWS_KMS_MAC_KEY_ID_A2A_TO_ORG=$(create_kms_key HMAC_256 GENERATE_VERIFY_MAC \
  "smart-agent K3-ext a2a→org MAC (LocalStack dev)")
echo "  MAC a2a-to-org    : $AWS_KMS_MAC_KEY_ID_A2A_TO_ORG" | tee -a "$PROVISION_LOG"

AWS_KMS_MAC_KEY_ID_A2A_TO_FAMILY=$(create_kms_key HMAC_256 GENERATE_VERIFY_MAC \
  "smart-agent K3-ext a2a→family MAC (LocalStack dev)")
echo "  MAC a2a-to-family : $AWS_KMS_MAC_KEY_ID_A2A_TO_FAMILY" | tee -a "$PROVISION_LOG"

AWS_KMS_MAC_KEY_ID_A2A_TO_PEOPLE_GROUP=$(create_kms_key HMAC_256 GENERATE_VERIFY_MAC \
  "smart-agent K3-ext a2a→people-group MAC (LocalStack dev)")
echo "  MAC people-group  : $AWS_KMS_MAC_KEY_ID_A2A_TO_PEOPLE_GROUP" | tee -a "$PROVISION_LOG"

AWS_KMS_MAC_KEY_ID_A2A_TO_VERIFIER=$(create_kms_key HMAC_256 GENERATE_VERIFY_MAC \
  "smart-agent K3-ext a2a→verifier MAC (LocalStack dev)")
echo "  MAC a2a-to-verifier: $AWS_KMS_MAC_KEY_ID_A2A_TO_VERIFIER" | tee -a "$PROVISION_LOG"

AWS_KMS_MAC_KEY_ID_A2A_TO_SKILL=$(create_kms_key HMAC_256 GENERATE_VERIFY_MAC \
  "smart-agent K3-ext a2a→skill MAC (LocalStack dev)")
echo "  MAC a2a-to-skill  : $AWS_KMS_MAC_KEY_ID_A2A_TO_SKILL" | tee -a "$PROVISION_LOG"

AWS_KMS_MAC_KEY_ID_A2A_TO_GEO=$(create_kms_key HMAC_256 GENERATE_VERIFY_MAC \
  "smart-agent K3-ext a2a→geo MAC (LocalStack dev)")
echo "  MAC a2a-to-geo    : $AWS_KMS_MAC_KEY_ID_A2A_TO_GEO" | tee -a "$PROVISION_LOG"

AWS_KMS_MAC_KEY_ID_A2A_TO_HUB=$(create_kms_key HMAC_256 GENERATE_VERIFY_MAC \
  "smart-agent a2a→hub MAC (LocalStack dev) — system-scoped /mcp/hub/* proxy")
echo "  MAC a2a-to-hub    : $AWS_KMS_MAC_KEY_ID_A2A_TO_HUB" | tee -a "$PROVISION_LOG"

AWS_KMS_MAC_KEY_ID_OAUTH_SALT=$(create_kms_key HMAC_256 GENERATE_VERIFY_MAC \
  "smart-agent S2.6 oauth-salt MAC (LocalStack dev)")
echo "  MAC oauth-salt    : $AWS_KMS_MAC_KEY_ID_OAUTH_SALT" | tee -a "$PROVISION_LOG"

# ─── Write env propagation ────────────────────────────────────────────

banner "5/5  Writing key IDs into apps/{a2a-agent,web,*-mcp}/.env"

strip_local_aes_static_keys "$A2A_ENV_FILE"
strip_local_aes_static_keys "$WEB_ENV"
for svc in person-mcp org-mcp family-mcp people-group-mcp verifier-mcp skill-mcp geo-mcp hub-mcp; do
  strip_local_aes_static_keys "$ROOT_DIR/apps/$svc/.env"
done

# Backend selector — flip every service to aws-kms.
update_env_var "$A2A_ENV_FILE" A2A_KMS_BACKEND   "aws-kms"
update_env_var "$WEB_ENV"      A2A_KMS_BACKEND   "aws-kms"

# Endpoint + region + dummy credentials — must be set in every process
# that constructs a KMSClient. AWS SDK v3 reads AWS_ENDPOINT_URL
# automatically; the dummy credentials feed the default-chain branch
# selected by aws-kms-client-config.ts.
for envf in "$A2A_ENV_FILE" "$WEB_ENV"; do
  update_env_var "$envf" AWS_ENDPOINT_URL       "$AWS_ENDPOINT_URL"
  update_env_var "$envf" AWS_REGION             "$AWS_REGION"
  update_env_var "$envf" AWS_ROLE_ARN           "$AWS_ROLE_ARN"
  update_env_var "$envf" AWS_ACCESS_KEY_ID      "$AWS_ACCESS_KEY_ID"
  update_env_var "$envf" AWS_SECRET_ACCESS_KEY  "$AWS_SECRET_ACCESS_KEY"
done

# K2 envelope key.
update_env_var "$A2A_ENV_FILE" AWS_KMS_KEY_ID "$AWS_KMS_KEY_ID"

# K4 master signer.
update_env_var "$A2A_ENV_FILE" AWS_KMS_SIGNER_KEY_ID "$AWS_KMS_SIGNER_KEY_ID"
# master-signer-address.ts (called by deploy-local.sh BEFORE this script
# would normally run) reads AWS_KMS_SIGNER_KEY_ID from process.env when
# A2A_KMS_BACKEND=aws-kms. We also write it into apps/web/.env so any
# web-side runtime path that derives the master signer address sees the
# same value.
update_env_var "$WEB_ENV" AWS_KMS_SIGNER_KEY_ID "$AWS_KMS_SIGNER_KEY_ID"

# Spec 007 Phase A — bundler + session-issuer signer key ids.
# master-signer-address.ts --role bundler|session-issuer reads these
# when A2A_KMS_BACKEND=aws-kms.
update_env_var "$A2A_ENV_FILE" AWS_KMS_BUNDLER_SIGNER_KEY_ID  "$AWS_KMS_BUNDLER_SIGNER_KEY_ID"
update_env_var "$A2A_ENV_FILE" AWS_KMS_SESSION_ISSUER_KEY_ID  "$AWS_KMS_SESSION_ISSUER_KEY_ID"
update_env_var "$WEB_ENV"      AWS_KMS_BUNDLER_SIGNER_KEY_ID  "$AWS_KMS_BUNDLER_SIGNER_KEY_ID"
update_env_var "$WEB_ENV"      AWS_KMS_SESSION_ISSUER_KEY_ID  "$AWS_KMS_SESSION_ISSUER_KEY_ID"

# K5 tool-executor keys (a2a-agent only — these are read by
# buildToolExecutorBackend in apps/a2a-agent/src/auth/key-provider.ts).
update_env_var "$A2A_ENV_FILE" AWS_KMS_TOOL_EXECUTOR_ROUND_AWARDS_KEY_ID   "$AWS_KMS_TOOL_EXECUTOR_ROUND_AWARDS_KEY_ID"
update_env_var "$A2A_ENV_FILE" AWS_KMS_TOOL_EXECUTOR_DISBURSEMENT_KEY_ID   "$AWS_KMS_TOOL_EXECUTOR_DISBURSEMENT_KEY_ID"
update_env_var "$A2A_ENV_FILE" AWS_KMS_TOOL_EXECUTOR_POOL_LIFECYCLE_KEY_ID "$AWS_KMS_TOOL_EXECUTOR_POOL_LIFECYCLE_KEY_ID"
update_env_var "$A2A_ENV_FILE" AWS_KMS_TOOL_EXECUTOR_GRANT_AWARDS_KEY_ID   "$AWS_KMS_TOOL_EXECUTOR_GRANT_AWARDS_KEY_ID"

# K3-extension HMAC keys.
# a2a-agent verifies every inbound HMAC envelope, so it needs ALL nine
# MAC key IDs. MCPs and web only sign with their own outbound key, but
# we propagate everything to apps/a2a-agent/.env + apps/web/.env to
# keep the dev flow uniform (production deployments per-key-scope IAM
# the rest).
for var in \
  AWS_KMS_MAC_KEY_ID_WEB_TO_A2A \
  AWS_KMS_MAC_KEY_ID_A2A_TO_PERSON \
  AWS_KMS_MAC_KEY_ID_A2A_TO_ORG \
  AWS_KMS_MAC_KEY_ID_A2A_TO_FAMILY \
  AWS_KMS_MAC_KEY_ID_A2A_TO_PEOPLE_GROUP \
  AWS_KMS_MAC_KEY_ID_A2A_TO_VERIFIER \
  AWS_KMS_MAC_KEY_ID_A2A_TO_SKILL \
  AWS_KMS_MAC_KEY_ID_A2A_TO_GEO \
  AWS_KMS_MAC_KEY_ID_A2A_TO_HUB \
  AWS_KMS_MAC_KEY_ID_OAUTH_SALT; do
  update_env_var "$A2A_ENV_FILE" "$var" "${!var}"
  update_env_var "$WEB_ENV"      "$var" "${!var}"
done

# Per-MCP MAC key — the MCP processes only need their inbound key. Wire
# each one into its own .env file (mirrors the local-aes pattern in
# deploy-local.sh's A2A_INTERSERVICE_HMAC_KEY_* propagation).
update_env_var "$ROOT_DIR/apps/person-mcp/.env"       A2A_KMS_BACKEND "aws-kms"
update_env_var "$ROOT_DIR/apps/person-mcp/.env"       AWS_ENDPOINT_URL "$AWS_ENDPOINT_URL"
update_env_var "$ROOT_DIR/apps/person-mcp/.env"       AWS_REGION "$AWS_REGION"
update_env_var "$ROOT_DIR/apps/person-mcp/.env"       AWS_ROLE_ARN "$AWS_ROLE_ARN"
update_env_var "$ROOT_DIR/apps/person-mcp/.env"       AWS_ACCESS_KEY_ID "$AWS_ACCESS_KEY_ID"
update_env_var "$ROOT_DIR/apps/person-mcp/.env"       AWS_SECRET_ACCESS_KEY "$AWS_SECRET_ACCESS_KEY"
update_env_var "$ROOT_DIR/apps/person-mcp/.env"       AWS_KMS_MAC_KEY_ID_A2A_TO_PERSON "$AWS_KMS_MAC_KEY_ID_A2A_TO_PERSON"

update_env_var "$ROOT_DIR/apps/org-mcp/.env"          A2A_KMS_BACKEND "aws-kms"
update_env_var "$ROOT_DIR/apps/org-mcp/.env"          AWS_ENDPOINT_URL "$AWS_ENDPOINT_URL"
update_env_var "$ROOT_DIR/apps/org-mcp/.env"          AWS_REGION "$AWS_REGION"
update_env_var "$ROOT_DIR/apps/org-mcp/.env"          AWS_ROLE_ARN "$AWS_ROLE_ARN"
update_env_var "$ROOT_DIR/apps/org-mcp/.env"          AWS_ACCESS_KEY_ID "$AWS_ACCESS_KEY_ID"
update_env_var "$ROOT_DIR/apps/org-mcp/.env"          AWS_SECRET_ACCESS_KEY "$AWS_SECRET_ACCESS_KEY"
update_env_var "$ROOT_DIR/apps/org-mcp/.env"          AWS_KMS_MAC_KEY_ID_A2A_TO_ORG "$AWS_KMS_MAC_KEY_ID_A2A_TO_ORG"

update_env_var "$ROOT_DIR/apps/family-mcp/.env"       A2A_KMS_BACKEND "aws-kms"
update_env_var "$ROOT_DIR/apps/family-mcp/.env"       AWS_ENDPOINT_URL "$AWS_ENDPOINT_URL"
update_env_var "$ROOT_DIR/apps/family-mcp/.env"       AWS_REGION "$AWS_REGION"
update_env_var "$ROOT_DIR/apps/family-mcp/.env"       AWS_ROLE_ARN "$AWS_ROLE_ARN"
update_env_var "$ROOT_DIR/apps/family-mcp/.env"       AWS_ACCESS_KEY_ID "$AWS_ACCESS_KEY_ID"
update_env_var "$ROOT_DIR/apps/family-mcp/.env"       AWS_SECRET_ACCESS_KEY "$AWS_SECRET_ACCESS_KEY"
update_env_var "$ROOT_DIR/apps/family-mcp/.env"       AWS_KMS_MAC_KEY_ID_A2A_TO_FAMILY "$AWS_KMS_MAC_KEY_ID_A2A_TO_FAMILY"

update_env_var "$ROOT_DIR/apps/people-group-mcp/.env" A2A_KMS_BACKEND "aws-kms"
update_env_var "$ROOT_DIR/apps/people-group-mcp/.env" AWS_ENDPOINT_URL "$AWS_ENDPOINT_URL"
update_env_var "$ROOT_DIR/apps/people-group-mcp/.env" AWS_REGION "$AWS_REGION"
update_env_var "$ROOT_DIR/apps/people-group-mcp/.env" AWS_ROLE_ARN "$AWS_ROLE_ARN"
update_env_var "$ROOT_DIR/apps/people-group-mcp/.env" AWS_ACCESS_KEY_ID "$AWS_ACCESS_KEY_ID"
update_env_var "$ROOT_DIR/apps/people-group-mcp/.env" AWS_SECRET_ACCESS_KEY "$AWS_SECRET_ACCESS_KEY"
update_env_var "$ROOT_DIR/apps/people-group-mcp/.env" AWS_KMS_MAC_KEY_ID_A2A_TO_PEOPLE_GROUP "$AWS_KMS_MAC_KEY_ID_A2A_TO_PEOPLE_GROUP"

update_env_var "$ROOT_DIR/apps/verifier-mcp/.env"     A2A_KMS_BACKEND "aws-kms"
update_env_var "$ROOT_DIR/apps/verifier-mcp/.env"     AWS_ENDPOINT_URL "$AWS_ENDPOINT_URL"
update_env_var "$ROOT_DIR/apps/verifier-mcp/.env"     AWS_REGION "$AWS_REGION"
update_env_var "$ROOT_DIR/apps/verifier-mcp/.env"     AWS_ROLE_ARN "$AWS_ROLE_ARN"
update_env_var "$ROOT_DIR/apps/verifier-mcp/.env"     AWS_ACCESS_KEY_ID "$AWS_ACCESS_KEY_ID"
update_env_var "$ROOT_DIR/apps/verifier-mcp/.env"     AWS_SECRET_ACCESS_KEY "$AWS_SECRET_ACCESS_KEY"
update_env_var "$ROOT_DIR/apps/verifier-mcp/.env"     AWS_KMS_MAC_KEY_ID_A2A_TO_VERIFIER "$AWS_KMS_MAC_KEY_ID_A2A_TO_VERIFIER"

update_env_var "$ROOT_DIR/apps/skill-mcp/.env"        A2A_KMS_BACKEND "aws-kms"
update_env_var "$ROOT_DIR/apps/skill-mcp/.env"        AWS_ENDPOINT_URL "$AWS_ENDPOINT_URL"
update_env_var "$ROOT_DIR/apps/skill-mcp/.env"        AWS_REGION "$AWS_REGION"
update_env_var "$ROOT_DIR/apps/skill-mcp/.env"        AWS_ROLE_ARN "$AWS_ROLE_ARN"
update_env_var "$ROOT_DIR/apps/skill-mcp/.env"        AWS_ACCESS_KEY_ID "$AWS_ACCESS_KEY_ID"
update_env_var "$ROOT_DIR/apps/skill-mcp/.env"        AWS_SECRET_ACCESS_KEY "$AWS_SECRET_ACCESS_KEY"
update_env_var "$ROOT_DIR/apps/skill-mcp/.env"        AWS_KMS_MAC_KEY_ID_A2A_TO_SKILL "$AWS_KMS_MAC_KEY_ID_A2A_TO_SKILL"

update_env_var "$ROOT_DIR/apps/geo-mcp/.env"          A2A_KMS_BACKEND "aws-kms"
update_env_var "$ROOT_DIR/apps/geo-mcp/.env"          AWS_ENDPOINT_URL "$AWS_ENDPOINT_URL"
update_env_var "$ROOT_DIR/apps/geo-mcp/.env"          AWS_REGION "$AWS_REGION"
update_env_var "$ROOT_DIR/apps/geo-mcp/.env"          AWS_ROLE_ARN "$AWS_ROLE_ARN"
update_env_var "$ROOT_DIR/apps/geo-mcp/.env"          AWS_ACCESS_KEY_ID "$AWS_ACCESS_KEY_ID"
update_env_var "$ROOT_DIR/apps/geo-mcp/.env"          AWS_SECRET_ACCESS_KEY "$AWS_SECRET_ACCESS_KEY"
update_env_var "$ROOT_DIR/apps/geo-mcp/.env"          AWS_KMS_MAC_KEY_ID_A2A_TO_GEO "$AWS_KMS_MAC_KEY_ID_A2A_TO_GEO"

update_env_var "$ROOT_DIR/apps/hub-mcp/.env"          A2A_KMS_BACKEND "aws-kms"
update_env_var "$ROOT_DIR/apps/hub-mcp/.env"          AWS_ENDPOINT_URL "$AWS_ENDPOINT_URL"
update_env_var "$ROOT_DIR/apps/hub-mcp/.env"          AWS_REGION "$AWS_REGION"
update_env_var "$ROOT_DIR/apps/hub-mcp/.env"          AWS_ROLE_ARN "$AWS_ROLE_ARN"
update_env_var "$ROOT_DIR/apps/hub-mcp/.env"          AWS_ACCESS_KEY_ID "$AWS_ACCESS_KEY_ID"
update_env_var "$ROOT_DIR/apps/hub-mcp/.env"          AWS_SECRET_ACCESS_KEY "$AWS_SECRET_ACCESS_KEY"
update_env_var "$ROOT_DIR/apps/hub-mcp/.env"          AWS_KMS_MAC_KEY_ID_A2A_TO_HUB "$AWS_KMS_MAC_KEY_ID_A2A_TO_HUB"

echo ""
echo "  ✓ Provisioned $(wc -l < "$PROVISION_LOG") KMS keys"
echo "  ✓ Wrote backend selector + AWS_* env to apps/{a2a-agent,web,*-mcp}/.env"
echo ""
echo "Provisioning log: $PROVISION_LOG"
echo ""
echo "Next: services started after this script will pick up A2A_KMS_BACKEND=aws-kms"
echo "      and route ALL signing / envelope / MAC operations through LocalStack."
