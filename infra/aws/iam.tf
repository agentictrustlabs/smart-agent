# IAM — the runtime role and its Vercel-OIDC web-identity trust.
#
# Trust policy: sts:AssumeRoleWithWebIdentity from the Vercel OIDC
# issuer, gated on:
#   - aud = vercel_team_slug      (Vercel sets this)
#   - sub = "owner:<team>:project:<project>:environment:production"
#                                  (Vercel sets this for prod deploys)
#
# This ensures only the production deployment of THIS Vercel project,
# in THIS team, can assume the runtime role. Other projects, other
# environments, other teams, and non-Vercel principals are denied.
#
# Permission policy: explicitly enumerates each KMS key ARN. No
# wildcards. No `kms:*`. If a new key is added, this policy MUST be
# updated.

############################################################
# OIDC identity provider
############################################################
#
# Created once per AWS account. If multiple Vercel projects deploy
# into the same account, they share this provider. Importing an
# existing one is supported via `terraform import`.

resource "aws_iam_openid_connect_provider" "vercel" {
  url            = var.vercel_oidc_issuer
  client_id_list = [var.vercel_team_slug]

  # Vercel OIDC issuer's TLS-cert thumbprint. Operator supplies via
  # tfvars and re-runs the capture procedure (infra/README.md §
  # "OIDC trust") on cert rotation.
  thumbprint_list = [var.vercel_oidc_thumbprint]

  tags = merge(var.tags, { Purpose = "vercel-oidc-federation" })

  lifecycle {
    # Thumbprint changes (cert renewal) should be a deliberate
    # operator action, not a Terraform-induced replacement.
    ignore_changes = [thumbprint_list]
  }
}

############################################################
# Runtime role
############################################################

data "aws_iam_policy_document" "runtime_trust" {
  statement {
    sid     = "VercelOidcAssumeRole"
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.vercel.arn]
    }

    # `aud` MUST match the Vercel team slug.
    condition {
      test     = "StringEquals"
      variable = "${replace(var.vercel_oidc_issuer, "https://", "")}:aud"
      values   = [var.vercel_team_slug]
    }

    # `sub` MUST match a Vercel deployment of THIS project in
    # production. The format is documented at
    # https://vercel.com/docs/security/secure-backend-access/oidc/reference
    # — `owner:<team-slug>:project:<project-name>:environment:<env>`.
    #
    # Staging deployments would assume a DIFFERENT role with
    # `environment:preview` in the condition.
    condition {
      test     = "StringEquals"
      variable = "${replace(var.vercel_oidc_issuer, "https://", "")}:sub"
      values = [
        "owner:${var.vercel_team_slug}:project:${var.vercel_project_name}:environment:${var.environment == "prod" ? "production" : "preview"}",
      ]
    }
  }
}

resource "aws_iam_role" "runtime" {
  name               = "${var.project_name}-${var.environment}-runtime"
  description        = "Vercel-OIDC-federated runtime role for Smart Agent ${var.environment}. KMS Sign / Decrypt / GenerateMac scoped per key ARN."
  assume_role_policy = data.aws_iam_policy_document.runtime_trust.json

  # Short session — Vercel re-federates per cold-start; long sessions
  # provide no value and increase blast radius of a credential leak.
  max_session_duration = 3600

  tags = merge(var.tags, { Purpose = "runtime-federation" })
}

############################################################
# Permission policy — explicit per-key, no wildcards
############################################################
#
# Built as one IAM policy with one statement per action class. Every
# key ARN is enumerated. CI guard scripts/check-iam-no-wildcards.sh
# (to be added in Phase G) will reject any drift.

