# Audit log routing to long-term WORM storage (K6 § 5.2).
#
# Cloud Audit Logs default sink retains 30 days only. We sink them
# to a GCS bucket with a locked 7-year retention policy.

############################################################
# GCS bucket — WORM audit storage
############################################################

resource "google_storage_bucket" "audit_logs" {
  name                        = "${var.project_name}-audit-logs-${var.environment}-${var.gcp_project_id}"
  location                    = upper(var.gcp_region) # GCS bucket locations are uppercased.
  storage_class               = "ARCHIVE"
  uniform_bucket_level_access = true
  force_destroy               = false # NEVER allow Terraform to delete this bucket.

  # 7-year retention policy. is_locked = true makes it permanent —
  # once locked, even a project owner cannot reduce the retention
  # period. The bucket itself cannot be deleted until every object
  # is past its retention.
  retention_policy {
    retention_period = var.audit_log_retention_seconds
    is_locked        = true
  }

  versioning {
    enabled = true
  }

  labels = merge(var.labels, { purpose = "audit-log-storage" })

  lifecycle {
    prevent_destroy = true
  }
}

############################################################
# Log sink — KMS-related logs only
############################################################

resource "google_logging_project_sink" "kms_audit" {
  name        = "${var.project_name}-${var.environment}-kms-audit"
  destination = "storage.googleapis.com/${google_storage_bucket.audit_logs.name}"

  # Filter captures every cloudkms operation across every resource
  # type that may surface them. The exact phrasing is from K6 § 5.2.
  filter = <<-EOT
    resource.type="cloudkms_cryptokey"
    OR resource.type="cloudkms_keyring"
    OR (resource.type="audited_resource" AND protoPayload.serviceName="cloudkms.googleapis.com")
  EOT

  unique_writer_identity = true
}

# Grant the sink's writer identity permission to write to the bucket.
resource "google_storage_bucket_iam_member" "kms_audit_sink_writer" {
  bucket = google_storage_bucket.audit_logs.name
  role   = "roles/storage.objectCreator"
  member = google_logging_project_sink.kms_audit.writer_identity
}

############################################################
# Alert policies — G-KMS-1..8 per K6 § 5.3
############################################################
#
# Each policy uses a log-based metric. We define the metric and the
# alert policy together. Notification channels are operator-supplied
# (we do not provision PagerDuty channels from Terraform).

# G-KMS-1 — AsymmetricSign count anomaly (P2)
resource "google_logging_metric" "g_kms_1_sign_count" {
  name   = "${var.project_name}-${var.environment}/g-kms-1-sign-count"
  filter = "protoPayload.serviceName=\"cloudkms.googleapis.com\" AND protoPayload.methodName=\"AsymmetricSign\""

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
}

# G-KMS-4 — Unexpected principal calling signing methods (P0)
resource "google_logging_metric" "g_kms_4_wrong_principal" {
  name   = "${var.project_name}-${var.environment}/g-kms-4-wrong-principal"
  filter = "protoPayload.serviceName=\"cloudkms.googleapis.com\" AND (protoPayload.methodName=\"AsymmetricSign\" OR protoPayload.methodName=\"MacSign\" OR protoPayload.methodName=\"Encrypt\" OR protoPayload.methodName=\"Decrypt\") AND protoPayload.authenticationInfo.principalEmail!=\"${google_service_account.runtime.email}\""

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
}

# G-KMS-5 — Failure spike (P1)
resource "google_logging_metric" "g_kms_5_failures" {
  name   = "${var.project_name}-${var.environment}/g-kms-5-failures"
  filter = "protoPayload.serviceName=\"cloudkms.googleapis.com\" AND severity>=ERROR"

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
}

# G-KMS-7 — DestroyCryptoKeyVersion (P0)
resource "google_logging_metric" "g_kms_7_destroy" {
  name   = "${var.project_name}-${var.environment}/g-kms-7-destroy"
  filter = "protoPayload.serviceName=\"cloudkms.googleapis.com\" AND protoPayload.methodName=\"DestroyCryptoKeyVersion\""

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
}

# G-KMS-8 — ListCryptoKeys from runtime principal (P1)
resource "google_logging_metric" "g_kms_8_list_keys" {
  name   = "${var.project_name}-${var.environment}/g-kms-8-list-keys"
  filter = "protoPayload.serviceName=\"cloudkms.googleapis.com\" AND protoPayload.methodName=\"ListCryptoKeys\" AND protoPayload.authenticationInfo.principalEmail=\"${google_service_account.runtime.email}\""

  metric_descriptor {
    metric_kind = "DELTA"
    value_type  = "INT64"
  }
}

# Alert policies — wire to log-based metrics. Notification channels
# are configured separately by the operator (we don't provision
# PagerDuty webhooks from Terraform).

resource "google_monitoring_alert_policy" "g_kms_4" {
  display_name = "G-KMS-4 — KMS signing op from unexpected principal (P0)"
  combiner     = "OR"

  conditions {
    display_name = "Any occurrence"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${var.project_name}-${var.environment}/g-kms-4-wrong-principal\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "60s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }

  alert_strategy {
    auto_close = "604800s" # 7 days
  }

  user_labels = merge(var.labels, { severity = "p0", rule = "g-kms-4" })
}

resource "google_monitoring_alert_policy" "g_kms_5" {
  display_name = "G-KMS-5 — Cloud KMS failure spike (P1)"
  combiner     = "OR"

  conditions {
    display_name = ">10 failures in 5 min"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${var.project_name}-${var.environment}/g-kms-5-failures\""
      comparison      = "COMPARISON_GT"
      threshold_value = 10
      duration        = "300s"
      aggregations {
        alignment_period   = "300s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }

  user_labels = merge(var.labels, { severity = "p1", rule = "g-kms-5" })
}

resource "google_monitoring_alert_policy" "g_kms_7" {
  display_name = "G-KMS-7 — DestroyCryptoKeyVersion called (P0)"
  combiner     = "OR"

  conditions {
    display_name = "Any occurrence"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${var.project_name}-${var.environment}/g-kms-7-destroy\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "60s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }

  user_labels = merge(var.labels, { severity = "p0", rule = "g-kms-7" })
}

resource "google_monitoring_alert_policy" "g_kms_8" {
  display_name = "G-KMS-8 — runtime called ListCryptoKeys (P1)"
  combiner     = "OR"

  conditions {
    display_name = "Any occurrence"
    condition_threshold {
      filter          = "metric.type=\"logging.googleapis.com/user/${var.project_name}-${var.environment}/g-kms-8-list-keys\""
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      duration        = "60s"
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_SUM"
      }
    }
  }

  user_labels = merge(var.labels, { severity = "p1", rule = "g-kms-8" })
}
