# AWS provider configuration.
#
# Two providers:
#   - default (primary region) — for KMS primaries, CloudTrail, IAM,
#     S3 audit bucket, CloudWatch.
#   - aws.replica (secondary region) — for KMS replica keys per K3 § 4.
#
# No `profile` or `access_key` here — credentials must come from the
# operator's environment (AWS SSO / SAML / OIDC), never from the IaC
# repo.

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = var.tags
  }
}

provider "aws" {
  alias  = "replica"
  region = var.aws_replica_region

  default_tags {
    tags = var.tags
  }
}
