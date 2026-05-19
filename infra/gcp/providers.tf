# GCP provider configuration.
#
# Credentials must come from the operator's environment — gcloud
# application-default credentials or a service-account key file
# referenced via GOOGLE_APPLICATION_CREDENTIALS. Never from the repo.

provider "google" {
  project = var.gcp_project_id
  region  = var.gcp_region
}
