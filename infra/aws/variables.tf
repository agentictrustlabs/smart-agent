# Variables for the AWS Smart Agent KMS + IAM + CloudTrail module.
#
# All inputs are required to be supplied via a per-environment
# `*.tfvars` file (see infra/README.md). No defaults that could
# accidentally provision into the wrong account / region.

variable "aws_region" {
  description = "Primary AWS region for KMS keys, CloudTrail, and the audit S3 bucket. Multi-region KMS keys replicate to var.aws_replica_region."
  type        = string
}

variable "aws_replica_region" {
  description = "Secondary AWS region for multi-region KMS key replicas. Required per K3 § 4 (break-glass / KMS-outage recovery)."
  type        = string
}

variable "environment" {
  description = "Deployment environment label. One of: staging, prod. Used in resource names and CloudTrail bucket name."
  type        = string

  validation {
    condition     = contains(["staging", "prod"], var.environment)
    error_message = "environment must be one of: staging, prod"
  }
}

variable "project_name" {
  description = "Project name prefix. Used in KMS aliases, IAM role names, S3 bucket names. Lowercase, hyphenated."
  type        = string
  default     = "smart-agent"
}

variable "vercel_oidc_issuer" {
  description = "Vercel OIDC issuer URL (e.g. 'https://oidc.vercel.com/<team-slug>'). Trust policy gates AssumeRoleWithWebIdentity on this issuer."
  type        = string
}

variable "vercel_team_slug" {
  description = "Vercel team slug. Used in the OIDC `aud` claim condition."
  type        = string
}

variable "vercel_project_name" {
  description = "Vercel project name. Used in the OIDC `sub` claim condition to gate role assumption to the deployment of THIS project (not any project in the team)."
  type        = string
}

variable "vercel_oidc_thumbprint" {
  description = "SHA1 thumbprint of the Vercel OIDC issuer's TLS certificate. Capture once per cert lifecycle via `openssl s_client` (see infra/README.md § OIDC trust)."
  type        = string
}

variable "audit_log_retention_days" {
  description = "S3 Object Lock retention period for CloudTrail logs, in days. Default 2555 (7 years) per K6 § 7 — SOX-aligned for financial-transaction logs. Lower retention is intentionally NOT supported in prod."
  type        = number
  default     = 2555
}

variable "cloudwatch_log_retention_days" {
  description = "CloudWatch Logs retention for the CloudTrail real-time mirror. 90 days per K6 § 7 (real-time query window only; long-term retention is in S3)."
  type        = number
  default     = 90
}

variable "pagerduty_sns_topic_arn" {
  description = "ARN of an SNS topic that fans out to PagerDuty (or Opsgenie). Optional — if empty, alarm routing is set up but no subscriptions are created. Final wiring is operator-manual via the AWS console for the first deployment."
  type        = string
  default     = ""
}

variable "vercel_egress_cidr_ranges" {
  description = "Vercel egress CIDR ranges, used by R-KMS-2 (unexpected source IP). Maintained per K6 § 3.3.2; re-validated quarterly. Populated from infra/vercel-egress-ranges.json — see infra/README.md."
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "Common tags applied to every resource."
  type        = map(string)
  default = {
    ManagedBy = "terraform"
    Project   = "smart-agent"
  }
}
