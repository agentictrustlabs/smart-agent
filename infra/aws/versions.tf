# Terraform + provider version pins.
#
# Why pin: K1–K6 runbooks assume specific resource shapes (e.g. KMS
# `multi_region`, `aws_cloudtrail` `event_selector.data_resource` for
# KMS data events). Older provider versions silently drop unknown
# arguments. Pin to the major version that supports the full surface.
#
# Lifecycle: bump as part of a deliberate IaC change; never floating.

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40"
    }
  }

  # Backend is intentionally NOT configured here. Each environment
  # (staging, prod) sets its own backend via a per-environment
  # `backend.tf` file that is NOT checked in. Example layout:
  #
  #   infra/aws/envs/staging/backend.tf  (S3 backend, staging bucket)
  #   infra/aws/envs/prod/backend.tf     (S3 backend, prod bucket, DynamoDB lock)
  #
  # See infra/README.md § "Per-environment workspaces".
}
