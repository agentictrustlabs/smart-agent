# Outputs — KMS key ARNs propagate to Vercel as env vars.
#
# The Vercel deployment reads these into:
#   AWS_REGION                              <- var.aws_region
#   AWS_ROLE_ARN                            <- runtime_role_arn
#   AWS_KMS_KEY_ID                          <- session_envelope_key_arn
#   A2A_MASTER_SIGNER_KEY_ARN               <- master_signer_key_arn
#   A2A_BUNDLER_SIGNER_KEY_ARN              <- bundler_signer_key_arn
#   A2A_SESSION_ISSUER_KEY_ARN              <- session_issuer_key_arn
#   TOOL_EXECUTOR_<ID>_KEY_ARN              <- tool_executor_key_arns[<id>]
#   MAC_KEY_<PAIR>_ARN                      <- mac_key_arns[<pair>]
#
# Propagation is operator-manual (vercel env add) for v1.

############################################################
# IAM
############################################################

output "runtime_role_arn" {
  description = "ARN of the Vercel-OIDC-federated runtime role. Set as AWS_ROLE_ARN in the Vercel project env."
  value       = aws_iam_role.runtime.arn
}

output "vercel_oidc_provider_arn" {
  description = "ARN of the OIDC identity provider configured for Vercel federation."
  value       = aws_iam_openid_connect_provider.vercel.arn
}

############################################################
# KMS — signing
############################################################

output "master_signer_key_arn" {
  description = "Primary-region ARN of the master EOA signer key."
  value       = aws_kms_key.master.arn
}

output "master_signer_key_replica_arn" {
  description = "Replica-region ARN of the master EOA signer key."
  value       = aws_kms_replica_key.master.arn
}

output "bundler_signer_key_arn" {
  description = "Primary-region ARN of the bundler-envelope signer key."
  value       = aws_kms_key.bundler_signer.arn
}

output "session_issuer_key_arn" {
  description = "Primary-region ARN of the session-issuer signer key."
  value       = aws_kms_key.session_issuer.arn
}

output "tool_executor_key_arns" {
  description = "Map of tool-executor id -> primary-region key ARN. Keys: round-awards, disbursement, pool-lifecycle, grant-awards, auth-bootstrap."
  value       = { for k, v in aws_kms_key.tool_executor : k => v.arn }
}

############################################################
# KMS — envelope
############################################################

output "session_envelope_key_arn" {
  description = "ARN of the session-package envelope KEK. Set as AWS_KMS_KEY_ID in the Vercel project env."
  value       = aws_kms_key.session_envelope.arn
}

output "cloudtrail_encryption_key_arn" {
  description = "ARN of the CloudTrail audit-log encryption KEK. Operational keys do NOT have access to this key."
  value       = aws_kms_key.cloudtrail_encryption.arn
}

############################################################
# KMS — MAC
############################################################

output "mac_key_arns" {
  description = "Map of inter-service pair -> HMAC_256 key ARN. Keys: a2a-to-person, a2a-to-org, a2a-to-hub, a2a-to-people-group, a2a-to-family, a2a-to-geo, a2a-to-verifier, a2a-to-skill."
  value       = { for k, v in aws_kms_key.mac : k => v.arn }
}

############################################################
# CloudTrail
############################################################

output "cloudtrail_log_group_arn" {
  description = "CloudWatch Logs group ARN where CloudTrail mirrors events. Used as the substrate for the R-KMS-1..9 metric filters."
  value       = aws_cloudwatch_log_group.cloudtrail.arn
}

output "cloudtrail_bucket_arn" {
  description = "S3 bucket ARN holding the long-term audit trail (Object-Lock COMPLIANCE, ${var.audit_log_retention_days}-day retention)."
  value       = aws_s3_bucket.cloudtrail_logs.arn
}

output "cloudtrail_trail_arn" {
  description = "ARN of the CloudTrail trail. Multi-region; captures KMS data events."
  value       = aws_cloudtrail.main.arn
}
