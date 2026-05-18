/**
 * Per-tool-family executor signer registry (KMS migration K5).
 *
 * K5 is the migration of the per-tool executor keys
 * (`TOOL_EXECUTOR_*_PRIVATE_KEY`) from process env to AWS KMS asymmetric
 * signers. The K5 architecture mirrors K4 (`aws-kms-signer.ts` /
 * `local-secp256k1-signer.ts`) except the signer is parameterized by a
 * tool id: each tool family (`round-awards`, `disbursement`,
 * `pool-lifecycle`, `grant-awards`) has its OWN KMS key id and its OWN
 * derived EOA, so a compromised key for one family cannot sign for
 * another. The IAM resource scope on each tool-executor key (separate
 * KMS ARN per tool id) is the security boundary; this file is the SDK-
 * layer factory the a2a-agent uses to construct the per-tool signer
 * backends.
 *
 * Why a parameterized factory rather than a sibling file per tool id:
 * the per-family identities are otherwise identical in structure —
 * 32-byte secp256k1 private key in dev, AWS KMS asymmetric
 * `ECC_SECG_P256K1` key in prod. The only thing that changes is which
 * env var / KMS key id we read. A single factory is the smallest
 * surface and matches the K4 master-signer pattern.
 *
 * Inventory of tool executor keys (enumerated from
 * `apps/a2a-agent/src/lib/tool-executors.ts:51-66` and
 * `scripts/deploy-local.sh:447-454`):
 *
 *   tool id            env var (local-aes / dev)                   env var (aws-kms / prod)                       env var (gcp-kms / prod)
 *   -----------        ------------------------------------------  ----------------------------------------------  -------------------------------------------------
 *   round-awards       TOOL_EXECUTOR_ROUND_AWARDS_PRIVATE_KEY      AWS_KMS_TOOL_EXECUTOR_ROUND_AWARDS_KEY_ID       GCP_KMS_TOOL_EXECUTOR_ROUND_AWARDS_VERSION
 *   disbursement       TOOL_EXECUTOR_DISBURSEMENT_PRIVATE_KEY      AWS_KMS_TOOL_EXECUTOR_DISBURSEMENT_KEY_ID       GCP_KMS_TOOL_EXECUTOR_DISBURSEMENT_VERSION
 *   pool-lifecycle     TOOL_EXECUTOR_POOL_LIFECYCLE_PRIVATE_KEY    AWS_KMS_TOOL_EXECUTOR_POOL_LIFECYCLE_KEY_ID     GCP_KMS_TOOL_EXECUTOR_POOL_LIFECYCLE_VERSION
 *   grant-awards       TOOL_EXECUTOR_GRANT_AWARDS_PRIVATE_KEY      AWS_KMS_TOOL_EXECUTOR_GRANT_AWARDS_KEY_ID       GCP_KMS_TOOL_EXECUTOR_GRANT_AWARDS_VERSION
 *   auth-bootstrap     TOOL_EXECUTOR_AUTH_BOOTSTRAP_PRIVATE_KEY    AWS_KMS_TOOL_EXECUTOR_AUTH_BOOTSTRAP_KEY_ID     GCP_KMS_TOOL_EXECUTOR_AUTH_BOOTSTRAP_VERSION
 *
 * The legacy `tool-executors.ts` registry uses SCREAMING_SNAKE_CASE
 * "family" names (e.g. `ROUND_AWARDS`). K5 introduces a lowercase-with-
 * dashes tool id form (`round-awards`) for the public API; the two
 * encodings convert via `toolEnvKeyName` below.
 *
 * Defense-in-depth invariant: each tool family MUST have a SEPARATE
 * KMS key in production. The K4 IAM template scopes the role's
 * `kms:Sign` permission to the master-signer ARN only; the K5 IAM
 * extension adds one statement per tool key with `Resource` pinned to
 * that single ARN. A leaked agent process can sign for whichever tool
 * id its current request is for — but cannot escalate to a sibling
 * family. See `docs/operations/kms-signer-setup.md` § "Tool-executor
 * signer keys (K5)" for the operator runbook addendum.
 */
