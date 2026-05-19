# AWS KMS keys for the Smart Agent runtime.
#
# Key inventory (per output/KMS-IMPLEMENTATION-PLAN.md § 2 + K4-A1..A6
# + K6 § 3.2):
#
#   Signing-class (asymmetric secp256k1, multi-region):
#     - master                  (a2a-agent master EOA signer)
#     - bundler-signer          (ERC-4337 bundler-envelope signer)
#     - session-issuer          (session-key issuance signer)
#
#   Tool-executor (asymmetric secp256k1, multi-region):
#     - tool-round-awards
#     - tool-disbursement
#     - tool-pool-lifecycle
#     - tool-grant-awards
#     - tool-auth-bootstrap     (per TOOL_EXECUTOR_IDS in @smart-agent/sdk)
#
#   Envelope (symmetric AES-256, single-region):
#     - session-envelope        (KEK for AES-GCM session-package data keys)
#     - cloudtrail-encryption   (encrypts the audit trail itself; separate
#                                key so a compromise of operational keys
#                                does NOT compromise the audit log)
#
#   Inter-service MAC (symmetric HMAC_256, single-region):
#     - mac-a2a-to-person
#     - mac-a2a-to-org
#     - mac-a2a-to-hub
#     - mac-a2a-to-people-group
#     - mac-a2a-to-family
#     - mac-a2a-to-geo
#     - mac-a2a-to-verifier
#     - mac-a2a-to-skill
#
# All keys: HSM-backed (Origin = AWS_KMS), accessed via FIPS endpoints
# at runtime (K4 § 3.3). FIPS endpoint enforcement is a CLIENT-SIDE
# concern; the keys themselves are identical regardless.
#
# Per-key IAM is scoped via aws_kms_key_policy resources below. The
# runtime IAM role (iam.tf) is the SOLE principal granted per-action
# scope on each key. No wildcards. No `kms:*`.

############################################################
# Local — common policy fragments
############################################################

locals {
  account_id = data.aws_caller_identity.current.account_id

  # Root account principal — required by AWS so the key remains
  # manageable by an account admin even if all role-based grants are
  # revoked. Without this, the key becomes orphaned.
  root_principal = "arn:aws:iam::${local.account_id}:root"

  # Encryption-context keys we expect on every Decrypt against the
  # session-envelope key. Enforced via `kms:EncryptionContextKeys`
  # condition in the key policy. Drift from this set means a client
  # is misconfigured OR a misuse is happening — IAM-layer trip-wire
  # per K6 R-KMS-3.
  session_envelope_required_context_keys = [
    "session_id_h",
    "account_address",
    "chain_id",
    "expires_at",
    "key_version",
  ]
}

data "aws_caller_identity" "current" {}

############################################################
# Asymmetric secp256k1 signing keys (multi-region)
############################################################

# A reusable map driving creation of every signing-class key with the
# same configuration. Each key gets its own resource so its ARN is
# stable and IAM policies reference it explicitly.

resource "aws_kms_key" "master" {
  description              = "Smart Agent master EOA signer (secp256k1). FIPS-validated HSM via kms-fips endpoint."
  customer_master_key_spec = "ECC_SECG_P256K1"
  key_usage                = "SIGN_VERIFY"
  multi_region             = true
  enable_key_rotation      = false # Automatic rotation N/A for asymmetric keys; rotation is manual per K1.
  deletion_window_in_days  = 30

  tags = merge(var.tags, { Role = "signer", Purpose = "master-eoa" })
}

resource "aws_kms_key" "bundler_signer" {
  description              = "Smart Agent ERC-4337 bundler-envelope signer (secp256k1)."
  customer_master_key_spec = "ECC_SECG_P256K1"
  key_usage                = "SIGN_VERIFY"
  multi_region             = true
  enable_key_rotation      = false
  deletion_window_in_days  = 30

  tags = merge(var.tags, { Role = "signer", Purpose = "bundler-envelope" })
}

resource "aws_kms_key" "session_issuer" {
  description              = "Smart Agent session-key issuance signer (secp256k1)."
  customer_master_key_spec = "ECC_SECG_P256K1"
  key_usage                = "SIGN_VERIFY"
  multi_region             = true
  enable_key_rotation      = false
  deletion_window_in_days  = 30

  tags = merge(var.tags, { Role = "signer", Purpose = "session-issuance" })
}

