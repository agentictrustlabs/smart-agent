# IAM — Workload Identity Federation from Vercel OIDC, plus the
# runtime service account that holds per-key bindings.
#
# Trust chain:
#   Vercel deployment -> OIDC token -> Workload Identity Pool Provider
#   -> External identity -> Service Account impersonation -> KMS ops
#
# Gate on `sub` to pin to THIS Vercel project's prod deployment.

############################################################
# Runtime service account
############################################################

resource "google_service_account" "runtime" {
  account_id   = "${var.project_name}-${var.environment}-runtime"
  display_name = "Smart Agent ${var.environment} runtime (Vercel WIF target)"
  description  = "Service account impersonated by the Vercel deployment via Workload Identity Federation. Holds KMS Sign / Encrypt / MAC bindings per key."
}

############################################################
# Workload Identity Pool
############################################################

resource "google_iam_workload_identity_pool" "vercel" {
  workload_identity_pool_id = "${var.project_name}-${var.environment}-vercel"
  display_name              = "Vercel OIDC pool (${var.environment})"
  description               = "Federation pool for Vercel deployments of the Smart Agent ${var.environment} environment."
}

resource "google_iam_workload_identity_pool_provider" "vercel" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.vercel.workload_identity_pool_id
  workload_identity_pool_provider_id = "vercel-oidc"
  display_name                       = "Vercel OIDC provider"

  attribute_mapping = {
    "google.subject"          = "assertion.sub"
    "attribute.aud"           = "assertion.aud"
    "attribute.vercel_owner"  = "assertion.owner"
    "attribute.vercel_proj"   = "assertion.project"
    "attribute.vercel_env"    = "assertion.environment"
  }

  # Attribute condition gates pool entry on:
  #   - aud = Vercel team slug
  #   - owner = Vercel team slug
  #   - project = Vercel project name
  #   - environment = production (or preview for staging)
  attribute_condition = "attribute.aud == \"${var.vercel_team_slug}\" && attribute.vercel_owner == \"${var.vercel_team_slug}\" && attribute.vercel_proj == \"${var.vercel_project_name}\" && attribute.vercel_env == \"${var.environment == "prod" ? "production" : "preview"}\""

  oidc {
    issuer_uri = var.vercel_oidc_issuer_url
    # `allowed_audiences` left default — verified by attribute_condition above.
  }
}

############################################################
# Bind the runtime SA so the federated identity can impersonate it
############################################################

resource "google_service_account_iam_binding" "runtime_impersonation" {
  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.workloadIdentityUser"

  members = [
    # Format: principalSet://iam.googleapis.com/<pool-resource-name>/attribute.<key>/<value>
    # Anyone in the pool that matches the attribute_condition above.
    "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.vercel.name}/attribute.vercel_proj/${var.vercel_project_name}",
  ]
}