import {
  createLocalSecp256k1Signer,
  type LocalSecp256k1Signer,
  type LocalSecp256k1SignerAuditEvent,
} from './local-secp256k1-signer'
import {
  createAwsKmsSigner,
  type AwsKmsSigner,
  type AwsKmsSignerAuditEvent,
  type AwsKmsSignerDeps,
} from './aws-kms-signer'
import {
  createGcpKmsSigner,
  type GcpKmsSigner,
  type GcpKmsSignerAuditEvent,
  type GcpKmsSignerDeps,
} from './gcp-kms-signer'
import type { GcpAuthEnv } from './gcp-auth'

/**
 * Canonical list of tool executor identities. New entries here must be
 * mirrored in `TOOL_TO_FAMILY` (`apps/a2a-agent/src/lib/tool-executors.ts`)
 * and the dev-env injection in `scripts/deploy-local.sh`.
 *
 * The order is stable — used by `listToolExecutorIds()` consumers
 * (e.g. config validation, boot-time per-tool address derivation).
 */
export const TOOL_EXECUTOR_IDS = [
  'round-awards',
  'disbursement',
  'pool-lifecycle',
  'grant-awards',
  // K6 S1.5 — bootstrap-auth executor. Signs system operations during
  // user signup / first sign-in (smart-account deploy, `.agent` name
  // registration, resolver bootstrap, deterministic account derivation).
  // The user can't perform these themselves — they don't have a wallet
  // yet — so the system signs on their behalf. Holds `.agent` root
  // ownership in deploy-time setup so it can `register` new child names.
  'auth-bootstrap',
] as const

export type ToolExecutorId = (typeof TOOL_EXECUTOR_IDS)[number]

/**
 * Guard for runtime checks: is `id` a known tool executor id?
 */
export function isToolExecutorId(id: string): id is ToolExecutorId {
  return (TOOL_EXECUTOR_IDS as readonly string[]).includes(id)
}

/**
 * Convert a tool id (`round-awards`) into the SCREAMING_SNAKE_CASE
 * fragment used in env var names (`ROUND_AWARDS`). The full env var
 * name depends on the backend:
 *
 *   - `'local-aes'`  → `TOOL_EXECUTOR_<UPPER>_PRIVATE_KEY`
 *   - `'aws-kms'`    → `AWS_KMS_TOOL_EXECUTOR_<UPPER>_KEY_ID`
 *   - `'gcp-kms'`    → `GCP_KMS_TOOL_EXECUTOR_<UPPER>_VERSION`
 *
 * Pass the `backend` argument to disambiguate. No-backend variant
 * returns just the upper fragment for callers that want to compose
 * their own env var name.
 */
export function toolEnvKeyName(
  toolId: ToolExecutorId,
  backend?: 'local-aes' | 'aws-kms' | 'gcp-kms',
): string {
  const upper = toolId.replace(/-/g, '_').toUpperCase()
  if (backend === 'local-aes') return `TOOL_EXECUTOR_${upper}_PRIVATE_KEY`
  if (backend === 'aws-kms') return `AWS_KMS_TOOL_EXECUTOR_${upper}_KEY_ID`
  if (backend === 'gcp-kms') return `GCP_KMS_TOOL_EXECUTOR_${upper}_VERSION`
  return upper
}

/**
 * Env shape consumed by `createToolExecutorSigner`. Same selector
 * (`A2A_KMS_BACKEND`) as the master signer / envelope encryption — one
 * deployment switch controls all four backends (local-aes, aws-kms,
 * gcp-kms — see G-PR-4).
 *
 * Per-tool env vars are read by name (constructed via
 * `toolEnvKeyName`). The env object MAY include extra keys; only the
 * relevant ones for the active backend + tool id are accessed.
 */
export interface ToolExecutorSignerEnv {
  A2A_KMS_BACKEND?: string
  NODE_ENV?: string
  // local-aes path — read at TOOL_EXECUTOR_<TOOL_ID>_PRIVATE_KEY.
  [key: string]: string | undefined
  // aws-kms path — read at AWS_KMS_TOOL_EXECUTOR_<TOOL_ID>_KEY_ID, plus
  // shared role / region (same values as K4 master signer).
  // gcp-kms path — read at GCP_KMS_TOOL_EXECUTOR_<TOOL_ID>_VERSION, plus
  // the five GCP auth identifiers (same values as G-PR-3 master signer).
}

