/**
 * GCP authentication primitive — Workload Identity Federation via Vercel OIDC.
 *
 * Builds an authenticated `BaseExternalAccountClient` from Google's
 * `google-auth-library` that exchanges Vercel's request-scoped OIDC token
 * for GCP STS credentials and then impersonates a target service account.
 *
 * This is the GCP sibling of `awsCredentialsProvider` from
 * `@vercel/oidc-aws-credentials-provider`. The trust chain is:
 *
 *   Vercel OIDC token
 *     → Google STS Workload Identity Federation
 *     → service-account impersonation (IAM Credentials API)
 *     → google-auth-library client with refreshed access tokens
 *     → consumers: Cloud KMS, etc.
 *
 * See `output/GCP-KMS-IMPLEMENTATION-PLAN.md` § G1 for the full design and
 * the trust pattern parity with the AWS path.
 *
 * ─── Vercel request-scope rule ──────────────────────────────────────────
 *
 * `getVercelOidcToken()` MUST NOT be invoked at module-load time on Vercel
 * Functions — the OIDC token lives on the request context and does not exist
 * before a request is in flight. We therefore:
 *
 *   1. Construct the `ExternalAccountClient` lazily inside
 *      `createGcpAuthClient(...)` (call-site decides when).
 *   2. Pass the token supplier as `subject_token_supplier.getSubjectToken =
 *      getVercelOidcToken` — google-auth-library calls it on demand each
 *      time it needs to refresh the access token, NOT at construction.
 *
 * Mirrors AWS's `awsCredentialsProvider({ roleArn })` shape (which also
 * defers `getVercelOidcToken` to request scope via the AWS STS SDK).
 *
 * ─── No static service-account keys ─────────────────────────────────────
 *
 * The factory deliberately accepts ONLY the identifier fields. Setting
 * `GOOGLE_APPLICATION_CREDENTIALS` or `GCP_SERVICE_ACCOUNT_KEY_JSON` in
 * production is refused at startup by the factory wrappers (see
 * `apps/a2a-agent/src/auth/key-provider.ts`). This module performs the
 * minimal env validation; the production-mode environment guard is the
 * caller's responsibility.
 */
import { ExternalAccountClient } from 'google-auth-library'
import type { BaseExternalAccountClient } from 'google-auth-library'
import { getVercelOidcToken } from '@vercel/oidc'

/**
 * Environment for `createGcpAuthClient`.
 *
 * All fields are identifiers (project number, pool id, service-account
 * email), NOT secrets. The audience URL is assembled from
 * `GCP_PROJECT_NUMBER` + pool + provider — Google requires the
 * project NUMBER (not the project ID slug) here.
 */
export interface GcpAuthEnv {
  /** GCP project ID (slug, e.g. `smart-agent-prod`). */
  GCP_PROJECT_ID: string
  /** GCP project NUMBER (numeric, used in the WIF audience URL). */
  GCP_PROJECT_NUMBER: string
  /** Workload Identity Pool id (e.g. `vercel-pool`). */
  GCP_WORKLOAD_IDENTITY_POOL_ID: string
  /** Workload Identity Pool provider id (e.g. `vercel-oidc`). */
  GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: string
  /** Service account to impersonate (e.g. `a2a-agent@smart-agent-prod.iam.gserviceaccount.com`). */
  GCP_SERVICE_ACCOUNT_EMAIL: string
}

/**
 * Required env field names (kept here so tests + factories share one source
 * of truth for validation messages).
 */
export const GCP_AUTH_ENV_KEYS = [
  'GCP_PROJECT_ID',
  'GCP_PROJECT_NUMBER',
  'GCP_WORKLOAD_IDENTITY_POOL_ID',
  'GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID',
  'GCP_SERVICE_ACCOUNT_EMAIL',
] as const satisfies readonly (keyof GcpAuthEnv)[]

