/**
 * Vercel OIDC token discovery for the Vault Transit provider (KMS migration K2).
 *
 * This module is the ONLY place in a2a-agent that reads the Vercel OIDC token.
 * Keeping it isolated means the env-var-vs-request-scope decision is a one-file
 * change — if a2a-agent ever moves to a Vercel-Function deployment, only this
 * file shifts to request-scope reading (via the `x-vercel-oidc-token` header
 * or `@vercel/oidc`).
 *
 * Allowlist note (see `docs/architecture/01-web-a2a-mcp-flows.md`): this
 * module is the only one in `apps/a2a-agent/src/` allowed to interact with
 * `VAULT_ADDR` outside of `packages/sdk/src/key-custody/vault-transit-provider.ts`.
 *
 * # K2 v1 deployment assumption
 *
 * a2a-agent is currently a long-running Hono server, not a Vercel Function.
 * The Vercel OIDC token in this deployment topology is provided as a
 * `VERCEL_OIDC_TOKEN` env var (from Vercel CI/build env, or from a sidecar
 * token-refresh process when running outside Vercel infra). The env-var path
 * is sufficient for this case.
 *
 * # Future: Vercel-Function deployment
 *
 * If a2a-agent is later deployed AS a Vercel Function (one Hono handler per
 * route, request-scoped lifecycle), the OIDC token becomes request-bound
 * (`x-vercel-oidc-token` header). The K2 v1 env-var path will fail in that
 * topology because there is no request context at module-load time. The fix
 * is a `getVercelOidcToken(req: Request)` overload that reads the header.
 * Out-of-scope for K2 v1; documented as future work in
 * `KMS-IMPLEMENTATION-PLAN.md` §3.2.
 */

/**
 * Read the Vercel OIDC token from the process environment.
 *
 * Throws if the token is absent — a misconfigured deployment should fail
 * closed at first KMS call, not silently fall back to anonymous Vault access
 * (which the Vault OIDC role would reject anyway, but failing fast surfaces
 * the operator error with a clean message).
 *
 * @throws if `VERCEL_OIDC_TOKEN` is unset or empty
 */
export function getVercelOidcToken(): string {
  const token = process.env.VERCEL_OIDC_TOKEN
  if (!token) {
    throw new Error(
      'vault-oidc-token-exchange: OIDC token not available — request-scope reading required for Vercel-Function deployments; set VERCEL_OIDC_TOKEN env var for the long-running server deployment',
    )
  }
  return token
}