/**
 * Optional dependencies passed through to the underlying signer
 * (test-injectable `KMSClient` / `SignerKmsClientLike` stubs). The
 * local-aes path has no dependencies.
 *
 * Sprint 3 S3.2 — `audit` mirrors the master-signer's audit-callback
 * shape. Wired into all three construction paths (local-aes, aws-kms,
 * gcp-kms) so dev/prod parity is exact.
 */
export interface ToolExecutorSignerDeps {
  awsKmsDeps?: AwsKmsSignerDeps
  gcpKmsDeps?: GcpKmsSignerDeps
  audit?: (
    event:
      | AwsKmsSignerAuditEvent
      | GcpKmsSignerAuditEvent
      | LocalSecp256k1SignerAuditEvent,
  ) => Promise<void> | void
}

/**
 * Signer backend shape returned for each tool id. Mirrors the K4
 * master signer's `KmsAccountBackend` so the viem `LocalAccount`
 * adapter (`createKmsAccount`) wraps it identically.
 */
export type ToolExecutorSignerBackend =
  | LocalSecp256k1Signer
  | AwsKmsSigner
  | GcpKmsSigner

/**
 * Construct the signer backend for a specific tool family.
 *
 * Backend selection (via `env.A2A_KMS_BACKEND`, default `'local-aes'`):
 *
 *   - `'local-aes'`     → `createLocalSecp256k1Signer` reading
 *                         `TOOL_EXECUTOR_<TOOL_ID>_PRIVATE_KEY`. Same
 *                         dev-only guard: refuses `NODE_ENV='production'`.
 *   - `'aws-kms'`       → `createAwsKmsSigner` reading
 *                         `AWS_KMS_TOOL_EXECUTOR_<TOOL_ID>_KEY_ID` for
 *                         the per-tool KMS key ARN/UUID/alias. Same
 *                         `AWS_REGION` + `AWS_ROLE_ARN` as the master
 *                         signer; the role's identity policy adds one
 *                         statement per tool key with that key's ARN
 *                         pinned as `Resource` for least-privilege.
 *   - `'gcp-kms'`       → `createGcpKmsSigner` reading
 *                         `GCP_KMS_TOOL_EXECUTOR_<TOOL_ID>_VERSION` for
 *                         the per-tool cryptoKeyVersion resource path.
 *                         Same five GCP auth identifiers
 *                         (`GCP_PROJECT_ID`, `GCP_PROJECT_NUMBER`,
 *                         `GCP_WORKLOAD_IDENTITY_POOL_ID`,
 *                         `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID`,
 *                         `GCP_SERVICE_ACCOUNT_EMAIL`) as the G-PR-3
 *                         master signer; the service account's IAM
 *                         binding adds one `roles/cloudkms.signer`
 *                         entry per tool key for least-privilege.
 *                         G-PR-4 implementation. The `'vault-transit'`
 *                         deferred-sibling case was removed in G-PR-1.
 *
 * Thrown errors are operator-actionable strings — the env var name
 * appears verbatim so the operator can search their deployment for
 * the missing variable.
 *
 * @throws if the active backend's required env vars are missing or
 *         malformed.
 */
