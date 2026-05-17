/**
 * Selector for the active `A2AKeyProvider` (KMS migration K0+K1 + K2).
 *
 * This is the ONLY module in a2a-agent that instantiates a provider. Every
 * other call site (encryption helper, future signer wrapper, future MAC
 * wrapper) imports the singleton from `./encryption.ts` (which calls into
 * here once at module load).
 *
 * Backend selection via `A2A_KMS_BACKEND` (default `'local-aes'`):
 *   - 'local-aes'     → `createLocalAesProvider` from `@smart-agent/sdk/key-custody`.
 *                       Refused at startup when `NODE_ENV === 'production'`.
 *   - 'aws-kms'       → `createAwsKmsProvider` from `@smart-agent/sdk/key-custody`.
 *                       K2 v1 prod implementation target (KMS-IMPLEMENTATION-PLAN
 *                       §3.2a). Credentials come from
 *                       `@vercel/oidc-aws-credentials-provider` at request scope.
 *   - 'vault-transit' → documented sibling alternative (KMS-IMPLEMENTATION-PLAN
 *                       §3.2b). The provider implementation file exists in
 *                       packages/sdk/src/key-custody/vault-transit-provider.ts
 *                       and ships alongside aws-kms; this selector branch
 *                       deliberately throws "not yet implemented" until a
 *                       deployment chooses Vault. Flipping it on is a single
 *                       `return createVaultTransitProvider(...)` change.
 *   - anything else   → throws "unknown A2A_KMS_BACKEND" so an env typo
 *                       fails closed at startup instead of silently falling
 *                       back to a default.
 *
 * The production guard for 'local-aes' is also reflected in the AWS IAM
 * template (KMS-IMPLEMENTATION-PLAN.md §8.1), but enforcing it at process
 * boot is the cheapest pre-flight: a misconfigured deployment refuses to
 * come up rather than ever serving requests under the dev shim.
 */
import type {
  A2AKeyProvider,
  KmsAccountBackend,
  ToolExecutorId,
  ToolExecutorSignerBackend,
} from '@smart-agent/sdk/key-custody'
import {
  createAwsKmsProvider,
  createAwsKmsSigner,
  createLocalAesProvider,
  createLocalSecp256k1Signer,
  createToolExecutorSigner,
  toolEnvKeyName,
} from '@smart-agent/sdk/key-custody'

export interface KeyProviderEnv {
  A2A_KMS_BACKEND?: string
  NODE_ENV?: string
  A2A_SESSION_SECRET?: string
  // K2 v1 — AWS KMS. Required when A2A_KMS_BACKEND='aws-kms'.
  AWS_REGION?: string
  AWS_ROLE_ARN?: string
  AWS_KMS_KEY_ID?: string
  // K2-alt — Vault Transit. Reserved for the deferred sibling implementation.
  VAULT_ADDR?: string
  VAULT_NAMESPACE?: string
  VAULT_TRANSIT_KEY?: string
  VAULT_OIDC_ROLE?: string
  // K4 PR-1 — local-secp256k1 master-EOA signer (dev-only fallback).
  A2A_MASTER_PRIVATE_KEY?: string
  // K4 PR-2 — AWS KMS asymmetric `ECC_SECG_P256K1` signer key id.
  // SEPARATE from `AWS_KMS_KEY_ID` (which is the K2 symmetric envelope key):
  // different KMS key spec, different IAM permission set (`kms:Sign` +
  // `kms:GetPublicKey` vs `kms:GenerateDataKey` + `kms:Decrypt`).
  AWS_KMS_SIGNER_KEY_ID?: string
  // K5 — per-tool executor signer env vars. Read by name via
  // `toolEnvKeyName(toolId, backend)`. Both forms are accepted:
  //   - 'local-aes' path: TOOL_EXECUTOR_<TOOL_ID>_PRIVATE_KEY
  //   - 'aws-kms'   path: AWS_KMS_TOOL_EXECUTOR_<TOOL_ID>_KEY_ID
  // The signature is indexed (string) because the env var names are
  // synthesized from the tool id at call site rather than enumerated
  // here; this keeps the canonical list in `TOOL_EXECUTOR_IDS` rather
  // than duplicated across types.
  [key: string]: string | undefined
}

