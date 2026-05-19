# GCP Cloud KMS — mirror of the AWS key inventory.
#
# Per K4 § 4.2: EVERY key version is `protection_level = "HSM"`.
# Without HSM protection, the keys are SOFTWARE-backed and our FIPS
# posture does not hold.
#
# Per K6 § 5.1: Data Access audit logs are enabled for
# `cloudkms.googleapis.com` — off by default for most GCP services;
# without this, `AsymmetricSign` / `Encrypt` / `Decrypt` / `MacSign`
# / `MacVerify` are NOT logged.
#
# Algorithm choices match AWS:
#   - Asymmetric signing: EC_SIGN_SECP256K1_SHA256
#   - Symmetric envelope: GOOGLE_SYMMETRIC_ENCRYPTION (AES-256-GCM)
#   - MAC: HMAC_SHA256

############################################################
# Service identity — Workload Identity Federation
############################################################
#
# Vercel OIDC token -> Workload Identity Pool -> Workload Identity
# Pool Provider -> Service Account (impersonated). The service
# account is the principal that holds per-key IAM bindings.
#
# Setup is in iam.tf; we reference the SA email here for key
# bindings.

############################################################
# Keyring
############################################################

resource "google_kms_key_ring" "smart_agent" {
  name     = "${var.project_name}-${var.environment}"
  location = var.gcp_region
}

############################################################
# Asymmetric signing keys (HSM-protected)
############################################################

locals {
  asymmetric_signer_keys = {
    "master"           = "Master EOA signer (secp256k1) — HSM-backed per K4-A4."
    "bundler-signer"   = "Bundler-envelope signer (secp256k1) — HSM-backed per K4-A4."
    "session-issuer"   = "Session-key issuance signer (secp256k1) — HSM-backed per K4-A4."
  }

  tool_executor_ids = [
    "round-awards",
    "disbursement",
    "pool-lifecycle",
    "grant-awards",
    "auth-bootstrap",
  ]
}

resource "google_kms_crypto_key" "signer" {
  for_each = local.asymmetric_signer_keys

  name     = each.key
  key_ring = google_kms_key_ring.smart_agent.id
  purpose  = "ASYMMETRIC_SIGN"

  version_template {
    algorithm        = "EC_SIGN_SECP256K1_SHA256"
    protection_level = "HSM" # K4 § 4.2 — REQUIRED for FIPS posture.
  }

  # Manual rotation per K1 — automatic rotation is not supported for
  # asymmetric keys in GCP KMS.

  labels = merge(var.labels, { role = "signer", purpose = replace(each.key, "_", "-") })

  lifecycle {
    prevent_destroy = true
  }
}

resource "google_kms_crypto_key" "tool_executor" {
  for_each = toset(local.tool_executor_ids)

  name     = "tool-${each.key}"
  key_ring = google_kms_key_ring.smart_agent.id
  purpose  = "ASYMMETRIC_SIGN"

  version_template {
    algorithm        = "EC_SIGN_SECP256K1_SHA256"
    protection_level = "HSM"
  }

  labels = merge(var.labels, { role = "signer", purpose = "tool-executor", tool_id = each.key })

  lifecycle {
    prevent_destroy = true
  }
}

############################################################
# Symmetric envelope key (HSM-protected, 90-day rotation)
############################################################

resource "google_kms_crypto_key" "session_envelope" {
  name     = "session-envelope"
  key_ring = google_kms_key_ring.smart_agent.id
  purpose  = "ENCRYPT_DECRYPT"

  version_template {
    algorithm        = "GOOGLE_SYMMETRIC_ENCRYPTION"
    protection_level = "HSM"
  }

  rotation_period = "7776000s" # 90 days. Automatic rotation supported for symmetric keys.

  labels = merge(var.labels, { role = "envelope", purpose = "session-package" })

  lifecycle {
    prevent_destroy = true
  }
}

############################################################
# Inter-service MAC keys (HSM-protected)
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

resource "google_kms_crypto_key" "mac" {
  for_each = toset(local.mac_service_pairs)

  name     = "mac-${each.key}"
  key_ring = google_kms_key_ring.smart_agent.id
  purpose  = "MAC"

  version_template {
    algorithm        = "HMAC_SHA256"
    protection_level = "HSM"
  }

  labels = merge(var.labels, { role = "mac", purpose = "inter-service", pair = each.key })

  lifecycle {
    prevent_destroy = true
  }
}

############################################################
# Per-key IAM bindings
############################################################
#
# Each key grants only the actions the runtime needs, to the
# runtime service account. No wildcards.

# Asymmetric signers — Signer + PublicKeyViewer
resource "google_kms_crypto_key_iam_binding" "signer_sign" {
  for_each = local.asymmetric_signer_keys

  crypto_key_id = google_kms_crypto_key.signer[each.key].id
  role          = "roles/cloudkms.signer"

  members = ["serviceAccount:${google_service_account.runtime.email}"]
}

resource "google_kms_crypto_key_iam_binding" "signer_public_key" {
  for_each = local.asymmetric_signer_keys

  crypto_key_id = google_kms_crypto_key.signer[each.key].id
  role          = "roles/cloudkms.publicKeyViewer"

  members = ["serviceAccount:${google_service_account.runtime.email}"]
}

resource "google_kms_crypto_key_iam_binding" "tool_executor_sign" {
  for_each = toset(local.tool_executor_ids)

  crypto_key_id = google_kms_crypto_key.tool_executor[each.key].id
  role          = "roles/cloudkms.signer"

  members = ["serviceAccount:${google_service_account.runtime.email}"]
}

resource "google_kms_crypto_key_iam_binding" "tool_executor_public_key" {
  for_each = toset(local.tool_executor_ids)

  crypto_key_id = google_kms_crypto_key.tool_executor[each.key].id
  role          = "roles/cloudkms.publicKeyViewer"

  members = ["serviceAccount:${google_service_account.runtime.email}"]
}

# Session envelope — CryptoKeyEncrypterDecrypter
resource "google_kms_crypto_key_iam_binding" "session_envelope_ops" {
  crypto_key_id = google_kms_crypto_key.session_envelope.id
  role          = "roles/cloudkms.cryptoKeyEncrypterDecrypter"

  members = ["serviceAccount:${google_service_account.runtime.email}"]
}

# MAC keys — Signer + Verifier
resource "google_kms_crypto_key_iam_binding" "mac_signer" {
  for_each = toset(local.mac_service_pairs)

  crypto_key_id = google_kms_crypto_key.mac[each.key].id
  role          = "roles/cloudkms.signerVerifier"

  members = ["serviceAccount:${google_service_account.runtime.email}"]
}

############################################################
# Cloud Audit Logs — Data Access for cloudkms (K6 § 5.1)
############################################################
#
# This is the GCP-side equivalent of CloudTrail data events. WITHOUT
# this, GCP does not log `cryptoKeys.encrypt`, `decrypt`,
# `asymmetricSign`, `macSign`, `macVerify`. We become invisible to
# audit. Enabling it is a per-service config, off by default.

resource "google_project_iam_audit_config" "cloudkms" {
  project = var.gcp_project_id
  service = "cloudkms.googleapis.com"

  audit_log_config {
    log_type = "ADMIN_READ"
  }
  audit_log_config {
    log_type = "DATA_READ"
  }
  audit_log_config {
    log_type = "DATA_WRITE"
  }
}
