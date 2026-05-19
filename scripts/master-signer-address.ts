#!/usr/bin/env tsx
/**
 * master-signer-address — print the EVM address of one of the three
 * system-signing roles, derived through the SAME `getMasterSigner()`
 * path the a2a-agent uses at runtime.
 *
 * Spec 007 Phase A introduces THREE distinct signer roles. Each lives
 * under its own KMS key in production (different blast radius,
 * different rotation cadence, different audit retention):
 *
 *   --role master           → master EOA. Signs the EntryPoint
 *                             `handleOps` relay tx, inter-service
 *                             MACs, and (legacy) operator anchor txs.
 *                             Never co-owns any AgentAccount.
 *   --role bundler          → bundler-envelope signer used by
 *                             `executeFromBundler`. Submits userOps
 *                             but cannot author them.
 *   --role session-issuer   → session-delegation issuer. Co-signs
 *                             session delegations the user has
 *                             pre-authorized.
 *
 * Backend selection follows `A2A_KMS_BACKEND` (default `'local-aes'`):
 *   - 'local-aes'  → derived from the role-specific private key env
 *                    var (`A2A_MASTER_PRIVATE_KEY`,
 *                    `A2A_BUNDLER_PRIVATE_KEY`,
 *                    `A2A_SESSION_ISSUER_PRIVATE_KEY`).
 *   - 'aws-kms'    → derived from KMS `GetPublicKey` on the
 *                    role-specific key id (`AWS_KMS_SIGNER_KEY_ID`,
 *                    `AWS_KMS_BUNDLER_SIGNER_KEY_ID`,
 *                    `AWS_KMS_SESSION_ISSUER_KEY_ID`).
 *   - 'gcp-kms'    → analogous role-specific GCP_KMS_*_VERSION env vars.
 *
 * Usage:
 *   pnpm tsx scripts/master-signer-address.ts                       # master (default — back-compat)
 *   pnpm tsx scripts/master-signer-address.ts --role master
 *   pnpm tsx scripts/master-signer-address.ts --role bundler
 *   pnpm tsx scripts/master-signer-address.ts --role session-issuer
 *
 * Used by:
 *   - `scripts/deploy-local.sh` — derives all three addresses and
 *     exports them to Foundry's `Deploy.s.sol`. Without this, master
 *     would be the default for all three roles (loud-warning fallback
 *     in `Deploy.s.sol`).
 */
import { buildSignerBackend, type KeyProviderEnv } from '../apps/a2a-agent/src/auth/key-provider'
import { createKmsAccount } from '@smart-agent/sdk/key-custody'

type Role = 'master' | 'bundler' | 'session-issuer'

function parseRole(argv: string[]): Role {
  const idx = argv.indexOf('--role')
  if (idx === -1) return 'master'
  const value = argv[idx + 1]
  if (value === 'master' || value === 'bundler' || value === 'session-issuer') {
    return value
  }
  throw new Error(
    `master-signer-address: invalid --role value "${value}". ` +
      `Expected one of: master, bundler, session-issuer.`,
  )
}

/**
 * Build a per-role KeyProviderEnv by remapping the role's
 * private-key / KMS-key env into the slot `buildSignerBackend` reads
 * (which is always `A2A_MASTER_PRIVATE_KEY` / `AWS_KMS_SIGNER_KEY_ID`).
 * This avoids touching `buildSignerBackend` itself — we present the
 * SAME signer-backend interface to the SDK, just sourced from the
 * role-specific env var.
 */
function buildRoleEnv(role: Role): KeyProviderEnv {
  const base = { ...process.env } as KeyProviderEnv
  if (role === 'master') return base
  if (role === 'bundler') {
    return {
      ...base,
      A2A_MASTER_PRIVATE_KEY:
        process.env.A2A_BUNDLER_PRIVATE_KEY ?? process.env.A2A_MASTER_PRIVATE_KEY,
      AWS_KMS_SIGNER_KEY_ID:
        process.env.AWS_KMS_BUNDLER_SIGNER_KEY_ID ?? process.env.AWS_KMS_SIGNER_KEY_ID,
      GCP_KMS_MASTER_SIGNER_VERSION:
        process.env.GCP_KMS_BUNDLER_SIGNER_VERSION ??
        process.env.GCP_KMS_MASTER_SIGNER_VERSION,
    }
  }
  // session-issuer
  return {
    ...base,
    A2A_MASTER_PRIVATE_KEY:
      process.env.A2A_SESSION_ISSUER_PRIVATE_KEY ?? process.env.A2A_MASTER_PRIVATE_KEY,
    AWS_KMS_SIGNER_KEY_ID:
      process.env.AWS_KMS_SESSION_ISSUER_KEY_ID ?? process.env.AWS_KMS_SIGNER_KEY_ID,
    GCP_KMS_MASTER_SIGNER_VERSION:
      process.env.GCP_KMS_SESSION_ISSUER_VERSION ??
      process.env.GCP_KMS_MASTER_SIGNER_VERSION,
  }
}

async function main(): Promise<void> {
  const role = parseRole(process.argv.slice(2))
  const env = buildRoleEnv(role)
  const backend = buildSignerBackend(env, {
    audit: () => {
      /* no-op for CLI use */
    },
  })
  const account = await createKmsAccount(backend)
  // Single stdout line so callers can shell-substitute:
  //   BUNDLER_SIGNER=$(pnpm tsx scripts/master-signer-address.ts --role bundler)
  process.stdout.write(account.address)
  process.stdout.write('\n')
}

main().catch((err) => {
  process.stderr.write(`[master-signer-address] error: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
