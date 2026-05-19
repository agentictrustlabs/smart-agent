# Variables for the GCP Smart Agent KMS + Workload Identity module.

variable "gcp_project_id" {
  description = "GCP project ID for KMS, IAM, audit logs, and the audit-log GCS bucket."
  type        = string
}

variable "gcp_region" {
  description = "Primary GCP region. Used for the KMS keyring location and GCS bucket location."
  type        = string
}

variable "environment" {
  description = "Deployment environment label. One of: staging, prod."
  type        = string

  validation {
    condition     = contains(["staging", "prod"], var.environment)
    error_message = "environment must be one of: staging, prod"
  }
}

variable "project_name" {
  description = "Project name prefix for resource naming."
  type        = string
  default     = "smart-agent"
}

variable "vercel_oidc_issuer_url" {
  description = "Vercel OIDC issuer URL — e.g. 'https://oidc.vercel.com/<team-slug>'. The Workload Identity Pool Provider trusts this issuer."
  type        = string
}

variable "vercel_team_slug" {
  description = "Vercel team slug. Used in the `aud` claim mapping."
  type        = string
}

variable "vercel_project_name" {
  description = "Vercel project name. Used in the `sub` claim attribute condition."
  type        = string
}

variable "audit_log_retention_seconds" {
  description = "GCS bucket retention for audit logs, in seconds. Default 220752000 (7 years) per K6 § 5.2."
  type        = number
  default     = 220752000
}

variable "labels" {
  description = "Common labels for resources."
  type        = map(string)
  default = {
    managed_by = "terraform"
    project    = "smart-agent"
  }
}
