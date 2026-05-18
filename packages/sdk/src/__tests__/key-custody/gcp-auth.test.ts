/**
 * Unit tests for `createGcpAuthClient` (GCP-KMS G-PR-1).
 *
 * Covers:
 *   - Per-field env-validation: each of the five required identifier
 *     fields produces a distinct, actionable error when missing.
 *   - Well-formed env returns an instantiated `BaseExternalAccountClient`.
 *   - Lazy contract: `getVercelOidcToken` (or the supplied stub) MUST NOT
 *     be invoked during `createGcpAuthClient(...)` itself — it's only
 *     called by google-auth-library when the access token is actually
 *     needed (i.e. on the first downstream call).
 *   - Audience URL construction follows the plan's
 *     projectNumber + pool + provider format verbatim.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGcpAuthClient, GCP_AUTH_ENV_KEYS } from '../../key-custody/gcp-auth'

const VALID_ENV = {
  GCP_PROJECT_ID: 'smart-agent-prod',
  GCP_PROJECT_NUMBER: '123456789012',
  GCP_WORKLOAD_IDENTITY_POOL_ID: 'vercel-pool',
  GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID: 'vercel-oidc',
  GCP_SERVICE_ACCOUNT_EMAIL: 'a2a-agent@smart-agent-prod.iam.gserviceaccount.com',
}

// ─── Per-field env-validation ────────────────────────────────────────

for (const fieldName of GCP_AUTH_ENV_KEYS) {
  test(`createGcpAuthClient throws when ${fieldName} is missing`, () => {
    const env: Record<string, string> = { ...VALID_ENV }
    delete env[fieldName]
    assert.throws(
      () => createGcpAuthClient(env as Partial<typeof VALID_ENV>),
      new RegExp(`${fieldName} is required for GCP Workload Identity Federation`),
    )
  })

  test(`createGcpAuthClient throws when ${fieldName} is empty string`, () => {
    const env = { ...VALID_ENV, [fieldName]: '' }
    assert.throws(
      () => createGcpAuthClient(env),
      new RegExp(`${fieldName} is required for GCP Workload Identity Federation`),
    )
  })
}

// ─── Well-formed env returns a client ────────────────────────────────

test('createGcpAuthClient returns a BaseExternalAccountClient instance when env is well-formed', () => {
  const client = createGcpAuthClient(VALID_ENV, {
    // Supply a stub so test never touches @vercel/oidc's request context.
    subjectTokenSupplier: async () => 'stub-subject-token',
  })
  assert.ok(client, 'createGcpAuthClient should return a non-null client')
  // The returned client must expose google-auth-library's auth API shape.
  // `getAccessToken` is the canonical entrypoint on every Google auth client.
  assert.equal(typeof (client as { getAccessToken?: unknown }).getAccessToken, 'function')
})

// ─── Lazy contract: subject-token supplier NOT invoked at construction ─

test('createGcpAuthClient does NOT call subjectTokenSupplier at construction time', () => {
  let calls = 0
  const supplier = async () => {
    calls++
    return 'should-not-be-called'
  }
  const client = createGcpAuthClient(VALID_ENV, { subjectTokenSupplier: supplier })
  assert.ok(client)
  // CRITICAL Vercel-Functions contract: the OIDC token is request-scoped
  // and may not exist at module load. google-auth-library must defer the
  // supplier call until the first downstream access-token refresh.
  assert.equal(calls, 0, 'subjectTokenSupplier must not be invoked during createGcpAuthClient()')
})

test('createGcpAuthClient does NOT invoke @vercel/oidc getVercelOidcToken at construction time', () => {
  // Defensive — even with no test stub supplied, the construction path
  // must not touch the Vercel runtime. We accomplish this by checking
  // that we can CONSTRUCT without throwing while VERCEL_OIDC_TOKEN is
  // unset (the real getVercelOidcToken would throw if invoked here).
  const previousToken = process.env.VERCEL_OIDC_TOKEN
  delete process.env.VERCEL_OIDC_TOKEN
  try {
    const client = createGcpAuthClient(VALID_ENV)
    assert.ok(client, 'construction must succeed without VERCEL_OIDC_TOKEN being set')
  } finally {
    if (previousToken !== undefined) process.env.VERCEL_OIDC_TOKEN = previousToken
  }
})

// ─── Audience URL format ────────────────────────────────────────────

test('audience URL follows the projectNumber + pool + provider format from the plan (§ G1)', () => {
  // Inspect the constructed client's internal audience field. The
  // google-auth-library `BaseExternalAccountClient` stores it on the
  // instance — we read it through the public surface where exposed and
  // fall back to a known-internal property for the assertion.
  const client = createGcpAuthClient(VALID_ENV, {
    subjectTokenSupplier: async () => 'stub',
  })
  // google-auth-library normalises the audience onto `client.audience`
  // when constructed from JSON; we assert the shape matches the plan
  // verbatim. The plan's format is documented in
  // `output/GCP-KMS-IMPLEMENTATION-PLAN.md § G1`.
  const expectedAudience =
    '//iam.googleapis.com/projects/123456789012' +
    '/locations/global/workloadIdentityPools/vercel-pool' +
    '/providers/vercel-oidc'
  // Read the audience field defensively — the field name is `audience`
  // on the base external-account client. If google-auth-library renames
  // it the test fails loudly rather than silently passing.
  const audience =
    (client as unknown as { audience?: string }).audience ??
    (client as unknown as { _audience?: string })._audience
  assert.equal(
    audience,
    expectedAudience,
    'audience URL must follow the plan\'s WIF audience format',
  )
})

// ─── GCP_AUTH_ENV_KEYS surface ──────────────────────────────────────

test('GCP_AUTH_ENV_KEYS enumerates all five required identifier fields', () => {
  // Lock the public surface: if a new required field is added without
  // updating this constant the test fails — call sites validate using
  // this list, so it MUST stay in sync.
  assert.deepEqual(
    [...GCP_AUTH_ENV_KEYS].sort(),
    [
      'GCP_PROJECT_ID',
      'GCP_PROJECT_NUMBER',
      'GCP_SERVICE_ACCOUNT_EMAIL',
      'GCP_WORKLOAD_IDENTITY_POOL_ID',
      'GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID',
    ].sort(),
  )
})