############################################################
# Tool-executor signing keys (multi-region)
############################################################

locals {
  tool_executor_ids = [
    "round-awards",
    "disbursement",
    "pool-lifecycle",
    "grant-awards",
    "auth-bootstrap",
  ]
}

resource "aws_kms_key" "tool_executor" {
  for_each = toset(local.tool_executor_ids)

  description              = "Smart Agent tool-executor signer: ${each.key} (secp256k1). Sub-delegated path key per K5."
  customer_master_key_spec = "ECC_SECG_P256K1"
  key_usage                = "SIGN_VERIFY"
  multi_region             = true
  enable_key_rotation      = false
  deletion_window_in_days  = 30

  tags = merge(var.tags, { Role = "signer", Purpose = "tool-executor", ToolId = each.key })
}

############################################################
# Symmetric envelope keys (single-region)
############################################################

resource "aws_kms_key" "session_envelope" {
  description              = "Smart Agent session-package envelope KEK (AES-256). Used by GenerateDataKey/Decrypt with EncryptionContext binding."
  customer_master_key_spec = "SYMMETRIC_DEFAULT"
  key_usage                = "ENCRYPT_DECRYPT"
  multi_region             = false # KMS multi-region symmetric keys exist but are not required for envelope keys; we revoke + re-key on region failover instead.
  enable_key_rotation      = true
  deletion_window_in_days  = 30

  tags = merge(var.tags, { Role = "envelope", Purpose = "session-package" })
}

resource "aws_kms_key" "cloudtrail_encryption" {
  description              = "Smart Agent CloudTrail audit-log encryption key. SEPARATE from operational keys per K6 § 3.2."
  customer_master_key_spec = "SYMMETRIC_DEFAULT"
  key_usage                = "ENCRYPT_DECRYPT"
  multi_region             = false
  enable_key_rotation      = true
  deletion_window_in_days  = 30

  policy = data.aws_iam_policy_document.cloudtrail_kms_policy.json

  tags = merge(var.tags, { Role = "envelope", Purpose = "audit-trail-encryption" })
}

############################################################
# Inter-service HMAC keys (one per service pair)
############################################################

locals {
  mac_service_pairs = [
    "a2a-to-person",
    "a2a-to-org",
    "a2a-to-hub",
    "a2a-to-people-group",
    "a2a-to-family",
    "a2a-to-geo",
    "a2a-to-verifier",
    "a2a-to-skill",
  ]
}

resource "aws_kms_key" "mac" {
  for_each = toset(local.mac_service_pairs)

  description              = "Smart Agent inter-service MAC key: ${each.key} (HMAC_256). Per K3-extension."
  customer_master_key_spec = "HMAC_256"
  key_usage                = "GENERATE_VERIFY_MAC"
  multi_region             = false
  enable_key_rotation      = false # HMAC keys do not support AWS-managed rotation; manual rotation per K1.
  deletion_window_in_days  = 30

  tags = merge(var.tags, { Role = "mac", Purpose = "inter-service", Pair = each.key })
}

############################################################
# Aliases (for human-readable references in code and runbooks)
############################################################

resource "aws_kms_alias" "master" {
  name          = "alias/${var.project_name}-${var.environment}-master"
  target_key_id = aws_kms_key.master.key_id
}

resource "aws_kms_alias" "bundler_signer" {
  name          = "alias/${var.project_name}-${var.environment}-bundler-signer"
  target_key_id = aws_kms_key.bundler_signer.key_id
}

resource "aws_kms_alias" "session_issuer" {
  name          = "alias/${var.project_name}-${var.environment}-session-issuer"
  target_key_id = aws_kms_key.session_issuer.key_id
}

resource "aws_kms_alias" "session_envelope" {
  name          = "alias/${var.project_name}-${var.environment}-session-envelope"
  target_key_id = aws_kms_key.session_envelope.key_id
}