export function buildKeyProvider(env: KeyProviderEnv): A2AKeyProvider {
  const backend = env.A2A_KMS_BACKEND ?? 'local-aes'

  if (env.NODE_ENV === 'production' && backend === 'local-aes') {
    throw new Error(
      "buildKeyProvider: refusing to instantiate 'local-aes' in production. " +
        "Set A2A_KMS_BACKEND to 'aws-kms' (or another KMS-class backend).",
    )
  }

  switch (backend) {
    case 'local-aes': {
      if (!env.A2A_SESSION_SECRET) {
        throw new Error("buildKeyProvider: A2A_SESSION_SECRET is required for 'local-aes' backend")
      }
      return createLocalAesProvider({ A2A_SESSION_SECRET: env.A2A_SESSION_SECRET })
    }
    case 'aws-kms': {
      if (!env.AWS_REGION) {
        throw new Error("buildKeyProvider: AWS_REGION is required for 'aws-kms' backend")
      }
      if (!env.AWS_ROLE_ARN) {
        throw new Error("buildKeyProvider: AWS_ROLE_ARN is required for 'aws-kms' backend")
      }
      if (!env.AWS_KMS_KEY_ID) {
        throw new Error("buildKeyProvider: AWS_KMS_KEY_ID is required for 'aws-kms' backend")
      }
      return createAwsKmsProvider({
        AWS_REGION: env.AWS_REGION,
        AWS_ROLE_ARN: env.AWS_ROLE_ARN,
        AWS_KMS_KEY_ID: env.AWS_KMS_KEY_ID,
      })
    }
    case 'vault-transit':
      // K2-alt sibling — provider implementation lives in
      // packages/sdk/src/key-custody/vault-transit-provider.ts but the
      // selector stays stubbed until a deployment chooses Vault. Flipping
      // this on requires only: `return createVaultTransitProvider({...},
      // { getOidcToken: getVercelOidcToken })`. See §3.2b of the plan.
      throw new Error(
        "buildKeyProvider: 'vault-transit' provider not yet implemented (K2-alt sibling)",
      )
    default:
      throw new Error(`buildKeyProvider: unknown A2A_KMS_BACKEND: ${backend}`)
  }
}

/**
 * KMS migration K4 — master-EOA signer backend factory.
 *
 * This is the signing counterpart to `buildKeyProvider`. The two functions
 * are SIBLINGS in the K4 design (§7 of K4 plan): `buildKeyProvider` returns
 * the envelope-encryption provider (K1/K2); `buildSignerBackend` returns
 * the secp256k1 signer for the master-EOA replacement. They share the
 * `A2A_KMS_BACKEND` selector so deployments only have one switch to flip:
 *
 *   - 'local-aes'     → local-secp256k1 (dev). The "local-aes" name applies
 *                       to envelope encryption; the matching signer is real
 *                       secp256k1 with key material read from
 *                       `A2A_MASTER_PRIVATE_KEY`.
 *   - 'aws-kms'       → AWS KMS asymmetric `ECC_SECG_P256K1` signer (K4 PR-2;
 *                       prod target). Requires `AWS_REGION`, `AWS_ROLE_ARN`,
 *                       and `AWS_KMS_SIGNER_KEY_ID` (separate from
 *                       `AWS_KMS_KEY_ID`, the K2 envelope-encryption key).
 *   - 'vault-transit' → HCP Vault Transit secp256k1 signer (K4-alt deferred
 *                       sibling — throws).
 *
 * The production guard (`NODE_ENV='production'` + `'local-aes'`) matches
 * `buildKeyProvider`. If the envelope backend is rejected in prod the
 * signer backend must be too.
 */
export function buildSignerBackend(env: KeyProviderEnv): KmsAccountBackend {
  const backend = env.A2A_KMS_BACKEND ?? 'local-aes'

  if (env.NODE_ENV === 'production' && backend === 'local-aes') {
    throw new Error(
      "buildSignerBackend: refusing to instantiate 'local-aes' signer in production. " +
        "Set A2A_KMS_BACKEND to 'aws-kms' (K4 PR-2).",
    )
  }

  switch (backend) {
    case 'local-aes': {
      if (!env.A2A_MASTER_PRIVATE_KEY) {
        throw new Error(
          "buildSignerBackend: A2A_MASTER_PRIVATE_KEY is required for the local-secp256k1 signer " +
            "(A2A_KMS_BACKEND='local-aes')",
        )
      }
      return createLocalSecp256k1Signer({
        A2A_MASTER_PRIVATE_KEY: env.A2A_MASTER_PRIVATE_KEY,
        NODE_ENV: env.NODE_ENV,
      })
    }
    case 'aws-kms': {
      // K4 PR-2 — AWS KMS asymmetric secp256k1 signer (prod target).
      //
      // Production guard: NO local fallback. `aws-kms` is THE production
      // target; if env is missing or malformed we throw at startup so an
      // operator gets a clean failure instead of a 503 on the first /
      // session/.../redeem-via-account call. The K4 PR-2 plan §11
      // explicitly forbids a "fallback to local-secp256k1 on KMS
      // unreachable" — same blast-radius argument as K2.
      if (!env.AWS_REGION) {
        throw new Error(
          "buildSignerBackend: AWS_REGION is required for 'aws-kms' signer (K4 PR-2)",
        )
      }
      if (!env.AWS_ROLE_ARN) {
        throw new Error(
          "buildSignerBackend: AWS_ROLE_ARN is required for 'aws-kms' signer (K4 PR-2)",
        )
      }
      if (!env.AWS_KMS_SIGNER_KEY_ID) {
        throw new Error(
          "buildSignerBackend: AWS_KMS_SIGNER_KEY_ID is required for 'aws-kms' signer (K4 PR-2) — " +
            'this is a SEPARATE KMS key from AWS_KMS_KEY_ID (the K2 envelope-encryption key).',
        )
      }
      return createAwsKmsSigner({
        AWS_REGION: env.AWS_REGION,
        AWS_ROLE_ARN: env.AWS_ROLE_ARN,
        AWS_KMS_SIGNER_KEY_ID: env.AWS_KMS_SIGNER_KEY_ID,
      })
    }
    case 'vault-transit':
      throw new Error(
        "buildSignerBackend: vault-transit signer not implemented (deferred sibling)",
      )
    default:
      throw new Error(`buildSignerBackend: unknown A2A_KMS_BACKEND: ${backend}`)
  }
}