data "aws_iam_policy_document" "runtime_permissions" {
  # --- Signing on the three core asymmetric keys ---
  statement {
    sid    = "SignOnCoreSigningKeys"
    effect = "Allow"
    actions = [
      "kms:Sign",
      "kms:GetPublicKey",
      "kms:DescribeKey",
    ]
    resources = [
      aws_kms_key.master.arn,
      aws_kms_key.bundler_signer.arn,
      aws_kms_key.session_issuer.arn,
      # Replicas — multi-region keys have distinct ARNs in the
      # replica region; the runtime in the failover region uses these.
      aws_kms_replica_key.master.arn,
      aws_kms_replica_key.bundler_signer.arn,
      aws_kms_replica_key.session_issuer.arn,
    ]
  }

  # --- Signing on tool-executor keys ---
  statement {
    sid    = "SignOnToolExecutorKeys"
    effect = "Allow"
    actions = [
      "kms:Sign",
      "kms:GetPublicKey",
      "kms:DescribeKey",
    ]
    resources = concat(
      [for k, v in aws_kms_key.tool_executor : v.arn],
      [for k, v in aws_kms_replica_key.tool_executor : v.arn],
    )
  }

  # --- Envelope ops on the session-envelope key, with EncryptionContext condition ---
  statement {
    sid    = "EnvelopeOpsOnSessionKey"
    effect = "Allow"
    actions = [
      "kms:GenerateDataKey",
      "kms:Decrypt",
      "kms:DescribeKey",
    ]
    resources = [aws_kms_key.session_envelope.arn]

    # IAM-layer trip-wire: matches the key-policy condition in kms.tf.
    # Two layers of enforcement against EncryptionContext misuse.
    condition {
      test     = "ForAllValues:StringEquals"
      variable = "kms:EncryptionContextKeys"
      values   = local.session_envelope_required_context_keys
    }
  }

  # --- MAC ops on each per-MCP MAC key ---
  statement {
    sid    = "MacOpsOnInterServiceKeys"
    effect = "Allow"
    actions = [
      "kms:GenerateMac",
      "kms:VerifyMac",
      "kms:DescribeKey",
    ]
    resources = [for k, v in aws_kms_key.mac : v.arn]
  }

  # --- Deny ListKeys from the runtime principal ---
  #
  # Per K6 § 3.3.8: the runtime should NEVER call ListKeys; it knows
  # its key ARNs from env. Any occurrence implies SDK misconfiguration
  # OR an attacker enumerating. Explicit Deny short-circuits even an
  # accidental Allow elsewhere.
  statement {
    sid       = "DenyListKeys"
    effect    = "Deny"
    actions   = ["kms:ListKeys", "kms:ListAliases"]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "runtime_permissions" {
  name        = "${var.project_name}-${var.environment}-runtime-kms"
  description = "Scoped KMS permissions for the Smart Agent runtime role. No wildcards on key ARNs."
  policy      = data.aws_iam_policy_document.runtime_permissions.json

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "runtime_kms" {
  role       = aws_iam_role.runtime.name
  policy_arn = aws_iam_policy.runtime_permissions.arn
}

############################################################
# CloudTrail → CloudWatch Logs delivery role
############################################################
#
# Separate role used by the CloudTrail service to write to the log
# group. Not assumable by Vercel or any human principal.

data "aws_iam_policy_document" "cloudtrail_to_cw_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "cloudtrail_to_cw" {
  name               = "${var.project_name}-${var.environment}-cloudtrail-to-cw"
  description        = "Allows CloudTrail to deliver events to the CloudWatch log group."
  assume_role_policy = data.aws_iam_policy_document.cloudtrail_to_cw_trust.json

  tags = var.tags
}

data "aws_iam_policy_document" "cloudtrail_to_cw_permissions" {
  statement {
    effect = "Allow"
    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["${aws_cloudwatch_log_group.cloudtrail.arn}:*"]
  }
}

resource "aws_iam_role_policy" "cloudtrail_to_cw" {
  name   = "cloudtrail-cw-delivery"
  role   = aws_iam_role.cloudtrail_to_cw.id
  policy = data.aws_iam_policy_document.cloudtrail_to_cw_permissions.json
}