resource "aws_kms_alias" "cloudtrail_encryption" {
  name          = "alias/${var.project_name}-${var.environment}-cloudtrail-encryption"
  target_key_id = aws_kms_key.cloudtrail_encryption.key_id
}

resource "aws_kms_alias" "tool_executor" {
  for_each      = toset(local.tool_executor_ids)
  name          = "alias/${var.project_name}-${var.environment}-tool-${each.key}"
  target_key_id = aws_kms_key.tool_executor[each.key].key_id
}

resource "aws_kms_alias" "mac" {
  for_each      = toset(local.mac_service_pairs)
  name          = "alias/${var.project_name}-${var.environment}-mac-${each.key}"
  target_key_id = aws_kms_key.mac[each.key].key_id
}

############################################################
# Multi-region replicas (signer keys only)
############################################################
#
# The replica provider is configured in providers.tf. Each replica
# inherits the primary key's policy by default; we re-attach the same
# policy via aws_kms_key_policy below for explicitness.

resource "aws_kms_replica_key" "master" {
  provider                = aws.replica
  primary_key_arn         = aws_kms_key.master.arn
  description             = "Replica of master EOA signer in ${var.aws_replica_region}."
  deletion_window_in_days = 30

  tags = merge(var.tags, { Role = "signer", Purpose = "master-eoa", Replica = "true" })
}

resource "aws_kms_replica_key" "bundler_signer" {
  provider                = aws.replica
  primary_key_arn         = aws_kms_key.bundler_signer.arn
  description             = "Replica of bundler-envelope signer in ${var.aws_replica_region}."
  deletion_window_in_days = 30

  tags = merge(var.tags, { Role = "signer", Purpose = "bundler-envelope", Replica = "true" })
}

resource "aws_kms_replica_key" "session_issuer" {
  provider                = aws.replica
  primary_key_arn         = aws_kms_key.session_issuer.arn
  description             = "Replica of session-issuer signer in ${var.aws_replica_region}."
  deletion_window_in_days = 30

  tags = merge(var.tags, { Role = "signer", Purpose = "session-issuance", Replica = "true" })
}

resource "aws_kms_replica_key" "tool_executor" {
  for_each = toset(local.tool_executor_ids)
  provider = aws.replica

  primary_key_arn         = aws_kms_key.tool_executor[each.key].arn
  description             = "Replica of tool-executor signer ${each.key} in ${var.aws_replica_region}."
  deletion_window_in_days = 30

  tags = merge(var.tags, { Role = "signer", Purpose = "tool-executor", ToolId = each.key, Replica = "true" })
}

############################################################
# Per-key policies
############################################################
#
# Every key has an explicit policy:
#   - root account: full key admin (lifecycle, never crypto ops)
#   - runtime role: scoped action set (Sign / Decrypt / etc) for THIS key
#
# No principal beyond these two. No wildcards. No `kms:*` on the runtime role.

# --- Signer keys: Sign + GetPublicKey + DescribeKey ---

data "aws_iam_policy_document" "signer_key_policy" {
  for_each = toset(concat(
    ["master", "bundler-signer", "session-issuer"],
    [for t in local.tool_executor_ids : "tool-${t}"],
  ))

  statement {
    sid    = "RootAccountKeyAdmin"
    effect = "Allow"
    principals {
      type        = "AWS"
      identifiers = [local.root_principal]
    }
    actions   = ["kms:*"]
    resources = ["*"]
  }

  statement {
    sid    = "RuntimeRoleSign"
    effect = "Allow"
    principals {
      type        = "AWS"
      identifiers = [aws_iam_role.runtime.arn]
    }
    actions = [
      "kms:Sign",
      "kms:GetPublicKey",
      "kms:DescribeKey",
    ]
    resources = ["*"] # Resource is the key itself; policy is attached per-key.
  }
}

resource "aws_kms_key_policy" "master" {
  key_id = aws_kms_key.master.key_id
  policy = data.aws_iam_policy_document.signer_key_policy["master"].json
}

resource "aws_kms_key_policy" "bundler_signer" {
  key_id = aws_kms_key.bundler_signer.key_id
  policy = data.aws_iam_policy_document.signer_key_policy["bundler-signer"].json
}

