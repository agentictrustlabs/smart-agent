# CloudTrail — audit trail for every KMS API call.
#
# Configuration per K6 § 3.2:
#   - Multi-region trail (kms calls in any region captured)
#   - Object-level event selector on AWS::KMS::Key (data events,
#     NOT just management events — default trails miss Sign/Decrypt)
#   - Log file validation (digest files signed by AWS)
#   - Encrypted with a separate KMS key (cloudtrail_encryption, kms.tf)
#   - S3 Object Lock COMPLIANCE mode, 7-year retention (WORM)
#   - CloudWatch Logs mirror with 90-day retention (real-time query)
#
# Alarms (K6 § 3.3, R-KMS-1..9) live in cloudwatch-alarms.tf.

############################################################
# S3 bucket — long-term audit storage (WORM)
############################################################

resource "aws_s3_bucket" "cloudtrail_logs" {
  bucket = "${var.project_name}-cloudtrail-logs-${var.environment}-${local.account_id}"

  # CRITICAL: object_lock_enabled is set at bucket CREATION time and
  # CANNOT be changed later. Destroying and recreating the bucket
  # would lose the audit history — protect with prevent_destroy.
  object_lock_enabled = true

  tags = merge(var.tags, { Purpose = "audit-trail-storage" })

  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "cloudtrail_logs" {
  bucket = aws_s3_bucket.cloudtrail_logs.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_object_lock_configuration" "cloudtrail_logs" {
  bucket = aws_s3_bucket.cloudtrail_logs.id

  rule {
    default_retention {
      mode = "COMPLIANCE" # COMPLIANCE = no override possible, even by root. GOVERNANCE = override with privileged IAM. Per K6 § 3.2 + A1/A2: COMPLIANCE.
      days = var.audit_log_retention_days
    }
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "cloudtrail_logs" {
  bucket = aws_s3_bucket.cloudtrail_logs.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.cloudtrail_encryption.arn
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "cloudtrail_logs" {
  bucket = aws_s3_bucket.cloudtrail_logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

data "aws_iam_policy_document" "cloudtrail_bucket_policy" {
  statement {
    sid    = "CloudTrailAclCheck"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
    actions   = ["s3:GetBucketAcl"]
    resources = [aws_s3_bucket.cloudtrail_logs.arn]
  }

  statement {
    sid    = "CloudTrailWrite"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["cloudtrail.amazonaws.com"]
    }
    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.cloudtrail_logs.arn}/AWSLogs/${local.account_id}/*"]

    condition {
      test     = "StringEquals"
      variable = "s3:x-amz-acl"
      values   = ["bucket-owner-full-control"]
    }
  }

  # Deny any non-TLS access.
  statement {
    sid    = "DenyNonTls"
    effect = "Deny"
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.cloudtrail_logs.arn, "${aws_s3_bucket.cloudtrail_logs.arn}/*"]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "cloudtrail_logs" {
  bucket = aws_s3_bucket.cloudtrail_logs.id
  policy = data.aws_iam_policy_document.cloudtrail_bucket_policy.json
}

############################################################
# CloudWatch log group — real-time mirror (90-day retention)
############################################################

resource "aws_cloudwatch_log_group" "cloudtrail" {
  name              = "/aws/cloudtrail/${var.project_name}-${var.environment}"
  retention_in_days = var.cloudwatch_log_retention_days
  kms_key_id        = aws_kms_key.cloudtrail_encryption.arn

  tags = merge(var.tags, { Purpose = "cloudtrail-realtime-mirror" })
}

############################################################
# The trail itself
############################################################

resource "aws_cloudtrail" "main" {
  name                          = "${var.project_name}-${var.environment}-audit"
  s3_bucket_name                = aws_s3_bucket.cloudtrail_logs.id
  include_global_service_events = true
  is_multi_region_trail         = true
  is_organization_trail         = false
  enable_log_file_validation    = true
  enable_logging                = true

  kms_key_id = aws_kms_key.cloudtrail_encryption.arn

  cloud_watch_logs_group_arn = "${aws_cloudwatch_log_group.cloudtrail.arn}:*"
  cloud_watch_logs_role_arn  = aws_iam_role.cloudtrail_to_cw.arn

  # Per K6 § 3.2: capture object-level data events on KMS keys.
  # Default trails do NOT capture Sign/Decrypt/GenerateDataKey events —
  # only management events. This selector is the difference between
  # "we know who called Sign" and "we have no record of who signed what".
  advanced_event_selector {
    name = "Capture all KMS data events"

    field_selector {
      field  = "eventCategory"
      equals = ["Data"]
    }

    field_selector {
      field  = "resources.type"
      equals = ["AWS::KMS::Key"]
    }
  }

  # Management events — separate selector so we capture both classes.
  advanced_event_selector {
    name = "Capture all management events"

    field_selector {
      field  = "eventCategory"
      equals = ["Management"]
    }
  }

  depends_on = [aws_s3_bucket_policy.cloudtrail_logs]

  tags = var.tags
}
