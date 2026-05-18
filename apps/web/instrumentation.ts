/**
 * Next.js instrumentation hook.
 *
 * Runs once on server boot — both `nodejs` and `edge` runtimes invoke
 * this when the server starts. We use it for one-shot startup checks
 * that need to surface BEFORE the first request lands.
 *
 * Current checks:
 *   - K6 deployer-key warning: log loudly if DEPLOYER_PRIVATE_KEY is
 *     present in a production env. The deployer key is a CI/CD-only
 *     secret; its presence at runtime is a misconfiguration. See
 *     `docs/operations/kms-signer-setup.md` § "Deployer key (K6 —
 *     CI/CD only)" for the operator runbook.
 *
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Run only on the Node.js server runtime (skip edge runtime where
  // most env vars are not surfaced anyway).
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { warnIfDeployerKeyResident } = await import('./src/lib/env-guard')
  warnIfDeployerKeyResident()
}