/**
 * KMS migration K5 — per-tool executor signer backend factory.
 *
 * Sibling of `buildSignerBackend` for the master EOA, parameterized by
 * tool id. Each sensitive-tier MCP tool family (`round-awards`,
 * `disbursement`, `pool-lifecycle`, `grant-awards`) gets its OWN signer
 * backend so a compromised key for one family cannot sign for another.
 * IAM scoping (one `kms:Sign` statement per tool KMS ARN) is the
 * security boundary in production.
 *
 * Backend selection mirrors `buildSignerBackend` (same `A2A_KMS_BACKEND`
 * env selector):
 *
 *   - 'local-aes'     → local-secp256k1 reading
 *                       `TOOL_EXECUTOR_<TOOL_ID>_PRIVATE_KEY`. Production
 *                       guard refuses this in `NODE_ENV='production'`.
 *   - 'aws-kms'       → AWS KMS asymmetric `ECC_SECG_P256K1` reading
 *                       `AWS_KMS_TOOL_EXECUTOR_<TOOL_ID>_KEY_ID`. Same
 *                       `AWS_REGION` + `AWS_ROLE_ARN` as the master
 *                       signer; the role's policy adds one statement
 *                       per tool key.
 *   - 'vault-transit' → throws "not implemented (sibling)".
 *
 * Env validation is strict: missing env vars throw at construction time
 * with the exact env name in the error so operators can search their
 * deployment for the missing variable.
 */
export function buildToolExecutorBackend(
  toolId: ToolExecutorId,
  env: KeyProviderEnv,
): ToolExecutorSignerBackend {
  const backend = env.A2A_KMS_BACKEND ?? 'local-aes'

  if (env.NODE_ENV === 'production' && backend === 'local-aes') {
    throw new Error(
      `buildToolExecutorBackend: refusing to instantiate 'local-aes' signer for tool "${toolId}" in production. ` +
        "Set A2A_KMS_BACKEND='aws-kms' and provision " +
        `${toolEnvKeyName(toolId, 'aws-kms')} (K5).`,
    )
  }

  switch (backend) {
    case 'local-aes': {
      const envName = toolEnvKeyName(toolId, 'local-aes')
      const raw = env[envName]
      if (!raw) {
        throw new Error(
          `buildToolExecutorBackend: ${envName} is required for tool "${toolId}" ` +
            "(A2A_KMS_BACKEND='local-aes')",
        )
      }
      return createToolExecutorSigner(toolId, {
        A2A_KMS_BACKEND: 'local-aes',
        NODE_ENV: env.NODE_ENV,
        [envName]: raw,
      })
    }
    case 'aws-kms': {
      // K5 prod target. NO local fallback — same blast-radius logic as
      // the master signer: a missing tool key id at startup must throw
      // rather than degrade.
      const envName = toolEnvKeyName(toolId, 'aws-kms')
      const keyId = env[envName]
      if (!env.AWS_REGION) {
        throw new Error(
          `buildToolExecutorBackend: AWS_REGION is required for tool "${toolId}" signer (K5)`,
        )
      }
      if (!env.AWS_ROLE_ARN) {
        throw new Error(
          `buildToolExecutorBackend: AWS_ROLE_ARN is required for tool "${toolId}" signer (K5)`,
        )
      }
      if (!keyId) {
        throw new Error(
          `buildToolExecutorBackend: ${envName} is required for tool "${toolId}" signer (K5) — ` +
            'each tool family has its OWN KMS key for defense in depth.',
        )
      }
      return createToolExecutorSigner(toolId, {
        A2A_KMS_BACKEND: 'aws-kms',
        AWS_REGION: env.AWS_REGION,
        AWS_ROLE_ARN: env.AWS_ROLE_ARN,
        [envName]: keyId,
      })
    }
    case 'vault-transit':
      throw new Error(
        `buildToolExecutorBackend: vault-transit signer not implemented (deferred sibling) for tool "${toolId}"`,
      )
    default:
      throw new Error(
        `buildToolExecutorBackend: unknown A2A_KMS_BACKEND: ${backend}`,
      )
  }
}
