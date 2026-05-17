/**
 * Environment-based gate for dev/admin-only API routes.
 *
 * Routes that should never be reachable in production (boot-seed,
 * dev-* helpers, explorer-edit on-chain writes, ontology turtle dump)
 * must call `requireDev()` at the top of their handler. The function
 * returns a 404 NextResponse in production and `null` in dev, so the
 * handler shape is simply:
 *
 *   const denied = requireDev()
 *   if (denied) return denied
 *
 * "dev" means `NODE_ENV !== 'production'` OR an explicit
 * `SMART_AGENT_ENV=dev` override (useful for staging boxes where
 * NODE_ENV is forced to production by Next.js).
 *
 * Companion to the future route-classification parser — see the
 * `@sa-prod-gate` JSDoc tag on each gated route.
 */
import { NextResponse } from 'next/server'

export function isDevEnvironment(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.SMART_AGENT_ENV === 'dev'
}

/**
 * Returns a 404 response when running outside a dev environment.
 * Returns `null` when the route is allowed to proceed.
 */
export function requireDev(): NextResponse | null {
  if (!isDevEnvironment()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  return null
}

/**
 * Hardening K6 — DEPLOYER_PRIVATE_KEY runtime warning.
 *
 * The deployer private key is a CI/CD-only secret used by
 * `forge script Deploy.s.sol` to deploy contracts. It must NEVER be
 * present in a runtime production environment. Its presence in env at
 * boot in `NODE_ENV=production` is a misconfiguration that we surface
 * loudly (but do not throw on — that would break boot during a
 * sensitive migration window).
 *
 * Call this once at server boot (web instrumentation hook) so operators
 * see the warning before any request handler runs. The companion
 * invariant in `scripts/check-no-bypass.sh` prevents the key from being
 * re-introduced into request-handler code at CI time.
 *
 * See `docs/operations/kms-signer-setup.md` § "Deployer key (K6 —
 * CI/CD only)" for the operator runbook.
 */
let _deployerKeyWarned = false
export function warnIfDeployerKeyResident(logger: { warn: (msg: string) => void } = console): void {
  if (_deployerKeyWarned) return
  if (process.env.NODE_ENV !== 'production') return
  if (!process.env.DEPLOYER_PRIVATE_KEY) return
  _deployerKeyWarned = true
  logger.warn(
    '[K6 WARNING] DEPLOYER_PRIVATE_KEY is set in a production environment. ' +
      'The deployer key is a CI/CD-only secret used by `forge script Deploy.s.sol`; ' +
      'it must NOT be available at runtime. Remove it from your production env. ' +
      'See docs/operations/kms-signer-setup.md § "Deployer key (K6 — CI/CD only)".',
  )
}
