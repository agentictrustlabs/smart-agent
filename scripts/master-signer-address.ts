#!/usr/bin/env tsx
/**
 * master-signer-address — print the EVM address of the active master
 * signer, derived through the SAME `getMasterSigner()` path the
 * a2a-agent uses at runtime.
 *
 * Backend selection follows `A2A_KMS_BACKEND` (default `'local-aes'`):
 *   - 'local-aes'  → derived from `A2A_MASTER_PRIVATE_KEY` (dev shim)
 *   - 'aws-kms'    → derived from KMS `GetPublicKey` on
 *                    `AWS_KMS_SIGNER_KEY_ID` (production)
 *   - 'gcp-kms'    → derived from GCP KMS asymmetricSign key's
 *                    public-key fetch (production sibling)
 *
 * Usage:
 *   pnpm tsx scripts/master-signer-address.ts
 *
 * Used by:
 *   - `scripts/deploy-local.sh` — feeds `SERVER_SIGNER_ADDRESS` to
 *     Foundry's `Deploy.s.sol` so the `AgentAccountFactory` constructor
 *     receives the SAME serverSigner the a2a-agent will sign with at
 *     runtime. Without this, `AgentAccount._validateSignature` rejects
 *     userOps with `@AA24 signature error`.
 *
 * This script is the DEV equivalent of `scripts/kms-signer-address.ts`
 * (which is AWS-specific operator tooling). This one dispatches on the
 * backend the same way `apps/a2a-agent/src/auth/a2a-signer.ts` does, so
 * dev and prod use identical address-derivation paths.
 */
import { buildSignerBackend, type KeyProviderEnv } from '../apps/a2a-agent/src/auth/key-provider'
import { createKmsAccount } from '@smart-agent/sdk/key-custody'

async function main(): Promise<void> {
  const backend = buildSignerBackend(process.env as KeyProviderEnv, {
    audit: () => {
      /* no-op for CLI use */
    },
  })
  const account = await createKmsAccount(backend)
  // Single stdout line so callers can shell-substitute:
  //   SERVER_SIGNER=$(pnpm tsx scripts/master-signer-address.ts)
  process.stdout.write(account.address)
  process.stdout.write('\n')
}

main().catch((err) => {
  process.stderr.write(`[master-signer-address] error: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