export function createToolExecutorSigner(
  toolId: ToolExecutorId,
  env: ToolExecutorSignerEnv,
  deps: ToolExecutorSignerDeps = {},
): ToolExecutorSignerBackend {
  if (!isToolExecutorId(toolId)) {
    throw new Error(
      `createToolExecutorSigner: unknown tool id "${toolId}" — expected one of ${TOOL_EXECUTOR_IDS.join(', ')}`,
    )
  }

  const backend = env.A2A_KMS_BACKEND ?? 'local-aes'

  if (env.NODE_ENV === 'production' && backend === 'local-aes') {
    throw new Error(
      `createToolExecutorSigner: refusing to instantiate 'local-aes' signer for tool "${toolId}" in production. ` +
        "Set A2A_KMS_BACKEND='aws-kms' and provision AWS_KMS_TOOL_EXECUTOR_<TOOL_ID>_KEY_ID.",
    )
  }

  switch (backend) {
    case 'local-aes': {
      const envName = toolEnvKeyName(toolId, 'local-aes')
      const raw = env[envName]
      if (!raw) {
        throw new Error(
          `createToolExecutorSigner: ${envName} is required for tool "${toolId}" ` +
            "when A2A_KMS_BACKEND='local-aes'",
        )
      }
      // Re-use the K4 local signer. The "A2A_MASTER_PRIVATE_KEY" field
      // name is generic — the local signer doesn't know or care that it's
      // for a tool executor rather than the master EOA.
      return createLocalSecp256k1Signer(
        {
          A2A_MASTER_PRIVATE_KEY: raw,
          NODE_ENV: env.NODE_ENV,
        },
        { audit: deps.audit },
      )
    }
    case 'aws-kms': {
      const envName = toolEnvKeyName(toolId, 'aws-kms')
      const keyId = env[envName]
      if (!keyId) {
        throw new Error(
          `createToolExecutorSigner: ${envName} is required for tool "${toolId}" ` +
            "when A2A_KMS_BACKEND='aws-kms'",
        )
      }
      if (!env.AWS_REGION) {
        throw new Error(
          `createToolExecutorSigner: AWS_REGION is required for tool "${toolId}" ` +
            "when A2A_KMS_BACKEND='aws-kms'",
        )
      }
      if (!env.AWS_ROLE_ARN) {
        throw new Error(
          `createToolExecutorSigner: AWS_ROLE_ARN is required for tool "${toolId}" ` +
            "when A2A_KMS_BACKEND='aws-kms'",
        )
      }
      return createAwsKmsSigner(
        {
          AWS_REGION: env.AWS_REGION,
          AWS_ROLE_ARN: env.AWS_ROLE_ARN,
          AWS_KMS_SIGNER_KEY_ID: keyId,
        },
        { ...deps.awsKmsDeps, audit: deps.audit },
      )
    }
    case 'gcp-kms': {
      // G-PR-4 — per-tool GCP KMS asymmetric secp256k1 signer.
      // Same five GCP auth identifiers as the master signer; the
      // per-tool key is pinned to a SPECIFIC cryptoKeyVersion (the
      // `_VERSION` env var follows the `cryptoKeyVersions/<n>` shape
      // validated inside `createGcpKmsSigner`).
      const envName = toolEnvKeyName(toolId, 'gcp-kms')
      const versionPath = env[envName]
      if (!versionPath) {
        throw new Error(
          `createToolExecutorSigner: ${envName} is required for tool "${toolId}" ` +
            "when A2A_KMS_BACKEND='gcp-kms'",
        )
      }
      // Per-tool env-var enforcement for the five GCP auth identifiers.
      // We surface a per-tool error message so operators see WHICH tool
      // construction failed when a deployment is missing the shared
      // GCP auth env.
      const requiredGcpAuthKeys: readonly (keyof GcpAuthEnv)[] = [
        'GCP_PROJECT_ID',
        'GCP_PROJECT_NUMBER',
        'GCP_WORKLOAD_IDENTITY_POOL_ID',
        'GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID',
        'GCP_SERVICE_ACCOUNT_EMAIL',
      ]
      for (const key of requiredGcpAuthKeys) {
        if (!env[key]) {
          throw new Error(
            `createToolExecutorSigner: ${key} is required for tool "${toolId}" ` +
              "when A2A_KMS_BACKEND='gcp-kms'",
          )
        }
      }
      return createGcpKmsSigner(
        {
          GCP_PROJECT_ID: env.GCP_PROJECT_ID as string,
          GCP_PROJECT_NUMBER: env.GCP_PROJECT_NUMBER as string,
          GCP_WORKLOAD_IDENTITY_POOL_ID: env.GCP_WORKLOAD_IDENTITY_POOL_ID as string,
          GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID:
            env.GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID as string,
          GCP_SERVICE_ACCOUNT_EMAIL: env.GCP_SERVICE_ACCOUNT_EMAIL as string,
          GCP_KMS_MASTER_SIGNER_VERSION: versionPath,
        },
        { ...deps.gcpKmsDeps, audit: deps.audit },
      )
    }
    // The vault-transit deferred-sibling case was removed in G-PR-1.
    default:
      throw new Error(
        `createToolExecutorSigner: unknown A2A_KMS_BACKEND: ${backend}`,
      )
  }
}

/**
 * Convenience: every tool id in canonical order. Equivalent to
 * `[...TOOL_EXECUTOR_IDS]` but returned as a plain `ToolExecutorId[]`
 * (not a readonly tuple) so callers can iterate / `.map()` without
 * type widening.
 */
export function listToolExecutorIds(): ToolExecutorId[] {
  return [...TOOL_EXECUTOR_IDS]
}