/**
 * Optional dependencies — primarily for tests so they can inject a stub
 * subject-token supplier without depending on Vercel's request context.
 *
 * Production callers omit this; the default behaviour pulls
 * `getVercelOidcToken` from `@vercel/oidc`.
 */
export interface GcpAuthDeps {
  /**
   * Override for the subject-token supplier. The default is
   * `getVercelOidcToken` from `@vercel/oidc`. Tests pass a stub here so
   * they can verify the lazy-invocation contract without standing up a
   * Vercel context.
   */
  subjectTokenSupplier?: () => Promise<string>
}

/**
 * Validate that every required GCP auth env field is present and non-empty.
 *
 * Thrown errors name the offending field verbatim so an operator can grep
 * their deployment env.
 */
function assertGcpAuthEnv(env: Partial<GcpAuthEnv>): asserts env is GcpAuthEnv {
  for (const key of GCP_AUTH_ENV_KEYS) {
    const value = env[key]
    if (!value || value.trim().length === 0) {
      throw new Error(
        `createGcpAuthClient: ${key} is required for GCP Workload Identity Federation. ` +
          'See output/GCP-KMS-IMPLEMENTATION-PLAN.md § G1.',
      )
    }
  }
}

/**
 * Build the Workload-Identity-Federation `audience` URL from the env.
 *
 * Format (per Google docs):
 *   //iam.googleapis.com/projects/<PROJECT_NUMBER>
 *     /locations/global/workloadIdentityPools/<POOL_ID>
 *     /providers/<PROVIDER_ID>
 */
function buildWifAudience(env: GcpAuthEnv): string {
  return (
    `//iam.googleapis.com/projects/${env.GCP_PROJECT_NUMBER}` +
    `/locations/global/workloadIdentityPools/${env.GCP_WORKLOAD_IDENTITY_POOL_ID}` +
    `/providers/${env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID}`
  )
}

/**
 * Construct an `ExternalAccountClient` that authenticates to GCP via
 * Vercel-OIDC → STS WIF → service-account impersonation.
 *
 * The client is constructed eagerly but does NOT invoke
 * `getVercelOidcToken()` until google-auth-library actually needs to
 * refresh the access token — i.e. on the FIRST downstream call (e.g. a
 * `kms.encrypt(...)`). This is the lazy/request-scoped contract Vercel
 * Functions require.
 *
 * @throws if any required env field is missing.
 * @throws if `ExternalAccountClient.fromJSON` returns null (would indicate
 *         a malformed credential config — shouldn't happen with this
 *         well-formed JSON, but we guard defensively).
 */
export function createGcpAuthClient(
  env: Partial<GcpAuthEnv>,
  deps: GcpAuthDeps = {},
): BaseExternalAccountClient {
  assertGcpAuthEnv(env)

  const subjectTokenSupplier = deps.subjectTokenSupplier ?? getVercelOidcToken

  const client = ExternalAccountClient.fromJSON({
    type: 'external_account',
    audience: buildWifAudience(env),
    subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
    token_url: 'https://sts.googleapis.com/v1/token',
    service_account_impersonation_url:
      'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/' +
      `${env.GCP_SERVICE_ACCOUNT_EMAIL}:generateAccessToken`,
    subject_token_supplier: {
      // google-auth-library passes a context argument here; the Vercel
      // function signature ignores it (extra args are dropped). Wrapping
      // in an arrow guarantees we don't accidentally forward stray
      // params if upstream signatures change.
      getSubjectToken: () => subjectTokenSupplier(),
    },
  })

  if (client === null) {
    // `fromJSON` returns null only when the credential type isn't an
    // external_account (we hardcode `'external_account'` above, so this
    // is a defensive branch — getting here would indicate an upstream
    // library bug or a typed-config mismatch).
    throw new Error(
      'createGcpAuthClient: ExternalAccountClient.fromJSON returned null. ' +
        'This indicates an incompatibility with the installed google-auth-library version.',
    )
  }

  return client
}