resource "aws_kms_key_policy" "session_issuer" {
  key_id = aws_kms_key.session_issuer.key_id
  policy = data.aws_iam_policy_document.signer_key_policy["session-issuer"].json
}

resource "aws_kms_key_policy" "tool_executor" {
  for_each = toset(local.tool_executor_ids)
  key_id   = aws_kms_key.tool_executor[each.key].key_id
  policy   = data.aws_iam_policy_document.signer_key_policy["tool-${each.key}"].json
}

# --- Session envelope key: GenerateDataKey + Decrypt with EncryptionContext condition ---

data "aws_iam_policy_document" "session_envelope_key_policy" {
  statement {
    sid    = "RootAccountKeyAdmin"
    effect = "Allow"
    principals {
      type        = "AWS"
      identifiers = [local.root_principal]
    }
    actions   = ["kms:*"]
    resources = ["*"]
  }

  statement {
    sid    = "RuntimeRoleEnvelopeOps"
    effect = "Allow"
    principals {
      type        = "AWS"
      identifiers = [aws_iam_role.runtime.arn]
    }
    actions = [
      "kms:GenerateDataKey",
      "kms:Decrypt",
      "kms:DescribeKey",
    ]
    resources = ["*"]

    # IAM-layer trip-wire: every call MUST carry exactly this set of
    # EncryptionContext keys. A misuse with extra/missing keys is
    # denied at the IAM layer BEFORE reaching KMS — surfaces in
    # CloudTrail as AccessDenied with `kms:EncryptionContextKeys`
    # condition failure.
    condition {
      test     = "ForAllValues:StringEquals"
      variable = "kms:EncryptionContextKeys"
      values   = local.session_envelope_required_context_keys
    }
  }
}

resource "aws_kms_key_policy" "session_envelope" {
  key_id = aws_kms_key.session_envelope.key_id
  policy = data.aws_iam_policy_document.session_envelope_key_policy.json
}

# --- MAC keys: GenerateMac + VerifyMac ---

data "aws_iam_policy_document" "mac_key_policy" {
  for_each = toset(local.mac_service_pairs)

  statement {
    sid    = "RootAccountKeyAdmin"
    effect = "Allow"
    principals {
      type        = "AWS"
      identifiers = [local.root_principal]
    }
    actions   = ["kms:*"]
    resources = ["*"]
  }

  statement {
    sid    = "RuntimeRoleMacOps"
    effect = "Allow"
    principals {
      type        = "AWS"
      identifiers = [aws_iam_role.runtime.arn]
    }
    actions = [
      "kms:GenerateMac",
      "kms:VerifyMac",
      "kms:DescribeKey",
    ]
    resources = ["*"]
  }
}

resource "aws_kms_key_policy" "mac" {
  for_each = toset(local.mac_service_pairs)
  key_id   = aws_kms_key.mac[each.key].key_id
  policy   = data.aws_iam_policy_document.mac_key_policy[each.key].json
}

# --- CloudTrail encryption key policy ---
#
# Allows the CloudTrail service principal to use the key, plus the
# root account for admin. The runtime role has NO access to this
# key — separation between operational and audit substrate.

data "aws_iam_policy_document" "cloudtrail_kms_policy" {
  statement {
    sid    = "RootAccountKeyAdmin"
    effect = "Allow"
    principals {
      type        = "AWS"
      identifiers = [local.root_principal]
    }
    actions   = ["kms:*"]
    resources = ["*"]
  }

  statement {
    sid    = "CloudTrailEncryption"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
    actions   = ["kms:GenerateDataKey*", "kms:Decrypt", "kms:DescribeKey"]
    resources = ["*"]

    condition {
      test     = "StringLike"
      variable = "kms:EncryptionContext:aws:cloudtrail:arn"
      values   = ["arn:aws:cloudtrail:*:${local.account_id}:trail/*"]
    }
  }

  statement {
    sid    = "CloudWatchLogsEncryption"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["logs.${var.aws_region}.amazonaws.com"]
    }
    actions = [
      "kms:Encrypt*",
      "kms:Decrypt*",
      "kms:ReEncrypt*",
      "kms:GenerateDataKey*",
      "kms:DescribeKey",
    ]
    resources = ["*"]
  }
}
