# Outputs propagated to Vercel as env vars (operator-manual).
#
# Mapping:
#   GCP_KMS_PROJECT_ID                                <- var.gcp_project_id
#   GCP_KMS_LOCATION                                  <- var.gcp_region
#   GCP_WORKLOAD_IDENTITY_PROVIDER                    <- workload_identity_provider_resource
#   GCP_RUNTIME_SERVICE_ACCOUNT                       <- runtime_service_account_email
#   GCP_KMS_SESSION_ENVELOPE_KEY                      <- session_envelope_key_id
#   GCP_KMS_MASTER_SIGNER_KEY_VERSION                 <- master_signer_key_id + "/cryptoKeyVersions/1"
#   GCP_KMS_TOOL_EXECUTOR_<ID>_VERSION                <- per-tool key id + "/cryptoKeyVersions/1"
#   GCP_KMS_MAC_<PAIR>                                <- mac_key_ids[<pair>]

output "runtime_service_account_email" {
  description = "Service account impersonated by the Vercel deployment via WIF."
  value       = google_service_account.runtime.email
}

output "workload_identity_provider_resource" {
  description = "Full resource name of the Vercel OIDC WIF provider. Used in the Vercel env as the federation target."
  value       = google_iam_workload_identity_pool_provider.vercel.name
}

output "key_ring_id" {
  description = "Resource ID of the smart-agent KMS keyring."
  value       = google_kms_key_ring.smart_agent.id
}

output "master_signer_key_id" {
  description = "Resource ID of the master EOA signer crypto key."
  value       = google_kms_crypto_key.signer["master"].id
}

output "bundler_signer_key_id" {
  description = "Resource ID of the bundler-envelope signer."
  value       = google_kms_crypto_key.signer["bundler-signer"].id
}

output "session_issuer_key_id" {
  description = "Resource ID of the session-issuer signer."
  value       = google_kms_crypto_key.signer["session-issuer"].id
}

output "tool_executor_key_ids" {
  description = "Map of tool-executor id -> Cloud KMS crypto-key resource ID."
  value       = { for k, v in google_kms_crypto_key.tool_executor : k => v.id }
}

output "session_envelope_key_id" {
  description = "Resource ID of the session-envelope KEK (HSM-protected, 90-day rotation)."
  value       = google_kms_crypto_key.session_envelope.id
}

output "mac_key_ids" {
  description = "Map of inter-service pair -> Cloud KMS MAC key resource ID."
  value       = { for k, v in google_kms_crypto_key.mac : k => v.id }
}

output "audit_log_bucket" {
  description = "GCS bucket name holding the WORM audit-log archive (7-year locked retention)."
  value       = google_storage_bucket.audit_logs.name
}
