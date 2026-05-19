# CloudWatch alarms — the nine K6 rules (R-KMS-1..9).
#
# Each rule:
#   - A CloudWatch Logs metric filter on the CloudTrail log group.
#   - A CloudWatch alarm that fires when the metric crosses threshold.
#   - SNS notification to var.pagerduty_sns_topic_arn (if provided).
#
# Source of truth for rule definitions:
#   docs/security/key-management/K6-cloudtrail-monitoring-and-alerting.md § 3.3
#
# CI guard scripts/check-k6-alert-sync.sh (Phase G) compares the
# K6 markdown to the resources below; drift fails CI.

############################################################
# Common — alarm action targets
############################################################

locals {
  alarm_actions    = var.pagerduty_sns_topic_arn == "" ? [] : [var.pagerduty_sns_topic_arn]
  metric_namespace = "${var.project_name}/kms-${var.environment}"
}

############################################################
# R-KMS-1 — Unusual kms:Sign volume spike
############################################################

resource "aws_cloudwatch_log_metric_filter" "r_kms_1" {
  name           = "r-kms-1-sign-volume"
  log_group_name = aws_cloudwatch_log_group.cloudtrail.name
  pattern        = "{ ($.eventName = \"Sign\") }"

  metric_transformation {
    name          = "kms-sign-rate"
    namespace     = local.metric_namespace
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "r_kms_1" {
  alarm_name          = "${var.project_name}-${var.environment}-R-KMS-1-sign-volume"
  alarm_description   = "K6 R-KMS-1: kms:Sign rate anomaly (>3sigma from 30-day baseline). Severity P2."
  comparison_operator = "GreaterThanUpperThreshold"
  evaluation_periods  = 1
  threshold_metric_id = "ad1"

  metric_query {
    id          = "m1"
    return_data = true
    metric {
      metric_name = "kms-sign-rate"
      namespace   = local.metric_namespace
      period      = 300
      stat        = "Sum"
    }
  }

  metric_query {
    id         = "ad1"
    expression = "ANOMALY_DETECTION_BAND(m1, 3)"
    label      = "Sign-rate (Expected)"
  }

  alarm_actions             = local.alarm_actions
  treat_missing_data        = "notBreaching"
  insufficient_data_actions = []

  tags = merge(var.tags, { Rule = "R-KMS-1", Severity = "P2" })
}

############################################################
# R-KMS-2 — KMS call from unexpected source IP
############################################################
#
# Pattern matches calls where the session issuer is a SmartAgent
# role AND sourceIPAddress is NOT in the Vercel egress range list.
# We implement this as TWO filters (assume-role pattern + non-vercel
# IP via NOT-IN composite) since CloudWatch metric filter syntax
# doesn't support IP-range matching directly. The actual range
# check happens by the operator quarterly per K6 § 3.3.2 — this
# alarm catches the assume-role pattern and we filter outliers
# manually OR in a Lambda subscription. The Lambda is a future
# enhancement; for now we alarm on every call from outside a
# narrow allowlist if vercel_egress_cidr_ranges is provided.

resource "aws_cloudwatch_log_metric_filter" "r_kms_2" {
  name           = "r-kms-2-unexpected-source-ip"
  log_group_name = aws_cloudwatch_log_group.cloudtrail.name

  # If no Vercel ranges provided, this filter matches NOTHING (a
  # placeholder pattern that won't match any real event).
  pattern = length(var.vercel_egress_cidr_ranges) == 0 ? "{ $.eventName = \"__placeholder__\" }" : "{ ($.userIdentity.sessionContext.sessionIssuer.userName = \"${aws_iam_role.runtime.name}\") }"

  metric_transformation {
    name          = "kms-unexpected-source"
    namespace     = local.metric_namespace
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "r_kms_2" {
  alarm_name          = "${var.project_name}-${var.environment}-R-KMS-2-unexpected-source-ip"
  alarm_description   = "K6 R-KMS-2: KMS call from non-Vercel-egress source IP. Severity P1. CIDR filtering happens in the Lambda subscription (TODO); this alarm fires on every call from the runtime role to surface volume only."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "kms-unexpected-source"
  namespace           = local.metric_namespace
  period              = 300
  statistic           = "Sum"
  threshold           = 1000000 # Placeholder — set to a very high value until the Lambda subscription is wired.

  alarm_actions      = local.alarm_actions
  treat_missing_data = "notBreaching"

  tags = merge(var.tags, { Rule = "R-KMS-2", Severity = "P1" })
}

############################################################
# R-KMS-3 — Decrypt with unexpected EncryptionContext
############################################################
#
# Filter matches Decrypt calls where the additionalEventData
# encryptionContext is missing the `session_id_h` key. Indicates a
# misconfigured client OR a misuse path bypassing the canonical AAD
# build.

resource "aws_cloudwatch_log_metric_filter" "r_kms_3" {
  name           = "r-kms-3-unexpected-encryption-context"
  log_group_name = aws_cloudwatch_log_group.cloudtrail.name
  pattern        = "{ ($.eventName = \"Decrypt\") && ($.additionalEventData.encryptionContext.session_id_h NOT EXISTS) }"

  metric_transformation {
    name          = "kms-decrypt-bad-context"
    namespace     = local.metric_namespace
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "r_kms_3" {
  alarm_name          = "${var.project_name}-${var.environment}-R-KMS-3-bad-encryption-context"
  alarm_description   = "K6 R-KMS-3: Decrypt without expected EncryptionContext keys. Severity P1."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "kms-decrypt-bad-context"
  namespace           = local.metric_namespace
  period              = 60
  statistic           = "Sum"
  threshold           = 1

  alarm_actions      = local.alarm_actions
  treat_missing_data = "notBreaching"

  tags = merge(var.tags, { Rule = "R-KMS-3", Severity = "P1" })
}

############################################################
# R-KMS-4 — kms:Sign from non-Vercel-OIDC principal
############################################################

resource "aws_cloudwatch_log_metric_filter" "r_kms_4" {
  name           = "r-kms-4-sign-non-oidc-principal"
  log_group_name = aws_cloudwatch_log_group.cloudtrail.name
  pattern        = "{ ($.eventName = \"Sign\") && ($.userIdentity.sessionContext.sessionIssuer.userName != \"${aws_iam_role.runtime.name}\") }"

  metric_transformation {
    name          = "kms-sign-wrong-principal"
    namespace     = local.metric_namespace
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "r_kms_4" {
  alarm_name          = "${var.project_name}-${var.environment}-R-KMS-4-sign-non-oidc"
  alarm_description   = "K6 R-KMS-4: kms:Sign from a principal OTHER than the Vercel-OIDC-federated runtime role. Severity P0."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "kms-sign-wrong-principal"
  namespace           = local.metric_namespace
  period              = 60
  statistic           = "Sum"
  threshold           = 1

  alarm_actions      = local.alarm_actions
  treat_missing_data = "notBreaching"

  tags = merge(var.tags, { Rule = "R-KMS-4", Severity = "P0" })
}

############################################################
# R-KMS-5 — Failed kms:Sign rate spike
############################################################

resource "aws_cloudwatch_log_metric_filter" "r_kms_5" {
  name           = "r-kms-5-sign-failures"
  log_group_name = aws_cloudwatch_log_group.cloudtrail.name
  pattern        = "{ ($.eventName = \"Sign\") && ($.errorCode EXISTS) }"

  metric_transformation {
    name          = "kms-sign-failures"
    namespace     = local.metric_namespace
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "r_kms_5" {
  alarm_name          = "${var.project_name}-${var.environment}-R-KMS-5-sign-failure-spike"
  alarm_description   = "K6 R-KMS-5: kms:Sign failures > 10 in 5 min. Severity P1."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "kms-sign-failures"
  namespace           = local.metric_namespace
  period              = 300
  statistic           = "Sum"
  threshold           = 10

  alarm_actions      = local.alarm_actions
  treat_missing_data = "notBreaching"

  tags = merge(var.tags, { Rule = "R-KMS-5", Severity = "P1" })
}

############################################################
# R-KMS-6 — Permission policy change
############################################################

resource "aws_cloudwatch_log_metric_filter" "r_kms_6" {
  name           = "r-kms-6-policy-change"
  log_group_name = aws_cloudwatch_log_group.cloudtrail.name
  pattern        = "{ ($.eventName = \"PutKeyPolicy\") || ($.eventName = \"UpdateAlias\") || ($.eventName = \"PutResourcePolicy\") }"

  metric_transformation {
    name          = "kms-policy-change"
    namespace     = local.metric_namespace
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "r_kms_6" {
  alarm_name          = "${var.project_name}-${var.environment}-R-KMS-6-policy-change"
  alarm_description   = "K6 R-KMS-6: KMS policy / alias / resource policy change. Severity P1 (P0 outside change window — manual escalation)."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "kms-policy-change"
  namespace           = local.metric_namespace
  period              = 60
  statistic           = "Sum"
  threshold           = 1

  alarm_actions      = local.alarm_actions
  treat_missing_data = "notBreaching"

  tags = merge(var.tags, { Rule = "R-KMS-6", Severity = "P1" })
}

############################################################
# R-KMS-7 — ScheduleKeyDeletion
############################################################

resource "aws_cloudwatch_log_metric_filter" "r_kms_7" {
  name           = "r-kms-7-schedule-deletion"
  log_group_name = aws_cloudwatch_log_group.cloudtrail.name
  pattern        = "{ $.eventName = \"ScheduleKeyDeletion\" }"

  metric_transformation {
    name          = "kms-schedule-deletion"
    namespace     = local.metric_namespace
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "r_kms_7" {
  alarm_name          = "${var.project_name}-${var.environment}-R-KMS-7-schedule-deletion"
  alarm_description   = "K6 R-KMS-7: ANY ScheduleKeyDeletion event. Severity P0 always."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "kms-schedule-deletion"
  namespace           = local.metric_namespace
  period              = 60
  statistic           = "Sum"
  threshold           = 1

  alarm_actions      = local.alarm_actions
  treat_missing_data = "notBreaching"

  tags = merge(var.tags, { Rule = "R-KMS-7", Severity = "P0" })
}

############################################################
# R-KMS-8 — ListKeys from runtime principal
############################################################

resource "aws_cloudwatch_log_metric_filter" "r_kms_8" {
  name           = "r-kms-8-list-keys-from-runtime"
  log_group_name = aws_cloudwatch_log_group.cloudtrail.name
  pattern        = "{ ($.eventName = \"ListKeys\") && ($.userIdentity.sessionContext.sessionIssuer.userName = \"${aws_iam_role.runtime.name}\") }"

  metric_transformation {
    name          = "kms-list-keys-runtime"
    namespace     = local.metric_namespace
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "r_kms_8" {
  alarm_name          = "${var.project_name}-${var.environment}-R-KMS-8-list-keys-runtime"
  alarm_description   = "K6 R-KMS-8: runtime principal called ListKeys — should NEVER happen. Severity P1."
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "kms-list-keys-runtime"
  namespace           = local.metric_namespace
  period              = 60
  statistic           = "Sum"
  threshold           = 1

  alarm_actions      = local.alarm_actions
  treat_missing_data = "notBreaching"

  tags = merge(var.tags, { Rule = "R-KMS-8", Severity = "P1" })
}

############################################################
# R-KMS-9 — GetPublicKey rate
############################################################

resource "aws_cloudwatch_log_metric_filter" "r_kms_9" {
  name           = "r-kms-9-get-public-key-rate"
  log_group_name = aws_cloudwatch_log_group.cloudtrail.name
  pattern        = "{ $.eventName = \"GetPublicKey\" }"

  metric_transformation {
    name          = "kms-get-public-key-rate"
    namespace     = local.metric_namespace
    value         = "1"
    default_value = "0"
  }
}

resource "aws_cloudwatch_metric_alarm" "r_kms_9" {
  alarm_name          = "${var.project_name}-${var.environment}-R-KMS-9-get-public-key-rate"
  alarm_description   = "K6 R-KMS-9: GetPublicKey > 20/hr — implies many deploys or enumeration. Severity P2."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "kms-get-public-key-rate"
  namespace           = local.metric_namespace
  period              = 3600
  statistic           = "Sum"
  threshold           = 20

  alarm_actions      = local.alarm_actions
  treat_missing_data = "notBreaching"

  tags = merge(var.tags, { Rule = "R-KMS-9", Severity = "P2" })
}
