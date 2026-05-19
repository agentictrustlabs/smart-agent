# Terraform + provider pins for the GCP module.
#
# Why pin: K4 § 4.2 requires `protection_level = "HSM"` on every key,
# and K6 § 5.1 requires Data Access audit logs for cloudkms — both
# features depend on specific provider versions.

terraform {
  required_version = ">= 1.6.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.30"
    }
  }
}
